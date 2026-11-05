import "./style.css";
import { getLang, setLang, t, type Lang, type StringKey } from "./i18n";
import { SECONDARY_BY_ID, type SecondaryCard, type Text } from "./secondaries";
import { FACTION_BY_ID, FACTIONS, SPACE_MARINES, SPACE_MARINES_NAME, type FactionGroup } from "./factions";
import { applyUpdateIfIdle, setupPwa } from "./pwa";
import type { Room, RoomEvents } from "./room";
import { merge } from "./sync";
import {
  DEFAULT_TIME_SEC,
  MAX_GAME_TURN,
  MAX_PLAYER_TURNS,
  MAX_POINTS_PER_TURN,
  clampCp,
  emptyCpHistory,
  emptyTurnScores,
  inGame,
  isStopped,
  newGame,
  newSecondaryPile,
  other,
  playerTurnSlot,
  runClock,
  scoreOf as scoreOfGame,
  scoringTurnIdx as scoringTurnIdxOf,
  secondsLeft,
  setActiveClock,
  stopClock,
  sum,
  type Ability,
  type AbilityKind,
  type GameState,
  type Player,
  type ScoreKind,
  type TurnEndKind,
} from "./game";
import {
  isMuted,
  playSound,
  setBattleMusic,
  setMusic,
  setMuted,
  setSoundsOn,
  setVolume,
  unlockAudio,
  type MusicTrack,
} from "./audio";
import {
  DISPOSITIONS,
  PRIMARY_BY_ID,
  primaryFor,
  type Disposition,
  type PrimaryCard,
  type PrimaryItem,
  type PrimarySection,
} from "./primaries";

const PRESETS = [
  { label: "1h30", sec: 5400 },
  { label: "1h45", sec: 6300 },
  { label: "2h", sec: 7200 },
  { label: "2h15", sec: 8100 },
  { label: "2h30", sec: 9000 },
] as const;

const CUSTOM_PRESET_VALUE = "custom";

/** Open the hand (S) and the primary (P) of the player whose clock runs; physical keys, the same on AZERTY */
const HAND_KEY = "S";
const HAND_KEY_CODE = "KeyS";
const PRIMARY_KEY = "P";
const PRIMARY_KEY_CODE = "KeyP";
/** At the end of a turn, from one player's scoring cards to the other's */
const SWITCH_KEY = "Tab";

const SCORE_KINDS: { kind: ScoreKind; label: StringKey; ariaMinus: StringKey; ariaPlus: StringKey }[] = [
  { kind: "primary", label: "primary", ariaMinus: "ariaPrimaryMinus", ariaPlus: "ariaPrimaryPlus" },
  { kind: "secondary", label: "secondary", ariaMinus: "ariaSecondaryMinus", ariaPlus: "ariaSecondaryPlus" },
];

const ABILITY_KINDS: Record<AbilityKind, { title: StringKey; hint: StringKey; short: StringKey }> = {
  discount: { title: "discountTitle", hint: "discountHint", short: "discountShort" },
  "round-cp": { title: "roundCpTitle", hint: "roundCpHint", short: "roundCpShort" },
  "turn-cp": { title: "turnCpTitle", hint: "turnCpHint", short: "turnCpShort" },
};

/** Key kept from the former "Counters" setting so saved choices survive the rename */
const UI_SIZE_STORAGE_KEY = "warhammerClock.counterSize";
const UI_SIZE_DEFAULT = "m";

const LAYOUT_STORAGE_KEY = "warhammerClock.layout";
const LAYOUT_DEFAULT = "rows";

const LANG_STORAGE_KEY = "warhammerClock.lang";

const THEME_STORAGE_KEY = "warhammerClock.theme";

const SOUNDS_STORAGE_KEY = "warhammerClock.sounds";
const MUSIC_STORAGE_KEY = "warhammerClock.music";
const VOLUME_STORAGE_KEY = "warhammerClock.volume";
const MUSIC_TRACKS: MusicTrack[] = ["off", "calm", "tense", "epic"];
const VOLUME_DEFAULT = 80;
/** Mutes every sound and the music at once, during the game too */
const MUTE_KEY = "M";
const MUTE_KEY_CODE = "KeyM";
/** Time left that rings a warning when a clock goes under it */
const TIME_WARNINGS_SEC = [600, 300, 60];

const FACTION_DEFAULTS: Record<Player, string> = { 1: "imperial-fists", 2: "tyranids" };
/** Picking Space Marines starts on this chapter */
const DEFAULT_CHAPTER = "ultramarines";
const FACTION_GROUPS: { group: FactionGroup; label: StringKey }[] = [
  { group: "imperium", label: "factionImperium" },
  { group: "chaos", label: "factionChaos" },
  { group: "xenos", label: "factionXenos" },
];
let factionOf: Record<Player, string> = { ...FACTION_DEFAULTS };
const factionStorageKey = (player: Player): string => `warhammerClock.faction.p${player}`;
const THEME_DEFAULT = "clean";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Always H:MM:SS so the clock keeps the same width when it drops under an hour. */
function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const svgIcon = (body: string, viewBox = "0 0 24 24"): string =>
  `<svg class="icon" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** A list drawn by the app, where the system's would break the look: a button and its options */
const pickerHtml = (id: string): string => `
  <span class="select picker">
    <button type="button" class="picker__button" id="${id}" aria-haspopup="listbox" aria-expanded="false">
      <span class="picker__swatch"></span><span class="picker__label"></span>${ICON_CHEVRON}
    </button>
    <div class="picker__list" role="listbox" hidden></div>
  </span>`;

/** A tiny clock screen in the theme's own colors: player 1's clock running, player 2's waiting */
const themePreviewHtml = (theme: string): string =>
  `<span class="theme-preview theme-preview--${theme}" aria-hidden="true"><span class="theme-preview__half">2:00</span><span class="theme-preview__half">2:00</span></span>`;

const ICON_TARGET = svgIcon('<circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />');
const ICON_CARDS = svgIcon('<rect x="4" y="6" width="11" height="15" rx="2" /><path d="M9 3h9a2 2 0 0 1 2 2v13" />');
const ICON_CLOCK = svgIcon('<circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M10 2h4" />');
const ICON_CAMERA = svgIcon('<path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />');
const ICON_SLIDERS = svgIcon(
  '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />',
);
const ICON_CHECK = svgIcon('<path d="M5 12.5l4.5 4.5L19 7.5" />');
const ICON_CHEVRON = svgIcon('<path d="M7 10l5 5 5-5" />');
const ICON_ONLINE = svgIcon('<rect x="2.5" y="5" width="7" height="14" rx="1.5" /><rect x="14.5" y="5" width="7" height="14" rx="1.5" /><path d="M9.5 12h5" />');
const ICON_RESET = svgIcon('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />');
const ICON_ROWS = svgIcon('<rect x="2" y="2" width="24" height="7" rx="1" /><rect x="2" y="11" width="24" height="7" rx="1" />', "0 0 28 20");
const ICON_COLUMNS = svgIcon('<rect x="2" y="2" width="11" height="16" rx="1" /><rect x="15" y="2" width="11" height="16" rx="1" />', "0 0 28 20");

/*
 * Texts live in i18n.ts. Elements carry their key (data-i18n, data-i18n-aria, data-i18n-title,
 * data-i18n-placeholder) and their placeholders (data-v-*): applyTranslations() fills them.
 */
function scoreCounterHtml(player: Player, corner: "tl" | "bl"): string {
  const rows = SCORE_KINDS.map(
    ({ kind, label, ariaMinus, ariaPlus }) => `
        <div class="score-box__row" data-kind="${kind}">
          <span class="score-box__kind" data-i18n="${label}"></span>
          <button type="button" class="mini-counter__btn" id="p${player}-${kind}-minus" data-i18n-aria="${ariaMinus}" data-v-n="${player}">−</button>
          <span class="mini-counter__val" id="p${player}-${kind}-val">0</span>
          <button type="button" class="mini-counter__btn" id="p${player}-${kind}-plus" data-i18n-aria="${ariaPlus}" data-v-n="${player}">+</button>
          ${capGaugeHtml(`p${player}-${kind}-cap`)}
        </div>`,
  ).join("");
  return `
      <div class="mini-counter mini-counter--${corner} score-box">
        <div class="score-box__head">
          <span class="mini-counter__label" data-i18n="score"></span>
          <span class="score-box__total" id="p${player}-score-total">0</span>
        </div>
        ${rows}
        <div class="score-box__row score-box__row--bonus" id="p${player}-bonus-row" hidden data-i18n-title="endBonusTitle" data-v-max="${MAX_POINTS_PER_TURN}">
          <span class="score-box__kind" data-i18n="endBonus"></span>
          <button type="button" class="mini-counter__btn" id="p${player}-bonus-minus" data-i18n-aria="ariaBonusMinus" data-v-n="${player}">−</button>
          <span class="mini-counter__val" id="p${player}-bonus-val">0</span>
          <button type="button" class="mini-counter__btn" id="p${player}-bonus-plus" data-i18n-aria="ariaBonusPlus" data-v-n="${player}">+</button>
        </div>
        <div class="score-box__cards" id="p${player}-card-btns" hidden>
          <button type="button" class="score-box__deck" id="p${player}-primary-btn" data-i18n-aria="primaryAria" data-v-n="${player}">
            <span class="score-box__primary-card" aria-hidden="true">${ICON_TARGET}</span>
            <span class="score-box__deck-label" data-i18n="primaryCard"></span>
            <kbd>${PRIMARY_KEY}</kbd>
          </button>
          <button type="button" class="score-box__deck" id="p${player}-hand-btn">
            <span class="score-box__hand-stack" aria-hidden="true"><span class="score-box__hand-count">0</span></span>
            <span class="score-box__deck-label" data-i18n="secondaryHand"></span>
            <kbd>${HAND_KEY}</kbd>
          </button>
        </div>
        <button type="button" class="score-box__alert" id="p${player}-turn-end-alert" data-i18n-aria="turnEndAlertAria" data-v-n="${player}" hidden></button>
      </div>`;
}

/** This turn's points against the 15 allowed: a bar that warns near the cap and locks at it */
function capGaugeHtml(id = ""): string {
  return `<span class="cap-gauge"${id ? ` id="${id}"` : ""}><span class="cap-gauge__bar"><span class="cap-gauge__fill"></span></span><span class="cap-gauge__text"></span></span>`;
}

/** Near the cap: 3 points or fewer left */
const CAP_NEAR = MAX_POINTS_PER_TURN - 3;

function setCapGauge(gauge: HTMLElement, points: number, turnIdx: number, suffix: boolean): void {
  gauge.style.setProperty("--fill", String(Math.min(1, points / MAX_POINTS_PER_TURN)));
  gauge.classList.toggle("is-near", points >= CAP_NEAR && points < MAX_POINTS_PER_TURN);
  gauge.classList.toggle("is-full", points >= MAX_POINTS_PER_TURN);
  gauge.querySelector(".cap-gauge__text")!.textContent = suffix
    ? t("capThisTurn", { n: points, max: MAX_POINTS_PER_TURN })
    : `${points}/${MAX_POINTS_PER_TURN}`;
  gauge.title = t("capTitle", { t: turnIdx + 1, n: points, max: MAX_POINTS_PER_TURN });
}

/** Points left under the 15 of this turn; the end-of-battle bonus has no cap */
function roomThisTurn(player: Player, kind: ScoreKind): number {
  return MAX_POINTS_PER_TURN - game.scoreByTurn[player][kind][scoringTurnIdx(player)];
}

/** Points shown on a scoring button: when the cap cuts them, the full value struck out above what counts */
function vpHtml(vp: number, room: number): string {
  const unit = t("vpUnit");
  if (vp <= room) return `${vp}<small>${unit}</small>`;
  return `<s>${vp}</s>${Math.max(0, room)}<small>${unit}</small>`;
}

/** "Score 6 VP", or "Score <s>6</s> 3 VP" when the cap cuts it */
function goHtml(total: number, room: number): string {
  const counted = Math.max(0, Math.min(total, room));
  const struck = total > counted ? `<s>${total}</s> ` : "";
  return `${t("scoreIt")} ${struck}${counted} ${t("vpUnit")}`;
}

function setGoButton(go: HTMLElement, total: number, room: number): void {
  go.innerHTML = goHtml(total, room);
  markCapped(go, total, room);
}

function markCapped(el: HTMLElement, vp: number, room: number): void {
  const capped = vp > room;
  el.classList.toggle("is-capped", capped);
  el.title = capped ? t("cappedTitle", { max: MAX_POINTS_PER_TURN, n: Math.max(0, room), unit: t("vpUnit") }) : "";
}

function cpCornerHtml(player: Player, corner: "tr" | "br"): string {
  return `
      <div class="panel-corner panel-corner--${corner}">
        <div class="mini-counter cp-box">
          <span class="mini-counter__label" data-i18n="commandPoints"></span>
          <div class="mini-counter__row">
            <button type="button" class="mini-counter__btn" id="p${player}-cp-minus" data-i18n-aria="ariaCpMinus" data-v-n="${player}">−</button>
            <span class="mini-counter__val" id="p${player}-cp-val">1</span>
            <button type="button" class="mini-counter__btn" id="p${player}-cp-plus" data-i18n-aria="ariaCpPlus" data-v-n="${player}">+</button>
          </div>
          <button type="button" class="abilities-btn" id="p${player}-abilities-btn" data-i18n="abilities"></button>
          <span class="cp-toast" id="p${player}-cp-toast" role="status"></span>
        </div>
        <div class="abilities" id="p${player}-abilities"></div>
      </div>`;
}

function panelHtml(player: Player): string {
  return `
    <section class="panel panel--${player === 1 ? "a" : "b"}" id="panel-${player}" data-player="${player}" tabindex="0" data-i18n-aria="playerTimerAria" data-v-n="${player}">
      ${scoreCounterHtml(player, player === 1 ? "tl" : "bl")}
      ${cpCornerHtml(player, player === 1 ? "tr" : "br")}
      <div class="panel-head">
        <span class="panel-label" data-i18n="player" data-v-n="${player}"></span>
        <span class="panel-turn" data-i18n="playerTurn"></span>
      </div>
      <span class="time" id="t${player}">1:00:00</span>
    </section>`;
}

app.innerHTML = `
  <header class="toolbar">
    <div class="toolbar__group">
      <div class="setting">
        <span class="setting__label">${ICON_CLOCK}<span data-i18n="time"></span></span>
        <div class="time-picker" id="time-picker">
          <button type="button" class="picker" id="btn-time" aria-haspopup="true" data-i18n-aria="timeAria">
            <span class="picker__value" id="time-value"></span>
            ${ICON_CHEVRON}
          </button>
          <div class="time-panel">
            <div class="segmented" id="time-presets" role="group" data-i18n-aria="timeAria">
              ${PRESETS.map((p) => `<button type="button" class="segmented__option" data-value="${p.sec}">${p.label}</button>`).join("")}
              <button type="button" class="segmented__option" data-value="${CUSTOM_PRESET_VALUE}" data-i18n="custom"></button>
            </div>
            <div id="manual-time-wrap" class="toolbar-manual" hidden>
              <label>
                <span data-i18n="playerMinutes" data-v-n="1"></span>
                <input id="m1" type="number" min="0" max="999" step="1" value="${DEFAULT_TIME_SEC / 60}" />
              </label>
              <label>
                <span data-i18n="playerMinutes" data-v-n="2"></span>
                <input id="m2" type="number" min="0" max="999" step="1" value="${DEFAULT_TIME_SEC / 60}" />
              </label>
            </div>
          </div>
        </div>
      </div>
      <label class="toggle-chip">
        <input type="checkbox" id="photo-breaks" />
        ${ICON_CAMERA}
        <span data-i18n="photoBreaks"></span>
        <span class="toggle-chip__switch" aria-hidden="true"></span>
      </label>
      <label class="toggle-chip">
        <input type="checkbox" id="secondary-cards" checked />
        ${ICON_CARDS}
        <span data-i18n="secondaryCards"></span>
        <span class="toggle-chip__switch" aria-hidden="true"></span>
      </label>
    </div>
    <div class="toolbar__group toolbar__group--end">
      <button type="button" class="btn-online" id="btn-online">${ICON_ONLINE}<span data-i18n="online"></span></button>
      <div class="popover-anchor">
        <button type="button" class="btn-icon" id="btn-settings" aria-expanded="false" aria-controls="settings-panel" data-i18n-aria="display" data-i18n-title="display">${ICON_SLIDERS}</button>
        <div class="popover popover--end settings__panel" id="settings-panel" hidden>
          <div class="settings__section">
            <span class="settings__label" data-i18n="layout"></span>
            <div class="segmented segmented--tiles" id="layout-options" role="group" data-i18n-aria="layoutAria">
              <button type="button" class="segmented__option" data-value="rows">${ICON_ROWS}<span data-i18n="layoutRows"></span></button>
              <button type="button" class="segmented__option" data-value="columns">${ICON_COLUMNS}<span data-i18n="layoutColumns"></span></button>
            </div>
          </div>
          <div class="settings__section">
            <span class="settings__label" data-i18n="uiSize"></span>
            <div class="segmented segmented--wrap" id="ui-size-options" role="group" data-i18n-aria="uiSizeAria">
              <button type="button" class="segmented__option" data-value="s" data-i18n="sizeS"></button>
              <button type="button" class="segmented__option" data-value="m" data-i18n="sizeM"></button>
              <button type="button" class="segmented__option" data-value="l" data-i18n="sizeL"></button>
              <button type="button" class="segmented__option" data-value="xl" data-i18n="sizeXl"></button>
              <button type="button" class="segmented__option" data-value="uw" data-i18n="sizeUw"></button>
            </div>
          </div>
          <div class="settings__section">
            <span class="settings__label" data-i18n="language"></span>
            <div class="segmented" id="lang-options" role="group" data-i18n-aria="language">
              <button type="button" class="segmented__option" data-value="en">English</button>
              <button type="button" class="segmented__option" data-value="fr">Français</button>
            </div>
          </div>
          <div class="settings__section">
            <span class="settings__label"><span data-i18n="sound"></span> <kbd>${MUTE_KEY}</kbd> <span class="settings__hint" data-i18n="muteHint"></span></span>
            <div class="sound-row">
              <span class="sound-row__label" data-i18n="soundEffects"></span>
              <div class="segmented" id="sfx-options" role="group" data-i18n-aria="soundEffects">
                <button type="button" class="segmented__option" data-value="off" data-i18n="off"></button>
                <button type="button" class="segmented__option" data-value="on" data-i18n="on"></button>
              </div>
            </div>
            <div class="sound-row">
              <span class="sound-row__label" data-i18n="music"></span>
              <div class="segmented" id="music-options" role="group" data-i18n-aria="music">
                <button type="button" class="segmented__option" data-value="off" data-i18n="musicOff"></button>
                <button type="button" class="segmented__option" data-value="calm" data-i18n="musicCalm"></button>
                <button type="button" class="segmented__option" data-value="tense" data-i18n="musicTense"></button>
                <button type="button" class="segmented__option" data-value="epic" data-i18n="musicEpic"></button>
              </div>
            </div>
            <div class="sound-row">
              <span class="sound-row__label" data-i18n="volume"></span>
              <input type="range" class="volume" id="volume" min="0" max="100" step="5" data-i18n-aria="volume" />
            </div>
          </div>
          <div class="settings__section settings__section--theme">
            <span class="settings__label" data-i18n="theme"></span>
            <div class="segmented segmented--tiles" id="theme-options" role="group" data-i18n-aria="theme">
              <button type="button" class="segmented__option" data-value="clean">${themePreviewHtml("clean")}<span data-i18n="themeClean"></span></button>
              <button type="button" class="segmented__option" data-value="warzone">${themePreviewHtml("warzone")}<span data-i18n="themeWarzone"></span></button>
              <button type="button" class="segmented__option" data-value="factions">${themePreviewHtml("factions")}<span data-i18n="themeFactions"></span></button>
            </div>
            <div class="faction-menu" id="factions-section" hidden>
              ${([1, 2] as const)
                .map(
                  (player) => `
              <div class="faction-row">
                <label class="faction-row__player is-p${player}" for="p${player}-faction" data-i18n="player" data-v-n="${player}"></label>
                ${pickerHtml(`p${player}-faction`)}
                <span class="faction-row__chapter" id="p${player}-chapter-wrap" hidden>${pickerHtml(`p${player}-chapter`)}</span>
              </div>`,
                )
                .join("")}
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="btn-icon" id="btn-fullscreen">
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
      <button type="button" class="btn-primary toolbar__start" id="btn-start"><span data-i18n="start"></span> <kbd data-i18n="keyEnter"></kbd></button>
    </div>
  </header>
  <div class="board">
    ${panelHtml(1)}
    <div class="turn-tracker">
      <div class="turn-tracker__controls">
        <button type="button" class="btn-ghost strip-reset" id="btn-reset" data-i18n-title="reset">${ICON_RESET}<span data-i18n="reset"></span></button>
      </div>
      <div class="turn-tracker__round" role="group" data-i18n-aria="battleRoundAria">
        <span class="turn-tracker__label" aria-hidden="true" data-i18n="round"></span>
        <div class="turn-tracker__dots" id="turn-dots"></div>
      </div>
      <p class="key-hint" id="key-hint" aria-live="polite"></p>
    </div>
    ${panelHtml(2)}
  </div>
  <section class="seat" id="seat" aria-live="polite">
    <header class="seat-bar">
      <button type="button" class="seat-room" id="seat-room"><span class="seat-room__dot" aria-hidden="true"></span><span id="seat-code"></span></button>
      <span class="seat-bar__round" id="seat-round"></span>
    </header>
    <div class="seat-opp" id="seat-opp">
      <span class="seat-opp__name" id="seat-opp-name"></span>
      <span class="seat-opp__score"><span id="seat-opp-score">0</span> <small data-i18n="vpUnit"></small></span>
      <span class="seat-opp__time" id="seat-opp-time"></span>
      <button type="button" class="seat-opp__primary" id="seat-opp-primary" data-i18n-aria="oppPrimary" data-i18n-title="oppPrimary">${ICON_TARGET}</button>
    </div>
    <button type="button" class="seat-clock" id="seat-clock">
      <span class="seat-clock__who" id="seat-who"></span>
      <span class="time seat-clock__time" id="seat-time"></span>
      <span class="seat-clock__hint" id="seat-hint"></span>
    </button>
    <div class="seat-stats">
      <div class="seat-card seat-score">
        <div class="seat-card__head"><span data-i18n="score"></span><b id="seat-score">0</b></div>
        ${SCORE_KINDS.map(
          ({ kind, label }) => `
        <div class="seat-row">
          <span data-i18n="${label}"></span>
          <button type="button" class="mini-counter__btn" id="seat-${kind}-minus" aria-label="−">−</button>
          <b id="seat-${kind}">0</b>
          <button type="button" class="mini-counter__btn" id="seat-${kind}-plus" aria-label="+">+</button>
          ${capGaugeHtml(`seat-${kind}-cap`)}
        </div>`,
        ).join("")}
        <div class="seat-row" id="seat-bonus-row" hidden>
          <span data-i18n="endBonus"></span>
          <button type="button" class="mini-counter__btn" id="seat-bonus-minus" aria-label="−">−</button>
          <b id="seat-bonus">0</b>
          <button type="button" class="mini-counter__btn" id="seat-bonus-plus" aria-label="+">+</button>
        </div>
      </div>
      <div class="seat-card seat-cp">
        <div class="seat-card__head"><span data-i18n="commandPoints"></span></div>
        <div class="seat-cp__row">
          <button type="button" class="mini-counter__btn" id="seat-cp-minus" aria-label="−">−</button>
          <b id="seat-cp">1</b>
          <button type="button" class="mini-counter__btn" id="seat-cp-plus" aria-label="+">+</button>
        </div>
        <button type="button" class="abilities-btn" id="seat-abilities-btn" data-i18n="abilities"></button>
        <div class="seat-abilities" id="seat-abilities"></div>
      </div>
    </div>
    <div class="seat-banner" id="seat-banner" hidden>
      <span class="seat-banner__text" id="seat-banner-text"></span>
      <button type="button" class="seat-banner__btn" id="seat-banner-btn"></button>
    </div>
    <nav class="seat-actions">
      <button type="button" class="btn-secondary" id="seat-hand"><span data-i18n="secondaryHand"></span> <span class="seat-count" id="seat-hand-count">0</span></button>
      <button type="button" class="btn-secondary" id="seat-mission" data-i18n="primaryCard"></button>
      <button type="button" class="btn-secondary" id="seat-pause"></button>
      <button type="button" class="btn-primary" id="seat-end" data-i18n="seatEndTurn"></button>
    </nav>
    <div class="seat-foot">
      <button type="button" class="btn-ghost strip-reset" id="seat-reset">${ICON_RESET}<span data-i18n="reset"></span></button>
    </div>
  </section>
  <div class="overlay overlay--turn-confirm" id="turn-confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="turn-confirm-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="turn-confirm-title"></h2>
      <p class="overlay-msg" id="turn-confirm-msg"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="btn-turn-confirm-cancel"><span data-i18n="cancel"></span> <kbd data-i18n="keyEsc"></kbd></button>
        <button type="button" class="btn-primary" id="btn-turn-confirm-ok"><span data-i18n="confirm"></span> <kbd data-i18n="keyEnter"></kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--result" id="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="result-title"></h2>
      <p class="overlay-msg" id="result-msg"></p>
      <table class="result-table" id="result-table"></table>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-result-dismiss"><span data-i18n="ok"></span> <kbd data-i18n="keyEnter"></kbd></button>
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
      <span class="pause-badge" data-i18n="clocksPaused"></span>
      <h2 id="photo-title" data-i18n="photoTitle"></h2>
      <p class="overlay-msg" id="photo-msg"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-photo-resume"><span data-i18n="resumeClocks"></span> <kbd data-i18n="keyEnter"></kbd></button>
      </div>
    </div>
  </div>
  <div class="sound-toast" id="sound-toast" role="status"></div>
  <div class="overlay overlay--cards" id="cards-overlay" role="dialog" aria-modal="true" aria-labelledby="cards-title" aria-hidden="true">
    <div class="cards-stage">
      <p class="cards-kicker" id="cards-kicker"></p>
      <h2 class="cards-title" id="cards-title"></h2>
      <p class="cards-sub" id="cards-sub"></p>
      <div class="cards-caps" id="cards-caps" hidden>
        <span class="cards-caps__label" data-i18n="thisTurn"></span>
        ${SCORE_KINDS.map(({ kind, label }) => `<span class="cards-caps__item" data-kind="${kind}"><span data-i18n="${label}"></span>${capGaugeHtml()}</span>`).join("")}
      </div>
      <div class="cards-row" id="cards-row"></div>
      <div class="overlay-actions cards-actions">
        <div class="cards-switch" id="cards-switch" role="group" data-i18n-aria="switchSideAria" hidden></div>
        <button type="button" class="btn-primary" id="btn-cards-close"><span data-i18n="continue"></span> <kbd data-i18n="keyEnter"></kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--dispo" id="dispo-overlay" role="dialog" aria-modal="true" aria-labelledby="dispo-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="dispo-title" data-i18n="dispoTitle"></h2>
      <p class="overlay-msg" id="dispo-intro"></p>
      <div class="dispo-grid">
        ${([1, 2] as const)
          .map(
            (player) => `
          <div class="dispo-column is-p${player}">
            <span class="dispo-column__label" data-i18n="player" data-v-n="${player}"></span>
            <div class="dispo-options" data-player="${player}">
              ${DISPOSITIONS.map(
                (disposition) =>
                  `<button type="button" class="dispo-option" data-value="${disposition.id}" aria-pressed="false"><span class="dispo-option__name">${disposition.name}</span><span class="dispo-option__hint"></span></button>`,
              ).join("")}
            </div>
          </div>`,
          )
          .join("")}
      </div>
      <p class="overlay-msg dispo-status" id="dispo-status" hidden></p>
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="btn-dispo-cancel"><span data-i18n="cancel"></span> <kbd data-i18n="keyEsc"></kbd></button>
        <button type="button" class="btn-primary" id="btn-dispo-ok" disabled><span></span> <kbd data-i18n="keyEnter"></kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--abilities" id="abilities-overlay" role="dialog" aria-modal="true" aria-labelledby="abilities-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="abilities-title"></h2>
      <ul class="ability-list" id="ability-list"></ul>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-abilities-close"><span data-i18n="done"></span> <kbd data-i18n="keyEsc"></kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--online" id="online-overlay" role="dialog" aria-modal="true" aria-labelledby="online-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="online-title" data-i18n="onlineTitle"></h2>
      <div class="online-start" id="online-start">
        <p class="overlay-msg" data-i18n="onlineIntro"></p>
        <div class="online-seat">
          <span class="online-seat__label" data-i18n="onlinePlayAs"></span>
          <div class="segmented" id="online-seat" role="group" data-i18n-aria="onlinePlayAs">
            <button type="button" class="segmented__option is-p1" data-value="1" data-i18n="player" data-v-n="1"></button>
            <button type="button" class="segmented__option is-p2" data-value="2" data-i18n="player" data-v-n="2"></button>
          </div>
        </div>
        <button type="button" class="btn-primary online-create" id="online-create" data-i18n="onlineCreate"></button>
        <p class="online-or" data-i18n="onlineOr"></p>
        <div class="online-join">
          <input id="online-code" type="text" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" data-i18n-placeholder="onlineCode" />
          <button type="button" class="btn-secondary" id="online-join" data-i18n="onlineJoin"></button>
        </div>
      </div>
      <div class="online-room" id="online-room" hidden>
        <p class="online-code" id="online-room-code"></p>
        <div class="online-qr" id="online-qr"></div>
        <p class="overlay-msg" id="online-scan"></p>
        <p class="online-status" id="online-status"></p>
        <button type="button" class="btn-secondary" id="online-share" data-i18n="onlineShare"></button>
      </div>
      <p class="online-error" id="online-error" role="alert" hidden></p>
      <div class="overlay-actions">
        <button type="button" class="btn-ghost" id="online-leave" data-i18n="onlineLeave" hidden></button>
        <button type="button" class="btn-primary" id="online-close"><span data-i18n="done"></span> <kbd data-i18n="keyEsc"></kbd></button>
      </div>
    </div>
  </div>
`;

const themeOptions = app.querySelector<HTMLElement>("#theme-options")!;
const factionsSection = app.querySelector<HTMLElement>("#factions-section")!;
const factionPickerEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-faction")!.closest<HTMLElement>(".picker")!,
  2: app.querySelector<HTMLElement>("#p2-faction")!.closest<HTMLElement>(".picker")!,
};
const chapterPickerEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-chapter")!.closest<HTMLElement>(".picker")!,
  2: app.querySelector<HTMLElement>("#p2-chapter")!.closest<HTMLElement>(".picker")!,
};
const chapterWrap: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-chapter-wrap")!,
  2: app.querySelector<HTMLElement>("#p2-chapter-wrap")!,
};
const layoutOptions = app.querySelector<HTMLElement>("#layout-options")!;
const uiSizeOptions = app.querySelector<HTMLElement>("#ui-size-options")!;
const langOptions = app.querySelector<HTMLElement>("#lang-options")!;
const sfxOptions = app.querySelector<HTMLElement>("#sfx-options")!;
const musicOptions = app.querySelector<HTMLElement>("#music-options")!;
const volumeInput = app.querySelector<HTMLInputElement>("#volume")!;
const soundToast = app.querySelector<HTMLElement>("#sound-toast")!;
const timePresets = app.querySelector<HTMLElement>("#time-presets")!;
const btnTime = app.querySelector<HTMLButtonElement>("#btn-time")!;
const timePicker = app.querySelector<HTMLElement>("#time-picker")!;
const timeValue = app.querySelector<HTMLElement>("#time-value")!;
const btnSettings = app.querySelector<HTMLButtonElement>("#btn-settings")!;
const settingsPanel = app.querySelector<HTMLElement>("#settings-panel")!;
const btnStart = app.querySelector<HTMLButtonElement>("#btn-start")!;
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
const btnAbilitiesClose = app.querySelector<HTMLButtonElement>("#btn-abilities-close")!;
const secondaryCardsToggle = app.querySelector<HTMLInputElement>("#secondary-cards")!;
const handButtonEl: Record<Player, HTMLButtonElement> = {
  1: app.querySelector<HTMLButtonElement>("#p1-hand-btn")!,
  2: app.querySelector<HTMLButtonElement>("#p2-hand-btn")!,
};
const primaryButtonEl: Record<Player, HTMLButtonElement> = {
  1: app.querySelector<HTMLButtonElement>("#p1-primary-btn")!,
  2: app.querySelector<HTMLButtonElement>("#p2-primary-btn")!,
};
const cardButtonsEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-card-btns")!,
  2: app.querySelector<HTMLElement>("#p2-card-btns")!,
};
const cardsSwitch = app.querySelector<HTMLElement>("#cards-switch")!;
const cardsKicker = app.querySelector<HTMLElement>("#cards-kicker")!;
const cardsCaps = app.querySelector<HTMLElement>("#cards-caps")!;
const cardsOverlay = app.querySelector<HTMLElement>("#cards-overlay")!;
const cardsTitle = app.querySelector<HTMLElement>("#cards-title")!;
const cardsSub = app.querySelector<HTMLElement>("#cards-sub")!;
const cardsRow = app.querySelector<HTMLElement>("#cards-row")!;
const btnCardsClose = app.querySelector<HTMLButtonElement>("#btn-cards-close")!;
const dispoOverlay = app.querySelector<HTMLElement>("#dispo-overlay")!;
const btnDispoOk = app.querySelector<HTMLButtonElement>("#btn-dispo-ok")!;
const btnDispoCancel = app.querySelector<HTMLButtonElement>("#btn-dispo-cancel")!;
const dispoIntro = app.querySelector<HTMLElement>("#dispo-intro")!;
const dispoStatus = app.querySelector<HTMLElement>("#dispo-status")!;
const turnEndAlertEl: Record<Player, HTMLButtonElement> = {
  1: app.querySelector<HTMLButtonElement>("#p1-turn-end-alert")!,
  2: app.querySelector<HTMLButtonElement>("#p2-turn-end-alert")!,
};
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
const btnOnline = app.querySelector<HTMLButtonElement>("#btn-online")!;
const seatClock = app.querySelector<HTMLButtonElement>("#seat-clock")!;
const seatTime = app.querySelector<HTMLElement>("#seat-time")!;
const seatOppTime = app.querySelector<HTMLElement>("#seat-opp-time")!;
const seatAbilities = app.querySelector<HTMLElement>("#seat-abilities")!;
const onlineOverlay = app.querySelector<HTMLElement>("#online-overlay")!;
const onlineSeatPicker = app.querySelector<HTMLElement>("#online-seat")!;
const onlineCodeInput = app.querySelector<HTMLInputElement>("#online-code")!;
const onlineError = app.querySelector<HTMLElement>("#online-error")!;

/** Everything both players share: see game.ts. The rest of this file is the screen */
let game: GameState = newGame();

/** Online, this phone is one player's: its seat, and the room once connected */
let online: { seat: Player; room: Room | null; connected: boolean; seats: Record<Player, boolean> } | null = null;

/** A clock runs */
const isRunning = (): boolean => game.phase === "running";
/** The result is known; only Reset starts a new game */
const isOver = (): boolean => game.phase === "over";

/** Seconds left on a player's clock, now */
const timeLeft = (player: Player): number => secondsLeft(game.clock, player);

const primaryCard = (player: Player): PrimaryCard | null => {
  const id = game.primaries[player];
  return id === null ? null : PRIMARY_BY_ID.get(id)!;
};

let raf = 0;

let wakeLock: WakeLockSentinel | null = null;

/** Last Space keydown (ms); used for double-tap pause */
let lastSpaceTime = 0;
/** Active player before the first Space of a potential double-tap (restored on double-pause) */
let activeBeforeSpaceSequence: Player = 1;
const DOUBLE_SPACE_MS = 380;

const scoreOf = (player: Player, kind?: ScoreKind): number => scoreOfGame(game, player, kind);
const scoringTurnIdx = (player: Player): number => scoringTurnIdxOf(game, player);

/** Whose abilities panel is open */
let abilitiesPlayer: Player | null = null;
/** Unit just struck or restored on the board, until the mouse leaves it */
let settlingAbilityId: number | null = null;
/** Unit whose strike / restore animation plays on the next render only */
let justToggledId: number | null = null;

type TurnConfirmKind = "start-game" | "p1-to-p2" | "next-round" | "finish-game" | "reset" | "unscore";

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
    turnConfirmTitle.textContent = t("startTitle");
    turnConfirmMsg.textContent = game.options.photoBreaks ? `${t("startMsg")} ${t("photoBreaksOn")}` : t("startMsg");
  } else if (kind === "p1-to-p2") {
    turnConfirmTitle.textContent = t("endTurnTitle");
    turnConfirmMsg.textContent = t("endTurnMsg");
  } else if (kind === "finish-game") {
    turnConfirmTitle.textContent = t("finishTitle");
    turnConfirmMsg.textContent = t("finishMsg", { n: MAX_GAME_TURN });
  } else if (kind === "reset") {
    turnConfirmTitle.textContent = t("resetTitle");
    turnConfirmMsg.textContent = t("resetMsg");
  } else if (kind === "unscore") {
    const scored = pendingUnscore && game.secondaries[pendingUnscore.player].scored.find(({ id }) => id === pendingUnscore?.id);
    turnConfirmTitle.textContent = t("unscoreTitle", { card: scored ? SECONDARY_BY_ID.get(scored.id)!.name : "" });
    turnConfirmMsg.textContent = t("unscoreMsg", { vp: scored?.vp ?? 0, unit: t("vpUnit"), n: (scored?.turn ?? 0) + 1 });
  } else {
    turnConfirmTitle.textContent = t("nextRoundTitle", { n: game.round + 1 });
    turnConfirmMsg.textContent = t("nextRoundMsg");
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
      `<tr><th scope="row">${t("turnN", { n: i + 1 })}</th>${cells(game.scoreByTurn[1].primary[i], game.scoreByTurn[1].secondary[i])}${cells(game.scoreByTurn[2].primary[i], game.scoreByTurn[2].secondary[i])}</tr>`,
  ).join("");
  resultTable.innerHTML = `
    <thead>
      <tr>
        <th rowspan="2"></th>
        <th scope="colgroup" colspan="2" class="is-group is-p1">${t("player", { n: 1 })}</th>
        <th scope="colgroup" colspan="2" class="is-group is-p2">${t("player", { n: 2 })}</th>
      </tr>
      <tr class="result-table__kinds">
        <th scope="col" class="is-group">${t("pri")}</th><th scope="col">${t("sec")}</th>
        <th scope="col" class="is-group">${t("pri")}</th><th scope="col">${t("sec")}</th>
      </tr>
    </thead>
    <tbody>${roundRows}${
      game.endBonus[1] || game.endBonus[2]
        ? `<tr class="result-table__bonus"><th scope="row">${t("endBonus")}</th><td class="is-group">${game.endBonus[1]}</td><td>–</td><td class="is-group">${game.endBonus[2]}</td><td>–</td></tr>`
        : ""
    }</tbody>
    <tfoot>
      <tr class="result-table__subtotal"><th scope="row">${t("subtotal")}</th>${cells(scoreOf(1, "primary"), scoreOf(1, "secondary"))}${cells(scoreOf(2, "primary"), scoreOf(2, "secondary"))}</tr>
      <tr class="result-table__total"><th scope="row">${t("total")}</th><td colspan="2" class="is-group">${scoreOf(1)}</td><td colspan="2" class="is-group">${scoreOf(2)}</td></tr>
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
  game.phase = "over";
  stopClock(game.clock);
  lastSpaceTime = 0;
  stopLoop();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
  const total1 = scoreOf(1);
  const total2 = scoreOf(2);
  setBattleMusic(false);
  playSound("victory");
  if (total1 > total2) showResultOverlay(t("wins", { n: 1 }), t("wonOnPoints"), 1);
  else if (total2 > total1) showResultOverlay(t("wins", { n: 2 }), t("wonOnPoints"), 2);
  else showResultOverlay(t("draw"), t("tiedOnPoints"), null);
}

function applyTurnConfirm(): void {
  if (turnConfirmKind === null) return;
  const kind = turnConfirmKind;
  hideTurnConfirmModal();
  if (isTurnEndKind(kind)) endTurn(kind);
  else applyConfirmed(kind);
}

const isTurnEndKind = (kind: TurnConfirmKind | null): kind is TurnEndKind =>
  kind === "p1-to-p2" || kind === "next-round" || kind === "finish-game";

/**
 * Online, the turn ends on the phone of the player whose turn it is, while the opponent's
 * end-of-turn cards are on the other phone: when it has some, the turn waits for it. That phone
 * opens them, and the turn passes once they are scored there. `force`: the player whose turn it is
 * stops waiting (the other phone is away)
 */
function endTurn(kind: TurnEndKind, force = false): void {
  const opponent = other(game.turnPlayer);
  const waits =
    !force &&
    !!online &&
    game.turnEnd === null &&
    online.seat !== opponent &&
    online.seats[opponent] &&
    secondaryCardsOn() &&
    turnEndCountAt(opponent, kind) > 0;
  if (waits) {
    game.turnEnd = { kind, scorer: opponent };
    renderSeat();
    return;
  }
  game.turnEnd = null;
  applyConfirmed(kind);
}

/** What a player has to score at a turn end of this kind (the end of the battle adds its own) */
function turnEndCountAt(owner: Player, kind: TurnEndKind): number {
  const before = endTurnKind;
  endTurnKind = kind;
  const count = turnEndCount(owner);
  endTurnKind = before;
  return count;
}

/** On the opponent's phone: the cards that score at the end of the turn that waits for them */
function openTurnEndScoring(): void {
  const pending = game.turnEnd;
  if (!online || pending?.scorer !== online.seat) return;
  endTurnKind = pending.kind;
  endTurnSides = [online.seat];
  openCards(online.seat, "end-turn");
  navigator.vibrate?.([120, 80, 120]);
}

/**
 * The line above the actions on a phone: during the opponent's turn, what this player can score
 * when it ends; then, the turn end waiting for this phone, or the wait for the other one
 */
function renderSeatBanner(me: Player): void {
  const banner = app.querySelector<HTMLElement>("#seat-banner")!;
  const pending = game.turnEnd;
  const due = inGame(game) && !isOver() && secondaryCardsOn() && me !== game.turnPlayer ? turnEndCount(me) : 0;
  let state = "";
  let text = "";
  let action = "";
  if (pending?.scorer === me) {
    state = "score";
    text = t("seatScoreNow", { n: game.turnPlayer });
    action = t("seatScoreBtn");
  } else if (pending) {
    state = "wait";
    text = t("seatWaiting", { n: pending.scorer });
    action = t("seatEndAnyway");
  } else if (due > 0) {
    state = "alert";
    text = t("turnEndAlert", { n: due });
    action = t("seatSee");
  }
  banner.hidden = state === "";
  banner.dataset.state = state;
  app.querySelector<HTMLElement>("#seat-banner-text")!.textContent = text;
  app.querySelector<HTMLElement>("#seat-banner-btn")!.textContent = action;
}

function applyConfirmed(kind: TurnConfirmKind): void {
  if (kind === "unscore") {
    if (pendingUnscore) restoreSecondary(pendingUnscore.player, pendingUnscore.id);
    pendingUnscore = null;
    return;
  }
  if (kind === "start-game") {
    start();
    return;
  }
  if (kind === "p1-to-p2") {
    turnSound("turn");
    game.turnPlayer = 2;
    gainCpBothPlayers();
    applyAbilityCp(2, ["turn-cp"]);
    setActiveClock(game.clock, 2);
    setActivePanels();
    if (game.options.photoBreaks) startPhotoBreak();
    startTurnSecondaries(2);
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
  turnSound("round");
  if (game.options.photoBreaks) startPhotoBreak();
  startTurnSecondaries(1);
}

/**
 * The blow that opens the game, a turn or a round. With the cards, the game opens on the VS
 * and its own hit, and each turn on a draw: the cards swish in, no blow over a screen that
 * shows none
 */
function turnSound(name: "start" | "turn" | "round"): void {
  if (!secondaryCardsOn()) playSound(name);
}

function startPhotoBreak(): void {
  game.photoBreak = true;
  stopClock(game.clock);
  showPhotoBreak();
}

/** The photo break on screen: also when it was started on the other phone */
function showPhotoBreak(): void {
  playSound("photo");
  stopLoop();
  app.classList.add("is-photo-break");
  photoMsg.textContent = t("photoMsg", { n: game.turnPlayer });
  photoOverlay.classList.add("is-visible");
  photoOverlay.setAttribute("aria-hidden", "false");
  btnPhotoResume.focus();
}

function endPhotoBreak(): void {
  if (!game.photoBreak) return;
  game.photoBreak = false;
  if (isRunning()) runClock(game.clock);
  hidePhotoBreak();
}

function hidePhotoBreak(): void {
  app.classList.remove("is-photo-break");
  photoOverlay.classList.remove("is-visible");
  photoOverlay.setAttribute("aria-hidden", "true");
  if (isRunning() && game.clock.since !== null) startLoop();
  if (pendingDraw) {
    openCards(pendingDraw.player, "draw", pendingDraw.drawn);
    pendingDraw = null;
  }
}

function readMinutes(): { a: number; b: number } {
  return {
    a: Math.max(0, Number(m1.value) || 0),
    b: Math.max(0, Number(m2.value) || 0),
  };
}

/** A row of buttons acting as one choice: the chosen one is aria-pressed */
function setSegmentedValue(group: HTMLElement, value: string): void {
  group.querySelectorAll<HTMLButtonElement>(".segmented__option").forEach((option) => {
    option.setAttribute("aria-pressed", String(option.dataset.value === value));
  });
}

function onSegmentedPick(group: HTMLElement, pick: (value: string) => void): void {
  group.addEventListener("click", (e) => {
    const option = (e.target as HTMLElement).closest<HTMLButtonElement>(".segmented__option");
    if (option?.dataset.value && !option.disabled) pick(option.dataset.value);
  });
}

let timePreset = String(DEFAULT_TIME_SEC);

function setTimePreset(value: string): void {
  timePreset = value;
  setSegmentedValue(timePresets, value);
  updateManualInputsVisibility();
  renderTimeValue();
}

/** "2h", "1h45", "50min" */
function formatDuration(totalSeconds: number): string {
  const total = Math.round(totalSeconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

function renderTimeValue(): void {
  const [a, b] = [timeLeft(1), timeLeft(2)];
  timeValue.textContent = a === b ? formatDuration(a) : `${formatDuration(a)} · ${formatDuration(b)}`;
}

/** Setup bar menus: closed by a click outside or Escape */
const POPOVERS: [HTMLButtonElement, HTMLElement][] = [[btnSettings, settingsPanel]];

/**
 * The time choices unfold over the bar on hover (or keyboard focus). Once a time is
 * picked they fold back, until the mouse leaves and comes back.
 */
function foldTimePicker(): void {
  timePicker.classList.add("is-folded");
  if (timePicker.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}

function closePopovers(): void {
  closePicker();
  for (const [button, panel] of POPOVERS) {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
}

function togglePopover(button: HTMLButtonElement, panel: HTMLElement): void {
  const open = panel.hidden;
  closePopovers();
  panel.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

const UI_SIZES = new Set(["s", "m", "l", "xl", "uw"]);
const LAYOUTS = new Set(["rows", "columns"]);
const THEMES = new Set(["clean", "warzone", "factions"]);

function applyTheme(theme: string): void {
  const v = THEMES.has(theme) ? theme : THEME_DEFAULT;
  document.documentElement.dataset.theme = v;
  setSegmentedValue(themeOptions, v);
  factionsSection.hidden = v !== "factions";
  try {
    localStorage.setItem(THEME_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
}

/** On <html> for the player colors used everywhere, on the panel for its own decor */
function applyFaction(player: Player, id: string): void {
  const faction = FACTION_BY_ID.get(id) ?? FACTION_BY_ID.get(FACTION_DEFAULTS[player])!;
  factionOf = { ...factionOf, [player]: faction.id };
  const root = document.documentElement.style;
  root.setProperty(`--fx${player}`, faction.color);
  root.setProperty(`--fx${player}-time`, faction.time);
  const panel = player === 1 ? panel1 : panel2;
  panel.dataset.band = faction.band;
  panel.dataset.texture = faction.texture;
  panel.style.setProperty("--fx-a", faction.color);
  panel.style.setProperty("--fx-b", faction.accent);
  showFactionChoice(player);
  try {
    localStorage.setItem(factionStorageKey(player), faction.id);
  } catch {
    /* quota / private mode */
  }
}

/** A chapter shows as Space Marines in the first list, the chapter itself in the second */
function showFactionChoice(player: Player): void {
  const faction = FACTION_BY_ID.get(factionOf[player])!;
  setPickerValue(factionPickerEl[player], faction.chapter ? { ...faction, name: SPACE_MARINES_NAME } : faction);
  setPickerValue(chapterPickerEl[player], faction);
  chapterWrap[player].hidden = !faction.chapter;
}

function refreshFactionPickers(): void {
  closePicker();
  showFactionChoice(1);
  showFactionChoice(2);
}

type PickerOption = { value: string; name: string; color: string; accent: string };
type PickerGroup = { label: string; options: PickerOption[] };
type Picker = { root: HTMLElement; groups: () => PickerGroup[]; selected: () => string; pick: (value: string) => void };

const toPickerOption = ({ id, name, color, accent }: { id: string; name: Text; color: string; accent: string }): PickerOption => ({
  value: id,
  name: name[getLang()],
  color,
  accent,
});

const byLocalName = (a: { name: Text }, b: { name: Text }): number =>
  a.name[getLang()].localeCompare(b.name[getLang()], getLang());

/** Factions by group, in the language's order; Space Marines is one entry, its chapters a second list */
function factionGroups(): PickerGroup[] {
  const spaceMarines = { ...FACTION_BY_ID.get(SPACE_MARINES)!, name: SPACE_MARINES_NAME };
  return FACTION_GROUPS.map(({ group, label }) => ({
    label: t(label),
    options: [
      ...FACTIONS.filter((faction) => faction.group === group && !faction.chapter),
      ...(group === "imperium" ? [spaceMarines] : []),
    ]
      .sort(byLocalName)
      .map(toPickerOption),
  }));
}

/** "Other chapter" closes the list, after the named chapters */
function chapterGroups(): PickerGroup[] {
  const chapters = FACTIONS.filter(({ chapter }) => chapter).sort(
    (a, b) => Number(a.id === SPACE_MARINES) - Number(b.id === SPACE_MARINES) || byLocalName(a, b),
  );
  return [{ label: "", options: chapters.map(toPickerOption) }];
}

const factionPickers: Picker[] = ([1, 2] as const).flatMap((player) => [
  {
    root: factionPickerEl[player],
    groups: factionGroups,
    selected: () => (FACTION_BY_ID.get(factionOf[player])!.chapter ? SPACE_MARINES : factionOf[player]),
    pick: (value: string) => {
      // Space Marines again keeps the chapter already chosen
      if (value === SPACE_MARINES && FACTION_BY_ID.get(factionOf[player])!.chapter) return;
      applyFaction(player, value === SPACE_MARINES ? DEFAULT_CHAPTER : value);
    },
  },
  {
    root: chapterPickerEl[player],
    groups: chapterGroups,
    selected: () => factionOf[player],
    pick: (value: string) => applyFaction(player, value),
  },
]);

/* ---------- Pickers: the list opens upward, over the menu above it ---------- */

let openPicker: Picker | null = null;

const pickerButton = (picker: Picker): HTMLButtonElement => picker.root.querySelector<HTMLButtonElement>(".picker__button")!;
const pickerList = (picker: Picker): HTMLElement => picker.root.querySelector<HTMLElement>(".picker__list")!;
const pickerOptions = (picker: Picker): HTMLElement[] => [...pickerList(picker).querySelectorAll<HTMLElement>('[role="option"]')];

function swatchEl({ color, accent }: { color: string; accent: string }): HTMLElement {
  const swatch = document.createElement("span");
  swatch.className = "picker__swatch";
  swatch.style.setProperty("--sw-a", color);
  swatch.style.setProperty("--sw-b", accent);
  return swatch;
}

function setPickerValue(root: HTMLElement, value: { name: Text; color: string; accent: string }): void {
  root.querySelector(".picker__label")!.textContent = value.name[getLang()];
  root.querySelector(".picker__swatch")!.replaceWith(swatchEl(value));
}

function openPickerList(picker: Picker): void {
  closePicker();
  const selected = picker.selected();
  const items = picker.groups().flatMap(({ label, options }) => {
    const rows = options.map((option) => {
      const row = document.createElement("div");
      row.className = "picker__option";
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(option.value === selected));
      row.tabIndex = -1;
      row.dataset.value = option.value;
      row.style.setProperty("--sw-a", option.color);
      const name = document.createElement("span");
      name.textContent = option.name;
      row.append(swatchEl(option), name);
      return row;
    });
    if (!label) return rows;
    // Each group holds its header, which stays on top while its own factions scroll by
    const section = document.createElement("div");
    section.setAttribute("role", "group");
    section.setAttribute("aria-label", label);
    const header = document.createElement("div");
    header.className = "picker__group";
    header.setAttribute("aria-hidden", "true");
    header.textContent = label;
    section.append(header, ...rows);
    return [section];
  });
  const list = pickerList(picker);
  list.replaceChildren(...items);
  list.hidden = false;
  pickerButton(picker).setAttribute("aria-expanded", "true");
  openPicker = picker;
  const options = pickerOptions(picker);
  focusPickerOption(options.find((row) => row.getAttribute("aria-selected") === "true") ?? options[0]);
}

function closePicker(refocus = false): void {
  if (!openPicker) return;
  const picker = openPicker;
  openPicker = null;
  pickerList(picker).hidden = true;
  pickerButton(picker).setAttribute("aria-expanded", "false");
  if (refocus) pickerButton(picker).focus();
}

function focusPickerOption(row: HTMLElement | undefined): void {
  if (!row) return;
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}

function choosePickerOption(picker: Picker, value: string): void {
  picker.pick(value);
  closePicker(true);
}

const foldAccents = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Arrows, Home and End move, Enter or Space picks, Escape closes, a letter jumps to the next name with it */
function onPickerKey(picker: Picker, e: KeyboardEvent): void {
  const options = pickerOptions(picker);
  const index = options.indexOf(document.activeElement as HTMLElement);
  const at = (i: number): HTMLElement => options[Math.max(0, Math.min(options.length - 1, i))];
  if (e.key === "Tab") {
    closePicker();
    return;
  }
  if (e.key === "ArrowDown") focusPickerOption(at(index + 1));
  else if (e.key === "ArrowUp") focusPickerOption(at(index - 1));
  else if (e.key === "Home") focusPickerOption(at(0));
  else if (e.key === "End") focusPickerOption(at(options.length - 1));
  else if ((e.key === "Enter" || e.key === " ") && index >= 0) choosePickerOption(picker, options[index].dataset.value!);
  else if (e.key === "Escape") closePicker(true);
  else if (e.key.length === 1 && /\p{L}/u.test(e.key)) {
    const letter = foldAccents(e.key);
    const after = [...options.slice(index + 1), ...options.slice(0, index + 1)];
    focusPickerOption(after.find((row) => foldAccents(row.textContent ?? "").startsWith(letter)));
  } else return;
  e.preventDefault();
  e.stopPropagation();
}

function loadFactions(): void {
  for (const player of [1, 2] as const) {
    let stored = FACTION_DEFAULTS[player];
    try {
      stored = localStorage.getItem(factionStorageKey(player)) ?? stored;
    } catch {
      /* ignore */
    }
    applyFaction(player, stored);
  }
}

function loadTheme(): void {
  let stored = THEME_DEFAULT;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY) ?? THEME_DEFAULT;
  } catch {
    /* ignore */
  }
  applyTheme(stored);
}

/** Set on <html> so the tooltips, appended to <body>, scale too */
function applyUiSize(size: string): void {
  const v = UI_SIZES.has(size) ? size : UI_SIZE_DEFAULT;
  document.documentElement.dataset.uiSize = v;
  setSegmentedValue(uiSizeOptions, v);
  try {
    localStorage.setItem(UI_SIZE_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function forget(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applySounds(value: string): void {
  const on = value === "on";
  setSoundsOn(on);
  setSegmentedValue(sfxOptions, on ? "on" : "off");
  store(SOUNDS_STORAGE_KEY, on ? "on" : "off");
}

function applyMusic(value: string): void {
  const track = MUSIC_TRACKS.find((name) => name === value) ?? "off";
  setMusic(track);
  setSegmentedValue(musicOptions, track);
  store(MUSIC_STORAGE_KEY, track);
}

function applyVolume(value: number): void {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : VOLUME_DEFAULT;
  setVolume(v / 100);
  volumeInput.value = String(v);
  volumeInput.style.setProperty("--fill", `${v}%`);
  store(VOLUME_STORAGE_KEY, String(v));
}

function loadSound(): void {
  applySounds(stored(SOUNDS_STORAGE_KEY) ?? "off");
  applyVolume(Number(stored(VOLUME_STORAGE_KEY) ?? VOLUME_DEFAULT));
  applyMusic(stored(MUSIC_STORAGE_KEY) ?? "off");
}

let soundToastTimer = 0;

/** A short line at the bottom of the screen */
function showToast(text: string): void {
  soundToast.textContent = text;
  soundToast.classList.add("is-visible");
  window.clearTimeout(soundToastTimer);
  soundToastTimer = window.setTimeout(() => soundToast.classList.remove("is-visible"), 1400);
}

function toggleMute(): void {
  setMuted(!isMuted());
  showToast(t(isMuted() ? "soundMuted" : "soundOn"));
}

function loadUiSize(): void {
  let stored = UI_SIZE_DEFAULT;
  try {
    stored = localStorage.getItem(UI_SIZE_STORAGE_KEY) ?? UI_SIZE_DEFAULT;
  } catch {
    /* ignore */
  }
  applyUiSize(stored);
}

function isLang(value: string): value is Lang {
  return value === "en" || value === "fr";
}

/** Fills every element that carries a translation key, with its data-v-* placeholders */
function applyTranslations(): void {
  document.documentElement.lang = getLang();
  app
    .querySelectorAll<HTMLElement>("[data-i18n], [data-i18n-aria], [data-i18n-title], [data-i18n-placeholder]")
    .forEach((el) => {
      const { i18n, i18nAria, i18nTitle, i18nPlaceholder, ...rest } = el.dataset;
      const vars = Object.fromEntries(
        Object.entries(rest)
          .filter(([name]) => /^v[A-Z]/.test(name))
          .map(([name, value]) => [name.charAt(1).toLowerCase() + name.slice(2), value ?? ""]),
      );
      if (i18n) el.textContent = t(i18n as StringKey, vars);
      if (i18nAria) el.setAttribute("aria-label", t(i18nAria as StringKey, vars));
      if (i18nTitle) el.title = t(i18nTitle as StringKey, vars);
      if (i18nPlaceholder) el.setAttribute("placeholder", t(i18nPlaceholder as StringKey, vars));
    });
}

function applyLang(value: string): void {
  setLang(isLang(value) ? value : "en");
  setSegmentedValue(langOptions, getLang());
  try {
    localStorage.setItem(LANG_STORAGE_KEY, getLang());
  } catch {
    /* quota / private mode */
  }
  applyTranslations();
  refreshFactionPickers();
  renderKeyHint();
  renderTurnDots();
  renderMiniCounters();
  renderAbilities(1);
  renderAbilities(2);
  renderCards();
  renderDispositions();
  syncFullscreenLabel();
  renderSeat();
  renderOnlineDialog();
}

function loadLang(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  // First visit: follow the browser language
  const initial = stored ?? (navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en");
  applyLang(initial);
}

function applyLayout(layout: string): void {
  const v = LAYOUTS.has(layout) ? layout : LAYOUT_DEFAULT;
  document.documentElement.dataset.layout = v;
  setSegmentedValue(layoutOptions, v);
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
  applyLayout(stored);
}

function updateManualInputsVisibility(): void {
  manualTimeWrap.hidden = timePreset !== CUSTOM_PRESET_VALUE;
}

function syncPresetSelectFromState(): void {
  if (timeLeft(1) !== timeLeft(2)) {
    setTimePreset(CUSTOM_PRESET_VALUE);
    return;
  }
  const match = PRESETS.find((p) => p.sec === timeLeft(1));
  setTimePreset(match ? String(match.sec) : CUSTOM_PRESET_VALUE);
}

function applyPresetSeconds(totalSeconds: number): void {
  const min = Math.round(totalSeconds / 60);
  m1.value = String(min);
  m2.value = String(min);
  game.clock.left = { 1: totalSeconds, 2: totalSeconds };
  applyTimesToDisplay();
  syncPresetSelectFromState();
}

function syncInputsFromState(): void {
  m1.value = String(Math.round(timeLeft(1) / 60));
  m2.value = String(Math.round(timeLeft(2) / 60));
}

/** The hour digit is dimmed under an hour, like an unlit segment. */
function renderTime(el: HTMLElement, totalSeconds: number): void {
  const [h, m, s] = formatTime(totalSeconds).split(":");
  el.innerHTML = `<span class="time__h${h === "0" ? " is-zero" : ""}">${h}:</span>${m}:${s}`;
}

function applyTimesToDisplay(): void {
  renderTime(t1, timeLeft(1));
  renderTime(t2, timeLeft(2));
  renderSeatTimes();
}

function setActivePanels(): void {
  if (!isRunning()) {
    panel1.classList.remove("is-active", "is-idle");
    panel2.classList.remove("is-active", "is-idle");
    // Keep showing whose player turn it is while the clocks are paused
    panel1.classList.toggle("is-turn", game.phase === "paused" && game.turnPlayer === 1);
    panel2.classList.toggle("is-turn", game.phase === "paused" && game.turnPlayer === 2);
    return;
  }
  const activePanel = game.clock.active === 1 ? panel1 : panel2;
  const idlePanel = game.clock.active === 1 ? panel2 : panel1;
  activePanel.classList.add("is-active");
  activePanel.classList.remove("is-idle");
  idlePanel.classList.remove("is-active");
  idlePanel.classList.add("is-idle");
  panel1.classList.toggle("is-turn", game.turnPlayer === 1);
  panel2.classList.toggle("is-turn", game.turnPlayer === 2);
  renderSeat();
}

function setInputsEnabled(on: boolean): void {
  btnTime.disabled = !on;
  m1.disabled = !on;
  m2.disabled = !on;
  photoBreaksToggle.disabled = !on;
  secondaryCardsToggle.disabled = !on;
}

function renderKeyHint(): void {
  const enter = `<kbd>${t("keyEnter")}</kbd>`;
  const space = `<kbd>${t("keySpace")}</kbd>`;
  const sep = '<span class="key-hint__sep"></span>';
  if (isRunning()) {
    const hand = secondaryCardsOn()
      ? ` ${sep} <kbd>${HAND_KEY}</kbd> ${t("hintHand")} <kbd>${PRIMARY_KEY}</kbd> ${t("hintPrimary")}`
      : "";
    keyHint.innerHTML = `${enter} ${t("hintEndTurn")} ${sep} ${space} ${t("hintSwitch")} ${sep} ${space}${space} ${t("hintPause")}${hand}`;
  } else if (isOver()) {
    keyHint.innerHTML = `<span class="key-hint__status">${t("gameOver")}</span> ${t("hintPlayAgain")}`;
  } else if (isStopped(game)) {
    keyHint.innerHTML = `<span class="key-hint__status">${t("paused")}</span> ${space} ${t("hintResume")}`;
  } else {
    keyHint.innerHTML = `${enter} ${t("hintStart")}`;
  }
}

function updateButtons(): void {
  /* Start / pause are keyboard-driven only (Enter / Space / double-space). */
  app.classList.toggle("match-started", inGame(game));
  app.classList.toggle("is-paused", game.phase === "paused");
  app.classList.toggle("is-game-over", isOver());
  renderKeyHint();
  renderSeat();
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

function warnIfLow(before: number, after: number): void {
  if (TIME_WARNINGS_SEC.some((limit) => before > limit && after <= limit)) playSound("warning");
}

/** Time left on each clock at the previous frame, to ring the warnings as it goes under them */
let lastSeenLeft: Record<Player, number> = { 1: 0, 2: 0 };

/** Rings the warnings and ends the game when the running clock is out. Returns true if it ended */
function checkClock(): boolean {
  const player = game.clock.active;
  const left = timeLeft(player);
  warnIfLow(lastSeenLeft[player], left);
  lastSeenLeft[player] = left;
  if (left > 0) return false;
  stopClock(game.clock);
  game.clock.left[player] = 0;
  endGame(other(player));
  return true;
}

/**
 * After screen lock / sleep, rAF may not run. The time left comes from the wall clock,
 * so one check puts the screen right when the tab is active again.
 */
function refreshClock(): void {
  if (!isRunning() || game.clock.since === null) return;
  if (checkClock()) return;
  applyTimesToDisplay();
}

function tick(): void {
  if (!isRunning() || game.clock.since === null) return;
  if (checkClock()) return;
  applyTimesToDisplay();
  raf = requestAnimationFrame(tick);
}

/** Draws the running clock every frame; the time itself comes from game.clock */
function startLoop(): void {
  cancelAnimationFrame(raf);
  lastSeenLeft = { 1: timeLeft(1), 2: timeLeft(2) };
  raf = requestAnimationFrame(tick);
}

function stopLoop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
}

function switchTurn(): void {
  if (!isRunning()) return;
  playSound("switch");
  setActiveClock(game.clock, other(game.clock.active));
  setActivePanels();
}

function endGame(winner: Player): void {
  game.phase = "over";
  stopClock(game.clock);
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
  const loser = other(winner);
  setBattleMusic(false);
  playSound("victory");
  showResultOverlay(t("wins", { n: winner }), t("ranOutOfTime", { n: loser }), winner);
  panel1.classList.toggle("is-flag", timeLeft(1) <= 0);
  panel2.classList.toggle("is-flag", timeLeft(2) <= 0);
}

/** The clocks as set in the bar, stopped, Player 1's first */
function clockFromInputs(): GameState["clock"] {
  const { a, b } = readMinutes();
  return { left: { 1: a * 60, 2: b * 60 }, active: 1, since: null };
}

function start(): void {
  closePopovers();
  hideTurnConfirmModal();
  hideResultOverlay();
  game.phase = "setup";
  game.clock = clockFromInputs();
  if (timeLeft(1) <= 0 || timeLeft(2) <= 0) return;
  game.turnPlayer = 1;
  lastSpaceTime = 0;
  game.phase = "running";
  game.choosing = false;
  runClock(game.clock);
  game.cp = { 1: 1, 2: 1 };
  game.cpHistory = { 1: emptyCpHistory(), 2: emptyCpHistory() };
  renderMiniCounters();
  startRoundAbilities();
  setInputsEnabled(false);
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
  void tryAcquireWakeLock();
  startLoop();
  turnSound("start");
  setBattleMusic(true);
  game.secondaries = { 1: newSecondaryPile(), 2: newSecondaryPile() };
  game.newCardUsed = { 1: false, 2: false };
  startTurnSecondaries(1);
}

function pause(): void {
  game.phase = "paused";
  stopClock(game.clock);
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
}

function reset(): void {
  setBattleMusic(false);
  game.phase = "setup";
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  hideResultOverlay();
  game.round = 1;
  game.clock = clockFromInputs();
  game.turnPlayer = 1;
  panel1.classList.remove("is-flag");
  panel2.classList.remove("is-flag");
  setInputsEnabled(true);
  applyTimesToDisplay();
  syncPresetSelectFromState();
  setActivePanels();
  updateButtons();
  renderTurnDots();
  endPhotoBreak();
  game.scoreByTurn = { 1: emptyTurnScores(), 2: emptyTurnScores() };
  game.endBonus = { 1: 0, 2: 0 };
  game.cp = { 1: 1, 2: 1 };
  game.cpHistory = { 1: emptyCpHistory(), 2: emptyCpHistory() };
  pendingDraw = null;
  afterPutAway = null;
  closeCards(false);
  game.choosing = false;
  game.turnEnd = null;
  game.primaries = { 1: null, 2: null };
  game.primaryScored = { 1: {}, 2: {} };
  game.secondaries = { 1: newSecondaryPile(), 2: newSecondaryPile() };
  game.newCardUsed = { 1: false, 2: false };
  renderMiniCounters();
  closeAbilities();
  for (const player of [1, 2] as const) {
    game.bonusCpGained[player] = false;
    for (const ability of game.abilities[player]) {
      ability.lost = false;
      ability.spent = false;
    }
    renderAbilities(player);
  }
  // A new version of the app, downloaded during the game, comes in with the empty board
  applyUpdateIfIdle();
}

function renderMiniCounters(): void {
  for (const player of [1, 2] as const) {
    // Primary and secondary add up the whole game, as the total does; the gauges show this turn against its 15
    const turnIdx = scoringTurnIdx(player);
    const turns = game.scoreByTurn[player];
    scoreTotalEl[player].textContent = String(scoreOf(player));
    for (const { kind } of SCORE_KINDS) {
      const thisTurn = turns[kind][turnIdx];
      app.querySelector<HTMLElement>(`#p${player}-${kind}-val`)!.textContent = String(sum(turns[kind]));
      setCapGauge(app.querySelector<HTMLElement>(`#p${player}-${kind}-cap`)!, thisTurn, turnIdx, true);
      // The −/+ still act on this turn only, within its 15 points
      app.querySelector<HTMLButtonElement>(`#p${player}-${kind}-minus`)!.disabled = thisTurn === 0;
      const plus = app.querySelector<HTMLButtonElement>(`#p${player}-${kind}-plus`)!;
      plus.disabled = thisTurn >= MAX_POINTS_PER_TURN;
      plus.title = plus.disabled ? t("maxPerTurn", { max: MAX_POINTS_PER_TURN }) : "";
    }
    // Primary + secondary + bonus always make the total: once scored, the bonus stays in view
    const playing = inGame(game);
    app.querySelector<HTMLElement>(`#p${player}-bonus-row`)!.hidden =
      game.endBonus[player] === 0 && (!playing || turnIdx !== MAX_GAME_TURN - 1);
    // Outside a game the bonus is only read, as before
    app.querySelector<HTMLButtonElement>(`#p${player}-bonus-minus`)!.disabled = !playing || game.endBonus[player] === 0;
    app.querySelector<HTMLButtonElement>(`#p${player}-bonus-plus`)!.disabled = !playing;
    app.querySelector<HTMLElement>(`#p${player}-bonus-val`)!.textContent = String(game.endBonus[player]);
  }
  p1CpVal.textContent = String(game.cp[1]);
  p2CpVal.textContent = String(game.cp[2]);
  renderHandButtons();
  if (cardsPlayer !== null) renderCardsCaps(cardsPlayer);
  updateVisibleScoreTooltip();
  updateVisibleCpTooltip();
  renderSeat();
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
  const { primary, secondary } = game.scoreByTurn[player];
  scoreTooltipEl.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "score-tooltip__legend";
  legend.textContent = t("priSecLegend");
  scoreTooltipEl.appendChild(legend);
  for (let i = 0; i < MAX_GAME_TURN; i++) {
    const row = document.createElement("div");
    row.className = "score-tooltip__row";
    const isCurrent = i === scoringTurnIdx(player);
    if (isCurrent) row.classList.add("is-current");

    if (primary[i] === 0 && secondary[i] === 0) row.classList.add("is-empty");
    const label = document.createElement("span");
    label.textContent = t("turnN", { n: i + 1 });
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
  if (game.endBonus[player] > 0) {
    const row = document.createElement("div");
    row.className = "score-tooltip__row";
    const label = document.createElement("span");
    label.textContent = t("endBonus");
    const value = document.createElement("span");
    value.className = "score-tooltip__value";
    value.textContent = t("bonusPri", { n: game.endBonus[player] });
    row.append(label, value);
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
  const { added: addedHist, removed: removedHist } = game.cpHistory[player];
  cpTooltipEl.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "score-tooltip__legend";
  legend.textContent = t("cpLegend");
  cpTooltipEl.appendChild(legend);
  const matchActive = inGame(game);
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
    label.textContent = t("cpTurnRow", { round, p: turnOwner });
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
  return game.abilities[player].filter((ability) => ability.kind === kind && !ability.lost);
}

function gainCp(player: Player): void {
  game.cp[player] = clampCp(game.cp[player] + 1);
  renderMiniCounters();
}

/** Grants the +1 CP of the abilities triggering now, within the per-round cap. */
function applyAbilityCp(player: Player, kinds: ("round-cp" | "turn-cp")[]): void {
  const [source] = kinds.flatMap((kind) => activeAbilities(player, kind));
  if (!source) return;
  if (game.bonusCpGained[player]) {
    noticeCp(player, false);
    return;
  }
  game.bonusCpGained[player] = true;
  gainCp(player);
  noticeCp(player, true);
  renderAbilities(player);
}

/** Online, the CP news goes to the player's own phone, whichever phone ended the turn */
function noticeCp(player: Player, gained: boolean): void {
  game.cpNotice[player] = { gained, n: game.cpNotice[player].n + 1 };
  if (!online || online.seat === player) sayCp(player, gained);
}

function sayCp(player: Player, gained: boolean): void {
  if (gained) playSound("cp");
  showCpToast(player, t(gained ? "cpGained" : "cpCapReached"), gained);
}

/** Start of a battle round: discounts come back, the CP cap resets, then CP abilities trigger. */
function startRoundAbilities(): void {
  for (const player of [1, 2] as const) {
    game.bonusCpGained[player] = false;
    for (const ability of game.abilities[player]) ability.spent = false;
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

/**
 * The unit giving an ability, as one big target: a click strikes it through when it dies
 * (no more CP from it), a second click brings it back.
 */
function unitToggleEl(ability: Ability, text: string): HTMLButtonElement {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "unit-toggle";
  toggle.classList.toggle("is-lost", ability.lost);
  toggle.classList.toggle("is-just-toggled", ability.id === justToggledId);
  // Just clicked: the cursor is still on it, so hold the opposite preview until it leaves
  if (ability.id === settlingAbilityId) {
    toggle.classList.add("is-settling");
    toggle.addEventListener(
      "mouseleave",
      () => {
        toggle.classList.remove("is-settling");
        if (settlingAbilityId === ability.id) settlingAbilityId = null;
      },
      { once: true },
    );
  }
  toggle.dataset.abilityId = String(ability.id);
  toggle.setAttribute("aria-pressed", String(ability.lost));
  toggle.setAttribute("aria-label", t(ability.lost ? "unitRestoreAria" : "unitLostAria", { unit: text }));
  const label = document.createElement("span");
  label.className = "unit-toggle__text";
  label.textContent = text;
  const ask = document.createElement("span");
  ask.className = "unit-toggle__ask";
  ask.setAttribute("aria-hidden", "true");
  ask.textContent = t(ability.lost ? "askRestore" : "askRemove");
  toggle.append(label, ask);
  return toggle;
}

function cpCoinEl(ability: Ability): HTMLElement {
  const coin = document.createElement("button");
  coin.type = "button";
  coin.className = "cp-coin";
  coin.classList.toggle("is-spent", ability.spent);
  coin.classList.toggle("is-restored", ability.id === restoredCoinId);
  coin.disabled = ability.lost;
  coin.dataset.abilityId = String(ability.id);
  const owner = t("stratagem");
  coin.setAttribute("aria-label", ability.spent ? t("coinSpentAria", { owner }) : t("coinAria", { owner }));
  coin.title = ability.spent ? t("coinUndo") : "";
  // A spent coin shows ↻: it comes back next battle round
  coin.innerHTML = `
    <span class="cp-coin__face" aria-hidden="true">${CP_COIN_SVG}
      <span class="cp-coin__value">${ability.spent ? "↻" : "−1"}</span>
      <span class="cp-coin__unit">${t("cpUnit")}</span>
    </span>`;
  const wrap = document.createElement("div");
  wrap.className = "cp-coin-wrap";
  wrap.classList.toggle("is-lost", ability.lost);
  wrap.classList.toggle("is-just-toggled", ability.id === justToggledId);
  wrap.append(coin, unitToggleEl(ability, owner));
  return wrap;
}

function renderAbilities(player: Player): void {
  const coins = document.createElement("div");
  coins.className = "abilities__coins";
  const chips = document.createElement("div");
  chips.className = "abilities__chips";
  // Lost units stay on the board, struck through, so a misclick is one click away from undo
  for (const ability of game.abilities[player]) {
    if (ability.kind === "discount") {
      coins.appendChild(cpCoinEl(ability));
    } else {
      const short = t(ABILITY_KINDS[ability.kind].short);
      const chip = unitToggleEl(ability, short);
      chip.classList.add("ability-chip");
      chips.appendChild(chip);
    }
  }
  abilitiesEl[player].replaceChildren(...[coins, chips].filter((group) => group.childElementCount > 0));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const CP_COIN_ANIM_MS = 900;

/** Coin whose come-back animation plays on the next render only */
let restoredCoinId: number | null = null;

/** A click on a spent coin brings it back: a misclick is one click away from undo */
function spendCpCoin(player: Player, coin: HTMLButtonElement): void {
  if (!inGame(game)) return;
  const ability = game.abilities[player].find(({ id }) => String(id) === coin.dataset.abilityId);
  if (!ability || ability.lost || coin.classList.contains("is-animating")) return;
  if (ability.spent) {
    playSound("coinRestore");
    ability.spent = false;
    restoredCoinId = ability.id;
    renderAbilities(player);
    restoredCoinId = null;
    return;
  }

  playSound("coinSpend");
  const face = coin.querySelector<HTMLElement>(".cp-coin__face")!;
  let completed = false;
  let fallbackTimer = 0;

  function finish(): void {
    if (completed || !ability) return;
    completed = true;
    window.clearTimeout(fallbackTimer);
    face.removeEventListener("animationend", onEnd);
    // The state may have come back from the other phone during the flip: look the unit up again
    const current = game.abilities[player].find(({ id }) => id === ability.id);
    if (current) current.spent = true;
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
  abilitiesTitle.textContent = t("abilitiesTitle", { n: player });
  abilitiesTitle.className = `is-p${player}`;
  renderAbilityList();
  abilitiesOverlay.classList.add("is-visible");
  abilitiesOverlay.setAttribute("aria-hidden", "false");
  btnAbilitiesClose.focus();
}

function closeAbilities(): void {
  if (abilitiesPlayer === null) return;
  abilitiesPlayer = null;
  abilitiesOverlay.classList.remove("is-visible");
  abilitiesOverlay.setAttribute("aria-hidden", "true");
  (document.activeElement as HTMLElement | null)?.blur();
}

type AbilitySlot = "discount" | "cp";

const isCpKind = (kind: AbilityKind): boolean => kind !== "discount";

function abilityInSlot(player: Player, slot: AbilitySlot): Ability | undefined {
  return game.abilities[player].find((ability) => (slot === "discount" ? !isCpKind(ability.kind) : isCpKind(ability.kind)));
}

/** The timing choice slides in only when +1 CP was just turned on, not on every redraw */
let revealCpTiming = false;

function abilityToggleHtml(slot: AbilitySlot, on: boolean): string {
  return `
    <button type="button" class="ability-toggle" data-slot="${slot}" aria-pressed="${on}">
      <span class="ability-toggle__title"></span>
      <span class="ability-toggle__hint"></span>
      <span class="ability-toggle__check" aria-hidden="true">${ICON_CHECK}</span>
    </button>`;
}

/**
 * A player has at most one unit discounting a stratagem and one unit giving +1 CP.
 * The +1 CP tile, once on, asks when the CP comes.
 */
function renderAbilityList(): void {
  if (abilitiesPlayer === null) return;
  const player = abilitiesPlayer;
  const discount = abilityInSlot(player, "discount");
  const cp = abilityInSlot(player, "cp");

  const discountRow = document.createElement("li");
  discountRow.innerHTML = abilityToggleHtml("discount", !!discount);
  discountRow.querySelector(".ability-toggle__title")!.textContent = t(ABILITY_KINDS.discount.title);
  discountRow.querySelector(".ability-toggle__hint")!.textContent = t(ABILITY_KINDS.discount.hint);

  const cpRow = document.createElement("li");
  cpRow.innerHTML = abilityToggleHtml("cp", !!cp);
  cpRow.querySelector(".ability-toggle__title")!.textContent = t("cpTitle");
  cpRow.querySelector(".ability-toggle__hint")!.textContent = t("cpTimingHint");
  if (cp) {
    const timing = document.createElement("div");
    timing.className = "segmented ability-timing";
    timing.classList.toggle("is-revealed", revealCpTiming);
    timing.setAttribute("role", "group");
    timing.setAttribute("aria-label", t("cpTimingHint"));
    for (const kind of ["turn-cp", "round-cp"] as const) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "segmented__option";
      option.dataset.value = kind;
      option.setAttribute("aria-pressed", String(cp.kind === kind));
      option.textContent = t(ABILITY_KINDS[kind].hint);
      timing.appendChild(option);
    }
    cpRow.appendChild(timing);
  }
  revealCpTiming = false;
  abilityList.replaceChildren(discountRow, cpRow);
}

function toggleAbilitySlot(player: Player, slot: AbilitySlot): void {
  const existing = abilityInSlot(player, slot);
  if (existing) {
    game.abilities[player] = game.abilities[player].filter((ability) => ability !== existing);
  } else {
    game.abilities[player].push({ id: game.nextAbilityId++, kind: slot === "discount" ? "discount" : "turn-cp", lost: false, spent: false });
    revealCpTiming = slot === "cp";
  }
  renderAbilityList();
  renderAbilities(player);
}

/** Switching the timing keeps the same unit, struck or not */
function setCpTiming(player: Player, kind: AbilityKind): void {
  const cp = abilityInSlot(player, "cp");
  if (!cp || cp.kind === kind) return;
  cp.kind = kind;
  renderAbilityList();
  renderAbilities(player);
}

function toggleAbilityLost(player: Player, id: number): void {
  const ability = game.abilities[player].find((candidate) => candidate.id === id);
  if (!ability) return;
  ability.lost = !ability.lost;
  settlingAbilityId = id;
  justToggledId = id;
  renderAbilities(player);
  justToggledId = null;
  if (abilitiesPlayer === player) renderAbilityList();
}

/* ---------- Secondary mission cards (tactical) ---------- */

const WHEN_KEYS = { yours: "whenYours", any: "whenAny", opponent: "whenOpponent" } as const;

/**
 * Whose cards are shown, and which: a fresh draw, the secondaries in hand or already scored, the
 * primaries reveal, one player's primary, or what scores at the end of a turn
 */
let cardsPlayer: Player | null = null;
let cardsMode: "draw" | "hand" | "scored" | "primary" | "mission" | "command" | "end-turn" = "hand";
/** The turn end waiting behind the end-of-turn scoring */
let endTurnKind: TurnConfirmKind | null = null;
/** Players who had something to score when it opened: with both, a switch goes from one to the other */
let endTurnSides: Player[] = [];
/** Cards of the current draw: the reveal shows only them */
let drawnIds: string[] = [];
/** A draw made during a photo break waits for the break to end */
let pendingDraw: { player: Player; drawn: string[] } | null = null;

const CARD_EXIT_MS = 450;
/** The cards left in the row glide to their new place */
const CARD_SLIDE_MS = 380;

/** Closing puts the cards away, as in the CSS: the deal played backwards, the last card first */
const PUT_AWAY_MS = 350;
const PUT_AWAY_STAGGER_MS = 50;
/** While the cards are put away the overlay stays up; a view asked meanwhile opens right after */
let putAwayTimer: number | null = null;
let afterPutAway: (() => void) | null = null;

function secondaryCardsOn(): boolean {
  return game.options.cards;
}

function drawSecondaries(player: Player, count: number): string[] {
  const pile = game.secondaries[player];
  const drawn = pile.deck.splice(0, count);
  pile.hand.push(...drawn);
  return drawn;
}

/** Start of a player's own turn: two new secondaries, revealed once any photo break is over */
function startTurnSecondaries(player: Player): void {
  if (!secondaryCardsOn()) return;
  const drawn = drawSecondaries(player, 2);
  game.lastDraw = { player, ids: drawn, n: game.lastDraw.n + 1 };
  renderHandButtons();
  showDraw(player, drawn);
}

/** The draw comes up on the drawing player's phone, whichever phone ended the turn */
function showDraw(player: Player, drawn: string[]): void {
  if (online && online.seat !== player) return;
  if (drawn.length === 0) {
    // Nothing left to draw: the Command phase scores still come up
    if (!game.photoBreak && primaryScoresInCommand(player)) openCards(player, "command");
    return;
  }
  if (game.photoBreak) pendingDraw = { player, drawn };
  else openCards(player, "draw", drawn);
}

function moveSecondary(player: Player, id: string, to: "discard" | "deck"): void {
  const pile = game.secondaries[player];
  pile.hand = pile.hand.filter((cardId) => cardId !== id);
  if (to === "discard") pile.discard.push(id);
  // Shuffled back: anywhere in the deck
  else pile.deck.splice(Math.floor(Math.random() * (pile.deck.length + 1)), 0, id);
}

/** Card points go to the secondary score of the player's turn, within the 15 per turn */
function addSecondaryPoints(player: Player, vp: number): number {
  const turns = game.scoreByTurn[player].secondary;
  const turnIdx = scoringTurnIdx(player);
  const added = Math.max(0, Math.min(vp, MAX_POINTS_PER_TURN - turns[turnIdx]));
  turns[turnIdx] += added;
  renderMiniCounters();
  return added;
}

function renderHandButtons(): void {
  // With the cards, points come from scoring them: no −/+ on the score rows
  app.classList.toggle("uses-secondary-cards", secondaryCardsOn());
  for (const player of [1, 2] as const) {
    const button = handButtonEl[player];
    const count = game.secondaries[player].hand.length;
    cardButtonsEl[player].hidden = !secondaryCardsOn() || !inGame(game);
    primaryButtonEl[player].hidden = !primaryCard(player);
    button.querySelector(".score-box__hand-count")!.textContent = String(count);
    button.setAttribute("aria-label", t("handAria", { n: count }));
    // The opponent sees during the turn what they can score when it ends, not only on the end-of-turn screen
    const alert = turnEndAlertEl[player];
    const due = secondaryCardsOn() && inGame(game) && !isOver() && player !== game.turnPlayer ? turnEndCount(player) : 0;
    alert.hidden = due === 0;
    alert.textContent = t("turnEndAlert", { n: due });
  }
  renderSeat();
}

/** The cards of the player whose clock runs or, while paused, whose turn it is */
function cardKeyPlayer(): Player | null {
  if (!secondaryCardsOn()) return null;
  if (online) return inGame(game) ? online.seat : null;
  if (isRunning()) return game.clock.active;
  return isStopped(game) ? game.turnPlayer : null;
}

/** S opens the hand, P the primary */
function cardKeyMode(e: KeyboardEvent): "hand" | "mission" | null {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.code === HAND_KEY_CODE) return "hand";
  return e.code === PRIMARY_KEY_CODE ? "mission" : null;
}

const anyModalOpen = (): boolean =>
  resultOverlay.classList.contains("is-visible") || turnConfirmOverlay.classList.contains("is-visible");

/** Card ids of the primary cards, to deal them like the others */
const primaryCardId = (player: Player): string => `primary-${player}`;

function openCards(player: Player, mode: typeof cardsMode, drawn: string[] = []): void {
  if (putAwayTimer !== null) {
    afterPutAway ??= () => openCards(player, mode, drawn);
    return;
  }
  cardsOverlay.classList.remove("is-closing");
  cardsPlayer = player;
  cardsMode = mode;
  drawnIds = drawn;
  cardsOverlay.classList.remove("is-p1", "is-p2");
  if (mode !== "primary") cardsOverlay.classList.add(`is-p${player}`);
  cardsOverlay.dataset.mode = mode;
  if (mode === "draw") renderCards(drawn);
  else if (mode === "primary") renderCards([primaryCardId(1), primaryCardId(2)]);
  else {
    const pile = game.secondaries[player];
    renderCards([primaryCardId(player), ...pile.hand, ...pile.scored.map(({ id }) => id)]);
  }
  // Every card that comes on screen is heard: the primaries clash, the others swish in
  const dealt = cardsRow.querySelectorAll(".sec-card.is-dealt").length;
  if (mode === "primary") playSound("clash");
  else if (dealt > 0) playSound("draw", dealt);
  cardsOverlay.classList.add("is-visible");
  cardsOverlay.setAttribute("aria-hidden", "false");
  btnCardsClose.focus();
}

function closeCards(putAway = true): void {
  if (cardsPlayer === null) return;
  // The draw opens the turn, in its Command phase: once it is put away, the primary scores of that phase come up
  const commandNext = putAway && cardsMode === "draw" && primaryScoresInCommand(cardsPlayer) ? cardsPlayer : null;
  cardsPlayer = null;
  drawnIds = [];
  endTurnKind = null;
  cardsOverlay.setAttribute("aria-hidden", "true");
  (document.activeElement as HTMLElement | null)?.blur();
  const count = cardsRow.querySelectorAll(".sec-card").length;
  if (!putAway || count === 0 || prefersReducedMotion()) {
    hideCards();
  } else {
    cardsRow.style.setProperty("--n", String(count));
    cardsOverlay.classList.add("is-closing");
    playSound("putAway", count);
    putAwayTimer = window.setTimeout(hideCards, PUT_AWAY_MS + (count - 1) * PUT_AWAY_STAGGER_MS);
  }
  renderHandButtons();
  if (commandNext !== null) openCards(commandNext, "command");
}

function hideCards(): void {
  if (putAwayTimer !== null) window.clearTimeout(putAwayTimer);
  putAwayTimer = null;
  // The cards stay put away while the overlay fades out: the next opening resets them
  cardsOverlay.classList.remove("is-visible");
  const next = afterPutAway;
  afterPutAway = null;
  next?.();
}

/**
 * At the end of a turn: the player's "end of your turn" missions, the opponent's "end of the enemy
 * turn" ones, anyone's "end of any turn" ones, and the end of the battle on the very last turn
 */
function scoresAtTurnEnd(owner: Player, when: SecondaryCard["when"] | PrimarySection["when"]): boolean {
  if (when === undefined || when === "any") return true;
  if (when === "end") return endTurnKind === "finish-game";
  if (when === "command") return false;
  return when === (owner === game.turnPlayer ? "yours" : "opponent");
}

function turnEndSecondaries(owner: Player): string[] {
  return game.secondaries[owner].hand.filter((id) => scoresAtTurnEnd(owner, SECONDARY_BY_ID.get(id)!.when));
}

/** Which primary lines score in the view: at a turn end or in the Command phase, only that moment's */
function scoresInView(owner: Player, when: PrimarySection["when"]): boolean {
  if (cardsMode === "end-turn") return scoresAtTurnEnd(owner, when);
  if (cardsMode === "command") return when === "command";
  return true;
}

function primaryScoresInCommand(owner: Player): boolean {
  const card = primaryCard(owner);
  return !!card && card.sections.some((section) => section.when === "command" && sectionOpen(owner, section));
}

function primaryScoresAtTurnEnd(owner: Player): boolean {
  const card = primaryCard(owner);
  return !!card && card.sections.some((section) => sectionOpen(owner, section) && scoresAtTurnEnd(owner, section.when));
}

const turnEndCount = (owner: Player): number =>
  turnEndSecondaries(owner).length + (primaryScoresAtTurnEnd(owner) ? 1 : 0);

/** Enter, or the End turn button: the round goes on, or the battle ends after the last turn */
function requestTurnEnd(): void {
  if (game.turnPlayer === 1) requestEndTurn("p1-to-p2");
  else requestEndTurn(game.round >= MAX_GAME_TURN ? "finish-game" : "next-round");
}

/** With the cards, ending a turn first shows what scores now; with nothing to score, the plain confirmation */
function requestEndTurn(kind: TurnConfirmKind): void {
  endTurnKind = kind;
  // Online, each phone scores its own cards: the opponent's are on the opponent's phone
  const sides = online ? [online.seat] : [game.turnPlayer, other(game.turnPlayer)];
  endTurnSides = secondaryCardsOn() ? sides.filter((side) => turnEndCount(side) > 0) : [];
  if (endTurnSides.length === 0) {
    endTurnKind = null;
    openTurnConfirmModal(kind);
    return;
  }
  openCards(endTurnSides[0], "end-turn");
}

type CardsTab = { value: string; label: string; count: number; side: Player; on: boolean };

/** Tabs over the cards: both players at a turn end, or a player's hand and scored cards */
function cardsTabs(): CardsTab[] {
  if (cardsMode === "end-turn" && endTurnSides.length > 1) {
    return endTurnSides.map((side) => ({
      value: String(side),
      label: t("player", { n: side }),
      count: turnEndCount(side),
      side,
      on: side === cardsPlayer,
    }));
  }
  if ((cardsMode === "hand" || cardsMode === "scored") && cardsPlayer !== null) {
    const pile = game.secondaries[cardsPlayer];
    return [
      { value: "hand", label: t("secondaryHand"), count: pile.hand.length, side: cardsPlayer, on: cardsMode === "hand" },
      { value: "scored", label: t("scoredTab"), count: pile.scored.length, side: cardsPlayer, on: cardsMode === "scored" },
    ];
  }
  return [];
}

function renderCardsSwitch(): void {
  if (cardsMode === "hand" || cardsMode === "scored") {
    renderScoredLink();
    return;
  }
  if (cardsMode === "mission" && online && cardsPlayer !== null) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "cards-switch__link";
    link.dataset.tab = String(other(cardsPlayer));
    link.textContent = t(cardsPlayer === online.seat ? "oppPrimary" : "myPrimary");
    cardsSwitch.hidden = !primaryCard(other(cardsPlayer));
    cardsSwitch.replaceChildren(link);
    return;
  }
  const tabs = cardsTabs();
  cardsSwitch.hidden = tabs.length === 0;
  if (cardsSwitch.hidden) return;
  const buttons = tabs.map((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cards-switch__side is-p${tab.side}`;
    button.dataset.tab = tab.value;
    button.disabled = tab.count === 0 && !tab.on;
    button.setAttribute("aria-pressed", String(tab.on));
    button.innerHTML = `<span></span><span class="cards-switch__count">${tab.count}</span>`;
    button.querySelector("span")!.textContent = tab.label;
    return button;
  });
  const key = document.createElement("kbd");
  key.textContent = SWITCH_KEY;
  cardsSwitch.replaceChildren(...buttons, key);
}

/** Scored cards are a rare detour, to undo a misclick: a quiet link, only once something is scored */
function renderScoredLink(): void {
  const scored = cardsPlayer === null ? 0 : game.secondaries[cardsPlayer].scored.length;
  cardsSwitch.hidden = cardsMode === "hand" && scored === 0;
  if (cardsSwitch.hidden) return;
  const link = document.createElement("button");
  link.type = "button";
  link.className = "cards-switch__link";
  link.dataset.tab = cardsMode === "hand" ? "scored" : "hand";
  link.textContent = cardsMode === "hand" ? t("seeScored", { n: scored }) : t("backToHand");
  cardsSwitch.replaceChildren(link);
}

function showCardsTab(value: string): void {
  if (cardsPlayer === null) return;
  if (cardsMode === "end-turn" || cardsMode === "mission") openCards(Number(value) as Player, cardsMode);
  else openCards(cardsPlayer, value === "scored" ? "scored" : "hand");
}

/** At a turn end, the player who scores after the one shown, if any: each side gets its own step */
function nextEndTurnSide(): Player | null {
  if (cardsMode !== "end-turn" || cardsPlayer === null) return null;
  const index = endTurnSides.indexOf(cardsPlayer);
  return index >= 0 && index < endTurnSides.length - 1 ? endTurnSides[index + 1] : null;
}

/**
 * Where the screen sits in the game, in the color of the player whose turn it is: the end of a turn
 * (and its step), or a new turn. The opponent's end-of-turn cards then read as part of the turn
 * that ends, not as the draw of the turn that comes
 */
function renderCardsKicker(player: Player): void {
  let text = "";
  let side: Player = game.turnPlayer;
  if (cardsMode === "end-turn") {
    text = t("endTurnKicker", { n: game.turnPlayer });
    if (endTurnSides.length > 1) {
      text += ` · ${t("stepOf", { a: endTurnSides.indexOf(player) + 1, b: endTurnSides.length })}`;
    }
  } else if (cardsMode === "draw" || cardsMode === "command") {
    side = player;
    text = t("turnStartKicker", { n: player, r: game.round });
  }
  cardsKicker.textContent = text;
  cardsKicker.hidden = text === "";
  cardsKicker.classList.toggle("is-p1", side === 1);
  cardsKicker.classList.toggle("is-p2", side === 2);
}

/** Where the cards score, this turn's points of their owner against the 15 allowed */
function renderCardsCaps(player: Player): void {
  cardsCaps.hidden = !["hand", "end-turn", "command", "mission"].includes(cardsMode);
  if (cardsCaps.hidden) return;
  const turnIdx = scoringTurnIdx(player);
  for (const { kind } of SCORE_KINDS) {
    const gauge = cardsCaps.querySelector<HTMLElement>(`[data-kind="${kind}"] .cap-gauge`)!;
    setCapGauge(gauge, game.scoreByTurn[player][kind][turnIdx], turnIdx, false);
  }
}

/** `dealIds` fly in from the deck; the others are already on the table */
function renderCards(dealIds: string[] = []): void {
  if (cardsPlayer === null) return;
  const player = cardsPlayer;
  const pile = game.secondaries[player];
  // Online, Player 1 starts the game from the VS: their clock is the one that runs
  const waitsForP1 = cardsMode === "primary" && !!online && online.seat !== 1;
  const nextSide = nextEndTurnSide();
  const closeLabel: StringKey = waitsForP1
    ? "vsWaitP1"
    : cardsMode === "primary"
      ? "startGame"
      : cardsMode !== "end-turn"
        ? "continue"
        : endTurnKind === "finish-game"
          ? "endBattleBtn"
          : "endTurnBtn";
  btnCardsClose.querySelector("span")!.textContent = nextSide !== null ? t("nextSideBtn", { n: nextSide }) : t(closeLabel);
  btnCardsClose.disabled = waitsForP1;
  renderCardsSwitch();
  renderCardsKicker(player);
  renderCardsCaps(player);
  if (cardsMode === "primary") {
    cardsTitle.textContent = t("primaryTitle");
    cardsSub.textContent = "";
    // The two missions face off: they rush in from each side and clash on a "VS"
    const versus = document.createElement("div");
    versus.className = "versus";
    versus.setAttribute("aria-hidden", "true");
    versus.innerHTML = "<span class=\"versus__line\"></span><span class=\"versus__text\">VS</span>";
    // On a phone the cards stack around the VS: online, the opponent's on top and short, this
    // phone's player's in full below; on one phone for both players, both short
    const stacked = !!online || window.matchMedia("(max-width: 640px)").matches;
    const owners: Player[] = online ? [other(online.seat), online.seat] : [1, 2];
    const [first, second] = owners.map((owner, index) => {
      const card = primaryCardEl(owner, index, dealIds.includes(primaryCardId(owner)), false);
      card.classList.toggle("is-compact", stacked && owner !== online?.seat);
      return card;
    });
    cardsRow.classList.toggle("is-stacked", stacked);
    cardsRow.classList.toggle("is-clashing", dealIds.length > 0);
    cardsRow.replaceChildren(first, versus, second);
    layoutCardsRow();
    return;
  }
  cardsRow.classList.remove("is-stacked");
  const ids =
    cardsMode === "draw"
      ? drawnIds.filter((id) => pile.hand.includes(id))
      : cardsMode === "hand"
        ? pile.hand
        : cardsMode === "scored"
          ? pile.scored.map(({ id }) => id)
          : cardsMode === "end-turn"
          ? turnEndSecondaries(player)
          : [];
  if (cardsMode === "end-turn") {
    cardsTitle.textContent = t("endTurnScoringTitle", { n: player });
    cardsSub.textContent =
      player !== game.turnPlayer
        ? t("endTurnOpponentSub", { n: game.turnPlayer })
        : nextSide !== null
          ? t("endTurnScoringSubNext", { n: nextSide })
          : t("endTurnScoringSub");
  } else if (cardsMode === "command") {
    cardsTitle.textContent = t("commandTitle", { n: player });
    cardsSub.textContent = t("commandSub");
  } else if (cardsMode === "mission") {
    cardsTitle.textContent = t("missionTitle", { n: player });
    cardsSub.textContent = "";
  } else if (cardsMode === "scored") {
    cardsTitle.textContent = t("scoredTitle", { n: player });
    cardsSub.textContent = t("scoredSub");
  } else {
    cardsTitle.textContent = t(cardsMode === "draw" ? "drawTitle" : "handTitle", { n: player });
    const deck = pile.deck.length > 0 ? t("deckLeft", { n: pile.deck.length }) : t("deckEmpty");
    cardsSub.textContent = cardsMode === "draw" ? `${deck} · ${t("scoreFromHand")}` : deck;
  }
  // The primary card stays apart from the hand: on its own, or at a turn end when it scores
  const withPrimary =
    cardsMode === "mission" || cardsMode === "command" || (cardsMode === "end-turn" && primaryScoresAtTurnEnd(player));
  // Online, the opponent's primary can be read here, not scored
  const ownCard = !online || player === online.seat;
  const primary = withPrimary && primaryCard(player) ? [primaryCardEl(player, 0, dealIds.includes(primaryCardId(player)), ownCard)] : [];
  const cards = [
    ...primary,
    ...ids.map((id, index) => secondaryCardEl(player, id, index + primary.length, dealIds.includes(id))),
  ];
  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cards-empty";
    empty.textContent = t(cardsMode === "end-turn" ? "nothingToScore" : cardsMode === "scored" ? "emptyScored" : "emptyHand");
    cardsRow.replaceChildren(empty);
    return;
  }
  cardsRow.replaceChildren(...cards);
  layoutCardsRow();
}

/** Card widths and gap in rem, as in the CSS: the primary, kept all game, is the wider card */
const CARD_REM = 16;
const PRIMARY_CARD_REM = 20;
const CARD_GAP_REM = 1.5;

/**
 * Like a hand in a card game: one row, the cards overlapping as much as needed to fit
 * the screen width. The hovered card comes to the front.
 */
function layoutCardsRow(): void {
  if (cardsMode === "primary") {
    cardsRow.classList.remove("is-fanned");
    return;
  }
  cardsRow.classList.remove("is-clashing");
  const cards = [...cardsRow.querySelectorAll(".sec-card")];
  const count = cards.length;
  const width = cards.reduce((sum, card) => sum + (card.classList.contains("sec-card--primary") ? PRIMARY_CARD_REM : CARD_REM), 0);
  const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  // Room for the row, in rem of the zoomed stage (its padding taken out)
  const available = ((cardsOverlay.clientWidth - 2 * rootPx) / scale - 2 * rootPx) / rootPx;
  const natural = width + (count - 1) * CARD_GAP_REM;
  const fanned = count > 1 && natural > available;
  cardsRow.classList.toggle("is-fanned", fanned);
  // At least 3rem of each card stays visible, enough to read its name
  const overlap = fanned ? Math.min((width - available) / (count - 1), CARD_REM - 3) : 0;
  cardsRow.style.setProperty("--overlap", `${overlap}rem`);
}

function repeatTotal(option: HTMLElement): number {
  const per = Number(option.dataset.per);
  const max = Number(option.dataset.max);
  return Math.min(per * Number(option.dataset.count), max);
}

function secondaryCardEl(player: Player, id: string, index: number, deal: boolean): HTMLElement {
  const data = SECONDARY_BY_ID.get(id)!;
  const lang = getLang();
  const el = document.createElement("article");
  el.className = "sec-card";
  el.classList.toggle("is-dealt", deal);
  el.style.setProperty("--i", String(index));
  el.dataset.cardId = id;
  el.innerHTML = `
    <div class="sec-card__inner">
      <header class="sec-card__head">
        <span class="sec-card__kicker"></span>
        <h3 class="sec-card__name"></h3>
        <span class="sec-card__when"></span>
      </header>
      <p class="sec-card__note"></p>
      <div class="sec-card__options"></div>
      <footer class="sec-card__actions"></footer>
    </div>`;
  el.querySelector(".sec-card__kicker")!.textContent = t("secondaryKicker");
  el.querySelector(".sec-card__name")!.textContent = data.name;
  const when = el.querySelector<HTMLElement>(".sec-card__when")!;
  when.textContent = data.when ? t(WHEN_KEYS[data.when]) : "";
  // At a turn end, why the card scores now
  when.classList.toggle("is-now", cardsMode === "end-turn");
  const note = el.querySelector<HTMLElement>(".sec-card__note")!;
  note.textContent = data.note ? data.note[lang] : "";
  note.hidden = !data.note;

  const unit = t("vpUnit");
  const scorable = cardsMode === "hand" || cardsMode === "end-turn";
  const room = scorable ? roomThisTurn(player, "secondary") : Infinity;
  const options = data.options.map((option) => {
    if ("vp" in option) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sec-option";
      button.disabled = !scorable;
      button.dataset.action = "score";
      button.dataset.vp = String(option.vp);
      button.innerHTML = `<span class="sec-option__vp">${vpHtml(option.vp, room)}</span><span class="sec-option__label"></span>`;
      markCapped(button, option.vp, room);
      button.querySelector(".sec-option__label")!.textContent = option.label[lang];
      return button;
    }
    // "For each …, up to max": count the things, then score the capped total
    const block = document.createElement("div");
    block.className = "sec-option sec-option--repeat";
    block.dataset.per = String(option.per);
    block.dataset.max = String(option.max);
    block.dataset.count = "1";
    block.innerHTML = `
      <span class="sec-option__vp">${option.per}<small>${unit}</small></span>
      <span class="sec-option__label"></span>
      <span class="sec-option__repeat">
        <span class="sec-option__stepper">
          <button type="button" class="mini-counter__btn" data-action="less">−</button>
          <span class="sec-option__count">1</span>
          <button type="button" class="mini-counter__btn" data-action="more">+</button>
        </span>
        <button type="button" class="sec-option__go" data-action="score-repeat"></button>
      </span>`;
    block.querySelector(".sec-option__label")!.textContent = `${option.label[lang]} · ${t("maxVp", { n: option.max })}`;
    setGoButton(block.querySelector<HTMLElement>(".sec-option__go")!, repeatTotal(block), room);
    block.querySelector<HTMLElement>(".sec-option__repeat")!.hidden = !scorable;
    return block;
  });
  el.querySelector(".sec-card__options")!.replaceChildren(...options);

  const actions: HTMLElement[] = [];
  if (cardsMode === "draw" && data.redraw && drawnIds.includes(id) && game.secondaries[player].deck.length > 0) {
    const redraw = document.createElement("button");
    redraw.type = "button";
    redraw.className = "sec-action sec-action--redraw";
    redraw.dataset.action = "redraw";
    redraw.innerHTML = `<span></span><small></small>`;
    redraw.querySelector("span")!.textContent = t("redrawFree");
    redraw.querySelector("small")!.textContent = t("redrawIf", { cond: data.redraw.condition[lang] });
    actions.push(redraw);
  }
  const scored = cardsMode === "scored" ? game.secondaries[player].scored.find((entry) => entry.id === id) : undefined;
  if (scored) {
    const stamp = document.createElement("span");
    stamp.className = "sec-card__stamp";
    stamp.textContent = t("scoredStamp", { vp: scored.vp, unit, n: scored.turn + 1 });
    el.querySelector(".sec-card__inner")!.appendChild(stamp);
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "sec-action sec-action--undo";
    undo.textContent = t("unscoreBtn");
    actions.push(undo);
  } else if (cardsMode === "draw") {
    // A new card for 1 CP: only while drawing, never later from the hand
    const swapCard = document.createElement("button");
    swapCard.type = "button";
    swapCard.className = "sec-action sec-action--discard";
    swapCard.dataset.action = "swap";
    swapCard.textContent = game.newCardUsed[player] ? t("swapUsed") : t("swapCp");
    swapCard.disabled = !canSwapSecondary(player);
    actions.push(swapCard);
  }
  const link = document.createElement("a");
  link.className = "sec-action sec-action--link";
  link.href = data.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `${t("fullCard")} ↗`;
  actions.push(link);
  el.querySelector(".sec-card__actions")!.replaceChildren(...actions);
  return el;
}

/** The card leaves with an animation, then the cards are redrawn (`dealIds` flying in) */
function playCardExit(
  cardEl: HTMLElement,
  exit: "is-scored" | "is-discarded" | "is-returned",
  burst?: string,
  dealIds: string[] = [],
): void {
  if (burst) {
    const label = document.createElement("span");
    label.className = "sec-card__burst";
    label.textContent = burst;
    cardEl.appendChild(label);
  }
  cardEl.classList.add(exit);
  // A scored card has its own sound; a discarded or returned one swishes away
  if (exit !== "is-scored") playSound("putAway", 1);
  const done = () => {
    const before = cardPositions();
    if (dealIds.length > 0) playSound("draw", dealIds.length);
    renderCards(dealIds);
    slideCardsFrom(before);
    renderHandButtons();
  };
  if (prefersReducedMotion()) done();
  else window.setTimeout(done, CARD_EXIT_MS);
}

const cardKey = (card: HTMLElement): string => card.dataset.cardId ?? `primary-${card.dataset.primaryPlayer}`;

function cardPositions(): Map<string, DOMRect> {
  return new Map(
    [...cardsRow.querySelectorAll<HTMLElement>(".sec-card")].map((card) => [cardKey(card), card.getBoundingClientRect()]),
  );
}

/**
 * When a card leaves, the others close the gap: each one starts where it was and glides to its
 * new place, instead of jumping there (FLIP)
 */
function slideCardsFrom(before: Map<string, DOMRect>): void {
  if (prefersReducedMotion()) return;
  // Positions are read zoomed, the transform applies inside the zoomed stage
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  cardsRow.querySelectorAll<HTMLElement>(".sec-card").forEach((card) => {
    const from = before.get(cardKey(card));
    if (!from) return;
    const to = card.getBoundingClientRect();
    const dx = (from.left - to.left) / scale;
    const dy = (from.top - to.top) / scale;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: CARD_SLIDE_MS,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  });
}

function scoreSecondary(player: Player, id: string, vp: number, cardEl: HTMLElement): void {
  const turn = scoringTurnIdx(player);
  const added = addSecondaryPoints(player, vp);
  moveSecondary(player, id, "discard");
  game.secondaries[player].scored.push({ id, vp: added, turn });
  playSound("score");
  playCardExit(cardEl, "is-scored", `+${added}`);
}

/** Pending undo, until the player confirms it */
let pendingUnscore: { player: Player; id: string } | null = null;

function askUnscore(player: Player, id: string): void {
  if (isOver()) return;
  pendingUnscore = { player, id };
  openTurnConfirmModal("unscore");
}

/** A score clicked by mistake: its points leave the turn they went to, the card goes back to the hand */
function restoreSecondary(player: Player, id: string): void {
  const pile = game.secondaries[player];
  const scored = pile.scored.find((entry) => entry.id === id);
  if (!scored) return;
  pile.scored = pile.scored.filter((entry) => entry !== scored);
  pile.discard = pile.discard.filter((cardId) => cardId !== id);
  pile.hand.push(id);
  const turns = game.scoreByTurn[player].secondary;
  turns[scored.turn] = Math.max(0, turns[scored.turn] - scored.vp);
  playSound("undo");
  renderMiniCounters();
  if (cardsPlayer !== player) return;
  // Back to the hand, where the card is dealt in again
  cardsMode = "hand";
  cardsOverlay.dataset.mode = "hand";
  renderCards([id]);
  playSound("draw", 1);
}

function canSwapSecondary(player: Player): boolean {
  return !game.newCardUsed[player] && game.cp[player] >= 1 && game.secondaries[player].deck.length > 0;
}

/** −1 CP, once per battle: the card is discarded and a new one is dealt in its place */
function swapSecondary(player: Player, id: string, cardEl: HTMLElement): void {
  if (!canSwapSecondary(player)) return;
  adjustCp(player, -1);
  game.newCardUsed[player] = true;
  const [replacement] = drawSecondaries(player, 1);
  moveSecondary(player, id, "discard");
  drawnIds = drawnIds.map((cardId) => (cardId === id ? replacement : cardId));
  // The other cards lose their swap button at once: it is spent for the battle
  cardsRow.querySelectorAll<HTMLButtonElement>('[data-action="swap"]').forEach((button) => {
    button.disabled = true;
    button.textContent = t("swapUsed");
  });
  playCardExit(cardEl, "is-discarded", undefined, [replacement]);
}

/** Free redraw allowed by the card when drawn: it leaves, a new card is dealt in its place */
function redrawSecondary(player: Player, id: string, cardEl: HTMLElement): void {
  const data = SECONDARY_BY_ID.get(id);
  if (!data?.redraw) return;
  const [replacement] = drawSecondaries(player, 1);
  if (!replacement) return;
  moveSecondary(player, id, data.redraw.to);
  drawnIds = drawnIds.map((cardId) => (cardId === id ? replacement : cardId));
  // Back to the deck it goes the way it came, to the discard it falls
  playCardExit(cardEl, data.redraw.to === "deck" ? "is-returned" : "is-discarded", undefined, [replacement]);
}

/* ---------- Force dispositions and primary missions ---------- */

/** With the cards on, the game starts by choosing force dispositions */
function requestStart(): void {
  if (secondaryCardsOn()) chooseDispositions();
  else openTurnConfirmModal("start-game");
}

/** Online, the choice opens on both phones, empty: each player picks theirs, in secret */
function chooseDispositions(): void {
  if (online) {
    game.choosing = true;
    game.dispositions = { 1: null, 2: null };
    game.primaries = { 1: null, 2: null };
    dispoPick = null;
  }
  openDispositions();
}

/** Online, the disposition this phone's player is about to lock in */
let dispoPick: Disposition | null = null;

function openDispositions(): void {
  renderDispositions();
  dispoOverlay.classList.add("is-visible");
  dispoOverlay.setAttribute("aria-hidden", "false");
}

function closeDispositions(): void {
  dispoOverlay.classList.remove("is-visible");
  dispoOverlay.setAttribute("aria-hidden", "true");
  (document.activeElement as HTMLElement | null)?.blur();
}

function renderDispositions(): void {
  const lang = getLang();
  const seat = online?.seat;
  const locked = !!seat && !!game.dispositions[seat];
  // Online, only this phone's column shows: the opponent's choice stays hidden until the reveal
  const shown = (player: Player): Disposition | null =>
    !seat ? game.dispositions[player] : player !== seat ? null : locked ? game.dispositions[seat] : dispoPick;
  dispoOverlay.querySelectorAll<HTMLElement>(".dispo-options").forEach((group) => {
    const player = Number(group.dataset.player) as Player;
    group.querySelectorAll<HTMLButtonElement>(".dispo-option").forEach((option) => {
      const data = DISPOSITIONS.find(({ id }) => id === option.dataset.value)!;
      option.setAttribute("aria-pressed", String(shown(player) === data.id));
      option.disabled = locked;
      option.querySelector(".dispo-option__hint")!.textContent = data.hint[lang];
    });
  });
  dispoIntro.textContent = t(seat ? "dispoYourIntro" : "dispoIntro");
  btnDispoOk.querySelector("span")!.textContent = t(seat ? "dispoLock" : "revealPrimaries");
  btnDispoOk.disabled = seat ? locked || !dispoPick : !game.dispositions[1] || !game.dispositions[2];
  dispoStatus.hidden = !seat;
  if (seat) {
    const them = other(seat);
    dispoStatus.textContent = t(game.dispositions[them] ? "dispoChosen" : "onlineWaiting", { n: them });
  }
}

/** Reveal, or online, lock in this phone's choice: the reveal comes once both are in */
function confirmDispositions(): void {
  if (!online) {
    revealPrimaries();
    return;
  }
  if (!dispoPick || game.dispositions[online.seat]) return;
  game.dispositions[online.seat] = dispoPick;
  if (!maybeReveal()) renderDispositions();
}

function cancelDispositions(): void {
  if (online) {
    game.choosing = false;
    game.dispositions[online.seat] = null;
  }
  closeDispositions();
}

/** Online, both choices in: the phone that sees it first deals the primaries, both show the VS */
function maybeReveal(): boolean {
  const [first, second] = [game.dispositions[1], game.dispositions[2]];
  if (!online || !game.choosing || !first || !second) return false;
  game.choosing = false;
  game.primaries = { 1: primaryFor(first, second).id, 2: primaryFor(second, first).id };
  game.primaryScored = { 1: {}, 2: {} };
  showReveal();
  return true;
}

function showReveal(): void {
  closeDispositions();
  setBattleMusic(true);
  openCards(online?.seat ?? 1, "primary");
}

/** Both dispositions known: each player gets the card of their deck facing the other's */
function revealPrimaries(): void {
  const mine = game.dispositions[1];
  const theirs = game.dispositions[2];
  if (!mine || !theirs) return;
  game.primaries = { 1: primaryFor(mine, theirs).id, 2: primaryFor(theirs, mine).id };
  game.primaryScored = { 1: {}, 2: {} };
  closeDispositions();
  // The battle music rises with the VS
  setBattleMusic(true);
  openCards(1, "primary");
}

function sectionTurnKey(player: Player, section: PrimarySection): string {
  return section.rounds === "end" ? "end" : String(scoringTurnIdx(player));
}

/** Whether a primary section scores now, from the player's own battle round */
function sectionOpen(player: Player, section: PrimarySection): boolean {
  const turnIdx = scoringTurnIdx(player);
  if (section.rounds === "end") return isOver() || turnIdx === MAX_GAME_TURN - 1;
  const round = turnIdx + 1;
  return round >= section.rounds[0] && round <= section.rounds[1];
}

function roundsLabel(section: PrimarySection): string {
  if (section.rounds === "end") return t("endOfBattle");
  const [from, to] = section.rounds;
  if (from === 1 && to === MAX_GAME_TURN) return t("anyRound");
  if (from === to) return t("roundN", { n: from });
  if (to === MAX_GAME_TURN) return t("roundFrom", { n: from });
  return t("roundsRange", { a: from, b: to });
}

const PRIMARY_WHEN_KEYS = { yours: "whenYours", command: "whenCommand", any: "whenAny", end: "" } as const;

function itemTotal(item: PrimaryItem, block: HTMLElement): number {
  const count = Number(block.dataset.count ?? 0);
  const bonus = Number(block.dataset.bonus ?? 0);
  if ("vp" in item) return item.vp;
  if ("per" in item) return item.per * count + (item.bonus ? item.bonus.per * bonus : 0);
  return item.base + item.plus.per * count;
}

function stepperHtml(field: "count" | "bonus", value: number): string {
  return `
    <span class="sec-option__stepper">
      <button type="button" class="mini-counter__btn" data-action="pri-step" data-field="${field}" data-delta="-1">−</button>
      <span class="sec-option__count" data-value="${field}">${value}</span>
      <button type="button" class="mini-counter__btn" data-action="pri-step" data-field="${field}" data-delta="1">+</button>
    </span>`;
}

function primaryCardEl(player: Player, index: number, deal: boolean, scorable: boolean): HTMLElement {
  const data = primaryCard(player)!;
  const lang = getLang();
  const unit = t("vpUnit");
  const el = document.createElement("article");
  el.className = `sec-card sec-card--primary is-p${player}`;
  el.classList.toggle("is-dealt", deal);
  el.style.setProperty("--i", String(index));
  el.dataset.primaryPlayer = String(player);
  el.innerHTML = `
    <div class="sec-card__inner">
      <header class="sec-card__head">
        <span class="sec-card__kicker"></span>
        <h3 class="sec-card__name"></h3>
        <span class="sec-card__when"></span>
      </header>
      <p class="sec-card__note"></p>
      <div class="pri-sections"></div>
      <footer class="sec-card__actions"></footer>
    </div>`;
  el.querySelector(".sec-card__kicker")!.textContent = `${t("primaryKicker")} · ${t("player", { n: player })}`;
  el.querySelector(".sec-card__name")!.textContent = data.name;
  // The force disposition this card belongs to
  el.querySelector(".sec-card__when")!.textContent = DISPOSITIONS.find(({ id }) => id === data.deck)!.name;
  const note = el.querySelector<HTMLElement>(".sec-card__note")!;
  note.textContent = data.note ? data.note[lang] : "";
  note.hidden = !data.note;

  const scored = game.primaryScored[player];
  const sections = data.sections.map((section, s) => {
    const turnKey = sectionTurnKey(player, section);
    const room = scorable && section.rounds !== "end" ? roomThisTurn(player, "primary") : Infinity;
    // At a turn end, only what scores at that moment: a Command phase line waits for the next turn
    const scoresNow = sectionOpen(player, section) && scoresInView(player, section.when);
    const open = scorable && scoresNow;
    const block = document.createElement("section");
    block.className = "pri-section";
    // Dimmed out of its rounds while playing; on the reveal the whole card reads at full strength
    block.classList.toggle("is-closed", scorable && !scoresNow);
    const whenKey = PRIMARY_WHEN_KEYS[section.when];
    block.innerHTML = `
      <header class="pri-section__head">
        <span class="pri-section__rounds"></span>
        <span class="pri-section__when"></span>
      </header>`;
    block.querySelector(".pri-section__rounds")!.textContent = roundsLabel(section);
    block.querySelector(".pri-section__when")!.textContent = whenKey ? t(whenKey) : "";
    if (section.pickOne) {
      const pick = document.createElement("span");
      pick.className = "pri-section__pick";
      pick.textContent = t("pickOneOf");
      block.querySelector(".pri-section__rounds")!.after(pick);
    }
    section.items.forEach((item, i) => {
      const key = `${turnKey}|${s}|${i}`;
      const done = scored[key];
      const blocked = !open;
      if ("vp" in item || done !== undefined) {
        // A fixed score, or any line already scored this turn (click again to undo)
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sec-option";
        button.classList.toggle("is-scored", done !== undefined);
        button.disabled = blocked;
        button.dataset.action = "pri-score";
        button.dataset.section = String(s);
        button.dataset.item = String(i);
        button.setAttribute("aria-pressed", String(done !== undefined));
        if (done !== undefined) button.title = t("scoredUndo");
        const shown = done ?? ("vp" in item ? item.vp : 0);
        const vp = done !== undefined ? `✓${shown}<small>${unit}</small>` : vpHtml(shown, open ? room : Infinity);
        button.innerHTML = `<span class="sec-option__vp">${vp}</span><span class="sec-option__label"></span>`;
        if (done === undefined && open) markCapped(button, shown, room);
        button.querySelector(".sec-option__label")!.textContent = item.label[lang];
        block.appendChild(button);
        return;
      }
      // Counted scores: how many things, then score the total
      const row = document.createElement("div");
      row.className = "sec-option sec-option--repeat";
      row.dataset.section = String(s);
      row.dataset.item = String(i);
      row.dataset.count = "per" in item ? "1" : "0";
      row.dataset.bonus = "0";
      const per = "per" in item ? item.per : item.base;
      const extra = "per" in item ? item.bonus : item.plus;
      row.innerHTML = `
        <span class="sec-option__vp">${"per" in item ? `${per}×` : per}<small>${unit}</small></span>
        <span class="sec-option__label"></span>
        <span class="sec-option__repeat">
          ${stepperHtml("count", Number(row.dataset.count))}
          <button type="button" class="sec-option__go" data-action="pri-score"></button>
        </span>`;
      row.querySelector(".sec-option__label")!.textContent = "per" in item ? item.label[lang] : `${item.label[lang]} · +${item.plus.per} ${item.plus.label[lang]}`;
      if ("per" in item && extra) {
        const bonus = document.createElement("span");
        bonus.className = "sec-option__bonus";
        bonus.innerHTML = `<span class="sec-option__bonus-label"></span>${stepperHtml("bonus", 0)}`;
        bonus.querySelector(".sec-option__bonus-label")!.textContent = `+${extra.per} · ${extra.label[lang]}`;
        row.insertBefore(bonus, row.querySelector(".sec-option__repeat"));
      }
      const go = row.querySelector<HTMLButtonElement>(".sec-option__go")!;
      go.dataset.section = String(s);
      go.dataset.item = String(i);
      setGoButton(go, itemTotal(item, row), open ? room : Infinity);
      row.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        button.disabled = blocked;
      });
      row.querySelector<HTMLElement>(".sec-option__repeat")!.hidden = !scorable;
      block.appendChild(row);
    });
    return block;
  });
  el.querySelector(".pri-sections")!.replaceChildren(...sections);

  const link = document.createElement("a");
  link.className = "sec-action sec-action--link";
  link.href = data.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `${t("fullCard")} ↗`;
  el.querySelector(".sec-card__actions")!.replaceChildren(link);
  return el;
}

/** Primary points: the turn's primary score (15 max) or, at the end of the battle, the end bonus */
function togglePrimaryScore(player: Player, s: number, i: number, vp: number): void {
  const card = primaryCard(player);
  if (!card) return;
  const section = card.sections[s];
  const turnKey = sectionTurnKey(player, section);
  const key = `${turnKey}|${s}|${i}`;
  const scored = game.primaryScored[player];
  const done = scored[key];
  // The points of a line leave the turn, or the end bonus, they went to
  const takeBack = (lineKey: string, points: number): void => {
    delete scored[lineKey];
    if (turnKey === "end") game.endBonus[player] = Math.max(0, game.endBonus[player] - points);
    else {
      const turns = game.scoreByTurn[player].primary;
      turns[Number(turnKey)] = Math.max(0, turns[Number(turnKey)] - points);
    }
  };
  if (done !== undefined) {
    takeBack(key, done);
    playSound("undo");
  } else {
    if (!sectionOpen(player, section)) return;
    // One of: picking another line takes back the one picked before
    if (section.pickOne) {
      section.items.forEach((_, other) => {
        const otherKey = `${turnKey}|${s}|${other}`;
        const points = scored[otherKey];
        if (points !== undefined) takeBack(otherKey, points);
      });
    }
    let added = vp;
    if (turnKey === "end") game.endBonus[player] += vp;
    else {
      const turns = game.scoreByTurn[player].primary;
      const turnIdx = Number(turnKey);
      added = Math.max(0, Math.min(vp, MAX_POINTS_PER_TURN - turns[turnIdx]));
      turns[turnIdx] += added;
    }
    scored[key] = added;
    playSound("score");
  }
  renderMiniCounters();
  renderCards();
}

function adjustScore(player: Player, kind: ScoreKind, delta: 1 | -1): void {
  const turns = game.scoreByTurn[player][kind];
  const turnIdx = scoringTurnIdx(player);
  if (delta > 0) {
    if (turns[turnIdx] >= MAX_POINTS_PER_TURN) return;
    turns[turnIdx] += 1;
  } else {
    // The counter shows this turn only, so a minus can only take back this turn's points
    if (turns[turnIdx] === 0) return;
    turns[turnIdx] -= 1;
  }
  renderMiniCounters();
}

function currentPlayerTurnSlot(): number {
  return playerTurnSlot(game.round, game.turnPlayer);
}

function recordCpManualAdjust(player: Player, slot: number, applied: number): void {
  if (applied === 0 || slot < 0 || slot >= MAX_PLAYER_TURNS) return;
  const history = game.cpHistory[player];
  if (applied > 0) history.added[slot] += applied;
  else history.removed[slot] += -applied;
}

function adjustCp(player: Player, delta: number): void {
  if (delta === 0) return;
  const current = game.cp[player];
  const next = clampCp(current + delta);
  const applied = next - current;
  if (applied === 0) return;
  game.cp[player] = next;
  if (inGame(game)) recordCpManualAdjust(player, currentPlayerTurnSlot(), applied);
  renderMiniCounters();
}

/**
 * Both players gain 1 CP when a new player turn begins (Enter confirmed).
 * Not recorded in manual CP history (tooltip: added/removed per turn only).
 */
function gainCpBothPlayers(): void {
  game.cp[1] = clampCp(game.cp[1] + 1);
  game.cp[2] = clampCp(game.cp[2] + 1);
  renderMiniCounters();
}

function adjustEndBonus(player: Player, delta: 1 | -1): void {
  game.endBonus[player] = Math.max(0, game.endBonus[player] + delta);
  renderMiniCounters();
}

const scoreActions = ([1, 2] as const).flatMap((player): [string, () => void][] => [
  ...SCORE_KINDS.flatMap(({ kind }): [string, () => void][] => [
    [`p${player}-${kind}-minus`, () => { adjustScore(player, kind, -1); }],
    [`p${player}-${kind}-plus`, () => { adjustScore(player, kind, 1); }],
  ]),
  [`p${player}-bonus-minus`, () => { adjustEndBonus(player, -1); }],
  [`p${player}-bonus-plus`, () => { adjustEndBonus(player, 1); }],
]);

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
    const target = e.target as HTMLElement;
    const unit = target.closest<HTMLButtonElement>(".unit-toggle");
    if (unit) {
      toggleAbilityLost(player, Number(unit.dataset.abilityId));
      return;
    }
    const coin = target.closest<HTMLButtonElement>(".cp-coin");
    if (coin) spendCpCoin(player, coin);
  });
}
abilityList.addEventListener("click", (e) => {
  if (abilitiesPlayer === null) return;
  const target = e.target as HTMLElement;
  const timing = target.closest<HTMLButtonElement>(".ability-timing .segmented__option");
  if (timing) {
    setCpTiming(abilitiesPlayer, timing.dataset.value as AbilityKind);
    return;
  }
  const toggle = target.closest<HTMLButtonElement>(".ability-toggle");
  if (toggle) toggleAbilitySlot(abilitiesPlayer, toggle.dataset.slot as AbilitySlot);
});
btnAbilitiesClose.addEventListener("click", closeAbilities);

for (const player of [1, 2] as const) {
  handButtonEl[player].addEventListener("click", () => openCards(player, "hand"));
  turnEndAlertEl[player].addEventListener("click", () => openCards(player, "hand"));
  primaryButtonEl[player].addEventListener("click", () => openCards(player, "mission"));
}
cardsSwitch.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  if (tab && !tab.disabled) showCardsTab(tab.dataset.tab!);
});
/** Continue: after the primaries reveal, the game starts */
function continueCards(): void {
  if (cardsPlayer === null || btnCardsClose.disabled) return;
  // The end of a turn goes through each side that scores before it ends: the opponent's cards can't be skipped
  const nextSide = nextEndTurnSide();
  if (nextSide !== null) {
    openCards(nextSide, "end-turn");
    return;
  }
  const startsGame = cardsMode === "primary";
  const turnEnd = cardsMode === "end-turn" ? endTurnKind : null;
  closeCards();
  if (startsGame) start();
  if (isTurnEndKind(turnEnd)) endTurn(turnEnd);
}

btnCardsClose.addEventListener("click", continueCards);
// The board behind is out of reach; a click beside the cards goes back to it, as Escape does.
// Not the second click of a double-click: that one would close what the first click opened.
// Not on the primaries reveal either: the game starts from there, a stray click must not cancel it
cardsOverlay.addEventListener("click", (e) => {
  if (cardsPlayer === null || cardsMode === "primary" || e.detail > 1) return;
  if ((e.target as HTMLElement).closest(".sec-card, button, a")) return;
  closeCards();
});
dispoOverlay.addEventListener("click", (e) => {
  const option = (e.target as HTMLElement).closest<HTMLButtonElement>(".dispo-option");
  if (!option || option.disabled) return;
  const player = Number(option.closest<HTMLElement>(".dispo-options")!.dataset.player) as Player;
  if (online) {
    if (player === online.seat) dispoPick = option.dataset.value as Disposition;
  } else game.dispositions[player] = option.dataset.value as Disposition;
  renderDispositions();
});
btnDispoOk.addEventListener("click", confirmDispositions);
btnDispoCancel.addEventListener("click", cancelDispositions);
window.addEventListener("resize", () => {
  if (cardsPlayer !== null) layoutCardsRow();
});
secondaryCardsToggle.addEventListener("change", () => {
  game.options.cards = secondaryCardsToggle.checked;
  secondaryCardsToggle.blur();
  renderHandButtons();
});
cardsRow.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const scoredCard = cardsMode === "scored" && !target.closest("a") ? target.closest<HTMLElement>(".sec-card") : null;
  if (scoredCard && cardsPlayer !== null) {
    askUnscore(cardsPlayer, scoredCard.dataset.cardId!);
    return;
  }
  const button = target.closest<HTMLButtonElement>("button[data-action]");
  const cardEl = button?.closest<HTMLElement>(".sec-card");
  if (button && cardEl?.dataset.primaryPlayer && ["mission", "command", "end-turn"].includes(cardsMode)) {
    const owner = Number(cardEl.dataset.primaryPlayer) as Player;
    if (online && owner !== online.seat) return;
    const card = primaryCard(owner);
    const s = Number(button.dataset.section ?? button.closest<HTMLElement>(".sec-option--repeat")?.dataset.section);
    const row = button.closest<HTMLElement>(".sec-option--repeat");
    const i = Number(button.dataset.item ?? row?.dataset.item);
    const item = card?.sections[s]?.items[i];
    if (!card || !item) return;
    if (button.dataset.action === "pri-step" && row) {
      const field = button.dataset.field === "bonus" ? "bonus" : "count";
      const min = field === "count" && "per" in item ? 1 : 0;
      const max = field === "bonus" ? Number(row.dataset.count) : 99;
      const value = Math.max(min, Math.min(max, Number(row.dataset[field]) + Number(button.dataset.delta)));
      row.dataset[field] = String(value);
      // Fewer things than bonus things makes no sense
      if (Number(row.dataset.bonus) > Number(row.dataset.count)) row.dataset.bonus = row.dataset.count;
      row.querySelectorAll<HTMLElement>("[data-value]").forEach((span) => {
        span.textContent = row.dataset[span.dataset.value === "bonus" ? "bonus" : "count"] ?? "0";
      });
      const room = card.sections[s].rounds === "end" ? Infinity : roomThisTurn(owner, "primary");
      setGoButton(row.querySelector<HTMLElement>(".sec-option__go")!, itemTotal(item, row), room);
      return;
    }
    if (button.dataset.action === "pri-score") togglePrimaryScore(owner, s, i, row ? itemTotal(item, row) : "vp" in item ? item.vp : 0);
    return;
  }
  if (!button || !cardEl || cardsPlayer === null || cardEl.matches(".is-scored, .is-discarded")) return;
  const player = cardsPlayer;
  const id = cardEl.dataset.cardId!;
  const option = button.closest<HTMLElement>(".sec-option--repeat");
  const scoring = ["score", "less", "more", "score-repeat"].includes(button.dataset.action ?? "");
  if (scoring && cardsMode !== "hand" && cardsMode !== "end-turn") return;
  switch (button.dataset.action) {
    case "score":
      scoreSecondary(player, id, Number(button.dataset.vp), cardEl);
      break;
    case "less":
    case "more": {
      if (!option) return;
      const per = Number(option.dataset.per);
      const maxCount = Math.ceil(Number(option.dataset.max) / per);
      const delta = button.dataset.action === "more" ? 1 : -1;
      const count = Math.max(1, Math.min(maxCount, Number(option.dataset.count) + delta));
      option.dataset.count = String(count);
      option.querySelector(".sec-option__count")!.textContent = String(count);
      setGoButton(option.querySelector<HTMLElement>(".sec-option__go")!, repeatTotal(option), roomThisTurn(player, "secondary"));
      break;
    }
    case "score-repeat":
      if (option) scoreSecondary(player, id, repeatTotal(option), cardEl);
      break;
    case "swap":
      if (cardsMode === "draw") swapSecondary(player, id, cardEl);
      break;
    case "redraw":
      redrawSecondary(player, id, cardEl);
      break;
  }
});

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
      t(i === game.round ? "dotCurrent" : i < game.round ? "dotDone" : "dotNext", { n: i }),
    );
    if (i < game.round) dot.classList.add("turn-dot--past");
    else if (i === game.round) dot.classList.add("turn-dot--current");
    else dot.classList.add("turn-dot--future");
    turnDots.appendChild(dot);
  }
}

function advanceGameTurn(): void {
  if (game.round >= MAX_GAME_TURN) return;
  game.round += 1;
  renderMiniCounters();
  setActiveClock(game.clock, 1);
  game.turnPlayer = 1;
  gainCpBothPlayers();
  startRoundAbilities();
  lastSpaceTime = 0;
  activeBeforeSpaceSequence = 1;
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
  if (isRunning()) return;
  hideResultOverlay();
  if (timeLeft(1) <= 0 || timeLeft(2) <= 0) return;
  lastSpaceTime = 0;
  game.phase = "running";
  if (!game.photoBreak) runClock(game.clock);
  setInputsEnabled(false);
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
  void tryAcquireWakeLock();
  startLoop();
}

btnReset.addEventListener("click", () => {
  if (inGame(game)) openTurnConfirmModal("reset");
  else reset();
});
btnFullscreen.addEventListener("click", toggleFullscreen);
btnTurnConfirmOk.addEventListener("click", applyTurnConfirm);
btnTurnConfirmCancel.addEventListener("click", hideTurnConfirmModal);
btnResultDismiss.addEventListener("click", hideResultOverlay);
btnPhotoResume.addEventListener("click", endPhotoBreak);
// A focused checkbox would swallow Enter / Space, the game shortcuts
photoBreaksToggle.addEventListener("change", () => {
  game.options.photoBreaks = photoBreaksToggle.checked;
  photoBreaksToggle.blur();
});
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
  if (!isRunning()) {
    if (isOver()) return;
    if (isStopped(game)) resume();
    else return;
    return;
  }

  if (online && game.clock.active !== online.seat) return;
  const now = performance.now();
  if (lastSpaceTime > 0 && now - lastSpaceTime < DOUBLE_SPACE_MS) {
    setActiveClock(game.clock, activeBeforeSpaceSequence);
    pause();
    return;
  }
  activeBeforeSpaceSequence = game.clock.active;
  lastSpaceTime = now;
  switchTurn();
}

window.addEventListener("keydown", (e) => {
  if (e.code === MUTE_KEY_CODE && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
    e.preventDefault();
    toggleMute();
    return;
  }
  if (onlineOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeOnlineDialog();
    }
    return;
  }
  // The abilities panel is a form: keys keep their usual meaning there
  if (abilitiesOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAbilities();
    }
    return;
  }
  if (dispoOverlay.classList.contains("is-visible")) {
    if (e.code === "Enter" && !e.repeat) {
      e.preventDefault();
      confirmDispositions();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelDispositions();
    } else if (e.code === "Space") {
      e.preventDefault();
    }
    return;
  }
  const keyMode = cardKeyMode(e);
  if (cardsPlayer !== null && !turnConfirmOverlay.classList.contains("is-visible")) {
    const sameView = keyMode === cardsMode || (keyMode === "hand" && cardsMode === "scored");
    if (e.code === "Enter" && !e.repeat) {
      e.preventDefault();
      continueCards();
    } else if (e.key === "Escape" || sameView) {
      e.preventDefault();
      closeCards();
    } else if (keyMode !== null && (cardsMode === "hand" || cardsMode === "scored" || cardsMode === "mission")) {
      // From the secondaries to the primary and back
      e.preventDefault();
      openCards(cardsPlayer, keyMode);
    } else if (e.key === SWITCH_KEY && !cardsSwitch.hidden) {
      e.preventDefault();
      const next = cardsTabs().find((tab) => !tab.on && tab.count > 0);
      if (next) showCardsTab(next.value);
    } else if (e.code === "Space") {
      e.preventDefault();
    }
    return;
  }
  if (e.key === "Escape" && POPOVERS.some(([, panel]) => !panel.hidden)) {
    e.preventDefault();
    closePopovers();
    return;
  }
  if (e.key === "Escape" && timePicker.matches(":focus-within")) {
    e.preventDefault();
    foldTimePicker();
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
  const keyPlayer = keyMode && !isTypingTarget(e.target) && !anyModalOpen() ? cardKeyPlayer() : null;
  if (keyMode && keyPlayer && (keyMode === "hand" || primaryCard(keyPlayer))) {
    e.preventDefault();
    openCards(keyPlayer, keyMode);
    return;
  }
  if (e.code === "Enter" && !e.repeat) {
    if (shouldIgnoreSpaceLike(e.target)) return;
    if (!isRunning()) {
      e.preventDefault();
      if (isOver()) return;
      if (isStopped(game)) handleSpaceLikeInput();
      else requestStart();
      return;
    }
    e.preventDefault();
    // Online, only the player whose turn it is ends it
    if (online && game.turnPlayer !== online.seat) return;
    requestTurnEnd();
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
  if (cardsPlayer !== null) return;
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

onSegmentedPick(timePresets, (value) => {
  if (isRunning()) return;
  if (value === CUSTOM_PRESET_VALUE) {
    setTimePreset(value);
    m1.focus();
    m1.select();
    return;
  }
  applyPresetSeconds(Number(value));
  foldTimePicker();
});

timePicker.addEventListener("mouseleave", () => {
  if (!timePicker.contains(document.activeElement)) timePicker.classList.remove("is-folded");
});
timePicker.addEventListener("mouseenter", () => {
  if (!timePicker.matches(":focus-within")) timePicker.classList.remove("is-folded");
});

[m1, m2].forEach((input) => {
  input.addEventListener("input", () => {
    if (isRunning()) return;
    // Also while paused: the time left can be corrected mid-game
    const { a, b } = readMinutes();
    game.clock.left = { 1: a * 60, 2: b * 60 };
    applyTimesToDisplay();
    renderTimeValue();
  });
  // Enter validates the custom time and gives the keyboard back to the game
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    foldTimePicker();
  });
});

onSegmentedPick(themeOptions, applyTheme);
for (const picker of factionPickers) {
  const button = pickerButton(picker);
  button.addEventListener("click", () => (openPicker === picker ? closePicker(true) : openPickerList(picker)));
  // The bar's own keys (Enter starts the game) must not reach it while a list is at hand
  button.addEventListener("keydown", (e) => {
    if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    openPickerList(picker);
  });
  pickerList(picker).addEventListener("keydown", (e) => onPickerKey(picker, e));
  pickerList(picker).addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[role="option"]');
    if (row) choosePickerOption(picker, row.dataset.value!);
  });
}
document.addEventListener("pointerdown", (e) => {
  if (openPicker && !openPicker.root.contains(e.target as Node)) closePicker();
});
onSegmentedPick(uiSizeOptions, applyUiSize);
onSegmentedPick(sfxOptions, applySounds);
// A tick when a switch or an option is set, brighter when it turns on.
// Not the card scores nor the card tabs: they have their own sounds
app.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("button[aria-pressed]");
  if (!button || button.closest(".cards-row, .cards-switch")) return;
  playSound(button.getAttribute("aria-pressed") === "true" ? "checkOn" : "checkOff");
});
app.addEventListener("change", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") playSound(e.target.checked ? "checkOn" : "checkOff");
});
onSegmentedPick(musicOptions, applyMusic);
volumeInput.addEventListener("input", () => applyVolume(Number(volumeInput.value)));
// Browsers hold audio back until the page gets a click or a key
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);
onSegmentedPick(layoutOptions, applyLayout);
onSegmentedPick(langOptions, applyLang);

btnSettings.addEventListener("click", () => togglePopover(btnSettings, settingsPanel));
document.addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement).closest(".popover-anchor")) closePopovers();
});

/* ---------- Online: one game on two phones ---------- */

/** The state as last agreed with the server, and its revision: each write adds one */
type Synced = { rev: number; json: string };
let synced: Synced = { rev: 0, json: "" };
/** Newest state seen from the server, kept while a write of ours is on its way */
let latestRemote: Synced | null = null;
let pushing = false;

const ONLINE_STORAGE_KEY = "warhammerClock.online";
/** As in room.ts, which loads only once a game goes online */
const ONLINE_CODE_LENGTH = 5;

const packState = ({ rev, json }: Synced): string => `${rev}|${json}`;

function unpackState(stored: string): Synced {
  const bar = stored.indexOf("|");
  return { rev: Number(stored.slice(0, bar)) || 0, json: stored.slice(bar + 1) };
}

/** Sends this phone's changes. What the other phone changed meanwhile is kept, field by field */
async function pushState(): Promise<void> {
  const room = online?.room;
  // Joining: nothing is sent before the room's game has come in
  if (!room || pushing || synced.rev === 0) return;
  const local = JSON.stringify(game);
  if (local === synced.json) return;
  const base = synced;
  pushing = true;
  let sent = false;
  try {
    const stored = await room.transact((remote) => {
      const current = remote === null ? base : unpackState(remote);
      return packState({ rev: current.rev + 1, json: merge(current.json, base.json, local) });
    });
    if (online?.room !== room) return;
    synced = unpackState(stored);
    sent = true;
    // Changes made here while the write was on its way go on top of what the server kept
    const now = JSON.stringify(game);
    const next = merge(synced.json, local, now);
    if (next !== now) applyState(next);
  } catch {
    // Offline or refused: the next tick tries again
  } finally {
    pushing = false;
  }
  // What came from the other phone during the write is applied now, sent or not
  if (latestRemote && latestRemote.rev > synced.rev) receiveState(latestRemote);
  else if (sent && JSON.stringify(game) !== synced.json) void pushState();
}

function receiveState(remote: Synced): void {
  if (!latestRemote || remote.rev > latestRemote.rev) latestRemote = remote;
  if (pushing || remote.rev <= synced.rev) return;
  const joining = synced.rev === 0;
  const local = JSON.stringify(game);
  // Joining takes the room's game as it is; later, this phone's own changes are kept on top
  const next = joining ? remote.json : merge(remote.json, synced.json, local);
  synced = remote;
  if (next !== local) applyState(next, joining);
  if (next !== remote.json) void pushState();
}

function applyState(json: string, joining = false): void {
  const prev = game;
  // A field a newer version of the app adds is kept from this phone's state
  game = { ...game, ...(JSON.parse(json) as GameState) };
  renderState(prev, joining);
}

/** The part of the state a player's open cards show */
const cardsData = (state: GameState, player: Player): string =>
  JSON.stringify([state.secondaries[player], state.primaryScored[player], state.scoreByTurn[player], state.turnPlayer, state.round]);

/**
 * Puts the screen in line with a state that came from the other phone: what this phone does on
 * its own after an action of its own (sounds, overlays, the loop) follows from what changed
 */
function renderState(prev: GameState, joining: boolean): void {
  photoBreaksToggle.checked = game.options.photoBreaks;
  secondaryCardsToggle.checked = game.options.cards;
  const wasInGame = inGame(prev);
  if (game.phase === "setup" && wasInGame) resetScreen();
  if (game.choosing && !prev.choosing) {
    dispoPick = null;
    openDispositions();
  } else if (!game.choosing && prev.choosing && !game.primaries[1]) closeDispositions();
  if (game.phase === "setup" && game.primaries[1] && !prev.primaries[1]) showReveal();
  else maybeReveal();
  if (!wasInGame && inGame(game)) {
    if (cardsPlayer !== null && cardsMode === "primary") closeCards(false);
    closePopovers();
    closeDispositions();
    hideTurnConfirmModal();
    hideResultOverlay();
    if (!joining) turnSound("start");
    setBattleMusic(true);
  }
  if (game.phase === "over" && prev.phase !== "over") showGameOverScreen();
  if (!joining && isRunning() && prev.phase === "running") {
    if (prev.turnPlayer !== game.turnPlayer || prev.round !== game.round) turnSound(prev.round !== game.round ? "round" : "turn");
    else if (prev.clock.active !== game.clock.active) playSound("switch");
  }

  if (isRunning() && game.clock.since !== null) {
    startLoop();
    void tryAcquireWakeLock();
  } else {
    stopLoop();
    if (!isRunning()) void releaseWakeLock();
  }
  if (!isRunning()) syncInputsFromState();
  if (game.phase === "setup") syncPresetSelectFromState();
  setInputsEnabled(!isRunning());
  if (game.photoBreak && !prev.photoBreak) showPhotoBreak();
  else if (!game.photoBreak && prev.photoBreak) hidePhotoBreak();
  const seat = online?.seat;
  if (!joining && seat && game.cpNotice[seat].n !== prev.cpNotice[seat].n) sayCp(seat, game.cpNotice[seat].gained);
  // The other phone ended its turn and waits for this one's end-of-turn scores, or stopped waiting
  if (seat && game.turnEnd?.scorer === seat && (joining || prev.turnEnd?.scorer !== seat)) openTurnEndScoring();
  else if (seat && !game.turnEnd && prev.turnEnd?.scorer === seat && cardsPlayer === seat && cardsMode === "end-turn") {
    closeCards(false);
  }
  if (!joining && game.lastDraw.n !== prev.lastDraw.n) {
    const { player, ids } = game.lastDraw;
    if (game.photoBreak) {
      if (online?.seat === player) pendingDraw = { player, drawn: ids };
    } else showDraw(player, ids);
  }

  applyTimesToDisplay();
  setActivePanels();
  updateButtons();
  renderTurnDots();
  renderMiniCounters();
  renderAbilities(1);
  renderAbilities(2);
  renderDispositions();
  if (abilitiesPlayer !== null) renderAbilityList();
  if (cardsPlayer !== null && cardsMode !== "primary" && cardsData(prev, cardsPlayer) !== cardsData(game, cardsPlayer)) renderCards();
  renderSeat();
}

/** The other phone reset the game */
function resetScreen(): void {
  setBattleMusic(false);
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  hideResultOverlay();
  pendingDraw = null;
  afterPutAway = null;
  hidePhotoBreak();
  closeCards(false);
  closeAbilities();
}

/** The game ended on the other phone: the same result shows here */
function showGameOverScreen(): void {
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  setBattleMusic(false);
  playSound("victory");
  const flagged = ([1, 2] as const).find((player) => timeLeft(player) <= 0);
  if (flagged) {
    const winner = other(flagged);
    showResultOverlay(t("wins", { n: winner }), t("ranOutOfTime", { n: flagged }), winner);
    (flagged === 1 ? panel1 : panel2).classList.add("is-flag");
    return;
  }
  const [total1, total2] = [scoreOf(1), scoreOf(2)];
  if (total1 > total2) showResultOverlay(t("wins", { n: 1 }), t("wonOnPoints"), 1);
  else if (total2 > total1) showResultOverlay(t("wins", { n: 2 }), t("wonOnPoints"), 2);
  else showResultOverlay(t("draw"), t("tiedOnPoints"), null);
}

/** Creates a room with this game (no code), or joins one; this phone takes `seat` */
async function connectRoom(seat: Player, code?: string): Promise<void> {
  const { createRoom, joinRoom } = await import("./room");
  leaveRoom();
  online = { seat, room: null, connected: true, seats: { 1: false, 2: false } };
  const events: RoomEvents = {
    onState: (stored) => receiveState(unpackState(stored)),
    onConnection: (connected) => {
      if (!online) return;
      online.connected = connected;
      renderSeat();
    },
    onSeats: (seats) => {
      if (!online) return;
      online.seats = seats;
      renderSeat();
      renderOnlineDialog();
    },
  };
  try {
    if (code) {
      synced = { rev: 0, json: "" };
      online.room = await joinRoom(code, seat, events);
    } else {
      synced = { rev: 1, json: JSON.stringify(game) };
      online.room = await createRoom(seat, packState(synced), events);
    }
  } catch (error) {
    leaveRoom();
    throw error;
  }
  store(ONLINE_STORAGE_KEY, JSON.stringify({ code: online.room.code, seat }));
  document.documentElement.dataset.seat = String(seat);
  renderSeat();
}

/** Back to one screen for both players, with the game as it stands */
function leaveRoom(): void {
  online?.room?.leave();
  online = null;
  synced = { rev: 0, json: "" };
  latestRemote = null;
  forget(ONLINE_STORAGE_KEY);
  delete document.documentElement.dataset.seat;
  renderSeat();
}

// Each tap or key may have changed the game: it is sent right after, and a timer catches the rest
for (const type of ["pointerdown", "click", "keydown", "input", "change"]) {
  window.addEventListener(
    type,
    () => {
      if (online) window.setTimeout(() => void pushState(), 0);
    },
    true,
  );
}
window.setInterval(() => void pushState(), 500);

/* ---------- Online: this phone's player ---------- */

const seatText = (id: string, text: string): void => {
  app.querySelector<HTMLElement>(`#${id}`)!.textContent = text;
};

/** Where each player's CP units and CP toast sit on the board, to put them back after an online game */
const abilitiesHome: Record<Player, HTMLElement> = { 1: abilitiesEl[1].parentElement!, 2: abilitiesEl[2].parentElement! };
const cpToastHome: Record<Player, HTMLElement> = { 1: cpToastEl[1].parentElement!, 2: cpToastEl[2].parentElement! };
const seatCpCard = app.querySelector<HTMLElement>(".seat-cp")!;

/** The two clocks, every frame: this phone's large, the opponent's small */
function renderSeatTimes(): void {
  if (!online) return;
  renderTime(seatTime, timeLeft(online.seat));
  seatOppTime.textContent = formatTime(timeLeft(other(online.seat)));
}

function renderSeat(): void {
  for (const player of [1, 2] as const) {
    const inSeat = online?.seat === player;
    const home = inSeat ? seatAbilities : abilitiesHome[player];
    if (abilitiesEl[player].parentElement !== home) home.append(abilitiesEl[player]);
    const toastHome = inSeat ? seatCpCard : cpToastHome[player];
    if (cpToastEl[player].parentElement !== toastHome) toastHome.append(cpToastEl[player]);
  }
  if (!online) return;
  const me = online.seat;
  const them = other(me);
  const running = isRunning();
  const mine = running && game.clock.active === me;
  const room = app.querySelector<HTMLElement>("#seat-room")!;
  room.classList.toggle("is-offline", !online.connected);
  room.title = online.connected ? "" : t("onlineOffline");
  seatText("seat-code", online.room?.code ?? t("onlineConnecting"));
  seatText("seat-round", inGame(game) ? `${t("round")} ${game.round}` : "");
  seatText("seat-opp-name", t("player", { n: them }));
  seatText("seat-opp-score", String(scoreOf(them)));
  app.querySelector("#seat-opp")!.classList.toggle("is-running", running && game.clock.active === them);
  const turn = inGame(game) ? ` · ${t(game.turnPlayer === me ? "seatYourTurn" : "seatTheirTurn")}` : "";
  seatText("seat-who", `${t("player", { n: me })}${turn}`);
  const hint = !inGame(game)
    ? t("seatSetup")
    : isOver()
      ? t("gameOver")
      : !running
        ? t("paused")
        : t(mine ? "seatTapToPass" : "seatTheirClock");
  seatText("seat-hint", hint);
  seatClock.classList.toggle("is-running", mine);
  seatClock.setAttribute("aria-disabled", String(!mine));
  renderSeatTimes();

  // The game totals, as on the board; the gauges show this turn against its 15
  const turnIdx = scoringTurnIdx(me);
  const turns = game.scoreByTurn[me];
  seatText("seat-score", String(scoreOf(me)));
  for (const { kind } of SCORE_KINDS) {
    const points = turns[kind][turnIdx];
    seatText(`seat-${kind}`, String(sum(turns[kind])));
    setCapGauge(app.querySelector<HTMLElement>(`#seat-${kind}-cap`)!, points, turnIdx, true);
    app.querySelector<HTMLButtonElement>(`#seat-${kind}-plus`)!.disabled = !inGame(game) || points >= MAX_POINTS_PER_TURN;
    app.querySelector<HTMLButtonElement>(`#seat-${kind}-minus`)!.disabled = !inGame(game) || points === 0;
  }
  app.querySelector<HTMLElement>("#seat-bonus-row")!.hidden =
    game.endBonus[me] === 0 && (!inGame(game) || turnIdx !== MAX_GAME_TURN - 1);
  seatText("seat-bonus", String(game.endBonus[me]));
  seatText("seat-cp", String(game.cp[me]));
  seatText("seat-hand-count", String(game.secondaries[me].hand.length));
  const playing = inGame(game) && !isOver();
  app.querySelector<HTMLElement>("#seat-hand")!.hidden = !secondaryCardsOn() || !inGame(game);
  app.querySelector<HTMLElement>("#seat-mission")!.hidden = !secondaryCardsOn() || !inGame(game) || !primaryCard(me);
  app.querySelector<HTMLElement>("#seat-opp-primary")!.hidden = !secondaryCardsOn() || !primaryCard(them);
  const pauseBtn = app.querySelector<HTMLButtonElement>("#seat-pause")!;
  pauseBtn.hidden = !playing;
  pauseBtn.textContent = t(running ? "seatPause" : "seatResume");
  app.querySelector<HTMLElement>("#seat-end")!.hidden = !running || game.turnPlayer !== me || game.turnEnd !== null;
  renderSeatBanner(me);
  app.querySelector<HTMLElement>("#seat-reset")!.hidden = !inGame(game);
}

/** A tap on this phone's own running clock passes it to the opponent */
seatClock.addEventListener("click", () => {
  if (!online || !isRunning() || game.clock.active !== online.seat) return;
  switchTurn();
  renderSeat();
});

const seatActions: [string, (me: Player) => void][] = [
  ...SCORE_KINDS.flatMap(({ kind }): [string, (me: Player) => void][] => [
    [`seat-${kind}-minus`, (me) => adjustScore(me, kind, -1)],
    [`seat-${kind}-plus`, (me) => adjustScore(me, kind, 1)],
  ]),
  ["seat-bonus-minus", (me) => adjustEndBonus(me, -1)],
  ["seat-bonus-plus", (me) => adjustEndBonus(me, 1)],
  ["seat-cp-minus", (me) => adjustCp(me, -1)],
  ["seat-cp-plus", (me) => adjustCp(me, 1)],
  ["seat-abilities-btn", (me) => openAbilities(me)],
  ["seat-hand", (me) => openCards(me, "hand")],
  ["seat-mission", (me) => openCards(me, "mission")],
  ["seat-opp-primary", (me) => openCards(other(me), "mission")],
  [
    "seat-pause",
    () => {
      if (isRunning()) pause();
      else if (game.phase === "paused") resume();
    },
  ],
  [
    "seat-end",
    (me) => {
      if (isRunning() && game.turnPlayer === me) requestTurnEnd();
    },
  ],
  [
    "seat-reset",
    () => {
      if (inGame(game)) openTurnConfirmModal("reset");
    },
  ],
  ["seat-room", () => openOnlineDialog()],
  [
    "seat-banner-btn",
    (me) => {
      const pending = game.turnEnd;
      if (pending?.scorer === me) openTurnEndScoring();
      else if (pending) endTurn(pending.kind, true);
      else openCards(me, "hand");
    },
  ],
];
for (const [id, action] of seatActions) {
  app.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener("click", () => {
    if (!online) return;
    action(online.seat);
    renderSeat();
  });
}

/* ---------- Online: the dialog to create or join a game ---------- */

/** The seat picked in the dialog, before going online */
let pickedSeat: Player = 1;
let shownQrCode = "";

const shareLink = (code: string, seat: Player): string =>
  `${location.origin}${location.pathname}?room=${code}&seat=${seat}`;

function showOnlineError(text: string | null): void {
  onlineError.hidden = text === null;
  onlineError.textContent = text ?? "";
}

function renderOnlineDialog(): void {
  const room = online?.room ?? null;
  app.querySelector<HTMLElement>("#online-start")!.hidden = !!online;
  app.querySelector<HTMLElement>("#online-room")!.hidden = !online;
  app.querySelector<HTMLElement>("#online-leave")!.hidden = !online;
  setSegmentedValue(onlineSeatPicker, String(pickedSeat));
  if (!online) return;
  const them = other(online.seat);
  seatText("online-room-code", room?.code ?? t("onlineConnecting"));
  seatText("online-scan", room ? t("onlineScan", { n: them }) : "");
  seatText("online-status", room ? t(online.seats[them] ? "onlineReady" : "onlineWaiting", { n: them }) : "");
  app.querySelector<HTMLElement>("#online-share")!.hidden = !room;
  if (room && shownQrCode !== room.code) {
    shownQrCode = room.code;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      const qr = qrcode(0, "M");
      qr.addData(shareLink(room.code, them));
      qr.make();
      app.querySelector<HTMLElement>("#online-qr")!.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    });
  }
}

function openOnlineDialog(code = ""): void {
  closePopovers();
  if (code) onlineCodeInput.value = code;
  showOnlineError(null);
  renderOnlineDialog();
  onlineOverlay.classList.add("is-visible");
  onlineOverlay.setAttribute("aria-hidden", "false");
}

function closeOnlineDialog(): void {
  onlineOverlay.classList.remove("is-visible");
  onlineOverlay.setAttribute("aria-hidden", "true");
  (document.activeElement as HTMLElement | null)?.blur();
}

function roomErrorText(error: unknown): string {
  return t(error instanceof Error && error.message === "not-found" ? "onlineNotFound" : "onlineUnavailable");
}

async function goOnline(seat: Player, code?: string): Promise<void> {
  showOnlineError(null);
  try {
    await connectRoom(seat, code);
    renderOnlineDialog();
    // Joining: straight to the game. Creating: the code stays up for the opponent
    if (code) closeOnlineDialog();
  } catch (error) {
    showOnlineError(roomErrorText(error));
    renderOnlineDialog();
  }
}

onSegmentedPick(onlineSeatPicker, (value) => {
  pickedSeat = value === "2" ? 2 : 1;
  setSegmentedValue(onlineSeatPicker, value);
});
btnOnline.addEventListener("click", () => openOnlineDialog());
app.querySelector("#online-create")!.addEventListener("click", () => void goOnline(pickedSeat));
app.querySelector("#online-join")!.addEventListener("click", () => {
  const code = onlineCodeInput.value.trim().toUpperCase();
  if (code.length !== ONLINE_CODE_LENGTH) {
    showOnlineError(t("onlineNotFound"));
    return;
  }
  void goOnline(pickedSeat, code);
});
onlineCodeInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") app.querySelector<HTMLButtonElement>("#online-join")!.click();
});
app.querySelector("#online-share")!.addEventListener("click", () => {
  const code = online?.room?.code;
  if (!online || !code) return;
  const url = shareLink(code, other(online.seat));
  if (navigator.share) {
    void navigator.share({ title: t("onlineTitle"), url }).catch(() => undefined);
    return;
  }
  void navigator.clipboard?.writeText(url).then(() => showToast(t("onlineCopied")));
});
app.querySelector("#online-leave")!.addEventListener("click", () => {
  leaveRoom();
  renderOnlineDialog();
  closeOnlineDialog();
  renderAll();
});
app.querySelector("#online-close")!.addEventListener("click", closeOnlineDialog);

/** Back in the game this phone was in, or the one a shared link points to */
function resumeOnline(): void {
  const params = new URLSearchParams(location.search);
  const linkCode = params.get("room")?.trim().toUpperCase() ?? "";
  const linkSeat = Number(params.get("seat"));
  if (linkCode) history.replaceState(null, "", location.pathname);
  let target: { code: string; seat: Player } | null = null;
  if (linkCode && (linkSeat === 1 || linkSeat === 2)) target = { code: linkCode, seat: linkSeat };
  else if (linkCode) {
    openOnlineDialog(linkCode);
    return;
  } else {
    try {
      const saved = JSON.parse(stored(ONLINE_STORAGE_KEY) ?? "null") as { code?: string; seat?: number } | null;
      if (saved?.code && (saved.seat === 1 || saved.seat === 2)) target = { code: saved.code, seat: saved.seat };
    } catch {
      /* nothing saved */
    }
  }
  if (!target) return;
  pickedSeat = target.seat;
  const { code, seat } = target;
  connectRoom(seat, code).catch((error: unknown) => {
    openOnlineDialog(code);
    showOnlineError(roomErrorText(error));
  });
}

/** Everything on screen, from the state */
function renderAll(): void {
  applyTimesToDisplay();
  setActivePanels();
  updateButtons();
  renderTurnDots();
  renderMiniCounters();
  renderAbilities(1);
  renderAbilities(2);
  renderSeat();
}

btnStart.addEventListener("click", () => {
  if (inGame(game)) return;
  if (secondaryCardsOn()) chooseDispositions();
  else start();
});

setTimePreset(String(DEFAULT_TIME_SEC));
loadLang();
loadTheme();
loadFactions();
loadLayout();
loadUiSize();
loadSound();
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
  const label = inFs ? t("exitFullscreen") : t("enterFullscreen");
  btnFullscreen.title = label;
  btnFullscreen.setAttribute("aria-label", label);
}

document.addEventListener("fullscreenchange", syncFullscreenLabel);
syncFullscreenLabel();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshClock();
    if (isRunning()) void tryAcquireWakeLock();
  }
});

window.addEventListener("pageshow", (e) => {
  if (e.persisted) refreshClock();
});

// Paused or over still counts as a game: its board stays until a reset
setupPwa(() => inGame(game));
resumeOnline();
