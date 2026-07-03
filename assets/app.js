const state = {
  manifest: null,
  prediction: null,
  review: null,
  ledger: null,
  dailySummaries: [],
  date: null,
  venue: "all",
  mode: "all",
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat("ja-JP");

const breakdownRoiTypes = [
  { key: "trio", label: "3連複", shortLabel: "3複" },
  { key: "trifecta", label: "3連単", shortLabel: "3単" },
  { key: "win5", label: "WIN5", shortLabel: "W5" },
];

const byId = (id) => document.getElementById(id);

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} を読み込めませんでした`);
  }
  return response.json();
}

async function init() {
  state.manifest = await loadJson("data/manifest.json");
  state.ledger = await loadJson("data/ledger.json");
  state.dailySummaries = await loadDailySummaries();
  state.date = state.manifest.latestDate;
  await loadDay(state.date);
  bindStaticControls();
  renderAll();
}

async function loadDailySummaries() {
  const entries = await Promise.all(state.manifest.dates.map(async (item) => {
    const [prediction, review] = await Promise.all([
      loadJson(`data/predictions/${item.date}.json`).catch(() => null),
      loadJson(`data/reviews/${item.date}.json`).catch(() => null),
    ]);

    if (!prediction) {
      return {
        ...item,
        status: "予想待ち",
        venues: "-",
        stake: 0,
        payout: null,
        balance: null,
        roi: null,
        hitCount: 0,
        stamp: "予想待ち",
        resultTone: "pending",
        raceCount: 0,
        reviewLead: "朝予想のJSONがまだありません。",
        typeRois: resolveBreakdownRois(null),
        axisStats: null,
        canOpen: false,
      };
    }

    const settlement = resolveDailySettlement(prediction, review);
    const firstReview = review?.items?.[0]?.body;

    return {
      ...item,
      status: review ? "振り返り済み" : "振り返り待ち",
      venues: prediction.venues.join(" / "),
      stake: settlement.stake,
      payout: settlement.payout,
      balance: settlement.balance,
      roi: settlement.roi,
      hitCount: settlement.hitCount,
      stamp: settlement.stamp,
      resultTone: settlement.tone,
      raceCount: prediction.races.length,
      reviewLead: firstReview || "夕方の自動更新後に日別レビューが入ります。",
      typeRois: resolveBreakdownRois(review),
      axisStats: resolveAxisStats(review),
      canOpen: true,
    };
  }));

  return entries;
}

function calcDailyStake(prediction) {
  const stakePerRace = toFiniteNumber(prediction.stakePerRace) ?? 200;
  const raceStake = toFiniteNumber(prediction.raceStake) ?? prediction.races.length * stakePerRace;
  const win5Stake = prediction.win5.routes.length * 100;
  return raceStake + win5Stake;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveHitCount(value) {
  if (Array.isArray(value)) {
    return value.length;
  }

  const number = toFiniteNumber(value);
  return number === null ? 0 : number;
}

function resolveDailySettlement(prediction, review) {
  const defaultStake = calcDailyStake(prediction);
  const settlement = review?.settlement;
  const stake = toFiniteNumber(settlement?.stake) ?? defaultStake;
  const payout = toFiniteNumber(settlement?.payout);
  const hitCount = resolveHitCount(settlement?.hits ?? settlement?.hitCount);
  const settled = Boolean(review && settlement && payout !== null);
  const result = settlement?.result;
  const isHit = settled && (result === "hit" || payout > 0 || hitCount > 0);
  const roi = settled && stake > 0 ? (payout / stake) * 100 : null;

  if (!review) {
    return {
      stake,
      payout: null,
      balance: null,
      roi: null,
      hitCount: 0,
      stamp: "集計待ち",
      tone: "pending",
    };
  }

  if (!settled) {
    return {
      stake,
      payout: null,
      balance: null,
      roi: null,
      hitCount: 0,
      stamp: "判定待ち",
      tone: "pending",
    };
  }

  return {
    stake,
    payout,
    balance: payout - stake,
    roi,
    hitCount,
    stamp: isHit ? "当たり" : "不的中",
    tone: isHit ? "hit" : "miss",
  };
}

function resolveBreakdownRois(review) {
  const breakdown = review?.breakdown || {};
  return breakdownRoiTypes.map((type) => {
    const item = breakdown[type.key];
    return {
      ...type,
      roi: toFiniteNumber(item?.roi),
      stake: toFiniteNumber(item?.stake),
      payout: toFiniteNumber(item?.payout),
      hits: resolveHitCount(item?.hits),
    };
  });
}

function resolveAxisStats(source) {
  const stats = source?.axisStats;
  if (!stats) {
    return null;
  }

  const races = toFiniteNumber(stats.races);
  const hits = toFiniteNumber(stats.hits);
  const fallbackRate = races && hits !== null ? (hits / races) * 100 : null;
  return {
    label: stats.label || "軸馬3着内率",
    definition: stats.definition || "◎にした馬が実際に3着以内",
    scope: stats.scope || "",
    updatedAt: stats.updatedAt || "",
    races,
    hits,
    rate: toFiniteNumber(stats.rate) ?? fallbackRate,
  };
}

async function loadDay(date) {
  state.date = date;
  const [prediction, review] = await Promise.all([
    loadJson(`data/predictions/${date}.json`),
    loadJson(`data/reviews/${date}.json`).catch(() => null),
  ]);
  state.prediction = prediction;
  state.review = review;
  state.venue = "all";
}

function bindStaticControls() {
  byId("modeTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) return;
    state.mode = button.dataset.mode;
    renderModeTabs();
    renderVisibility();
  });

  const reviewCalendar = byId("reviewCalendar");
  if (!reviewCalendar) {
    return;
  }

  reviewCalendar.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-calendar-date]");
    if (!button || button.disabled) return;
    await loadDay(button.dataset.calendarDate);
    renderAll();
    byId("review").scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function renderAll() {
  renderDateTabs();
  renderVenueFilters();
  renderModeTabs();
  renderHero();
  renderAxisProof();
  renderSummary();
  renderRaces();
  renderWin5();
  renderReviews();
  renderDailySummaries();
  renderReviewCalendar();
  renderVisibility();
  byId("lastUpdated").textContent = state.prediction.updatedAt;
}

function renderDateTabs() {
  const root = byId("dateTabs");
  root.innerHTML = "";
  state.manifest.dates.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${item.label} ${item.shortDate}`;
    button.className = item.date === state.date ? "is-active" : "";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", item.date === state.date ? "true" : "false");
    button.addEventListener("click", async () => {
      await loadDay(item.date);
      renderAll();
    });
    root.appendChild(button);
  });
}

function renderVenueFilters() {
  const root = byId("venueFilters");
  const venues = ["all", ...state.prediction.venues];
  root.innerHTML = "";
  venues.forEach((venue) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = venue === "all" ? "すべて" : venue;
    button.className = venue === state.venue ? "is-active" : "";
    button.addEventListener("click", () => {
      state.venue = venue;
      renderVenueFilters();
      renderRaces();
    });
    root.appendChild(button);
  });
}

function renderModeTabs() {
  byId("modeTabs").querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === state.mode);
  });
}

function renderHero() {
  byId("headline").textContent = state.prediction.headline;
  byId("summary").textContent = state.prediction.summary;
  byId("heroMeta").innerHTML = [
    `開催: ${state.prediction.venues.join(" / ")}`,
    `馬場: ${state.prediction.trackCondition}`,
    `取消: ${state.prediction.scratches}`,
    `WIN5締切: ${state.prediction.win5.deadline}`,
  ].map((text) => `<span>${escapeHtml(text)}</span>`).join("");
}

function renderAxisProof() {
  const stats = resolveAxisStats(state.ledger);
  if (!stats) {
    byId("axisPlaceRate").textContent = "--";
    byId("axisPlaceHits").textContent = "--";
    byId("axisPlaceTotal").textContent = "--";
    byId("axisProofScope").textContent = "--";
    return;
  }

  byId("axisProofLabel").textContent = stats.label;
  byId("axisPlaceRate").textContent = formatRoi(stats.rate);
  byId("axisProofCopy").textContent = stats.definition;
  byId("axisPlaceHits").textContent = stats.hits === null ? "--" : `${integer.format(stats.hits)}R`;
  byId("axisPlaceTotal").textContent = stats.races === null ? "--" : `${integer.format(stats.races)}R`;
  byId("axisProofScope").textContent = stats.scope || stats.updatedAt || "--";
}

function renderSummary() {
  const races = state.prediction.races.length;
  const stakePerRace = toFiniteNumber(state.prediction.stakePerRace) ?? 200;
  const raceStake = toFiniteNumber(state.prediction.raceStake) ?? races * stakePerRace;
  const win5Stake = state.prediction.win5.routes.length * 100;
  const totalStake = raceStake + win5Stake;
  byId("stakeTotal").textContent = yen.format(totalStake);
  byId("expectedReturn").textContent = yen.format(state.prediction.expectedReturn);
  byId("roi").textContent = `${state.prediction.expectedRoi}%`;
  byId("yearBalance").textContent = yen.format(state.ledger.yearBalance);
}

function renderRaces() {
  const root = byId("raceList");
  const races = state.prediction.races.filter((race) => {
    return state.venue === "all" || race.venue === state.venue;
  });

  root.innerHTML = races.map((race) => {
    const betLabels = resolveRaceBetLabels(race);
    return `
      <article class="race-ticket">
        <div class="race-time">
          <strong>${escapeHtml(race.venue)} ${escapeHtml(race.raceNo)}R</strong>
          <span>${escapeHtml(race.start)}</span>
          <span class="grade">${escapeHtml(race.grade)}</span>
        </div>
        <div class="race-title">
          <h3>${escapeHtml(race.name)}</h3>
          <p>${escapeHtml(race.condition)}</p>
          <span class="tag ${race.confidence === "本命" ? "red" : ""}">${escapeHtml(race.confidence)}</span>
        </div>
        <div class="bets">
          ${race.trifectaPublic === false ? "" : renderBetLine(betLabels.trifecta, race.trifecta, false)}
          ${renderBetLine(betLabels.trio, race.trio, true)}
          ${renderRaceEdge(race)}
        </div>
        <div class="race-side">
          <span>推定妙味</span>
          <strong class="odds">${escapeHtml(race.value)}</strong>
          <span>${escapeHtml(race.note)}</span>
        </div>
      </article>
    `;
  }).join("");
}

function resolveRaceBetLabels(race) {
  const labels = race.betLabels || {};
  const defaultTrioLabel = toFiniteNumber(state.prediction?.stakePerRace) === 100 ? "同一3頭3連複" : "穴3連複";
  return {
    trifecta: race.trifectaLabel || labels.trifecta || "本命3連単",
    trio: race.trioLabel || labels.trio || defaultTrioLabel,
    trifectaEdge: race.trifectaEdgeLabel || labels.trifectaEdge || "本命EV",
    trioEdge: race.trioEdgeLabel || labels.trioEdge || "3複EV",
  };
}

function renderRaceEdge(race) {
  if (!race.edge) {
    return "";
  }

  const betLabels = resolveRaceBetLabels(race);
  const rows = [
    [betLabels.trifectaEdge, race.trifectaPublic === false ? null : race.edge.trifecta],
    [betLabels.trioEdge, race.edge.trio],
  ].filter(([, item]) => item);

  const cells = rows.map(([label, item]) => `
    <div class="edge-cell">
      <span>${escapeHtml(label)}</span>
      <strong>${formatExpectedValue(item.expectedValue)}</strong>
      <small>p ${formatProbability(item.probability)} / ${formatOdds(item.odds)}${formatOddsTime(item.oddsTime)}</small>
    </div>
  `).join("");

  const verdict = race.edge.verdict || "判定未入力";
  const scenario = race.edge.scenario ? `<p>${escapeHtml(race.edge.scenario)}</p>` : "";

  return `
    <div class="edge-panel">
      <div class="edge-head">
        <span>確率EV</span>
        <strong class="${verdict === "勝負" ? "is-positive" : ""}">${escapeHtml(verdict)}</strong>
      </div>
      <div class="edge-grid">${cells}</div>
      ${scenario}
    </div>
  `;
}

function formatProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${(number * 100).toFixed(number < 0.01 ? 2 : 1)}%`;
}

function formatOdds(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number.toFixed(number < 10 ? 1 : 0)}倍`;
}

function formatExpectedValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "--";
  }

  return `${number.toFixed(2)}x`;
}

function formatOddsTime(value) {
  return value ? ` / ${escapeHtml(value)}` : "";
}

function renderBetLine(label, numbers, isTrio) {
  if (!Array.isArray(numbers) || !numbers.length) {
    return "";
  }

  const joined = numbers.map((number, index) => {
    const separator = isTrio || index === numbers.length - 1 ? "" : `<span class="arrow">&gt;</span>`;
    return `<span class="num">${escapeHtml(String(number))}</span>${separator}`;
  }).join("");
  return `
    <div class="bet-line">
      <span class="bet-type ${isTrio ? "trio" : ""}">${label}</span>
      <div class="numbers">${joined}</div>
    </div>
  `;
}

function renderWin5() {
  const root = byId("win5Routes");
  root.innerHTML = state.prediction.win5.routes.map((route) => {
    const cells = route.legs.map((leg) => `
      <div class="route-cell">
        <span>${escapeHtml(leg.race)}</span>
        <strong>${escapeHtml(String(leg.pick))}</strong>
      </div>
    `).join("");
    return `
      <article class="route">
        <div class="route-head">
          <h3>${escapeHtml(route.name)}</h3>
          <span class="tag ${route.name === "穴" ? "red" : ""}">${escapeHtml(route.style)}</span>
        </div>
        <div class="route-grid">${cells}</div>
      </article>
    `;
  }).join("");
}

function renderReviews() {
  const root = byId("reviewList");
  if (!state.review) {
    root.innerHTML = `<article class="review-item"><h3>振り返り待ち</h3><p>夕方の自動更新後に結果、収支、反省が入ります。</p></article>`;
    return;
  }

  const items = Array.isArray(state.review.items) ? state.review.items : [];
  const reviewItems = items.map((item) => `
    <article class="review-item">
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.body)}</p>
    </article>
  `).join("");

  root.innerHTML = `${reviewItems}${renderReviewTables(state.review)}`;
}

function renderReviewTables(review) {
  const typeSummaries = renderBetTypeSummaries(review);
  const breakdownRows = buildReviewBreakdownRows(review);
  const hits = Array.isArray(review.settlement?.hits) ? review.settlement.hits : [];
  const breakdownTable = renderBreakdownTable(breakdownRows);
  const hitTable = renderHitTable(hits);
  const win5Table = renderWin5ResultTable(review.win5);

  if (!typeSummaries && !breakdownTable && !hitTable && !win5Table) {
    return "";
  }

  return `
    <div class="review-table-area">
      ${typeSummaries}
      <div class="review-table-grid">
        ${breakdownTable}
        ${hitTable}
      </div>
      ${win5Table}
    </div>
  `;
}

function renderBetTypeSummaries(review) {
  const summaries = buildBetTypeSummaries(review);
  if (!summaries.length) {
    return "";
  }

  return `
    <section class="review-type-summary" aria-labelledby="reviewTypeSummaryTitle">
      <div class="review-table-heading">
        <h3 id="reviewTypeSummaryTitle">券種別サマリー</h3>
      </div>
      <div class="review-type-grid">
        ${summaries.map((summary) => `
          <article class="review-type-card ${summary.tone}">
            <div class="review-type-top">
              <span>${escapeHtml(summary.label)}</span>
              <strong>${formatRoi(summary.roi)}</strong>
            </div>
            <p>${escapeHtml(summary.body)}</p>
            <div class="review-type-metrics">
              <span>投資 <strong>${formatYenOrDash(summary.stake)}</strong></span>
              <span>払戻 <strong>${formatYenOrDash(summary.payout)}</strong></span>
              <span>的中 <strong>${escapeHtml(`${summary.hits}本`)}</strong></span>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function buildBetTypeSummaries(review) {
  const items = Array.isArray(review.items) ? review.items : [];
  const configs = [
    { key: "win5", label: "WIN5単体", itemTitles: ["WIN5"], tone: "win5" },
    { key: "trio", label: "3連複単体", itemTitles: ["同一3頭3連複", "穴3連複"], tone: "trio" },
    { key: "trifecta", label: "3連単単体", itemTitles: ["本命3連単"], tone: "trifecta" },
  ];

  return configs.map((config) => {
    const item = review.breakdown?.[config.key];
    if (!item) {
      return null;
    }

    const stake = toFiniteNumber(item.stake);
    const payout = toFiniteNumber(item.payout);
    const body = items.find((candidate) => config.itemTitles.includes(candidate.title))?.body || "サマリー未入力";

    return {
      label: item.label || config.label,
      body,
      stake,
      payout,
      roi: toFiniteNumber(item.roi),
      hits: resolveHitCount(item.hits),
      tone: config.tone,
    };
  }).filter(Boolean);
}

function buildReviewBreakdownRows(review) {
  const labels = {
    trifecta: "3連単",
    trio: "3連複",
    win5: "WIN5",
  };

  const rows = Object.entries(review.breakdown || {}).map(([key, item]) => {
    const stake = toFiniteNumber(item.stake);
    const payout = toFiniteNumber(item.payout);
    const balance = stake !== null && payout !== null ? payout - stake : null;
    return {
      label: item.label || labels[key] || key,
      stake,
      payout,
      balance,
      roi: toFiniteNumber(item.roi),
      hits: resolveHitCount(item.hits),
      isTotal: false,
    };
  });

  if (review.settlement) {
    const stake = toFiniteNumber(review.settlement.stake);
    const payout = toFiniteNumber(review.settlement.payout);
    const fallbackBalance = stake !== null && payout !== null ? payout - stake : null;
    rows.push({
      label: "合計",
      stake,
      payout,
      balance: toFiniteNumber(review.settlement.balance) ?? fallbackBalance,
      roi: toFiniteNumber(review.settlement.roi),
      hits: resolveHitCount(review.settlement.hits ?? review.settlement.hitCount),
      isTotal: true,
    });
  }

  return rows;
}

function renderBreakdownTable(rows) {
  if (!rows.length) {
    return "";
  }

  const body = rows.map((row) => {
    const balanceTone = row.balance > 0 ? "is-positive" : row.balance < 0 ? "is-negative" : "";
    return `
      <tr class="${row.isTotal ? "is-total" : ""}">
        <th scope="row">${escapeHtml(row.label)}</th>
        <td>${formatYenOrDash(row.stake)}</td>
        <td>${formatYenOrDash(row.payout)}</td>
        <td class="${balanceTone}">${formatYenOrDash(row.balance)}</td>
        <td>${formatRoi(row.roi)}</td>
        <td>${escapeHtml(`${row.hits}本`)}</td>
      </tr>
    `;
  }).join("");

  return `
    <section class="review-table-block" aria-labelledby="reviewBreakdownTitle">
      <div class="review-table-heading">
        <h3 id="reviewBreakdownTitle">収支内訳</h3>
      </div>
      <div class="table-scroll">
        <table class="review-table">
          <thead>
            <tr>
              <th scope="col">種別</th>
              <th scope="col">投資</th>
              <th scope="col">払戻</th>
              <th scope="col">収支</th>
              <th scope="col">回収率</th>
              <th scope="col">的中</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderHitTable(hits) {
  const body = hits.length
    ? hits.map((hit) => `
      <tr>
        <th scope="row">${escapeHtml(hit.race || "--")}</th>
        <td>${escapeHtml(hit.type || hit.betType || "--")}</td>
        <td>${escapeHtml(formatTicket(hit.ticket))}</td>
        <td>${formatYenOrDash(toFiniteNumber(hit.payout))}</td>
      </tr>
    `).join("")
    : `<tr><td class="empty-cell" colspan="4">的中なし</td></tr>`;

  return `
    <section class="review-table-block" aria-labelledby="reviewHitsTitle">
      <div class="review-table-heading">
        <h3 id="reviewHitsTitle">的中一覧</h3>
      </div>
      <div class="table-scroll">
        <table class="review-table">
          <thead>
            <tr>
              <th scope="col">レース</th>
              <th scope="col">種別</th>
              <th scope="col">買い目</th>
              <th scope="col">払戻</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderWin5ResultTable(win5) {
  if (!win5) {
    return "";
  }

  const rows = [
    ["結果", formatTicket(win5.result)],
    ["払戻", formatYenOrDash(toFiniteNumber(win5.payout))],
    ["的中票数", formatNumberOrDash(win5.hitCount)],
    ["キャリーオーバー", formatYenOrDash(toFiniteNumber(win5.carryover))],
    ["発売票数", formatNumberOrDash(win5.salesVotes)],
    ["発売金額", formatYenOrDash(toFiniteNumber(win5.salesAmount))],
  ];

  return `
    <section class="review-table-block full" aria-labelledby="reviewWin5Title">
      <div class="review-table-heading">
        <h3 id="reviewWin5Title">WIN5結果</h3>
      </div>
      <div class="review-kv-grid">
        ${rows.map(([label, value]) => `
          <div>
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function formatTicket(ticket) {
  return Array.isArray(ticket) && ticket.length ? ticket.join("-") : "--";
}

function renderDailySummaries() {
  const root = byId("dailySummaryList");
  root.innerHTML = state.dailySummaries.map((item) => {
    const activeClass = item.date === state.date ? " is-current" : "";
    const hitText = item.resultTone === "pending" ? "結果未入力" : item.hitCount > 0 ? `${item.hitCount}本的中` : "的中なし";
    const axisText = item.axisStats
      ? `軸馬 ${item.axisStats.hits}/${item.axisStats.races}R ${formatRoi(item.axisStats.rate)}`
      : "軸馬 集計待ち";
    return `
      <article class="daily-summary-row${activeClass}">
        <div class="daily-date">
          <strong>${escapeHtml(item.shortDate)}</strong>
          <span>${escapeHtml(item.label)} / ${escapeHtml(item.date)}</span>
        </div>
        <div class="daily-stamp ${escapeHtml(item.resultTone)}" aria-label="日別結果: ${escapeHtml(item.stamp)}">
          ${escapeHtml(item.stamp)}
        </div>
        <div class="daily-main">
          <div class="daily-status">
            <span class="tag ${item.status === "振り返り済み" ? "red" : ""}">${escapeHtml(item.status)}</span>
            <span>${escapeHtml(item.venues)}</span>
            <span>${escapeHtml(hitText)}</span>
          </div>
          <p>${escapeHtml(item.reviewLead)}</p>
        </div>
        <div class="daily-stats">
          <span>${escapeHtml(String(item.raceCount))}R / 投資 ${yen.format(item.stake)}</span>
          <strong>回収率 ${formatRoi(item.roi)}</strong>
          <span>払戻 ${formatYenOrDash(item.payout)}</span>
          <span>${escapeHtml(axisText)}</span>
          <div class="daily-type-rois" aria-label="券種別回収率">
            ${renderTypeRoiPills(item.typeRois)}
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderTypeRoiPills(typeRois) {
  if (!Array.isArray(typeRois)) {
    return "";
  }

  return typeRois.map((item) => `
    <span>${escapeHtml(item.label)} <strong>${formatRoi(item.roi)}</strong></span>
  `).join("");
}

function renderCompactTypeRois(typeRois) {
  if (!Array.isArray(typeRois)) {
    return "";
  }

  return typeRois.map((item) => `
    <span>${escapeHtml(item.shortLabel)} ${formatRoi(item.roi)}</span>
  `).join("");
}

function renderReviewCalendar() {
  const root = byId("reviewCalendar");
  if (!root) {
    return;
  }

  const entries = [...state.dailySummaries].sort((a, b) => a.date.localeCompare(b.date));
  const monthKeys = [...new Set(entries.map((item) => item.date.slice(0, 7)))].sort().reverse();

  if (!monthKeys.length) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = monthKeys.map((monthKey) => {
    const monthEntries = entries.filter((item) => item.date.startsWith(monthKey));
    return renderCalendarMonth(monthKey, monthEntries);
  }).join("");
}

function renderCalendarMonth(monthKey, entries) {
  const [year, month] = monthKey.split("-").map(Number);
  const itemByDate = new Map(entries.map((item) => [item.date, item]));
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const blanks = Array.from({ length: firstWeekday }, () => `<div class="calendar-day is-blank" aria-hidden="true"></div>`);
  const dayCells = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const item = itemByDate.get(date);
    return item ? renderCalendarDay(day, item) : `
      <div class="calendar-day is-empty">
        <span class="calendar-daynum">${escapeHtml(String(day))}</span>
      </div>
    `;
  });

  return `
    <section class="calendar-month" aria-label="${escapeHtml(`${year}年${month}月`)}">
      <h3>${escapeHtml(`${year}年${month}月`)}</h3>
      <div class="calendar-scroll">
        <div class="calendar-grid">
          ${["日", "月", "火", "水", "木", "金", "土"].map((label) => `
            <div class="calendar-weekday">${escapeHtml(label)}</div>
          `).join("")}
          ${blanks.join("")}
          ${dayCells.join("")}
        </div>
      </div>
    </section>
  `;
}

function renderCalendarDay(day, item) {
  const currentClass = item.date === state.date ? " is-current" : "";
  const disabled = item.canOpen ? "" : " disabled";
  return `
    <button class="calendar-day ${escapeHtml(item.resultTone)}${currentClass}" type="button" data-calendar-date="${escapeHtml(item.date)}"${disabled}>
      <span class="calendar-daynum">${escapeHtml(String(day))}</span>
      <span class="calendar-status">${escapeHtml(item.stamp)}</span>
      <strong>${formatRoi(item.roi)}</strong>
      <span class="calendar-date-label">${escapeHtml(item.label)}</span>
      <span class="calendar-type-rois">${renderCompactTypeRois(item.typeRois)}</span>
    </button>
  `;
}

function formatRoi(value) {
  if (value === null) {
    return "--";
  }

  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatYenOrDash(value) {
  return value === null ? "--" : yen.format(value);
}

function formatNumberOrDash(value) {
  return value === null ? "--" : integer.format(value);
}

function renderVisibility() {
  document.querySelectorAll("[data-section]").forEach((section) => {
    const sectionName = section.dataset.section;
    const shouldHide = state.mode !== "all" && state.mode !== sectionName;
    section.classList.toggle("is-hidden", shouldHide);
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

init().catch((error) => {
  console.error(error);
  byId("headline").textContent = "読み込みに失敗しました";
  byId("summary").textContent = "JSONファイルの配置を確認してください。";
});
