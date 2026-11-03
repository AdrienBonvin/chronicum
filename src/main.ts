import "./style.css";
import { getLang, setLang, t, type Lang, type StringKey } from "./i18n";
import { SECONDARY_BY_ID, SECONDARY_CARDS, type SecondaryCard, type Text } from "./secondaries";
import { FACTION_BY_ID, FACTIONS, SPACE_MARINES, SPACE_MARINES_NAME, type FactionGroup } from "./factions";
import { applyUpdateIfIdle, setupPwa } from "./pwa";
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
  primaryFor,
  type Disposition,
  type PrimaryCard,
  type PrimaryItem,
  type PrimarySection,
} from "./primaries";

type Player = 1 | 2;

const PRESETS = [
  { label: "1h30", sec: 5400 },
  { label: "1h45", sec: 6300 },
  { label: "2h", sec: 7200 },
  { label: "2h15", sec: 8100 },
  { label: "2h30", sec: 9000 },
] as const;

const CUSTOM_PRESET_VALUE = "custom";
const DEFAULT_TIME_SEC = 7200;

type ScoreKind = "primary" | "secondary";

/** Mission rule: at most 15 primary and 15 secondary points per player turn */
const MAX_POINTS_PER_TURN = 15;

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

/** CP effects given by a unit or a character */
type AbilityKind = "discount" | "round-cp" | "turn-cp";

const ABILITY_KINDS: Record<AbilityKind, { title: StringKey; hint: StringKey; short: StringKey }> = {
  discount: { title: "discountTitle", hint: "discountHint", short: "discountShort" },
  "round-cp": { title: "roundCpTitle", hint: "roundCpHint", short: "roundCpShort" },
  "turn-cp": { title: "turnCpTitle", hint: "turnCpHint", short: "turnCpShort" },
};

type Ability = {
  id: number;
  kind: AbilityKind;
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
        </div>`,
  ).join("");
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
      <h2 class="cards-title" id="cards-title"></h2>
      <p class="cards-sub" id="cards-sub"></p>
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
      <p class="overlay-msg" data-i18n="dispoIntro"></p>
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
        <button type="button" class="btn-secondary" id="btn-dispo-cancel"><span data-i18n="cancel"></span> <kbd data-i18n="keyEsc"></kbd></button>
        <button type="button" class="btn-primary" id="btn-dispo-ok" disabled><span data-i18n="revealPrimaries"></span> <kbd data-i18n="keyEnter"></kbd></button>
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
const cardsOverlay = app.querySelector<HTMLElement>("#cards-overlay")!;
const cardsTitle = app.querySelector<HTMLElement>("#cards-title")!;
const cardsSub = app.querySelector<HTMLElement>("#cards-sub")!;
const cardsRow = app.querySelector<HTMLElement>("#cards-row")!;
const btnCardsClose = app.querySelector<HTMLButtonElement>("#btn-cards-close")!;
const dispoOverlay = app.querySelector<HTMLElement>("#dispo-overlay")!;
const btnDispoOk = app.querySelector<HTMLButtonElement>("#btn-dispo-ok")!;
const btnDispoCancel = app.querySelector<HTMLButtonElement>("#btn-dispo-cancel")!;
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
/** The match ended (scores compared or a clock ran out); only Reset starts a new one */
let gameOver = false;
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

/** End-of-game mission bonus: primary points that don't count toward the per-turn cap */
let endBonus: Record<Player, number> = { 1: 0, 2: 0 };

function scoreOf(player: Player, kind?: ScoreKind): number {
  const turns = scoreByTurn[player];
  const primary = sum(turns.primary) + endBonus[player];
  if (kind === "primary") return primary;
  if (kind === "secondary") return sum(turns.secondary);
  return primary + sum(turns.secondary);
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

const MAX_PANEL_CP = 30;

let abilities: Record<Player, Ability[]> = { 1: [], 2: [] };
let nextAbilityId = 1;
/** On top of the Command phase CP, a player gains at most 1 CP per battle round (11th edition). */
let bonusCpGained: Record<Player, boolean> = { 1: false, 2: false };
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
    turnConfirmMsg.textContent = photoBreaksToggle.checked ? `${t("startMsg")} ${t("photoBreaksOn")}` : t("startMsg");
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
    const scored = pendingUnscore && secondaries[pendingUnscore.player].scored.find(({ id }) => id === pendingUnscore?.id);
    turnConfirmTitle.textContent = t("unscoreTitle", { card: scored ? SECONDARY_BY_ID.get(scored.id)!.name : "" });
    turnConfirmMsg.textContent = t("unscoreMsg", { vp: scored?.vp ?? 0, unit: t("vpUnit"), n: (scored?.turn ?? 0) + 1 });
  } else {
    turnConfirmTitle.textContent = t("nextRoundTitle", { n: currentGameTurn + 1 });
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
      `<tr><th scope="row">${t("turnN", { n: i + 1 })}</th>${cells(scoreByTurn[1].primary[i], scoreByTurn[1].secondary[i])}${cells(scoreByTurn[2].primary[i], scoreByTurn[2].secondary[i])}</tr>`,
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
      endBonus[1] || endBonus[2]
        ? `<tr class="result-table__bonus"><th scope="row">${t("endBonus")}</th><td class="is-group">${endBonus[1]}</td><td>–</td><td class="is-group">${endBonus[2]}</td><td>–</td></tr>`
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
  running = false;
  paused = true;
  gameOver = true;
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
  applyConfirmed(kind);
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
    turnPlayer = 2;
    gainCpBothPlayers();
    applyAbilityCp(2, ["turn-cp"]);
    if (active !== 2) {
      active = 2;
      if (running) lastTickWallMs = Date.now();
    }
    setActivePanels();
    if (photoBreaksToggle.checked) startPhotoBreak();
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
  if (photoBreaksToggle.checked) startPhotoBreak();
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
  playSound("photo");
  photoBreak = true;
  stopLoop();
  app.classList.add("is-photo-break");
  photoMsg.textContent = t("photoMsg", { n: turnPlayer });
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
  timeValue.textContent =
    seconds1 === seconds2 ? formatDuration(seconds1) : `${formatDuration(seconds1)} · ${formatDuration(seconds2)}`;
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

function toggleMute(): void {
  setMuted(!isMuted());
  soundToast.textContent = t(isMuted() ? "soundMuted" : "soundOn");
  soundToast.classList.add("is-visible");
  window.clearTimeout(soundToastTimer);
  soundToastTimer = window.setTimeout(() => soundToast.classList.remove("is-visible"), 1400);
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
  if (seconds1 !== seconds2) {
    setTimePreset(CUSTOM_PRESET_VALUE);
    return;
  }
  const match = PRESETS.find((p) => p.sec === seconds1);
  setTimePreset(match ? String(match.sec) : CUSTOM_PRESET_VALUE);
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
    panel1.classList.toggle("is-turn", paused && !gameOver && turnPlayer === 1);
    panel2.classList.toggle("is-turn", paused && !gameOver && turnPlayer === 2);
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
  if (running) {
    const hand = secondaryCardsOn()
      ? ` ${sep} <kbd>${HAND_KEY}</kbd> ${t("hintHand")} <kbd>${PRIMARY_KEY}</kbd> ${t("hintPrimary")}`
      : "";
    keyHint.innerHTML = `${enter} ${t("hintEndTurn")} ${sep} ${space} ${t("hintSwitch")} ${sep} ${space}${space} ${t("hintPause")}${hand}`;
  } else if (gameOver) {
    keyHint.innerHTML = `<span class="key-hint__status">${t("gameOver")}</span> ${t("hintPlayAgain")}`;
  } else if (paused) {
    keyHint.innerHTML = `<span class="key-hint__status">${t("paused")}</span> ${space} ${t("hintResume")}`;
  } else {
    keyHint.innerHTML = `${enter} ${t("hintStart")}`;
  }
}

function updateButtons(): void {
  /* Start / pause are keyboard-driven only (Enter / Space / double-space). */
  app.classList.toggle("match-started", running || paused);
  app.classList.toggle("is-paused", paused && !running && !gameOver);
  app.classList.toggle("is-game-over", gameOver);
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
function warnIfLow(before: number, after: number): void {
  if (TIME_WARNINGS_SEC.some((limit) => before > limit && after <= limit)) playSound("warning");
}

function subtractActivePlayerTime(elapsedSec: number): boolean {
  if (elapsedSec <= 0) return false;
  if (active === 1) {
    warnIfLow(seconds1, seconds1 - elapsedSec);
    seconds1 -= elapsedSec;
    if (seconds1 <= 0) {
      seconds1 = 0;
      endGame(2);
      return true;
    }
  } else {
    warnIfLow(seconds2, seconds2 - elapsedSec);
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
  playSound("switch");
  active = active === 1 ? 2 : 1;
  setActivePanels();
  lastTickWallMs = Date.now();
}

function endGame(winner: Player): void {
  running = false;
  paused = true;
  gameOver = true;
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
  setBattleMusic(false);
  playSound("victory");
  showResultOverlay(t("wins", { n: winner }), t("ranOutOfTime", { n: loser }), winner);
  panel1.classList.toggle("is-flag", seconds1 <= 0);
  panel2.classList.toggle("is-flag", seconds2 <= 0);
}

function start(): void {
  closePopovers();
  hideTurnConfirmModal();
  hideResultOverlay();
  paused = false;
  gameOver = false;
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
  turnSound("start");
  setBattleMusic(true);
  secondaries = { 1: newSecondaryPile(), 2: newSecondaryPile() };
  newCardUsed = { 1: false, 2: false };
  startTurnSecondaries(1);
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
  setBattleMusic(false);
  running = false;
  paused = false;
  gameOver = false;
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
  endBonus = { 1: 0, 2: 0 };
  cp1 = 1;
  cp2 = 1;
  cpHistoryAdded1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryRemoved1 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryAdded2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  cpHistoryRemoved2 = Array<number>(MAX_PLAYER_TURNS).fill(0);
  pendingDraw = null;
  afterPutAway = null;
  closeCards(false);
  primaryCards = { 1: null, 2: null };
  primaryScored = { 1: new Map(), 2: new Map() };
  secondaries = { 1: newSecondaryPile(), 2: newSecondaryPile() };
  newCardUsed = { 1: false, 2: false };
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
  // A new version of the app, downloaded during the game, comes in with the empty board
  applyUpdateIfIdle();
}

function renderMiniCounters(): void {
  for (const player of [1, 2] as const) {
    // The total covers the whole game; primary and secondary show the player's current turn only
    const turnIdx = scoringTurnIdx(player);
    scoreTotalEl[player].textContent = String(scoreOf(player));
    app.querySelector<HTMLElement>(`#p${player}-score-turn`)!.textContent = t("turnN", { n: turnIdx + 1 });
    for (const { kind } of SCORE_KINDS) {
      const points = scoreByTurn[player][kind][turnIdx];
      app.querySelector<HTMLElement>(`#p${player}-${kind}-val`)!.textContent = String(points);
      const plus = app.querySelector<HTMLButtonElement>(`#p${player}-${kind}-plus`)!;
      plus.disabled = points >= MAX_POINTS_PER_TURN;
      plus.title = plus.disabled ? t("maxPerTurn", { max: MAX_POINTS_PER_TURN }) : "";
    }
    app.querySelector<HTMLElement>(`#p${player}-bonus-row`)!.hidden =
      !(running || paused) || turnIdx !== MAX_GAME_TURN - 1;
    app.querySelector<HTMLElement>(`#p${player}-bonus-val`)!.textContent = String(endBonus[player]);
  }
  p1CpVal.textContent = String(cp1);
  p2CpVal.textContent = String(cp2);
  renderHandButtons();
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
  if (endBonus[player] > 0) {
    const row = document.createElement("div");
    row.className = "score-tooltip__row";
    const label = document.createElement("span");
    label.textContent = t("endBonus");
    const value = document.createElement("span");
    value.className = "score-tooltip__value";
    value.textContent = t("bonusPri", { n: endBonus[player] });
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
  const addedHist = player === 1 ? cpHistoryAdded1 : cpHistoryAdded2;
  const removedHist = player === 1 ? cpHistoryRemoved1 : cpHistoryRemoved2;
  cpTooltipEl.innerHTML = "";
  const legend = document.createElement("div");
  legend.className = "score-tooltip__legend";
  legend.textContent = t("cpLegend");
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
    showCpToast(player, t("cpCapReached"), false);
    return;
  }
  bonusCpGained[player] = true;
  gainCp(player);
  playSound("cp");
  showCpToast(player, t("cpGained"), true);
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
  for (const ability of abilities[player]) {
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
  if (!running && !paused) return;
  const ability = abilities[player].find(({ id }) => String(id) === coin.dataset.abilityId);
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
  return abilities[player].find((ability) => (slot === "discount" ? !isCpKind(ability.kind) : isCpKind(ability.kind)));
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
    abilities[player] = abilities[player].filter((ability) => ability !== existing);
  } else {
    abilities[player].push({ id: nextAbilityId++, kind: slot === "discount" ? "discount" : "turn-cp", lost: false, spent: false });
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
  const ability = abilities[player].find((candidate) => candidate.id === id);
  if (!ability) return;
  ability.lost = !ability.lost;
  settlingAbilityId = id;
  justToggledId = id;
  renderAbilities(player);
  justToggledId = null;
  if (abilitiesPlayer === player) renderAbilityList();
}

/* ---------- Secondary mission cards (tactical) ---------- */

/** A scored card keeps what it gave and when, so a misclick can be undone */
type ScoredSecondary = { id: string; vp: number; turn: number };
type SecondaryPile = { deck: string[]; hand: string[]; discard: string[]; scored: ScoredSecondary[] };

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function newSecondaryPile(): SecondaryPile {
  return { deck: shuffled(SECONDARY_CARDS.map(({ id }) => id)), hand: [], discard: [], scored: [] };
}

let secondaries: Record<Player, SecondaryPile> = { 1: newSecondaryPile(), 2: newSecondaryPile() };
/** Swapping a card for a new one (−1 CP) is allowed once per battle */
let newCardUsed: Record<Player, boolean> = { 1: false, 2: false };

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
  return secondaryCardsToggle.checked;
}

function drawSecondaries(player: Player, count: number): string[] {
  const pile = secondaries[player];
  const drawn = pile.deck.splice(0, count);
  pile.hand.push(...drawn);
  return drawn;
}

/** Start of a player's own turn: two new secondaries, revealed once any photo break is over */
function startTurnSecondaries(player: Player): void {
  if (!secondaryCardsOn()) return;
  const drawn = drawSecondaries(player, 2);
  renderHandButtons();
  if (drawn.length === 0) {
    // Nothing left to draw: the Command phase scores still come up
    if (!photoBreak && primaryScoresInCommand(player)) openCards(player, "command");
    return;
  }
  if (photoBreak) pendingDraw = { player, drawn };
  else openCards(player, "draw", drawn);
}

function moveSecondary(player: Player, id: string, to: "discard" | "deck"): void {
  const pile = secondaries[player];
  pile.hand = pile.hand.filter((cardId) => cardId !== id);
  if (to === "discard") pile.discard.push(id);
  // Shuffled back: anywhere in the deck
  else pile.deck.splice(Math.floor(Math.random() * (pile.deck.length + 1)), 0, id);
}

/** Card points go to the secondary score of the player's turn, within the 15 per turn */
function addSecondaryPoints(player: Player, vp: number): number {
  const turns = scoreByTurn[player].secondary;
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
    const count = secondaries[player].hand.length;
    cardButtonsEl[player].hidden = !secondaryCardsOn() || !(running || paused);
    primaryButtonEl[player].hidden = !primaryCards[player];
    button.querySelector(".score-box__hand-count")!.textContent = String(count);
    button.setAttribute("aria-label", t("handAria", { n: count }));
  }
}

/** The cards of the player whose clock runs or, while paused, whose turn it is */
function cardKeyPlayer(): Player | null {
  if (!secondaryCardsOn()) return null;
  if (running) return active;
  return paused ? turnPlayer : null;
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
    const pile = secondaries[player];
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
  return when === (owner === turnPlayer ? "yours" : "opponent");
}

function turnEndSecondaries(owner: Player): string[] {
  return secondaries[owner].hand.filter((id) => scoresAtTurnEnd(owner, SECONDARY_BY_ID.get(id)!.when));
}

/** Which primary lines score in the view: at a turn end or in the Command phase, only that moment's */
function scoresInView(owner: Player, when: PrimarySection["when"]): boolean {
  if (cardsMode === "end-turn") return scoresAtTurnEnd(owner, when);
  if (cardsMode === "command") return when === "command";
  return true;
}

function primaryScoresInCommand(owner: Player): boolean {
  const card = primaryCards[owner];
  return !!card && card.sections.some((section) => section.when === "command" && sectionOpen(owner, section));
}

function primaryScoresAtTurnEnd(owner: Player): boolean {
  const card = primaryCards[owner];
  return !!card && card.sections.some((section) => sectionOpen(owner, section) && scoresAtTurnEnd(owner, section.when));
}

const turnEndCount = (owner: Player): number =>
  turnEndSecondaries(owner).length + (primaryScoresAtTurnEnd(owner) ? 1 : 0);

/** With the cards, ending a turn first shows what scores now; with nothing to score, the plain confirmation */
function requestEndTurn(kind: TurnConfirmKind): void {
  endTurnKind = kind;
  const opponent: Player = turnPlayer === 1 ? 2 : 1;
  endTurnSides = secondaryCardsOn() ? [turnPlayer, opponent].filter((side) => turnEndCount(side) > 0) : [];
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
    const pile = secondaries[cardsPlayer];
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
  const scored = cardsPlayer === null ? 0 : secondaries[cardsPlayer].scored.length;
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
  if (cardsMode === "end-turn") openCards(Number(value) as Player, "end-turn");
  else openCards(cardsPlayer, value === "scored" ? "scored" : "hand");
}

/** `dealIds` fly in from the deck; the others are already on the table */
function renderCards(dealIds: string[] = []): void {
  if (cardsPlayer === null) return;
  const player = cardsPlayer;
  const pile = secondaries[player];
  const closeLabel: StringKey =
    cardsMode === "primary" ? "startGame" : cardsMode !== "end-turn" ? "continue" : endTurnKind === "finish-game" ? "endBattleBtn" : "endTurnBtn";
  btnCardsClose.querySelector("span")!.textContent = t(closeLabel);
  renderCardsSwitch();
  if (cardsMode === "primary") {
    cardsTitle.textContent = t("primaryTitle");
    cardsSub.textContent = "";
    // The two missions face off: they rush in from each side and clash on a "VS"
    const versus = document.createElement("div");
    versus.className = "versus";
    versus.setAttribute("aria-hidden", "true");
    versus.innerHTML = "<span class=\"versus__line\"></span><span class=\"versus__text\">VS</span>";
    const [first, second] = ([1, 2] as const).map((owner, index) =>
      primaryCardEl(owner, index, dealIds.includes(primaryCardId(owner)), false),
    );
    cardsRow.classList.toggle("is-clashing", dealIds.length > 0);
    cardsRow.replaceChildren(first, versus, second);
    layoutCardsRow();
    return;
  }
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
    cardsTitle.textContent = t("endTurnScoringTitle", { n: turnPlayer });
    cardsSub.textContent = player === turnPlayer ? t("endTurnScoringSub") : t("endTurnOpponentSub", { n: player });
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
  const primary = withPrimary && primaryCards[player] ? [primaryCardEl(player, 0, dealIds.includes(primaryCardId(player)), true)] : [];
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
  el.querySelector(".sec-card__when")!.textContent = data.when ? t(WHEN_KEYS[data.when]) : "";
  const note = el.querySelector<HTMLElement>(".sec-card__note")!;
  note.textContent = data.note ? data.note[lang] : "";
  note.hidden = !data.note;

  const unit = t("vpUnit");
  const scorable = cardsMode === "hand" || cardsMode === "end-turn";
  const options = data.options.map((option) => {
    if ("vp" in option) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sec-option";
      button.disabled = !scorable;
      button.dataset.action = "score";
      button.dataset.vp = String(option.vp);
      button.innerHTML = `<span class="sec-option__vp">${option.vp}<small>${unit}</small></span><span class="sec-option__label"></span>`;
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
    block.querySelector(".sec-option__go")!.textContent = `${t("scoreIt")} ${repeatTotal(block)} ${unit}`;
    block.querySelector<HTMLElement>(".sec-option__repeat")!.hidden = !scorable;
    return block;
  });
  el.querySelector(".sec-card__options")!.replaceChildren(...options);

  const actions: HTMLElement[] = [];
  if (cardsMode === "draw" && data.redraw && drawnIds.includes(id) && secondaries[player].deck.length > 0) {
    const redraw = document.createElement("button");
    redraw.type = "button";
    redraw.className = "sec-action sec-action--redraw";
    redraw.dataset.action = "redraw";
    redraw.innerHTML = `<span></span><small></small>`;
    redraw.querySelector("span")!.textContent = t("redrawFree");
    redraw.querySelector("small")!.textContent = t("redrawIf", { cond: data.redraw.condition[lang] });
    actions.push(redraw);
  }
  const scored = cardsMode === "scored" ? secondaries[player].scored.find((entry) => entry.id === id) : undefined;
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
    swapCard.textContent = newCardUsed[player] ? t("swapUsed") : t("swapCp");
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
  secondaries[player].scored.push({ id, vp: added, turn });
  playSound("score");
  playCardExit(cardEl, "is-scored", `+${added}`);
}

/** Pending undo, until the player confirms it */
let pendingUnscore: { player: Player; id: string } | null = null;

function askUnscore(player: Player, id: string): void {
  if (gameOver) return;
  pendingUnscore = { player, id };
  openTurnConfirmModal("unscore");
}

/** A score clicked by mistake: its points leave the turn they went to, the card goes back to the hand */
function restoreSecondary(player: Player, id: string): void {
  const pile = secondaries[player];
  const scored = pile.scored.find((entry) => entry.id === id);
  if (!scored) return;
  pile.scored = pile.scored.filter((entry) => entry !== scored);
  pile.discard = pile.discard.filter((cardId) => cardId !== id);
  pile.hand.push(id);
  const turns = scoreByTurn[player].secondary;
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
  return !newCardUsed[player] && (player === 1 ? cp1 : cp2) >= 1 && secondaries[player].deck.length > 0;
}

/** −1 CP, once per battle: the card is discarded and a new one is dealt in its place */
function swapSecondary(player: Player, id: string, cardEl: HTMLElement): void {
  if (!canSwapSecondary(player)) return;
  adjustCp(player, -1);
  newCardUsed[player] = true;
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

let dispositions: Record<Player, Disposition | null> = { 1: null, 2: null };
let primaryCards: Record<Player, PrimaryCard | null> = { 1: null, 2: null };
/** Points scored by each primary line and turn: one score per line per turn, a second click undoes it */
let primaryScored: Record<Player, Map<string, number>> = { 1: new Map(), 2: new Map() };

/** With the cards on, the game starts by choosing force dispositions */
function requestStart(): void {
  if (secondaryCardsOn()) openDispositions();
  else openTurnConfirmModal("start-game");
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
  dispoOverlay.querySelectorAll<HTMLElement>(".dispo-options").forEach((group) => {
    const player = Number(group.dataset.player) as Player;
    group.querySelectorAll<HTMLButtonElement>(".dispo-option").forEach((option) => {
      const data = DISPOSITIONS.find(({ id }) => id === option.dataset.value)!;
      option.setAttribute("aria-pressed", String(dispositions[player] === data.id));
      option.querySelector(".dispo-option__hint")!.textContent = data.hint[lang];
    });
  });
  btnDispoOk.disabled = !dispositions[1] || !dispositions[2];
}

/** Both dispositions known: each player gets the card of their deck facing the other's */
function revealPrimaries(): void {
  const mine = dispositions[1];
  const theirs = dispositions[2];
  if (!mine || !theirs) return;
  primaryCards = { 1: primaryFor(mine, theirs), 2: primaryFor(theirs, mine) };
  primaryScored = { 1: new Map(), 2: new Map() };
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
  if (section.rounds === "end") return gameOver || turnIdx === MAX_GAME_TURN - 1;
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
  const data = primaryCards[player]!;
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

  const scored = primaryScored[player];
  const sections = data.sections.map((section, s) => {
    const turnKey = sectionTurnKey(player, section);
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
      const done = scored.get(key);
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
        button.innerHTML = `<span class="sec-option__vp">${done !== undefined ? "✓" : ""}${shown}<small>${unit}</small></span><span class="sec-option__label"></span>`;
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
      go.textContent = `${t("scoreIt")} ${itemTotal(item, row)} ${unit}`;
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
  const card = primaryCards[player];
  if (!card) return;
  const section = card.sections[s];
  const turnKey = sectionTurnKey(player, section);
  const key = `${turnKey}|${s}|${i}`;
  const scored = primaryScored[player];
  const done = scored.get(key);
  // The points of a line leave the turn, or the end bonus, they went to
  const takeBack = (lineKey: string, points: number): void => {
    scored.delete(lineKey);
    if (turnKey === "end") endBonus[player] = Math.max(0, endBonus[player] - points);
    else {
      const turns = scoreByTurn[player].primary;
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
        const points = scored.get(otherKey);
        if (points !== undefined) takeBack(otherKey, points);
      });
    }
    let added = vp;
    if (turnKey === "end") endBonus[player] += vp;
    else {
      const turns = scoreByTurn[player].primary;
      const turnIdx = Number(turnKey);
      added = Math.max(0, Math.min(vp, MAX_POINTS_PER_TURN - turns[turnIdx]));
      turns[turnIdx] += added;
    }
    scored.set(key, added);
    playSound("score");
  }
  renderMiniCounters();
  renderCards();
}

function adjustScore(player: Player, kind: ScoreKind, delta: 1 | -1): void {
  const turns = scoreByTurn[player][kind];
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

function adjustEndBonus(player: Player, delta: 1 | -1): void {
  endBonus[player] = Math.max(0, endBonus[player] + delta);
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
  primaryButtonEl[player].addEventListener("click", () => openCards(player, "mission"));
}
cardsSwitch.addEventListener("click", (e) => {
  const tab = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  if (tab && !tab.disabled) showCardsTab(tab.dataset.tab!);
});
/** Continue: after the primaries reveal, the game starts */
function continueCards(): void {
  if (cardsPlayer === null) return;
  const startsGame = cardsMode === "primary";
  const turnEnd = cardsMode === "end-turn" ? endTurnKind : null;
  closeCards();
  if (startsGame) start();
  if (turnEnd) applyConfirmed(turnEnd);
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
  if (!option) return;
  const player = Number(option.closest<HTMLElement>(".dispo-options")!.dataset.player) as Player;
  dispositions[player] = option.dataset.value as Disposition;
  renderDispositions();
});
btnDispoOk.addEventListener("click", revealPrimaries);
btnDispoCancel.addEventListener("click", closeDispositions);
window.addEventListener("resize", () => {
  if (cardsPlayer !== null) layoutCardsRow();
});
secondaryCardsToggle.addEventListener("change", () => {
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
    const card = primaryCards[owner];
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
      row.querySelector(".sec-option__go")!.textContent = `${t("scoreIt")} ${itemTotal(item, row)} ${t("vpUnit")}`;
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
      option.querySelector(".sec-option__go")!.textContent = `${t("scoreIt")} ${repeatTotal(option)} ${t("vpUnit")}`;
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
      t(i === currentGameTurn ? "dotCurrent" : i < currentGameTurn ? "dotDone" : "dotNext", { n: i }),
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
    if (gameOver) return;
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
  if (e.code === MUTE_KEY_CODE && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
    e.preventDefault();
    toggleMute();
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
      revealPrimaries();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDispositions();
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
  if (keyMode && keyPlayer && (keyMode === "hand" || primaryCards[keyPlayer])) {
    e.preventDefault();
    openCards(keyPlayer, keyMode);
    return;
  }
  if (e.code === "Enter" && !e.repeat) {
    if (shouldIgnoreSpaceLike(e.target)) return;
    if (!running) {
      e.preventDefault();
      if (gameOver) return;
      if (paused) handleSpaceLikeInput();
      else requestStart();
      return;
    }
    e.preventDefault();
    if (turnPlayer === 1) requestEndTurn("p1-to-p2");
    else requestEndTurn(currentGameTurn >= MAX_GAME_TURN ? "finish-game" : "next-round");
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
  if (running) return;
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
    if (running) return;
    const { a, b } = readMinutes();
    seconds1 = a * 60;
    seconds2 = b * 60;
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

btnStart.addEventListener("click", () => {
  if (running || paused) return;
  if (secondaryCardsOn()) openDispositions();
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
    applyWallClockCatchUp();
    if (running) void tryAcquireWakeLock();
  }
});

window.addEventListener("pageshow", (e) => {
  if (e.persisted) applyWallClockCatchUp();
});

// Paused or over still counts as a game: its board stays until a reset
setupPwa(() => running || paused);
