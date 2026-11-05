/*
 * 11th edition primary missions: each player's card depends on their force disposition and on
 * their opponent's. Only names and point values are kept, with short labels in our own words:
 * the full card text stays on gdmissions.app (see `url`).
 */
import { ACTIONS, type MissionAction } from "./actions";
import type { Text } from "./secondaries";

export type Disposition = "take-and-hold" | "purge-the-foe" | "reconnaissance" | "priority-assets" | "disruption";

export const DISPOSITIONS: { id: Disposition; name: string; hint: Text }[] = [
  { id: "take-and-hold", name: "Take and Hold", hint: { en: "Hold objectives", fr: "Tenir les objectifs" } },
  { id: "purge-the-foe", name: "Purge the Foe", hint: { en: "Destroy the enemy", fr: "Détruire l'ennemi" } },
  { id: "reconnaissance", name: "Reconnaissance", hint: { en: "Scout and gather intel", fr: "Éclairer et renseigner" } },
  { id: "priority-assets", name: "Priority Assets", hint: { en: "Secure key assets", fr: "Sécuriser des cibles clés" } },
  { id: "disruption", name: "Disruption", hint: { en: "Deny and deceive", fr: "Gêner et tromper" } },
];

/**
 * A way to score: fixed points, points per thing (with an optional bonus per some of those
 * things), or a base plus points per thing. With `action`, what it counts comes from the card's
 * action, told on its back
 */
export type PrimaryItem = (
  | { vp: number; label: Text }
  | { per: number; label: Text; bonus?: { per: number; label: Text } }
  | { base: number; label: Text; plus: { per: number; label: Text } }
) & { action?: true };

export type PrimarySection = {
  /** Battle rounds when it scores, or the end of the battle */
  rounds: [number, number] | "end";
  when: "yours" | "command" | "any" | "end";
  /** The items are alternatives: only one of them scores */
  pickOne?: boolean;
  items: PrimaryItem[];
};

export type PrimaryCard = {
  id: string;
  name: string;
  deck: Disposition;
  vs: Disposition;
  url: string;
  note?: Text;
  /** On the back of the card */
  action?: MissionAction;
  sections: PrimarySection[];
};

const ALL: [number, number] = [1, 5];
const FROM_2: [number, number] = [2, 5];

const CONTROL_ONE: Text = { en: "You control 1+ objectives (not home)", fr: "Vous contrôlez 1+ objectif (hors objectif maison)" };
const MORE_OBJECTIVES: Text = { en: "More objectives than the enemy", fr: "Plus d'objectifs que l'adversaire" };
const PER_OBJECTIVE: Text = { en: "Per objective you control", fr: "Par objectif contrôlé" };
const PER_OBJECTIVE_NOT_HOME: Text = { en: "Per objective you control (not home)", fr: "Par objectif contrôlé (hors objectif maison)" };
const ENEMY_DESTROYED: Text = { en: "Enemy unit destroyed this turn", fr: "Unité ennemie détruite ce tour" };
const PER_ENEMY_DESTROYED: Text = { en: "Per enemy unit destroyed this turn", fr: "Par unité ennemie détruite ce tour" };
const ENEMY_HOME: Text = { en: "You control the enemy home objective", fr: "Vous contrôlez l'objectif maison adverse" };
const CENTRAL: Text = { en: "You control a central objective", fr: "Vous contrôlez un objectif central" };
const TOOK_OBJECTIVE: Text = { en: "You took an objective this turn (not home)", fr: "Objectif pris ce tour (hors objectif maison)" };
const KILLED_ON_OBJECTIVE: Text = {
  en: "Enemy unit destroyed that started the turn within range of an objective",
  fr: "Unité ennemie détruite qui commençait le tour à portée d'un objectif",
};
/** The terrain area holding a marker, held: one of your units in it and no enemy unit, even partly */
const LAST_ENEMY_MARKER: Text = {
  en: "A unit of yours within the terrain area of the last enemy marker, no enemy unit within it",
  fr: "Une unité à vous dans le décor du dernier marqueur adverse, aucun ennemi dedans (même en partie)",
};
const LAST_OWN_MARKER: Text = {
  en: "A unit of yours within the terrain area of your last marker, no enemy unit within it",
  fr: "Une unité à vous dans le décor de votre dernier marqueur, aucun ennemi dedans (même en partie)",
};
const OUT_KILLED: Text = {
  en: "Destroyed more than you lost last turn",
  fr: "Plus de pertes infligées que subies au tour précédent",
};

const card = (deck: Disposition, id: string, name: string, vs: Disposition, rest: Pick<PrimaryCard, "note" | "action" | "sections">): PrimaryCard => ({
  id,
  name,
  deck,
  vs,
  url: `https://gdmissions.app/11th/primary-missions/${deck}/${id}`,
  ...rest,
});

export const PRIMARY_CARDS: PrimaryCard[] = [
  // Take and Hold
  card("take-and-hold", "battlefield-dominance", "Battlefield Dominance", "take-and-hold", {
    sections: [
      { rounds: [1, 2], when: "yours", items: [{ vp: 2, label: MORE_OBJECTIVES }] },
      {
        rounds: FROM_2,
        when: "command",
        items: [
          {
            per: 3,
            label: PER_OBJECTIVE,
            bonus: { per: 2, label: { en: "Bonus per one (not home) if you hold your home", fr: "Bonus par objectif (hors maison) si vous tenez votre objectif maison" } },
          },
        ],
      },
    ],
  }),
  card("take-and-hold", "determined-acquisition", "Determined Acquisition", "disruption", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [{ per: 2, label: { en: "Per objective taken this turn (not home)", fr: "Par objectif pris ce tour (hors objectif maison)" } }],
      },
      {
        rounds: FROM_2,
        when: "command",
        items: [{ per: 3, label: PER_OBJECTIVE, bonus: { per: 3, label: { en: "Bonus per one within enemy territory", fr: "Bonus par objectif dans le territoire adverse" } } }],
      },
    ],
  }),
  card("take-and-hold", "immovable-object", "Immovable Object", "purge-the-foe", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 3, label: CENTRAL }] },
      { rounds: [2, 4], when: "command", items: [{ per: 5, label: PER_OBJECTIVE_NOT_HOME }] },
      { rounds: [5, 5], when: "yours", items: [{ per: 5, label: PER_OBJECTIVE_NOT_HOME }] },
    ],
  }),
  card("take-and-hold", "inescapable-dominion", "Inescapable Dominion", "priority-assets", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 4, label: { en: "You control 3+ objectives", fr: "Vous contrôlez 3+ objectifs" } }] },
      {
        rounds: FROM_2,
        when: "command",
        items: [{ vp: 5, label: { en: "You control 2+ objectives", fr: "Vous contrôlez 2+ objectifs" } }, { vp: 4, label: MORE_OBJECTIVES }],
      },
      { rounds: "end", when: "end", items: [{ vp: 5, label: ENEMY_HOME }] },
    ],
  }),
  card("take-and-hold", "purge-and-secure", "Purge and Secure", "reconnaissance", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        pickOne: true,
        items: [
          { vp: 3, label: { en: "Enemy unit destroyed by a unit within range of an objective", fr: "Unité ennemie détruite par une unité à portée d'un objectif" } },
          { vp: 3, label: KILLED_ON_OBJECTIVE },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ per: 4, label: PER_OBJECTIVE_NOT_HOME }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 3, label: TOOK_OBJECTIVE }] },
    ],
  }),

  // Purge the Foe
  card("purge-the-foe", "consecrate", "Consecrate", "reconnaissance", {
    note: {
      en: "A unit that destroys a unit can consecrate an objective it is within range of",
      fr: "Une unité qui en détruit une peut consacrer un objectif à sa portée",
    },
    sections: [
      {
        rounds: ALL,
        when: "yours",
        pickOne: true,
        items: [
          { vp: 3, label: { en: "1–2 objectives consecrated", fr: "1–2 objectifs consacrés" } },
          { vp: 6, label: { en: "3+ objectives consecrated", fr: "3+ objectifs consacrés" } },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }, { vp: 4, label: MORE_OBJECTIVES }] },
      { rounds: "end", when: "end", items: [{ vp: 5, label: { en: "Enemy home objective consecrated", fr: "Objectif maison adverse consacré" } }] },
    ],
  }),
  card("purge-the-foe", "destroyers-wrath", "Destroyer's Wrath", "priority-assets", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 3, label: ENEMY_DESTROYED }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }, { vp: 6, label: MORE_OBJECTIVES }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 4, label: OUT_KILLED }] },
    ],
  }),
  card("purge-the-foe", "meatgrinder", "Meatgrinder", "purge-the-foe", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 3, label: ENEMY_DESTROYED }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 5, label: OUT_KILLED }, { vp: 5, label: ENEMY_HOME }] },
    ],
  }),
  card("purge-the-foe", "punishment", "Punishment", "disruption", {
    note: { en: "Start of your turn: condemn 1–3 enemy units", fr: "Début de votre tour : condamnez 1 à 3 unités ennemies" },
    sections: [
      {
        rounds: ALL,
        when: "any",
        items: [{ vp: 5, label: { en: "A condemned unit left the battlefield", fr: "Une unité condamnée a quitté la table" } }],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }, { vp: 5, label: MORE_OBJECTIVES }] },
      { rounds: "end", when: "end", items: [{ vp: 8, label: ENEMY_HOME }] },
    ],
  }),
  card("purge-the-foe", "unstoppable-force", "Unstoppable Force", "take-and-hold", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 3, label: ENEMY_DESTROYED }] },
      { rounds: FROM_2, when: "command", items: [{ per: 4, label: PER_OBJECTIVE_NOT_HOME }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 3, label: TOOK_OBJECTIVE }] },
      { rounds: "end", when: "end", items: [{ vp: 5, label: CENTRAL }] },
    ],
  }),

  // Reconnaissance
  card("reconnaissance", "gather-intel", "Gather Intel", "reconnaissance", {
    action: ACTIONS.extractIntelligence,
    sections: [
      { rounds: [1, 1], when: "yours", items: [{ vp: 6, label: CENTRAL }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: FROM_2,
        when: "yours",
        items: [{ per: 7, label: { en: "Per unit that extracted intelligence", fr: "Par unité ayant extrait des infos" }, action: true }],
      },
      {
        rounds: "end",
        when: "end",
        items: [
          { vp: 5, label: { en: "3+ of your markers on the battlefield", fr: "3+ de vos marqueurs sur la table" } },
          { vp: 5, label: { en: "A marker of yours within range of the enemy home objective", fr: "Un de vos marqueurs à portée de l'objectif maison adverse" } },
        ],
      },
    ],
  }),
  card("reconnaissance", "reconnaissance-sweep", "Reconnaissance Sweep", "take-and-hold", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        pickOne: true,
        items: [
          { vp: 3, label: { en: "Units wholly within 3 table quarters, not within 6\" of the centre", fr: "Unités entièrement dans 3 quarts de table, à plus de 6\" du centre" } },
          { vp: 6, label: { en: "Units wholly within 4 table quarters, not within 6\" of the centre", fr: "Unités entièrement dans 4 quarts de table, à plus de 6\" du centre" } },
        ],
      },
      { rounds: ALL, when: "yours", items: [{ per: 1, label: PER_ENEMY_DESTROYED }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 3, label: CONTROL_ONE }] },
    ],
  }),
  card("reconnaissance", "search-and-scour", "Search and Scour", "priority-assets", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 3, label: CENTRAL },
          { vp: 2, label: { en: "Enemy unit destroyed that started the turn within a terrain area", fr: "Unité ennemie détruite qui commençait le tour dans un décor (même en partie)" } },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ per: 4, label: PER_OBJECTIVE_NOT_HOME }] },
      {
        rounds: "end",
        when: "end",
        items: [{ vp: 5, label: { en: "No enemy unit wholly within your territory", fr: "Aucune unité ennemie entièrement dans votre territoire" } }],
      },
    ],
  }),
  card("reconnaissance", "surveil-the-foe", "Surveil the Foe", "disruption", {
    note: {
      en: "Ending a move within range of an objective removes the enemy markers within range of it",
      fr: "Finir un mouvement à portée d'un objectif retire les marqueurs adverses à sa portée",
    },
    action: ACTIONS.surveil,
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 4, label: { en: "Enemy unit surveilled this turn", fr: "Unité ennemie surveillée ce tour" }, action: true }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }, { vp: 4, label: MORE_OBJECTIVES }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 5, label: { en: "No enemy marker left on the battlefield", fr: "Plus aucun marqueur adverse sur la table" } }] },
    ],
  }),
  card("reconnaissance", "triangulation", "Triangulation", "purge-the-foe", {
    action: ACTIONS.triangulate,
    sections: [
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: FROM_2,
        when: "yours",
        pickOne: true,
        items: [
          { vp: 3, label: { en: "1 objective triangulated", fr: "1 objectif triangulé" }, action: true },
          { vp: 6, label: { en: "2 objectives triangulated", fr: "2 objectifs triangulés" }, action: true },
          { vp: 10, label: { en: "3+ objectives triangulated", fr: "3+ objectifs triangulés" }, action: true },
        ],
      },
      { rounds: "end", when: "end", items: [{ vp: 10, label: { en: "You control 4+ objectives", fr: "Vous contrôlez 4+ objectifs" } }] },
    ],
  }),

  // Priority Assets
  card("priority-assets", "extract-relic", "Extract Relic", "disruption", {
    action: ACTIONS.sensorSweep,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: { en: "A unit performed a sensor sweep", fr: "Une unité a fait un balayage" }, action: true },
          { vp: 3, label: KILLED_ON_OBJECTIVE },
          { vp: 4, label: LAST_ENEMY_MARKER },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: "end",
        when: "end",
        items: [{ vp: 5, label: LAST_ENEMY_MARKER }],
      },
    ],
  }),
  card("priority-assets", "sabotage", "Sabotage", "priority-assets", {
    action: ACTIONS.sabotage,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            per: 3,
            label: { en: "Per unit that committed sabotage", fr: "Par unité ayant saboté" },
            bonus: { per: 2, label: { en: "Bonus per one within range of an objective in enemy territory", fr: "Bonus par saboteur à portée d'un objectif du territoire adverse" } },
            action: true,
          },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
    ],
  }),
  card("priority-assets", "secure-asset", "Secure Asset", "take-and-hold", {
    action: ACTIONS.secureAsset,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: { en: "A unit secured the asset", fr: "Une unité a sécurisé la cible" }, action: true },
          { vp: 2, label: { en: "Enemy unit destroyed that started the turn within range of a central objective", fr: "Unité ennemie détruite qui commençait le tour à portée d'un objectif central" } },
        ],
      },
      {
        rounds: FROM_2,
        when: "command",
        items: [{ vp: 4, label: CONTROL_ONE }, { vp: 4, label: { en: "You control 3+ objectives", fr: "Vous contrôlez 3+ objectifs" } }],
      },
    ],
  }),
  card("priority-assets", "vanguard-operation", "Vanguard Operation", "reconnaissance", {
    action: ACTIONS.vanguard,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: { en: "A unit performed a vanguard operation", fr: "Une unité a mené une opération d'avant-garde" }, action: true },
          { vp: 2, label: ENEMY_DESTROYED },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      { rounds: "end", when: "end", items: [{ vp: 10, label: ENEMY_HOME }] },
    ],
  }),
  card("priority-assets", "vital-link", "Vital Link", "purge-the-foe", {
    action: ACTIONS.maintainControl,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [{ base: 2, label: CENTRAL, plus: { per: 1, label: { en: "Per marker of yours within range of it", fr: "Par marqueur à vous à sa portée" } }, action: true }],
      },
      {
        rounds: FROM_2,
        when: "command",
        pickOne: true,
        items: [{ vp: 4, label: CONTROL_ONE }, { vp: 8, label: { en: "…and one of them is central", fr: "…dont un objectif central" } }],
      },
      { rounds: "end", when: "end", items: [{ vp: 10, label: ENEMY_HOME }] },
    ],
  }),

  // Disruption
  card("disruption", "death-trap", "Death Trap", "take-and-hold", {
    action: ACTIONS.boobyTrap,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            per: 2,
            label: { en: "Per terrain area trapped this turn", fr: "Par décor piégé ce tour" },
            bonus: { per: 3, label: { en: "Bonus per one that is an objective", fr: "Bonus par décor qui est un objectif" } },
            action: true,
          },
        ],
      },
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            vp: 3,
            label: {
              en: "Enemy unit destroyed that started the turn within a trapped terrain area",
              fr: "Unité ennemie détruite qui commençait le tour dans un décor piégé (même en partie)",
            },
          },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
    ],
  }),
  card("disruption", "delaying-action", "Delaying Action", "purge-the-foe", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ per: 2, label: PER_ENEMY_DESTROYED }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: FROM_2,
        when: "yours",
        items: [{ vp: 3, label: { en: "You control a central and an expansion objective", fr: "Vous contrôlez un objectif central et un d'expansion" } }],
      },
    ],
  }),
  card("disruption", "locate-and-deny", "Locate and Deny", "priority-assets", {
    note: {
      en: "Start of battle: a marker in 5 terrain areas not within your deployment zone",
      fr: "Début de bataille : un marqueur dans 5 décors entièrement hors de votre zone de déploiement",
    },
    action: ACTIONS.sensorSweep,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: KILLED_ON_OBJECTIVE },
          { vp: 4, label: LAST_OWN_MARKER },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: "end",
        when: "end",
        items: [{ vp: 5, label: LAST_OWN_MARKER }],
      },
    ],
  }),
  card("disruption", "outmanoeuvre", "Outmanoeuvre", "disruption", {
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 10, label: ENEMY_HOME }] },
      { rounds: [1, 1], when: "yours", items: [{ per: 4, label: PER_OBJECTIVE_NOT_HOME }] },
      { rounds: [2, 3], when: "command", items: [{ per: 5, label: PER_OBJECTIVE_NOT_HOME }] },
      { rounds: [4, 5], when: "yours", items: [{ per: 6, label: PER_OBJECTIVE_NOT_HOME }] },
    ],
  }),
  card("disruption", "smoke-and-mirrors", "Smoke and Mirrors", "reconnaissance", {
    action: ACTIONS.decoy,
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            per: 2,
            label: { en: "Per objective decoyed", fr: "Par objectif leurré" },
            bonus: { per: 2, label: { en: "Bonus per one within enemy territory", fr: "Bonus par objectif dans le territoire adverse" } },
            action: true,
          },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      { rounds: "end", when: "end", items: [{ vp: 10, label: { en: "4+ objectives decoyed", fr: "4+ objectifs leurrés" }, action: true }] },
    ],
  }),
];

/** The primary card of a player, given both force dispositions */
export function primaryFor(mine: Disposition, theirs: Disposition): PrimaryCard {
  return PRIMARY_CARDS.find((primary) => primary.deck === mine && primary.vs === theirs)!;
}

export const PRIMARY_BY_ID = new Map(PRIMARY_CARDS.map((primary) => [primary.id, primary]));
