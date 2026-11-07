import "./style.css";
import { getLang, setLang, setPlayerNames, t, type Lang, type StringKey } from "./i18n";
import type { MissionAction } from "./actions";
import { SECONDARY_BY_ID, type SecondaryCard, type Text } from "./secondaries";
import { FACTION_BY_ID, FACTIONS, SPACE_MARINES, SPACE_MARINES_NAME, sideLooks, type Faction, type FactionGroup } from "./factions";
import { applyUpdateIfIdle, setupPwa } from "./pwa";
import type { Room, RoomEvents, Seat, Seats } from "./room";
import { merge } from "./sync";
import { startAnalytics, track } from "./analytics";
import {
  ALL_LOCKED,
  EVENT_MAX_MINUTES,
  EVENT_MIN_MINUTES,
  EVENT_NAME_MAX,
  EVENT_PARAM,
  decodeEvent,
  eventLink,
  type EventPreset,
} from "./event";
import {
  BATTLE_READY_VP,
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
  newGameId,
  newSecondaryPile,
  nowMs,
  other,
  playerTurnSlot,
  randomIndex,
  runClock,
  scoreOf as scoreOfGame,
  scoringTurnIdx as scoringTurnIdxOf,
  secondsLeft,
  setActiveClock,
  stopClock,
  type Ability,
  type AbilityKind,
  type ClockEvent,
  type ClockEventKind,
  type EventLocks,
  type GameState,
  type Mvp,
  type Player,
  type ScoreKind,
} from "./game";
import {
  dataUrlToBlob,
  deletePhoto,
  gamePhotos,
  getPhoto,
  keepOnlyGame,
  photoKey,
  savePhoto,
  shareable,
  type Photo,
  type PhotoTurn,
} from "./photos";
import {
  CLASH_BOOM_SEC,
  CP_BURST_SEC,
  READY_COUNT_SEC,
  READY_LAND_SEC,
  TIME_OUT_HIT_SEC,
  isMusicMuted,
  isMuted,
  playSound,
  previewMusic,
  setBattleMusic,
  setMusic,
  setMusicMuted,
  setMuted,
  setMusicElsewhere,
  setSoundsOn,
  setVolume,
  stopMusicPreview,
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

/** The organiser's yes/no settings, in the tournament dialog: the field of the preset each one sets */
const EVENT_TOGGLES = [
  { id: "event-photo-breaks", field: "photoBreaks" },
  { id: "event-deploy-clock", field: "deployClock" },
  { id: "event-judge-pause", field: "judgeOnlyPause" },
  { id: "event-music-off", field: "musicOff" },
  { id: "event-sounds-on", field: "soundsOn" },
] as const satisfies readonly { id: string; field: keyof EventPreset }[];

/** Where the secondaries come from: none, drawn by the app, or each player's own deck of cards */
const CARDS_SOURCES = ["off", "app", "deck"] as const;
type CardsSource = (typeof CARDS_SOURCES)[number];
const CARDS_SOURCE_KEYS: Record<CardsSource, StringKey> = { off: "cardsOff", app: "cardsApp", deck: "cardsDeck" };

/** One choice for the cards, in the setup bar and in the tournament dialog */
const cardsSourceHtml = (id: string): string => `
  <div class="segmented segmented--cards" id="${id}" role="group" data-i18n-aria="secondaryCards">
    ${CARDS_SOURCES.map((value) => `<button type="button" class="segmented__option" data-value="${value}" data-i18n="${CARDS_SOURCE_KEYS[value]}" data-i18n-title="${CARDS_SOURCE_KEYS[value]}Hint"></button>`).join("")}
  </div>`;

const eventToggleHtml = (id: string, key: StringKey): string => `
  <label class="toggle-chip">
    <input type="checkbox" id="${id}" />
    <span data-i18n="${key}"></span>
    <span class="toggle-chip__switch" aria-hidden="true"></span>
  </label>`;

/** Imposed by the organiser, or left to the players: one switch per setting */
const eventLockHtml = (field: keyof EventLocks): string => `
  <button type="button" class="event-lock" data-lock="${field}" aria-pressed="true">
    <span class="event-lock__on" data-i18n="eventLocked"></span><span class="event-lock__off" data-i18n="eventFree"></span>
  </button>`;

/** Something comes and goes in the layout: it slides or glides open and shut in this time (slideRow, glideHeight) */
const SLIDE_MS = 260;
const SLIDE = "slide";
const GLIDE = "glide";
const SLIDE_PROPS = ["height", "minHeight", "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth", "marginTop", "opacity"] as const;
/** The state each sliding row was last put in: the first time, it is set without motion */
const slidShown = new WeakMap<HTMLElement, boolean>();

/** Open the hand (S) and the primary (P) of the player whose clock runs; physical keys, the same on AZERTY */
const HAND_KEY = "S";
const HAND_KEY_CODE = "KeyS";
const PRIMARY_KEY = "P";
const PRIMARY_KEY_CODE = "KeyP";
const JUDGE_KEY = "J";
const JUDGE_KEY_CODE = "KeyJ";
/** A judge adds or takes back time a minute at a time */
const JUDGE_STEP_SEC = 60;
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
const UI_SIZE_DEFAULT = "auto";

const LAYOUT_STORAGE_KEY = "warhammerClock.layout";
const LAYOUT_DEFAULT = "auto";

const LANG_STORAGE_KEY = "warhammerClock.lang";


/** Saved by older versions even when nobody picked it: read once, for an "on" */
const SOUNDS_STORAGE_KEY = "warhammerClock.sounds";
const SFX_STORAGE_KEY = "warhammerClock.sfx";
const MUSIC_STORAGE_KEY = "warhammerClock.music";
const VOLUME_STORAGE_KEY = "warhammerClock.volume";
const MUSIC_TRACKS: MusicTrack[] = ["off", "calm", "tense", "epic"];
const VOLUME_DEFAULT = 80;
/** Mutes every sound and the music at once, during the game too */
const MUTE_KEY = "M";
const MUTE_KEY_CODE = "KeyM";
/** Time left that rings a warning when a clock goes under it */
const TIME_WARNINGS_SEC = [600, 300, 60];

/** Picking Space Marines starts on this chapter */
const DEFAULT_CHAPTER = "ultramarines";
const FACTION_GROUPS: { group: FactionGroup; label: StringKey }[] = [
  { group: "imperium", label: "factionImperium" },
  { group: "chaos", label: "factionChaos" },
  { group: "xenos", label: "factionXenos" },
];
/** The armies last picked on a screen for both players, for its next game */
const factionStorageKey = (player: Player): string => `warhammerClock.army.p${player}`;
/** The army last picked on a player's own phone (or PC), brought into their next game */
const MY_ARMY_STORAGE_KEY = "warhammerClock.army.mine";

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

const ICON_TARGET = svgIcon('<circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />');
const ICON_CARDS = svgIcon('<rect x="4" y="6" width="11" height="15" rx="2" /><path d="M9 3h9a2 2 0 0 1 2 2v13" />');
const ICON_CLOCK = svgIcon('<circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M10 2h4" />');
const ICON_CAMERA = svgIcon('<path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />');
const ICON_SOUND = svgIcon('<path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />');
const ICON_MUTED = svgIcon('<path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9.5l5 5M22 9.5l-5 5" />');
const ICON_MUSIC = svgIcon('<path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />');
const ICON_MUSIC_OFF = svgIcon('<path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /><path d="M3 3l18 18" />');
const ICON_SLIDERS = svgIcon(
  '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />',
);
const ICON_CHECK = svgIcon('<path d="M5 12.5l4.5 4.5L19 7.5" />');
const ICON_EDIT = svgIcon('<path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />');
const ICON_CHEVRON = svgIcon('<path d="M7 10l5 5 5-5" />');
const ICON_ONLINE = svgIcon('<rect x="2.5" y="5" width="7" height="14" rx="1.5" /><rect x="14.5" y="5" width="7" height="14" rx="1.5" /><path d="M9.5 12h5" />');
const ICON_RESET = svgIcon('<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />');
/** A referee's whistle: the judge call, set apart from the players' own pause */
const ICON_WHISTLE = svgIcon('<circle cx="8.5" cy="14.5" r="5.5" /><path d="M8.5 9H21v4h-7.2" /><circle cx="8.5" cy="14.5" r="1.4" />');
const ICON_IMAGE = svgIcon('<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" />');
const ICON_MEDAL = svgIcon(
  '<path d="M8.5 9.5L6 3h4l2 4.5L14 3h4l-2.5 6.5" /><circle cx="12" cy="14.5" r="6" /><path d="M12 11.6l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2-1.45-1.4 2-.3z" fill="currentColor" stroke="none" />',
);
const ICON_FOLDER = svgIcon('<path d="M3 6h6l2 2h10v11H3z" />');
const ICON_FOLDER_DOWN = svgIcon('<path d="M3 6h6l2 2h10v11H3z" /><path d="M12 11v5M9.5 13.5L12 16l2.5-2.5" />');
const ICON_DOWNLOAD = svgIcon('<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />');
const ICON_ZOOM = svgIcon('<circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3M11 8.3v5.4M8.3 11h5.4" />');
const ICON_CLOSE = svgIcon('<path d="M6 6l12 12M18 6L6 18" />');
const ICON_PREV = svgIcon('<path d="M15 5l-7 7 7 7" />');
const ICON_NEXT = svgIcon('<path d="M9 5l7 7-7 7" />');
const ICON_PHONE = svgIcon('<rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" />');
const ICON_SCREEN = svgIcon('<rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" />');
const ICON_SWAP = svgIcon('<path d="M8 20V4M4.5 7.5L8 4l3.5 3.5M16 4v16M12.5 16.5L16 20l3.5-3.5" />');
const ICON_LOG = svgIcon('<path d="M9 6h11M9 12h11M9 18h11" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />');
const ICON_ROWS = svgIcon('<rect x="2" y="2" width="24" height="7" rx="1" /><rect x="2" y="11" width="24" height="7" rx="1" />', "0 0 28 20");
const ICON_COLUMNS = svgIcon('<rect x="2" y="2" width="11" height="16" rx="1" /><rect x="15" y="2" width="11" height="16" rx="1" />', "0 0 28 20");

/*
 * Texts live in i18n.ts. Elements carry their key (data-i18n, data-i18n-aria, data-i18n-title,
 * data-i18n-placeholder) and their placeholders (data-v-*): applyTranslations() fills them.
 */
function scoreCounterHtml(player: Player, corner: "tl" | "bl"): string {
  const tiles = SCORE_KINDS.map(
    ({ kind, label, ariaMinus, ariaPlus }) => `
          <div class="score-box__tile" data-kind="${kind}">
            <span class="score-box__kind" data-i18n="${label}"></span>
            <div class="score-box__tile-value">
              <button type="button" class="mini-counter__btn" id="p${player}-${kind}-minus" data-i18n-aria="${ariaMinus}" data-v-n="${player}">−</button>
              <span class="mini-counter__val" id="p${player}-${kind}-val">0</span>
              <button type="button" class="mini-counter__btn" id="p${player}-${kind}-plus" data-i18n-aria="${ariaPlus}" data-v-n="${player}">+</button>
            </div>
          </div>`,
  ).join("");
  const rows = `
        <div class="score-box__tiles">${tiles}
        </div>`;
  return `
      <div class="mini-counter mini-counter--${corner} score-box">
        <div class="score-box__head">
          <span class="mini-counter__label" data-i18n="score"></span>
          <span class="score-box__total" id="p${player}-score-total">0</span>
        </div>
        <span class="score-box__turn" id="p${player}-score-turn"></span>${rows}
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
      </div>`;
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
        <span class="panel-me" data-i18n="you"></span>
        <span class="panel-turn" data-i18n="playerTurn"></span>
        <span class="panel-turn panel-deploy" data-i18n="deploying"></span>
      </div>
      <div class="panel-army" id="panel-army-${player}"></div>
      <span class="time" id="t${player}">1:00:00</span>
      <span class="panel-flag" data-i18n="timeOutLimits"></span>
    </section>`;
}

app.innerHTML = `
  <header class="toolbar">
    <p class="toolbar-deploy" data-i18n="deployToolbarHint"></p>
    <div class="toolbar__group">
      <div class="event-badge" id="event-badge" hidden>
        <span class="event-badge__name" id="event-badge-name"></span>
        <button type="button" class="event-badge__leave" id="event-leave" data-i18n-aria="eventLeave" data-i18n-title="eventLeave">×</button>
      </div>
      <div class="setting">
        <span class="setting__label">${ICON_CLOCK}<span data-i18n="time"></span></span>
        <div class="time-picker" id="time-picker">
          <button type="button" class="picker" id="btn-time" aria-haspopup="true" data-i18n-aria="timeAria">
            <span class="picker__value" id="time-value"></span>
            ${ICON_CHEVRON}
          </button>
          <div class="time-scrim" id="time-scrim" aria-hidden="true"></div>
          <div class="time-panel">
            <p class="time-panel__title" data-i18n="timeAria"></p>
            <div class="segmented" id="time-presets" role="group" data-i18n-aria="timeAria">
              ${PRESETS.map((p) => `<button type="button" class="segmented__option" data-value="${p.sec}">${p.label}</button>`).join("")}
              <button type="button" class="segmented__option" data-value="${CUSTOM_PRESET_VALUE}" data-i18n="custom"></button>
            </div>
            <div id="manual-time-wrap" class="toolbar-manual" hidden>
              <div class="time-step">
                <button type="button" class="time-step__btn" data-step="-5" aria-label="−5 min">−</button>
                <input id="time-minutes" type="number" inputmode="numeric" min="0" max="999" step="1" value="${DEFAULT_TIME_SEC / 60}" data-i18n-aria="timeAria" />
                <span class="time-step__unit">min</span>
                <button type="button" class="time-step__btn" data-step="5" aria-label="+5 min">+</button>
              </div>
            </div>
            <label class="toggle-chip time-deploy">
              <input type="checkbox" id="deploy-clock" checked />
              <span data-i18n="deployClock"></span>
              <span class="toggle-chip__switch" aria-hidden="true"></span>
            </label>
            <button type="button" class="btn-primary time-panel__done" id="time-done" data-i18n="ok"></button>
          </div>
        </div>
      </div>
      <label class="toggle-chip">
        <input type="checkbox" id="photo-breaks" />
        ${ICON_CAMERA}
        <span data-i18n="photoBreaks"></span>
        <span class="toggle-chip__switch" aria-hidden="true"></span>
      </label>
      <div class="setting setting--cards">
        <span class="setting__label">${ICON_CARDS}<span data-i18n="secondaryCards"></span></span>
        ${cardsSourceHtml("cards-source")}
      </div>
    </div>
    <div class="toolbar__group toolbar__group--end">
      <button type="button" class="btn-online" id="btn-online">${ICON_ONLINE}<span id="online-label"></span></button>
      <div class="popover-anchor">
        <button type="button" class="btn-icon" id="btn-settings" aria-expanded="false" aria-controls="settings-panel" data-i18n-aria="display" data-i18n-title="display">${ICON_SLIDERS}</button>
        <div class="popover popover--end settings__panel" id="settings-panel" hidden>
          <div class="settings__section">
            <span class="settings__label"><span data-i18n="sound"></span> <kbd data-i18n-title="muteHint">${MUTE_KEY}</kbd></span>
            <div class="settings-row">
              <span class="settings-row__label" data-i18n="music"></span>
              <div class="segmented" id="music-options" role="group" data-i18n-aria="music">
                <button type="button" class="segmented__option" data-value="off" data-i18n="musicOff"></button>
                <button type="button" class="segmented__option" data-value="calm" data-i18n="musicCalm"></button>
                <button type="button" class="segmented__option" data-value="tense" data-i18n="musicTense"></button>
                <button type="button" class="segmented__option" data-value="epic" data-i18n="musicEpic"></button>
              </div>
            </div>
            <p class="settings-note" id="music-elsewhere" hidden>${ICON_SCREEN}<span data-i18n="musicElsewhere"></span></p>
            <label class="settings-row toggle-chip settings-switch">
              <span class="settings-row__label" data-i18n="soundEffects"></span>
              <input type="checkbox" id="sfx-toggle" />
              <span class="toggle-chip__switch" aria-hidden="true"></span>
            </label>
            <div class="settings-row">
              <span class="settings-row__label" data-i18n="volume"></span>
              <input type="range" class="volume" id="volume" min="0" max="100" step="5" data-i18n-aria="volume" />
            </div>
          </div>
          <div class="settings__section settings__section--armies">
            <span class="settings__label" data-i18n="armies"></span>
            <div class="faction-menu" id="factions-section">
              <button type="button" class="faction-swap" id="faction-swap" data-i18n-title="factionSwap">${ICON_SWAP}<span data-i18n="factionSwapShort"></span></button>
              ${([1, 2] as const)
                .map(
                  (player) => `
              <div class="faction-row" id="faction-row-${player}">
                <label class="faction-row__player is-p${player}" for="p${player}-faction" id="faction-side-${player}"></label>
                ${pickerHtml(`p${player}-faction`)}
                <span class="faction-row__chapter" id="p${player}-chapter-wrap" hidden>${pickerHtml(`p${player}-chapter`)}</span>
              </div>`,
                )
                .join("")}
            </div>
          </div>
          <div class="settings__section settings__section--board">
            <span class="settings__label" data-i18n="screen"></span>
            <div class="settings-row settings-row--layout">
              <span class="settings-row__label" data-i18n="layout"></span>
              <div class="segmented" id="layout-options" role="group" data-i18n-aria="layoutAria">
                <button type="button" class="segmented__option" data-value="auto" data-i18n="sizeAuto"></button>
                <button type="button" class="segmented__option" data-value="rows" data-i18n-title="layoutRows" data-i18n-aria="layoutRows">${ICON_ROWS}</button>
                <button type="button" class="segmented__option" data-value="columns" data-i18n-title="layoutColumns" data-i18n-aria="layoutColumns">${ICON_COLUMNS}</button>
              </div>
            </div>
            <div class="settings-row">
              <span class="settings-row__label" data-i18n="uiSizeShort"></span>
              <div class="segmented" id="ui-size-options" role="group" data-i18n-aria="uiSizeAria">
                <button type="button" class="segmented__option" data-value="auto" data-i18n="sizeAuto"></button>
                <button type="button" class="segmented__option" data-value="s" data-i18n="sizeS"></button>
                <button type="button" class="segmented__option" data-value="m" data-i18n="sizeM"></button>
                <button type="button" class="segmented__option" data-value="l" data-i18n="sizeL"></button>
              </div>
            </div>
          </div>
          <div class="settings__section settings__section--seat-game">
            <button type="button" class="btn-ghost strip-reset" id="seat-reset">${ICON_RESET}<span data-i18n="reset"></span></button>
          </div>
          <div class="settings__section">
            <div class="settings-row">
              <span class="settings__label" data-i18n="language"></span>
              <div class="segmented settings-lang" id="lang-options" role="group" data-i18n-aria="language">
                <button type="button" class="segmented__option" data-value="en" title="English">EN</button>
                <button type="button" class="segmented__option" data-value="fr" title="Français">FR</button>
              </div>
            </div>
          </div>
          <div class="settings__section settings__section--event">
            <button type="button" class="btn-secondary settings-event" id="btn-event-setup" data-i18n="eventSetup"></button>
          </div>
          <div class="settings__section settings__about">
            <span class="settings__brand">Chronicum</span>
            <p class="brand-unofficial" data-i18n="unofficial"></p>
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
      <button type="button" class="btn-primary toolbar__start" id="btn-start"><span class="toolbar__start-label" data-i18n="start"></span><span class="toolbar__deploy-label" data-i18n="deployDone"></span> <kbd data-i18n="keyEnter"></kbd></button>
    </div>
  </header>
  <div class="board">
    ${panelHtml(1)}
    <div class="turn-tracker">
      <div class="turn-tracker__controls">
        <button type="button" class="btn-ghost strip-reset" id="btn-reset" data-i18n-title="reset">${ICON_RESET}<span data-i18n="reset"></span></button>
        <span class="popover-anchor">
          <button type="button" class="btn-ghost strip-settings" id="strip-settings" aria-expanded="false" aria-controls="settings-panel" data-i18n-aria="display" data-i18n-title="display">${ICON_SLIDERS}</button>
        </span>
        <button type="button" class="btn-judge" id="btn-judge" data-i18n-aria="judgeCallAria" data-i18n-title="judgeCallAria" hidden>${ICON_WHISTLE}<span data-i18n="judgeCall"></span> <kbd>${JUDGE_KEY}</kbd></button>
        <button type="button" class="btn-ghost strip-settings strip-room" id="strip-room" hidden>${ICON_ONLINE}<span class="strip-room__dot" aria-hidden="true"></span></button>
      </div>
      <div class="turn-tracker__round" role="group" data-i18n-aria="battleRoundAria">
        <span class="turn-tracker__deploy" data-i18n="deployment"></span>
        <span class="turn-tracker__label" aria-hidden="true" data-i18n="round"></span>
        <div class="turn-tracker__dots" id="turn-dots"></div>
      </div>
      <p class="key-hint" id="key-hint" aria-live="polite"></p>
    </div>
    ${panelHtml(2)}
  </div>
  <section class="phone-home" id="phone-home">
    <div class="phone-home__brand">
      <img class="phone-home__logo" src="icon.svg" alt="" />
      <h1>Chronicum</h1>
      <p class="phone-home__motto" data-i18n="brandLine"></p>
      <p class="phone-home__tagline" data-i18n="homeTagline"></p>
    </div>
    <div class="phone-home__start" id="phone-home-start"></div>
    <p class="phone-home__note" data-i18n="homeScan"></p>
    <p class="phone-home__note" data-i18n="homeBoard"></p>
    <p class="brand-unofficial" data-i18n="unofficial"></p>
  </section>
  <section class="seat" id="seat" aria-live="polite">
    <header class="seat-bar">
      <button type="button" class="seat-room" id="seat-room"><span class="seat-room__dot" aria-hidden="true"></span><span id="seat-code"></span></button>
      <span class="seat-bar__round" id="seat-round"></span>
      <div class="seat-bar__tools">
        <button type="button" class="btn-icon" id="seat-music" aria-pressed="false" data-i18n-aria="musicMute" data-i18n-title="musicMute" hidden>${ICON_MUSIC}</button>
        <button type="button" class="btn-icon" id="seat-mute" aria-pressed="false" data-i18n-aria="sound" data-i18n-title="sound">${ICON_SOUND}</button>
        <div class="popover-anchor" id="seat-settings-anchor">
          <button type="button" class="btn-icon" id="seat-settings" aria-expanded="false" aria-controls="settings-panel" data-i18n-aria="display" data-i18n-title="display">${ICON_SLIDERS}</button>
        </div>
      </div>
    </header>
    <section class="seat-invite" id="seat-invite" hidden>
      <div class="seat-invite__qr" id="seat-invite-qr"></div>
      <div class="seat-invite__text">
        <p class="seat-invite__title" id="seat-invite-title"></p>
        <p class="seat-invite__code" id="seat-invite-code"></p>
        <p class="seat-invite__hint" id="seat-invite-hint"></p>
        <button type="button" class="btn-secondary" id="seat-invite-share" data-i18n="onlineShare"></button>
      </div>
    </section>
    <div class="seat-opp" id="seat-opp">
      <span class="seat-opp__name"><span id="seat-opp-name"></span><span class="seat-opp__away" id="seat-opp-away" data-i18n="seatOppAway" hidden></span></span>
      <span class="seat-opp__score"><span id="seat-opp-score">0</span> <small data-i18n="vpUnit"></small></span>
      <span class="seat-opp__time" id="seat-opp-time"></span>
      <button type="button" class="seat-opp__primary" id="seat-opp-primary" data-i18n-aria="oppPrimary" data-i18n-title="oppPrimary">${ICON_TARGET}</button>
    </div>
    <div class="seat-army" id="seat-army"></div>
    <button type="button" class="seat-clock" id="seat-clock">
      <span class="seat-clock__who" id="seat-who"></span>
      <span class="time seat-clock__time" id="seat-time"></span>
      <span class="seat-clock__hint" id="seat-hint"></span>
    </button>
    <div class="seat-stats">
      <div class="seat-card seat-score">
        <div class="seat-card__head">
          <span data-i18n="score"></span>
          <span class="seat-score__total"><b id="seat-score">0</b> <small data-i18n="vpUnit"></small></span>
        </div>
        <span class="seat-card__sub" id="seat-turn"></span>
        <div class="seat-tiles">
          ${SCORE_KINDS.map(
            ({ kind, label }) => `
          <div class="seat-tile">
            <span class="seat-tile__label" data-i18n="${label}"></span>
            <div class="seat-tile__value">
              <button type="button" class="mini-counter__btn" id="seat-${kind}-minus" aria-label="−">−</button>
              <b id="seat-${kind}">0</b>
              <button type="button" class="mini-counter__btn" id="seat-${kind}-plus" aria-label="+">+</button>
            </div>
          </div>`,
          ).join("")}
          <div class="seat-tile seat-tile--wide" id="seat-bonus-row" hidden>
            <span class="seat-tile__label" data-i18n="endBonus"></span>
            <div class="seat-tile__value">
              <button type="button" class="mini-counter__btn" id="seat-bonus-minus" aria-label="−">−</button>
              <b id="seat-bonus">0</b>
              <button type="button" class="mini-counter__btn" id="seat-bonus-plus" aria-label="+">+</button>
            </div>
          </div>
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
    <nav class="seat-actions">
      <button type="button" class="score-box__deck seat-deck" id="seat-mission">
        <span class="score-box__primary-card" aria-hidden="true">${ICON_TARGET}</span>
        <span class="score-box__deck-label" data-i18n="primaryCard"></span>
      </button>
      <button type="button" class="score-box__deck seat-deck" id="seat-hand">
        <span class="score-box__hand-stack" aria-hidden="true"><span class="score-box__hand-count" id="seat-hand-count">0</span></span>
        <span class="score-box__deck-label" data-i18n="secondaryHand"></span>
      </button>
      <button type="button" class="btn-secondary" id="seat-pause"></button>
      <button type="button" class="btn-secondary btn-judge" id="seat-judge" data-i18n-aria="judgeCallAria">${ICON_WHISTLE}<span data-i18n="judgeCall"></span></button>
      <button type="button" class="btn-primary" id="seat-end" data-i18n="seatEndTurn"></button>
      <button type="button" class="btn-primary" id="seat-deploy-done" data-i18n="deployDone" hidden></button>
    </nav>
    <div class="seat-setup" id="seat-setup"></div>
  </section>
  <div class="cp-burn" id="cp-burn" aria-hidden="true">
    <div class="cp-burn__veil"></div>
    <div class="cp-burn__flash"></div>
    <div class="cp-burn__ring"></div>
    <div class="cp-burn__token"><b class="cp-burn__n"></b><span>CP</span></div>
    <div class="cp-burn__sparks"></div>
  </div>
  <div class="overlay overlay--time-out" id="time-out-overlay" role="alertdialog" aria-modal="true" aria-labelledby="time-out-title" aria-hidden="true">
    <div class="time-out__flash"></div>
    <div class="overlay-inner">
      <span class="time-out__who" id="time-out-who"></span>
      <b class="time-out__clock">0:00:00</b>
      <h2 id="time-out-title" data-i18n="timeOutTitle"></h2>
      <p class="overlay-msg" id="time-out-msg"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-time-out"><span></span> <kbd data-i18n="keySpace"></kbd></button>
      </div>
    </div>
  </div>
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
  <div class="overlay overlay--end-game" id="end-game-overlay" role="dialog" aria-modal="true" aria-labelledby="end-game-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="end-game-title" data-i18n="endGameTitle"></h2>
      <p class="overlay-msg" data-i18n="endGameMsg"></p>
      <div class="end-game-options">
        <button type="button" class="end-game-option" id="end-game-concede-1"><b></b><span></span></button>
        <button type="button" class="end-game-option" id="end-game-concede-2"><b></b><span></span></button>
        <button type="button" class="end-game-option" id="end-game-untimed"><b data-i18n="untimed"></b><span data-i18n="untimedHint"></span></button>
        <button type="button" class="end-game-option is-danger" id="end-game-erase"><b data-i18n="eraseGame"></b><span data-i18n="resetMsg"></span></button>
      </div>
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="btn-end-game-cancel"><span data-i18n="cancel"></span> <kbd data-i18n="keyEsc"></kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--result" id="result-overlay" role="dialog" aria-modal="true" aria-labelledby="result-title" aria-hidden="true">
    <div class="overlay-inner">
      <article class="report" id="battle-report"></article>
      <div class="overlay-actions">
        <button type="button" class="btn-ghost btn-log result-log" id="btn-result-log" data-i18n-aria="clockLog">${ICON_LOG}<span data-i18n="clockLog"></span></button>
        <button type="button" class="btn-secondary btn-log" id="btn-result-export">${ICON_IMAGE}<span class="label-long" data-i18n="reportExport"></span><span class="label-short" data-i18n="reportShort"></span></button>
        <button type="button" class="btn-secondary btn-log" id="btn-result-photos">${ICON_DOWNLOAD}<span class="label-long" data-i18n="photosSave"></span><span class="label-short" data-i18n="photosShort"></span><span class="result-count" id="result-photo-count"></span></button>
        <button type="button" class="btn-primary result-ok" id="btn-result-dismiss"><span data-i18n="ok"></span> <kbd data-i18n="keyEnter"></kbd></button>
      </div>
      <input type="file" id="final-photo-input" accept="image/*" capture="environment" hidden />
    </div>
  </div>
  <div class="overlay overlay--end overlay--mvp" id="mvp-overlay" role="dialog" aria-modal="true" aria-labelledby="mvp-title" aria-hidden="true">
    <div class="overlay-inner end-sheet">
      <h2 id="mvp-title" data-i18n="mvpElect"></h2>
      <p class="overlay-msg" data-i18n="mvpMsg"></p>
      <div class="mvp-form" id="mvp-form"></div>
      <input type="file" id="mvp-photo-input" accept="image/*" capture="environment" hidden />
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="btn-mvp-cancel"><span data-i18n="cancel"></span> <kbd data-i18n="keyEsc"></kbd></button>
        <button type="button" class="btn-primary" id="btn-mvp-crown">${ICON_MEDAL}<span data-i18n="mvpCrown"></span></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--end overlay--save" id="save-overlay" role="dialog" aria-modal="true" aria-labelledby="save-title" aria-hidden="true">
    <div class="overlay-inner end-sheet" id="save-sheet"></div>
  </div>
  <div class="overlay overlay--viewer" id="viewer-overlay" role="dialog" aria-modal="true" aria-label="" aria-hidden="true">
    <div class="viewer" id="viewer">
      <div class="viewer__top">
        <span class="viewer__count" id="viewer-count"></span>
        <button type="button" class="viewer__button" id="btn-viewer-zoom">${ICON_ZOOM}</button>
        <button type="button" class="viewer__button" id="btn-viewer-close" data-i18n-aria="close">${ICON_CLOSE}</button>
      </div>
      <div class="viewer__stage" id="viewer-stage">
        <img class="viewer__img" id="viewer-img" alt="" draggable="false" />
        <button type="button" class="viewer__nav is-prev" id="btn-viewer-prev" data-i18n-aria="photoPrev">${ICON_PREV}</button>
        <button type="button" class="viewer__nav is-next" id="btn-viewer-next" data-i18n-aria="photoNext">${ICON_NEXT}</button>
      </div>
      <div class="viewer__caption">
        <p class="viewer__turn" id="viewer-turn"></p>
        <p class="viewer__line" id="viewer-line"></p>
        <p class="viewer__hint" id="viewer-hint"></p>
      </div>
    </div>
  </div>
  <div class="overlay overlay--judge" id="judge-overlay" role="dialog" aria-modal="true" aria-labelledby="judge-title" aria-hidden="true">
    <div class="overlay-inner">
      <span class="judge-badge">${ICON_WHISTLE}<span data-i18n="clocksFrozen"></span></span>
      <h2 id="judge-title" data-i18n="judgeTitle"></h2>
      <p class="judge-since" id="judge-since"></p>
      <p class="overlay-msg" id="judge-msg"></p>
      <div class="judge-clocks">
        ${([1, 2] as const)
          .map(
            (player) => `
        <div class="judge-clock is-p${player}">
          <span class="judge-clock__name" data-i18n="player" data-v-n="${player}"></span>
          <span class="judge-clock__time" id="judge-time-${player}"></span>
          <span class="judge-clock__delta" id="judge-delta-${player}"></span>
          <div class="judge-clock__adjust">
            <button type="button" class="btn-secondary" data-judge-player="${player}" data-judge-seconds="${-JUDGE_STEP_SEC}">−1 min</button>
            <button type="button" class="btn-secondary" data-judge-player="${player}" data-judge-seconds="${JUDGE_STEP_SEC}">+1 min</button>
          </div>
        </div>`,
          )
          .join("")}
      </div>
      <div class="overlay-actions">
        <button type="button" class="btn-ghost btn-log" id="btn-judge-log">${ICON_LOG}<span data-i18n="clockLog"></span></button>
        <button type="button" class="btn-primary" id="btn-judge-resume" data-i18n="judgeResume"></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--log" id="log-overlay" role="dialog" aria-modal="true" aria-labelledby="log-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="log-title" data-i18n="clockLog"></h2>
      <p class="overlay-msg" data-i18n="clockLogIntro"></p>
      <div class="clock-log" id="clock-log"></div>
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="btn-log-copy" data-i18n="copy"></button>
        <button type="button" class="btn-primary" id="btn-log-close"><span data-i18n="close"></span> <kbd data-i18n="keyEsc"></kbd></button>
      </div>
    </div>
  </div>
  <div class="popover-anchor game-settings-anchor" id="game-settings-anchor"></div>
  <div class="overlay overlay--toss" id="toss-overlay" role="dialog" aria-modal="true" aria-labelledby="toss-title" aria-hidden="true">
    <div class="toss-flash" aria-hidden="true"></div>
    <div class="toss-stage" id="toss-stage">
      <div class="coin-stage" aria-hidden="true">
        <div class="coin-pop">
          <div class="coin" id="coin" data-face="1">
            <span class="coin__face is-p1">1</span>
            <span class="coin__face coin__face--back is-p2">2</span>
          </div>
        </div>
      </div>
      <div class="toss-card">
        <p class="toss-step" id="toss-step"></p>
        <h2 id="toss-title"></h2>
        <p class="toss-msg" id="toss-msg" aria-live="polite"></p>
        <div class="toss-choices" id="toss-choices">
          <button type="button" class="toss-choice is-p1" data-deploy-first="1" data-i18n="deployFirstBtn" data-v-n="1"></button>
          <button type="button" class="toss-choice is-p2" data-deploy-first="2" data-i18n="deployFirstBtn" data-v-n="2"></button>
        </div>
        <p class="toss-note" id="toss-note"></p>
        <div class="toss-actions">
          <button type="button" class="btn-secondary" id="btn-toss-cancel"><span id="toss-cancel-label"></span> <kbd data-i18n="keyEsc"></kbd></button>
          <button type="button" class="btn-primary" id="btn-toss-start"><span id="toss-start-label"></span> <kbd data-i18n="keyEnter"></kbd></button>
        </div>
        <button type="button" class="toss-fix" id="btn-toss-fix" data-i18n="tossFix"></button>
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
      <img class="photo-shot" id="photo-shot" alt="" />
      <span class="pause-badge" data-i18n="clocksPaused"></span>
      <h2 id="photo-title"><span class="photo-for-turn" data-i18n="photoTitle"></span><span class="photo-for-deploy" data-i18n="photoDeployTitle"></span></h2>
      <p class="overlay-msg" id="photo-msg"></p>
      <div class="photo-camera">
        <input type="file" id="photo-input" accept="image/*" capture="environment" hidden />
        <button type="button" class="btn-primary photo-take" id="btn-photo-take">${ICON_CAMERA}<span data-i18n="photoTake"></span></button>
        <button type="button" class="btn-primary photo-save" id="btn-photo-save"><span class="photo-for-turn" data-i18n="photoSaveResume"></span><span class="photo-for-deploy" data-i18n="photoSaveStart"></span></button>
        <button type="button" class="btn-secondary photo-retake" id="btn-photo-retake">${ICON_CAMERA}<span data-i18n="photoRetake"></span></button>
        <button type="button" class="photo-skip" id="btn-photo-skip"><span class="photo-skip__first" data-i18n="photoSkip"></span><span class="photo-skip__again"><span class="photo-for-turn" data-i18n="photoSkipUnsaved"></span><span class="photo-for-deploy" data-i18n="photoSkipStart"></span></span></button>
      </div>
      <div class="overlay-actions">
        <button type="button" class="btn-primary" id="btn-photo-resume"><span class="photo-for-turn" data-i18n="resumeClocks"></span><span class="photo-for-deploy" data-i18n="startBattle"></span> <kbd data-i18n="keyEnter"></kbd></button>
      </div>
    </div>
  </div>
  <div class="sound-toast" id="sound-toast" role="status"></div>
  <div class="overlay overlay--cards" id="cards-overlay" role="dialog" aria-modal="true" aria-labelledby="cards-title" aria-hidden="true">
    <div class="cards-stage">
      <h2 class="cards-title" id="cards-title"></h2>
      <p class="cards-sub" id="cards-sub"></p>
      <div class="cards-cap" id="cards-cap" hidden></div>
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
      <div class="overlay-actions">
        <p class="dispo-status" id="dispo-status" hidden></p>
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
        <p class="online-mode" data-i18n="onlineTableTitle"></p>
        <p class="overlay-msg" id="online-intro"></p>
        <button type="button" class="btn-primary online-create" id="online-create"></button>
        <div class="online-remote">
          <p class="online-mode" data-i18n="onlineRemoteTitle"></p>
          <p class="overlay-msg" data-i18n="onlineRemoteIntro"></p>
          <button type="button" class="btn-secondary online-create" id="online-remote-create" data-i18n="onlineRemoteCreate"></button>
        </div>
        <p class="online-or" data-i18n="onlineOr"></p>
        <div class="online-join">
          <input id="online-code" type="text" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" data-i18n-placeholder="onlineCode" />
          <button type="button" class="btn-secondary" id="online-join" data-i18n="onlineJoin"></button>
        </div>
      </div>
      <div class="online-room" id="online-room" hidden>
        <p class="overlay-msg" id="online-scan"></p>
        <div class="online-invite" id="online-invite">
          <p class="online-code" id="online-room-code"></p>
          <div class="online-qr" id="online-qr"></div>
          <button type="button" class="btn-secondary" id="online-share" data-i18n="onlineShare"></button>
        </div>
        <div class="online-qrs" id="online-qrs" hidden>
          ${([1, 2] as const)
            .map(
              (n) => `
          <figure class="online-qrs__seat is-p${n}" id="online-seat-${n}">
            <figcaption data-i18n="player" data-v-n="${n}"></figcaption>
            <div class="online-qrs__code">
              <div class="online-qr" id="online-qr-${n}"></div>
              <span class="online-qrs__check" aria-hidden="true"></span>
            </div>
            <p class="online-status" id="online-status-${n}"></p>
          </figure>`,
            )
            .join("")}
        </div>
        <p class="online-status" id="online-status"></p>
      </div>
      <p class="online-error" id="online-error" role="alert" hidden></p>
      <div class="overlay-actions">
        <button type="button" class="btn-ghost" id="online-leave" hidden></button>
        <button type="button" class="btn-secondary" id="online-close"><span id="online-close-label"></span> <kbd data-i18n="keyEsc"></kbd></button>
      </div>
    </div>
  </div>
  <div class="overlay overlay--event" id="event-overlay" role="dialog" aria-modal="true" aria-labelledby="event-title" aria-hidden="true">
    <div class="overlay-inner">
      <h2 id="event-title" data-i18n="eventSetupTitle"></h2>
      <p class="overlay-msg" data-i18n="eventSetupIntro"></p>
      <div class="event-setup">
        <form class="event-form" id="event-form">
          <label class="event-field">
            <span data-i18n="eventName"></span>
            <input id="event-name" type="text" maxlength="${EVENT_NAME_MAX}" autocomplete="off" data-i18n-placeholder="eventNamePlaceholder" />
          </label>
          <p class="event-form__head"><span data-i18n="eventRulesHead"></span><span data-i18n="eventLockHead"></span></p>
          <div class="event-row">
            <label class="event-row__label" for="event-minutes" data-i18n="eventMinutes"></label>
            <input id="event-minutes" type="number" min="${EVENT_MIN_MINUTES}" max="${EVENT_MAX_MINUTES}" step="5" value="${DEFAULT_TIME_SEC / 60}" />
            ${eventLockHtml("time")}
          </div>
          <div class="event-row">
            <span class="event-row__label" data-i18n="secondaryCards"></span>
            ${cardsSourceHtml("event-cards-source")}
            ${eventLockHtml("cards")}
          </div>
          <div class="event-row">
            ${eventToggleHtml("event-photo-breaks", "photoBreaks")}
            ${eventLockHtml("photoBreaks")}
          </div>
          <div class="event-row">
            ${eventToggleHtml("event-deploy-clock", "deployClock")}
            ${eventLockHtml("deployClock")}
          </div>
          <div class="event-row">
            ${eventToggleHtml("event-judge-pause", "eventJudgePause")}
          </div>
          <p class="event-form__head"><span data-i18n="eventDeviceHead"></span></p>
          <div class="event-row">${eventToggleHtml("event-music-off", "eventMusicOff")}</div>
          <div class="event-row">${eventToggleHtml("event-sounds-on", "eventSoundsOn")}</div>
          <p class="event-form__note" data-i18n="eventSuggested"></p>
        </form>
        <figure class="event-poster">
          <div class="event-poster__qr" id="event-qr"></div>
          <figcaption>
            <b id="event-poster-name"></b>
            <span id="event-poster-rules"></span>
          </figcaption>
        </figure>
      </div>
      <p class="event-link" id="event-link"></p>
      <div class="overlay-actions">
        <button type="button" class="btn-secondary" id="event-copy" data-i18n="eventCopy"></button>
        <button type="button" class="btn-secondary" id="event-download" data-i18n="eventDownload"></button>
        <button type="button" class="btn-primary" id="event-close"><span data-i18n="close"></span> <kbd data-i18n="keyEsc"></kbd></button>
      </div>
    </div>
  </div>
`;

const factionsSection = app.querySelector<HTMLElement>("#factions-section")!;
const factionRow: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#faction-row-1")!,
  2: app.querySelector<HTMLElement>("#faction-row-2")!,
};
const factionSide: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#faction-side-1")!,
  2: app.querySelector<HTMLElement>("#faction-side-2")!,
};
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
const sfxToggle = app.querySelector<HTMLInputElement>("#sfx-toggle")!;
const musicOptions = app.querySelector<HTMLElement>("#music-options")!;
const musicElsewhereNote = app.querySelector<HTMLElement>("#music-elsewhere")!;
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
/** The time each player gets: always the same for both */
const minutesInput = app.querySelector<HTMLInputElement>("#time-minutes")!;
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
const cardsSourcePicker = app.querySelector<HTMLElement>("#cards-source")!;
const eventCardsSourcePicker = app.querySelector<HTMLElement>("#event-cards-source")!;
const eventBadge = app.querySelector<HTMLElement>("#event-badge")!;
const eventLeaveBtn = app.querySelector<HTMLButtonElement>("#event-leave")!;
const eventOverlay = app.querySelector<HTMLElement>("#event-overlay")!;
const panelArmy: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#panel-army-1")!,
  2: app.querySelector<HTMLElement>("#panel-army-2")!,
};
const eventForm = app.querySelector<HTMLFormElement>("#event-form")!;
const eventNameInput = app.querySelector<HTMLInputElement>("#event-name")!;
const eventMinutesInput = app.querySelector<HTMLInputElement>("#event-minutes")!;
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
const cardsOverlay = app.querySelector<HTMLElement>("#cards-overlay")!;
const cardsTitle = app.querySelector<HTMLElement>("#cards-title")!;
const cardsSub = app.querySelector<HTMLElement>("#cards-sub")!;
const cardsRow = app.querySelector<HTMLElement>("#cards-row")!;
const cardsCap = app.querySelector<HTMLElement>("#cards-cap")!;
const cardsStage = app.querySelector<HTMLElement>("#cards-overlay .cards-stage")!;
const cardsActions = app.querySelector<HTMLElement>("#cards-overlay .cards-actions")!;
const btnCardsClose = app.querySelector<HTMLButtonElement>("#btn-cards-close")!;
const dispoOverlay = app.querySelector<HTMLElement>("#dispo-overlay")!;
const btnDispoOk = app.querySelector<HTMLButtonElement>("#btn-dispo-ok")!;
const btnDispoCancel = app.querySelector<HTMLButtonElement>("#btn-dispo-cancel")!;
const dispoIntro = app.querySelector<HTMLElement>("#dispo-intro")!;
const dispoStatus = app.querySelector<HTMLElement>("#dispo-status")!;
const scoreTotalEl: Record<Player, HTMLElement> = {
  1: app.querySelector<HTMLElement>("#p1-score-total")!,
  2: app.querySelector<HTMLElement>("#p2-score-total")!,
};
const photoBreaksToggle = app.querySelector<HTMLInputElement>("#photo-breaks")!;
const photoOverlay = app.querySelector<HTMLElement>("#photo-overlay")!;
const photoMsg = app.querySelector<HTMLElement>("#photo-msg")!;
const btnPhotoResume = app.querySelector<HTMLButtonElement>("#btn-photo-resume")!;
const photoInput = app.querySelector<HTMLInputElement>("#photo-input")!;
const photoShot = app.querySelector<HTMLImageElement>("#photo-shot")!;
const p1CpVal = app.querySelector<HTMLElement>("#p1-cp-val")!;
const p2CpVal = app.querySelector<HTMLElement>("#p2-cp-val")!;
const turnConfirmOverlay = app.querySelector<HTMLElement>("#turn-confirm-overlay")!;
const turnConfirmTitle = app.querySelector<HTMLElement>("#turn-confirm-title")!;
const turnConfirmMsg = app.querySelector<HTMLElement>("#turn-confirm-msg")!;
const btnTurnConfirmOk = app.querySelector<HTMLButtonElement>("#btn-turn-confirm-ok")!;
const btnTurnConfirmCancel = app.querySelector<HTMLButtonElement>("#btn-turn-confirm-cancel")!;
const endGameOverlay = app.querySelector<HTMLElement>("#end-game-overlay")!;
const btnEndGameCancel = app.querySelector<HTMLButtonElement>("#btn-end-game-cancel")!;
const resultOverlay = app.querySelector<HTMLElement>("#result-overlay")!;
const mvpOverlay = app.querySelector<HTMLElement>("#mvp-overlay")!;
const btnMvpCrown = app.querySelector<HTMLButtonElement>("#btn-mvp-crown")!;
const finalPhotoInput = app.querySelector<HTMLInputElement>("#final-photo-input")!;
const mvpPhotoInput = app.querySelector<HTMLInputElement>("#mvp-photo-input")!;
/** Phones and tablets: a camera at hand, and a gallery to save the photos in */
const CAN_SHOOT = window.matchMedia("(hover: none) and (pointer: coarse)");
/** The secondaries, card by card in the report: folded to one line on a phone, open on a computer */
const REPORT_DETAIL_STORAGE_KEY = "warhammerClock.reportDetail";
let reportDetailOpen: boolean | null = null;
/** This game's photos, by turn, each with its thumbnail ready to show */
let endPhotos = new Map<string, { photo: Photo; thumb: string }>();
let endPhotosLoad = 0;
/** The MVPs being elected: each player's own on a phone online, both on one screen */
let mvpDraft: Record<Player, Mvp> | null = null;
const viewerOverlay = app.querySelector<HTMLElement>("#viewer-overlay")!;
const viewerStage = app.querySelector<HTMLElement>("#viewer-stage")!;
const viewerImg = app.querySelector<HTMLImageElement>("#viewer-img")!;
let viewerTurn: PhotoTurn | null = null;
let viewerUrl = "";
const zoom = { s: 1, x: 0, y: 0 };
const saveOverlay = app.querySelector<HTMLElement>("#save-overlay")!;
const saveSheet = app.querySelector<HTMLElement>("#save-sheet")!;
let saveStep: "form" | "writing" | "done" = "form";
let saveWithReport = true;
let saveFolder = "";
/** The report picture, made as the dialog opens: a phone's share sheet must open right on the tap */
let saveReport: { state: "pending" | "ready" | "failed"; blob: Blob | null } = { state: "pending", blob: null };
let saveDone = { count: 0, path: "" };
const timeOutOverlay = app.querySelector<HTMLElement>("#time-out-overlay")!;
const btnTimeOut = app.querySelector<HTMLButtonElement>("#btn-time-out")!;
const btnResultDismiss = app.querySelector<HTMLButtonElement>("#btn-result-dismiss")!;
const judgeOverlay = app.querySelector<HTMLElement>("#judge-overlay")!;
const logOverlay = app.querySelector<HTMLElement>("#log-overlay")!;
const btnJudge = app.querySelector<HTMLButtonElement>("#btn-judge")!;
const tossOverlay = app.querySelector<HTMLElement>("#toss-overlay")!;
const deployClockToggle = app.querySelector<HTMLInputElement>("#deploy-clock")!;
const btnOnline = app.querySelector<HTMLButtonElement>("#btn-online")!;
const stripRoom = app.querySelector<HTMLButtonElement>("#strip-room")!;
const seatClock = app.querySelector<HTMLButtonElement>("#seat-clock")!;
const seatMusic = app.querySelector<HTMLButtonElement>("#seat-music")!;
const seatMute = app.querySelector<HTMLButtonElement>("#seat-mute")!;
const seatSettings = app.querySelector<HTMLButtonElement>("#seat-settings")!;
const seatSettingsAnchor = app.querySelector<HTMLElement>("#seat-settings-anchor")!;
const stripSettings = app.querySelector<HTMLButtonElement>("#strip-settings")!;
const gameSettingsAnchor = app.querySelector<HTMLElement>("#game-settings-anchor")!;
const seatSetup = app.querySelector<HTMLElement>("#seat-setup")!;
const seatArmy = app.querySelector<HTMLElement>("#seat-army")!;
const seatOpp = app.querySelector<HTMLElement>("#seat-opp")!;
const toolbar = app.querySelector<HTMLElement>(".toolbar")!;
const toolbarEnd = app.querySelector<HTMLElement>(".toolbar__group--end")!;
const setupGroup = app.querySelector<HTMLElement>(".toolbar__group:not(.toolbar__group--end)")!;
const phoneHomeStart = app.querySelector<HTMLElement>("#phone-home-start")!;
const onlineStart = app.querySelector<HTMLElement>("#online-start")!;
const onlineRoomSection = app.querySelector<HTMLElement>("#online-room")!;
/** A phone, upright or sideways: a tablet keeps the board */
const PHONE = window.matchMedia("(pointer: coarse) and (max-width: 640px), (pointer: coarse) and (max-height: 640px)");
const seatTime = app.querySelector<HTMLElement>("#seat-time")!;
const seatOppTime = app.querySelector<HTMLElement>("#seat-opp-time")!;
const seatAbilities = app.querySelector<HTMLElement>("#seat-abilities")!;
const onlineOverlay = app.querySelector<HTMLElement>("#online-overlay")!;
const onlineCodeInput = app.querySelector<HTMLInputElement>("#online-code")!;
const onlineError = app.querySelector<HTMLElement>("#online-error")!;

/** Everything both players share: see game.ts. The rest of this file is the screen */
let game: GameState = newGame();

// A player goes by their army once picked; by their number before, or when both picked the same
setPlayerNames((n) => {
  const player: Player = n === 2 ? 2 : 1;
  const name = factionName(player);
  return name && name !== factionName(other(player)) ? name : t("playerNumber", { n: player });
});

/** A device in an online game: the room once connected */
type RoomSession = {
  room: Room | null;
  connected: boolean;
  /** Which seats are taken: unknown until the room tells */
  seats: Seats | null;
};

/** A player's phone in the room and connected now: taken but gone (closed, wiped) does not count */
const seatHere = (seats: Seats | null, player: Player): boolean => !!seats?.[player] && !seats.away[player];

/**
 * Online, this device is one player's: its seat, and the room once connected. A phone shows that
 * player's own screen; a PC or a tablet the whole board, its own side to play and the other to read
 */
let online: (RoomSession & { seat: Player; phone: boolean }) | null = null;
/** Online, this PC or tablet is the shared screen: the board for both, each phone playing its own side */
let table: RoomSession | null = null;
const roomSession = (): RoomSession | null => online ?? table;
const phoneView = (): boolean => !!online?.phone;
/** Online, a player's device changes its own side only: the opponent's is there to read */
const canEdit = (player: Player): boolean => !online || online.seat === player;

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
/** Battle ready points on their way to the scores: not shown until they land */
const readyHeld: Record<Player, number> = { 1: 0, 2: 0 };
const shownScore = (player: Player): number => scoreOf(player) - readyHeld[player];

/** Whose abilities panel is open */
let abilitiesPlayer: Player | null = null;
/** Unit just struck or restored on the board, until the mouse leaves it */
let settlingAbilityId: number | null = null;
/** Unit whose strike / restore animation plays on the next render only */
let justToggledId: number | null = null;

/** "mid-round": the first player ends their turn, the other one takes theirs */
type TurnConfirmKind = "deploy-end" | "mid-round" | "next-round" | "finish-game" | "reset" | "unscore";

let turnConfirmKind: TurnConfirmKind | null = null;

function hideTurnConfirmModal(): void {
  turnConfirmKind = null;
  turnConfirmOverlay.classList.remove("is-visible");
  turnConfirmOverlay.setAttribute("aria-hidden", "true");
}

/* ---------- Ending a game before its last round ---------- */

/** Who won: the opponent of a player who gave up, else the higher score */
function gameWinner(): Player | null {
  if (game.concededBy) return other(game.concededBy);
  const [total1, total2] = [scoreOf(1), scoreOf(2)];
  return total1 > total2 ? 1 : total2 > total1 ? 2 : null;
}

const untimed = (): boolean => game.clock.offFrom !== undefined;

/**
 * Give up, play the end fast without clocks, or erase the game. A player's phone gives up for
 * its own player only; a shared screen, for either
 */
function openEndGame(): void {
  closePopovers();
  const me = online?.seat;
  for (const player of [1, 2] as const) {
    const button = app.querySelector<HTMLButtonElement>(`#end-game-concede-${player}`)!;
    button.hidden = me !== undefined && me !== player;
    button.querySelector("b")!.textContent = me === player ? t("concedeMine") : t("concede", { n: player });
    button.querySelector("span")!.textContent = t("concedeHint", { n: other(player) });
  }
  app.querySelector<HTMLElement>("#end-game-untimed")!.hidden = untimed();
  endGameOverlay.classList.add("is-visible");
  endGameOverlay.setAttribute("aria-hidden", "false");
  btnEndGameCancel.focus();
}

function closeEndGame(): void {
  endGameOverlay.classList.remove("is-visible");
  endGameOverlay.setAttribute("aria-hidden", "true");
}

/** A player gives the game up: whatever was on screen goes, the result shows */
function concede(player: Player): void {
  closeEndGame();
  if (cardsPlayer !== null) closeCards(false);
  if (game.photoBreak) {
    game.photoBreak = false;
    hidePhotoBreak();
  }
  if (game.judgeCall !== null) {
    game.judgeCall = null;
    hideJudgeCall();
  }
  hideTimeOut();
  // A draw waiting for the break to end would open over the result
  pendingDraw = null;
  game.concededBy = player;
  logClock("concede", { player });
  finishGameByScore();
}

/** The rest of the game is played fast: the clocks stop for good, no more photo breaks */
function finishWithoutClocks(): void {
  closeEndGame();
  stopClock(game.clock);
  game.clock.offFrom = game.round;
  game.options.photoBreaks = false;
  photoBreaksToggle.checked = false;
  logClock("untimed");
  stopLoop();
  hideTimeOut();
  if (game.phase === "paused") resume();
  applyTimesToDisplay();
  setActivePanels();
  updateButtons();
}

/** In a game still going, the reset buttons end it instead: they open the choices above */
function renderResetLabels(): void {
  const key = inGame(game) && !isOver() ? "endGame" : "reset";
  for (const id of ["btn-reset", "seat-reset"]) {
    const label = app.querySelector<HTMLElement>(`#${id} span`)!;
    label.dataset.i18n = key;
    label.textContent = t(key);
  }
  btnReset.dataset.i18nTitle = key;
  btnReset.title = t(key);
}

function hideResultOverlay(): void {
  closeMvp();
  closeSave();
  closeViewer();
  resultOverlay.classList.remove("is-visible");
  resultOverlay.setAttribute("aria-hidden", "true");
  panel1.classList.remove("is-flag");
  panel2.classList.remove("is-flag");
}

function openTurnConfirmModal(kind: TurnConfirmKind): void {
  turnConfirmKind = kind;
  if (kind === "deploy-end") {
    turnConfirmTitle.textContent = t("deployEndTitle");
    turnConfirmMsg.textContent = t("deployEndMsg");
  } else if (kind === "mid-round") {
    turnConfirmTitle.textContent = t("endTurnTitle", { n: game.firstPlayer });
    turnConfirmMsg.textContent = t("endTurnMsg", { n: other(game.firstPlayer) });
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
    turnConfirmMsg.textContent = t("nextRoundMsg", { n: game.firstPlayer });
  }
  turnConfirmOverlay.classList.add("is-visible");
  turnConfirmOverlay.setAttribute("aria-hidden", "false");
  btnTurnConfirmOk.focus();
}

/* ---------- Before the battle: the first toss, the deployment, the second toss ---------- */

const TOSS_MS = 1300;
/** Who goes first: the coin flies higher and longer, under a drumroll */
const FINAL_TOSS_MS = 2400;
let tossTimer = 0;
/** The coin of the toss on screen is down: its result shows */
let tossLanded = false;

const isDeploying = (): boolean => game.phase === "setup" && game.preBattle?.step === "deployment";
/** The tosses or the deployment are under way: the setup is fixed */
const inPreBattle = (): boolean => game.phase === "setup" && !!game.preBattle;
const deploymentTimed = (): boolean => game.options.deployClock !== false;
/** The clocks tick in the battle, and during a timed deployment */
const clockTicks = (): boolean => isRunning() || (isDeploying() && deploymentTimed());

/** After the missions: the first toss, whose winner picks who deploys first */
function openChooserToss(): void {
  closePopovers();
  game.clockLog = {};
  const chooser: Player = Math.random() < 0.5 ? 1 : 2;
  game.preBattle = { step: "chooser", at: nowMs(), chooser, deployFirst: null, toss: null };
  logClock("chooser", { player: chooser });
  setInputsEnabled(false);
  updateButtons();
  showToss();
}

/** The chooser has picked: the deployment starts, with that player's clock if it is timed */
function startDeployment(deployFirst: Player): void {
  const pre = game.preBattle;
  if (!pre || pre.step !== "chooser" || !tossLanded || (online && online.seat !== pre.chooser)) return;
  pre.deployFirst = deployFirst;
  pre.step = "deployment";
  game.clock = clockFromInputs();
  game.clock.active = deployFirst;
  logClock("deploy", { player: deployFirst });
  if (deploymentTimed()) {
    runClock(game.clock);
    startLoop();
    void tryAcquireWakeLock();
  }
  hideToss();
  if (cardsPlayer !== null) closeCards(false);
  renderDeployment();
}

/** A unit is down: the other player places one */
function passDeployment(): void {
  if (!isDeploying() || (online && game.clock.active !== online.seat)) return;
  playSound("switch");
  const next = other(game.clock.active);
  logClock("switch", { player: next });
  setActiveClock(game.clock, next);
  if (deploymentTimed() && timeLeft(next) <= 0) stopClock(game.clock);
  else if (deploymentTimed() && game.clock.since === null) {
    runClock(game.clock);
    startLoop();
  }
  renderDeployment();
}

/** Asked first: a stray Enter or tap must not end the deployment */
function requestDeploymentEnd(): void {
  if (isDeploying()) openTurnConfirmModal("deploy-end");
}

/** Every unit is down: the second toss says who goes first */
function endDeployment(): void {
  const pre = game.preBattle;
  if (!pre || !isDeploying()) return;
  stopClock(game.clock);
  stopLoop();
  logClock("deployEnd");
  const result: Player = Math.random() < 0.5 ? 1 : 2;
  pre.step = "first";
  pre.toss = { at: nowMs(), result, corrected: false };
  game.firstPlayer = result;
  logClock("first", { player: result });
  renderDeployment();
  showToss();
}

/** The latest log line of a kind, by its key: a step taken back removes it */
function lastLogKey(kind: ClockEventKind): string | undefined {
  return Object.keys(game.clockLog)
    .filter((key) => game.clockLog[key].kind === kind)
    .sort((a, b) => game.clockLog[a].at - game.clockLog[b].at)
    .pop();
}

/** "Deployment done" came too early: the deployment goes on where it was */
function backToDeployment(): void {
  const pre = game.preBattle;
  if (!pre || pre.step !== "first") return;
  for (const kind of ["first", "deployEnd"] as const) {
    const key = lastLogKey(kind);
    if (key) delete game.clockLog[key];
  }
  pre.step = "deployment";
  pre.toss = null;
  hideToss();
  if (deploymentTimed() && timeLeft(game.clock.active) > 0) {
    runClock(game.clock);
    startLoop();
  }
  renderDeployment();
}

/** Rolled with real dice instead: the result goes the other way */
function correctFirstToss(): void {
  const toss = game.preBattle?.toss;
  if (!toss || !tossLanded) return;
  toss.result = other(toss.result);
  toss.corrected = true;
  game.firstPlayer = toss.result;
  const key = lastLogKey("first");
  if (key) game.clockLog[key].player = toss.result;
  app.querySelector<HTMLElement>("#coin")!.dataset.face = String(toss.result);
  renderToss();
}

/** Before the first toss, back to the missions or the setup */
function cancelChooserToss(): void {
  game.preBattle = null;
  game.clockLog = {};
  hideToss();
  setInputsEnabled(true);
  updateButtons();
}

function startBattle(): void {
  if (app.querySelector<HTMLButtonElement>("#btn-toss-start")!.disabled) return;
  hideToss();
  if (cardsPlayer !== null) closeCards();
  // With photo breaks, the deployed table is photographed first: the battle starts once it is done
  if (game.options.photoBreaks) {
    newGamePhotos();
    game.photoBreak = true;
    showPhotoBreak();
    return;
  }
  start();
}

/** A new game: its photos go under a new id, and the last game's go, here and in the room */
function newGamePhotos(): void {
  if (game.gameId) return;
  game.gameId = newGameId();
  void keepOnlyGame(game.gameId);
  roomSession()?.room?.clearPhotos();
}

/** The board and the phones during the deployment: who places a unit, the clock it runs on */
function renderDeployment(): void {
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
}

/** Either toss, also when made on the other phone: the same flip, the same side */
function showToss(): void {
  const pre = game.preBattle;
  if (!pre || pre.step === "deployment") return;
  const final = pre.step === "first";
  const result = final ? pre.toss!.result : pre.chooser;
  const coin = app.querySelector<HTMLElement>("#coin")!;
  const still = prefersReducedMotion();
  tossOverlay.classList.toggle("is-final", final);
  tossOverlay.classList.remove("is-landed");
  tossOverlay.style.setProperty("--toss-color", `var(--p${result})`);
  tossLanded = false;
  renderToss();
  placeCoin();
  playSound(final ? "drumroll" : "coinToss");
  tossLanded = still;
  coin.classList.remove("is-tossing-1", "is-tossing-2", "is-long");
  void coin.offsetWidth;
  if (!still) coin.classList.add(`is-tossing-${result}`, ...(final ? ["is-long"] : []));
  window.clearTimeout(tossTimer);
  const land = (): void => {
    tossLanded = true;
    tossOverlay.classList.add("is-landed");
    if (final) playSound("tossReveal");
    renderToss();
  };
  if (still) land();
  else tossTimer = window.setTimeout(land, final ? FINAL_TOSS_MS : TOSS_MS);
  tossOverlay.classList.add("is-visible");
  tossOverlay.setAttribute("aria-hidden", "false");
  renderToss();
}

/**
 * The coin flies alone in the middle of the dimmed screen. Its place on landing is at the top of
 * the card, which is already laid out, hidden: the coin starts that far down and rises to it
 */
function placeCoin(): void {
  const stage = app.querySelector<HTMLElement>("#toss-stage")!;
  stage.classList.add("is-placing");
  stage.style.setProperty("--toss-shift", "0px");
  const box = stage.querySelector(".coin-stage")!.getBoundingClientRect();
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
  stage.style.setProperty("--toss-shift", `${(window.innerHeight / 2 - (box.top + box.height / 2)) / scale}px`);
  void stage.offsetWidth;
  stage.classList.remove("is-placing");
}

function renderToss(): void {
  const pre = game.preBattle;
  if (!pre || pre.step === "deployment") return;
  const final = pre.step === "first";
  const result = final ? pre.toss!.result : pre.chooser;
  const coin = app.querySelector<HTMLElement>("#coin")!;
  if (tossLanded) {
    coin.classList.remove("is-tossing-1", "is-tossing-2", "is-long");
    coin.dataset.face = String(result);
  }
  const text = (id: string, value: string): void => {
    app.querySelector(`#${id}`)!.textContent = value;
  };
  text("toss-step", t(final ? "tossStepFirst" : "tossStepChooser"));
  // Online, the winner's phone picks and the first player's phone starts: their clock is the one that runs
  const chooserWaits = !!online && online.seat !== pre.chooser;
  const starterWaits = !!online && online.seat !== result;
  if (final) {
    text("toss-title", t("tossFirstWon", { n: result }));
    text("toss-msg", pre.toss!.corrected ? t("tossCorrected") : "");
    text("toss-note", game.options.photoBreaks ? `${t("startMsg", { n: result })} ${t("photoBreaksOn")}` : t("startMsg", { n: result }));
  } else {
    text("toss-title", t("tossChooserTitle"));
    text("toss-msg", t("tossChooserWon", { n: result }));
    text("toss-note", chooserWaits ? t("tossChooserWait", { n: result }) : "");
  }
  const choices = app.querySelector<HTMLElement>("#toss-choices")!;
  choices.hidden = final;
  for (const choice of choices.querySelectorAll("button")) choice.disabled = chooserWaits || !tossLanded;
  const startButton = app.querySelector<HTMLButtonElement>("#btn-toss-start")!;
  startButton.hidden = !final;
  startButton.disabled = !tossLanded || starterWaits;
  text("toss-start-label", starterWaits ? t("tossWait", { n: result }) : t("startBattle"));
  text("toss-cancel-label", t(final ? "backToDeployment" : "cancel"));
  app.querySelector<HTMLElement>("#btn-toss-fix")!.hidden = !final;
}

function hideToss(): void {
  window.clearTimeout(tossTimer);
  // It fades out as it is, coin landed on its card: the next toss puts the coin back (showToss)
  tossOverlay.classList.remove("is-visible");
  tossOverlay.setAttribute("aria-hidden", "true");
}

function cancelToss(): void {
  if (game.preBattle?.step === "first") backToDeployment();
  else cancelChooserToss();
}

/* ---------- Battle report: the end-of-battle screen ---------- */

const ROUNDS = Array.from({ length: MAX_GAME_TURN }, (_, i) => i + 1);

/** WTC points from the VP gap: 10–10 up to 5 apart, then a point more every 5 VP, 20–0 past 50 */
function wtcPoints(mine: number, theirs: number): number {
  const gap = mine - theirs;
  const step = Math.min(10, Math.ceil(Math.max(0, Math.abs(gap) - 5) / 5));
  return gap >= 0 ? 10 + step : 10 - step;
}

/** Time each player spent in each round, from the clock log. A judge's adjustment is not time spent */
function timeByRound(): Record<Player, number[]> | null {
  const events = clockEvents();
  const marks = events.filter((event) => event.kind === "start" || event.kind === "end" || (event.kind === "turn" && event.player === game.firstPlayer));
  if (marks.length === 0) return null;
  const now = { at: nowMs(), left: { 1: timeLeft(1), 2: timeLeft(2) } };
  const spent: Record<Player, number[]> = { 1: ROUNDS.map(() => 0), 2: ROUNDS.map(() => 0) };
  marks.forEach((mark, i) => {
    if (mark.kind === "end") return;
    const next: { at: number; left: Record<Player, number> } = marks[i + 1] ?? now;
    for (const player of [1, 2] as const) {
      const adjusted = events
        .filter((event) => event.kind === "adjust" && event.player === player && event.at >= mark.at && event.at < next.at)
        .reduce((total, event) => total + (event.seconds ?? 0), 0);
      const slot = Math.min(MAX_GAME_TURN, mark.round) - 1;
      spent[player][slot] += Math.max(0, mark.left[player] - next.left[player] + adjusted);
    }
  });
  return spent;
}

/** Time each player spent deploying, when the deployment was timed */
function deploymentSpent(): Record<Player, number> | null {
  const events = clockEvents();
  const from = events.find((event) => event.kind === "deploy");
  const to = events.find((event) => event.kind === "deployEnd");
  if (!from || !to || !deploymentTimed()) return null;
  return { 1: Math.max(0, from.left[1] - to.left[1]), 2: Math.max(0, from.left[2] - to.left[2]) };
}

const reportChip = (vp: number): string => `<span class="report-chip">${vp}</span>`;

/** Cut short by the 15-point turn cap: what counted, in the warning colour; what it was worth on hover */
const reportCutChip = (vp: number, full: number): string =>
  `<span class="report-chip is-cut" title="${t("capCut", { vp, full, max: MAX_POINTS_PER_TURN })}">${vp}</span>`;

/** A round not reached yet stays empty; one played without a point shows its 0 */
const reportPoints = (vp: number, round: number): string =>
  `<td>${vp > 0 ? reportChip(vp) : round <= game.round ? '<span class="report-zero">0</span>' : ""}</td>`;

function reportRow(label: string, cells: string, total: string, kind = ""): string {
  return `<tr${kind ? ` class="${kind}"` : ""}><th scope="row">${label}</th>${cells}<td class="report-total">${total}</td></tr>`;
}

/** Card by card: drawn (•), scored (its points) or discarded unscored (✕), in the round it happened */
function secondaryCardRows(player: Player): string {
  const pile = game.secondaries[player];
  const rounds = game.cardRounds?.[player] ?? {};
  const ids = [...new Set([...pile.scored.map(({ id }) => id), ...pile.discard, ...pile.hand])];
  return ids
    .map((id) => {
      const scored = pile.scored.filter((entry) => entry.id === id);
      const { drawn, discarded } = rounds[id] ?? {};
      const cells = ROUNDS.map((round) => {
        const inRound = scored.filter((entry) => entry.turn + 1 === round);
        if (inRound.length > 0) {
          const vp = inRound.reduce((total, entry) => total + entry.vp, 0);
          const full = inRound.reduce((total, entry) => total + (entry.full ?? entry.vp), 0);
          return `<td>${full > vp ? reportCutChip(vp, full) : reportChip(vp)}</td>`;
        }
        if (scored.length === 0 && discarded === round) return '<td class="report-mark" aria-label="✕">✕</td>';
        if (drawn === round) return '<td class="report-mark">•</td>';
        return "<td></td>";
      }).join("");
      const total = scored.reduce((sum, entry) => sum + entry.vp, 0);
      return { order: drawn ?? MAX_GAME_TURN + 1, html: reportRow(SECONDARY_BY_ID.get(id)?.name ?? id, cells, String(total)) };
    })
    .sort((a, b) => a.order - b.order)
    .map(({ html }) => html)
    .join("");
}

/** Text typed by a player, put in the page as text */
const esc = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minutes only: the time row has no room for seconds */
const formatMinutes = (seconds: number): string => `${Math.round(seconds / 60)}'`;


const reportDetail = (): boolean => reportDetailOpen ?? (stored(REPORT_DETAIL_STORAGE_KEY) ? stored(REPORT_DETAIL_STORAGE_KEY) === "open" : !PHONE.matches);

/** The army a player picked, if any */
function factionOf(player: Player): Faction | undefined {
  const id = game.factions[player];
  return id ? FACTION_BY_ID.get(id) : undefined;
}

/** Picked as plain Space Marines ("Other chapter" in the list), the army goes by that name */
function factionName(player: Player): string | undefined {
  const faction = factionOf(player);
  return faction && (faction.id === SPACE_MARINES ? SPACE_MARINES_NAME : faction.name)[getLang()];
}

/** The army beside a player's name, when the name is not already it (both picked the same) */
function factionAside(player: Player): string | undefined {
  const name = factionName(player);
  return name && name !== t("player", { n: player }) ? name : undefined;
}

/**
 * `image`: the picture shared from the report, with every card shown. On screen, the secondaries
 * fold to one line of points per round, and one toggle opens both players to compare them
 */
function reportPlayer(player: Player, spent: Record<Player, number[]> | null, image: boolean): string {
  const turns = game.scoreByTurn[player];
  const primaryTotal = scoreOf(player, "primary");
  const secondaryTotal = scoreOf(player, "secondary");
  const disposition = DISPOSITIONS.find(({ id }) => id === game.dispositions[player])?.name;
  const sub = [factionAside(player), disposition].filter(Boolean).join(" · ");
  const sumSpent = spent ? spent[player].reduce((total, seconds) => total + seconds, 0) : 0;
  const badges = [
    game.preBattle?.deployFirst === player ? t("reportDeployedFirst") : "",
    player === game.firstPlayer ? t("reportWentFirst") : "",
  ]
    .filter(Boolean)
    .map((badge) => ` <span class="report-badge">${badge}</span>`)
    .join("");
  const deployed = deploymentSpent();
  // Per turn, what the primary lines cut by the 15-point cap would have added
  const primaryCut = ROUNDS.map((round) =>
    Object.entries(game.primaryFull?.[player] ?? {})
      .filter(([key]) => key.startsWith(`${round - 1}|`))
      .reduce((total, [key, full]) => total + full - (game.primaryScored[player][key] ?? full), 0),
  );
  const primaryRows =
    reportRow(
      primaryCard(player)?.name ?? t("reportPrimary"),
      ROUNDS.map((round) => {
        const vp = turns.primary[round - 1];
        const cut = primaryCut[round - 1];
        return cut > 0 ? `<td>${reportCutChip(vp, vp + cut)}</td>` : reportPoints(vp, round);
      }).join(""),
      String(primaryTotal - game.endBonus[player]),
    ) +
    (game.endBonus[player] > 0 ? reportRow(t("endBonus"), ROUNDS.map(() => "<td></td>").join(""), String(game.endBonus[player])) : "");
  const timeRow = spent
    ? reportRow(
        t("reportTime"),
        ROUNDS.map((round) => `<td>${spent[player][round - 1] > 0 ? formatMinutes(spent[player][round - 1]) : ""}</td>`).join(""),
        formatMinutes(sumSpent),
        "report-time",
      )
    : "";
  const head = `<tr><th scope="col"><span class="report-sr">${t("logEvent")}</span></th>${ROUNDS.map((round) => `<th scope="col">R${round}</th>`).join("")}<th scope="col">${t("total")}</th></tr>`;
  const group = (label: string, total: number, rows: string): string =>
    `<tbody><tr class="report-group"><th scope="rowgroup" colspan="${MAX_GAME_TURN + 1}">${label}</th><td class="report-total">${total}</td></tr>${rows}</tbody>`;
  let secondaries: string;
  if (!game.options.cards) {
    const row = reportRow(t("reportSecondaries"), ROUNDS.map((round) => reportPoints(turns.secondary[round - 1], round)).join(""), String(secondaryTotal));
    secondaries = group(t("reportSecondaries"), secondaryTotal, row);
  } else if (image) {
    secondaries = group(t("reportSecondaries"), secondaryTotal, secondaryCardRows(player));
  } else {
    const open = reportDetail();
    const cards = Object.keys(game.cardRounds?.[player] ?? {}).length || game.secondaries[player].scored.length;
    const toggle = `<button type="button" class="report-fold" data-report-fold aria-expanded="${open}" aria-label="${t(open ? "reportFoldClose" : "reportFoldOpen")}">${ICON_NEXT}<span>${t("reportSecondaries")}</span>${cards ? `<span class="report-fold__n">${cards}</span>` : ""}</button>`;
    secondaries = open
      ? group(toggle, secondaryTotal, secondaryCardRows(player))
      : `<tbody><tr class="report-group is-folded"><th scope="row">${toggle}</th>${ROUNDS.map((round) => reportPoints(turns.secondary[round - 1], round)).join("")}<td class="report-total">${secondaryTotal}</td></tr></tbody>`;
  }
  return `
    <section class="report-player is-p${player}">
      <header class="report-player__head">
        <div>
          <h3>${t("player", { n: player })}${badges}</h3>
          ${sub ? `<p>${sub}</p>` : ""}
        </div>
        <span class="report-player__total">${scoreOf(player)}</span>
      </header>
      <table class="report-table">
        <thead>${head}</thead>
        ${group(t("reportPrimary"), primaryTotal, primaryRows)}
        ${secondaries}
        ${group(t("battleReady"), BATTLE_READY_VP, "")}
        ${timeRow ? `<tbody>${timeRow}</tbody>` : ""}
      </table>
      ${primaryCut.some((cut) => cut > 0) || game.secondaries[player].scored.some((entry) => entry.full) ? `<p class="report-cut-note"><span class="report-cut-swatch" aria-hidden="true"></span>${t("reportCutNote", { max: MAX_POINTS_PER_TURN })}</p>` : ""}
      <footer class="report-player__foot">
        <span>${t("reportCpLeft")} <b>${game.cp[player]}</b></span>
        ${deployed ? `<span>${t("reportDeployTime")} <b>${formatSpan(deployed[player])}</b></span>` : ""}
        <span>${t("reportTimeLeft")} <b>${formatTime(timeLeft(player))}</b></span>
      </footer>
    </section>`;
}

/* ---------- The photos of the game, on the end screen ---------- */

/** The player turns played, in order: each photo shows the table as one of them left it */
function playedTurns(): PhotoTurn[] {
  const turns: PhotoTurn[] = [];
  const second = other(game.firstPlayer);
  for (let round = 1; round <= Math.min(game.round, MAX_GAME_TURN); round++) {
    turns.push({ round, player: game.firstPlayer });
    if (round < game.round || game.turnPlayer === second) turns.push({ round, player: second });
  }
  return turns;
}

const turnId = ({ round, player }: PhotoTurn): string => `${round}_${player}`;
/** The table once deployed, photographed before the battle starts: "round 0" */
const DEPLOYMENT: PhotoTurn = { round: 0, player: 1 };
const isDeployment = (turn: PhotoTurn): boolean => turn.round === 0;
/** The MVP photographed on its own at the end, one per player: "round 9", never a turn played */
const MVP_SHOT_ROUND = 9;
const mvpShot = (player: Player): PhotoTurn => ({ round: MVP_SHOT_ROUND, player });
const isMvpShot = (turn: PhotoTurn): boolean => turn.round === MVP_SHOT_ROUND;
/** A photo's short name, as HTML: "R2 · Necrons" (the army hidden where its row says it), or the deployment */
const shotLabel = (turn: PhotoTurn): string =>
  isMvpShot(turn)
    ? t("mvpShotShort")
    : isDeployment(turn)
      ? t("photoDeployShort")
      : `R${turn.round}<span class="shot-who"> · ${esc(t("player", { n: turn.player }))}</span>`;
const shotTitle = (turn: PhotoTurn): string =>
  isMvpShot(turn) ? t("mvpShotTitle") : isDeployment(turn) ? t("photoDeployTurn") : t("photoTurn", { r: turn.round, n: turn.player });
const sameTurn = (a: PhotoTurn, b: PhotoTurn): boolean => a.round === b.round && a.player === b.player;
const lastTurn = (): PhotoTurn => playedTurns().pop() ?? { round: 1, player: game.firstPlayer };
const turnPoints = ({ round, player }: PhotoTurn): number =>
  game.scoreByTurn[player].primary[round - 1] + game.scoreByTurn[player].secondary[round - 1];

/** The score as that turn ended, as the board showed it (Battle ready included); the final one at the end */
function scoreAfter(turn: PhotoTurn): string {
  if (sameTurn(turn, lastTurn())) return `${scoreOf(1)} – ${scoreOf(2)}`;
  const rounds = (player: Player): number => (player === turn.player || player === game.firstPlayer ? turn.round : turn.round - 1);
  const upTo = (player: Player): number =>
    BATTLE_READY_VP +
    game.scoreByTurn[player].primary.slice(0, rounds(player)).reduce((a, b) => a + b, 0) +
    game.scoreByTurn[player].secondary.slice(0, rounds(player)).reduce((a, b) => a + b, 0);
  return `${upTo(1)} – ${upTo(2)}`;
}


async function loadEndPhotos(): Promise<void> {
  const load = ++endPhotosLoad;
  const photos = await gamePhotos(game.gameId);
  if (load !== endPhotosLoad) return;
  for (const { thumb } of endPhotos.values()) URL.revokeObjectURL(thumb);
  endPhotos = new Map(photos.map((photo) => [turnId(photo), { photo, thumb: URL.createObjectURL(photo.thumb) }]));
}

/** A photo came in or went: the end screen and its dialogs show it */
async function refreshEndPhotos(): Promise<void> {
  if (!resultOverlay.classList.contains("is-visible")) return;
  await loadEndPhotos();
  renderStory();
  renderMvpSection();
  renderResultActions();
  if (mvpOverlay.classList.contains("is-visible")) renderMvpPicks();
  if (saveOverlay.classList.contains("is-visible") && saveStep === "form") renderSaveSheet();
  if (viewerOverlay.classList.contains("is-visible") && viewerTurn && !endPhotos.has(turnId(viewerTurn))) closeViewer();
}

/** The deployment, then every player turn played */
const storySlots = (): PhotoTurn[] => [DEPLOYMENT, ...playedTurns()];
const storyTurns = (): PhotoTurn[] => storySlots().filter((turn) => endPhotos.has(turnId(turn)));

/** The battle story: the deployment, then one photo per player turn, in order, with the points that turn scored */
function storyHtml(): string {
  const turns = storySlots();
  const last = lastTurn();
  const canShoot = CAN_SHOOT.matches && !!game.gameId;
  if (storyTurns().length === 0 && !(game.options.photoBreaks && (canShoot || roomSession()))) return "";
  const count = turns.filter((turn) => endPhotos.has(turnId(turn))).length;
  const cells = turns.map((turn) => {
    // The deployment in its own column, across both players' rows; each row under its army's name
    const pos = isDeployment(turn) ? "grid-column:1;grid-row:2 / span 4" : `grid-column:${turn.round + 1};grid-row:${turn.player === game.firstPlayer ? 3 : 5}`;
    const kind = isDeployment(turn) ? "is-deploy" : `is-p${turn.player}`;
    const entry = endPhotos.get(turnId(turn));
    if (entry) {
      const gain = isDeployment(turn) ? "" : `<span class="story-shot__gain">+${turnPoints(turn)}</span>`;
      return `<button type="button" class="story-shot ${kind}" style="${pos}" data-story-turn="${turnId(turn)}" aria-label="${shotTitle(turn)}"><img src="${entry.thumb}" alt="" /><span class="story-shot__label">${shotLabel(turn)}</span>${gain}</button>`;
    }
    if (sameTurn(turn, last) && canShoot) {
      return `<button type="button" class="story-shot is-empty is-p${turn.player}" style="${pos}" id="btn-final-photo">${ICON_CAMERA}<b>${t("reportFinalPhoto")}</b><small>${t("reportFinalTake")}</small></button>`;
    }
    if (sameTurn(turn, last) && roomSession()) {
      return `<span class="story-shot is-empty is-p${turn.player}" style="${pos}">${ICON_PHONE}<b>${t("reportFinalPhoto")}</b><small>${t("reportFinalFromPhone")}</small></span>`;
    }
    return `<span class="story-shot is-missing ${kind}" style="${pos}"><small>${t("reportNoPhoto")}</small></span>`;
  });
  const labels =
    `<span class="story-round" style="grid-row:1;grid-column:1">${t("photoDeployShort")}</span>` +
    ROUNDS.map((round) => `<span class="story-round" style="grid-row:1;grid-column:${round + 1}">R${round}</span>`).join("") +
    // Whose row is whose, said over it: two armies may share a color. The first player's on top
    [game.firstPlayer, other(game.firstPlayer)]
      .map((player, i) => `<span class="story-who is-p${player}" style="grid-row:${i * 2 + 2};grid-column:2 / -1">${esc(t("player", { n: player }))}</span>`)
      .join("");
  return `
    <div class="report-section-head"><h3>${t("reportStory")}</h3><span class="report-section-count">${t("reportStoryCount", { n: count, total: turns.length })}</span></div>
    ${!CAN_SHOOT.matches && roomSession() ? `<p class="report-story__sub">${ICON_PHONE}${t("reportStoryFromPhones")}</p>` : ""}
    <div class="report-story__grid">${labels}${cells.join("")}</div>`;
}

function renderStory(): void {
  const el = app.querySelector<HTMLElement>("#report-story");
  if (!el) return;
  el.innerHTML = storyHtml();
  el.hidden = el.innerHTML === "";
}

/* ---------- MVP ---------- */

function mvpCardHtml(player: Player): string {
  const mvp = game.mvp?.[player];
  const eyebrow = `<span class="mvp-card__eyebrow">${ICON_MEDAL}${t("mvpOf", { n: player })}</span>`;
  // The other player's MVP is elected on their phone: here it is only shown, never a button
  const editable = canEdit(player);
  const open = editable ? `button type="button" data-mvp-open="${player}"` : "div";
  const close = editable ? "button" : "div";
  const elsewhere = editable ? "" : " is-elsewhere";
  if (!mvp) {
    return `<${open} class="mvp-card is-empty is-p${player}${elsewhere}">${eyebrow}<span class="mvp-card__empty">${editable ? t("mvpEmpty") : t("mvpToElectThere", { n: player })}</span></${close}>`;
  }
  const photo = mvp.photo ? endPhotos.get(turnId(mvp.photo)) : undefined;
  const picture = photo ? `<img class="mvp-card__photo" src="${photo.thumb}" alt="" />` : `<span class="mvp-card__photo is-none">${ICON_MEDAL}</span>`;
  return `<${open} class="mvp-card is-p${player}${elsewhere}">${picture}<span class="mvp-card__body">${eyebrow}<b class="mvp-card__unit">${esc(mvp.unit)}</b>${mvp.feat ? `<span class="mvp-card__feat">${esc(mvp.feat)}</span>` : ""}</span></${close}>`;
}

function mvpHtml(): string {
  const head = `<div class="report-section-head"><h3>${t("mvpTitle")}</h3></div>`;
  if (!game.mvp?.[1] && !game.mvp?.[2]) {
    return `${head}<button type="button" class="mvp-cta" data-mvp-open="${online?.seat ?? 1}">${ICON_MEDAL}<span><b>${t("mvpElect")}</b><small>${t("mvpElectHint")}</small></span>${ICON_NEXT}</button>`;
  }
  return `${head}<div class="mvp-grid">${mvpCardHtml(1)}${mvpCardHtml(2)}</div>`;
}

/** In the shared picture: the units' names, no button */
function mvpImageHtml(): string {
  if (!game.mvp?.[1] && !game.mvp?.[2]) return "";
  const item = (player: Player): string => {
    const mvp = game.mvp[player];
    return `<div class="report-mvp-line is-p${player}"><small>${ICON_MEDAL}${t("mvpOf", { n: player })}</small><b>${mvp ? esc(mvp.unit) : t("mvpNotElected")}</b>${mvp?.feat ? `<span>${esc(mvp.feat)}</span>` : ""}</div>`;
  };
  return `<div class="report-mvp-lines">${item(1)}${item(2)}</div>`;
}

function renderMvpSection(): void {
  const el = app.querySelector<HTMLElement>("#report-mvp");
  if (el) el.innerHTML = mvpHtml();
}


function openMvp(focus: Player): void {
  const copy = (mvp: Mvp | null): Mvp => (mvp ? { ...mvp, photo: mvp.photo ? { ...mvp.photo } : null } : { unit: "", feat: "", photo: null });
  mvpDraft = { 1: copy(game.mvp?.[1] ?? null), 2: copy(game.mvp?.[2] ?? null) };
  const form = app.querySelector<HTMLElement>("#mvp-form")!;
  // The player picked comes first. A phone holds its own player only: the other one is elected on
  // the other phone, a field it could not fill would only be in the way
  form.innerHTML = [focus, other(focus)]
    .filter((player) => !online || canEdit(player))
    .map((player) => {
      const draft = mvpDraft![player];
      const editable = canEdit(player);
      const faction = factionAside(player);
      return `
      <fieldset class="mvp-field is-p${player}"${editable ? "" : " disabled"}>
        <legend>${t("player", { n: player })}${faction ? ` <span>· ${faction}</span>` : ""}</legend>
        ${editable ? "" : `<p class="mvp-field__note">${t("mvpOtherPhone", { n: player })}</p>`}
        <label class="mvp-label"><span>${t("mvpUnit")}</span><input type="text" id="mvp-unit-${player}" maxlength="40" autocomplete="off" value="${esc(draft.unit)}" placeholder="${esc(t("mvpUnitPlaceholder"))}" /></label>
        <label class="mvp-label"><span>${t("mvpFeat")} <em>${t("mvpOptional")}</em></span><input type="text" id="mvp-feat-${player}" maxlength="80" autocomplete="off" value="${esc(draft.feat)}" placeholder="${esc(t("mvpFeatPlaceholder"))}" /></label>
        <div class="mvp-label mvp-photos" id="mvp-photos-${player}"></div>
      </fieldset>`;
    })
    .join("");
  renderMvpPicks();
  updateMvpCrown();
  mvpOverlay.classList.add("is-visible");
  mvpOverlay.setAttribute("aria-hidden", "false");
  const target = canEdit(focus) ? focus : canEdit(1) ? 1 : 2;
  // A phone would open its keyboard over the dialog: the field is one tap away
  if (!CAN_SHOOT.matches) window.setTimeout(() => app.querySelector<HTMLInputElement>(`#mvp-unit-${target}`)?.focus(), 60);
  else btnMvpCrown.focus({ preventScroll: true });
}

/** The photos to pick from: the unit's moment of glory */
function renderMvpPicks(): void {
  if (!mvpDraft) return;
  const turns = storyTurns();
  for (const player of [1, 2] as const) {
    const el = app.querySelector<HTMLElement>(`#mvp-photos-${player}`);
    if (!el) continue;
    const chosen = mvpDraft[player].photo;
    const picked = (turn: PhotoTurn): boolean => !!chosen && sameTurn(chosen, turn);
    // One place for the MVP's own photo, first: the camera until it is taken, then the photo
    // itself, which a tap takes again once it is the one picked. The table's photos follow
    const own = mvpShot(player);
    const ownTaken = endPhotos.has(turnId(own));
    const ownSlot = ownTaken
      ? `<button type="button" role="radio" class="mvp-pick__own" data-mvp-pick="${player}" data-turn="${turnId(own)}" aria-checked="${picked(own)}" aria-label="${picked(own) ? t("mvpRetake") : shotTitle(own)}"><img src="${endPhotos.get(turnId(own))!.thumb}" alt="" /><span>${picked(own) ? `${ICON_CAMERA}${t("mvpRetake")}` : shotLabel(own)}</span></button>`
      : `<button type="button" class="mvp-pick__shoot" data-mvp-shoot="${player}">${ICON_CAMERA}<span>${t(CAN_SHOOT.matches ? "mvpShoot" : "mvpAddPhoto")}</span></button>`;
    el.innerHTML = `<span>${t("mvpPhoto")} <em>${t("mvpOptional")}</em></span>
      <div class="mvp-pick" role="radiogroup" aria-label="${t("mvpPhoto")}">
        ${ownSlot}
        ${turns
          .map(
            (turn) =>
              `<button type="button" role="radio" data-mvp-pick="${player}" data-turn="${turnId(turn)}" aria-checked="${picked(turn)}" aria-label="${shotTitle(turn)}"><img src="${endPhotos.get(turnId(turn))!.thumb}" alt="" /><span>${shotLabel(turn)}</span></button>`,
          )
          .join("")}
      </div>
      ${chosen ? `<button type="button" class="mvp-pick-clear" data-mvp-clear="${player}">${t("mvpRemovePhoto")}</button>` : ""}`;
  }
}

function updateMvpCrown(): void {
  btnMvpCrown.disabled = !mvpDraft || !([1, 2] as const).some((player) => canEdit(player) && mvpDraft![player].unit.trim());
}

function closeMvp(): void {
  mvpDraft = null;
  mvpOverlay.classList.remove("is-visible");
  mvpOverlay.setAttribute("aria-hidden", "true");
}

function crownMvps(): void {
  if (!mvpDraft) return;
  const crowned: Player[] = [];
  for (const player of [1, 2] as const) {
    if (!canEdit(player)) continue;
    const { unit, feat, photo } = mvpDraft[player];
    game.mvp[player] = unit.trim() ? { unit: unit.trim(), feat: feat.trim(), photo } : null;
    if (game.mvp[player]) crowned.push(player);
  }
  closeMvp();
  renderMvpSection();
  if (crowned.length > 0) {
    playSound("joined");
    showToast(crowned.length === 2 ? t("mvpCrowned") : t("mvpCrownedOne", { n: crowned[0] }));
  }
}

/* ---------- The chronicle: each battle this device sees to its end gets the next number ---------- */

const CHRONICLES_STORAGE_KEY = "warhammerClock.chronicles";
/** Where a shared report leads: the address at its foot */
const APP_URL = "https://chronicum.web.app/";
/** The brand's seal: a C that is also a dial, bone and brass (public/icon.svg without its square) */
const SEAL_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><g fill="none" stroke="#e8dfcb"><path d="M74.04 25.96 A34 34 0 1 0 74.04 74.04" stroke-width="8"/><path d="M50 22 V28 M22 50 H28 M50 72 V78" stroke-width="3"/><path d="M50 50 L74 41" stroke="#b08d57" stroke-width="5" stroke-linecap="round"/><circle cx="50" cy="50" r="5" fill="#b08d57" stroke="none"/></g></svg>`;

type Chronicles = { count: number; byStart: Record<string, number> };

function readChronicles(): Chronicles {
  try {
    const saved = JSON.parse(stored(CHRONICLES_STORAGE_KEY) ?? "null") as Chronicles | null;
    if (saved && typeof saved.count === "number" && saved.byStart) return saved;
  } catch {
    /* broken: counting starts over */
  }
  return { count: 0, byStart: {} };
}

/** This battle's number. Fixed once the battle is over, so a second export says the same; before, the one it will get */
function chronicleNo(): number {
  const chronicles = readChronicles();
  const started = clockEvents().find((event) => event.kind === "start");
  const known = started && chronicles.byStart[started.at];
  if (known) return known;
  const next = chronicles.count + 1;
  if (!started || !isOver()) return next;
  // Only the last battles are kept: an old one is not reopened
  const byStart = Object.fromEntries([...Object.entries(chronicles.byStart).slice(-19), [started.at, next]]);
  store(CHRONICLES_STORAGE_KEY, JSON.stringify({ count: next, byStart }));
  return next;
}

const chronicleTitle = (): string => t("chronicle", { n: String(chronicleNo()).padStart(3, "0") });

/** At the foot of the shared picture, kept small: the battle is what people share, not the app */
function reportSignHtml(): string {
  return `<footer class="report-sign">${SEAL_SVG}<span>${APP_URL.replace(/^https:\/\/|\/$/g, "")}</span></footer>`;
}

/* ---------- The report, on screen and as a picture ---------- */

function reportHeroHtml(title: boolean): string {
  const [total1, total2] = [scoreOf(1), scoreOf(2)];
  const winner = gameWinner();
  const events = clockEvents();
  const started = events.find((event) => event.kind === "start");
  const ended = events.filter((event) => event.kind === "end").pop();
  const date = new Date(started?.at ?? Date.now()).toLocaleDateString(getLang(), { day: "numeric", month: "short", year: "numeric" });
  const offFrom = game.clock.offFrom;
  const meta = [
    date,
    started && ended ? formatDuration((ended.at - started.at) / 1000) : "",
    `${t("round")} ${game.round}`,
    offFrom !== undefined ? t("reportUntimed", { n: offFrom }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const side = (player: Player): string => {
    const faction = factionAside(player);
    return `<div class="report-side is-p${player}"><span class="report-side__name">${t("player", { n: player })}</span>${faction ? `<span class="report-side__faction">${faction}</span>` : ""}</div>`;
  };
  const score = (player: Player): string => `<b class="is-p${player}${winner && winner !== player ? " is-behind" : ""}">${scoreOf(player)}</b>`;
  const result = `<span class="report-pill${winner ? ` is-p${winner}` : ""}">${winner ? t("wins", { n: winner }) : t("draw")}</span><span class="report-wtc">${
    // A game given up has no WTC score to read from its points
    game.concededBy ? t("reportConceded", { n: game.concededBy }) : t("reportWtc", { a: wtcPoints(total1, total2), b: wtcPoints(total2, total1) })
  }</span>`;
  return `
    <header class="report-hero${winner ? ` is-p${winner}-wins` : ""}">
      <p class="report-hero__chronicle">${chronicleTitle()}</p>
      <p class="report-hero__meta">${meta}</p>
      <div class="report-hero__score">${side(1)}<div class="report-score">${score(1)}<span>–</span>${score(2)}</div>${side(2)}</div>
      ${title ? `<h2 id="result-title" class="report-hero__result">${result}</h2>` : `<p class="report-hero__result">${result}</p>`}
    </header>`;
}

const reportLegend = (): string =>
  game.options.cards ? `<p class="report-legend"><span>• ${t("reportDrawn")}</span><span>✕ ${t("reportDiscarded")}</span></p>` : "";

/** Everything about the battle on one page: built to be read at the table and, later, shared as an image */
function renderBattleReport(): void {
  const spent = timeByRound();
  app.querySelector("#battle-report")!.innerHTML = `
    ${reportHeroHtml(true)}
    <section class="report-section" id="report-mvp">${mvpHtml()}</section>
    <section class="report-section" id="report-story"></section>
    <div class="report-players">${reportPlayer(1, spent, false)}${reportPlayer(2, spent, false)}</div>
    ${reportLegend()}`;
  renderStory();
  renderResultActions();
}

function renderResultActions(): void {
  const count = storyTurns().length;
  const button = app.querySelector<HTMLButtonElement>("#btn-result-photos")!;
  button.hidden = count === 0;
  app.querySelector("#result-photo-count")!.textContent = String(count);
}

/** The report as a picture: one player under the other at a fixed width, whatever the screen, every card shown */
async function reportImage(): Promise<Blob | null> {
  const sheet = document.createElement("div");
  sheet.className = "report-export";
  const spent = timeByRound();
  sheet.innerHTML = `<article class="report">${reportHeroHtml(false)}${mvpImageHtml()}<div class="report-players">${reportPlayer(1, spent, true)}${reportPlayer(2, spent, true)}</div>${reportLegend()}</article>${reportSignHtml()}`;
  document.body.append(sheet);
  try {
    const { toBlob } = await import("html-to-image");
    return await toBlob(sheet, {
      pixelRatio: 2,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      style: { position: "static", left: "auto" },
    });
  } finally {
    sheet.remove();
  }
}

/** The day the battle started, for file names */
const battleDay = (): string => {
  const at = new Date(clockEvents().find((event) => event.kind === "start")?.at ?? Date.now());
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
};

/** A phone opens its share sheet, a computer downloads the picture */
async function exportBattleReport(): Promise<void> {
  const button = app.querySelector<HTMLButtonElement>("#btn-result-export")!;
  button.disabled = true;
  try {
    const blob = await reportImage();
    if (!blob) return;
    const file = new File([blob], `chronicum-${String(chronicleNo()).padStart(3, "0")}-${battleDay()}.png`, { type: "image/png" });
    if (PHONE.matches && navigator.canShare?.({ files: [file] })) {
      const shared = await navigator.share({ files: [file] }).then(
        () => true,
        () => false,
      );
      if (shared) track("Récap partagé", { via: "partage" });
      return;
    }
    download(file);
    track("Récap partagé", { via: "téléchargement" });
  } catch {
    showToast(t("reportExportFailed"));
  } finally {
    button.disabled = false;
  }
}

/** Accents dropped from the name: some browsers save a download named "Déploiement" as "download" */
function download(file: File): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name.normalize("NFD").replace(/\p{M}/gu, "");
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function showResultOverlay(): void {
  renderBattleReport();
  resultOverlay.classList.add("is-visible");
  resultOverlay.setAttribute("aria-hidden", "false");
  // The result is read from the top, where the score is; OK stays at hand for Enter
  resultOverlay.querySelector(".overlay-inner")!.scrollTop = 0;
  btnResultDismiss.focus({ preventScroll: true });
  void refreshEndPhotos();
}

/** How the game is played, for the audience measure: one screen, phones, a shared screen, apart */
function playMode(): string {
  if (table) return "écran partagé";
  if (!online) return "un écran";
  if (!online.phone) return "à distance";
  return online.seats?.board ? "téléphones et écran" : "deux téléphones";
}

const cardsLabel = (): string => (!game.options.cards ? "sans" : manualDraw() ? "vrai paquet" : "app");

/** This device's battles so far, in steps: whether players come back, without knowing who they are */
function chronicleStep(n: number): string {
  if (n <= 1) return "1";
  if (n <= 5) return "2-5";
  return n <= 20 ? "6-20" : "21+";
}

function finishGameByScore(): void {
  game.phase = "over";
  stopClock(game.clock);
  logClock("end");
  // Counted once, by the device that ends the battle
  track("Partie terminée", { chronique: chronicleStep(chronicleNo()), mode: playMode(), abandon: !!game.concededBy });
  lastSpaceTime = 0;
  stopLoop();
  syncInputsFromState();
  setInputsEnabled(true);
  setActivePanels();
  updateButtons();
  setBattleMusic(false);
  playSound("victory");
  showResultOverlay();
}

function applyTurnConfirm(): void {
  if (turnConfirmKind === null) return;
  const kind = turnConfirmKind;
  hideTurnConfirmModal();
  applyConfirmed(kind);
}

function applyConfirmed(kind: TurnConfirmKind): void {
  if (kind === "deploy-end") {
    endDeployment();
    return;
  }
  if (kind === "unscore") {
    if (pendingUnscore) restoreSecondary(pendingUnscore.player, pendingUnscore.id);
    pendingUnscore = null;
    return;
  }
  if (kind === "mid-round") {
    const second = other(game.firstPlayer);
    turnSound("turn");
    game.turnPlayer = second;
    gainCpBothPlayers();
    applyAbilityCp(second, ["turn-cp"]);
    logClock("turn", { player: second });
    handClock(second);
    setActivePanels();
    if (game.options.photoBreaks) startPhotoBreak();
    startTurnSecondaries(second);
    return;
  }
  if (kind === "finish-game") {
    finishGameByScore();
    return;
  }
  if (kind === "reset") {
    // After a game over, the next one never starts in its room: in a tournament, the last opponent is still there
    if (isOver()) leaveRoom();
    reset();
    return;
  }
  advanceGameTurn();
  turnSound("round");
  if (game.options.photoBreaks) startPhotoBreak();
  startTurnSecondaries(game.firstPlayer);
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
  // Before the battle, the deployed table; then the table as each player turn left it
  const deployment = !inGame(game);
  photoOverlay.classList.toggle("is-deploy", deployment);
  photoMsg.textContent = deployment ? t("photoDeployMsg") : t("photoMsg", { n: game.turnPlayer });
  breakTurn = deployment ? DEPLOYMENT : turnJustPlayed();
  if (deployment) hideToss();
  // The last break's photo went with it as it faded out: this one starts with the camera
  showPhotoShot(null);
  photoOverlay.classList.add("is-visible");
  photoOverlay.setAttribute("aria-hidden", "false");
  btnPhotoResume.focus();
}

function endPhotoBreak(): void {
  if (!game.photoBreak) return;
  game.photoBreak = false;
  // The deployment photo is in: the battle starts
  if (!inGame(game)) {
    hidePhotoBreak();
    start();
    return;
  }
  handClock(game.clock.active);
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

/** The photo taken during this break, shown until the break ends: it is kept in the app as soon as it is taken */
let photoShotFile: File | null = null;
/** The player turn the break's photo closes: the table as that player left it */
let breakTurn: PhotoTurn | null = null;

function showPhotoShot(file: File | null): void {
  if (photoShotFile) URL.revokeObjectURL(photoShot.src);
  photoShotFile = file;
  if (file) photoShot.src = URL.createObjectURL(file);
  else photoShot.removeAttribute("src");
  photoOverlay.classList.toggle("has-shot", !!file);
}

/** The turn just over: the first player's of this round, or the second player's of the round before */
const turnJustPlayed = (): PhotoTurn => ({
  player: other(game.turnPlayer),
  round: game.turnPlayer === game.firstPlayer ? game.round - 1 : game.round,
});

async function keepPhoto(turn: PhotoTurn, file: Blob): Promise<void> {
  const gameId = game.gameId;
  if (!gameId) return;
  try {
    const photo = await savePhoto(gameId, turn, file, Date.now(), true);
    void sharePhoto(photo);
    void refreshEndPhotos();
  } catch {
    showToast(t("photoKeepFailed"), true);
  }
}

/** Taken, then left out: gone from this device and from the room */
async function dropPhoto(turn: PhotoTurn): Promise<void> {
  if (!game.gameId) return;
  await deletePhoto(game.gameId, turn);
  roomSession()?.room?.removePhoto(photoKey(game.gameId, turn));
}

const isIos = (): boolean =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/* ---------- Online: the photos go to the other devices of the room ---------- */

async function sharePhoto(photo: Photo): Promise<void> {
  const room = roomSession()?.room;
  if (!room) return;
  try {
    room.sendPhoto(photoKey(photo.game, photo), { at: photo.at, data: await shareable(photo.full) });
  } catch {
    // Too large or offline: it stays on this device
  }
}

/** A photo taken on another device of the room, or left out there */
async function receivePhoto(key: string, value: { at: number; data: string } | null): Promise<void> {
  const match = /^([a-z0-9]+)_([0-59])_([12])$/.exec(key);
  if (!match) return;
  const [, gameId, round, player] = match;
  const turn: PhotoTurn = { round: Number(round), player: player === "1" ? 1 : 2 };
  const known = await getPhoto(gameId, turn);
  if (!value) {
    // Left out during a break on the other phone. Once the game is over, the room letting its
    // photos go (the game ended online) takes nothing from this device's end screen
    if (known && !known.local && game.phase !== "over") await deletePhoto(gameId, turn);
  } else {
    // This device's own photo, back from the room, or older than the one it holds
    if (known && known.at >= value.at) return;
    try {
      await savePhoto(gameId, turn, await dataUrlToBlob(value.data), value.at, false);
    } catch {
      return;
    }
  }
  if (gameId === game.gameId) void refreshEndPhotos();
}

/* ---------- Photo viewer: to study the table, turn after turn ---------- */


function openViewer(turn: PhotoTurn): void {
  viewerTurn = turn;
  renderViewer();
  viewerOverlay.classList.add("is-visible");
  viewerOverlay.setAttribute("aria-hidden", "false");
  app.querySelector<HTMLButtonElement>("#btn-viewer-close")!.focus({ preventScroll: true });
}

function closeViewer(): void {
  viewerOverlay.classList.remove("is-visible");
  viewerOverlay.setAttribute("aria-hidden", "true");
  viewerTurn = null;
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = "";
  viewerImg.removeAttribute("src");
}

function renderViewer(): void {
  const turn = viewerTurn;
  const entry = turn && endPhotos.get(turnId(turn));
  if (!turn || !entry) return;
  const turns = storyTurns();
  const at = turns.findIndex((each) => sameTurn(each, turn));
  const final = sameTurn(turn, lastTurn());
  zoomTo(1);
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(entry.photo.full);
  viewerImg.style.opacity = "0";
  viewerImg.onload = () => (viewerImg.style.opacity = "1");
  viewerImg.src = viewerUrl;
  viewerImg.alt = shotTitle(turn);
  viewerOverlay.setAttribute("aria-label", viewerImg.alt);
  app.querySelector<HTMLElement>("#viewer")!.className = `viewer ${isDeployment(turn) ? "is-deploy" : `is-p${turn.player}`}`;
  app.querySelector("#viewer-count")!.textContent = `${at + 1} / ${turns.length}`;
  app.querySelector("#viewer-turn")!.textContent = `${shotTitle(turn)}${final ? ` · ${t("photoGameEnd")}` : ""}`;
  app.querySelector("#viewer-line")!.textContent = isDeployment(turn)
    ? t("photoDeployLine", { n: game.firstPlayer })
    : t(final ? "photoLineFinal" : "photoLine", { vp: turnPoints(turn), score: scoreAfter(turn) });
  app.querySelector("#viewer-hint")!.textContent = t(CAN_SHOOT.matches ? "photoHintTouch" : "photoHintMouse");
  app.querySelector<HTMLButtonElement>("#btn-viewer-prev")!.disabled = at <= 0;
  app.querySelector<HTMLButtonElement>("#btn-viewer-next")!.disabled = at >= turns.length - 1;
}

function stepViewer(step: number): void {
  if (!viewerTurn) return;
  const turns = storyTurns();
  const next = turns[turns.findIndex((turn) => sameTurn(turn, viewerTurn!)) + step];
  if (!next) return;
  viewerTurn = next;
  renderViewer();
}

/** The viewer's scale: the stage may be drawn at another size than its layout one */
const viewerScale = (): number => viewerStage.getBoundingClientRect().width / viewerStage.offsetWidth || 1;

/** A point of the stage, from its centre, where the photo sits when not zoomed */
function stagePoint(e: { clientX: number; clientY: number }): [number, number] {
  const rect = viewerStage.getBoundingClientRect();
  const k = viewerScale();
  return [(e.clientX - rect.left) / k - viewerStage.offsetWidth / 2, (e.clientY - rect.top) / k - viewerStage.offsetHeight / 2];
}

function applyZoom(): void {
  const mx = ((zoom.s - 1) * viewerImg.offsetWidth) / 2;
  const my = ((zoom.s - 1) * viewerImg.offsetHeight) / 2;
  zoom.x = Math.max(-mx, Math.min(mx, zoom.x));
  zoom.y = Math.max(-my, Math.min(my, zoom.y));
  viewerImg.style.transform = zoom.s === 1 ? "" : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
  viewerOverlay.classList.toggle("is-zoomed", zoom.s > 1);
  app.querySelector("#btn-viewer-zoom")!.setAttribute("aria-label", t(zoom.s > 1 ? "photoUnzoom" : "photoZoom"));
}

/** Zooms to `s`, the point (px, py) of the stage staying where it is */
function zoomTo(s: number, px = 0, py = 0): void {
  if (s <= 1) {
    Object.assign(zoom, { s: 1, x: 0, y: 0 });
  } else {
    const qx = (px - zoom.x) / zoom.s;
    const qy = (py - zoom.y) / zoom.s;
    Object.assign(zoom, { s, x: px - s * qx, y: py - s * qy });
  }
  applyZoom();
}

/** A drag moves around a zoomed photo, a swipe changes it; a double tap zooms in on that spot */
let viewerDrag: { id: number; x: number; y: number; zx: number; zy: number; moved: boolean } | null = null;
let lastTap = { at: 0, x: 0, y: 0 };
viewerStage.addEventListener("pointerdown", (e) => {
  if ((e.target as HTMLElement).closest("button")) return;
  viewerDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, moved: false };
  viewerStage.setPointerCapture(e.pointerId);
  viewerImg.classList.add("is-dragging");
});
viewerStage.addEventListener("pointermove", (e) => {
  if (!viewerDrag || e.pointerId !== viewerDrag.id) return;
  const k = viewerScale();
  const dx = (e.clientX - viewerDrag.x) / k;
  const dy = (e.clientY - viewerDrag.y) / k;
  if (Math.abs(dx) + Math.abs(dy) > 6) viewerDrag.moved = true;
  if (zoom.s > 1) {
    zoom.x = viewerDrag.zx + dx;
    zoom.y = viewerDrag.zy + dy;
    applyZoom();
  }
});
viewerStage.addEventListener("pointerup", (e) => {
  if (!viewerDrag || e.pointerId !== viewerDrag.id) return;
  const dx = (e.clientX - viewerDrag.x) / viewerScale();
  const moved = viewerDrag.moved;
  viewerDrag = null;
  viewerImg.classList.remove("is-dragging");
  if (zoom.s === 1 && Math.abs(dx) > 40) {
    stepViewer(dx < 0 ? 1 : -1);
    return;
  }
  if (moved) return;
  const now = performance.now();
  if (now - lastTap.at < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
    lastTap.at = 0;
    const [px, py] = stagePoint(e);
    zoomTo(zoom.s > 1 ? 1 : 2.5, px, py);
  } else lastTap = { at: now, x: e.clientX, y: e.clientY };
});
viewerStage.addEventListener("pointercancel", () => {
  viewerDrag = null;
  viewerImg.classList.remove("is-dragging");
});
viewerStage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const [px, py] = stagePoint(e);
    zoomTo(Math.min(4, zoom.s * (e.deltaY < 0 ? 1.2 : 1 / 1.2)), px, py);
  },
  { passive: false },
);

/* ---------- Saving the photos: to the gallery on a phone, to a folder on a computer ---------- */


const toGallery = (): boolean => CAN_SHOOT.matches || PHONE.matches;

const unsafeName = /[\\/:*?"<>|]/g;

/** A player's name in a file name: no accents nor apostrophes, which some apps and disks mangle */
const fileName = (player: Player): string =>
  t("player", { n: player })
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(unsafeName, "");

function defaultFolder(): string {
  const [a, b] = ([1, 2] as const).map(fileName);
  return `${battleDay()} ${a} vs ${b} ${scoreOf(1)}-${scoreOf(2)}`.replace(unsafeName, "");
}

const extension = (blob: Blob): string => ({ "image/png": "png", "image/heic": "heic", "image/webp": "webp" })[blob.type] ?? "jpg";

/** The photos in turn order, then the report: names that sort right in a gallery and in a folder */
function saveFiles(gallery: boolean): { name: string; blob: Blob | null }[] {
  const slots = storySlots();
  const last = lastTurn();
  const files: { name: string; blob: Blob | null }[] = storyTurns().map((turn) => {
    const blob = endPhotos.get(turnId(turn))!.photo.full;
    const final = sameTurn(turn, last) ? t("photoFileFinal") : "";
    // 00 the deployment, then 01, 02… the turns in order
    const index = String(slots.findIndex((each) => sameTurn(each, turn))).padStart(2, "0");
    const what = isDeployment(turn) ? t("photoFileDeploy") : "";
    const name = gallery
      ? `WH ${battleDay()} ${what || `R${turn.round} ${fileName(turn.player)}${final ? ` ${final}` : ""}`}`
      : `${index} ${what || `${t("photoFileTurn", { r: turn.round, name: fileName(turn.player) })}${final ? ` (${final})` : ""}`}`;
    return { name: `${name}.${extension(blob)}`, blob };
  });
  if (saveWithReport && saveReport.state !== "failed") {
    files.push({ name: gallery ? `WH ${battleDay()} ${t("photoFileReport")}.png` : `${t("photoFileReport")}.png`, blob: saveReport.blob });
  }
  return files;
}

function openSave(): void {
  if (storyTurns().length === 0) {
    showToast(t("photosNone"));
    return;
  }
  saveStep = "form";
  saveFolder = defaultFolder();
  saveReport = { state: "pending", blob: null };
  const making = saveReport;
  reportImage()
    .then((blob) => Object.assign(making, blob ? { state: "ready", blob } : { state: "failed" }))
    .catch(() => Object.assign(making, { state: "failed" }))
    .finally(() => {
      if (making === saveReport && saveOverlay.classList.contains("is-visible") && saveStep === "form") renderSaveSheet();
    });
  renderSaveSheet();
  saveOverlay.classList.add("is-visible");
  saveOverlay.setAttribute("aria-hidden", "false");
  saveSheet.querySelector<HTMLButtonElement>(".btn-primary")?.focus({ preventScroll: true });
}

function closeSave(): void {
  saveOverlay.classList.remove("is-visible");
  saveOverlay.setAttribute("aria-hidden", "true");
}

function renderSaveSheet(): void {
  const gallery = toGallery();
  if (saveStep === "writing") {
    saveSheet.innerHTML = `<h2 id="save-title">${t("photosComputerTitle")}</h2><div class="save-progress"><i id="save-bar"></i></div><p class="save-mono" id="save-progress-text"></p>`;
    return;
  }
  if (saveStep === "done") {
    saveSheet.innerHTML = `
      <span class="save-done">${ICON_CHECK}</span>
      <h2 id="save-title">${t("photosDone")}</h2>
      <p class="save-path">${esc(saveDone.path)}</p>
      <p class="overlay-msg">${t(saveWithReport && saveReport.state === "ready" ? "photosDoneMsgReport" : "photosDoneMsg", { n: saveDone.count })}</p>
      <div class="overlay-actions"><button type="button" class="btn-primary" data-save="close">${t("done")}</button></div>`;
    return;
  }
  const files = saveFiles(gallery);
  const waiting = saveWithReport && saveReport.state === "pending";
  const missingFinal = CAN_SHOOT.matches && !endPhotos.has(turnId(lastTurn()));
  const reportBox = `<label class="save-check"><input type="checkbox" id="save-report"${saveWithReport ? " checked" : ""} /><span>${t("photosAddReport")}</span></label>`;
  const finalNotice = missingFinal
    ? `<div class="save-notice">${ICON_CAMERA}<span>${t("photosFinalMissing")}</span><button type="button" class="btn-secondary" data-save="final">${t("photosTakeIt")}</button></div>`
    : "";
  const actions = (go: string): string =>
    `<div class="overlay-actions"><button type="button" class="btn-secondary" data-save="close"><span>${t("cancel")}</span> <kbd>${t("keyEsc")}</kbd></button>${go}</div>`;
  if (gallery) {
    const names = files.length > 2 ? [files[0].name, "…", files[files.length - 1].name] : files.map((file) => file.name);
    saveSheet.innerHTML = `
      <h2 id="save-title">${t("photosGalleryTitle")}</h2>
      <p class="overlay-msg">${t("photosGalleryMsg")}</p>
      <div class="save-grid">${storyTurns().map((turn) => `<img src="${endPhotos.get(turnId(turn))!.thumb}" alt="" />`).join("")}</div>
      ${finalNotice}
      ${reportBox}
      <p class="save-names">${names.map(esc).join("<br />")}</p>
      <p class="save-note">${t("photosGalleryNote")}</p>
      ${actions(`<button type="button" class="btn-primary" data-save="gallery"${waiting ? " disabled" : ""}>${ICON_DOWNLOAD}<span>${t("photosSaveN", { n: files.length })}</span></button>`)}`;
    return;
  }
  saveSheet.innerHTML = `
    <h2 id="save-title">${t("photosComputerTitle")}</h2>
    <p class="overlay-msg">${t("photosComputerMsg")}</p>
    <label class="save-field"><span>${t("photosFolder")}</span><input type="text" id="save-folder" value="${esc(saveFolder)}" autocomplete="off" spellcheck="false" /></label>
    <div class="save-tree"><div class="save-tree__dir">${ICON_FOLDER}<span id="save-tree-name">${esc(saveFolder)}</span></div><ul>${files.map((file) => `<li>${esc(file.name)}</li>`).join("")}</ul></div>
    ${reportBox}
    <p class="save-note">${t("photosComputerNote")}</p>
    ${actions(`<button type="button" class="btn-primary" data-save="computer"${waiting ? " disabled" : ""}>${ICON_FOLDER_DOWN}<span>${t("photosChoose")}</span></button>`)}`;
}

/** Right on the tap: the iPhone opens its share sheet only then. Elsewhere each file is downloaded */
function saveToGallery(): void {
  const files = saveFiles(true)
    .filter((file): file is { name: string; blob: Blob } => !!file.blob)
    .map(({ name, blob }) => new File([blob], name, { type: blob.type || "image/jpeg" }));
  const saved = (): void => {
    closeSave();
    showToast(t("photosSaved", { n: files.length }), true);
  };
  if (isIos() && navigator.canShare?.({ files })) {
    navigator.share({ files }).then(saved, () => undefined);
    return;
  }
  files.forEach((file, i) => window.setTimeout(() => download(file), i * 400));
  saved();
}

type DirectoryPicker = (options?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }) => Promise<FileSystemDirectoryHandle>;

/** Chrome and Edge write a folder where the player says; the others download it as a .zip */
async function saveToComputer(): Promise<void> {
  const name = saveFolder.replace(unsafeName, "").trim() || defaultFolder();
  const files = saveFiles(false).filter((file): file is { name: string; blob: Blob } => !!file.blob);
  const pick = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  try {
    if (!pick) {
      const { zipFolder } = await import("./zip");
      download(new File([await zipFolder(name, files)], `${name}.zip`, { type: "application/zip" }));
      closeSave();
      showToast(t("photosZipped", { name: `${name}.zip` }), true);
      return;
    }
    let parent: FileSystemDirectoryHandle;
    try {
      parent = await pick({ id: "warhammer-clock-photos", mode: "readwrite", startIn: "pictures" });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return;
      throw error;
    }
    saveStep = "writing";
    renderSaveSheet();
    const folder = await parent.getDirectoryHandle(name, { create: true });
    for (const [i, file] of files.entries()) {
      saveSheet.querySelector<HTMLElement>("#save-bar")!.style.width = `${(i / files.length) * 100}%`;
      saveSheet.querySelector("#save-progress-text")!.textContent = `${t("photosWriting", { k: i + 1, n: files.length })} ${file.name}`;
      const writable = await (await folder.getFileHandle(file.name, { create: true })).createWritable();
      await writable.write(file.blob);
      await writable.close();
    }
    saveDone = { count: files.length, path: `${parent.name} / ${name}` };
    saveStep = "done";
    renderSaveSheet();
    saveSheet.querySelector<HTMLButtonElement>(".btn-primary")?.focus({ preventScroll: true });
  } catch {
    saveStep = "form";
    renderSaveSheet();
    showToast(t("photosFailed"), true);
  }
}

saveOverlay.addEventListener("click", (e) => {
  if (e.target === saveOverlay && saveStep !== "writing") {
    closeSave();
    return;
  }
  const action = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-save]")?.dataset.save;
  if (action === "close") closeSave();
  else if (action === "gallery") saveToGallery();
  else if (action === "computer") void saveToComputer();
  else if (action === "final") {
    closeSave();
    finalPhotoInput.click();
  }
});
saveOverlay.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id !== "save-folder") return;
  saveFolder = input.value;
  saveSheet.querySelector("#save-tree-name")!.textContent = input.value.replace(unsafeName, "").trim() || defaultFolder();
});
saveOverlay.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id !== "save-report") return;
  saveWithReport = input.checked;
  renderSaveSheet();
  saveSheet.querySelector<HTMLInputElement>("#save-report")?.focus();
});

function readMinutes(): number {
  return Math.max(0, Number(minutesInput.value) || 0);
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
const POPOVERS: [HTMLButtonElement, HTMLElement][] = [
  [btnSettings, settingsPanel],
  [seatSettings, settingsPanel],
  [stripSettings, settingsPanel],
];

/**
 * The time choices unfold over the bar on hover (or keyboard focus). Once a time is
 * picked they fold back, until the mouse leaves and comes back.
 */
function foldTimePicker(): void {
  timePicker.classList.add("is-folded");
  timePicker.classList.remove("is-open");
  if (timePicker.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
}

/** On a phone the menu is a sheet: it slides back down before it hides (style.css) */
const SHEET = window.matchMedia("(max-width: 640px)");
const SHEET_CLOSE_MS = 180;

function hidePanel(panel: HTMLElement): void {
  if (panel.hidden || panel.classList.contains("is-closing")) return;
  if (!SHEET.matches || prefersReducedMotion()) {
    panel.hidden = true;
    return;
  }
  panel.classList.add("is-closing");
  window.setTimeout(() => {
    // Opened again while it was sliding down: it stays
    if (!panel.classList.contains("is-closing")) return;
    panel.classList.remove("is-closing");
    panel.hidden = true;
  }, SHEET_CLOSE_MS);
}

function closePopovers(): void {
  closePicker();
  stopMusicPreview();
  timePicker.classList.remove("is-open");
  for (const [button, panel] of POPOVERS) {
    hidePanel(panel);
    button.setAttribute("aria-expanded", "false");
  }
}

function togglePopover(button: HTMLButtonElement, panel: HTMLElement): void {
  const open = panel.hidden || panel.classList.contains("is-closing");
  closePopovers();
  if (!open) return;
  panel.classList.remove("is-closing");
  panel.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

const UI_SIZES = new Set(["auto", "s", "m", "l"]);
const LAYOUTS = new Set(["auto", "rows", "columns"]);
/** The layout picked in the menu: "auto" follows the screen */
let layoutPref = LAYOUT_DEFAULT;

/**
 * Auto: the board follows the screen it is on, a laptop as an ultrawide, and again when the
 * window moves from one to the other. A size or a layout picked by hand stays as it is
 */
function fitScreen(): void {
  const root = document.documentElement;
  const { innerWidth: w, innerHeight: h } = window;
  if (root.dataset.uiSize === "auto") {
    // By the screen's area, never under Standard (a laptop's window would get less) unless the
    // screen can't hold it; up to Ultra wide on a 3440 px ultrawide. Neither side may overflow. A
    // player's phone is read at arm's length on the table: its dialogs and cards a size larger. A
    // phone showing the board keeps the size its screens were drawn for
    const standard = 1.12;
    const fits = Math.min(h / 560, w / 1100);
    const scale = PHONE.matches
      ? root.dataset.seat
        ? 1.25
        : standard
      : Math.max(0.86, Math.min(Math.max(Math.sqrt(w * h) / 1020, standard), fits, 2.12));
    root.style.setProperty("--ui-scale", scale.toFixed(3));
  } else root.style.removeProperty("--ui-scale");
  // The players side by side on any landscape screen, a laptop as an ultrawide or a phone turned
  // sideways. One above the other only when the screen is about square or upright: side by side
  // there, each clock would get a narrow strip and leave the height empty
  if (layoutPref === "auto") root.dataset.layout = w / h >= 1.2 ? "columns" : "rows";
  renderMe();
}

window.addEventListener("resize", fitScreen);

/**
 * A player's PC shows the whole board: its own side marked, the opponent's to read, and turned so
 * its own side is the nearest one, at the bottom or on the left
 */
function renderMe(): void {
  const root = document.documentElement;
  const me = online && !online.phone ? online.seat : null;
  if (me) root.dataset.me = String(me);
  else delete root.dataset.me;
  root.toggleAttribute("data-flip", me !== null && (root.dataset.layout === "columns" ? me === 2 : me === 1));
  renderFactionRows();
}
/**
 * On <html> for the player colors used everywhere, on each panel for its own decor (none before
 * an army is picked). Two sides too close in color: one takes another (see sideLooks)
 */
function applyFactionLooks(): void {
  const looks = sideLooks(factionOf(1), factionOf(2));
  const root = document.documentElement.style;
  for (const player of [1, 2] as const) {
    const faction = factionOf(player);
    const look = looks[player];
    const panel = player === 1 ? panel1 : panel2;
    root.setProperty(`--fx${player}`, look.color);
    root.setProperty(`--fx${player}-time`, look.time);
    if (!faction) {
      delete panel.dataset.band;
      delete panel.dataset.texture;
      panel.style.removeProperty("--fx-a");
      panel.style.removeProperty("--fx-b");
      continue;
    }
    panel.dataset.band = faction.band;
    panel.dataset.texture = faction.texture;
    panel.style.setProperty("--fx-a", look.color);
    panel.style.setProperty("--fx-b", look.accent ?? faction.accent);
  }
}

/** A player picks their army: on their own phone, or for both on a shared screen */
function setFaction(player: Player, id: string): void {
  if (!canEdit(player) || !FACTION_BY_ID.has(id)) return;
  game.factions = { ...game.factions, [player]: id };
  // Remembered for the next game: a player's own army on their device, both sides on a screen
  store(online ? MY_ARMY_STORAGE_KEY : factionStorageKey(player), id);
  renderFactions();
}

/** The players sat the other way round: each keeps their army, the sides trade them */
function swapFactions(): void {
  if (online) return;
  closePicker();
  game.factions = { 1: game.factions[2], 2: game.factions[1] };
  for (const player of [1, 2] as const) {
    const id = game.factions[player];
    if (id) store(factionStorageKey(player), id);
    else forget(factionStorageKey(player));
  }
  renderFactions();
}

/** A screen's last two armies, for its next game */
function loadFactions(): void {
  for (const player of [1, 2] as const) {
    const id = stored(factionStorageKey(player));
    game.factions[player] = id && FACTION_BY_ID.has(id) ? id : null;
  }
  renderFactions();
}

/** A player's device in a game brings the army they picked last time, until they pick another */
function claimArmy(): void {
  if (!online?.room || synced.rev === 0 || game.factions[online.seat]) return;
  const mine = stored(MY_ARMY_STORAGE_KEY);
  if (!mine || !FACTION_BY_ID.has(mine)) return;
  game.factions = { ...game.factions, [online.seat]: mine };
  renderFactions();
  void pushState();
}

let namedFactions = "";

/** The armies on screen: colors, decor, the lists, and the players' names wherever they show */
function renderFactions(): void {
  applyFactionLooks();
  showFactionChoice(1);
  showFactionChoice(2);
  renderFactionRows();
  const named = JSON.stringify(game.factions);
  if (named === namedFactions) return;
  namedFactions = named;
  // Every text naming a player says it anew
  applyLang(getLang());
}

/**
 * Each army list says whose it is: on a phone, the player's own; on a screen, the side of the board
 * it colors (a player's PC turns the board its own way). Online, a device picks its player's only
 */
function renderFactionRows(): void {
  const root = document.documentElement;
  const columns = root.dataset.layout === "columns";
  const flipped = root.hasAttribute("data-flip");
  for (const player of [1, 2] as const) {
    const own = phoneView() && online?.seat === player;
    const first = (player === 1) !== flipped;
    factionSide[player].textContent = t(own ? "yourArmy" : columns ? (first ? "sideLeft" : "sideRight") : first ? "sideTop" : "sideBottom");
    for (const picker of [factionPickerEl[player], chapterPickerEl[player]]) {
      picker.querySelector<HTMLButtonElement>(".picker__button")!.disabled = !canEdit(player);
    }
  }
  app.querySelector<HTMLElement>("#faction-swap")!.hidden = !!online;
}

/** A chapter shows as Space Marines in the first list, the chapter itself in the second */
function showFactionChoice(player: Player): void {
  const faction = factionOf(player);
  factionRow[player].classList.toggle("is-empty", !faction);
  chapterWrap[player].hidden = !faction?.chapter;
  if (!faction) {
    setPickerValue(factionPickerEl[player], { label: t("pickArmy"), color: "var(--faint)", accent: "var(--faint)" });
    return;
  }
  setPickerValue(factionPickerEl[player], { ...faction, label: (faction.chapter ? SPACE_MARINES_NAME : faction.name)[getLang()] });
  setPickerValue(chapterPickerEl[player], { ...faction, label: faction.name[getLang()] });
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
    selected: () => (factionOf(player)?.chapter ? SPACE_MARINES : (game.factions[player] ?? "")),
    pick: (value: string) => {
      // Space Marines again keeps the chapter already chosen
      if (value === SPACE_MARINES && factionOf(player)?.chapter) return;
      setFaction(player, value === SPACE_MARINES ? DEFAULT_CHAPTER : value);
    },
  },
  {
    root: chapterPickerEl[player],
    groups: chapterGroups,
    selected: () => game.factions[player] ?? "",
    pick: (value: string) => setFaction(player, value),
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

function setPickerValue(root: HTMLElement, value: { label: string; color: string; accent: string }): void {
  root.querySelector(".picker__label")!.textContent = value.label;
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

/** Set on <html> so the tooltips, appended to <body>, scale too */
function applyUiSize(size: string): void {
  // XL and Ultra wide are gone: a screen set to one keeps the largest size left
  const v = UI_SIZES.has(size) ? size : size === "xl" || size === "uw" ? "l" : UI_SIZE_DEFAULT;
  document.documentElement.dataset.uiSize = v;
  setSegmentedValue(uiSizeOptions, v);
  try {
    localStorage.setItem(UI_SIZE_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
  fitScreen();
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

function applySounds(value: string, remember = true): void {
  const on = value === "on";
  setSoundsOn(on);
  sfxToggle.checked = on;
  if (remember) store(SFX_STORAGE_KEY, on ? "on" : "off");
  renderSeatSound();
}

/** A phone's speaker button says whether it is heard: effects on and not muted. Silent, a tap brings the sound */
function renderSeatSound(): void {
  const heard = sfxToggle.checked && !isMuted();
  seatMute.innerHTML = heard ? ICON_SOUND : ICON_MUTED;
  seatMute.setAttribute("aria-pressed", String(!heard));
}

function applyMusic(value: string): void {
  const track = MUSIC_TRACKS.find((name) => name === value) ?? "off";
  setMusic(track);
  setSegmentedValue(musicOptions, track);
  store(MUSIC_STORAGE_KEY, track);
  renderMusicHere();
}

let musicPlaysElsewhere = false;

/** With the shared screen in the room the music plays there: the phone keeps no control for it */
function setMusicHere(elsewhere: boolean): void {
  musicPlaysElsewhere = elsewhere;
  setMusicElsewhere(elsewhere);
  renderMusicHere();
}

function renderMusicHere(): void {
  musicOptions.closest<HTMLElement>(".settings-row")!.hidden = musicPlaysElsewhere;
  musicElsewhereNote.hidden = !musicPlaysElsewhere;
  seatMusic.hidden = musicPlaysElsewhere || musicOptions.querySelector('[aria-pressed="true"]')?.getAttribute("data-value") === "off";
}

function applyMusicMuted(value: boolean): void {
  setMusicMuted(value);
  seatMusic.innerHTML = value ? ICON_MUSIC_OFF : ICON_MUSIC;
  seatMusic.setAttribute("aria-pressed", String(value));
}

function applyVolume(value: number): void {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : VOLUME_DEFAULT;
  setVolume(v / 100);
  volumeInput.value = String(v);
  volumeInput.style.setProperty("--fill", `${v}%`);
  store(VOLUME_STORAGE_KEY, String(v));
}

function loadSound(): void {
  // A phone is its player's own device: its sound effects are on until they turn them off. The
  // old setting was saved even when nobody chose it, so only an "on" from it counts
  const legacy = stored(SOUNDS_STORAGE_KEY) === "on" ? "on" : null;
  applySounds(stored(SFX_STORAGE_KEY) ?? legacy ?? (PHONE.matches ? "on" : "off"), false);
  applyVolume(Number(stored(VOLUME_STORAGE_KEY) ?? VOLUME_DEFAULT));
  applyMusic(stored(MUSIC_STORAGE_KEY) ?? "off");
}

let soundToastTimer = 0;

/** A short line at the bottom of the screen */
/** An important toast holds the screen a little longer: one coming meanwhile, or showing already, follows it */
let toastHeldUntil = 0;
let toastNext: string | null = null;

/**
 * A phone in its player's hand also buzzes at the game's big moments, heard or not. A page may
 * only vibrate once it was tapped, and never on an iPhone
 */
function buzz(pattern: number | number[]): void {
  if (online?.phone) navigator.vibrate?.(pattern);
}

function showToast(text: string, important = false): void {
  const now = performance.now();
  if (!important && now < toastHeldUntil) {
    toastNext = text;
    return;
  }
  if (important && soundToast.classList.contains("is-visible")) toastNext = soundToast.textContent;
  const ms = important ? 2600 : 1400;
  if (important) toastHeldUntil = now + ms;
  soundToast.textContent = text;
  soundToast.classList.add("is-visible");
  window.clearTimeout(soundToastTimer);
  soundToastTimer = window.setTimeout(() => {
    soundToast.classList.remove("is-visible");
    const next = toastNext;
    toastNext = null;
    if (next) window.setTimeout(() => showToast(next), 250);
  }, ms);
}

function toggleMute(): void {
  setMuted(!isMuted());
  showToast(t(isMuted() ? "soundMuted" : "soundOn"));
  renderSeatSound();
}

function toggleMusicMute(): void {
  applyMusicMuted(!isMusicMuted());
  showToast(t(isMusicMuted() ? "musicMuted" : "musicOn"));
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

/** `remember`: picked in the menu. Otherwise the browser's language is followed, wherever it changes */
function applyLang(value: string, remember = false): void {
  setLang(isLang(value) ? value : "en");
  setSegmentedValue(langOptions, getLang());
  if (remember) store(LANG_STORAGE_KEY, getLang());
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
  renderMe();
  renderSeat();
  renderOnlineDialog();
  renderJudgeCall();
  renderEvent();
  if (eventOverlay.classList.contains("is-visible")) renderEventSetup();
  if (tossOverlay.classList.contains("is-visible")) renderToss();
  if (logOverlay.classList.contains("is-visible")) renderClockLog();
  if (resultOverlay.classList.contains("is-visible")) renderBattleReport();
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
  layoutPref = v;
  if (v !== "auto") document.documentElement.dataset.layout = v;
  setSegmentedValue(layoutOptions, v);
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, v);
  } catch {
    /* quota / private mode */
  }
  fitScreen();
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
  minutesInput.value = String(min);
  game.clock.left = { 1: totalSeconds, 2: totalSeconds };
  applyTimesToDisplay();
  syncPresetSelectFromState();
}

/**
 * The time set, as the room has it. Only before the game: once it starts the clocks hold the time
 * left, and a new game starts again from the time set, not from what was left of the last one
 */
function syncInputsFromState(): void {
  if (inGame(game) || inPreBattle()) return;
  minutesInput.value = String(Math.round(timeLeft(1) / 60));
}

/** The hour digit is dimmed under an hour, like an unlit segment; a clock out of time reads in full */
function renderTime(el: HTMLElement, totalSeconds: number): void {
  const [h, m, s] = formatTime(totalSeconds).split(":");
  el.innerHTML = `<span class="time__h${h === "0" && totalSeconds > 0 ? " is-zero" : ""}">${h}:</span>${m}:${s}`;
}

function applyTimesToDisplay(): void {
  renderTime(t1, timeLeft(1));
  renderTime(t2, timeLeft(2));
  renderSeatTimes();
}

function setActivePanels(): void {
  // The clock out of time has been handed over, here or on another device
  if (timeOutPlayer !== null && (game.clock.active !== timeOutPlayer || timeLeft(timeOutPlayer) > 0 || !inGame(game))) hideTimeOut();
  panel1.classList.toggle("is-flag", inGame(game) && timeLeft(1) <= 0);
  panel2.classList.toggle("is-flag", inGame(game) && timeLeft(2) <= 0);
  if (isDeploying()) {
    const deployer = game.clock.active;
    for (const [player, panel] of [[1, panel1], [2, panel2]] as const) {
      panel.classList.toggle("is-active", player === deployer);
      panel.classList.toggle("is-idle", player !== deployer);
      panel.classList.toggle("is-turn", player === deployer);
    }
    renderSeat();
    return;
  }
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
  // What a tournament's organiser imposes stays as set: the players read it, they don't change it
  const locks = eventLocks();
  btnTime.disabled = !on || locks.time;
  minutesInput.disabled = !on || locks.time;
  photoBreaksToggle.disabled = !on || locks.photoBreaks;
  deployClockToggle.disabled = !on || locks.deployClock;
  cardsSourcePicker.querySelectorAll<HTMLButtonElement>(".segmented__option").forEach((option) => {
    option.disabled = !on || locks.cards;
  });
  cardsSourcePicker.classList.toggle("is-locked", locks.cards);
}

/* ---------- Where the secondaries come from: none, drawn by the app, each player's own deck ---------- */

function cardsSource(): CardsSource {
  if (!game.options.cards) return "off";
  return manualDraw() ? "deck" : "app";
}

function setCardsSource(source: CardsSource): void {
  game.options.cards = source !== "off";
  game.options.manualDraw = source === "deck";
  renderCardsSource();
  renderHandButtons();
}

function renderCardsSource(): void {
  setSegmentedValue(cardsSourcePicker, cardsSource());
}

/* ---------- Tournaments: the settings of the organiser's QR code ---------- */

const eventLocked = (): boolean => !!game.options.event;
/** Only a judge call stops the clocks: no pause from the players */
const pauseLocked = (): boolean => game.options.event?.judgeOnlyPause === true;

const NOTHING_LOCKED: EventLocks = { time: false, cards: false, photoBreaks: false, deployClock: false };
/** A game set before the organiser could leave settings free: everything was imposed */
const eventLocks = (): EventLocks => (game.options.event ? (game.options.event.locked ?? ALL_LOCKED) : NOTHING_LOCKED);

type EventRules = Pick<EventPreset, "seconds" | "cards" | "manualDraw" | "photoBreaks" | "deployClock" | "judgeOnlyPause" | "locked">;

/**
 * "1h25 per player · players' decks · pause by the judge only · photo breaks, deployment clock:
 * players' choice": what is imposed, then what is left to the players
 */
function eventRules(rules: EventRules): string {
  const imposed = [
    rules.locked.time ? t("eventPerPlayer", { time: formatDuration(rules.seconds) }) : "",
    rules.locked.cards ? (rules.cards ? t(rules.manualDraw ? "eventRealDeck" : "eventAppDraw") : t("eventNoCards")) : "",
    rules.locked.photoBreaks ? (rules.photoBreaks ? t("eventPhotoBreaks") : t("eventNoPhotoBreaks")) : "",
    rules.locked.deployClock ? (rules.deployClock ? t("eventTimedDeploy") : t("eventUntimedDeploy")) : "",
    rules.judgeOnlyPause ? t("eventJudgeOnly") : "",
  ];
  const free = [
    rules.locked.time ? "" : t("eventFreeTime"),
    rules.locked.cards ? "" : t("eventFreeCards"),
    rules.locked.photoBreaks ? "" : t("eventPhotoBreaks"),
    rules.locked.deployClock ? "" : t("eventFreeDeploy"),
  ].filter(Boolean);
  return [...imposed, free.length > 0 ? t("eventPlayersChoice", { list: free.join(", ") }) : ""].filter(Boolean).join(" · ");
}

/** The rules of the game on the board, for the chip's tooltip */
const boardRules = (): EventRules => ({
  seconds: timeLeft(1),
  cards: game.options.cards,
  manualDraw: manualDraw(),
  photoBreaks: game.options.photoBreaks,
  deployClock: deploymentTimed(),
  judgeOnlyPause: pauseLocked(),
  locked: eventLocks(),
});

/**
 * The organiser's link opened: the game takes the tournament's settings, the imposed ones locked,
 * the others only a start. Music and sounds follow the organiser's suggestion on this device; the
 * language stays the player's
 */
function joinEvent(preset: EventPreset): void {
  if (inGame(game) || inPreBattle()) return;
  game.options = {
    ...game.options,
    photoBreaks: preset.photoBreaks,
    cards: preset.cards,
    manualDraw: preset.manualDraw,
    deployClock: preset.deployClock,
    event: { name: preset.name, judgeOnlyPause: preset.judgeOnlyPause, locked: preset.locked },
  };
  photoBreaksToggle.checked = preset.photoBreaks;
  deployClockToggle.checked = preset.deployClock;
  applyPresetSeconds(preset.seconds);
  if (preset.musicOff) applyMusic("off");
  if (preset.soundsOn) applySounds("on");
  renderEvent();
  renderHandButtons();
  showToast(t("eventApplied", { name: preset.name || t("eventUnnamed") }));
}

/** Back to a free game, before it starts: every device of the room sees the chip go */
function leaveEvent(): void {
  if (!eventLocked() || inGame(game) || inPreBattle()) return;
  delete game.options.event;
  renderEvent();
}

/** A small chip in the setup bar: the tournament's name, its rules on hover, a cross to leave it */
function renderEvent(): void {
  const event = game.options.event;
  eventBadge.hidden = !event;
  if (event) {
    app.querySelector<HTMLElement>("#event-badge-name")!.textContent = event.name || t("eventUnnamed");
    eventBadge.title = `${t("eventLockedBy")} · ${eventRules(boardRules())}`;
  }
  eventLeaveBtn.hidden = inGame(game) || inPreBattle();
  renderCardsSource();
  setInputsEnabled(!isRunning() && !inPreBattle());
  renderKeyHint();
}

function renderKeyHint(): void {
  const enter = `<kbd>${t("keyEnter")}</kbd>`;
  const space = `<kbd>${t("keySpace")}</kbd>`;
  const sep = '<span class="key-hint__sep"></span>';
  const judge = ` ${sep} <kbd>${JUDGE_KEY}</kbd> ${t("hintJudge")}`;
  if (isDeploying()) {
    keyHint.innerHTML = `${space} ${t("hintDeployPass")} ${sep} ${enter} ${t("hintDeployDone")}`;
  } else if (isRunning()) {
    const hand = secondaryCardsOn()
      ? ` ${sep} <kbd>${HAND_KEY}</kbd> ${t("hintHand")} <kbd>${PRIMARY_KEY}</kbd> ${t("hintPrimary")}`
      : "";
    const off = untimed() ? `<span class="key-hint__status">${t("untimedBadge")}</span> ` : "";
    // A tournament where only the judge stops the clocks: no pause to offer
    const pauseHint = pauseLocked() ? "" : ` ${sep} ${space}${space} ${t("hintPause")}`;
    keyHint.innerHTML = `${off}${enter} ${t("hintEndTurn")} ${sep} ${space} ${t("hintSwitch")}${pauseHint}${hand}${judge}`;
  } else if (isOver()) {
    keyHint.innerHTML = `<span class="key-hint__status">${t("gameOver")}</span> ${t("hintPlayAgain")}`;
  } else if (isStopped(game)) {
    keyHint.innerHTML = `<span class="key-hint__status">${t("paused")}</span> ${space} ${t("hintResume")}${judge}`;
  } else {
    keyHint.innerHTML = `${enter} ${t("hintStart")}`;
  }
}

function updateButtons(): void {
  /* Start / pause are keyboard-driven only (Enter / Space / double-space). */
  app.classList.toggle("match-started", inGame(game));
  app.classList.toggle("is-paused", game.phase === "paused");
  app.classList.toggle("is-game-over", isOver());
  btnJudge.hidden = !inGame(game) || isOver();
  app.classList.toggle("is-deploying", isDeploying());
  app.classList.toggle("is-pre-battle", inPreBattle());
  app.classList.toggle("is-untimed", untimed() && !isOver());
  renderResetLabels();
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

/** Rings the warnings and stops the running clock when it is out. Returns true if it stopped */
function checkClock(): boolean {
  const player = game.clock.active;
  const left = timeLeft(player);
  warnIfLow(lastSeenLeft[player], left);
  lastSeenLeft[player] = left;
  if (left > 0) return false;
  clockOut(player);
  return true;
}

/**
 * A clock reaches zero and stays there: the game goes on, that player only rolling saves and
 * tests and scoring what they hold, as most tournaments rule. Players who play loss on time
 * stop on this screen
 */
function clockOut(player: Player): void {
  stopClock(game.clock);
  game.clock.left[player] = 0;
  // Online, both phones see it reach zero: one line is enough
  if (!loggedLately("timeOut", player)) logClock("timeOut", { player });
  stopLoop();
  applyTimesToDisplay();
  setActivePanels();
  showTimeOut(player);
}

/** The player out of time, while the screen says so */
let timeOutPlayer: Player | null = null;

/**
 * Out of time: the knell tolls, the dead clock slams down and the screen asks to hand the clock
 * over, for good. Online, the device of the player out of time hands it; the others are told
 */
function showTimeOut(player: Player): void {
  timeOutPlayer = player;
  const handsOver = !online || online.seat === player;
  timeOutOverlay.classList.remove("is-p1", "is-p2", "is-striking");
  timeOutOverlay.classList.add(`is-p${player}`);
  app.querySelector("#time-out-who")!.textContent = t("player", { n: player });
  app.querySelector("#time-out-msg")!.textContent = handsOver ? t("timeOutRule") : t("timeOutHanded", { n: player });
  btnTimeOut.querySelector("span")!.textContent = handsOver ? t("timeOutPass", { n: other(player) }) : t("ok");
  timeOutOverlay.style.setProperty("--hit-at", `${(playSound("timeOut") ?? 0) + TIME_OUT_HIT_SEC}s`);
  if (online?.seat === player) buzz([300, 120, 300, 120, 300]);
  // Replayed from the start, even for a second clock out in the same game
  void timeOutOverlay.offsetWidth;
  timeOutOverlay.classList.add("is-visible", "is-striking");
  timeOutOverlay.setAttribute("aria-hidden", "false");
  btnTimeOut.focus();
}

function hideTimeOut(): void {
  timeOutPlayer = null;
  timeOutOverlay.classList.remove("is-visible");
  timeOutOverlay.setAttribute("aria-hidden", "true");
  btnTimeOut.blur();
}

btnTimeOut.addEventListener("click", () => {
  const player = timeOutPlayer;
  hideTimeOut();
  if (player === null || (online && online.seat !== player) || game.clock.active !== player) return;
  // A plain handover, never taken for the second tap of a double tap that pauses
  lastSpaceTime = 0;
  handleSpaceLikeInput();
});

/**
 * The clock goes to `player`. It runs if the game does, unless the clocks are frozen; a clock
 * at zero stays there until it is passed on
 */
function handClock(player: Player): void {
  setActiveClock(game.clock, player);
  if (!isRunning() || game.photoBreak || game.judgeCall !== null) return;
  if (timeLeft(player) <= 0) {
    stopClock(game.clock);
    return;
  }
  if (game.clock.since !== null) return;
  runClock(game.clock);
  startLoop();
}

/* ---------- Clock log and judge calls ---------- */

function logClock(kind: ClockEventKind, details: { player?: Player; seconds?: number } = {}): string {
  const at = nowMs();
  const key = `${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const left = { 1: Math.floor(Math.max(0, timeLeft(1))), 2: Math.floor(Math.max(0, timeLeft(2))) };
  game.clockLog[key] = { at, kind, round: game.round, ...details, left };
  return key;
}

const clockEvents = (): ClockEvent[] => Object.values(game.clockLog).sort((a, b) => a.at - b.at);

const loggedLately = (kind: ClockEventKind, player: Player): boolean =>
  Object.values(game.clockLog).some((event) => event.kind === kind && event.player === player && nowMs() - event.at < 5000);

/** A short span: 4:05, or 1:02:30 past an hour */
function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s >= 3600 ? formatTime(s) : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const formatDelta = (seconds: number): string => `${seconds > 0 ? "+" : "−"}${formatSpan(Math.abs(seconds))}`;

const LOG_TEXT: Record<ClockEventKind, (event: ClockEvent) => string> = {
  chooser: ({ player }) => t("logChooser", { n: player ?? "" }),
  deploy: ({ player }) => t("logDeploy", { n: player ?? "" }),
  deployEnd: () => t("logDeployEnd"),
  first: ({ player }) => t("logFirst", { n: player ?? "" }),
  start: () => t("logStart"),
  switch: ({ player }) => t("logSwitch", { n: player ?? "" }),
  turn: ({ player }) => t("logTurn", { n: player ?? "" }),
  pause: () => t("logPause"),
  resume: () => t("logResume"),
  judge: () => t("logJudge"),
  judgeEnd: ({ seconds }) => t("logJudgeEnd", { time: formatSpan(seconds ?? 0) }),
  adjust: ({ player, seconds }) => t("logAdjust", { n: player ?? "", delta: formatDelta(seconds ?? 0) }),
  timeOut: ({ player }) => t("logTimeOut", { n: player ?? "" }),
  untimed: () => t("logUntimed"),
  concede: ({ player }) => t("logConcede", { n: player ?? "" }),
  end: () => t("logEnd"),
};

const logTime = (at: number): string =>
  new Date(at).toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** A judge to the table: both clocks freeze at once, with no question asked, and the call is timed */
function callJudge(): void {
  if (!inGame(game) || isOver() || game.judgeCall !== null) return;
  const running = isRunning() && game.clock.since !== null ? game.clock.active : undefined;
  stopClock(game.clock);
  game.judgeCall = nowMs();
  logClock("judge", { player: running });
  stopLoop();
  showJudgeCall();
  updateButtons();
}

/** The game goes on as it was: the clock that ran runs again */
function endJudgeCall(): void {
  if (game.judgeCall === null) return;
  const lasted = (nowMs() - game.judgeCall) / 1000;
  game.judgeCall = null;
  logClock("judgeEnd", { seconds: Math.round(lasted) });
  hideJudgeCall();
  handClock(game.clock.active);
  applyTimesToDisplay();
  setActivePanels();
  updateButtons();
}

/** The judge gives time back or takes some: the clocks are frozen meanwhile, so it applies as is */
function adjustTime(player: Player, seconds: number): void {
  if (game.judgeCall === null) return;
  const before = game.clock.left[player];
  game.clock.left[player] = Math.max(0, before + seconds);
  const applied = game.clock.left[player] - before;
  if (applied === 0) return;
  logClock("adjust", { player, seconds: applied });
  renderJudgeCall();
  applyTimesToDisplay();
  setActivePanels();
}

let judgeTimer = 0;

/** Also when the judge was called from the other phone */
function showJudgeCall(): void {
  closePopovers();
  playSound("whistle");
  renderJudgeCall();
  judgeOverlay.classList.add("is-visible");
  judgeOverlay.setAttribute("aria-hidden", "false");
  window.clearInterval(judgeTimer);
  judgeTimer = window.setInterval(renderJudgeCall, 1000);
  (document.activeElement as HTMLElement | null)?.blur();
}

function hideJudgeCall(): void {
  window.clearInterval(judgeTimer);
  judgeOverlay.classList.remove("is-visible");
  judgeOverlay.setAttribute("aria-hidden", "true");
}

function renderJudgeCall(): void {
  const calledAt = game.judgeCall;
  if (calledAt === null) return;
  const call = clockEvents().filter((event) => event.kind === "judge").pop();
  app.querySelector("#judge-since")!.textContent = t("judgeSince", { time: formatSpan((nowMs() - calledAt) / 1000) });
  app.querySelector("#judge-msg")!.textContent = call?.player ? t("judgeRunning", { n: call.player }) : t("judgeStopped");
  for (const player of [1, 2] as const) {
    app.querySelector(`#judge-time-${player}`)!.textContent = formatTime(timeLeft(player));
    const added = clockEvents()
      .filter((event) => event.kind === "adjust" && event.player === player && event.at >= calledAt)
      .reduce((total, event) => total + (event.seconds ?? 0), 0);
    app.querySelector(`#judge-delta-${player}`)!.textContent = added ? formatDelta(added) : "";
  }
}

function renderClockLog(): void {
  const el = app.querySelector<HTMLElement>("#clock-log")!;
  const events = clockEvents();
  if (events.length === 0) {
    el.innerHTML = `<p class="clock-log__empty">${t("clockLogEmpty")}</p>`;
    return;
  }
  const head = [t("logTime"), t("round"), t("logEvent"), t("player", { n: 1 }), t("player", { n: 2 })];
  el.innerHTML = `
    <table>
      <thead><tr>${head.map((label) => `<th scope="col">${label}</th>`).join("")}</tr></thead>
      <tbody>${events
        .map(
          (event) =>
            `<tr class="is-${event.kind}"><td>${logTime(event.at)}</td><td data-label="R">${event.round}</td><td>${LOG_TEXT[event.kind](event)}</td><td data-label="${esc(t("player", { n: 1 }))}">${formatTime(event.left[1])}</td><td data-label="${esc(t("player", { n: 2 }))}">${formatTime(event.left[2])}</td></tr>`,
        )
        .join("")}</tbody>
    </table>`;
  // The latest first in sight: that is what a dispute is about
  el.scrollTop = el.scrollHeight;
}

/** Tab-separated, to paste in a message or a spreadsheet */
function copyClockLog(): void {
  const head = [t("logTime"), t("round"), t("logEvent"), t("player", { n: 1 }), t("player", { n: 2 })];
  const rows = clockEvents().map((event) =>
    [logTime(event.at), event.round, LOG_TEXT[event.kind](event), formatTime(event.left[1]), formatTime(event.left[2])].join("\t"),
  );
  const text = [`Chronicum · ${t("clockLog")}`, head.join("\t"), ...rows].join("\n");
  void navigator.clipboard?.writeText(text).then(
    () => showToast(t("logCopied")),
    () => undefined,
  );
}

function openClockLog(): void {
  renderClockLog();
  logOverlay.classList.add("is-visible");
  logOverlay.setAttribute("aria-hidden", "false");
}

function closeClockLog(): void {
  logOverlay.classList.remove("is-visible");
  logOverlay.setAttribute("aria-hidden", "true");
}

/**
 * After screen lock / sleep, rAF may not run. The time left comes from the wall clock,
 * so one check puts the screen right when the tab is active again.
 */
function refreshClock(): void {
  if (!clockTicks() || game.clock.since === null) return;
  if (checkClock()) return;
  applyTimesToDisplay();
}

function tick(): void {
  if (!clockTicks() || game.clock.since === null) return;
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

/** The log line of the latest switch: a double tap that pauses takes it back */
let lastSwitchLog = "";

function switchTurn(): void {
  if (!isRunning()) return;
  playSound("switch");
  const next = other(game.clock.active);
  lastSwitchLog = logClock("switch", { player: next });
  handClock(next);
  setActivePanels();
}

/** The clocks as set in the bar, stopped, Player 1's first */
function clockFromInputs(): GameState["clock"] {
  const seconds = readMinutes() * 60;
  return { left: { 1: seconds, 2: seconds }, active: 1, since: null };
}

function start(): void {
  closePopovers();
  hideTurnConfirmModal();
  hideResultOverlay();
  game.phase = "setup";
  // A timed deployment has already used some of the time
  const deployed = game.preBattle?.deployFirst && deploymentTimed() ? { ...game.clock.left } : null;
  game.clock = clockFromInputs();
  if (deployed) game.clock.left = deployed;
  else if (timeLeft(1) <= 0 || timeLeft(2) <= 0) return;
  // The coin toss winner's turn and clock come first
  game.turnPlayer = game.firstPlayer;
  game.clock.active = game.firstPlayer;
  lastSpaceTime = 0;
  game.phase = "running";
  game.choosing = false;
  runClock(game.clock);
  // The log began with the first toss
  if (!game.preBattle) game.clockLog = {};
  logClock("start");
  // Counted once, by the device that starts the battle
  track("Partie lancée", { mode: playMode(), cartes: cardsLabel(), tournoi: eventLocked() });
  // A new game: its photos (unless the deployment's already started them) and its MVPs start afresh
  newGamePhotos();
  game.mvp = { 1: null, 2: null };
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
  game.cardRounds = { 1: {}, 2: {} };
  game.newCardUsed = { 1: false, 2: false };
  celebrateBattleReady();
  startTurnSecondaries(game.firstPlayer);
}

let readyTimers: number[] = [];

/** The Battle ready points wait for the cards drawn at the start of the battle to be put away */
let readyPending = false;

const readyLater = (ms: number, then: () => void): void => {
  readyTimers.push(window.setTimeout(then, ms));
};

/**
 * The battle starts: every army is Battle ready. Its 10 points float up to the score and land on
 * it as the sound does, the score ticking up to them. The scores show without them until then
 */
function celebrateBattleReady(): void {
  stopBattleReady();
  readyHeld[1] = readyHeld[2] = BATTLE_READY_VP;
  renderMiniCounters();
  readyPending = true;
  // The first draw opens on this screen first, if it does here (see hideCards). Without the cards
  // the battle opens with its own blow: the points come once it is heard
  readyLater(secondaryCardsOn() ? 250 : 1100, () => {
    if (cardsPlayer === null) playBattleReady();
  });
}

function playBattleReady(): void {
  if (!readyPending) return;
  readyPending = false;
  const landAt = (playSound("battleReady") ?? 0) + READY_LAND_SEC;
  const targets: [HTMLElement, Player][] = online?.phone
    ? [[app.querySelector<HTMLElement>("#seat-score")!, online.seat]]
    : [
        [scoreTotalEl[1], 1],
        [scoreTotalEl[2], 2],
      ];
  for (const [target, player] of targets) document.body.append(readyChip(target, player, landAt));
  for (let step = 1; step <= BATTLE_READY_VP; step++) {
    readyLater((landAt + (READY_COUNT_SEC * step) / BATTLE_READY_VP) * 1000, () => {
      readyHeld[1] = readyHeld[2] = BATTLE_READY_VP - step;
      renderMiniCounters();
    });
  }
  readyLater((landAt + READY_COUNT_SEC) * 1000, () => {
    document.querySelectorAll(".ready-chip").forEach((chip) => chip.remove());
    for (const [target, player] of targets) {
      target.style.setProperty("--ready", `var(--p${player})`);
      target.classList.remove("is-ready-pop");
      void target.offsetWidth;
      target.classList.add("is-ready-pop");
    }
  });
}

/** "+10 Battle ready", rising from under a score and landing on it */
function readyChip(target: HTMLElement, player: Player, landAt: number): HTMLElement {
  const box = target.getBoundingClientRect();
  const chip = document.createElement("div");
  chip.className = `ready-chip is-p${player}`;
  chip.setAttribute("aria-hidden", "true");
  chip.innerHTML = `<b>+${BATTLE_READY_VP}</b><span>${t("battleReady")}</span>`;
  chip.style.left = `${box.left + box.width / 2}px`;
  chip.style.top = `${box.top + box.height / 2}px`;
  chip.style.setProperty("--land-at", `${landAt}s`);
  return chip;
}

/** A reset in the middle: the points are counted at once, nothing keeps floating */
function stopBattleReady(): void {
  readyTimers.forEach((timer) => window.clearTimeout(timer));
  readyTimers = [];
  readyPending = false;
  readyHeld[1] = readyHeld[2] = 0;
  document.querySelectorAll(".ready-chip").forEach((chip) => chip.remove());
}

function pause(): void {
  game.phase = "paused";
  stopClock(game.clock);
  logClock("pause");
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
  stopBattleReady();
  game.phase = "setup";
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  hideResultOverlay();
  game.judgeCall = null;
  game.concededBy = null;
  game.clockLog = {};
  game.mvp = { 1: null, 2: null };
  // The next game gets its own photos
  game.gameId = "";
  hideJudgeCall();
  closeClockLog();
  game.round = 1;
  game.clock = clockFromInputs();
  game.turnPlayer = 1;
  game.firstPlayer = 1;
  game.preBattle = null;
  hideToss();
  panel1.classList.remove("is-flag");
  panel2.classList.remove("is-flag");
  setInputsEnabled(true);
  applyTimesToDisplay();
  syncPresetSelectFromState();
  setActivePanels();
  updateButtons();
  renderTurnDots();
  // Ended without starting anything: a deployment photo would start the battle
  if (game.photoBreak) {
    game.photoBreak = false;
    pendingDraw = null;
    hidePhotoBreak();
  }
  game.scoreByTurn = { 1: emptyTurnScores(), 2: emptyTurnScores() };
  game.endBonus = { 1: 0, 2: 0 };
  // No command point before the game: each player gets theirs when it starts
  game.cp = { 1: 0, 2: 0 };
  game.cpHistory = { 1: emptyCpHistory(), 2: emptyCpHistory() };
  pendingDraw = null;
  afterPutAway = null;
  closeCards(false);
  game.choosing = false;
  game.primaries = { 1: null, 2: null };
  game.primaryScored = { 1: {}, 2: {} };
  game.primaryFull = { 1: {}, 2: {} };
  game.secondaries = { 1: newSecondaryPile(), 2: newSecondaryPile() };
  game.cardRounds = { 1: {}, 2: {} };
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

/** A kind's points over the game's turns; the end bonus has its own row */
const gameScore = (player: Player, kind: ScoreKind): number =>
  game.scoreByTurn[player][kind].reduce((total, points) => total + points, 0);

function renderMiniCounters(): void {
  for (const player of [1, 2] as const) {
    // Primary and secondary add up over the game; the −/+ work on this turn's points
    const turnIdx = scoringTurnIdx(player);
    scoreTotalEl[player].textContent = String(shownScore(player));
    app.querySelector<HTMLElement>(`#p${player}-score-turn`)!.textContent = t("turnN", { n: turnIdx + 1 });
    for (const { kind } of SCORE_KINDS) {
      const points = game.scoreByTurn[player][kind][turnIdx];
      app.querySelector<HTMLElement>(`#p${player}-${kind}-val`)!.textContent = String(gameScore(player, kind));
      const plus = app.querySelector<HTMLButtonElement>(`#p${player}-${kind}-plus`)!;
      plus.disabled = points >= MAX_POINTS_PER_TURN;
      plus.title = plus.disabled ? t("maxPerTurn", { max: MAX_POINTS_PER_TURN }) : "";
    }
    app.querySelector<HTMLElement>(`#p${player}-bonus-row`)!.hidden =
      !inGame(game) || turnIdx !== MAX_GAME_TURN - 1;
    app.querySelector<HTMLElement>(`#p${player}-bonus-val`)!.textContent = String(game.endBonus[player]);
  }
  p1CpVal.textContent = String(game.cp[1]);
  p2CpVal.textContent = String(game.cp[2]);
  renderHandButtons();
  updateVisibleScoreTooltip();
  updateVisibleCpTooltip();
  renderSeat();
}

/** The history behind a score or a CP count, on hover: it grows out of the number and fades away */
function historyTip(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.hidden = true;
  document.body.appendChild(el);
  return el;
}

const scoreTooltipEl = historyTip("score-tooltip");
const cpTooltipEl = historyTip("score-tooltip is-cp");
let activeScoreTooltipTarget: HTMLElement | null = null;
let activeCpTooltipTarget: HTMLElement | null = null;
const TIP_FADE_MS = 140;
const tipHideTimers = new Map<HTMLElement, number>();

/** Above the number, or below it when there is no room; it grows from that side */
function placeTip(tip: HTMLElement, target: HTMLElement): void {
  const PAD = 8;
  const GAP = 10;
  const r = target.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - box.width / 2;
  left = Math.max(PAD, Math.min(left, window.innerWidth - box.width - PAD));
  let top = r.top - box.height - GAP;
  const above = top >= PAD;
  if (!above) top = Math.min(window.innerHeight - box.height - PAD, r.bottom + GAP);
  tip.dataset.side = above ? "above" : "below";
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showTip(tip: HTMLElement, target: HTMLElement): void {
  window.clearTimeout(tipHideTimers.get(tip));
  const wasShown = tip.classList.contains("is-visible");
  tip.hidden = false;
  placeTip(tip, target);
  if (wasShown) return;
  void tip.offsetWidth;
  tip.classList.add("is-visible");
}

function fadeTip(tip: HTMLElement): void {
  tip.classList.remove("is-visible");
  window.clearTimeout(tipHideTimers.get(tip));
  tipHideTimers.set(
    tip,
    window.setTimeout(() => {
      tip.hidden = true;
    }, TIP_FADE_MS),
  );
}

const tipHead = (player: Player, title: string, value: number): string =>
  `<div class="history-tip__head"><span>${title} · ${t("player", { n: player })}</span><b>${value}</b></div>`;

function showScoreTooltip(target: HTMLElement): void {
  const player: Player = target === scoreTotalEl[1] ? 1 : 2;
  renderScoreTooltipContent(player);
  activeScoreTooltipTarget = target;
  showTip(scoreTooltipEl, target);
}

function hideScoreTooltip(): void {
  if (!activeScoreTooltipTarget) return;
  activeScoreTooltipTarget = null;
  fadeTip(scoreTooltipEl);
}

function bindScoreTooltip(target: HTMLElement): void {
  target.addEventListener("mouseenter", () => showScoreTooltip(target));
  target.addEventListener("mouseleave", hideScoreTooltip);
}

/** Each of the player's turns: primary and secondary points, and a bar out of the most a turn can score */
function renderScoreTooltipContent(player: Player): void {
  const { primary, secondary } = game.scoreByTurn[player];
  const current = inGame(game) ? scoringTurnIdx(player) : -1;
  const bar = (points: number, kind: string): string =>
    `<i class="is-${kind}" style="width:${(points / (MAX_POINTS_PER_TURN * 2)) * 100}%"></i>`;
  const rows = primary.map((pri, i) => {
    const sec = secondary[i];
    const state = i === current ? " is-current" : pri + sec === 0 ? " is-empty" : "";
    return `<div class="history-tip__row${state}" style="--i:${i}"><span>${t("turnN", { n: i + 1 })}</span><b>${pri}</b><b>${sec}</b><span class="history-tip__bar">${bar(pri, "pri")}${bar(sec, "sec")}</span></div>`;
  });
  const extra = (label: string, points: number, i: number): string =>
    `<div class="history-tip__row is-extra" style="--i:${i}"><span>${label}</span><b>+${points}</b></div>`;
  scoreTooltipEl.dataset.player = String(player);
  scoreTooltipEl.innerHTML = `
    ${tipHead(player, t("score"), scoreOf(player))}
    <div class="history-tip__cols"><span></span><span>${t("tipPri")}</span><span>${t("tipSec")}</span><span></span></div>
    ${rows.join("")}
    ${game.endBonus[player] > 0 ? extra(t("endBonus"), game.endBonus[player], MAX_GAME_TURN) : ""}
    ${inGame(game) ? extra(t("battleReady"), BATTLE_READY_VP, MAX_GAME_TURN + 1) : ""}`;
}

function updateVisibleScoreTooltip(): void {
  if (!activeScoreTooltipTarget) return;
  const player: Player = activeScoreTooltipTarget === scoreTotalEl[1] ? 1 : 2;
  renderScoreTooltipContent(player);
  placeTip(scoreTooltipEl, activeScoreTooltipTarget);
}

function showCpTooltip(target: HTMLElement): void {
  const player: Player = target === p1CpVal ? 1 : 2;
  renderCpTooltipContent(player);
  activeCpTooltipTarget = target;
  showTip(cpTooltipEl, target);
}

function hideCpTooltip(): void {
  if (!activeCpTooltipTarget) return;
  activeCpTooltipTarget = null;
  fadeTip(cpTooltipEl);
}

function bindCpTooltip(target: HTMLElement): void {
  target.addEventListener("mouseenter", () => showCpTooltip(target));
  target.addEventListener("mouseleave", hideCpTooltip);
}

/** The CP added and spent by hand, turn by turn, up to the one being played: the turns to come say nothing yet */
function renderCpTooltipContent(player: Player): void {
  const { added, removed } = game.cpHistory[player];
  const current = inGame(game) ? currentPlayerTurnSlot() : -1;
  const amount = (n: number, sign: string, kind: string): string =>
    n > 0 ? `<b class="is-${kind}">${sign}${n}</b>` : `<b class="is-zero">·</b>`;
  const rows = added.slice(0, current + 1).map((gained, i) => {
    const spent = removed[i];
    const owner: Player = i % 2 === 0 ? 1 : 2;
    const state = i === current ? " is-current" : gained + spent === 0 ? " is-empty" : "";
    return `<div class="history-tip__row${state}" style="--i:${i}"><span>${t("cpTurnRow", { round: Math.floor(i / 2) + 1, p: owner })}</span>${amount(gained, "+", "gain")}${amount(spent, "−", "spend")}</div>`;
  });
  cpTooltipEl.dataset.player = String(player);
  cpTooltipEl.innerHTML = `
    ${tipHead(player, t("commandPoints"), game.cp[player])}
    <p class="history-tip__legend">${t("cpLegend")}</p>
    ${
      rows.length
        ? `<div class="history-tip__cols"><span></span><span>${t("tipGained")}</span><span>${t("tipSpent")}</span></div>${rows.join("")}`
        : `<p class="history-tip__empty">${t("tipEmpty")}</p>`
    }`;
}

function updateVisibleCpTooltip(): void {
  if (!activeCpTooltipTarget) return;
  const player: Player = activeCpTooltipTarget === p1CpVal ? 1 : 2;
  renderCpTooltipContent(player);
  placeTip(cpTooltipEl, activeCpTooltipTarget);
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
  // A new round is also the start of the first player's turn
  applyAbilityCp(game.firstPlayer, ["round-cp", "turn-cp"]);
  applyAbilityCp(other(game.firstPlayer), ["round-cp"]);
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
  if (phoneView() && online?.seat === player) {
    abilitiesEl[player].replaceChildren(...cpTilesEl(player));
    return;
  }
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

/**
 * A player's own phone: one tile per ability, side by side. The stratagem one is tapped when the
 * discount is used (again to take it back), the +1 CP one works by itself. A lost unit is said on
 * its tile and set in the CP generation dialog, never by a tap here that could slip
 */
function cpTilesEl(player: Player): HTMLElement[] {
  const abilities = [...game.abilities[player]].sort((a, b) => Number(isCpKind(a.kind)) - Number(isCpKind(b.kind)));
  return abilities.map((ability) => {
    const discount = !isCpKind(ability.kind);
    const tile = document.createElement(discount ? "button" : "div");
    tile.className = `cp-tile${discount ? " cp-tile--use" : ""}`;
    tile.classList.toggle("is-spent", discount && ability.spent && !ability.lost);
    tile.classList.toggle("is-lost", ability.lost);
    tile.dataset.abilityId = String(ability.id);
    if (tile instanceof HTMLButtonElement) {
      tile.type = "button";
      tile.disabled = ability.lost || !inGame(game);
    }
    const state = ability.lost
      ? t("unitLost")
      : !discount
        ? t("cpTileAuto")
        : !inGame(game)
          ? t("onceARound")
          : ability.spent
            ? t("cpTileUsed")
            : t("cpTileUse");
    tile.innerHTML = `
      <b class="cp-tile__value">${discount ? "−1" : "+1"}<small>${t("cpUnit")}</small></b>
      <span class="cp-tile__what">${t(discount ? "stratagem" : ABILITY_KINDS[ability.kind].hint)}</span>
      <span class="cp-tile__state">${discount && ability.spent && !ability.lost ? ICON_CHECK : ""}${state}</span>`;
    return tile;
  });
}

/** The stratagem tile: used, or taken back by a second tap */
function useCpTile(player: Player, id: number): void {
  const ability = game.abilities[player].find((candidate) => candidate.id === id);
  if (!inGame(game) || !ability || ability.lost) return;
  ability.spent = !ability.spent;
  playSound(ability.spent ? "coinSpend" : "coinRestore");
  renderAbilities(player);
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
  if (!canEdit(player)) return;
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
  // In a game, a unit can die: its ability stops, until it is set back
  if (inGame(game)) {
    if (discount) discountRow.insertAdjacentHTML("beforeend", abilityLostHtml(discount));
    if (cp) cpRow.insertAdjacentHTML("beforeend", abilityLostHtml(cp));
  }
  revealCpTiming = false;
  abilityList.replaceChildren(discountRow, cpRow);
}

function abilityLostHtml(ability: Ability): string {
  return `
    <button type="button" class="ability-lost" data-ability-id="${ability.id}" aria-pressed="${ability.lost}">
      <span><b>${t("unitLost")}</b><small>${t("unitLostHint")}</small></span>
      <span class="toggle-chip__switch" aria-hidden="true"></span>
    </button>`;
}

function toggleAbilitySlot(player: Player, slot: AbilitySlot): void {
  const existing = abilityInSlot(player, slot);
  if (existing) {
    game.abilities[player] = game.abilities[player].filter((ability) => ability !== existing);
  } else {
    game.abilities[player].push({ id: game.nextAbilityId++, kind: slot === "discount" ? "discount" : "turn-cp", lost: false, spent: false });
    revealCpTiming = slot === "cp";
  }
  // The +1 CP timing comes and goes under its tile: the list, and the dialog with it, follow
  glideHeight(abilityList, renderAbilityList);
  renderAbilities(player);
  if (phoneView()) renderSeat();
}

/** `change` makes `el` taller or shorter: it grows or shrinks to its new height, clipped meanwhile */
function glideHeight(el: HTMLElement, change: () => void): void {
  if (prefersReducedMotion() || !el.getClientRects().length) {
    change();
    return;
  }
  // Mid-way if it was already gliding
  const from = getComputedStyle(el).height;
  for (const anim of el.getAnimations()) if (anim.id === GLIDE) anim.cancel();
  change();
  const to = getComputedStyle(el).height;
  if (from === to) return;
  el.style.overflow = "clip";
  el.animate([{ height: from }, { height: to }], { duration: SLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", id: GLIDE })
    .finished.then(
      () => {
        el.style.overflow = "";
      },
      () => {},
    );
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
 * primaries' VS, one player's primary, or what scores at the end of a turn
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
/** The cards overlay fading out, as in the CSS (.overlay--cards) */
const CARDS_FADE_MS = 200;
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

/** Players draw from their own deck: the app deals blank cards, each filled in with the card drawn */
const manualDraw = (): boolean => game.options.manualDraw === true;

/** A blank card waiting for the card drawn from the real deck. Never in a pile: only in the draw */
const BLANK_PREFIX = "blank:";
const isBlank = (id: string): boolean => id.startsWith(BLANK_PREFIX);
let blankSeq = 0;
const newBlank = (): string => `${BLANK_PREFIX}${Date.now().toString(36)}${(blankSeq++).toString(36)}`;

/** The draw on screen still has a blank card: the turn goes on once every card drawn is picked */
const drawPending = (): boolean => cardsPlayer !== null && cardsMode === "draw" && drawnIds.some(isBlank);

/**
 * Each card is picked at random when it is drawn, never set by a shuffle made earlier: the order of
 * the deck, kept in the shared state, tells nothing about the next cards. With the real deck, blank
 * cards come instead, as many as the deck still holds
 */
function drawSecondaries(player: Player, count: number): string[] {
  const pile = game.secondaries[player];
  if (manualDraw()) {
    // The blanks already on screen take their cards from the same deck: never more blanks than cards
    const waiting = cardsPlayer === player && cardsMode === "draw" ? drawnIds.filter(isBlank).length : 0;
    return Array.from({ length: Math.max(0, Math.min(count, pile.deck.length - waiting)) }, newBlank);
  }
  const n = Math.min(count, pile.deck.length);
  const drawn = Array.from({ length: n }, () => pile.deck.splice(randomIndex(pile.deck.length), 1)[0]);
  pile.hand.push(...drawn);
  for (const id of drawn) game.cardRounds[player][id] = { drawn: game.round };
  return drawn;
}

/** A card of the draw replaced by another: here, and on the other screens showing the same draw */
function replaceDrawn(player: Player, from: string, to: string): void {
  drawnIds = drawnIds.map((id) => (id === from ? to : id));
  if (game.lastDraw.player === player) game.lastDraw.ids = game.lastDraw.ids.map((id) => (id === from ? to : id));
}

/**
 * The card drawn from the real deck, picked on its blank: it leaves the deck for the hand. False
 * when it is no longer in the deck (picked meanwhile on the other blank, or on another device)
 */
function pickDrawnCard(player: Player, blank: string, id: string, cardEl: HTMLElement): boolean {
  const pile = game.secondaries[player];
  const at = pile.deck.indexOf(id);
  if (at < 0 || !drawnIds.includes(blank)) return false;
  pile.deck.splice(at, 1);
  pile.hand.push(id);
  game.cardRounds[player][id] = { drawn: game.round };
  replaceDrawn(player, blank, id);
  revealCard(cardEl, id);
  return true;
}

/** A card picked by mistake goes back to the deck, and its blank comes back */
function unpickDrawnCard(player: Player, id: string, cardEl: HTMLElement): void {
  const pile = game.secondaries[player];
  if (!pile.hand.includes(id)) return;
  pile.hand = pile.hand.filter((cardId) => cardId !== id);
  pile.deck.push(id);
  delete game.cardRounds[player][id];
  const blank = newBlank();
  replaceDrawn(player, id, blank);
  playCardExit(cardEl, "is-returned", undefined, [blank]);
}

/** The blank's half turn, then the card picked finishing it, empty until it lands */
const REVEAL_HALF_MS = 180;
const REVEAL_IN_MS = 220;
/** The landing: the card swells and settles, a ring leaves it, its content comes in (style.css, .is-impact) */
const IMPACT_MS = 650;

/**
 * The blank turns over to the card picked on it, as a card dealt face down is revealed. It lands
 * empty, then its content comes in on the impact: the VS's slam in small, a moment of its own that
 * stays under the primaries' clash
 */
function revealCard(cardEl: HTMLElement, id: string): void {
  playSound("flip");
  const done = () => {
    renderCards();
    renderHandButtons();
    const card = [...cardsRow.querySelectorAll<HTMLElement>(".sec-card")].find((el) => el.dataset.cardId === id);
    if (!card || prefersReducedMotion()) {
      afterReveal();
      return;
    }
    // The content waits for the impact, each part a beat after the one above
    [...card.querySelectorAll<HTMLElement>(".sec-card__inner > *")].forEach((part, k) => part.style.setProperty("--k", String(k)));
    card.classList.add("is-revealed");
    void halfTurn(card, -90, 0, REVEAL_IN_MS, "cubic-bezier(0.2, 0, 0.2, 1)").then(() => {
      card.classList.add("is-impact");
      playSound("reveal");
      buzz(25);
      window.setTimeout(() => card.classList.remove("is-revealed", "is-impact"), IMPACT_MS);
      afterReveal();
    });
  };
  if (prefersReducedMotion()) {
    done();
    return;
  }
  halfTurn(cardEl, 0, 90, REVEAL_HALF_MS, "cubic-bezier(0.4, 0, 1, 1)").then(done, done);
}

/**
 * Once a card is revealed: the next blank opens its list at once, two picks for two taps. With
 * none left, Continue comes alive: the turn can go on
 */
function afterReveal(): void {
  const next = cardsRow.querySelector<HTMLElement>(".sec-card.is-blank");
  if (next) {
    if (cardsPlayer === null || !canEdit(cardsPlayer)) return;
    frontCardKey = cardKey(next);
    placeFrontCard();
    openChooser(next, !coarsePointer());
    return;
  }
  btnCardsClose.classList.remove("is-ready");
  void btnCardsClose.offsetWidth;
  btnCardsClose.classList.add("is-ready");
  btnCardsClose.addEventListener("animationend", () => btnCardsClose.classList.remove("is-ready"), { once: true });
}

/** A card's faces turned about their upright axis, in 3D for the turn only (style.css, .is-turning) */
function halfTurn(card: HTMLElement, from: number, to: number, duration: number, easing: string): Promise<unknown> {
  const faces = card.querySelector<HTMLElement>(".sec-card__faces");
  if (!faces) return Promise.resolve();
  card.classList.add("is-turning");
  const animation = faces.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }], {
    duration,
    easing,
    fill: "forwards",
  });
  return animation.finished.finally(() => {
    card.classList.remove("is-turning");
    // The blank stays edge on until it leaves the page; the card picked lies flat again
    if (to === 0) animation.cancel();
  });
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
  else {
    openCards(player, "draw", drawn);
    buzz(60);
  }
}

function moveSecondary(player: Player, id: string, to: "discard" | "deck"): void {
  const pile = game.secondaries[player];
  pile.hand = pile.hand.filter((cardId) => cardId !== id);
  if (to === "deck") {
    // Shuffled back: anywhere in the deck
    pile.deck.splice(Math.floor(Math.random() * (pile.deck.length + 1)), 0, id);
    return;
  }
  pile.discard.push(id);
  game.cardRounds[player][id] = { ...game.cardRounds[player][id], discarded: game.round };
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
    // The missions are dealt before the deployment, to be read from then on; the hand, once the battle starts
    const dealt = !!primaryCard(player);
    cardButtonsEl[player].hidden = !secondaryCardsOn() || (!inGame(game) && !dealt);
    button.hidden = !inGame(game);
    primaryButtonEl[player].hidden = !dealt;
    button.querySelector(".score-box__hand-count")!.textContent = String(count);
    button.setAttribute("aria-label", t("handAria", { n: count }));
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
  resultOverlay.classList.contains("is-visible") ||
  turnConfirmOverlay.classList.contains("is-visible") ||
  endGameOverlay.classList.contains("is-visible") ||
  timeOutOverlay.classList.contains("is-visible");

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
  frontCardKey = null;
  receiptHold = false;
  flippedCards.clear();
  // The opponent's cards, on a player's device: to read
  cardsOverlay.classList.toggle("is-readonly", !canEdit(player));
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
  if (mode === "primary") {
    // The cards meet and the VS slams down on the horns' boom, when the speaker plays it
    const heardIn = playSound("clash") ?? 0;
    cardsRow.style.setProperty("--vs-at", `${heardIn + CLASH_BOOM_SEC}s`);
  } else if (dealt > 0) playSound("draw", dealt);
  cardsOverlay.classList.add("is-visible");
  cardsOverlay.setAttribute("aria-hidden", "false");
  btnCardsClose.focus();
}

function closeCards(putAway = true, putAwayElsewhere = false): void {
  if (cardsPlayer === null) return;
  // The draw opens the turn, in its Command phase: once it is put away, the primary scores of that phase come up
  const commandNext = putAway && cardsMode === "draw" && primaryScoresInCommand(cardsPlayer) ? cardsPlayer : null;
  // Online, the turn-start cards show on the player's phone and the shared screen: put away on one, gone from both
  if (putAway && !putAwayElsewhere && roomSession() && (cardsMode === "draw" || cardsMode === "command")) {
    game.cardsPutAway = { player: cardsPlayer, mode: cardsMode, n: game.cardsPutAway.n + 1 };
  }
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
  if (commandNext !== null) openCards(commandNext, "command");
}

function hideCards(): void {
  if (putAwayTimer !== null) window.clearTimeout(putAwayTimer);
  putAwayTimer = null;
  // The cards stay put away while the overlay fades out, then leave the page: hidden, they would
  // go on floating and holding the phone's graphics for nothing. The next opening deals them again
  cardsOverlay.classList.remove("is-visible");
  window.setTimeout(() => {
    if (cardsPlayer !== null || cardsOverlay.classList.contains("is-visible")) return;
    cardsRow.replaceChildren();
    cardsOverlay.classList.remove("is-closing");
  }, CARDS_FADE_MS);
  const next = afterPutAway;
  afterPutAway = null;
  next?.();
  // The first draw put away: the Battle ready points come, once the overlay has faded
  if (readyPending) readyLater(200, () => {
    if (cardsPlayer === null) playBattleReady();
  });
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
  if (game.turnPlayer === game.firstPlayer) requestEndTurn("mid-round");
  else requestEndTurn(game.round >= MAX_GAME_TURN ? "finish-game" : "next-round");
}

/** With the cards, ending a turn first shows what scores now; with nothing to score, the plain confirmation */
function requestEndTurn(kind: TurnConfirmKind): void {
  endTurnKind = kind;
  endTurnOrder = {};
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
    // At a turn end, a side with nothing left to score still shows what it scored
    button.disabled = tab.count === 0 && !tab.on && !(cardsMode === "end-turn" && endTurnIds(tab.side).length > 0);
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

/** `dealIds` fly in from the deck; the others are already on the table */
function renderCards(dealIds: string[] = []): void {
  if (cardsPlayer === null) return;
  const player = cardsPlayer;
  const pile = game.secondaries[player];
  // Online, Player 1 starts the game from the VS: their clock is the one that runs
  const waitsForP1 = cardsMode === "primary" && !!online && online.seat !== 1;
  const closeLabel: StringKey = waitsForP1
    ? "vsWaitP1"
    : cardsMode === "primary"
      ? "tossOpen"
      : cardsMode !== "end-turn"
        ? "continue"
        : endTurnKind === "finish-game"
          ? "endBattleBtn"
          : "endTurnBtn";
  btnCardsClose.querySelector("span")!.textContent = t(closeLabel);
  btnCardsClose.disabled = waitsForP1;
  renderCardsSwitch();
  renderCapMeters(player);
  // Before the battle, the chronicle it opens: a brand moment, the board stays plain afterwards
  cardsSub.classList.toggle("is-chronicle", cardsMode === "primary");
  if (cardsMode === "primary") {
    cardsTitle.textContent = t("primaryTitle");
    cardsSub.textContent = chronicleTitle();
    // The two missions face off: they rush in from each side and clash on a "VS"
    const versus = document.createElement("div");
    versus.className = "versus";
    versus.setAttribute("aria-hidden", "true");
    versus.innerHTML = "<span class=\"versus__line\"></span><span class=\"versus__text\">VS</span>";
    // On a phone the cards stack around the VS: online, the opponent's on top and short, this
    // phone's player's in full below; on one phone for both players, both short
    const stacked = narrowCards();
    const owners: Player[] = online?.phone ? [other(online.seat), online.seat] : [1, 2];
    const [first, second] = owners.map((owner, index) => {
      const card = primaryCardEl(owner, index, dealIds.includes(primaryCardId(owner)), false);
      card.classList.toggle("is-compact", stacked && owner !== online?.seat);
      return card;
    });
    cardsRow.classList.toggle("is-stacked", stacked);
    cardsRow.classList.toggle("is-clashing", dealIds.length > 0);
    keepFlips([first, second]);
    floatOnClock([first, second]);
    cardsRow.replaceChildren(first, versus, second);
    layoutCardsRow();
    return;
  }
  cardsRow.classList.remove("is-stacked");
  const ids =
    cardsMode === "draw"
      ? drawnIds.filter((id) => isBlank(id) || pile.hand.includes(id))
      : cardsMode === "hand"
        ? pile.hand
        : cardsMode === "scored"
          ? pile.scored.map(({ id }) => id)
          : cardsMode === "end-turn"
          ? endTurnIds(player)
          : [];
  if (cardsMode === "end-turn") {
    cardsTitle.textContent = t("endTurnScoringTitle", { n: game.turnPlayer });
    cardsSub.textContent = player === game.turnPlayer ? t("endTurnScoringSub") : t("endTurnOpponentSub", { n: player });
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
    const blanks = cardsMode === "draw" && ids.some(isBlank);
    cardsSub.textContent = cardsMode === "draw" ? `${deck} · ${t(blanks ? "pickFromDeck" : "scoreFromHand")}` : deck;
  }
  // The turn goes on once every card drawn from the real deck is picked
  if (cardsMode === "draw") btnCardsClose.disabled = ids.some(isBlank);
  // The primary card stays apart from the hand: on its own, or at a turn end when it scores
  const withPrimary =
    cardsMode === "mission" || cardsMode === "command" || (cardsMode === "end-turn" && primaryScoresAtTurnEnd(player));
  // Before the battle (deployment) the primary is read only; online, the opponent's one too
  const ownCard = inGame(game) && (!online || player === online.seat);
  const primary = withPrimary && primaryCard(player) ? [primaryCardEl(player, 0, dealIds.includes(primaryCardId(player)), ownCard)] : [];
  const cards = [
    ...primary,
    ...ids.map((id, index) =>
      (isBlank(id) ? blankCardEl : secondaryCardEl)(player, id, index + primary.length, dealIds.includes(id)),
    ),
  ];
  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "cards-empty";
    empty.textContent = t(cardsMode === "end-turn" ? "nothingToScore" : cardsMode === "scored" ? "emptyScored" : "emptyHand");
    cardsRow.replaceChildren(empty);
    return;
  }
  keepFlips(cards);
  placeCards(cards, dealIds.length === 0);
  layoutCardsRow();
  groupEndTurnPile(false);
}

/**
 * At a turn end, what the turn already holds out of the 15 points it allows, primary and
 * secondary apart: the player picks what to score to make the most of it. The meters stay in
 * place and fill as points come in
 */
function renderCapMeters(player: Player): void {
  // On a phone, right above the button that ends the turn: what the turn still allows sits next
  // to the decision. Moved only when its place changes, so the bars keep filling smoothly
  const home = narrowCards() ? cardsActions : cardsStage;
  if (cardsCap.parentElement !== home) {
    if (home === cardsActions) cardsActions.prepend(cardsCap);
    else cardsRow.before(cardsCap);
  }
  const shown: ScoreKind[] =
    cardsMode !== "end-turn"
      ? []
      : [
          ...(primaryScoresAtTurnEnd(player) ? (["primary"] as const) : []),
          ...(endTurnIds(player).length > 0 ? (["secondary"] as const) : []),
        ];
  cardsCap.hidden = shown.length === 0;
  const turn = scoringTurnIdx(player) + 1;
  for (const kind of SCORE_KINDS.map(({ kind }) => kind)) {
    let meter = cardsCap.querySelector<HTMLElement>(`.cap-meter[data-kind="${kind}"]`);
    if (!meter) {
      meter = document.createElement("div");
      meter.className = "cap-meter";
      meter.dataset.kind = kind;
      meter.innerHTML = `
        <span class="cap-meter__label"></span>
        <span class="cap-meter__bar" aria-hidden="true"><span class="cap-meter__fill"></span></span>
        <span class="cap-meter__value"><b></b><small>/${MAX_POINTS_PER_TURN}</small></span>`;
      cardsCap.appendChild(meter);
    }
    meter.hidden = !shown.includes(kind);
    const points = game.scoreByTurn[player][kind][turn - 1];
    meter.querySelector(".cap-meter__label")!.textContent = t(kind === "primary" ? "capPrimary" : "capSecondary");
    meter.querySelector(".cap-meter__value b")!.textContent = String(points);
    meter.style.setProperty("--fill", String(Math.min(1, points / MAX_POINTS_PER_TURN)));
    meter.classList.toggle("is-full", points >= MAX_POINTS_PER_TURN);
  }
}

/**
 * The cards go on the table. The same cards as already there, none dealt: each keeps its element
 * and only its content is redone, so it floats and turns on undisturbed. Otherwise new cards, on
 * the float's clock
 */
function placeCards(cards: HTMLElement[], keep: boolean): void {
  const current = [...cardsRow.children] as HTMLElement[];
  const same =
    keep &&
    current.length === cards.length &&
    current.every((card, i) => card.classList.contains("sec-card") && cardKey(card) === cardKey(cards[i]));
  if (same) {
    current.forEach((card, i) => patchCard(card, cards[i]));
    return;
  }
  floatOnClock(cards);
  cardsRow.replaceChildren(...cards);
}

/** A card's text and state redone inside the same elements; an open or fold under way goes on */
function patchCard(card: HTMLElement, fresh: HTMLElement): void {
  // An open or fold under way, and its place in a turn end's receipt (groupEndTurnPile), go on
  const moving = ["is-morphing", "is-folding", "is-opening", "is-turning", "is-receipt", "is-receipt-first", "is-receipt-last"].filter((name) =>
    card.classList.contains(name),
  );
  card.className = fresh.className;
  card.classList.add(...moving);
  card.style.setProperty("--i", fresh.style.getPropertyValue("--i"));
  const face = (el: HTMLElement): HTMLElement => el.querySelector<HTMLElement>(".sec-card__inner")!;
  face(card).replaceChildren(...face(fresh).childNodes);
  card.querySelector(".sec-card__back")?.remove();
  const back = fresh.querySelector(".sec-card__back");
  if (back) card.querySelector(".sec-card__faces")!.appendChild(back);
}

/** One idle float of a card, as in the CSS (cardFloat), and how far apart two cards float */
const CARD_FLOAT_MS = 5000;
const CARD_FLOAT_STEP_MS = 1700;

/**
 * New card elements float on the page's clock: they pick it up where the old ones were instead of
 * starting over. A plain delay in ms, set on each card: no calc() for a browser to read differently
 */
function floatOnClock(cards: HTMLElement[]): void {
  const phase = performance.now() % CARD_FLOAT_MS;
  for (const card of cards) {
    const i = Number(card.style.getPropertyValue("--i")) || 0;
    card.querySelector<HTMLElement>(".sec-card__inner")!.style.animationDelay = `${-Math.round(phase + i * CARD_FLOAT_STEP_MS)}ms`;
  }
}

/** Card widths and gap in rem, as in the CSS: the primary, kept all game, is the wider card */
const CARD_REM = 16;
const PRIMARY_CARD_REM = 20;
const CARD_GAP_REM = 1.5;

/** A phone, or a window as narrow: no room for the cards side by side */
const narrowCards = (): boolean => phoneView() || SHEET.matches;

/**
 * Like a hand in a card game: one row, the cards overlapping as much as needed to fit
 * the screen width. The hovered card comes to the front, or on a touch screen the tapped one.
 * Too narrow for a row, they pile up instead, each showing its name, the front one open
 */
function layoutCardsRow(): void {
  const piled = cardsMode !== "primary" && narrowCards();
  cardsRow.classList.toggle("is-piled", piled);
  if (cardsMode === "primary") {
    cardsRow.classList.remove("is-fanned");
    placeFrontCard();
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
  const fanned = !piled && count > 1 && natural > available;
  cardsRow.classList.toggle("is-fanned", fanned);
  // At least 3rem of each card stays visible, enough to read its name
  const overlap = fanned ? Math.min((width - available) / (count - 1), CARD_REM - 3) : 0;
  cardsRow.style.setProperty("--overlap", `${overlap}rem`);
  placeFrontCard();
}

/** The fanned card a tap brought to the front, kept while the cards are re-dealt; the last one until then */
let frontCardKey: string | null = null;
/** A card turning over; its sound lands with it (audio.ts) */
const CARD_TURN_MS = 440;
/** The cards turned over to their action, kept while the cards are re-dealt */
const flippedCards = new Set<string>();

/**
 * A card turned over by hand: it tilts back a little as the fingers take it, then lifts and spins
 * in one movement that slows down into place, no going past and back. One easing over the whole
 * turn, and the spin even across the keyframes, so it comes to rest once, smoothly
 */
function turnCard(faces: HTMLElement, toBack: boolean): void {
  const angle = (deg: number): number => (toBack ? deg : 180 - deg);
  const pose = (deg: number, tilt: number, lift: number): string =>
    `rotateY(${angle(deg)}deg) rotateX(${tilt}deg) translateZ(${lift}px)`;
  for (const animation of faces.getAnimations()) animation.cancel();
  // In 3D for the turn only (style.css): flat again once it lies face up
  const card = faces.closest<HTMLElement>(".sec-card");
  card?.classList.add("is-turning");
  faces
    .animate(
      [
        { offset: 0, transform: pose(0, 0, 0) },
        { offset: 0.14, transform: pose(-10, 2, 12) },
        // On the line from −10° to 180°: the spin keeps one speed through it, only the lift peaks
        { offset: 0.55, transform: pose(81, -3, 40) },
        { offset: 1, transform: pose(180, 0, 0) },
      ],
      { duration: CARD_TURN_MS, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
    )
    .finished.then(
      () => card?.classList.remove("is-turning"),
      () => {},
    );
}

function keepFlips(cards: HTMLElement[]): void {
  for (const card of cards) card.classList.toggle("is-flipped", flippedCards.has(cardKey(card)));
}

function placeFrontCard(): void {
  const cards = [...cardsRow.querySelectorAll<HTMLElement>(".sec-card")];
  // Until a tap picks one: the last card still to score, a card already scored has nothing to do
  const fallback = cards.filter((card) => !card.classList.contains("is-banked")).at(-1) ?? cards.at(-1);
  const front = cardsRow.matches(".is-fanned, .is-piled")
    ? (cards.find((card) => cardKey(card) === frontCardKey) ?? fallback)
    : undefined;
  for (const card of cards) {
    card.classList.toggle("is-front", card === front);
    // Folded into the pile, a card shows its name: it lies face up again
    if (cardsRow.classList.contains("is-piled") && card !== front && card.classList.contains("is-flipped")) {
      card.classList.remove("is-flipped");
      flippedCards.delete(cardKey(card));
    }
  }
}

function repeatTotal(option: HTMLElement): number {
  const per = Number(option.dataset.per);
  const max = Number(option.dataset.max);
  return Math.min(per * Number(option.dataset.count), max);
}

/**
 * A card drawn from the real deck, still blank: dealt like any other. A tap on it turns it into
 * the list of what is left in the deck, with a search: the player has the card in hand, a few
 * letters of its name find it
 */
function blankCardEl(player: Player, blank: string, index: number, deal: boolean): HTMLElement {
  const editable = canEdit(player);
  const el = document.createElement("article");
  el.className = "sec-card is-blank";
  el.classList.toggle("is-dealt", deal);
  el.style.setProperty("--i", String(index));
  el.dataset.cardId = blank;
  el.innerHTML = `
    <div class="sec-card__faces">
      <div class="sec-card__inner">
        <header class="sec-card__head">
          <span class="sec-card__kicker"></span>
          <h3 class="sec-card__name"></h3>
        </header>
        <button type="button" class="sec-card__blank" data-action="choose">
          <span class="sec-card__blank-mark" aria-hidden="true">?</span>
          <span class="sec-card__blank-hint"></span>
        </button>
        <div class="card-chooser" hidden>
          <input type="search" class="card-chooser__search" autocomplete="off" spellcheck="false" enterkeyhint="done" />
          <div class="card-chooser__list" role="listbox"></div>
        </div>
      </div>
    </div>`;
  el.querySelector(".sec-card__kicker")!.textContent = t("secondaryKicker");
  el.querySelector(".sec-card__name")!.textContent = t("blankCardName");
  el.querySelector(".sec-card__blank-hint")!.textContent = t(editable ? "blankCardTap" : "blankCardWait", { n: player });
  el.querySelector<HTMLButtonElement>(".sec-card__blank")!.disabled = !editable;
  const search = el.querySelector<HTMLInputElement>(".card-chooser__search")!;
  search.id = `pick-${blank.replace(/[^a-z0-9]/gi, "")}`;
  search.placeholder = t("blankCardSearch");
  search.setAttribute("aria-label", t("blankCardSearch"));
  return el;
}

/** A finger on a phone: the list opens without the keyboard, which would cover half of it */
const coarsePointer = (): boolean => matchMedia("(pointer: coarse)").matches;

/** The blank card becomes the list of the deck's cards, the search on top */
function openChooser(cardEl: HTMLElement, focusSearch: boolean): void {
  cardsRow.querySelectorAll<HTMLElement>(".sec-card.is-choosing").forEach((card) => card !== cardEl && closeChooser(card));
  cardEl.classList.add("is-choosing");
  cardEl.querySelector<HTMLElement>(".sec-card__blank")!.hidden = true;
  cardEl.querySelector<HTMLElement>(".card-chooser")!.hidden = false;
  const search = cardEl.querySelector<HTMLInputElement>(".card-chooser__search")!;
  search.value = "";
  renderChooserList(cardEl, "");
  playSound("slide");
  if (focusSearch) search.focus({ preventScroll: true });
}

function closeChooser(cardEl: HTMLElement): void {
  cardEl.classList.remove("is-choosing");
  cardEl.querySelector<HTMLElement>(".card-chooser")!.hidden = true;
  cardEl.querySelector<HTMLElement>(".sec-card__blank")!.hidden = false;
}

/** The deck's cards whose name holds the search, accents aside, in alphabetical order */
function renderChooserList(cardEl: HTMLElement, query: string): void {
  if (cardsPlayer === null) return;
  const wanted = foldAccents(query.trim());
  const cards = game.secondaries[cardsPlayer].deck
    .map((id) => ({ id, name: SECONDARY_BY_ID.get(id)?.name ?? id }))
    .filter(({ name }) => foldAccents(name).includes(wanted))
    .sort((a, b) => a.name.localeCompare(b.name));
  const list = cardEl.querySelector<HTMLElement>(".card-chooser__list")!;
  if (cards.length === 0) {
    const none = document.createElement("p");
    none.className = "card-chooser__none";
    none.textContent = t("blankCardNone");
    list.replaceChildren(none);
    return;
  }
  list.replaceChildren(
    ...cards.map(({ id, name }) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "card-chooser__option";
      option.setAttribute("role", "option");
      option.dataset.action = "pick";
      option.dataset.value = id;
      option.textContent = name;
      return option;
    }),
  );
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
    <div class="sec-card__faces">
      <div class="sec-card__inner">
        <header class="sec-card__head">
          <span class="sec-card__kicker"></span>
          <h3 class="sec-card__name"></h3>
          <span class="sec-card__when"></span>
        </header>
        <p class="sec-card__note"></p>
        <div class="sec-card__options"></div>
        <footer class="sec-card__actions"></footer>
      </div>
    </div>`;
  el.querySelector(".sec-card__kicker")!.textContent = t("secondaryKicker");
  el.querySelector(".sec-card__name")!.textContent = data.name;
  el.querySelector(".sec-card__when")!.textContent = data.when ? t(WHEN_KEYS[data.when]) : "";
  const note = el.querySelector<HTMLElement>(".sec-card__note")!;
  setCardText(note, data.note ? data.note[lang] : "");
  note.hidden = !data.note;

  const unit = t("vpUnit");
  // Scored at this turn end, it stays in view with what it gave
  const banked = cardsMode === "end-turn" ? game.secondaries[player].scored.find((entry) => entry.id === id) : undefined;
  el.classList.toggle("is-banked", !!banked);
  const scorable = (cardsMode === "hand" || cardsMode === "end-turn") && !banked;
  const room = roomLeft(player, "secondary");
  const options = data.options.map((option) => {
    if ("vp" in option) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sec-option";
      button.disabled = !scorable;
      button.dataset.action = "score";
      button.dataset.vp = String(option.vp);
      button.innerHTML = `<span class="sec-option__vp">${option.vp}<small>${unit}</small></span><span class="sec-option__label"></span>`;
      setCardText(button.querySelector(".sec-option__label")!, option.label[lang]);
      if (scorable) markOverCap(button, room, option.vp);
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
    setCardText(block.querySelector(".sec-option__label")!, `${option.label[lang]} · ${t("maxVp", { n: option.max })}`);
    block.querySelector(".sec-option__go")!.textContent = `${t("scoreIt")} ${repeatTotal(block)} ${unit}`;
    block.querySelector<HTMLElement>(".sec-option__repeat")!.hidden = !scorable;
    if (scorable) markOverCap(block, room, repeatTotal(block));
    return block;
  });
  el.querySelector(".sec-card__options")!.replaceChildren(...options.map((line, i) => (data.options[i].action ? withActionTag(line) : line)));

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
  if (banked) {
    // In the head, so it still shows with the card folded in a pile
    const badge = document.createElement("span");
    badge.className = "sec-card__banked";
    badge.classList.toggle("is-cut", !!banked.full);
    badge.textContent = banked.full ? t("bankedCut", { vp: banked.vp, full: banked.full, unit }) : t("banked", { vp: banked.vp, unit });
    if (banked.full) badge.title = t("capCut", { vp: banked.vp, full: banked.full, max: MAX_POINTS_PER_TURN });
    el.querySelector(".sec-card__head")!.appendChild(badge);
    const undo = document.createElement("button");
    undo.type = "button";
    undo.className = "sec-action sec-action--undo";
    undo.dataset.action = "unscore";
    undo.textContent = t("unscoreBtn");
    actions.push(undo);
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
    // Picked by mistake from the real deck: back to the deck, the blank comes back
    if (manualDraw() && canEdit(player)) {
      const unpick = document.createElement("button");
      unpick.type = "button";
      unpick.className = "sec-action sec-action--unpick";
      unpick.dataset.action = "unpick";
      unpick.textContent = t("unpickCard");
      actions.push(unpick);
    }
    // A new card for 1 CP: only while drawing, never later from the hand
    const swapCard = document.createElement("button");
    swapCard.type = "button";
    swapCard.className = "sec-action sec-action--discard";
    swapCard.dataset.action = "swap";
    swapCard.textContent = game.newCardUsed[player] ? t("swapUsed") : t("swapCp");
    swapCard.disabled = !canSwapSecondary(player);
    actions.push(swapCard);
  }
  actions.push(cardFoot(data.url, !!data.action));
  el.querySelector(".sec-card__actions")!.replaceChildren(...actions);
  if (data.action) addActionBack(el, data.action, data.name, data.url);
  return el;
}

/**
 * Within, wholly within, not within: the words a mission turns on, set apart wherever they show.
 * Within range of an objective is a rule of its own, left plain
 */
const SPATIAL_WORDS = /(wholly within|not within|within(?! range)|entièrement dans|entièrement hors de|\(même en partie\)|qui touche|à plus de \d+")/;

function setCardText(el: Element, text: string): void {
  el.replaceChildren(
    ...text.split(SPATIAL_WORDS).map((part, i) => {
      if (i % 2 === 0) return document.createTextNode(part);
      const word = document.createElement("b");
      word.className = "kw";
      word.textContent = part;
      return word;
    }),
  );
}

/** The link to the full card on gdmissions.app, and the way to the card's back when it has one */
function cardFoot(url: string, back: boolean): HTMLElement {
  const link = document.createElement("a");
  link.className = "sec-action sec-action--link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `${t("fullCard")} ↗`;
  if (!back) return link;
  const foot = document.createElement("div");
  foot.className = "sec-card__foot";
  foot.append(link, flipButton("sec-flip", `${t("actionTag")} ↻`, t("actionShow")));
  return foot;
}

function flipButton(className: string, text: string, label?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.flip = "";
  button.textContent = text;
  if (label) button.setAttribute("aria-label", label);
  return button;
}

/** A line scored through the card's action: its tag turns the card over, to how the action works */
function withActionTag(line: HTMLElement): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "sec-option-wrap";
  wrap.append(line, flipButton("sec-action-tag", t("actionTag"), t("actionShow")));
  return wrap;
}

/**
 * The back of a card with an action, as on the printed card: when a unit starts it, which one,
 * how often, when it completes and what it does
 */
function addActionBack(el: HTMLElement, action: MissionAction, cardName: string, url: string): void {
  const lang = getLang();
  const back = document.createElement("div");
  back.className = "sec-card__back";
  back.innerHTML = `
    <header class="sec-card__head">
      <span class="sec-card__kicker"></span>
      <h3 class="sec-card__name"></h3>
      <span class="sec-card__when"></span>
    </header>
    <dl class="action-rows"></dl>
    <footer class="sec-card__actions"></footer>`;
  back.querySelector(".sec-card__kicker")!.textContent = t("actionTag");
  back.querySelector(".sec-card__name")!.textContent = action.name;
  // The card's own name, when the action has another one
  back.querySelector(".sec-card__when")!.textContent = cardName === action.name ? "" : cardName;
  const rows: [StringKey, Text | undefined][] = [
    ["actionStarts", action.starts],
    ["actionUnits", action.units],
    ["actionLimit", action.limit],
    ["actionCompletes", action.completes],
    ["actionEffect", action.effect],
    ["actionRestriction", action.restriction],
  ];
  back.querySelector(".action-rows")!.replaceChildren(
    ...rows.flatMap(([key, text]) => {
      if (!text) return [];
      const row = document.createElement("div");
      row.className = "action-row";
      row.classList.toggle("action-row--effect", key === "actionEffect");
      row.innerHTML = "<dt></dt><dd></dd>";
      row.querySelector("dt")!.textContent = t(key);
      setCardText(row.querySelector("dd")!, text[lang]);
      return [row];
    }),
  );
  const foot = document.createElement("div");
  foot.className = "sec-card__foot";
  const link = document.createElement("a");
  link.className = "sec-action sec-action--link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `${t("fullCard")} ↗`;
  foot.append(link, flipButton("sec-flip", `↺ ${t("actionFront")}`));
  back.querySelector(".sec-card__actions")!.replaceChildren(foot);
  el.querySelector(".sec-card__faces")!.appendChild(back);
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
    if (dealIds.length > 0) playSound("draw", dealIds.length);
    // Piled, the gap closes up and the card that comes to the front opens; in a row, they slide over
    if (cardsRow.classList.contains("is-piled")) {
      morphCards(() => renderCards(dealIds), cardShowsInFull);
    } else {
      const before = cardPositions();
      renderCards(dealIds);
      slideCardsFrom(before);
    }
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

const MORPH = "morph";

/** Piled, only the front card shows in full; in a row, all do */
const cardShowsInFull = (card: HTMLElement): boolean =>
  !cardsRow.classList.contains("is-piled") || card.classList.contains("is-front");

/**
 * A card opens while another folds, or leaves the pile: each grows or shrinks from the height it
 * had, a card gone leaves a gap that closes up, and the cards around follow instead of jumping.
 * `isOpen` tells an open card from a folded one; `change` opens and folds them, or deals them
 * again (cards are matched by key)
 */
function morphCards(change: () => void, isOpen: (card: HTMLElement) => boolean): void {
  if (prefersReducedMotion()) {
    change();
    return;
  }
  const rowCards = (): HTMLElement[] => [...cardsRow.querySelectorAll<HTMLElement>(".sec-card")];
  const face = (card: HTMLElement): HTMLElement => card.querySelector<HTMLElement>(".sec-card__inner")!;
  const px = (value: string): number => parseFloat(value) || 0;
  // Computed sizes: in the stage's own pixels, before its zoom; mid-way, where the card is now
  const size = (card: HTMLElement) => {
    const style = getComputedStyle(face(card));
    return {
      face: { height: style.height, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom },
      margin: getComputedStyle(card).marginTop,
      outer: getComputedStyle(card).height,
    };
  };
  const old = rowCards();
  const before = new Map(
    old.map((card) => [cardKey(card), { open: isOpen(card) || card.classList.contains("is-folding"), ...size(card) }]),
  );
  // A card still on its way starts again from where it is
  for (const card of old) {
    for (const anim of [...card.getAnimations(), ...face(card).getAnimations()]) if (anim.id === MORPH) anim.cancel();
    card.classList.remove("is-morphing", "is-folding", "is-opening");
  }
  change();
  const cards = rowCards();
  const kept = new Map(cards.map((card) => [cardKey(card), card]));
  // Piled, the room a card gone took: the next card starts that much lower and rises (a row slides, elsewhere)
  const gapAbove = new Map<HTMLElement, number>();
  let gap = 0;
  let lastKept: HTMLElement | null = null;
  const piled = cardsRow.classList.contains("is-piled");
  for (const [key, from] of piled ? before : []) {
    const card = kept.get(key);
    if (!card) {
      gap += px(from.outer) + px(from.margin);
      continue;
    }
    if (gap) gapAbove.set(card, gap);
    gap = 0;
    lastKept = card;
  }
  // A card dealt in its place takes some of that room back
  let dealt = 0;
  for (const card of piled ? cards : []) {
    if (!before.has(cardKey(card))) {
      dealt += px(getComputedStyle(card).height) + px(getComputedStyle(card).marginTop);
      continue;
    }
    if (dealt) gapAbove.set(card, (gapAbove.get(card) ?? 0) - dealt);
    dealt = 0;
  }
  gap -= dealt;
  const timing: KeyframeAnimationOptions = { duration: CARD_SLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", id: MORPH };
  if (gap > 0 && lastKept) {
    lastKept.animate([{ marginBottom: `${gap}px` }, { marginBottom: getComputedStyle(lastKept).marginBottom }], timing);
  }
  for (const card of cards) {
    const from = before.get(cardKey(card));
    // A card just dealt flies in on its own
    if (!from) continue;
    const to = size(card);
    const opens = !from.open && isOpen(card);
    const folds = from.open && !isOpen(card);
    const margin = `${px(from.margin) + (gapAbove.get(card) ?? 0)}px`;
    if (!opens && !folds && from.face.height === to.face.height && px(margin) === px(to.margin)) continue;
    card.classList.add("is-morphing");
    card.classList.toggle("is-opening", opens);
    card.classList.toggle("is-folding", folds);
    card.animate([{ marginTop: margin }, { marginTop: to.margin }], timing);
    face(card)
      .animate([from.face, to.face], timing)
      .finished.then(
        () => card.classList.remove("is-morphing", "is-folding", "is-opening"),
        () => {},
      );
  }
}

function scoreSecondary(player: Player, id: string, vp: number, cardEl: HTMLElement): void {
  const turn = scoringTurnIdx(player);
  const added = addSecondaryPoints(player, vp);
  moveSecondary(player, id, "discard");
  // Cut short by the 15 a turn allows: the report says so
  game.secondaries[player].scored.push({ id, vp: added, turn, ...(added < vp ? { full: vp } : {}) });
  playSound("score");
  if (cardsMode === "end-turn") bankSecondary(player, id, added);
  else playCardExit(cardEl, "is-scored", `+${added}`);
}

/**
 * At a turn end a scored card stays on the table, stamped with what it gave, so the turn's tally
 * can be read card by card. In a pile the next card to score comes forward; in a row the card
 * just scored stays on top, no other card comes over it
 */
function bankSecondary(player: Player, id: string, added: number): void {
  // Piled, no secondary left to score: the last card still holding something comes forward (the primary)
  frontCardKey = cardsRow.classList.contains("is-piled")
    ? (endTurnIds(player).find((cardId) => game.secondaries[player].hand.includes(cardId)) ?? null)
    : id;
  settleEndTurn();
  const card = cardsRow.querySelector<HTMLElement>(`.sec-card[data-card-id="${CSS.escape(id)}"]`);
  if (!card || prefersReducedMotion()) return;
  const burst = document.createElement("span");
  burst.className = "sec-card__burst is-banked";
  burst.textContent = `+${added}`;
  burst.addEventListener("animationend", () => burst.remove());
  card.appendChild(burst);
}

/**
 * At a turn end on a phone, the cards scored gather at the foot of the pile in one receipt, in
 * the order they were scored; the cards still to score keep the room above. Only the visual order
 * changes (flex `order`): the elements stay, so nothing restarts. While a card opens or folds the
 * receipt holds still, then it gathers, each card gliding to its place
 */
let receiptHold = false;
let regroupTimer: number | null = null;

function groupEndTurnPile(animate: boolean): void {
  if (receiptHold || cardsPlayer === null) return;
  const gathered = cardsMode === "end-turn" && cardsRow.classList.contains("is-piled");
  const cards = [...cardsRow.children].filter((el): el is HTMLElement => el.classList.contains("sec-card"));
  const scoredOrder = game.secondaries[cardsPlayer].scored.map(({ id }) => id);
  const receipt = gathered
    ? cards
        .filter((card) => card.classList.contains("is-banked"))
        .sort((a, b) => scoredOrder.indexOf(a.dataset.cardId!) - scoredOrder.indexOf(b.dataset.cardId!))
    : [];
  const before = animate ? cardPositions() : null;
  for (const card of cards) {
    const at = receipt.indexOf(card);
    card.style.order = at >= 0 ? String(100 + at) : "";
    card.classList.toggle("is-receipt", at >= 0);
    card.classList.toggle("is-receipt-first", at === 0);
    card.classList.toggle("is-receipt-last", at >= 0 && at === receipt.length - 1);
    if (at === 0) card.dataset.receiptLabel = t("receiptLabel");
    else delete card.dataset.receiptLabel;
  }
  if (before) slideCardsFrom(before);
}

/** A card scored or taken back at a turn end: it folds or opens in place, then the receipt gathers */
function settleEndTurn(): void {
  receiptHold = true;
  morphCards(() => renderCards(), cardShowsInFull);
  if (regroupTimer !== null) window.clearTimeout(regroupTimer);
  regroupTimer = window.setTimeout(
    () => {
      regroupTimer = null;
      receiptHold = false;
      groupEndTurnPile(!prefersReducedMotion());
    },
    prefersReducedMotion() ? 0 : CARD_SLIDE_MS + 40,
  );
}

/**
 * The cards of this turn end, in the order they came up: first those already scored in the turn
 * the points go to (from the hand, mid-turn), then those still to score. A card scored here stays
 * in its place
 */
let endTurnOrder: Partial<Record<Player, string[]>> = {};

function endTurnIds(owner: Player): string[] {
  const pile = game.secondaries[owner];
  const turn = scoringTurnIdx(owner);
  const scoredNow = pile.scored.filter((entry) => entry.turn === turn).map(({ id }) => id);
  const order = (endTurnOrder[owner] ?? []).filter((id) =>
    pile.hand.includes(id) ? scoresAtTurnEnd(owner, SECONDARY_BY_ID.get(id)!.when) : scoredNow.includes(id),
  );
  for (const id of [...scoredNow, ...turnEndSecondaries(owner)]) if (!order.includes(id)) order.push(id);
  endTurnOrder[owner] = order;
  return order;
}

/** Points a turn still allows, for the player's scoring turn */
const roomLeft = (player: Player, kind: ScoreKind): number =>
  Math.max(0, MAX_POINTS_PER_TURN - game.scoreByTurn[player][kind][scoringTurnIdx(player)]);

/** Said under a score worth more than the turn still allows: what will count of it */
function capNote(room: number, vp: number): string {
  if (vp <= room) return "";
  return room === 0 ? t("capReached") : t("capCounts", { n: room, unit: t("vpUnit") });
}

/** A score line, marked when the 15-point cap would cut it */
function markOverCap(line: HTMLElement, room: number, vp: number): void {
  const note = capNote(room, vp);
  line.classList.toggle("is-over-cap", note !== "");
  let small = line.querySelector<HTMLElement>(":scope > .sec-option__cap");
  if (!note) {
    small?.remove();
    return;
  }
  if (!small) {
    small = document.createElement("small");
    small.className = "sec-option__cap";
    line.appendChild(small);
  }
  small.textContent = note;
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
  delete game.cardRounds[player][id]?.discarded;
  const turns = game.scoreByTurn[player].secondary;
  turns[scored.turn] = Math.max(0, turns[scored.turn] - scored.vp);
  playSound("undo");
  renderMiniCounters();
  if (cardsPlayer !== player) return;
  // At a turn end the card opens where it was, then leaves the receipt for the cards to score
  if (cardsMode === "end-turn") {
    frontCardKey = id;
    settleEndTurn();
    return;
  }
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
  replaceDrawn(player, id, replacement);
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
  replaceDrawn(player, id, replacement);
  // Back to the deck it goes the way it came, to the discard it falls
  playCardExit(cardEl, data.redraw.to === "deck" ? "is-returned" : "is-discarded", undefined, [replacement]);
}

/* ---------- Force dispositions and primary missions ---------- */

/** With the cards on, the game starts by choosing force dispositions */
function requestStart(): void {
  if (secondaryCardsOn()) chooseDispositions();
  else openChooserToss();
}

/** In a room, the choice opens on every screen: whoever picks, everyone sees it as it is made */
function chooseDispositions(): void {
  if (roomSession()) {
    game.choosing = true;
    game.dispositions = { 1: null, 2: null };
    game.primaries = { 1: null, 2: null };
  }
  openDispositions();
}

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
  // Nothing is hidden in this game: both choices show on every screen. A phone picks for its own player
  dispoOverlay.querySelectorAll<HTMLElement>(".dispo-options").forEach((group) => {
    const player = Number(group.dataset.player) as Player;
    group.querySelectorAll<HTMLButtonElement>(".dispo-option").forEach((option) => {
      const data = DISPOSITIONS.find(({ id }) => id === option.dataset.value)!;
      option.setAttribute("aria-pressed", String(game.dispositions[player] === data.id));
      option.disabled = !!seat && player !== seat;
      option.querySelector(".dispo-option__hint")!.textContent = data.hint[lang];
    });
  });
  dispoIntro.textContent = t(seat ? "dispoYourIntro" : "dispoIntro");
  btnDispoOk.querySelector("span")!.textContent = t("dispoConfirm");
  btnDispoOk.disabled = !game.dispositions[1] || !game.dispositions[2];
  // In a room, the player still to choose, once the other has
  const waiting = ([1, 2] as const).filter((player) => !game.dispositions[player]);
  const status = roomSession() && waiting.length === 1 ? t("onlineWaiting", { n: waiting[0] }) : null;
  dispoStatus.hidden = !status;
  if (status) dispoStatus.textContent = status;
}

/** Both dispositions in: each player gets the card of their deck facing the other's, on every screen */
function confirmDispositions(): void {
  const [first, second] = [game.dispositions[1], game.dispositions[2]];
  if (!first || !second) return;
  game.choosing = false;
  game.primaries = { 1: primaryFor(first, second).id, 2: primaryFor(second, first).id };
  game.primaryScored = { 1: {}, 2: {} };
  game.primaryFull = { 1: {}, 2: {} };
  showPrimaries();
}

function cancelDispositions(): void {
  // In a room, called off on every screen
  if (roomSession()) game.choosing = false;
  closeDispositions();
}

/** The two primary missions face off on the VS */
function showPrimaries(): void {
  closeDispositions();
  // From now on each player's mission can be read from the board, through the deployment too
  renderHandButtons();
  // The battle music rises with the VS
  setBattleMusic(true);
  openCards(online?.seat ?? 1, "primary");
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
    <div class="sec-card__faces">
      <div class="sec-card__inner">
        <header class="sec-card__head">
          <span class="sec-card__kicker"></span>
          <h3 class="sec-card__name"></h3>
          <span class="sec-card__when"></span>
        </header>
        <p class="sec-card__note"></p>
        <div class="pri-sections"></div>
        <footer class="sec-card__actions"></footer>
      </div>
    </div>`;
  el.querySelector(".sec-card__kicker")!.textContent = `${t("primaryKicker")} · ${t("player", { n: player })}`;
  el.querySelector(".sec-card__name")!.textContent = data.name;
  // The force disposition this card belongs to
  el.querySelector(".sec-card__when")!.textContent = DISPOSITIONS.find(({ id }) => id === data.deck)!.name;
  const note = el.querySelector<HTMLElement>(".sec-card__note")!;
  setCardText(note, data.note ? data.note[lang] : "");
  note.hidden = !data.note;

  const scored = game.primaryScored[player];
  // The end bonus is apart: only the turn's lines count toward its 15
  const primaryRoom = roomLeft(player, "primary");
  const sections = data.sections.map((section, s) => {
    const turnKey = sectionTurnKey(player, section);
    // At a turn end, only what scores at that moment: a Command phase line waits for the next turn
    const scoresNow = sectionOpen(player, section) && scoresInView(player, section.when);
    const open = scorable && scoresNow;
    const block = document.createElement("section");
    block.className = "pri-section";
    // Dimmed out of its rounds while playing; on the VS the whole card reads at full strength
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
        // Cut short by the turn's 15: what counted / what the line was worth
        const cutFrom = done !== undefined ? game.primaryFull?.[player]?.[key] : undefined;
        button.classList.toggle("is-cut", cutFrom !== undefined);
        if (cutFrom !== undefined) button.title = `${t("capCut", { vp: shown, full: cutFrom, max: MAX_POINTS_PER_TURN })} · ${t("scoredUndo")}`;
        button.innerHTML = `<span class="sec-option__vp">${done !== undefined ? "✓" : ""}${shown}${cutFrom !== undefined ? `<span class="sec-option__full">/${cutFrom}</span>` : ""}<small>${unit}</small></span><span class="sec-option__label"></span>`;
        setCardText(button.querySelector(".sec-option__label")!, item.label[lang]);
        if (!blocked && done === undefined && turnKey !== "end" && "vp" in item) markOverCap(button, primaryRoom, item.vp);
        block.appendChild(item.action ? withActionTag(button) : button);
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
      setCardText(
        row.querySelector(".sec-option__label")!,
        "per" in item ? item.label[lang] : `${item.label[lang]} · +${item.plus.per} ${item.plus.label[lang]}`,
      );
      if ("per" in item && extra) {
        const bonus = document.createElement("span");
        bonus.className = "sec-option__bonus";
        bonus.innerHTML = `<span class="sec-option__bonus-label"></span>${stepperHtml("bonus", 0)}`;
        setCardText(bonus.querySelector(".sec-option__bonus-label")!, `+${extra.per} · ${extra.label[lang]}`);
        row.insertBefore(bonus, row.querySelector(".sec-option__repeat"));
      }
      const go = row.querySelector<HTMLButtonElement>(".sec-option__go")!;
      go.dataset.section = String(s);
      go.dataset.item = String(i);
      go.textContent = `${t("scoreIt")} ${itemTotal(item, row)} ${unit}`;
      row.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
        button.disabled = blocked;
      });
      row.querySelector<HTMLElement>(".sec-option__repeat")!.hidden = !scorable;
      if (!blocked && turnKey !== "end") markOverCap(row, primaryRoom, itemTotal(item, row));
      block.appendChild(item.action ? withActionTag(row) : row);
    });
    return block;
  });
  el.querySelector(".pri-sections")!.replaceChildren(...sections);

  el.querySelector(".sec-card__actions")!.replaceChildren(cardFoot(data.url, !!data.action));
  if (data.action) addActionBack(el, data.action, data.name, data.url);
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
  // States from before the cap was recorded have no such field
  game.primaryFull ??= { 1: {}, 2: {} };
  const full = game.primaryFull[player];
  const done = scored[key];
  // The points of a line leave the turn, or the end bonus, they went to
  const takeBack = (lineKey: string, points: number): void => {
    delete scored[lineKey];
    delete full[lineKey];
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
    // Cut short by the 15 a turn allows: the card and the report say so
    if (added < vp) full[key] = vp;
    playSound("score");
  }
  renderMiniCounters();
  // A counted line becomes a one-line ✓ and back: the card shrinks or grows to it
  morphCards(() => renderCards(), cardShowsInFull);
}

function adjustScore(player: Player, kind: ScoreKind, delta: 1 | -1): void {
  if (!canEdit(player)) return;
  const turns = game.scoreByTurn[player][kind];
  const turnIdx = scoringTurnIdx(player);
  if (delta > 0) {
    if (turns[turnIdx] >= MAX_POINTS_PER_TURN) return;
    turns[turnIdx] += 1;
  } else {
    // The −/+ work on this turn's points: a minus never takes back an earlier turn's
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
  if (delta === 0 || !canEdit(player)) return;
  const current = game.cp[player];
  const next = clampCp(current + delta);
  const applied = next - current;
  if (applied === 0) return;
  game.cp[player] = next;
  if (inGame(game)) recordCpManualAdjust(player, currentPlayerTurnSlot(), applied);
  renderMiniCounters();
  if (applied < 0 && inGame(game)) burnCp(player, -applied);
}

const cpBurnEl = app.querySelector<HTMLElement>("#cp-burn")!;
const CP_SPARKS = 26;
/** The longest spark, after the burst */
const CP_BURN_TAIL_MS = 1100;
let cpBurnTimer = 0;

/** A command point spent: it catches fire in the player's color and bursts on the sound's impact, over everything, stopping nothing */
function burnCp(player: Player, spent: number): void {
  const burstAt = (playSound("cpBurn") ?? 0) + CP_BURST_SEC;
  buzz([40, 30, 90]);
  cpBurnEl.style.setProperty("--burn", `var(--p${player})`);
  cpBurnEl.style.setProperty("--burst-at", `${burstAt}s`);
  cpBurnEl.querySelector(".cp-burn__n")!.textContent = String(spent);
  const sparks = Array.from({ length: CP_SPARKS }, (_, i) => {
    const spark = document.createElement("i");
    // Thrown all around, and carried up by the heat
    const angle = (i / CP_SPARKS) * Math.PI * 2 + Math.random() * 0.35;
    const reach = 14 + Math.random() * 22;
    spark.style.setProperty("--dx", `${Math.cos(angle) * reach}vmin`);
    spark.style.setProperty("--dy", `${Math.sin(angle) * reach * 0.6 - 8 - Math.random() * 12}vmin`);
    spark.style.setProperty("--life", `${0.6 + Math.random() * 0.5}s`);
    spark.style.setProperty("--size", `${0.35 + Math.random() * 0.4}rem`);
    return spark;
  });
  cpBurnEl.querySelector(".cp-burn__sparks")!.replaceChildren(...sparks);
  // A second one in a row starts over
  cpBurnEl.classList.remove("is-burning");
  void cpBurnEl.offsetWidth;
  cpBurnEl.classList.add("is-burning");
  window.clearTimeout(cpBurnTimer);
  cpBurnTimer = window.setTimeout(() => cpBurnEl.classList.remove("is-burning"), burstAt * 1000 + CP_BURN_TAIL_MS);
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
  if (!canEdit(player)) return;
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
    const tile = target.closest<HTMLButtonElement>(".cp-tile--use");
    if (tile) {
      useCpTile(player, Number(tile.dataset.abilityId));
      return;
    }
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
  const lost = target.closest<HTMLButtonElement>(".ability-lost");
  if (lost) {
    toggleAbilityLost(abilitiesPlayer, Number(lost.dataset.abilityId));
    return;
  }
  const toggle = target.closest<HTMLButtonElement>(".ability-toggle");
  if (toggle) toggleAbilitySlot(abilitiesPlayer, toggle.dataset.slot as AbilitySlot);
});
btnAbilitiesClose.addEventListener("click", closeAbilities);

for (const player of [1, 2] as const) {
  handButtonEl[player].addEventListener("click", () => openCards(player, "hand"));
  primaryButtonEl[player].addEventListener("click", () => openCards(player, "mission"));
}
cardsSwitch.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  if (tab && !tab.disabled) showCardsTab(tab.dataset.tab!);
});
/** Continue: after the primaries' VS, the game starts */
function continueCards(): void {
  if (cardsPlayer === null || btnCardsClose.disabled) return;
  const startsGame = cardsMode === "primary";
  const turnEnd = cardsMode === "end-turn" ? endTurnKind : null;
  // The VS stays up behind the coin toss: cancelling it goes back to the missions
  if (startsGame) {
    openChooserToss();
    return;
  }
  closeCards();
  if (turnEnd) applyConfirmed(turnEnd);
}

btnCardsClose.addEventListener("click", continueCards);
// The board behind is out of reach; a click beside the cards goes back to it, as Escape does.
// Not the second click of a double-click: that one would close what the first click opened.
// Not on the primaries' VS either: the game starts from there, a stray click must not cancel it
cardsOverlay.addEventListener("click", (e) => {
  // Nor a draw from the real deck with a card still to pick: the turn waits for it
  if (cardsPlayer === null || cardsMode === "primary" || e.detail > 1 || drawPending()) return;
  if ((e.target as HTMLElement).closest(".sec-card, button, a")) return;
  closeCards();
});
dispoOverlay.addEventListener("click", (e) => {
  const option = (e.target as HTMLElement).closest<HTMLButtonElement>(".dispo-option");
  if (!option || option.disabled) return;
  const player = Number(option.closest<HTMLElement>(".dispo-options")!.dataset.player) as Player;
  if (online && player !== online.seat) return;
  game.dispositions[player] = option.dataset.value as Disposition;
  renderDispositions();
});
btnDispoOk.addEventListener("click", confirmDispositions);
btnDispoCancel.addEventListener("click", cancelDispositions);
window.addEventListener("resize", () => {
  if (cardsPlayer !== null) layoutCardsRow();
});
onSegmentedPick(cardsSourcePicker, (value) => setCardsSource(value as CardsSource));
let touchedCards = false;
cardsRow.addEventListener("pointerdown", (e) => {
  touchedCards = e.pointerType !== "mouse";
});
// A card under others, piled or fanned under a finger that has no hover: the first tap only
// brings it to the front, never presses the button or the link half hidden where it landed
cardsRow.addEventListener(
  "click",
  (e) => {
    const touch = touchedCards;
    touchedCards = false;
    const card = (e.target as HTMLElement).closest<HTMLElement>(".sec-card");
    const piled = cardsRow.classList.contains("is-piled");
    const covered = piled || (touch && cardsRow.classList.contains("is-fanned"));
    if (!card || !covered || card.classList.contains("is-front")) return;
    e.preventDefault();
    e.stopPropagation();
    frontCardKey = cardKey(card);
    playSound("slide");
    if (!piled) {
      placeFrontCard();
      return;
    }
    // Pulled out of the pile: it opens where it was as the open one folds back, then it comes into view
    morphCards(placeFrontCard, cardShowsInFull);
    window.setTimeout(() => {
      card.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }, CARD_SLIDE_MS);
  },
  true,
);
// The card turns over to its action and back: on every screen, the opponent's cards too
cardsRow.addEventListener("click", (e) => {
  const card = (e.target as HTMLElement).closest("[data-flip]")?.closest<HTMLElement>(".sec-card");
  if (!card) return;
  e.stopImmediatePropagation();
  playSound("flip");
  const flipped = card.classList.toggle("is-flipped");
  if (!prefersReducedMotion()) turnCard(card.querySelector<HTMLElement>(".sec-card__faces")!, flipped);
  if (flipped) flippedCards.add(cardKey(card));
  else flippedCards.delete(cardKey(card));
});
// The VS on a phone shows one mission in full: a tap on the short one opens it and folds the other
cardsRow.addEventListener("click", (e) => {
  const short = (e.target as HTMLElement).closest<HTMLElement>(".sec-card--primary.is-compact");
  if (cardsMode !== "primary" || !short) return;
  e.stopImmediatePropagation();
  // One grows as the other shrinks, the VS carried between them
  morphCards(
    () => {
      for (const card of cardsRow.querySelectorAll<HTMLElement>(".sec-card--primary")) {
        const folds = card !== short;
        card.classList.toggle("is-compact", folds);
        // Folded, a card shows its name: turned to its action, it would show nothing at all
        if (folds && card.classList.contains("is-flipped")) {
          card.classList.remove("is-flipped");
          flippedCards.delete(cardKey(card));
        }
      }
    },
    (card) => !card.classList.contains("is-compact"),
  );
  playSound("draw");
});
cardsRow.addEventListener("click", (e) => {
  if (cardsPlayer !== null && !canEdit(cardsPlayer)) return;
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
    if (!inGame(game) || (online && owner !== online.seat)) return;
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
      if (String(value) !== row.dataset[field]) playSound(Number(button.dataset.delta) > 0 ? "stepUp" : "stepDown");
      row.dataset[field] = String(value);
      // Fewer things than bonus things makes no sense
      if (Number(row.dataset.bonus) > Number(row.dataset.count)) row.dataset.bonus = row.dataset.count;
      row.querySelectorAll<HTMLElement>("[data-value]").forEach((span) => {
        span.textContent = row.dataset[span.dataset.value === "bonus" ? "bonus" : "count"] ?? "0";
      });
      row.querySelector(".sec-option__go")!.textContent = `${t("scoreIt")} ${itemTotal(item, row)} ${t("vpUnit")}`;
      if (card.sections[s].rounds !== "end") markOverCap(row, roomLeft(owner, "primary"), itemTotal(item, row));
      return;
    }
    if (button.dataset.action === "pri-score") togglePrimaryScore(owner, s, i, row ? itemTotal(item, row) : "vp" in item ? item.vp : 0);
    return;
  }
  if (!button || !cardEl || cardsPlayer === null || cardEl.matches(".is-scored, .is-discarded")) return;
  const player = cardsPlayer;
  const id = cardEl.dataset.cardId!;
  // A card scored at this turn end, taken back: asked first, as from the scored cards
  if (button.dataset.action === "unscore") {
    askUnscore(player, id);
    return;
  }
  if (cardEl.matches(".is-banked")) return;
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
      if (String(count) !== option.dataset.count) playSound(delta > 0 ? "stepUp" : "stepDown");
      option.dataset.count = String(count);
      option.querySelector(".sec-option__count")!.textContent = String(count);
      option.querySelector(".sec-option__go")!.textContent = `${t("scoreIt")} ${repeatTotal(option)} ${t("vpUnit")}`;
      markOverCap(option, roomLeft(player, "secondary"), repeatTotal(option));
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
    case "unpick":
      if (cardsMode === "draw") unpickDrawnCard(player, id, cardEl);
      break;
    case "choose":
      if (cardsMode === "draw") openChooser(cardEl, !coarsePointer());
      break;
    case "pick":
      // Already picked meanwhile (on another device): the lists come back with what is left in the deck
      if (cardsMode === "draw" && !pickDrawnCard(player, id, button.dataset.value!, cardEl)) renderCards();
      break;
  }
});
// The search narrows the list as it is typed
cardsRow.addEventListener("input", (e) => {
  const search = (e.target as HTMLElement).closest<HTMLInputElement>(".card-chooser__search");
  const cardEl = search?.closest<HTMLElement>(".sec-card.is-blank");
  if (search && cardEl) renderChooserList(cardEl, search.value);
});
/**
 * In the list, the keys are its own: the arrows move, Enter takes the first card found, Escape
 * folds it back. None reaches the board (Space would switch the clock)
 */
cardsRow.addEventListener("keydown", (e) => {
  const chooser = (e.target as HTMLElement).closest<HTMLElement>(".card-chooser");
  if (!chooser) return;
  e.stopPropagation();
  const cardEl = chooser.closest<HTMLElement>(".sec-card")!;
  const search = chooser.querySelector<HTMLInputElement>(".card-chooser__search")!;
  const options = [...chooser.querySelectorAll<HTMLButtonElement>(".card-chooser__option")];
  const at = options.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") {
    e.preventDefault();
    closeChooser(cardEl);
    cardEl.querySelector<HTMLElement>(".sec-card__blank")!.focus();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    options[Math.min(options.length - 1, at + 1)]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (at <= 0) search.focus();
    else options[at - 1].focus();
  } else if (e.key === "Enter" && e.target === search) {
    e.preventDefault();
    options[0]?.click();
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
  logClock("turn", { player: game.firstPlayer });
  handClock(game.firstPlayer);
  game.turnPlayer = game.firstPlayer;
  gainCpBothPlayers();
  startRoundAbilities();
  lastSpaceTime = 0;
  activeBeforeSpaceSequence = game.firstPlayer;
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
  lastSpaceTime = 0;
  game.phase = "running";
  logClock("resume");
  handClock(game.clock.active);
  setInputsEnabled(false);
  setActivePanels();
  applyTimesToDisplay();
  updateButtons();
  void tryAcquireWakeLock();
  startLoop();
}

btnReset.addEventListener("click", () => {
  if (inGame(game) && !isOver()) openEndGame();
  else if (inGame(game)) openTurnConfirmModal("reset");
  else reset();
});
btnEndGameCancel.addEventListener("click", closeEndGame);
endGameOverlay.addEventListener("click", (e) => {
  if (e.target === endGameOverlay) closeEndGame();
});
for (const player of [1, 2] as const) {
  app.querySelector("#end-game-concede-" + player)!.addEventListener("click", () => concede(player));
}
app.querySelector("#end-game-untimed")!.addEventListener("click", finishWithoutClocks);
app.querySelector("#end-game-erase")!.addEventListener("click", () => {
  closeEndGame();
  reset();
});
btnFullscreen.addEventListener("click", toggleFullscreen);
btnTurnConfirmOk.addEventListener("click", applyTurnConfirm);
btnTurnConfirmCancel.addEventListener("click", hideTurnConfirmModal);
btnResultDismiss.addEventListener("click", hideResultOverlay);
btnJudge.addEventListener("click", callJudge);
app.querySelector("#btn-judge-resume")!.addEventListener("click", endJudgeCall);
for (const id of ["#btn-judge-log", "#btn-result-log"]) app.querySelector(id)!.addEventListener("click", openClockLog);
app.querySelector("#btn-log-close")!.addEventListener("click", closeClockLog);
app.querySelector("#btn-log-copy")!.addEventListener("click", copyClockLog);
app.querySelector("#btn-result-export")!.addEventListener("click", () => void exportBattleReport());
app.querySelector("#btn-toss-start")!.addEventListener("click", startBattle);
app.querySelector("#btn-toss-cancel")!.addEventListener("click", cancelToss);
app.querySelector("#btn-toss-fix")!.addEventListener("click", correctFirstToss);
app.querySelector("#toss-choices")!.addEventListener("click", (e) => {
  const choice = (e.target as HTMLElement).closest<HTMLElement>("[data-deploy-first]");
  if (choice) startDeployment(choice.dataset.deployFirst === "2" ? 2 : 1);
});
deployClockToggle.addEventListener("change", () => {
  game.options.deployClock = deployClockToggle.checked;
  deployClockToggle.blur();
});
judgeOverlay.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>("[data-judge-player]");
  if (!button) return;
  adjustTime(button.dataset.judgePlayer === "2" ? 2 : 1, Number(button.dataset.judgeSeconds));
});
btnPhotoResume.addEventListener("click", endPhotoBreak);
for (const id of ["#btn-photo-take", "#btn-photo-retake"]) app.querySelector(id)!.addEventListener("click", () => photoInput.click());
// Taken, then left out: the break ends without it
app.querySelector("#btn-photo-skip")!.addEventListener("click", () => {
  if (photoShotFile && breakTurn) void dropPhoto(breakTurn);
  endPhotoBreak();
});
// The camera closes on its own once the photo is taken, and hands it back here
photoInput.addEventListener("change", () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  // The break may have ended on the other phone while this one was in the camera: the photo is kept all the same
  const turn = breakTurn;
  if (!file || !turn) return;
  if (game.photoBreak) showPhotoShot(file);
  void keepPhoto(turn, file);
});
// The photo is already kept: the clocks go again
app.querySelector("#btn-photo-save")!.addEventListener("click", endPhotoBreak);

/* ---------- End screen: photos, MVPs, report detail ---------- */

resultOverlay.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const shot = target.closest<HTMLElement>("[data-story-turn]");
  if (shot) {
    const [round, player] = shot.dataset.storyTurn!.split("_").map(Number);
    openViewer({ round, player: player === 2 ? 2 : 1 });
    return;
  }
  if (target.closest("#btn-final-photo")) {
    finalPhotoInput.click();
    return;
  }
  const mvp = target.closest<HTMLElement>("[data-mvp-open]");
  if (mvp) {
    openMvp(mvp.dataset.mvpOpen === "2" ? 2 : 1);
    return;
  }
  if (target.closest("[data-report-fold]")) {
    // Both players at once, to compare their cards; remembered on this device
    const index = [...resultOverlay.querySelectorAll("[data-report-fold]")].indexOf(target.closest("[data-report-fold]")!);
    reportDetailOpen = !reportDetail();
    playSound("slide");
    store(REPORT_DETAIL_STORAGE_KEY, reportDetailOpen ? "open" : "folded");
    const players = resultOverlay.querySelector<HTMLElement>(".report-players")!;
    const spent = timeByRound();
    players.innerHTML = `${reportPlayer(1, spent, false)}${reportPlayer(2, spent, false)}`;
    resultOverlay.querySelectorAll<HTMLElement>("[data-report-fold]")[Math.max(0, index)]?.focus({ preventScroll: true });
  }
});
app.querySelector("#btn-result-photos")!.addEventListener("click", openSave);
// The last turn has no photo break: its photo is taken from the end screen
finalPhotoInput.addEventListener("change", () => {
  const file = finalPhotoInput.files?.[0];
  finalPhotoInput.value = "";
  if (file) void keepPhoto(lastTurn(), file);
});

mvpOverlay.addEventListener("input", (e) => {
  const input = e.target as HTMLInputElement;
  const match = /^mvp-(unit|feat)-([12])$/.exec(input.id);
  if (!match || !mvpDraft) return;
  mvpDraft[match[2] === "2" ? 2 : 1][match[1] === "unit" ? "unit" : "feat"] = input.value;
  updateMvpCrown();
});
mvpOverlay.addEventListener("click", (e) => {
  if (e.target === mvpOverlay) {
    closeMvp();
    return;
  }
  const shoot = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mvp-shoot]");
  if (shoot) {
    mvpShooting = shoot.dataset.mvpShoot === "2" ? 2 : 1;
    mvpPhotoInput.click();
    return;
  }
  const clear = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mvp-clear]");
  if (clear && mvpDraft) {
    mvpDraft[clear.dataset.mvpClear === "2" ? 2 : 1].photo = null;
    renderMvpPicks();
    return;
  }
  const pick = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mvp-pick]");
  if (!pick || !mvpDraft) return;
  const player: Player = pick.dataset.mvpPick === "2" ? 2 : 1;
  const [round, by] = (pick.dataset.turn ?? "").split("_").map(Number);
  const turn: PhotoTurn = { round, player: by === 2 ? 2 : 1 };
  const current = mvpDraft[player].photo;
  // The MVP's own photo, already the one picked: a tap takes it again
  if (isMvpShot(turn) && current && sameTurn(current, turn)) {
    mvpShooting = player;
    mvpPhotoInput.click();
    return;
  }
  mvpDraft[player].photo = turn;
  renderMvpPicks();
});
/** The player whose MVP the camera is shooting */
let mvpShooting: Player = 1;
// Taken, it becomes the MVP's photo at once; it shows in the picks once kept
mvpPhotoInput.addEventListener("change", () => {
  const file = mvpPhotoInput.files?.[0];
  mvpPhotoInput.value = "";
  if (!file || !mvpDraft) return;
  const player = mvpShooting;
  mvpDraft[player].photo = mvpShot(player);
  void keepPhoto(mvpShot(player), file);
});
app.querySelector("#btn-mvp-cancel")!.addEventListener("click", closeMvp);
btnMvpCrown.addEventListener("click", crownMvps);

app.querySelector("#btn-viewer-close")!.addEventListener("click", closeViewer);
app.querySelector("#btn-viewer-prev")!.addEventListener("click", () => stepViewer(-1));
app.querySelector("#btn-viewer-next")!.addEventListener("click", () => stepViewer(1));
app.querySelector("#btn-viewer-zoom")!.addEventListener("click", () => zoomTo(zoom.s > 1 ? 1 : 2.5));
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
  // The display menu opened during a game: the space bar still passes the clock from there
  if (el.closest(".settings__panel")) return false;
  if (el.closest(".mini-counter")) return true;
  if (el.closest(".panel-corner")) return true;
  return isTypingTarget(el);
}

function isButtonTarget(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && !!el.closest("button");
}

/** Space bar and taps on the timer area (same behavior) */
function handleSpaceLikeInput(): void {
  if (game.judgeCall !== null) return;
  if (isDeploying()) {
    passDeployment();
    return;
  }
  if (!isRunning()) {
    if (isOver()) return;
    if (isStopped(game)) resume();
    else return;
    return;
  }

  if (online && game.clock.active !== online.seat) return;
  const now = performance.now();
  // Two quick presses pause, unless the tournament leaves that to the judge: then each one switches
  if (!pauseLocked() && lastSpaceTime > 0 && now - lastSpaceTime < DOUBLE_SPACE_MS) {
    delete game.clockLog[lastSwitchLog];
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
  // The tournament dialog is a form: its keys type, Escape closes it
  if (eventOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeEventSetup();
    }
    return;
  }
  // The end screen's dialogs are forms and a photo viewer: keys keep their usual meaning there
  if (viewerOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") closeViewer();
    else if (e.key === "ArrowLeft") stepViewer(-1);
    else if (e.key === "ArrowRight") stepViewer(1);
    else return;
    e.preventDefault();
    return;
  }
  if (endGameOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeEndGame();
    } else if (e.code === "Space") e.preventDefault();
    return;
  }
  if (mvpOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMvp();
    } else if (e.code === "Enter" && isTypingTarget(e.target) && !btnMvpCrown.disabled) {
      e.preventDefault();
      crownMvps();
    }
    return;
  }
  if (saveOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape" && saveStep !== "writing") {
      e.preventDefault();
      closeSave();
    }
    return;
  }
  if (logOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeClockLog();
    }
    return;
  }
  // A judge at the table: only the judge's screen answers, so no key restarts a clock by mistake
  if (judgeOverlay.classList.contains("is-visible")) return;
  // Over everything else on screen: the clock out of time is handed over first
  if (timeOutOverlay.classList.contains("is-visible")) {
    if ((e.code === "Space" || e.code === "Enter") && !e.repeat) {
      e.preventDefault();
      btnTimeOut.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideTimeOut();
    }
    return;
  }
  if (tossOverlay.classList.contains("is-visible")) {
    if (e.key === "Escape") cancelToss();
    else if (e.code === "Enter" && !e.repeat && game.preBattle?.step === "first") startBattle();
    if (e.key === "Escape" || e.code === "Enter" || e.code === "Space") e.preventDefault();
    return;
  }
  if (e.code === JUDGE_KEY_CODE && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target) && inGame(game) && !isOver()) {
    e.preventDefault();
    callJudge();
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
    } else if ((e.key === "Escape" || sameView) && drawPending()) {
      e.preventDefault();
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
    if (isDeploying()) {
      e.preventDefault();
      requestDeploymentEnd();
      return;
    }
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
  // The army picked in its half before the game: a tap there opens the list
  if ((e.target as HTMLElement).closest(".panel-army")) return;
  if (shouldIgnoreSpaceLike(e.target)) return;
  e.preventDefault();
  handleSpaceLikeInput();
});

onSegmentedPick(timePresets, (value) => {
  if (isRunning()) return;
  if (value === CUSTOM_PRESET_VALUE) {
    setTimePreset(value);
    // A phone sets it with the − and + buttons: a keyboard would cover the sheet
    if (!SHEET.matches) {
      minutesInput.focus();
      minutesInput.select();
    }
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

minutesInput.addEventListener("input", () => {
  // The setup is fixed once the tosses start
  if (inGame(game) || inPreBattle()) return;
  const seconds = readMinutes() * 60;
  game.clock.left = { 1: seconds, 2: seconds };
  applyTimesToDisplay();
  renderTimeValue();
});
// Enter validates the custom time and gives the keyboard back to the game
minutesInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  foldTimePicker();
});

/** − and + move a custom time to the 5 minutes below or above */
manualTimeWrap.addEventListener("click", (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-step]");
  if (!button) return;
  const step = Number(button.dataset.step);
  const minutes = readMinutes();
  const next = step > 0 ? Math.floor(minutes / step) * step + step : Math.ceil(minutes / -step) * -step + step;
  minutesInput.value = String(Math.min(999, Math.max(0, next)));
  minutesInput.dispatchEvent(new Event("input"));
});

// A phone's sheet closes on OK, or on a tap on the dimmed screen around it
app.querySelector("#time-done")!.addEventListener("click", foldTimePicker);
app.querySelector("#time-scrim")!.addEventListener("click", foldTimePicker);

app.querySelector("#faction-swap")!.addEventListener("click", swapFactions);
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
sfxToggle.addEventListener("change", () => {
  applySounds(sfxToggle.checked ? "on" : "off");
  // Enter and Space stay the game's: a focused switch would take them
  sfxToggle.blur();
});
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
onSegmentedPick(musicOptions, (value) => {
  applyMusic(value);
  previewMusic();
  // A track picked is a track to hear, even after the music was muted. Only the new one:
  // the track fading out stays silent
  applyMusicMuted(false);
});
volumeInput.addEventListener("input", () => applyVolume(Number(volumeInput.value)));
// Browsers hold audio back until the page gets a click or a key
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);
onSegmentedPick(layoutOptions, applyLayout);
onSegmentedPick(langOptions, (value) => applyLang(value, true));

btnSettings.addEventListener("click", () => togglePopover(btnSettings, settingsPanel));
seatSettings.addEventListener("click", () => togglePopover(seatSettings, settingsPanel));
stripSettings.addEventListener("click", () => togglePopover(stripSettings, settingsPanel));
seatMute.addEventListener("click", () => {
  if (sfxToggle.checked) {
    toggleMute();
    return;
  }
  applySounds("on");
  setMuted(false);
  showToast(t("soundOn"));
  renderSeatSound();
});
seatMusic.addEventListener("click", toggleMusicMute);
/** The times unfold: over the bar on a screen, as a sheet from the bottom on a phone */
function showTimePicker(open: boolean): void {
  closePopovers();
  timePicker.classList.toggle("is-open", open);
  if (open) timePicker.classList.remove("is-folded");
}

// A touch screen has no hover to unfold the times: a tap opens them, another tap or a pick closes them
btnTime.addEventListener("click", () => showTimePicker(!timePicker.classList.contains("is-open")));
// An army list outside the menu (a phone's setup) closes on its own, after its pick
document.addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement).closest(".popover-anchor, .time-picker, .picker")) closePopovers();
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
/** A room created or joined in a few hundred milliseconds; once it hung for half a minute */
const ROOM_TIMEOUT_MS = 10000;

const packState = ({ rev, json }: Synced): string => `${rev}|${json}`;

function unpackState(stored: string): Synced {
  const bar = stored.indexOf("|");
  return { rev: Number(stored.slice(0, bar)) || 0, json: stored.slice(bar + 1) };
}

/** Sends this phone's changes. What the other phone changed meanwhile is kept, field by field */
async function pushState(): Promise<void> {
  const room = roomSession()?.room;
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
    if (roomSession()?.room !== room) return;
    synced = unpackState(stored);
    sent = true;
    room.played(isOver());
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
  roomSession()?.room?.played(isOver());
  if (next !== remote.json) void pushState();
  if (joining) claimArmy();
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
  renderFactions();
  photoBreaksToggle.checked = game.options.photoBreaks;
  deployClockToggle.checked = deploymentTimed();
  renderEvent();
  const pre = game.preBattle;
  const prevPre = prev.preBattle;
  if (!inGame(game)) {
    if (pre?.step === "chooser" && pre.at !== prevPre?.at) showToss();
    else if (pre?.step === "first" && pre.toss && pre.toss.at !== prevPre?.toss?.at) showToss();
    else if (!pre || pre.step === "deployment") hideToss();
    else renderToss();
    if (pre?.step === "deployment" && prevPre?.step !== "deployment" && cardsPlayer !== null) closeCards(false);
    if (prevPre?.step === "deployment" && pre?.step !== "deployment" && turnConfirmKind === "deploy-end") hideTurnConfirmModal();
  }
  if (game.judgeCall !== null && prev.judgeCall === null) {
    stopLoop();
    showJudgeCall();
  } else if (game.judgeCall === null && prev.judgeCall !== null) hideJudgeCall();
  else if (game.judgeCall !== null) renderJudgeCall();
  if (logOverlay.classList.contains("is-visible")) renderClockLog();
  const wasInGame = inGame(prev);
  if (game.phase === "setup" && wasInGame) resetScreen();
  // The game moved on from a phone: the shared screen's dialog would keep its keyboard from it
  if ((game.choosing && !prev.choosing) || (!!game.preBattle && !prev.preBattle) || (!wasInGame && inGame(game))) closeOnlineDialog();
  if (game.choosing && !prev.choosing) openDispositions();
  else if (!game.choosing && prev.choosing && !game.primaries[1]) closeDispositions();
  if (game.phase === "setup" && game.primaries[1] && !prev.primaries[1]) showPrimaries();
  if (!wasInGame && inGame(game)) {
    hideToss();
    if (cardsPlayer !== null && cardsMode === "primary") closeCards(false);
    closePopovers();
    closeDispositions();
    hideTurnConfirmModal();
    hideResultOverlay();
    if (!joining) {
      turnSound("start");
      celebrateBattleReady();
    }
    setBattleMusic(true);
  }
  if (game.phase === "over" && prev.phase !== "over") showGameOverScreen(joining);
  // A game started on another device: the photos of the one before go here too
  if (game.gameId && game.gameId !== prev.gameId) void keepOnlyGame(game.gameId);
  if (resultOverlay.classList.contains("is-visible") && JSON.stringify(game.mvp) !== JSON.stringify(prev.mvp)) renderMvpSection();
  if (!joining && isRunning() && prev.phase === "running") {
    if (prev.turnPlayer !== game.turnPlayer || prev.round !== game.round) turnSound(prev.round !== game.round ? "round" : "turn");
    else if (prev.clock.active !== game.clock.active) playSound("switch");
  }

  if (clockTicks() && game.clock.since !== null) {
    startLoop();
    void tryAcquireWakeLock();
  } else {
    stopLoop();
    if (!clockTicks()) void releaseWakeLock();
  }
  if (!isRunning()) syncInputsFromState();
  if (game.phase === "setup") syncPresetSelectFromState();
  setInputsEnabled(!isRunning() && !inPreBattle());
  if (game.photoBreak && !prev.photoBreak) showPhotoBreak();
  else if (!game.photoBreak && prev.photoBreak) hidePhotoBreak();
  const seat = online?.seat;
  // The clock comes back to this phone: a buzz, for a player looking at the table (not on iPhone)
  if (!joining && seat && isRunning() && game.clock.active === seat && prev.clock.active !== seat) buzz([120, 60, 120]);
  if (!joining && seat && game.cpNotice[seat].n !== prev.cpNotice[seat].n) sayCp(seat, game.cpNotice[seat].gained);
  // The shared screen shows a command point spent on a phone, big, with its sound
  if (!joining && table && inGame(game) && inGame(prev)) {
    for (const player of [1, 2] as const) if (game.cp[player] < prev.cp[player]) burnCp(player, prev.cp[player] - game.cp[player]);
  }
  if (!joining && game.cardsPutAway.n !== prev.cardsPutAway.n) {
    const { player, mode } = game.cardsPutAway;
    if (cardsPlayer === player && cardsMode === mode) closeCards(true, true);
  }
  // A draw made on another device: on the drawing player's phone, and on the shared screen as without phones
  if (!joining && game.lastDraw.n !== prev.lastDraw.n) {
    const { player, ids } = game.lastDraw;
    if (game.photoBreak) {
      if (!online || online.seat === player) pendingDraw = { player, drawn: ids };
    } else showDraw(player, ids);
  } else if (cardsMode === "draw" && cardsPlayer === game.lastDraw.player && game.lastDraw.ids.join() !== prev.lastDraw.ids.join()) {
    // The same draw, a card of it picked or replaced on another device: shown here as it is there
    drawnIds = [...game.lastDraw.ids];
    if (pendingDraw?.player === cardsPlayer) pendingDraw.drawn = drawnIds;
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
  if (cardsPlayer !== null && cardsMode !== "primary" && cardsData(prev, cardsPlayer) !== cardsData(game, cardsPlayer)) {
    morphCards(() => renderCards(), cardShowsInFull);
  }
  renderHandButtons();
}

/** The other phone reset the game */
function resetScreen(): void {
  stopBattleReady();
  setBattleMusic(false);
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  hideResultOverlay();
  closeClockLog();
  pendingDraw = null;
  afterPutAway = null;
  hidePhotoBreak();
  closeCards(false);
  closeAbilities();
}

/**
 * The game ended on the other phone: the same result shows here. Found over (a room joined, the
 * app reopened), it shows without the fanfare: it would only sound at the first tap
 */
function showGameOverScreen(quiet = false): void {
  if (game.concededBy) {
    closeEndGame();
    pendingDraw = null;
    if (cardsPlayer !== null) closeCards(false);
  }
  lastSpaceTime = 0;
  void releaseWakeLock();
  stopLoop();
  hideTurnConfirmModal();
  setBattleMusic(false);
  if (!quiet) playSound("victory");
  showResultOverlay();
}

/** Creates a room with this game (no code), or joins one; this device takes `seat`, or the one joinRoom finds (see seatFor for `resume`) */
async function connectRoom(seat: Seat, code?: string, resume = false): Promise<void> {
  leaveRoom();
  // A room being created holds this device alone; a room joined tells who is in it
  const seats: Seats | null = code ? null : { 1: seat === 1, 2: seat === 2, board: seat === "board", away: { 1: false, 2: false } };
  const session: RoomSession = { room: null, connected: true, seats };
  if (seat === "board") table = session;
  else {
    online = Object.assign(session, { seat, phone: PHONE.matches });
    // This phone's screen at once: the board for two would flash while the room answers
    if (online.phone) document.documentElement.dataset.seat = String(seat);
    // A phone creating a game brings its own army only: the other side is the opponent's to pick,
    // not the last army a shared screen saw on this device
    if (!code && online.phone) {
      const mine = stored(MY_ARMY_STORAGE_KEY);
      const own = mine && FACTION_BY_ID.has(mine) ? mine : null;
      game.factions = seat === 1 ? { 1: own, 2: null } : { 1: null, 2: own };
      renderFactions();
    }
  }
  fitScreen();
  renderSeat();
  renderOnlineDialog();
  const events: RoomEvents = {
    onState: (stored) => receiveState(unpackState(stored)),
    onConnection: (connected) => {
      if (roomSession() !== session) return;
      session.connected = connected;
      renderSeat();
      renderOnlineButton();
    },
    onSeats: (seats) => {
      if (roomSession() !== session) return;
      const before = session.seats;
      // Someone comes in: a phone sees its opponent, the shared screen both players
      const watched: Player[] = online ? [other(online.seat)] : [1, 2];
      const arrived = watched.filter((player) => before && !before[player] && seats[player]);
      for (const player of arrived) showToast(t("onlineReady", { n: player }));
      if (arrived.length > 0 && table) playSound("joined");
      if (online && seats.board && !before?.board) showToast(t("onlineBoardJoined"));
      session.seats = seats;
      setMusicHere(phoneView() && seats.board);
      renderSeat();
      renderOnlineDialog();
    },
    onPhoto: (key, value) => {
      if (roomSession() === session) void receivePhoto(key, value);
    },
    onEnded: () => {
      if (roomSession() !== session) return;
      leaveRoom();
      // A phone has no board to go on with: back to its home screen, as when it leaves
      if (PHONE.matches && inGame(game)) reset();
      closeOnlineDialog();
      renderAll();
      showToast(t("onlineEnded"), true);
    },
    onGone: () => {
      if (roomSession() !== session) return;
      // The game stays on this device, its end screen too: only a game still going says so
      leaveRoom();
      closeOnlineDialog();
      renderAll();
      if (!isOver()) showToast(t("onlineGone"), true);
    },
  };
  let room: Room;
  try {
    const { createRoom, joinRoom } = await import("./room");
    if (code) {
      synced = { rev: 0, json: "" };
      room = await joinRoom(code, seat, events, resume);
    } else {
      synced = { rev: 1, json: JSON.stringify(game) };
      room = await createRoom(seat, packState(synced), events);
    }
  } catch (error) {
    if (roomSession() === session) leaveRoom();
    throw error;
  }
  // Given up or left while the room answered: this device is no longer in it
  if (roomSession() !== session) {
    room.leave();
    return;
  }
  session.room = room;
  if (online && room.seat !== "board" && room.seat !== online.seat) {
    online.seat = room.seat;
    if (online.phone) document.documentElement.dataset.seat = String(room.seat);
    renderMe();
  }
  store(ONLINE_STORAGE_KEY, JSON.stringify({ code: room.code, seat: room.seat }));
  renderSeat();
  renderOnlineDialog();
  claimArmy();
}

/** Back to one screen for both players, with the game as it stands */
function leaveRoom(): void {
  roomSession()?.room?.leave();
  online = null;
  table = null;
  setMusicHere(false);
  synced = { rev: 0, json: "" };
  latestRemote = null;
  forget(ONLINE_STORAGE_KEY);
  delete document.documentElement.dataset.seat;
  fitScreen();
  renderSeat();
  renderOnlineButton();
}

// Each tap or key may have changed the game: it is sent right after, and a timer catches the rest
for (const type of ["pointerdown", "click", "keydown", "input", "change"]) {
  window.addEventListener(
    type,
    () => {
      if (roomSession()) window.setTimeout(() => void pushState(), 0);
    },
    true,
  );
}
window.setInterval(() => {
  void pushState();
  keepFinished();
}, 500);

/*
 * A game over is kept on the device: reopened, the app shows its end screen, report and photos,
 * without going back to its room. A new game lets it go
 */
const FINISHED_STORAGE_KEY = "warhammerClock.finished";
let finishedJson = stored(FINISHED_STORAGE_KEY);

function keepFinished(): void {
  const json = isOver() ? JSON.stringify(game) : null;
  if (json === finishedJson) return;
  if (json) store(FINISHED_STORAGE_KEY, json);
  else forget(FINISHED_STORAGE_KEY);
  finishedJson = json;
}

/** At start, the game over this device last showed */
function restoreFinished(): void {
  if (!finishedJson) return;
  try {
    applyState(finishedJson, true);
  } catch {
    forget(FINISHED_STORAGE_KEY);
    finishedJson = null;
  }
}

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
  if (!online?.phone) return;
  renderTime(seatTime, timeLeft(online.seat));
  seatOppTime.textContent = formatTime(timeLeft(other(online.seat)));
}

/**
 * A full-width row that comes and goes (End turn, Deployment done, the invite) slides open or
 * shut, and the clock sharing the screen with it grows or shrinks along instead of jumping by its
 * height. In a flex column or a wrapped row whose gap sits above it
 */
function slideRow(el: HTMLElement, show: boolean): void {
  const was = slidShown.get(el);
  slidShown.set(el, show);
  if (was === show) return;
  const running = el.getAnimations().filter((anim) => anim.id === SLIDE);
  if (was === undefined || prefersReducedMotion() || !el.parentElement?.getClientRects().length) {
    running.forEach((anim) => anim.cancel());
    el.style.overflow = "";
    el.hidden = !show;
    return;
  }
  const read = (): Keyframe => {
    const style = getComputedStyle(el);
    return Object.fromEntries(SLIDE_PROPS.map((prop) => [prop, style[prop]]));
  };
  // Where it is now, mid-way if it was already sliding
  const from = el.hidden ? null : read();
  running.forEach((anim) => anim.cancel());
  el.hidden = false;
  // Shut, it takes no room, the row gap above it included
  const gap = parseFloat(getComputedStyle(el.parentElement).rowGap) || 0;
  const shut: Keyframe = {
    height: "0px",
    minHeight: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
    marginTop: `${-gap}px`,
    opacity: 0,
  };
  const open = read();
  el.style.overflow = "hidden";
  el.animate([from ?? shut, show ? open : shut], { duration: SLIDE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", id: SLIDE })
    .finished.then(
      () => {
        el.style.overflow = "";
        el.hidden = !show;
      },
      () => {},
    );
}

function renderSeat(): void {
  for (const player of [1, 2] as const) {
    const inSeat = phoneView() && online?.seat === player;
    const home = inSeat ? seatAbilities : abilitiesHome[player];
    if (abilitiesEl[player].parentElement !== home) {
      home.append(abilitiesEl[player]);
      renderAbilities(player);
    }
    const toastHome = inSeat ? seatCpCard : cpToastHome[player];
    if (cpToastEl[player].parentElement !== toastHome) toastHome.append(cpToastEl[player]);
    // A phone picks its own army first, under the invite: it colors everything below it. The
    // menu keeps both for a screen
    if (inSeat && factionRow[player].parentElement !== seatArmy) seatArmy.append(factionRow[player]);
  }
  // A screen picks each army in its player's half before the battle, where the eyes are; once it
  // starts, the choice goes back to the menu
  const onBoard = !phoneView() && !inGame(game) && !inPreBattle();
  for (const player of [1, 2] as const) {
    if (phoneView() && online?.seat === player) continue;
    const rowHome = onBoard ? panelArmy[player] : factionsSection;
    if (factionRow[player].parentElement !== rowHome) rowHome.append(factionRow[player]);
  }
  factionsSection.closest<HTMLElement>(".settings__section")!.hidden = onBoard;
  renderFactionRows();
  renderPhoneHome();
  // A phone's own screen has no setup bar: the menu and the game setup move into it. The board
  // hides its bar during a game: the menu opens from the strip then, over the board, unscaled
  const panelHome = phoneView() ? seatSettingsAnchor : inGame(game) ? gameSettingsAnchor : btnSettings.parentElement!;
  if (settingsPanel.parentElement !== panelHome) panelHome.append(settingsPanel);
  if (phoneView() && setupGroup.parentElement !== seatSetup) seatSetup.append(setupGroup, btnStart);
  else if (!phoneView() && setupGroup.parentElement === seatSetup) {
    toolbar.prepend(setupGroup);
    toolbarEnd.append(btnStart);
  }
  if (!online?.phone) return;
  seatSetup.hidden = inGame(game) || inPreBattle();
  seatArmy.hidden = seatSetup.hidden;
  const me = online.seat;
  // Before the battle, on the player's own screen: the moment to say which units generate CP
  const cpInvite = !seatSetup.hidden && game.abilities[me].length === 0;
  const cpButton = app.querySelector<HTMLElement>("#seat-abilities-btn")!;
  // Once set, the abilities show as tiles: the button only edits them, a pencil in the card's corner
  const edits = game.abilities[me].length > 0;
  cpButton.classList.toggle("is-invited", cpInvite);
  cpButton.classList.toggle("is-edit", edits);
  delete cpButton.dataset.i18n;
  cpButton.innerHTML = edits ? `${ICON_EDIT}<span>${t("abilitiesEdit")}</span>` : esc(t(cpInvite ? "abilitiesInvite" : "abilities"));
  const them = other(me);
  const running = isRunning();
  const mine = running && game.clock.active === me;
  const room = app.querySelector<HTMLElement>("#seat-room")!;
  room.classList.toggle("is-offline", !online.connected);
  room.title = online.connected ? "" : t("onlineOffline");
  seatText("seat-code", online.room?.code ?? t("onlineConnecting"));
  renderSeatInvite(them);
  seatText("seat-round", inGame(game) ? `${t("round")} ${game.round}` : "");
  seatText("seat-opp-name", t("player", { n: them }));
  seatText("seat-opp-score", String(shownScore(them)));
  seatOpp.classList.toggle("is-running", running && game.clock.active === them);
  seatOpp.classList.toggle("is-flag", inGame(game) && timeLeft(them) <= 0);
  const deploying = isDeploying();
  const myDeploy = deploying && game.clock.active === me;
  const turn = deploying
    ? ` · ${t(myDeploy ? "seatYourDeploy" : "seatTheirDeploy")}`
    : inGame(game)
      ? ` · ${t(game.turnPlayer === me ? "seatYourTurn" : "seatTheirTurn")}`
      : "";
  seatText("seat-who", `${t("player", { n: me })}${turn}`);
  const hint = deploying
    ? t(myDeploy ? "seatDeployHint" : "seatTheirDeployHint")
    : !inGame(game)
      ? timeSettable()
        ? t("seatSetup")
        : eventLocks().time && !inPreBattle()
          ? t("eventLockedBy")
          : ""
    : isOver()
      ? t("gameOver")
      : !running
        ? t("paused")
        : mine && timeLeft(me) <= 0
          ? t("seatTimeOut")
          : t(mine ? "seatTapToPass" : "seatTheirClock");
  seatText("seat-hint", hint);
  seatClock.classList.toggle("is-running", mine || (myDeploy && deploymentTimed()));
  slideRow(app.querySelector<HTMLElement>("#seat-deploy-done")!, deploying);
  seatClock.classList.toggle("is-flag", inGame(game) && timeLeft(me) <= 0);
  seatClock.setAttribute("aria-disabled", String(!mine && !myDeploy && !timeSettable()));
  renderSeatTimes();

  const turnIdx = scoringTurnIdx(me);
  seatText("seat-score", String(shownScore(me)));
  seatText("seat-turn", inGame(game) ? t("turnN", { n: turnIdx + 1 }) : "");
  for (const { kind } of SCORE_KINDS) {
    const points = game.scoreByTurn[me][kind][turnIdx];
    seatText(`seat-${kind}`, String(gameScore(me, kind)));
    app.querySelector<HTMLButtonElement>(`#seat-${kind}-plus`)!.disabled = !inGame(game) || points >= MAX_POINTS_PER_TURN;
    app.querySelector<HTMLButtonElement>(`#seat-${kind}-minus`)!.disabled = !inGame(game) || points === 0;
  }
  app.querySelector<HTMLElement>("#seat-bonus-row")!.hidden = !inGame(game) || turnIdx !== MAX_GAME_TURN - 1;
  seatText("seat-bonus", String(game.endBonus[me]));
  seatText("seat-cp", String(game.cp[me]));
  seatText("seat-hand-count", String(game.secondaries[me].hand.length));
  const playing = inGame(game) && !isOver();
  app.querySelector<HTMLElement>("#seat-hand")!.hidden = !secondaryCardsOn() || !inGame(game);
  app.querySelector<HTMLElement>("#seat-mission")!.hidden = !secondaryCardsOn() || !primaryCard(me);
  app.querySelector<HTMLElement>("#seat-opp-primary")!.hidden = !secondaryCardsOn() || !primaryCard(them);
  const pauseBtn = app.querySelector<HTMLButtonElement>("#seat-pause")!;
  pauseBtn.hidden = !playing || pauseLocked();
  pauseBtn.textContent = t(running ? "seatPause" : "seatResume");
  app.querySelector<HTMLElement>("#seat-judge")!.hidden = !playing;
  slideRow(app.querySelector<HTMLElement>("#seat-end")!, running && game.turnPlayer === me);
  app.querySelector<HTMLElement>("#seat-reset")!.hidden = !inGame(game);
}

/** The time can still be set: before the game, unless a tournament imposes it */
function timeSettable(): boolean {
  return !inGame(game) && !inPreBattle() && !eventLocks().time;
}

/** A tap on this phone's own running clock passes it to the opponent; before the game, it sets its time */
seatClock.addEventListener("click", () => {
  if (timeSettable()) {
    showTimePicker(true);
    return;
  }
  if (isDeploying()) {
    passDeployment();
    return;
  }
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
      if (isRunning() && !pauseLocked()) pause();
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
      closePopovers();
      if (inGame(game) && !isOver()) openEndGame();
      else if (inGame(game)) openTurnConfirmModal("reset");
    },
  ],
  ["seat-room", () => openOnlineDialog()],
  ["seat-judge", () => callJudge()],
  ["seat-deploy-done", () => requestDeploymentEnd()],
];
for (const [id, action] of seatActions) {
  app.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener("click", () => {
    if (!online) return;
    action(online.seat);
    renderSeat();
  });
}

/* ---------- Online: the dialog to create or join a game ---------- */

/**
 * A phone that creates the game plays Player 1, one that joins it Player 2 (or the seat left
 * free). A PC or a tablet is the shared screen
 */
const createSeat = (): Seat => (PHONE.matches ? 1 : "board");
const joinSeat = (): Seat => (PHONE.matches ? 2 : "board");
let shownQrCode = "";
let shownBoardQrCode = "";

const shareLink = (code: string, seat: Player): string =>
  `${location.origin}${location.pathname}?room=${code}&seat=${seat}`;

function showOnlineError(text: string | null): void {
  onlineError.hidden = text === null;
  onlineError.textContent = text ?? "";
}

function renderOnlineDialog(): void {
  renderOnlineButton();
  const session = roomSession();
  const room = session?.room ?? null;
  app.querySelector<HTMLElement>("#online-start")!.hidden = !!session;
  app.querySelector<HTMLElement>("#online-room")!.hidden = !session;
  // A phone leaves alone, its game kept in the room. A PC ends the game online for every device
  const ends = !!session && !online?.phone;
  const leave = app.querySelector<HTMLElement>("#online-leave")!;
  leave.hidden = !session;
  leave.classList.toggle("is-danger", ends);
  leave.textContent = t(ends ? "onlineEnd" : "onlineLeave");
  // Nothing done yet: backing out is a cancel. In a game, the dialog only shows it and closes
  const close = app.querySelector<HTMLElement>("#online-close")!;
  // A PC playing apart has the link to copy as its main button: closing stays secondary
  const closeLeads = !!session && !(online && !online.phone);
  close.classList.toggle("btn-primary", closeLeads);
  close.classList.toggle("btn-secondary", !closeLeads);
  close.querySelector("span")!.textContent = t(session ? "close" : "cancel");
  // On a PC or a tablet, no player to pick: it shows the players' codes, each may scan theirs (style.css)
  seatText("online-intro", t(PHONE.matches ? "onlineIntro" : "onlineBoardIntro"));
  seatText("online-create", t(PHONE.matches ? "onlineCreate" : "onlineShowQr"));
  app.querySelector<HTMLElement>("#online-qrs")!.hidden = !table;
  app.querySelector<HTMLElement>("#online-qr")!.hidden = !online?.phone;
  if (table) {
    seatText("online-room-code", room?.code ?? t("onlineConnecting"));
    seatText("online-scan", room ? t("onlineScanBoth") : "");
    seatText("online-status", "");
    app.querySelector<HTMLElement>("#online-share")!.hidden = true;
    for (const player of [1, 2] as const) {
      const joined = !!room && seatHere(table.seats, player);
      // A phone in: its code is done with, the player's mark takes its place. Its phone gone, the
      // code comes back, to take the seat again with this phone or another
      const dropped = !!room && !joined && !!table.seats?.away[player];
      app.querySelector("#online-seat-" + player)!.classList.toggle("is-joined", joined);
      seatText(`online-status-${player}`, room ? t(joined ? "onlineReady" : dropped ? "onlineDropped" : "onlineOnBoard", { n: player }) : "");
    }
    if (room) renderBoardQrs(room.code);
    return;
  }
  if (!online) return;
  const them = other(online.seat);
  // A shared screen at the table: the opponent takes their code there, or plays on it. This
  // phone shows no code and no link, nobody has to be invited from it
  const shared = !!online.seats?.board;
  app.querySelector<HTMLElement>("#online-qr")!.hidden = !online.phone || shared;
  seatText("online-room-code", room?.code ?? t("onlineConnecting"));
  // A phone's opponent scans its code at the table; a PC's is elsewhere, the link goes to them
  seatText("online-scan", room ? t(shared ? "onlineScanShared" : online.phone ? "onlineScan" : "onlineSendLink", { n: them }) : "");
  // Once the game is on, nobody is awaited: the opponent may simply play without a phone
  const started = inGame(game) || inPreBattle();
  const absent = shared ? "onlineOnShared" : started ? (online.phone ? "onlineNoPhone" : "onlineAway") : "onlineWaiting";
  seatText("online-status", room ? t(seatHere(online.seats, them) ? "onlineReady" : absent, { n: them }) : "");
  const share = app.querySelector<HTMLElement>("#online-share")!;
  share.hidden = !room || shared;
  // On a PC, the link is what the player came for: the main button, right under the code
  share.classList.toggle("btn-primary", !online.phone);
  share.classList.toggle("btn-secondary", online.phone);
  if (!share.classList.contains("is-copied")) share.textContent = t(online.phone ? "onlineShare" : "onlineCopyLink");
  if (room && online.phone && !shared) renderRoomQr(room.code, them);
}

/** Until the opponent takes their seat, the code to join stays on this phone's screen */
function renderSeatInvite(them: Player): void {
  const invite = app.querySelector<HTMLElement>("#seat-invite")!;
  const room = online?.room ?? null;
  // With a shared screen, the opponent may play on it: nobody to wait for. In the battle, their
  // phone dropping out is only said on their strip: the code is in the room button
  const away = !!online?.seats && !seatHere(online.seats, them) && !online.seats.board;
  app.querySelector<HTMLElement>("#seat-opp-away")!.hidden = !away || !inGame(game);
  // The opponent joins: the invite folds away, the clock and the rest rise into its room
  const inviting = away && !inGame(game);
  slideRow(invite, inviting);
  // Nobody to show yet: their strip comes in with them, as the invite folds away
  slideRow(seatOpp, !inviting);
  if (!inviting) return;
  seatText("seat-invite-title", t("onlineWaiting", { n: them }));
  seatText("seat-invite-code", room?.code ?? t("onlineConnecting"));
  seatText("seat-invite-hint", t("onlineScan", { n: them }));
  app.querySelector<HTMLButtonElement>("#seat-invite-share")!.disabled = !room;
  if (room) renderRoomQr(room.code, them);
}

/** The code the opponent scans: in the dialog, and on this phone's screen while their seat is empty */
function renderRoomQr(code: string, them: Player): void {
  if (shownQrCode === `${code}|${them}`) return;
  shownQrCode = `${code}|${them}`;
  void import("qrcode-generator").then(({ default: qrcode }) => {
    const qr = qrcode(0, "M");
    qr.addData(shareLink(code, them));
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    for (const id of ["online-qr", "seat-invite-qr"]) app.querySelector<HTMLElement>(`#${id}`)!.innerHTML = svg;
  });
}

/** The shared screen: one code per player, each phone scans its own and lands in its seat */
function renderBoardQrs(code: string): void {
  if (shownBoardQrCode === code) return;
  shownBoardQrCode = code;
  void import("qrcode-generator").then(({ default: qrcode }) => {
    for (const player of [1, 2] as const) {
      const qr = qrcode(0, "M");
      qr.addData(shareLink(code, player));
      qr.make();
      app.querySelector<HTMLElement>(`#online-qr-${player}`)!.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    }
  });
}

/** In the shared screen's bar, the room's code: what the players type, and whether the network holds */
function renderOnlineButton(): void {
  const label = app.querySelector<HTMLElement>("#online-label")!;
  // A PC in a game, shared screen or player: the code in its bar
  const session = online?.phone ? null : roomSession();
  label.textContent = session ? (session.room?.code ?? t("onlineConnecting")) : t("online");
  btnOnline.classList.toggle("is-live", !!session);
  btnOnline.classList.toggle("is-offline", !!session && !session.connected);
  // The bar is gone during the game: the strip keeps a way to the codes, for a phone that dropped out
  stripRoom.hidden = !session;
  stripRoom.classList.toggle("is-offline", !!session && !session.connected);
  const roomLabel = t("onlineRoomAria", { code: session?.room?.code ?? "" });
  stripRoom.title = roomLabel;
  stripRoom.setAttribute("aria-label", roomLabel);
}

function shareRoomLink(button: HTMLElement): void {
  const code = online?.room?.code;
  if (!online || !code) return;
  const url = shareLink(code, other(online.seat));
  // A phone shares it to a nearby phone; a PC copies it, to send in a chat
  if (navigator.share && online.phone) {
    void navigator.share({ title: t("onlineTitle"), url }).catch(() => undefined);
    return;
  }
  void copyText(url).then((copied) => {
    // Said on the button itself, where the eyes are
    button.dataset.label ??= button.textContent ?? "";
    button.textContent = t(copied ? "onlineCopied" : "onlineCopyFailed");
    button.classList.add("is-copied");
    window.clearTimeout(Number(button.dataset.timer));
    button.dataset.timer = String(
      window.setTimeout(() => {
        button.textContent = button.dataset.label ?? "";
        button.classList.remove("is-copied");
        delete button.dataset.label;
      }, 2200),
    );
  });
}

/** Through the clipboard, or the older way where the browser refuses it (an insecure page, a webview) */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

/**
 * A phone outside a game has no use for a board made for two: its home creates or joins one,
 * with the start of the online dialog
 */
function renderPhoneHome(): void {
  const home = PHONE.matches && !roomSession() && !inGame(game);
  document.documentElement.toggleAttribute("data-home", home);
  if (home && onlineStart.parentElement !== phoneHomeStart) phoneHomeStart.append(onlineStart, onlineError);
  else if (!home && onlineStart.parentElement === phoneHomeStart) {
    onlineRoomSection.before(onlineStart);
    onlineRoomSection.after(onlineError);
  }
}

function openOnlineDialog(code = ""): void {
  closePopovers();
  if (code) onlineCodeInput.value = code;
  showOnlineError(null);
  // On a phone's home, the start is on screen already
  if (document.documentElement.hasAttribute("data-home")) return;
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

/** A PC joining with a code: the player still missing, the opponent having sent it; or a shared screen */
async function pcSeatIn(code: string): Promise<Seat> {
  const { peekSeats } = await import("./room");
  const seats = await peekSeats(code);
  if (seats.board || (seats[1] && seats[2])) return "board";
  return seats[1] ? 2 : 1;
}

async function goOnline(seat: Seat, code?: string): Promise<void> {
  showOnlineError(null);
  // Creating on a phone: straight to its screen, where the code waits for the opponent. A PC
  // keeps the dialog: the codes to scan, or the link to send, are in it
  if (!code && seat !== "board" && PHONE.matches) closeOnlineDialog();
  // A room that doesn't answer is given up: trying again usually goes through
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error("unavailable")), ROOM_TIMEOUT_MS);
  });
  try {
    // A PC joining with a code: a player's seat, or the shared screen
    const join = async (): Promise<Seat> => {
      const taken = code && seat === "board" ? await pcSeatIn(code) : seat;
      await connectRoom(taken, code);
      return taken;
    };
    const taken = await Promise.race([join(), timeout]);
    if (code || (taken !== "board" && PHONE.matches)) closeOnlineDialog();
  } catch (error) {
    leaveRoom();
    openOnlineDialog(code);
    showOnlineError(roomErrorText(error));
  } finally {
    window.clearTimeout(timer);
  }
}

// Apart, the one who creates the game plays player 1, the one who joins it player 2
app.querySelector("#online-remote-create")!.addEventListener("click", () => void goOnline(1));
btnOnline.addEventListener("click", () => openOnlineDialog());
stripRoom.addEventListener("click", () => openOnlineDialog());
eventLeaveBtn.addEventListener("click", leaveEvent);

/* ---------- The organiser's side: a tournament's settings, its link, QR code and poster ---------- */

const eventToggle = (id: (typeof EVENT_TOGGLES)[number]["id"]): HTMLInputElement => app.querySelector<HTMLInputElement>(`#${id}`)!;
const eventLockButtons = (): HTMLButtonElement[] => [...eventForm.querySelectorAll<HTMLButtonElement>(".event-lock")];
let eventCardsSource: CardsSource = "app";

function readEventForm(): EventPreset {
  const toggles = Object.fromEntries(EVENT_TOGGLES.map(({ id, field }) => [field, eventToggle(id).checked])) as Pick<
    EventPreset,
    (typeof EVENT_TOGGLES)[number]["field"]
  >;
  const locked = Object.fromEntries(eventLockButtons().map((button) => [button.dataset.lock!, button.getAttribute("aria-pressed") === "true"])) as EventLocks;
  const minutes = Number(eventMinutesInput.value) || DEFAULT_TIME_SEC / 60;
  return {
    ...toggles,
    cards: eventCardsSource !== "off",
    manualDraw: eventCardsSource === "deck",
    locked,
    name: eventNameInput.value.trim(),
    seconds: Math.min(EVENT_MAX_MINUTES, Math.max(EVENT_MIN_MINUTES, Math.round(minutes))) * 60,
  };
}

/** The address tables open: the app's own, wherever it runs (the tests' local one too) */
const currentEventLink = (): string => eventLink(`${location.origin}${location.pathname}`, readEventForm());

let shownEventLink = "";

function renderEventSetup(): void {
  const preset = readEventForm();
  setSegmentedValue(eventCardsSourcePicker, eventCardsSource);
  const link = currentEventLink();
  app.querySelector<HTMLElement>("#event-link")!.textContent = link;
  app.querySelector<HTMLElement>("#event-poster-name")!.textContent = preset.name || t("eventUnnamed");
  app.querySelector<HTMLElement>("#event-poster-rules")!.textContent = eventRules(preset);
  if (link === shownEventLink) return;
  shownEventLink = link;
  void eventQrSvg(link).then((svg) => {
    if (shownEventLink === link) app.querySelector<HTMLElement>("#event-qr")!.innerHTML = svg;
  });
}

async function eventQrSvg(link: string): Promise<string> {
  const { default: qrcode } = await import("qrcode-generator");
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

/**
 * Opened with the settings of the game on the board. Most tournaments impose the time and the
 * cards; photo breaks and the deployment clock are left to the tables
 */
function openEventSetup(): void {
  closePopovers();
  eventMinutesInput.value = String(Math.round(timeLeft(1) / 60));
  eventCardsSource = cardsSource();
  eventToggle("event-photo-breaks").checked = game.options.photoBreaks;
  eventToggle("event-deploy-clock").checked = deploymentTimed();
  eventToggle("event-judge-pause").checked = true;
  eventToggle("event-music-off").checked = true;
  eventToggle("event-sounds-on").checked = true;
  const imposed: EventLocks = { time: true, cards: true, photoBreaks: false, deployClock: false };
  for (const button of eventLockButtons()) button.setAttribute("aria-pressed", String(imposed[button.dataset.lock as keyof EventLocks]));
  renderEventSetup();
  eventOverlay.classList.add("is-visible");
  eventOverlay.setAttribute("aria-hidden", "false");
  eventNameInput.focus();
}

function closeEventSetup(): void {
  eventOverlay.classList.remove("is-visible");
  eventOverlay.setAttribute("aria-hidden", "true");
  (document.activeElement as HTMLElement | null)?.blur();
}

/** Said on the button itself, where the eyes are, then back to its label */
function flashButton(button: HTMLElement, text: string): void {
  button.dataset.label ??= button.textContent ?? "";
  button.textContent = text;
  window.clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(
    window.setTimeout(() => {
      button.textContent = button.dataset.label ?? "";
      delete button.dataset.label;
    }, 2200),
  );
}

/** The poster for the tables: the tournament's name, its settings and the QR code, as a picture */
async function eventPosterImage(): Promise<Blob | null> {
  const preset = readEventForm();
  const sheet = document.createElement("div");
  sheet.className = "event-print";
  sheet.innerHTML = `
    <p class="event-print__kicker"></p>
    <h2 class="event-print__name"></h2>
    <p class="event-print__rules"></p>
    <div class="event-print__qr">${await eventQrSvg(currentEventLink())}</div>
    <p class="event-print__scan"></p>
    <p class="event-print__brand"><b>Chronicum</b> · ${APP_URL.replace(/^https:\/\/|\/$/g, "")}</p>`;
  sheet.querySelector(".event-print__kicker")!.textContent = t("eventKicker");
  sheet.querySelector(".event-print__name")!.textContent = preset.name || t("eventUnnamed");
  sheet.querySelector(".event-print__rules")!.textContent = eventRules(preset);
  sheet.querySelector(".event-print__scan")!.textContent = t("eventScan");
  document.body.append(sheet);
  try {
    const { toBlob } = await import("html-to-image");
    return await toBlob(sheet, { pixelRatio: 2, backgroundColor: "#ffffff", style: { position: "static", left: "auto" } });
  } finally {
    sheet.remove();
  }
}

app.querySelector("#btn-event-setup")!.addEventListener("click", openEventSetup);
app.querySelector("#event-close")!.addEventListener("click", closeEventSetup);
eventForm.addEventListener("input", renderEventSetup);
onSegmentedPick(eventCardsSourcePicker, (value) => {
  eventCardsSource = value as CardsSource;
  renderEventSetup();
});
// Imposed or left to the players: the switch says it, the poster and the link follow
eventForm.addEventListener("click", (e) => {
  const lock = (e.target as HTMLElement).closest<HTMLButtonElement>(".event-lock");
  if (!lock) return;
  lock.setAttribute("aria-pressed", String(lock.getAttribute("aria-pressed") !== "true"));
  renderEventSetup();
});
eventForm.addEventListener("change", renderEventSetup);
eventForm.addEventListener("submit", (e) => e.preventDefault());
eventOverlay.addEventListener("click", (e) => {
  if (e.target === eventOverlay) closeEventSetup();
});
app.querySelector<HTMLButtonElement>("#event-copy")!.addEventListener("click", (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  void copyText(currentEventLink()).then((copied) => flashButton(button, t(copied ? "onlineCopied" : "onlineCopyFailed")));
  track("Tournoi préparé", { action: "lien" });
});
app.querySelector<HTMLButtonElement>("#event-download")!.addEventListener("click", (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  button.disabled = true;
  void eventPosterImage()
    .then(async (blob) => {
      if (!blob) return;
      const slug = (readEventForm().name || "tournoi").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      const file = new File([blob], `chronicum-${slug || "tournoi"}.png`, { type: "image/png" });
      if (PHONE.matches && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] }).catch(() => undefined);
      else download(file);
      track("Tournoi préparé", { action: "affiche" });
    })
    .catch(() => showToast(t("eventPosterFailed")))
    .finally(() => {
      button.disabled = false;
    });
});
app.querySelector("#online-create")!.addEventListener("click", () => void goOnline(createSeat()));
app.querySelector("#online-join")!.addEventListener("click", () => {
  const code = onlineCodeInput.value.trim().toUpperCase();
  if (code.length !== ONLINE_CODE_LENGTH) {
    showOnlineError(t("onlineNotFound"));
    return;
  }
  void goOnline(joinSeat(), code);
});
onlineCodeInput.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") app.querySelector<HTMLButtonElement>("#online-join")!.click();
});
for (const id of ["online-share", "seat-invite-share"]) {
  const button = app.querySelector<HTMLElement>(`#${id}`)!;
  button.addEventListener("click", () => shareRoomLink(button));
}
// On a PC, the code is part of the link block: a click on it copies the link too
app.querySelector("#online-room-code")!.addEventListener("click", () => {
  if (online && !online.phone && online.room) shareRoomLink(app.querySelector<HTMLElement>("#online-share")!);
});
app.querySelector("#online-leave")!.addEventListener("click", () => {
  const ends = !online?.phone;
  if (ends) roomSession()?.room?.end();
  leaveRoom();
  if (ends) showToast(t("onlineEndedHere"));
  // A phone has no board to go on with: the game stays in the room, to join again with its code
  if (PHONE.matches && inGame(game)) reset();
  renderOnlineDialog();
  closeOnlineDialog();
  renderAll();
});
app.querySelector("#online-close")!.addEventListener("click", closeOnlineDialog);
onlineOverlay.addEventListener("click", (e) => {
  if (e.target === onlineOverlay) closeOnlineDialog();
});
// A phone picks its player, a wider screen is the shared one: the dialog and the bar follow
PHONE.addEventListener("change", () => {
  renderPhoneHome();
  renderOnlineDialog();
});

const parseSeat = (value: unknown): Seat | null =>
  value === 1 || value === "1" ? 1 : value === 2 || value === "2" ? 2 : value === "board" ? "board" : null;

/** Back in the game this device was in, or the one a shared link points to */
function resumeOnline(): void {
  const params = new URLSearchParams(location.search);
  // A tournament's QR code: its settings for a new game, said in a toast and a chip. A phone shows
  // the start of the online game as always; a screen at the table is played on as it is. The room
  // this device was in before belongs to an earlier game, it is not resumed
  if (params.has(EVENT_PARAM)) {
    const preset = decodeEvent(params.get(EVENT_PARAM));
    history.replaceState(null, "", location.pathname);
    if (preset) {
      forget(ONLINE_STORAGE_KEY);
      joinEvent(preset);
      track("Tournoi ouvert", { tournoi: preset.name || "sans nom" });
      return;
    }
  }
  const linkCode = params.get("room")?.trim().toUpperCase() ?? "";
  const linkSeat = parseSeat(params.get("seat"));
  if (linkCode) history.replaceState(null, "", location.pathname);
  let target: { code: string; seat: Seat; resume?: boolean } | null = null;
  if (linkCode && linkSeat) target = { code: linkCode, seat: linkSeat };
  else if (linkCode) {
    openOnlineDialog(linkCode);
    return;
  } else {
    try {
      const saved = JSON.parse(stored(ONLINE_STORAGE_KEY) ?? "null") as { code?: string; seat?: unknown } | null;
      const seat = parseSeat(saved?.seat);
      if (saved?.code && seat) target = { code: saved.code, seat, resume: true };
    } catch {
      /* nothing saved */
    }
    // A game over is not picked up again: its end screen stays here, the next game gets a new room
    if (target && isOver()) {
      forget(ONLINE_STORAGE_KEY);
      return;
    }
  }
  if (!target) return;
  const { code, seat, resume } = target;
  connectRoom(seat, code, resume).then(() => {
    // A player brought in by the opponent's QR code or link: how Chronicum spreads at the table
    if (linkCode) track("Rejoint par QR", { place: seat === "board" ? "écran partagé" : "joueur" });
  }, (error: unknown) => {
    // This device's last room, gone a day after the game: forgotten without a word
    if (!linkCode && error instanceof Error && error.message === "not-found") return;
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
  if (isDeploying()) requestDeploymentEnd();
  else if (!inGame(game)) requestStart();
});

setTimePreset(String(DEFAULT_TIME_SEC));
loadLang();
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
restoreFinished();
// Before the links' parameters are read and cleared: the visit's source is in them
startAnalytics();
resumeOnline();

// A phone's browser often brings back a tab opened before this device joined its game: the game
// it is in comes back on that tab too
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !roomSession()) resumeOnline();
});

/*
 * In a game, a phone's back gesture would leave it, and close a tab a QR code opened: a first
 * one only warns, a second one in a row leaves. The extra history step is added on a tap, as
 * browsers skip the ones a page adds by itself
 */
const BACK_AGAIN_MS = 2500;
let backWarnedAt = -Infinity;
const guardsBack = (): boolean => !!roomSession() || inGame(game);
window.addEventListener(
  "pointerdown",
  () => {
    if (guardsBack() && !(history.state as { guard?: boolean } | null)?.guard) history.pushState({ guard: true }, "");
  },
  true,
);
window.addEventListener("popstate", () => {
  if (!guardsBack()) return;
  if (performance.now() - backWarnedAt < BACK_AGAIN_MS) {
    history.back();
    return;
  }
  backWarnedAt = performance.now();
  showToast(t("backAgainToLeave"), true);
  history.pushState({ guard: true }, "");
});
