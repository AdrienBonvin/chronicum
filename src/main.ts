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
const DEFAULT_TIME_SEC = 7200;

type ScoreKind = "primary" | "secondary";

const SCORE_KINDS: { kind: ScoreKind; label: string }[] = [
  { kind: "primary", label: "Primary" },
  { kind: "secondary", label: "Secondary" },
];

/** CP effects given by a unit or a character */
type AbilityKind = "discount" | "round-cp" | "turn-cp";

const ABILITY_KINDS: Record<AbilityKind, { title: string; hint: string; short: string }> = {
  discount: { title: "−1 CP", hint: "Stratagem, once per round", short: "−1 CP stratagem" },
  "round-cp": { title: "+1 CP", hint: "Start of each battle round", short: "+1 CP / round" },
  "turn-cp": { title: "+1 CP", hint: "Start of my turn", short: "+1 CP / my turn" },
};

type Ability = {
  id: number;
  kind: AbilityKind;
  name: string;
  /** Its character is gone; a reset brings it back for the next game */
  lost: boolean;
  /** Discount only: already used this battle round */
  spent: boolean;
};

/** Key kept from the former "Counters" setting so saved choices survive the rename */
const UI_SIZE_STORAGE_KEY = "warhammerClock.counterSize";
const UI_SIZE_DEFAULT = "m";

const LAYOUT_STORAGE_KEY = "warhammerClock.layout";
const LAYOUT_DEFAULT = "rows";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Always H:MM:SS so the clock keeps the same width when it drops under an hour. */
function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function scoreCounterHtml(player: Player, corner: "tl" | "bl"): string {
  const rows = SCORE_KINDS.map(
    ({ kind, label }) => `
        <div class="score-box__row">
          <span class="score-box__kind">${label}</span>
          <button type="button" class="mini-counter__btn" id="p${player}-${kind}-minus" aria-label="Player ${player} ${kind} minus one">−</button>
          <span class="mini-counter__val" id="p${player}-${kind}-val">0</span>
          <button type="button" class="mini-counter__btn" id="p${player}-${kind}-plus" aria-label="Player ${player} ${kind} plus one">+</button>
        </div>`,
  ).join("");
  return `
      <div class="mini-counter mini-counter--${corner} score-box">
        <div class="score-box__head">
          <span class="mini-counter__label">Score</span>
          <span class="score-box__total" id="p${player}-score-total">0</span>
        </div>${rows}
      </div>`;
}

function cpCornerHtml(player: Player, corner: "tr" | "br"): string {
  return `
      <div class="panel-corner panel-corner--${corner}">
        <div class="mini-counter cp-box">
          <span class="mini-counter__label">Command points</span>
          <div class="mini-counter__row">
            <button type="button" class="mini-counter__btn" id="p${player}-cp-minus" aria-label="Player ${player} command points minus one">−</button>
            <span class="mini-counter__val" id="p${player}-cp-val">1</span>
            <button type="button" class="mini-counter__btn" id="p${player}-cp-plus" aria-label="Player ${player} command points plus one">+</button>
          </div>
          <span class="cp-toast" id="p${player}-cp-toast" role="status"></span>
        </div>
        <div class="abilities" id="p${player}-abilities"></div>
        <button type="button" class="abilities-btn" id="p${player}-abilities-btn">Abilities</button>
      </div>`;
}

app.innerHTML = `
  <header class="toolbar">
    <label class="toolbar-presets">
      Layout
      <select id="layout" aria-label="Screen split between the two players">
        <option value="rows" selected>Top / bottom</option>
        <option value="columns">Left / right</option>
      </select>
    </label>
    <label class="toolbar-presets">
      Interface size
      <select id="ui-size" aria-label="Size of the counters, dialogs and tooltips">
        <option value="s">Compact</option>
        <option value="m" selected>Standard</option>
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
        <input id="m1" type="number" min="0" max="999" step="1" value="${DEFAULT_TIME_SEC / 60}" />
      </label>
      <label>
        Player 2 (min)
        <input id="m2" type="number" min="0" max="999" step="1" value="${DEFAULT_TIME_SEC / 60}" />
      </label>
    </div>
    <label class="toolbar-toggle">
      <input type="checkbox" id="photo-breaks" />
      Photo breaks
    </label>
    <div class="actions">
      <button type="button" class="btn-ghost" id="btn-reset">Reset</button>
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
      ${scoreCounterHtml(1, "tl")}
      ${cpCornerHtml(1, "tr")}
      <div class="panel-head">
        <span class="panel-label">Player 1</span>
        <span class="panel-turn">Player turn</span>
      </div>
      <span class="time" id="t1">1:00:00</span>
    </section>
    <div class="turn-tracker">
      <div class="turn-tracker__round" aria-label="Battle round" role="group">
        <span class="turn-tracker__label" aria-hidden="true">Round</span>
        <div class="turn-tracker__dots" id="turn-dots"></div>
      </div>
      <p class="key-hint" id="key-hint" aria-live="polite"></p>
    </div>
    <section class="panel panel--b" id="panel-2" data-player="2" tabindex="0" aria-label="Player 2 timer">
      ${scoreCounterHtml(2, "bl")}
      ${cpCornerHtml(2, "br")}
      <div class="panel-head">
        <span class="panel-label">Player 2</span>
        <span class="panel-turn">Player turn</span>
      </div>
      <span class="time" id="t2">1:00:00</span>
    </section>
  </div>
  <div class="overlay overlay--turn-confirm" id="turn-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="turn-confirm-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="turn-confirm-title"></h2>
      <p class="overlay-msg" id="turn-confirm-msg"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="btn-turn-confirm-cancel">Cancel <kbd>Esc</kbd></button>
        <button type="button" class="btn-primary" id="btn-turn-confirm-ok">Confirm <kbd>Enter</kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--result" id="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="result-title"></h2>
      <p class="overlay-msg" id="result-msg"></p>
      <table class="result-table" id="result-table"></table>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-result-dismiss">OK <kbd>Enter</kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--photo" id="photo-overlay" role="dialog" aria-modal="true" aria-labelledby="photo-title" aria-hidden="true">
    <div class="photo-flash" aria-hidden="true"></div>
    <div class="overlay-inner">
      <svg class="photo-icon" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 20V4h16M76 4h16v16M92 76v16H76M20 92H4V76" stroke-linecap="square" />
        <path d="M24 38h10l4-6h20l4 6h10v30H24z" />
        <circle cx="48" cy="52" r="9" />
      </svg>
      <span class="pause-badge">Clocks paused</span>
      <h2 id="photo-title">Photo time</h2>
      <p class="overlay-msg" id="photo-msg"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-photo-resume">Resume clocks <kbd>Enter</kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--abilities" id="abilities-overlay" role="dialog" aria-modal="true" aria-labelledby="abilities-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="abilities-title"></h2>
      <p class="overlay-msg">CP effects of your units. Mark one as lost when its character dies. Abilities give at most 1 CP per battle round.</p>
      <ul class="ability-list" id="ability-list"></ul>
      <div class="ability-add">
        <span class="ability-add__label">Add an ability</span>
        <input type="text" id="ability-name" maxlength="24" placeholder="Unit or character (optional)" autocomplete="off" />
        <div class="ability-add__kinds">
          ${(Object.keys(ABILITY_KINDS) as AbilityKind[])
            .map(
              (kind) =>
                `<button type="button" class="ability-kind" data-kind="${kind}"><span class="ability-kind__title">${ABILITY_KINDS[kind].title}</span><span class="ability-kind__hint">${ABILITY_KINDS[kind].hint}</span></button>`,
            )
            .join("")}
        </div>
      </div>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-abilities-close">Done <kbd>Esc</kbd></button>
      </div>
    </div>
  </div>
`;

const layoutSelect = app.querySelector<HTMLSelectElement>("#layout")!;
const uiSizeSelect = app.querySelector<HTMLSelectElement>("#ui-size")!;
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
const keyHint = app.querySelector<HTMLElement>("#key-hint")!;
const abilitiesEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-abilities")!,
  2: app.querySelector<HTMLElement>("#p2-abilities")!,
};
const cpToastEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-cp-toast")!,
  2: app.querySelector<HTMLElement>("#p2-cp-toast")!,
};
const abilitiesOverlay = app.querySelector<HTMLElement>("#abilities-overlay")!;
const abilitiesTitle = app.querySelector<HTMLElement>("#abilities-title")!;
const abilityList = app.querySelector<HTMLUListElement>("#ability-list")!;
const abilityNameInput = app.querySelector<HTMLInputElement>("#ability-name")!;
const btnAbilitiesClose = app.querySelector<HTMLButtonElement>("#btn-abilities-close")!;
const scoreTotalEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-score-total")!,
  2: app.querySelector<HTMLElement>("#p2-score-total")!,
};
const photoBreaksToggle = app.querySelector<HTMLInputElement>("#photo-breaks")!;
const photoOverlay = app.querySelector<HTMLElement>("#photo-overlay")!;
const photoMsg = app.querySelector<HTMLElement>("#photo-msg")!;
const btnPhotoResume = app.querySelector<HTMLButtonElement>("#btn-photo-resume")!;
const p1CpVal = app.querySelector<HTMLElement>("#p1-cp-val")!;
const p2CpVal = app.querySelector<HTMLElement>("#p2-cp-val")!;
const turnConfirmOverlay = app.querySelector<HTMLElement>("#turn-confirm-overlay")!;
const turnConfirmTitle = app.querySelector<HTMLElement>("#turn-confirm-title")!;
const turnConfirmMsg = app.querySelector<HTMLElement>("#turn-confirm-msg")!;
const btnTurnConfirmOk = app.querySelector<HTMLButtonElement>("#btn-turn-confirm-ok")!;
const btnTurnConfirmCancel = app.querySelector<HTMLButtonElement>("#btn-turn-confirm-cancel")!;
const resultOverlay = app.querySelector<HTMLElement>("#result-overlay")!;
const resultTitle = app.querySelector<HTMLElement>("#result-title")!;
const resultMsg = app.querySelector<HTMLElement>("#result-msg")!;
const resultTable = app.querySelector<HTMLTableElement>("#result-table")!;
const btnResultDismiss = app.querySelector<HTMLButtonElement>("#btn-result-dismiss")!;

let seconds1 = DEFAULT_TIME_SEC;
let seconds2 = DEFAULT_TIME_SEC;
let active: Player = 1;
/** Whose *player turn* it is (battle round). Only Enter / next battle round changes this; Space only switches the chess clock (`active`). */
let turnPlayer: Player = 1;
let running = false;
/** True after Pause mid-match; Space resumes without resetting times from inputs */
let paused = false;
/** Wall-clock ms (`Date.now()`): advances across sleep/lock unlike `performance.now()` in some browsers */
let lastTickWallMs = 0;
let raf = 0;
/** First rAF after startLoop: align clock, don’t subtract (avoids a visible second jump) */
let alignFirstTick = false;

/** Cap single catch-up step (clock skew / bugs); real lock gaps can be minutes */
const WALL_CLOCK_MAX_CATCHUP_SEC = 3600;

let wakeLock: WakeLockSentinel | null = null;

/** Last Space keydown (ms); used for double-tap pause */
let lastSpaceTime = 0;
/** Active player before the first Space of a potential double-tap (restored on double-pause) */
let activeBeforeSpaceSequence: Player = 1;
const DOUBLE_SPACE_MS = 380;

const MAX_GAME_TURN = 5;

/** Current battle round (1–5). Each round has P1’s turn then P2’s; advancing the round puts P1 on the clock. */
let currentGameTurn = 1;

/** Clocks frozen while players photograph the table between two player turns */
let photoBreak = false;
let cp1 = 1;
let cp2 = 1;
/** Points per own player turn (turn 1–5 of that player); totals are always derived from these. */
let scoreByTurn: Record<Player, Record<ScoreKind, number[]>> = { 1: emptyTurnScores(), 2: emptyTurnScores() };

function emptyTurnScores(): Record<ScoreKind, number[]> {
  return {
    primary: Array<number>(MAX_GAME_TURN).fill(0),
    secondary: Array<number>(MAX_GAME_TURN).fill(0),
  };
}

function sum(values: number[]): number {
  return values.reduce((total, n) => total + n, 0);
}

function scoreOf(player: Player, kind?: ScoreKind): number {
  const turns = scoreByTurn[player];
  return kind ? sum(turns[kind]) : sum(turns.primary) + sum(turns.secondary);
}

/**
 * Points count for the scorer's latest own turn: an action started in Player 2's turn 2
 * that completes during Player 1's turn 3 still scores for Player 2's turn 2.
 */
function scoringTurnIdx(player: Player): number {
  const ownTurn = player === 1 || turnPlayer === 2 ? currentGameTurn : currentGameTurn - 1;
  return Math.max(0, Math.min(MAX_GAME_TURN - 1, ownTurn - 1));
}

/** Manual CP added vs removed (± only) per player-turn slot (5 rounds × 2 players = 10). Not the automatic +1/turn. */
const MAX_PLAYER_TURNS = MAX_GAME_TURN * 2;
let cpHistoryAdded1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
let cpHistoryRemoved1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
let cpHistoryAdded2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
let cpHistoryRemoved2 = Array<number>(MAX_PLAYER_TURNS).fill(0);

const MAX_PANEL_SCORE = 999;
const MAX_PANEL_CP = 30;

let abilities: Record<Player, Ability[]> = { 1: [], 2: [] };
let nextAbilityId = 1;
/** On top of the Command phase CP, a player gains at most 1 CP per battle round (11th edition). */
let bonusCpGained: Record<Player, boolean> = { 1: false, 2: false };
/** Whose abilities panel is open */
let abilitiesPlayer: Player | null = null;

type TurnConfirmKind = "start-game" | "p1-to-p2" | "next-round" | "finish-game" | "reset";

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
    turnConfirmTitle.textContent = "Start the game?";
    turnConfirmMsg.textContent = `Player 1's clock starts.${photoBreaksToggle.checked ? " Photo breaks are on." : ""}`;
  } else if (kind === "p1-to-p2") {
    turnConfirmTitle.textContent = "End Player 1's turn?";
    turnConfirmMsg.textContent = "Player 2 takes the player turn. Both players gain 1 CP.";
  } else if (kind === "finish-game") {
    turnConfirmTitle.textContent = "End the game?";
    turnConfirmMsg.textContent = `Battle round ${MAX_GAME_TURN} is over. Scores are compared.`;
  } else if (kind === "reset") {
    turnConfirmTitle.textContent = "Reset the match?";
    turnConfirmMsg.textContent = "Clocks, scores and CP go back to the start.";
  } else {
    turnConfirmTitle.textContent = `Start battle round ${currentGameTurn + 1}?`;
    turnConfirmMsg.textContent = "Player 1 takes the player turn. Both players gain 1 CP.";
  }
  turnConfirmOverlay.classList.add("is-visible");
  turnConfirmOverlay.setAttribute("aria-hidden", "false");
  btnTurnConfirmOk.focus();
}

function renderResultTable(): void {
  const cells = (primary: number, secondary: number): string =>
    `<td class="is-group">${primary}</td><td>${secondary}</td>`;
  const roundRows = Array.from(
    { length: MAX_GAME_TURN },
    (_, i) =>
      `<tr><th scope="row">Turn ${i + 1}</th>${cells(scoreByTurn[1].primary[i], scoreByTurn[1].secondary[i])}${cells(scoreByTurn[2].primary[i], scoreByTurn[2].secondary[i])}</tr>`,
  ).join("");
  resultTable.innerHTML = `
    <thead>
      <tr>
        <th rowspan="2"></th>
        <th scope="colgroup" colspan="2" class="is-group is-p1">Player 1</th>
        <th scope="colgroup" colspan="2" class="is-group is-p2">Player 2</th>
      </tr>
      <tr class="result-table__kinds">
        <th scope="col" class="is-group">Pri</th><th scope="col">Sec</th>
        <th scope="col" class="is-group">Pri</th><th scope="col">Sec</th>
      </tr>
    </thead>
    <tbody>${roundRows}</tbody>
    <tfoot>
      <tr class="result-table__subtotal"><th scope="row">Subtotal</th>${cells(scoreOf(1, "primary"), scoreOf(1, "secondary"))}${cells(scoreOf(2, "primary"), scoreOf(2, "secondary"))}</tr>
      <tr class="result-table__total"><th scope="row">Total</th><td colspan="2" class="is-group">${scoreOf(1)}</td><td colspan="2" class="is-group">${scoreOf(2)}</td></tr>
    </tfoot>
  `;
}

function showResultOverlay(heading: string, message: string, winner: Player | null): void {
  resultTitle.textContent = heading;
  resultTitle.className = winner ? `is-p${winner}` : "";
  resultMsg.textContent = message;
  renderResultTable();
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
  const total1 = scoreOf(1);
  const total2 = scoreOf(2);
  if (total1 > total2) showResultOverlay("Player 1 wins", "Won on points.", 1);
  else if (total2 > total1) showResultOverlay("Player 2 wins", "Won on points.", 2);
  else showResultOverlay("Draw", "Tied on points.", null);
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
    applyAbilityCp(2, ["turn-cp"]);
    if (active !== 2) {
      active = 2;
      if (running) lastTickWallMs = Date.now();
    }
    setActivePanels();
    if (photoBreaksToggle.checked) startPhotoBreak();
    return;
  }
  if (kind === "finish-game") {
    finishGameByScore();
    return;
  }
  if (kind === "reset") {
    reset();
    return;
  }
  advanceGameTurn();
  if (photoBreaksToggle.checked) startPhotoBreak();
}

function startPhotoBreak(): void {
  photoBreak = true;
  stopLoop();
  app.classList.add("is-photo-break");
  photoMsg.textContent = `Photograph the table. Player ${turnPlayer}'s clock starts when you resume.`;
  photoOverlay.classList.add("is-visible");
  photoOverlay.setAttribute("aria-hidden", "false");
  btnPhotoResume.focus();
}

function endPhotoBreak(): void {
  if (!photoBreak) return;
  photoBreak = false;
  app.classList.remove("is-photo-break");
  photoOverlay.classList.remove("is-visible");
  photoOverlay.setAttribute("aria-hidden", "true");
  if (running) startLoop();
}

function readMinutes(): { a: number; b: number } {
  return {
    a: Math.max(0, Number(m1.value) || 0),
    b: Math.max(0, Number(m2.value) || 0),
  };
}

const UI_SIZES = new Set(["s", "m", "l", "xl", "uw"]);
const LAYOUTS = new Set(["rows", "columns"]);

/** Set on <html> so the tooltips, appended to <body>, scale too */
function applyUiSize(size: string): void {
  const v = UI_SIZES.has(size) ? size : UI_SIZE_DEFAULT;
  document.documentElement.dataset.uiSize = v;
  try {
    localStorage.setItem(UI_SIZE_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
}

function loadUiSize(): void {
  let stored = UI_SIZE_DEFAULT;
  try {
    stored = localStorage.getItem(UI_SIZE_STORAGE_KEY) ?? UI_SIZE_DEFAULT;
  } catch {
    /* ignore */
  }
  if (!UI_SIZES.has(stored)) stored = UI_SIZE_DEFAULT;
  uiSizeSelect.value = stored;
  applyUiSize(stored);
}

function applyLayout(layout: string): void {
  const v = LAYOUTS.has(layout) ? layout : LAYOUT_DEFAULT;
  document.documentElement.dataset.layout = v;
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
}

function loadLayout(): void {
  let stored = LAYOUT_DEFAULT;
  try {
    stored = localStorage.getItem(LAYOUT_STORAGE_KEY) ?? LAYOUT_DEFAULT;
  } catch {
    /* ignore */
  }
  if (!LAYOUTS.has(stored)) stored = LAYOUT_DEFAULT;
  layoutSelect.value = stored;
  applyLayout(stored);
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

/** The hour digit is dimmed under an hour, like an unlit segment. */
function renderTime(el: HTMLElement, totalSeconds: number): void {
  const [h, m, s] = formatTime(totalSeconds).split(":");
  el.innerHTML = `<span class="time__h${h === "0" ? " is-zero" : ""}">${h}:</span>${m}:${s}`;
}

function applyTimesToDisplay(): void {
  renderTime(t1, seconds1);
  renderTime(t2, seconds2);
}

function setActivePanels(): void {
  if (!running) {
    panel1.classList.remove("is-active", "is-idle");
    panel2.classList.remove("is-active", "is-idle");
    // Keep showing whose player turn it is while the clocks are paused
    panel1.classList.toggle("is-turn", paused && turnPlayer === 1);
    panel2.classList.toggle("is-turn", paused && turnPlayer === 2);
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
  photoBreaksToggle.disabled = !on;
}

function renderKeyHint(): void {
  if (running) {
    keyHint.innerHTML =
      "<kbd>Enter</kbd> end turn <span class=\"key-hint__sep\"></span> <kbd>Space</kbd> switch clock <span class=\"key-hint__sep\"></span> <kbd>Space</kbd><kbd>Space</kbd> pause";
  } else if (paused) {
    keyHint.innerHTML = "<span class=\"key-hint__status\">Paused</span> <kbd>Space</kbd> resume";
  } else {
    keyHint.innerHTML = "<kbd>Enter</kbd> start the game";
  }
}

function updateButtons(): void {
  /* Start / pause are keyboard-driven only (Enter / Space / double-space). */
  app.classList.toggle("match-started", running || paused);
  app.classList.toggle("is-paused", paused && !running);
  renderKeyHint();
}

async function tryAcquireWakeLock(): Promise<void> {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch {
    /* Not visible, denied, or unsupported */
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch {
    /* already released */
  }
  wakeLock = null;
}

/** Returns true if the match ended (time ran out). */
function subtractActivePlayerTime(elapsedSec: number): boolean {
  if (elapsedSec <= 0) return false;
  if (active === 1) {
    seconds1 -= elapsedSec;
    if (seconds1 <= 0) {
      seconds1 = 0;
      endGame(2);
      return true;
    }
  } else {
    seconds2 -= elapsedSec;
    if (seconds2 <= 0) {
      seconds2 = 0;
      endGame(1);
      return true;
    }
  }
  return false;
}

/**
 * After screen lock / sleep, rAF may not run. Apply wall-clock elapsed time so the
 * timer matches real time when the tab is active again.
 */
function applyWallClockCatchUp(): void {
  if (!running || alignFirstTick || photoBreak) return;
  const wallNow = Date.now();
  const rawElapsed = (wallNow - lastTickWallMs) / 1000;
  if (rawElapsed <= 0) return;
  lastTickWallMs = wallNow;
  const elapsed = Math.min(rawElapsed, WALL_CLOCK_MAX_CATCHUP_SEC);
  if (subtractActivePlayerTime(elapsed)) return;
  applyTimesToDisplay();
}

function tick(_now: number): void {
  if (!running) return;
  const wallNow = Date.now();
  if (alignFirstTick) {
    lastTickWallMs = wallNow;
    alignFirstTick = false;
    raf = requestAnimationFrame(tick);
    return;
  }
  const rawElapsed = (wallNow - lastTickWallMs) / 1000;
  lastTickWallMs = wallNow;
  const elapsed = Math.min(Math.max(rawElapsed, 0), WALL_CLOCK_MAX_CATCHUP_SEC);

  if (subtractActivePlayerTime(elapsed)) return;

  applyTimesToDisplay();
  raf = requestAnimationFrame(tick);
}

function startLoop(): void {
  cancelAnimationFrame(raf);
  lastTickWallMs = Date.now();
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
  lastTickWallMs = Date.now();
}

function endGame(winner: Player): void {
  running = false;
  paused = true;
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
  applyTimesToDisplay();
  syncPresetSelectFromState();
  const loser: Player = winner === 1 ? 2 : 1;
  showResultOverlay(`Player ${winner} wins`, `Player ${loser} ran out of time.`, winner);
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
  cp1 = 1;
  cp2 = 1;
  cpHistoryAdded1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryRemoved1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryAdded2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryRemoved2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  renderMiniCounters();
  startRoundAbilities();
  setInputsEnabled(false);
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
  void tryAcquireWakeLock();
  startLoop();
}

function pause(): void {
  running = false;
  paused = true;
  lastSpaceTime = 0;
  void releaseWakeLock();
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
  void releaseWakeLock();
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
  endPhotoBreak();
  scoreByTurn = { 1: emptyTurnScores(), 2: emptyTurnScores() };
  cp1 = 1;
  cp2 = 1;
  cpHistoryAdded1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryRemoved1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryAdded2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryRemoved2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  renderMiniCounters();
  closeAbilities();
  for (const player of [1, 2] as const) {
    bonusCpGained[player] = false;
    for (const ability of abilities[player]) {
      ability.lost = false;
      ability.spent = false;
    }
    renderAbilities(player);
  }
}

function renderMiniCounters(): void {
  for (const player of [1, 2] as const) {
    scoreTotalEl[player].textContent = String(scoreOf(player));
    for (const { kind } of SCORE_KINDS) {
      app.querySelector<HTMLElement>(`#p${player}-${kind}-val`)!.textContent = String(scoreOf(player, kind));
    }
  }
  p1CpVal.textContent = String(cp1);
  p2CpVal.textContent = String(cp2);
  updateVisibleScoreTooltip();
  updateVisibleCpTooltip();
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
  const player: Player = target === scoreTotalEl[1] ? 1 : 2;
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
  const { primary, secondary } = scoreByTurn[player];
  scoreTooltipEl.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "score-tooltip__legend";
  legend.textContent = "Primary / secondary";
  scoreTooltipEl.appendChild(legend);
  for (let i = 0; i < MAX_GAME_TURN; i++) {
    const row = document.createElement("div");
    row.className = "score-tooltip__row";
    const isCurrent = i === scoringTurnIdx(player);
    if (isCurrent) row.classList.add("is-current");

    if (primary[i] === 0 && secondary[i] === 0) row.classList.add("is-empty");
    const label = document.createElement("span");
    label.textContent = `Turn ${i + 1}`;
    row.appendChild(label);
    const value = document.createElement("span");
    value.className = "score-tooltip__value";
    value.textContent = `${primary[i]} / ${secondary[i]}`;
    row.appendChild(value);

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
  const player: Player = activeScoreTooltipTarget === scoreTotalEl[1] ? 1 : 2;
  renderScoreTooltipContent(player);
  placeScoreTooltip(activeScoreTooltipTarget);
}

const cpTooltipEl = document.createElement("div");
cpTooltipEl.className = "score-tooltip";
cpTooltipEl.hidden = true;
document.body.appendChild(cpTooltipEl);
let activeCpTooltipTarget: HTMLElement | null = null;

function placeCpTooltip(target: HTMLElement): void {
  const PAD = 8;
  const GAP = 10;
  const r = target.getBoundingClientRect();
  const t = cpTooltipEl.getBoundingClientRect();
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(PAD, Math.min(left, window.innerWidth - t.width - PAD));
  let top = r.top - t.height - GAP;
  if (top < PAD) top = Math.min(window.innerHeight - t.height - PAD, r.bottom + GAP);
  cpTooltipEl.style.left = `${left}px`;
  cpTooltipEl.style.top = `${top}px`;
}

function showCpTooltip(target: HTMLElement): void {
  const player: Player = target === p1CpVal ? 1 : 2;
  renderCpTooltipContent(player);
  cpTooltipEl.hidden = false;
  cpTooltipEl.classList.add("is-visible");
  activeCpTooltipTarget = target;
  placeCpTooltip(target);
}

function hideCpTooltip(): void {
  cpTooltipEl.classList.remove("is-visible");
  cpTooltipEl.hidden = true;
  activeCpTooltipTarget = null;
}

function bindCpTooltip(target: HTMLElement): void {
  target.addEventListener("mouseenter", () => showCpTooltip(target));
  target.addEventListener("mousemove", () => placeCpTooltip(target));
  target.addEventListener("mouseleave", hideCpTooltip);
}

function formatCpHistoryAddedRemoved(added: number, removed: number): string {
  return `+${added} / −${removed}`;
}

function renderCpTooltipContent(player: Player): void {
  const addedHist = player === 1 ? cpHistoryAdded1 : cpHistoryAdded2;
  const removedHist = player === 1 ? cpHistoryRemoved1 : cpHistoryRemoved2;
  cpTooltipEl.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "score-tooltip__legend";
  legend.textContent = "CP gained / spent by hand";
  cpTooltipEl.appendChild(legend);
  const matchActive = running || paused;
  const curSlot = matchActive ? currentPlayerTurnSlot() : -1;
  for (let i = 0; i < MAX_PLAYER_TURNS; i++) {
    const row = document.createElement("div");
    row.className = "score-tooltip__row";
    const isCurrent = i === curSlot;
    if (isCurrent) row.classList.add("is-current");

    const round = Math.floor(i / 2) + 1;
    const turnOwner: Player = i % 2 === 0 ? 1 : 2;
    if (addedHist[i] === 0 && removedHist[i] === 0) row.classList.add("is-empty");
    const label = document.createElement("span");
    label.textContent = `Round ${round} · P${turnOwner}`;
    row.appendChild(label);
    const value = document.createElement("span");
    value.className = "score-tooltip__value";
    value.textContent = formatCpHistoryAddedRemoved(addedHist[i], removedHist[i]);
    row.appendChild(value);

    if (isCurrent) {
      const marker = document.createElement("span");
      marker.className = "score-tooltip__current-marker";
      marker.textContent = "←";
      marker.setAttribute("aria-hidden", "true");
      row.appendChild(marker);
    }
    cpTooltipEl.appendChild(row);
  }
}

function updateVisibleCpTooltip(): void {
  if (!activeCpTooltipTarget || cpTooltipEl.hidden) return;
  const player: Player = activeCpTooltipTarget === p1CpVal ? 1 : 2;
  renderCpTooltipContent(player);
  placeCpTooltip(activeCpTooltipTarget);
}

function activeAbilities(player: Player, kind: AbilityKind): Ability[] {
  return abilities[player].filter((ability) => ability.kind === kind && !ability.lost);
}

function gainCp(player: Player): void {
  if (player === 1) cp1 = clampPanelCp(cp1 + 1);
  else cp2 = clampPanelCp(cp2 + 1);
  renderMiniCounters();
}

/** Grants the +1 CP of the abilities triggering now, within the per-round cap. */
function applyAbilityCp(player: Player, kinds: ("round-cp" | "turn-cp")[]): void {
  const [source] = kinds.flatMap((kind) => activeAbilities(player, kind));
  if (!source) return;
  if (bonusCpGained[player]) {
    showCpToast(player, "CP cap reached", false);
    return;
  }
  bonusCpGained[player] = true;
  gainCp(player);
  showCpToast(player, source.name ? `+1 CP · ${source.name}` : "+1 CP", true);
  renderAbilities(player);
}

/** Start of a battle round: discounts come back, the CP cap resets, then CP abilities trigger. */
function startRoundAbilities(): void {
  for (const player of [1, 2] as const) {
    bonusCpGained[player] = false;
    for (const ability of abilities[player]) ability.spent = false;
  }
  // A new round is also the start of Player 1's turn
  applyAbilityCp(1, ["round-cp", "turn-cp"]);
  applyAbilityCp(2, ["round-cp"]);
  renderAbilities(1);
  renderAbilities(2);
}

const CP_TOAST_MS = 3500;
const cpToastTimers: Record<Player, number> = { 1: 0, 2: 0 };

function showCpToast(player: Player, text: string, gained: boolean): void {
  const toast = cpToastEl[player];
  toast.textContent = text;
  toast.classList.toggle("is-capped", !gained);
  toast.classList.add("is-visible");
  window.clearTimeout(cpToastTimers[player]);
  cpToastTimers[player] = window.setTimeout(() => toast.classList.remove("is-visible"), CP_TOAST_MS);
}

const CP_COIN_SVG = `
  <svg class="cp-coin__hex" viewBox="0 0 64 64" aria-hidden="true">
    <polygon class="cp-coin__outer" points="32,2 58,17 58,47 32,62 6,47 6,17" />
    <polygon class="cp-coin__inner" points="32,9 52,20.5 52,43.5 32,55 12,43.5 12,20.5" />
    <path class="cp-coin__ticks" d="M32 2v5M32 57v5M6 17l4.3 2.5M58 17l-4.3 2.5M6 47l4.3-2.5M58 47l-4.3-2.5" />
  </svg>`;

function cpCoinEl(ability: Ability): HTMLButtonElement {
  const coin = document.createElement("button");
  coin.type = "button";
  coin.className = "cp-coin";
  coin.classList.toggle("is-spent", ability.spent);
  coin.dataset.abilityId = String(ability.id);
  const owner = ability.name || "Stratagem";
  coin.setAttribute(
    "aria-label",
    ability.spent ? `${owner}: −1 CP already used this battle round` : `${owner}: use −1 CP on a stratagem`,
  );
  coin.innerHTML = `
    <span class="cp-coin__face" aria-hidden="true">${CP_COIN_SVG}
      <span class="cp-coin__value">−1</span>
      <span class="cp-coin__unit">CP</span>
    </span>
    <span class="cp-coin__caption" aria-hidden="true"></span>`;
  coin.querySelector(".cp-coin__caption")!.textContent = ability.spent ? "Next round" : owner;
  return coin;
}

function renderAbilities(player: Player): void {
  const coins = document.createElement("div");
  coins.className = "abilities__coins";
  const chips = document.createElement("div");
  chips.className = "abilities__chips";
  for (const ability of abilities[player]) {
    if (ability.lost) continue;
    if (ability.kind === "discount") {
      coins.appendChild(cpCoinEl(ability));
    } else {
      const chip = document.createElement("span");
      chip.className = "ability-chip";
      const short = ABILITY_KINDS[ability.kind].short;
      chip.textContent = ability.name ? `${short} · ${ability.name}` : short;
      chips.appendChild(chip);
    }
  }
  abilitiesEl[player].replaceChildren(...[coins, chips].filter((group) => group.childElementCount > 0));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const CP_COIN_ANIM_MS = 900;

function spendCpCoin(player: Player, coin: HTMLButtonElement): void {
  if (!running && !paused) return;
  const ability = abilities[player].find(({ id }) => String(id) === coin.dataset.abilityId);
  if (!ability || ability.spent || coin.classList.contains("is-animating")) return;

  const face = coin.querySelector<HTMLElement>(".cp-coin__face")!;
  let completed = false;
  let fallbackTimer = 0;

  function finish(): void {
    if (completed || !ability) return;
    completed = true;
    window.clearTimeout(fallbackTimer);
    face.removeEventListener("animationend", onEnd);
    ability.spent = true;
    renderAbilities(player);
  }

  function onEnd(e: AnimationEvent): void {
    const n = e.animationName;
    /* WebKit sometimes omits or prefixes the name; empty means “this element’s animation” */
    if (n && !n.includes("cpCoinFlip")) return;
    finish();
  }

  if (prefersReducedMotion()) {
    finish();
    return;
  }

  coin.classList.add("is-animating");
  face.addEventListener("animationend", onEnd);
  fallbackTimer = window.setTimeout(() => finish(), CP_COIN_ANIM_MS);
}

function openAbilities(player: Player): void {
  abilitiesPlayer = player;
  abilitiesTitle.textContent = `Player ${player} abilities`;
  abilitiesTitle.className = `is-p${player}`;
  abilityNameInput.value = "";
  renderAbilityList();
  abilitiesOverlay.classList.add("is-visible");
  abilitiesOverlay.setAttribute("aria-hidden", "false");
  abilityNameInput.focus();
}

function closeAbilities(): void {
  if (abilitiesPlayer === null) return;
  abilitiesPlayer = null;
  abilitiesOverlay.classList.remove("is-visible");
  abilitiesOverlay.setAttribute("aria-hidden", "true");
  (document.activeElement as HTMLElement | null)?.blur();
}

function renderAbilityList(): void {
  if (abilitiesPlayer === null) return;
  const rows = abilities[abilitiesPlayer].map((ability) => {
    const row = document.createElement("li");
    row.className = "ability-row";
    row.classList.toggle("is-lost", ability.lost);
    row.dataset.abilityId = String(ability.id);
    const kind = document.createElement("span");
    kind.className = "ability-row__kind";
    kind.textContent = ABILITY_KINDS[ability.kind].short;
    const name = document.createElement("span");
    name.className = "ability-row__name";
    name.textContent = ability.name || "—";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn-secondary btn-sm";
    toggle.dataset.action = "toggle";
    toggle.textContent = ability.lost ? "Restore" : "Lost";
    toggle.title = ability.lost ? "Its character is back" : "Its character is gone";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-icon btn-sm";
    remove.dataset.action = "delete";
    remove.setAttribute("aria-label", "Delete ability");
    remove.textContent = "✕";
    row.append(kind, name, toggle, remove);
    return row;
  });
  if (rows.length === 0) {
    const empty = document.createElement("li");
    empty.className = "ability-list__empty";
    empty.textContent = "No ability yet.";
    rows.push(empty);
  }
  abilityList.replaceChildren(...rows);
}

function addAbility(kind: AbilityKind): void {
  if (abilitiesPlayer === null) return;
  abilities[abilitiesPlayer].push({
    id: nextAbilityId++,
    kind,
    name: abilityNameInput.value.trim(),
    lost: false,
    spent: false,
  });
  abilityNameInput.value = "";
  abilityNameInput.focus();
  renderAbilityList();
  renderAbilities(abilitiesPlayer);
}

function handleAbilityRowAction(action: string, id: number): void {
  if (abilitiesPlayer === null) return;
  const player = abilitiesPlayer;
  if (action === "delete") {
    abilities[player] = abilities[player].filter((ability) => ability.id !== id);
  } else {
    const ability = abilities[player].find((candidate) => candidate.id === id);
    if (ability) ability.lost = !ability.lost;
  }
  renderAbilityList();
  renderAbilities(player);
}

function adjustScore(player: Player, kind: ScoreKind, delta: 1 | -1): void {
  const turns = scoreByTurn[player][kind];
  const turnIdx = scoringTurnIdx(player);
  if (delta > 0) {
    if (sum(turns) >= MAX_PANEL_SCORE) return;
    turns[turnIdx] += 1;
  } else {
    // A minus corrects the latest points scored: this turn first, then the turns before it
    let idx = turnIdx;
    while (idx >= 0 && turns[idx] === 0) idx--;
    if (idx < 0) return;
    turns[idx] -= 1;
  }
  renderMiniCounters();
}

function clampPanelCp(n: number): number {
  return Math.max(0, Math.min(MAX_PANEL_CP, n));
}

function playerTurnSlotIndex(round: number, player: Player): number {
  return (round - 1) * 2 + (player - 1);
}

function currentPlayerTurnSlot(): number {
  return playerTurnSlotIndex(currentGameTurn, turnPlayer);
}

function recordCpManualAdjust(player: Player, slot: number, applied: number): void {
  if (applied === 0 || slot < 0 || slot >= MAX_PLAYER_TURNS) return;
  if (applied > 0) {
    if (player === 1) cpHistoryAdded1[slot] += applied;
    else cpHistoryAdded2[slot] += applied;
  } else {
    const r = -applied;
    if (player === 1) cpHistoryRemoved1[slot] += r;
    else cpHistoryRemoved2[slot] += r;
  }
}

function adjustCp(player: Player, delta: number): void {
  if (delta === 0) return;
  const current = player === 1 ? cp1 : cp2;
  const next = clampPanelCp(current + delta);
  const applied = next - current;
  if (applied === 0) return;
  if (player === 1) cp1 = next;
  else cp2 = next;
  if (running || paused) {
    const slot = currentPlayerTurnSlot();
    recordCpManualAdjust(player, slot, applied);
  }
  renderMiniCounters();
}

/**
 * Both players gain 1 CP when a new player turn begins (Enter confirmed).
 * Not recorded in manual CP history (tooltip: added/removed per turn only).
 */
function gainCpBothPlayers(): void {
  cp1 = clampPanelCp(cp1 + 1);
  cp2 = clampPanelCp(cp2 + 1);
  renderMiniCounters();
}

const scoreActions = ([1, 2] as const).flatMap((player) =>
  SCORE_KINDS.flatMap(({ kind }): [string, () => void][] => [
    [`p${player}-${kind}-minus`, () => { adjustScore(player, kind, -1); }],
    [`p${player}-${kind}-plus`, () => { adjustScore(player, kind, 1); }],
  ]),
);

const miniCounterActions: [string, () => void][] = [
  ...scoreActions,
  ["p1-cp-minus", () => { adjustCp(1, -1); }],
  ["p1-cp-plus", () => { adjustCp(1, 1); }],
  ["p2-cp-minus", () => { adjustCp(2, -1); }],
  ["p2-cp-plus", () => { adjustCp(2, 1); }],
];
for (const [id, handler] of miniCounterActions) {
  app.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener("click", handler);
}

for (const player of [1, 2] as const) {
  app.querySelector<HTMLButtonElement>(`#p${player}-abilities-btn`)!.addEventListener("click", () => openAbilities(player));
  abilitiesEl[player].addEventListener("click", (e) => {
    const coin = (e.target as HTMLElement).closest<HTMLButtonElement>(".cp-coin");
    if (coin) spendCpCoin(player, coin);
  });
}
app.querySelectorAll<HTMLButtonElement>(".ability-kind").forEach((btn) => {
  btn.addEventListener("click", () => addAbility(btn.dataset.kind as AbilityKind));
});
abilityList.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  const row = btn?.closest<HTMLElement>(".ability-row");
  if (btn && row) handleAbilityRowAction(btn.dataset.action!, Number(row.dataset.abilityId));
});
btnAbilitiesClose.addEventListener("click", closeAbilities);

function renderTurnDots(): void {
  turnDots.innerHTML = "";
  for (let i = 1; i <= MAX_GAME_TURN; i++) {
    const dot = document.createElement("span");
    dot.className = "turn-dot";
    const num = document.createElement("span");
    num.className = "turn-dot__num";
    num.textContent = String(i);
    num.setAttribute("aria-hidden", "true");
    dot.appendChild(num);
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
  startRoundAbilities();
  lastSpaceTime = 0;
  activeBeforeSpaceSequence = 1;
  if (running) lastTickWallMs = Date.now();
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
  void tryAcquireWakeLock();
  startLoop();
}

btnReset.addEventListener("click", () => {
  if (running || paused) openTurnConfirmModal("reset");
  else reset();
});
btnFullscreen.addEventListener("click", toggleFullscreen);
btnTurnConfirmOk.addEventListener("click", applyTurnConfirm);
btnTurnConfirmCancel.addEventListener("click", hideTurnConfirmModal);
btnResultDismiss.addEventListener("click", hideResultOverlay);
btnPhotoResume.addEventListener("click", endPhotoBreak);
// A focused checkbox would swallow Enter / Space, the game shortcuts
photoBreaksToggle.addEventListener("change", () => photoBreaksToggle.blur());
bindScoreTooltip(scoreTotalEl[1]);
bindScoreTooltip(scoreTotalEl[2]);
bindCpTooltip(p1CpVal);
bindCpTooltip(p2CpVal);
window.addEventListener("scroll", hideScoreTooltip, true);
window.addEventListener("resize", hideScoreTooltip);
window.addEventListener("scroll", hideCpTooltip, true);
window.addEventListener("resize", hideCpTooltip);

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function shouldIgnoreSpaceLike(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest(".mini-counter")) return true;
  if (el.closest(".panel-corner")) return true;
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
  // The abilities panel is a form: keys keep their usual meaning there
  if (abilitiesOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAbilities();
    }
    return;
  }
  if ((e.code === "Enter" || e.code === "Space") && isButtonTarget(e.target)) {
    /* Keep Enter/Space bound to global turn/timer shortcuts, not focused button activation. */
    e.preventDefault();
  }
  if (photoOverlay.classList.contains("is-visible")) {
    if ((e.code === "Enter" && !e.repeat) || e.key === "Escape") {
      e.preventDefault();
      endPhotoBreak();
    } else if (e.code === "Space") {
      e.preventDefault();
    }
    return;
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
  if (abilitiesOverlay.classList.contains("is-visible")) return;
  if (photoOverlay.classList.contains("is-visible")) return;
  if (resultOverlay.classList.contains("is-visible")) return;
  if (turnConfirmOverlay.classList.contains("is-visible")) return;
  if ((e.target as HTMLElement).closest(".turn-tracker")) return;
  if ((e.target as HTMLElement).closest(".mini-counter")) return;
  if ((e.target as HTMLElement).closest(".panel-corner")) return;
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

uiSizeSelect.addEventListener("change", () => {
  applyUiSize(uiSizeSelect.value);
});

layoutSelect.addEventListener("change", () => {
  applyLayout(layoutSelect.value);
});

// A focused select would swallow Enter / Space, the game shortcuts
[layoutSelect, uiSizeSelect, presetTime].forEach((select) => {
  select.addEventListener("change", () => select.blur());
});

presetTime.value = String(DEFAULT_TIME_SEC);
loadLayout();
loadUiSize();
updateManualInputsVisibility();
applyTimesToDisplay();
setActivePanels();
updateButtons();
renderTurnDots();
renderMiniCounters();
renderAbilities(1);
renderAbilities(2);

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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    applyWallClockCatchUp();
    if (running) void tryAcquireWakeLock();
  }
});

window.addEventListener("pageshow", (e) => {
  if (e.persisted) applyWallClockCatchUp();
});
