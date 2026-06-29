const HORSE_COUNT_MAX = 18;
const STORAGE_KEYS = {
  current: "umaDraw.currentResult.v1",
  history: "umaDraw.resultHistory.v1",
};
const spritePath = (number) => `./assets/horses/horse_${String(number).padStart(2, "0")}.png`;

const state = {
  entryCount: 18,
  pickCount: 18,
  stakeYen: 100,
  sound: true,
  axisCount: 0,
  selected: [],
  isDrawing: false,
  lastSavedAt: null,
  lastHistorySignature: null,
  horses: Array.from({ length: HORSE_COUNT_MAX }, (_, index) => {
    const number = index + 1;
    return {
      id: `horse-${number}`,
      number,
      name: `${number}番`,
      enabled: true,
      sprite: spritePath(number),
    };
  }),
};

const elements = {
  setTitle: document.querySelector("#setTitle"),
  soundButton: document.querySelector("#soundButton"),
  drawView: document.querySelector("#drawView"),
  entryCountInput: document.querySelector("#entryCountInput"),
  pickCountInput: document.querySelector("#pickCountInput"),
  stakeInput: document.querySelector("#stakeInput"),
  presets: document.querySelectorAll(".preset"),
  poolSummary: document.querySelector("#poolSummary"),
  trackStage: document.querySelector("#trackStage"),
  runner: document.querySelector("#runner"),
  runnerImage: document.querySelector("#runnerImage"),
  runnerBadge: document.querySelector("#runnerBadge"),
  revealCopy: document.querySelector("#revealCopy"),
  drawButton: document.querySelector("#drawButton"),
  resultLinkButton: document.querySelector("#resultLinkButton"),
  drawProgress: document.querySelector("#drawProgress"),
  saveStatus: document.querySelector("#saveStatus"),
  pickedStrip: document.querySelector("#pickedStrip"),
  resetDrawButton: document.querySelector("#resetDrawButton"),
  horseGrid: document.querySelector("#horseGrid"),
  enableAllButton: document.querySelector("#enableAllButton"),
  resultPanel: document.querySelector("#resultPanel"),
  selectedStrip: document.querySelector("#selectedStrip"),
  axisButtons: document.querySelectorAll(".axis"),
  ticketTable: document.querySelector("#ticketTable"),
  copyButton: document.querySelector("#copyButton"),
};

let audioContext;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function activeHorses() {
  return state.horses.slice(0, state.entryCount);
}

function enabledHorses() {
  return activeHorses().filter((horse) => horse.enabled);
}

function formatYen(value) {
  return `${value.toLocaleString("ja-JP")}円`;
}

function combination(n, r) {
  if (r < 0 || n < r) return null;
  let result = 1;
  for (let i = 1; i <= r; i += 1) {
    result = (result * (n - r + i)) / i;
  }
  return Math.round(result);
}

function permutation(n, r) {
  if (r < 0 || n < r) return null;
  let result = 1;
  for (let i = 0; i < r; i += 1) {
    result *= n - i;
  }
  return result;
}

function ticketRows(k, axisCount) {
  const m = k - axisCount;

  if (axisCount === 0) {
    return [
      ["単勝", k],
      ["複勝", k],
      ["馬連BOX", combination(k, 2)],
      ["ワイドBOX", combination(k, 2)],
      ["馬単BOX", permutation(k, 2)],
      ["三連複BOX", combination(k, 3)],
      ["三連単BOX", permutation(k, 3)],
    ];
  }

  if (axisCount === 1) {
    return [
      ["馬連 1頭軸流し", m],
      ["ワイド 1頭軸流し", m],
      ["馬単 1着固定", m],
      ["馬単 1頭軸マルチ", m * 2],
      ["三連複 1頭軸流し", combination(m, 2)],
      ["三連単 1頭軸1着固定", permutation(m, 2)],
      ["三連単 1頭軸マルチ", combination(m, 2) == null ? null : combination(m, 2) * 6],
    ];
  }

  if (axisCount === 2) {
    return [
      ["三連複 2頭軸流し", m],
      ["三連単 2頭軸マルチ", m > 0 ? m * 6 : null],
    ];
  }

  return [
    ["三連複 3頭固定", k >= 3 ? 1 : null],
    ["三連単 3頭BOX", k >= 3 ? 6 : null],
  ];
}

function shuffle(list) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function storageAvailable() {
  try {
    const key = "__uma_draw_test__";
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    return false;
  }
}

function resultSignature(result) {
  return [
    result.entryCount,
    result.pickCount,
    result.stakeYen,
    result.axisCount,
    result.selectedNumbers.join("-"),
  ].join("|");
}

function currentResultPayload() {
  const selectedNumbers = state.selected.map((horse) => horse.number);
  return {
    entryCount: state.entryCount,
    pickCount: state.pickCount,
    stakeYen: state.stakeYen,
    axisCount: state.axisCount,
    selectedNumbers,
    completed: selectedNumbers.length >= state.pickCount,
    savedAt: new Date().toISOString(),
  };
}

function readHistory() {
  if (!storageAvailable()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveCompletedHistory(result) {
  if (!result.completed) return;
  const signature = resultSignature(result);
  if (signature === state.lastHistorySignature) return;

  const history = readHistory();
  const exists = history.some((item) => item.signature === signature);
  if (!exists) {
    history.unshift({
      ...result,
      id: `result-${Date.now()}`,
      signature,
    });
    try {
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history.slice(0, 30)));
    } catch (error) {
      return;
    }
  }

  state.lastHistorySignature = signature;
}

function saveCurrentResult() {
  if (!storageAvailable()) {
    state.lastSavedAt = null;
    return;
  }

  if (!state.selected.length) {
    try {
      localStorage.removeItem(STORAGE_KEYS.current);
    } catch (error) {
      return;
    }
    state.lastSavedAt = null;
    state.lastHistorySignature = null;
    return;
  }

  const result = currentResultPayload();
  try {
    localStorage.setItem(STORAGE_KEYS.current, JSON.stringify(result));
    state.lastSavedAt = result.savedAt;
    saveCompletedHistory(result);
  } catch (error) {
    state.lastSavedAt = null;
  }
}

function restoreSavedResult() {
  if (!storageAvailable()) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.current);
    if (!raw) return;
    const result = JSON.parse(raw);
    const entryCount = clamp(Number(result.entryCount) || 18, 1, HORSE_COUNT_MAX);
    const pickCount = clamp(Number(result.pickCount) || entryCount, 1, entryCount);
    const selectedNumbers = Array.isArray(result.selectedNumbers) ? result.selectedNumbers : [];
    const uniqueNumbers = [...new Set(selectedNumbers.map(Number))]
      .filter((number) => Number.isInteger(number) && number >= 1 && number <= entryCount)
      .slice(0, pickCount);

    state.entryCount = entryCount;
    state.pickCount = pickCount;
    state.stakeYen = Math.max(100, Number(result.stakeYen) || 100);
    state.axisCount = clamp(Number(result.axisCount) || 0, 0, Math.min(3, uniqueNumbers.length));
    state.selected = uniqueNumbers.map((number) => state.horses[number - 1]);
    state.lastSavedAt = result.savedAt || null;
    state.lastHistorySignature = result.completed ? resultSignature({
      entryCount,
      pickCount,
      stakeYen: state.stakeYen,
      axisCount: state.axisCount,
      selectedNumbers: uniqueNumbers,
    }) : null;

    elements.entryCountInput.value = state.entryCount;
    elements.pickCountInput.value = state.pickCount;
    elements.stakeInput.value = state.stakeYen;
    state.horses.forEach((horse, index) => {
      horse.enabled = index < state.entryCount;
    });

    const lastHorse = state.selected[state.selected.length - 1];
    if (lastHorse) {
      elements.runnerImage.src = lastHorse.sprite;
      elements.runnerBadge.textContent = lastHorse.number;
      elements.revealCopy.textContent = "RESTORED";
    }
  } catch (error) {
    return;
  }
}

function setEntryCount(heads) {
  state.entryCount = clamp(heads, 1, HORSE_COUNT_MAX);
  state.pickCount = state.entryCount;
  state.axisCount = 0;
  state.selected = [];
  state.isDrawing = false;
  state.lastSavedAt = null;
  state.lastHistorySignature = null;
  elements.entryCountInput.value = state.entryCount;
  elements.pickCountInput.value = state.pickCount;
  state.horses.forEach((horse, index) => {
    horse.enabled = index < state.entryCount;
  });
  elements.drawButton.disabled = false;
  elements.revealCopy.textContent = "READY";
}

function syncCounts() {
  state.entryCount = clamp(Number(elements.entryCountInput.value) || 1, 1, HORSE_COUNT_MAX);
  elements.entryCountInput.value = state.entryCount;

  const enabledCount = enabledHorses().length;
  const maxPick = Math.max(1, enabledCount);
  state.pickCount = clamp(Number(elements.pickCountInput.value) || 1, 1, maxPick);
  elements.pickCountInput.max = maxPick;
  elements.pickCountInput.value = state.pickCount;
  if (state.selected.length > state.pickCount) {
    state.selected = state.selected.slice(0, state.pickCount);
  }

  state.stakeYen = Math.max(100, Number(elements.stakeInput.value) || 100);
  elements.stakeInput.value = state.stakeYen;
}

function renderPresets() {
  elements.presets.forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.heads) === state.entryCount);
  });
}

function renderHeader() {
  const enabledCount = enabledHorses().length;
  elements.setTitle.textContent = `${state.entryCount}頭立て`;
  elements.poolSummary.textContent = `${state.entryCount}頭中${enabledCount}頭`;
  elements.soundButton.setAttribute("aria-pressed", String(state.sound));
}

function renderDrawStatus() {
  const selectedCount = state.selected.length;
  const isComplete = selectedCount >= state.pickCount;
  elements.drawProgress.textContent = `${selectedCount}/${state.pickCount} 選出済み`;
  if (!storageAvailable()) {
    elements.saveStatus.textContent = "保存不可";
  } else if (state.lastSavedAt) {
    elements.saveStatus.textContent = isComplete ? "結果保存済み" : "途中保存済み";
  } else {
    elements.saveStatus.textContent = "未保存";
  }
  elements.resetDrawButton.hidden = selectedCount === 0 || state.isDrawing;
  elements.resultLinkButton.hidden = !isComplete || selectedCount === 0 || state.isDrawing;

  if (state.isDrawing) {
    elements.drawButton.disabled = true;
    elements.drawButton.textContent = "DRAWING";
    return;
  }

  elements.drawButton.disabled = isComplete;
  elements.drawButton.textContent = isComplete ? "完了" : "START";
}

function renderPicked() {
  if (!state.selected.length) {
    elements.pickedStrip.innerHTML = '<span class="empty-picks">未選出</span>';
    return;
  }

  elements.pickedStrip.innerHTML = state.selected
    .map((horse) => `<span class="pick-chip">${horse.number}</span>`)
    .join("");
}

function renderHorseGrid() {
  elements.horseGrid.innerHTML = activeHorses()
    .map((horse) => {
      const offClass = horse.enabled ? "" : " is-off";
      const status = horse.enabled ? "ON" : "OFF";
      return `
        <article class="horse-card${offClass}">
          <div class="horse-meta">
            <span class="number-pill">${horse.number}</span>
            <strong class="horse-name">${horse.name}</strong>
            <span class="toggle-state">${status}</span>
          </div>
          <img src="${horse.sprite}" alt="">
          <button type="button" data-horse="${horse.number}" aria-label="${horse.number}番 ${status}"></button>
        </article>
      `;
    })
    .join("");
}

function renderSelected() {
  if (!state.selected.length) {
    elements.resultPanel.hidden = true;
    return;
  }

  elements.resultPanel.hidden = false;

  elements.selectedStrip.innerHTML = state.selected
    .map((horse, index) => {
      const isAxis = index < state.axisCount;
      return `
        <article class="selected-row">
          <img src="${horse.sprite}" alt="">
          <div>
            <strong>${horse.number}番</strong>
            <span>${horse.name}</span>
          </div>
          ${isAxis ? '<b class="axis-mark">軸候補</b>' : '<span>選出</span>'}
        </article>
      `;
    })
    .join("");
}

function renderTickets() {
  const k = state.selected.length;
  const axisCount = clamp(state.axisCount, 0, Math.min(3, k));
  state.axisCount = axisCount;

  elements.axisButtons.forEach((button) => {
    const value = Number(button.dataset.axis);
    button.classList.toggle("is-active", value === axisCount);
    button.disabled = value > k;
  });

  const rows = ticketRows(k, axisCount).filter(([, points]) => points != null && points > 0);

  elements.ticketTable.innerHTML = rows
    .map(([label, points]) => {
      const total = points * state.stakeYen;
      return `
        <article class="ticket-row">
          <div>
            <strong>${label}</strong>
            <span>${state.stakeYen.toLocaleString("ja-JP")}円/点</span>
          </div>
          <b class="points">${points}点</b>
          <b class="yen">${formatYen(total)}</b>
        </article>
      `;
    })
    .join("");
}

function render() {
  syncCounts();
  renderPresets();
  renderHeader();
  renderDrawStatus();
  renderPicked();
  renderHorseGrid();
  renderSelected();
  renderTickets();
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
  return audioContext;
}

function playFanfare() {
  if (!state.sound) return;
  const context = ensureAudio();
  const now = context.currentTime;
  const notes = [
    [523.25, 0.0, 0.12],
    [659.25, 0.11, 0.12],
    [783.99, 0.22, 0.16],
    [1046.5, 0.39, 0.28],
  ];

  notes.forEach(([frequency, offset, duration], index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = index === notes.length - 1 ? "triangle" : "square";
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.13, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + duration + 0.03);
  });
}

function vibrate() {
  if ("vibrate" in navigator) {
    navigator.vibrate([25, 35, 45]);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function revealHorse(horse, rank) {
  elements.runnerImage.src = horse.sprite;
  elements.runnerBadge.textContent = horse.number;
  elements.revealCopy.textContent = `じゃじゃーん！ ${horse.number}番`;
  elements.runner.classList.remove("reveal");
  elements.revealCopy.classList.remove("pop");
  elements.trackStage.classList.add("is-running");
  elements.runner.getBoundingClientRect();
  playFanfare();
  vibrate();
  elements.runner.classList.add("reveal");
  elements.revealCopy.classList.add("pop");
  await wait(950);
  elements.trackStage.classList.remove("is-running");
  await wait(120);
}

async function draw() {
  syncCounts();
  if (state.isDrawing || state.selected.length >= state.pickCount) return;

  const selectedIds = new Set(state.selected.map((horse) => horse.id));
  const pool = enabledHorses().filter((horse) => !selectedIds.has(horse.id));
  if (!pool.length) return;

  const horse = shuffle(pool)[0];
  state.isDrawing = true;
  state.selected.push(horse);
  state.axisCount = Math.min(state.axisCount, state.selected.length);
  saveCurrentResult();
  renderDrawStatus();
  renderPicked();
  renderSelected();
  renderTickets();
  await revealHorse(horse, state.selected.length);
  state.isDrawing = false;
  elements.revealCopy.textContent = "RESULT";
  render();
}

function scrollToResult() {
  elements.resultPanel.hidden = false;
  elements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function copyResult() {
  if (!state.selected.length) return;
  const k = state.selected.length;
  const axisLabel = state.axisCount === 0 ? "BOX" : `軸${state.axisCount}頭`;
  const horses = `選出馬番: ${state.selected.map((horse) => `${horse.number}番`).join(", ")}`;
  const tickets = ticketRows(k, state.axisCount)
    .filter(([, points]) => points != null && points > 0)
    .map(([label, points]) => `${label}: ${points}点 / ${formatYen(points * state.stakeYen)}`)
    .join("\n");
  const text = [`Uma Draw ${state.entryCount}頭立て`, axisLabel, horses, tickets].join("\n\n");
  navigator.clipboard?.writeText(text);
  elements.copyButton.textContent = "コピー済";
  window.setTimeout(() => {
    elements.copyButton.textContent = "コピー";
  }, 1200);
}

elements.entryCountInput.addEventListener("input", () => {
  const previousPick = state.pickCount;
  syncCounts();
  state.pickCount = Math.min(previousPick, enabledHorses().length);
  elements.pickCountInput.value = state.pickCount;
  state.selected = [];
  state.isDrawing = false;
  saveCurrentResult();
  render();
});

elements.pickCountInput.addEventListener("input", () => {
  syncCounts();
  saveCurrentResult();
  render();
});

elements.stakeInput.addEventListener("input", () => {
  syncCounts();
  saveCurrentResult();
  render();
});

elements.presets.forEach((button) => {
  button.addEventListener("click", () => {
    setEntryCount(Number(button.dataset.heads));
    saveCurrentResult();
    render();
  });
});

elements.horseGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-horse]");
  if (!button) return;
  const number = Number(button.dataset.horse);
  const horse = state.horses[number - 1];
  horse.enabled = !horse.enabled;
  state.selected = [];
  state.isDrawing = false;
  saveCurrentResult();
  render();
});

elements.enableAllButton.addEventListener("click", () => {
  activeHorses().forEach((horse) => {
    horse.enabled = true;
  });
  state.pickCount = activeHorses().length;
  elements.pickCountInput.value = state.pickCount;
  state.selected = [];
  state.isDrawing = false;
  saveCurrentResult();
  render();
});

elements.axisButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.axisCount = Number(button.dataset.axis);
    saveCurrentResult();
    renderSelected();
    renderTickets();
    renderDrawStatus();
  });
});

elements.resetDrawButton.addEventListener("click", () => {
  state.selected = [];
  state.axisCount = 0;
  state.isDrawing = false;
  elements.revealCopy.textContent = "READY";
  saveCurrentResult();
  render();
});

elements.soundButton.addEventListener("click", () => {
  state.sound = !state.sound;
  renderHeader();
});

elements.drawButton.addEventListener("click", draw);
elements.resultLinkButton.addEventListener("click", scrollToResult);
elements.copyButton.addEventListener("click", copyResult);

restoreSavedResult();
render();
