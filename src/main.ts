import "./style.css";

type Player = 1 | 2;

const PRESETS = [
  { label: "1h", sec: 3600 },
  { label: "1h15", sec: 4500 },
  { label: "1h30", sec: 5400 },
  { label: "1h45", sec: 6300 },
  { label: "2h", sec: 7200 },
] as const;

const CUSTOM_PRESET_VALUE = "custom";

const COUNTER_SIZE_STORAGE_KEY = "warhammerClock.counterSize";
const COUNTER_SIZE_DEFAULT = "m";

const app = document.querySelector<HTMLDivElement>("#app")!;

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

app.innerHTML = `
  <header class="toolbar">
    <label class="toolbar-presets">
      Counters
      <select id="counter-size" aria-label="Score and command point counter size (Telephone is for vertical phones)">
        <option value="s">Telephone</option>
        <option value="m" selected>Medium</option>
        <option value="l">Large</option>
        <option value="xl">Extra large</option>
        <option value="uw">Ultra wide</option>
      </select>
    </label>
    <label class="toolbar-presets">
      Time
      <select id="preset-time" aria-label="Preset time control">
        ${PRESETS.map((p) => `<option value="${p.sec}">${p.label}</option>`).join("")}
        <option value="${CUSTOM_PRESET_VALUE}">Custom</option>
      </select>
    </label>
    <div id="manual-time-wrap" class="toolbar-manual" hidden>
      <label>
        Player 1 (min)
        <input id="m1" type="number" min="0" max="999" step="1" value="60" />
      </label>
      <label>
        Player 2 (min)
        <input id="m2" type="number" min="0" max="999" step="1" value="60" />
      </label>
    </div>
    <div class="actions">
      <button type="button" class="btn-secondary" id="btn-reset">Reset</button>
      <button type="button" class="btn-icon" id="btn-fullscreen" title="Enter fullscreen" aria-label="Enter fullscreen">
        <span class="fullscreen-icon fullscreen-icon--enter">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
          </svg>
        </span>
        <span class="fullscreen-icon fullscreen-icon--exit" hidden>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
          </svg>
        </span>
      </button>
    </div>
  </header>
  <div class="board">
    <section class="panel panel--a" id="panel-1" data-player="1" tabindex="0" aria-label="Player 1 timer">
      <div class="mini-counter mini-counter--tl">
        <span class="mini-counter__label">Score</span>
        <div class="mini-counter__row">
          <button type="button" class="mini-counter__btn" id="p1-score-minus" aria-label="Player 1 score minus one">−</button>
          <span class="mini-counter__val" id="p1-score-val">0</span>
          <button type="button" class="mini-counter__btn" id="p1-score-plus" aria-label="Player 1 score plus one">+</button>
        </div>
      </div>
      <div class="panel-corner panel-corner--tr">
        <div class="mini-counter">
          <span class="mini-counter__label">Command points</span>
          <div class="mini-counter__row">
            <button type="button" class="mini-counter__btn" id="p1-cp-minus" aria-label="Player 1 command points minus one">−</button>
            <span class="mini-counter__val" id="p1-cp-val">1</span>
            <button type="button" class="mini-counter__btn" id="p1-cp-plus" aria-label="Player 1 command points plus one">+</button>
          </div>
        </div>
        <div class="free-cp-stack" id="p1-free-cp-stack">
          <button type="button" class="free-cp-add" id="p1-free-cp-add" aria-label="Add free command point token for this match">+</button>
          <button type="button" class="free-cp-token" id="p1-free-cp" hidden aria-label="Free command point token">
            <span class="free-cp-token__face" aria-hidden="true">
              <span class="free-cp-token__text">CP</span>
            </span>
          </button>
          <span class="free-cp-caption" id="p1-free-cp-caption">Add free CP for this match</span>
        </div>
      </div>
      <span class="panel-label">Player 1</span>
      <span class="time" id="t1">1:00:00</span>
    </section>
    <div class="turn-tracker" aria-label="Battle round" role="group">
      <div class="turn-tracker__dots" id="turn-dots"></div>
    </div>
    <section class="panel panel--b" id="panel-2" data-player="2" tabindex="0" aria-label="Player 2 timer">
      <div class="mini-counter mini-counter--bl">
        <span class="mini-counter__label">Score</span>
        <div class="mini-counter__row">
          <button type="button" class="mini-counter__btn" id="p2-score-minus" aria-label="Player 2 score minus one">−</button>
          <span class="mini-counter__val" id="p2-score-val">0</span>
          <button type="button" class="mini-counter__btn" id="p2-score-plus" aria-label="Player 2 score plus one">+</button>
        </div>
      </div>
      <div class="panel-corner panel-corner--br">
        <div class="mini-counter">
          <span class="mini-counter__label">Command points</span>
          <div class="mini-counter__row">
            <button type="button" class="mini-counter__btn" id="p2-cp-minus" aria-label="Player 2 command points minus one">−</button>
            <span class="mini-counter__val" id="p2-cp-val">1</span>
            <button type="button" class="mini-counter__btn" id="p2-cp-plus" aria-label="Player 2 command points plus one">+</button>
          </div>
        </div>
        <div class="free-cp-stack" id="p2-free-cp-stack">
          <button type="button" class="free-cp-add" id="p2-free-cp-add" aria-label="Add free command point token for this match">+</button>
          <button type="button" class="free-cp-token" id="p2-free-cp" hidden aria-label="Free command point token">
            <span class="free-cp-token__face" aria-hidden="true">
              <span class="free-cp-token__text">CP</span>
            </span>
          </button>
          <span class="free-cp-caption" id="p2-free-cp-caption">Add free CP for this match</span>
        </div>
      </div>
      <span class="panel-label">Player 2</span>
      <span class="time" id="t2">1:00:00</span>
    </section>
  </div>
  <div class="overlay overlay--turn-confirm" id="turn-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="turn-confirm-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="turn-confirm-title"></h2>
      <p class="overlay-msg" id="turn-confirm-msg"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-turn-confirm-ok">Confirm</button>
        <button type="button" class="btn-secondary" id="btn-turn-confirm-cancel">Cancel</button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--result" id="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="result-title"></h2>
      <p class="overlay-msg overlay-msg--scores" id="result-scores"></p>
      <button type="button" class="btn-primary" id="btn-result-dismiss">OK</button>
    </div>
  </div>
`;

const counterSizeSelect = app.querySelector<HTMLSelectElement>("#counter-size")!;
const presetTime = app.querySelector<HTMLSelectElement>("#preset-time")!;
const manualTimeWrap = app.querySelector<HTMLDivElement>("#manual-time-wrap")!;
const m1 = app.querySelector<HTMLInputElement>("#m1")!;
const m2 = app.querySelector<HTMLInputElement>("#m2")!;
const btnReset = app.querySelector<HTMLButtonElement>("#btn-reset")!;
const btnFullscreen = app.querySelector<HTMLButtonElement>("#btn-fullscreen")!;
const panel1 = app.querySelector<HTMLElement>("#panel-1")!;
const panel2 = app.querySelector<HTMLElement>("#panel-2")!;
const t1 = app.querySelector<HTMLElement>("#t1")!;
const t2 = app.querySelector<HTMLElement>("#t2")!;
const board = app.querySelector<HTMLElement>(".board")!;
const turnDots = app.querySelector<HTMLElement>("#turn-dots")!;
const freeCpStack1 = app.querySelector<HTMLElement>("#p1-free-cp-stack")!;
const freeCpStack2 = app.querySelector<HTMLElement>("#p2-free-cp-stack")!;
const btnFreeCpAdd1 = app.querySelector<HTMLButtonElement>("#p1-free-cp-add")!;
const btnFreeCpAdd2 = app.querySelector<HTMLButtonElement>("#p2-free-cp-add")!;
const btnFreeCp1 = app.querySelector<HTMLButtonElement>("#p1-free-cp")!;
const btnFreeCp2 = app.querySelector<HTMLButtonElement>("#p2-free-cp")!;
const freeCpCaption1 = app.querySelector<HTMLElement>("#p1-free-cp-caption")!;
const freeCpCaption2 = app.querySelector<HTMLElement>("#p2-free-cp-caption")!;
const p1ScoreVal = app.querySelector<HTMLElement>("#p1-score-val")!;
const p2ScoreVal = app.querySelector<HTMLElement>("#p2-score-val")!;
const turnConfirmOverlay = app.querySelector<HTMLElement>("#turn-confirm-overlay")!;
const turnConfirmTitle = app.querySelector<HTMLElement>("#turn-confirm-title")!;
const turnConfirmMsg = app.querySelector<HTMLElement>("#turn-confirm-msg")!;
const btnTurnConfirmOk = app.querySelector<HTMLButtonElement>("#btn-turn-confirm-ok")!;
const btnTurnConfirmCancel = app.querySelector<HTMLButtonElement>("#btn-turn-confirm-cancel")!;
const resultOverlay = app.querySelector<HTMLElement>("#result-overlay")!;
const resultTitle = app.querySelector<HTMLElement>("#result-title")!;
const resultScores = app.querySelector<HTMLElement>("#result-scores")!;
const btnResultDismiss = app.querySelector<HTMLButtonElement>("#btn-result-dismiss")!;

let seconds1 = 3600;
let seconds2 = 3600;
let active: Player = 1;
/** Whose *player turn* it is (battle round). Only Enter / next battle round changes this; Space only switches the chess clock (`active`). */
let turnPlayer: Player = 1;
let running = false;
/** True after Pause mid-match; Space resumes without resetting times from inputs */
let paused = false;
let lastTick = 0;
let raf = 0;
/** First rAF after startLoop: align clock, don’t subtract (avoids a visible second jump) */
let alignFirstTick = false;

const MAX_TICK_ELAPSED_SEC = 0.2;

/** Last Space keydown (ms); used for double-tap pause */
let lastSpaceTime = 0;
/** Active player before the first Space of a potential double-tap (restored on double-pause) */
let activeBeforeSpaceSequence: Player = 1;
const DOUBLE_SPACE_MS = 380;

const MAX_GAME_TURN = 5;

/** Current battle round (1–5). Each round has P1’s turn then P2’s; advancing the round puts P1 on the clock. */
let currentGameTurn = 1;

let score1 = 0;
let score2 = 0;
let cp1 = 1;
let cp2 = 1;
let scoreByRound1 = Array<number>(MAX_GAME_TURN).fill(0);
let scoreByRound2 = Array<number>(MAX_GAME_TURN).fill(0);

const MAX_PANEL_SCORE = 999;
const MAX_PANEL_CP = 30;

/** True after the free CP token was used; reset on a new battle round (not on clock switches). */
/** Click + before Start to include the free CP token for this match (per player). */
let freeCpPreStartOptIn1 = false;
let freeCpPreStartOptIn2 = false;
/** Locked when Start is pressed; if false, that player has no free CP for the whole match. */
let freeCpInMatch1 = false;
let freeCpInMatch2 = false;
let freeCpConsumed1 = false;
let freeCpConsumed2 = false;

type TurnConfirmKind = "start-game" | "p1-to-p2" | "next-round" | "finish-game";

let turnConfirmKind: TurnConfirmKind | null = null;

function hideTurnConfirmModal(): void {
  turnConfirmKind = null;
  turnConfirmOverlay.classList.remove("is-visible");
  turnConfirmOverlay.setAttribute("aria-hidden", "true");
}

function hideResultOverlay(): void {
  resultOverlay.classList.remove("is-visible");
  resultOverlay.setAttribute("aria-hidden", "true");
  panel1.classList.remove("is-flag");
  panel2.classList.remove("is-flag");
}

function openTurnConfirmModal(kind: TurnConfirmKind): void {
  turnConfirmKind = kind;
  if (kind === "start-game") {
    turnConfirmTitle.textContent = "Start game?";
    turnConfirmMsg.textContent = "The game is about to start. Press Confirm to launch the first timer.";
  } else if (kind === "p1-to-p2") {
    turnConfirmTitle.textContent = "Pass to Player 2 ?";
    turnConfirmMsg.textContent =
      "Player 2 will have the player turn.";
  } else if (kind === "finish-game") {
    turnConfirmTitle.textContent = "Finish the game?";
    turnConfirmMsg.textContent =
      "This was the last turn of the final battle round. Ready to end the match and compare scores?";
  } else {
    const nextRound = currentGameTurn + 1;
    turnConfirmTitle.textContent = `Enter battle round ${nextRound} ?`;
    turnConfirmMsg.textContent = `Start battle round ${nextRound} ?`;
  }
  turnConfirmOverlay.classList.add("is-visible");
  turnConfirmOverlay.setAttribute("aria-hidden", "false");
  btnTurnConfirmOk.focus();
}

function showResultOverlay(heading: string, scoresBlock?: string): void {
  resultTitle.textContent = heading;
  resultScores.textContent =
    scoresBlock ?? `Player 1 — ${score1} points\nPlayer 2 — ${score2} points`;
  resultOverlay.classList.add("is-visible");
  resultOverlay.setAttribute("aria-hidden", "false");
  btnResultDismiss.focus();
}

function finishGameByScore(): void {
  running = false;
  paused = true;
  lastSpaceTime = 0;
  stopLoop();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
  let heading: string;
  if (score1 > score2) heading = "Player 1 wins !";
  else if (score2 > score1) heading = "Player 2 wins !";
  else heading = "Draw — tied score";
  showResultOverlay(heading);
}

function applyTurnConfirm(): void {
  if (turnConfirmKind === null) return;
  const kind = turnConfirmKind;
  hideTurnConfirmModal();
  if (kind === "start-game") {
    start();
    return;
  }
  if (kind === "p1-to-p2") {
    turnPlayer = 2;
    gainCpBothPlayers();
    if (active !== 2) {
      active = 2;
      if (running) lastTick = performance.now();
    }
    setActivePanels();
    return;
  }
  if (kind === "finish-game") {
    finishGameByScore();
    return;
  }
  advanceGameTurn();
}

function readMinutes(): { a: number; b: number } {
  return {
    a: Math.max(0, Number(m1.value) || 0),
    b: Math.max(0, Number(m2.value) || 0),
  };
}

const COUNTER_SIZES = new Set(["s", "m", "l", "xl", "uw"]);

function applyCounterSize(size: string): void {
  const v = COUNTER_SIZES.has(size) ? size : COUNTER_SIZE_DEFAULT;
  app.dataset.counterSize = v;
  try {
    localStorage.setItem(COUNTER_SIZE_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
}

function loadCounterSize(): void {
  let stored = COUNTER_SIZE_DEFAULT;
  try {
    stored = localStorage.getItem(COUNTER_SIZE_STORAGE_KEY) ?? COUNTER_SIZE_DEFAULT;
  } catch {
    /* ignore */
  }
  if (!COUNTER_SIZES.has(stored)) stored = COUNTER_SIZE_DEFAULT;
  counterSizeSelect.value = stored;
  applyCounterSize(stored);
}

function updateManualInputsVisibility(): void {
  manualTimeWrap.hidden = presetTime.value !== CUSTOM_PRESET_VALUE;
}

function syncPresetSelectFromState(): void {
  if (seconds1 !== seconds2) {
    presetTime.value = CUSTOM_PRESET_VALUE;
    updateManualInputsVisibility();
    return;
  }
  const match = PRESETS.find((p) => p.sec === seconds1);
  presetTime.value = match ? String(match.sec) : CUSTOM_PRESET_VALUE;
  updateManualInputsVisibility();
}

function applyPresetSeconds(totalSeconds: number): void {
  const min = Math.round(totalSeconds / 60);
  m1.value = String(min);
  m2.value = String(min);
  seconds1 = totalSeconds;
  seconds2 = totalSeconds;
  applyTimesToDisplay();
  syncPresetSelectFromState();
}

function syncInputsFromState(): void {
  m1.value = String(Math.round(seconds1 / 60));
  m2.value = String(Math.round(seconds2 / 60));
}

function applyTimesToDisplay(): void {
  t1.textContent = formatTime(seconds1);
  t2.textContent = formatTime(seconds2);
}

function setActivePanels(): void {
  if (!running) {
    panel1.classList.remove("is-active", "is-idle", "is-turn");
    panel2.classList.remove("is-active", "is-idle", "is-turn");
    return;
  }
  const activePanel = active === 1 ? panel1 : panel2;
  const idlePanel = active === 1 ? panel2 : panel1;
  activePanel.classList.add("is-active");
  activePanel.classList.remove("is-idle");
  idlePanel.classList.remove("is-active");
  idlePanel.classList.add("is-idle");
  panel1.classList.toggle("is-turn", turnPlayer === 1);
  panel2.classList.toggle("is-turn", turnPlayer === 2);
}

function setInputsEnabled(on: boolean): void {
  presetTime.disabled = !on;
  m1.disabled = !on;
  m2.disabled = !on;
}

function updateButtons(): void {
  /* Start / pause are keyboard-driven only (Enter / Space / double-space). */
  app.classList.toggle("match-started", running || paused);
}

function tick(now: number): void {
  if (!running) return;
  if (alignFirstTick) {
    lastTick = now;
    alignFirstTick = false;
    raf = requestAnimationFrame(tick);
    return;
  }
  const rawElapsed = (now - lastTick) / 1000;
  lastTick = now;
  const elapsed = Math.min(rawElapsed, MAX_TICK_ELAPSED_SEC);

  if (active === 1) {
    seconds1 -= elapsed;
    if (seconds1 <= 0) {
      seconds1 = 0;
      endGame(2);
      return;
    }
  } else {
    seconds2 -= elapsed;
    if (seconds2 <= 0) {
      seconds2 = 0;
      endGame(1);
      return;
    }
  }

  applyTimesToDisplay();
  raf = requestAnimationFrame(tick);
}

function startLoop(): void {
  cancelAnimationFrame(raf);
  lastTick = performance.now();
  alignFirstTick = true;
  raf = requestAnimationFrame(tick);
}

function stopLoop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  alignFirstTick = false;
}

function switchTurn(): void {
  if (!running) return;
  active = active === 1 ? 2 : 1;
  setActivePanels();
  lastTick = performance.now();
}

function endGame(winner: Player): void {
  running = false;
  paused = true;
  lastSpaceTime = 0;
  stopLoop();
  hideTurnConfirmModal();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
  applyTimesToDisplay();
  syncPresetSelectFromState();
  const loser: Player = winner === 1 ? 2 : 1;
  showResultOverlay(
    "Game over",
    `Player ${loser} ran out of time.\n\nPlayer ${winner} wins!\n\nPlayer 1 — ${score1} points\nPlayer 2 — ${score2} points`,
  );
  panel1.classList.toggle("is-flag", seconds1 <= 0);
  panel2.classList.toggle("is-flag", seconds2 <= 0);
}

function start(): void {
  hideTurnConfirmModal();
  hideResultOverlay();
  paused = false;
  const { a, b } = readMinutes();
  seconds1 = a * 60;
  seconds2 = b * 60;
  if (seconds1 <= 0 || seconds2 <= 0) return;
  active = 1;
  turnPlayer = 1;
  lastSpaceTime = 0;
  running = true;
  freeCpInMatch1 = freeCpPreStartOptIn1;
  freeCpInMatch2 = freeCpPreStartOptIn2;
  freeCpConsumed1 = false;
  freeCpConsumed2 = false;
  cp1 = 1;
  cp2 = 1;
  renderMiniCounters();
  renderFreeCpTokens();
  setInputsEnabled(false);
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
  startLoop();
}

function pause(): void {
  running = false;
  paused = true;
  lastSpaceTime = 0;
  stopLoop();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
}

function reset(): void {
  running = false;
  paused = false;
  lastSpaceTime = 0;
  stopLoop();
  hideTurnConfirmModal();
  hideResultOverlay();
  currentGameTurn = 1;
  const { a, b } = readMinutes();
  seconds1 = a * 60;
  seconds2 = b * 60;
  active = 1;
  turnPlayer = 1;
  panel1.classList.remove("is-flag");
  panel2.classList.remove("is-flag");
  setInputsEnabled(true);
  applyTimesToDisplay();
  syncPresetSelectFromState();
  setActivePanels();
  updateButtons();
  renderTurnDots();
  score1 = 0;
  score2 = 0;
  scoreByRound1 = Array<number>(MAX_GAME_TURN).fill(0);
  scoreByRound2 = Array<number>(MAX_GAME_TURN).fill(0);
  cp1 = 1;
  cp2 = 1;
  renderMiniCounters();
  freeCpPreStartOptIn1 = false;
  freeCpPreStartOptIn2 = false;
  freeCpInMatch1 = false;
  freeCpInMatch2 = false;
  freeCpConsumed1 = false;
  freeCpConsumed2 = false;
  renderFreeCpTokens();
}

function renderMiniCounters(): void {
  p1ScoreVal.textContent = String(score1);
  p2ScoreVal.textContent = String(score2);
  app.querySelector<HTMLElement>("#p1-cp-val")!.textContent = String(cp1);
  app.querySelector<HTMLElement>("#p2-cp-val")!.textContent = String(cp2);
  updateVisibleScoreTooltip();
}

const scoreTooltipEl = document.createElement("div");
scoreTooltipEl.className = "score-tooltip";
scoreTooltipEl.hidden = true;
document.body.appendChild(scoreTooltipEl);
let activeScoreTooltipTarget: HTMLElement | null = null;

function placeScoreTooltip(target: HTMLElement): void {
  const PAD = 8;
  const GAP = 10;
  const r = target.getBoundingClientRect();
  const t = scoreTooltipEl.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(PAD, Math.min(left, window.innerWidth - t.width - PAD));
  let top = r.top - t.height - GAP;
  if (top < PAD) top = Math.min(window.innerHeight - t.height - PAD, r.bottom + GAP);
  scoreTooltipEl.style.left = `${left}px`;
  scoreTooltipEl.style.top = `${top}px`;
}

function showScoreTooltip(target: HTMLElement): void {
  const player: Player = target === p1ScoreVal ? 1 : 2;
  renderScoreTooltipContent(player);
  scoreTooltipEl.hidden = false;
  scoreTooltipEl.classList.add("is-visible");
  activeScoreTooltipTarget = target;
  placeScoreTooltip(target);
}

function hideScoreTooltip(): void {
  scoreTooltipEl.classList.remove("is-visible");
  scoreTooltipEl.hidden = true;
  activeScoreTooltipTarget = null;
}

function bindScoreTooltip(target: HTMLElement): void {
  target.addEventListener("mouseenter", () => showScoreTooltip(target));
  target.addEventListener("mousemove", () => placeScoreTooltip(target));
  target.addEventListener("mouseleave", hideScoreTooltip);
}

function renderScoreTooltipContent(player: Player): void {
  const rounds = player === 1 ? scoreByRound1 : scoreByRound2;
  scoreTooltipEl.innerHTML = "";
  for (let i = 0; i < MAX_GAME_TURN; i++) {
    const row = document.createElement("div");
    row.className = "score-tooltip__row";
    const isCurrent = i + 1 === currentGameTurn;
    if (isCurrent) row.classList.add("is-current");

    const label = document.createElement("span");
    const n = rounds[i];
    label.textContent = `Round ${i + 1}: ${n} point${n === 1 ? "" : "s"}`;
    row.appendChild(label);

    if (isCurrent) {
      const marker = document.createElement("span");
      marker.className = "score-tooltip__current-marker";
      marker.textContent = "←";
      marker.setAttribute("aria-hidden", "true");
      row.appendChild(marker);
    }
    scoreTooltipEl.appendChild(row);
  }
}

function updateVisibleScoreTooltip(): void {
  if (!activeScoreTooltipTarget || scoreTooltipEl.hidden) return;
  const player: Player = activeScoreTooltipTarget === p1ScoreVal ? 1 : 2;
  renderScoreTooltipContent(player);
  placeScoreTooltip(activeScoreTooltipTarget);
}

function isFreeCpStackHidden(player: Player): boolean {
  const inMatch = player === 1 ? freeCpInMatch1 : freeCpInMatch2;
  const consumed = player === 1 ? freeCpConsumed1 : freeCpConsumed2;
  if (!running && !paused) return false;
  return !inMatch || consumed;
}

function renderFreeCpTokens(): void {
  freeCpStack1.classList.toggle("is-hidden", isFreeCpStackHidden(1));
  freeCpStack2.classList.toggle("is-hidden", isFreeCpStackHidden(2));

  const idleBeforeStart = !running && !paused;
  const showAdd1 = idleBeforeStart && !freeCpPreStartOptIn1;
  const showAdd2 = idleBeforeStart && !freeCpPreStartOptIn2;
  btnFreeCpAdd1.hidden = !showAdd1;
  btnFreeCp1.hidden = showAdd1;
  btnFreeCpAdd2.hidden = !showAdd2;
  btnFreeCp2.hidden = showAdd2;

  const preview1 = idleBeforeStart && freeCpPreStartOptIn1;
  const preview2 = idleBeforeStart && freeCpPreStartOptIn2;
  btnFreeCp1.classList.toggle("free-cp-token--prestart", preview1);
  btnFreeCp2.classList.toggle("free-cp-token--prestart", preview2);

  btnFreeCp1.setAttribute("aria-label", "Free command point token");
  btnFreeCp2.setAttribute("aria-label", "Free command point token");

  freeCpCaption1.textContent =
    showAdd1 || preview1 ? "Add free CP for this match" : "Free command point";
  freeCpCaption2.textContent =
    showAdd2 || preview2 ? "Add free CP for this match" : "Free command point";
}

function optInFreeCpBeforeStart(player: Player): void {
  if (running || paused) return;
  if (player === 1) freeCpPreStartOptIn1 = true;
  else freeCpPreStartOptIn2 = true;
  renderFreeCpTokens();
}

function optOutFreeCpBeforeStart(player: Player): void {
  if (running || paused) return;
  if (player === 1) freeCpPreStartOptIn1 = false;
  else freeCpPreStartOptIn2 = false;
  renderFreeCpTokens();
}

function handleFreeCpTokenClick(player: Player): void {
  const idleBeforeStart = !running && !paused;
  const preview =
    player === 1 ? idleBeforeStart && freeCpPreStartOptIn1 : idleBeforeStart && freeCpPreStartOptIn2;
  if (preview) {
    optOutFreeCpBeforeStart(player);
    return;
  }
  spendFreeCpToken(player);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const FREE_CP_ANIM_MS = 900;

function spendFreeCpToken(player: Player): void {
  if (!running && !paused) return;
  if (player === 1 && !freeCpInMatch1) return;
  if (player === 2 && !freeCpInMatch2) return;
  if (player === 1 && freeCpConsumed1) return;
  if (player === 2 && freeCpConsumed2) return;
  const btn = player === 1 ? btnFreeCp1 : btnFreeCp2;
  if (btn.classList.contains("is-animating")) return;

  const face = btn.querySelector<HTMLElement>(".free-cp-token__face")!;
  let completed = false;
  let fallbackTimer = 0;

  function finish(): void {
    if (completed) return;
    completed = true;
    window.clearTimeout(fallbackTimer);
    btn.classList.remove("is-animating");
    face.removeEventListener("animationend", onEnd);
    if (player === 1) freeCpConsumed1 = true;
    else freeCpConsumed2 = true;
    renderFreeCpTokens();
  }

  function onEnd(e: AnimationEvent): void {
    const n = e.animationName;
    /* WebKit sometimes omits or prefixes the name; empty means “this element’s animation” */
    if (n && !n.includes("freeCpTokenFlipFade")) return;
    finish();
  }

  if (prefersReducedMotion()) {
    finish();
    return;
  }

  btn.classList.add("is-animating");
  face.addEventListener("animationend", onEnd);
  fallbackTimer = window.setTimeout(() => finish(), FREE_CP_ANIM_MS);
}

function clampPanelScore(n: number): number {
  return Math.max(0, Math.min(MAX_PANEL_SCORE, n));
}

function adjustScore(player: Player, delta: number): void {
  if (delta === 0) return;
  const current = player === 1 ? score1 : score2;
  const next = clampPanelScore(current + delta);
  const appliedDelta = next - current;
  if (appliedDelta === 0) return;
  const roundIdx = Math.max(0, Math.min(MAX_GAME_TURN - 1, currentGameTurn - 1));
  if (player === 1) {
    score1 = next;
    scoreByRound1[roundIdx] = clampPanelScore(scoreByRound1[roundIdx] + appliedDelta);
  } else {
    score2 = next;
    scoreByRound2[roundIdx] = clampPanelScore(scoreByRound2[roundIdx] + appliedDelta);
  }
  renderMiniCounters();
}

function clampPanelCp(n: number): number {
  return Math.max(0, Math.min(MAX_PANEL_CP, n));
}

/** Both players gain 1 CP when a new player turn or battle round begins (Enter confirmed). */
function gainCpBothPlayers(): void {
  cp1 = clampPanelCp(cp1 + 1);
  cp2 = clampPanelCp(cp2 + 1);
  renderMiniCounters();
}

const miniCounterActions: [string, () => void][] = [
  ["p1-score-minus", () => { adjustScore(1, -1); }],
  ["p1-score-plus", () => { adjustScore(1, 1); }],
  ["p1-cp-minus", () => { cp1 = clampPanelCp(cp1 - 1); renderMiniCounters(); }],
  ["p1-cp-plus", () => { cp1 = clampPanelCp(cp1 + 1); renderMiniCounters(); }],
  ["p2-score-minus", () => { adjustScore(2, -1); }],
  ["p2-score-plus", () => { adjustScore(2, 1); }],
  ["p2-cp-minus", () => { cp2 = clampPanelCp(cp2 - 1); renderMiniCounters(); }],
  ["p2-cp-plus", () => { cp2 = clampPanelCp(cp2 + 1); renderMiniCounters(); }],
];
for (const [id, handler] of miniCounterActions) {
  app.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener("click", handler);
}

btnFreeCpAdd1.addEventListener("click", () => optInFreeCpBeforeStart(1));
btnFreeCpAdd2.addEventListener("click", () => optInFreeCpBeforeStart(2));
btnFreeCp1.addEventListener("click", () => handleFreeCpTokenClick(1));
btnFreeCp2.addEventListener("click", () => handleFreeCpTokenClick(2));

function renderTurnDots(): void {
  turnDots.innerHTML = "";
  for (let i = 1; i <= MAX_GAME_TURN; i++) {
    const dot = document.createElement("span");
    dot.className = "turn-dot";
    dot.setAttribute("role", "img");
    dot.setAttribute(
      "aria-label",
      `Battle round ${i}${i === currentGameTurn ? ", current" : i < currentGameTurn ? ", completed" : ", not started"}`,
    );
    if (i < currentGameTurn) dot.classList.add("turn-dot--past");
    else if (i === currentGameTurn) dot.classList.add("turn-dot--current");
    else dot.classList.add("turn-dot--future");
    turnDots.appendChild(dot);
  }
}

function advanceGameTurn(): void {
  if (currentGameTurn >= MAX_GAME_TURN) return;
  currentGameTurn += 1;
  renderMiniCounters();
  active = 1;
  turnPlayer = 1;
  gainCpBothPlayers();
  lastSpaceTime = 0;
  activeBeforeSpaceSequence = 1;
  freeCpConsumed1 = false;
  freeCpConsumed2 = false;
  renderFreeCpTokens();
  if (running) lastTick = performance.now();
  setActivePanels();
  renderTurnDots();
}

function toggleFullscreen(): void {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen();
  } else {
    void document.exitFullscreen();
  }
}

function resume(): void {
  if (running) return;
  hideResultOverlay();
  if (seconds1 <= 0 || seconds2 <= 0) return;
  lastSpaceTime = 0;
  paused = false;
  running = true;
  setInputsEnabled(false);
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
  startLoop();
}

btnReset.addEventListener("click", reset);
btnFullscreen.addEventListener("click", toggleFullscreen);
btnTurnConfirmOk.addEventListener("click", applyTurnConfirm);
btnTurnConfirmCancel.addEventListener("click", hideTurnConfirmModal);
btnResultDismiss.addEventListener("click", hideResultOverlay);
bindScoreTooltip(p1ScoreVal);
bindScoreTooltip(p2ScoreVal);
window.addEventListener("scroll", hideScoreTooltip, true);
window.addEventListener("resize", hideScoreTooltip);

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function shouldIgnoreSpaceLike(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest(".mini-counter")) return true;
  if (el.closest(".free-cp-stack")) return true;
  return isTypingTarget(el);
}

function isButtonTarget(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest("button");
}

/** Space bar and taps on the timer area (same behavior) */
function handleSpaceLikeInput(): void {
  if (!running) {
    if (paused) resume();
    else return;
    return;
  }

  const now = performance.now();
  if (lastSpaceTime > 0 && now - lastSpaceTime < DOUBLE_SPACE_MS) {
    active = activeBeforeSpaceSequence;
    pause();
    return;
  }
  activeBeforeSpaceSequence = active;
  lastSpaceTime = now;
  switchTurn();
}

window.addEventListener("keydown", (e) => {
  if ((e.code === "Enter" || e.code === "Space") && isButtonTarget(e.target)) {
    /* Keep Enter/Space bound to global turn/timer shortcuts, not focused button activation. */
    e.preventDefault();
  }
  if (resultOverlay.classList.contains("is-visible")) {
    if (e.code === "Enter" && !e.repeat) {
      e.preventDefault();
      hideResultOverlay();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideResultOverlay();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      return;
    }
  }
  if (turnConfirmOverlay.classList.contains("is-visible")) {
    if (e.code === "Enter" && !e.repeat) {
      e.preventDefault();
      applyTurnConfirm();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideTurnConfirmModal();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      return;
    }
  }
  if (e.code === "Enter" && !e.repeat) {
    if (shouldIgnoreSpaceLike(e.target)) return;
    if (!running) {
      e.preventDefault();
      if (paused) handleSpaceLikeInput();
      else openTurnConfirmModal("start-game");
      return;
    }
    if (turnPlayer === 1) {
      e.preventDefault();
      openTurnConfirmModal("p1-to-p2");
      return;
    }
    e.preventDefault();
    if (currentGameTurn >= MAX_GAME_TURN) {
      openTurnConfirmModal("finish-game");
      return;
    }
    openTurnConfirmModal("next-round");
    return;
  }
  if (e.code !== "Space") return;
  if (e.repeat) return;
  if (resultOverlay.classList.contains("is-visible")) return;
  if (turnConfirmOverlay.classList.contains("is-visible")) return;
  if (shouldIgnoreSpaceLike(e.target)) return;
  e.preventDefault();
  handleSpaceLikeInput();
});

app.addEventListener("pointerup", (e) => {
  if (e.pointerType !== "mouse") return;
  const btn = (e.target as HTMLElement).closest("button");
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.blur();
});

board.addEventListener("pointerdown", (e) => {
  /* Touch / pen only — mouse clicks use Start / Space, not board taps */
  if (e.pointerType === "mouse") return;
  if (resultOverlay.classList.contains("is-visible")) return;
  if (turnConfirmOverlay.classList.contains("is-visible")) return;
  if ((e.target as HTMLElement).closest(".turn-tracker")) return;
  if ((e.target as HTMLElement).closest(".mini-counter")) return;
  if ((e.target as HTMLElement).closest(".free-cp-stack")) return;
  if (shouldIgnoreSpaceLike(e.target)) return;
  e.preventDefault();
  handleSpaceLikeInput();
});

presetTime.addEventListener("change", () => {
  if (running) return;
  const v = presetTime.value;
  if (v === CUSTOM_PRESET_VALUE) {
    updateManualInputsVisibility();
    return;
  }
  applyPresetSeconds(Number(v));
});

[m1, m2].forEach((input) => {
  input.addEventListener("input", () => {
    if (running) return;
    const { a, b } = readMinutes();
    seconds1 = a * 60;
    seconds2 = b * 60;
    applyTimesToDisplay();
    syncPresetSelectFromState();
  });
});

counterSizeSelect.addEventListener("change", () => {
  applyCounterSize(counterSizeSelect.value);
});

presetTime.value = String(PRESETS[0].sec);
loadCounterSize();
updateManualInputsVisibility();
applyTimesToDisplay();
setActivePanels();
updateButtons();
renderTurnDots();
renderMiniCounters();
renderFreeCpTokens();

function syncFullscreenLabel(): void {
  const inFs = !!document.fullscreenElement;
  const enter = btnFullscreen.querySelector<HTMLElement>(".fullscreen-icon--enter");
  const exit = btnFullscreen.querySelector<HTMLElement>(".fullscreen-icon--exit");
  if (enter) enter.hidden = inFs;
  if (exit) exit.hidden = !inFs;
  const label = inFs ? "Exit fullscreen" : "Enter fullscreen";
  btnFullscreen.title = label;
  btnFullscreen.setAttribute("aria-label", label);
}

document.addEventListener("fullscreenchange", syncFullscreenLabel);
syncFullscreenLabel();
