/*
 * 11th edition primary missions: each player's card depends on their force disposition and on
 * their opponent's. Only names and point values are kept, with short labels in our own words:
 * the full card text stays on gdmissions.app (see `url`).
 */
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
 * things), or a base plus points per thing.
 */
export type PrimaryItem =
  | { vp: number; label: Text }
  | { per: number; label: Text; bonus?: { per: number; label: Text } }
  | { base: number; label: Text; plus: { per: number; label: Text } };

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
  sections: PrimarySection[];
};

const ALL: [number, number] = [1, 5];
const FROM_2: [number, number] = [2, 5];

const CONTROL_ONE: Text = { en: "You control 1+ objectives (not home)", fr: "Vous contrôlez 1+ objectif (hors base)" };
const MORE_OBJECTIVES: Text = { en: "More objectives than the enemy", fr: "Plus d'objectifs que l'adversaire" };
const PER_OBJECTIVE: Text = { en: "Per objective you control", fr: "Par objectif contrôlé" };
const PER_OBJECTIVE_NOT_HOME: Text = { en: "Per objective you control (not home)", fr: "Par objectif contrôlé (hors base)" };
const ENEMY_DESTROYED: Text = { en: "Enemy unit destroyed this turn", fr: "Unité ennemie détruite ce tour" };
const PER_ENEMY_DESTROYED: Text = { en: "Per enemy unit destroyed this turn", fr: "Par unité ennemie détruite ce tour" };
const ENEMY_HOME: Text = { en: "You control the enemy home objective", fr: "Vous contrôlez l'objectif de base adverse" };
const CENTRAL: Text = { en: "You control a central objective", fr: "Vous contrôlez un objectif central" };
const TOOK_OBJECTIVE: Text = { en: "You took an objective this turn (not home)", fr: "Objectif pris ce tour (hors base)" };
const KILLED_ON_OBJECTIVE: Text = {
  en: "Enemy unit destroyed that started on an objective",
  fr: "Unité ennemie détruite partie d'un objectif",
};
const OUT_KILLED: Text = {
  en: "Destroyed more than you lost last turn",
  fr: "Plus de pertes infligées que subies au tour précédent",
};

const card = (deck: Disposition, id: string, name: string, vs: Disposition, rest: Pick<PrimaryCard, "note" | "sections">): PrimaryCard => ({
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
            bonus: { per: 2, label: { en: "Bonus per one (not home) if you hold your home", fr: "Bonus par objectif (hors base) si vous tenez votre base" } },
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
        items: [{ per: 2, label: { en: "Per objective taken this turn (not home)", fr: "Par objectif pris ce tour (hors base)" } }],
      },
      {
        rounds: FROM_2,
        when: "command",
        items: [{ per: 3, label: PER_OBJECTIVE, bonus: { per: 3, label: { en: "Bonus per one in enemy territory", fr: "Bonus par objectif en territoire adverse" } } }],
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
          { vp: 3, label: { en: "Enemy unit destroyed by a unit on an objective", fr: "Unité ennemie détruite par une unité sur un objectif" } },
          { vp: 3, label: KILLED_ON_OBJECTIVE },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ per: 4, label: PER_OBJECTIVE_NOT_HOME }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 3, label: TOOK_OBJECTIVE }] },
    ],
  }),

  // Purge the Foe
  card("purge-the-foe", "consecrate", "Consecrate", "reconnaissance", {
    note: { en: "A unit that destroys a unit can consecrate an objective", fr: "Une unité qui en détruit une peut consacrer un objectif" },
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
      { rounds: "end", when: "end", items: [{ vp: 5, label: { en: "Enemy home objective consecrated", fr: "Objectif de base adverse consacré" } }] },
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
    sections: [
      { rounds: [1, 1], when: "yours", items: [{ vp: 6, label: CENTRAL }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      { rounds: FROM_2, when: "yours", items: [{ per: 7, label: { en: "Per unit that extracted intelligence", fr: "Par unité ayant extrait des infos" } }] },
      {
        rounds: "end",
        when: "end",
        items: [
          { vp: 5, label: { en: "3+ of your markers on the battlefield", fr: "3+ de vos marqueurs sur la table" } },
          { vp: 5, label: { en: "A marker on the enemy home objective", fr: "Un marqueur sur l'objectif de base adverse" } },
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
          { vp: 3, label: { en: "Units in 3 table quarters, off the centre", fr: "Unités dans 3 quarts de table, hors centre" } },
          { vp: 6, label: { en: "Units in 4 table quarters, off the centre", fr: "Unités dans 4 quarts de table, hors centre" } },
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
          { vp: 2, label: { en: "Enemy unit destroyed that started in terrain", fr: "Unité ennemie détruite partie d'un décor" } },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ per: 4, label: PER_OBJECTIVE_NOT_HOME }] },
      {
        rounds: "end",
        when: "end",
        items: [{ vp: 5, label: { en: "No enemy unit wholly in your territory", fr: "Aucune unité ennemie entièrement chez vous" } }],
      },
    ],
  }),
  card("reconnaissance", "surveil-the-foe", "Surveil the Foe", "disruption", {
    note: { en: "Ending a move on an objective removes enemy markers there", fr: "Finir un mouvement sur un objectif retire les marqueurs adverses" },
    sections: [
      { rounds: ALL, when: "yours", items: [{ vp: 4, label: { en: "Enemy unit surveilled this turn", fr: "Unité ennemie surveillée ce tour" } }] },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }, { vp: 4, label: MORE_OBJECTIVES }] },
      { rounds: FROM_2, when: "yours", items: [{ vp: 5, label: { en: "No enemy marker left on the battlefield", fr: "Plus aucun marqueur adverse sur la table" } }] },
    ],
  }),
  card("reconnaissance", "triangulation", "Triangulation", "purge-the-foe", {
    sections: [
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: FROM_2,
        when: "yours",
        pickOne: true,
        items: [
          { vp: 3, label: { en: "1 objective triangulated", fr: "1 objectif triangulé" } },
          { vp: 6, label: { en: "2 objectives triangulated", fr: "2 objectifs triangulés" } },
          { vp: 10, label: { en: "3+ objectives triangulated", fr: "3+ objectifs triangulés" } },
        ],
      },
      { rounds: "end", when: "end", items: [{ vp: 10, label: { en: "You control 4+ objectives", fr: "Vous contrôlez 4+ objectifs" } }] },
    ],
  }),

  // Priority Assets
  card("priority-assets", "extract-relic", "Extract Relic", "disruption", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: { en: "A unit performed a sensor sweep", fr: "Une unité a fait un balayage" } },
          { vp: 3, label: KILLED_ON_OBJECTIVE },
          { vp: 4, label: { en: "You hold the terrain of the last enemy marker", fr: "Vous tenez le décor du dernier marqueur adverse" } },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: "end",
        when: "end",
        items: [{ vp: 5, label: { en: "You hold the terrain of the last enemy marker", fr: "Vous tenez le décor du dernier marqueur adverse" } }],
      },
    ],
  }),
  card("priority-assets", "sabotage", "Sabotage", "priority-assets", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            per: 3,
            label: { en: "Per unit that committed sabotage", fr: "Par unité ayant saboté" },
            bonus: { per: 2, label: { en: "Bonus per one on an objective in enemy territory", fr: "Bonus par saboteur sur un objectif adverse" } },
          },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
    ],
  }),
  card("priority-assets", "secure-asset", "Secure Asset", "take-and-hold", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: { en: "A unit secured the asset", fr: "Une unité a sécurisé la cible" } },
          { vp: 2, label: { en: "Enemy unit destroyed that started on a central objective", fr: "Unité ennemie détruite partie d'un objectif central" } },
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
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: { en: "A unit performed a vanguard operation", fr: "Une unité a mené une opération d'avant-garde" } },
          { vp: 2, label: ENEMY_DESTROYED },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      { rounds: "end", when: "end", items: [{ vp: 10, label: ENEMY_HOME }] },
    ],
  }),
  card("priority-assets", "vital-link", "Vital Link", "purge-the-foe", {
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [{ base: 2, label: CENTRAL, plus: { per: 1, label: { en: "Per marker of yours on it", fr: "Par marqueur à vous dessus" } } }],
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
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            per: 2,
            label: { en: "Per terrain area trapped this turn", fr: "Par décor piégé ce tour" },
            bonus: { per: 3, label: { en: "Bonus per one that is an objective", fr: "Bonus par décor qui est un objectif" } },
          },
        ],
      },
      { rounds: ALL, when: "yours", items: [{ vp: 3, label: { en: "Enemy unit destroyed in a trapped terrain", fr: "Unité ennemie détruite dans un décor piégé" } }] },
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
    note: { en: "Start of battle: put markers in 5 terrain areas out of your zone", fr: "Début de bataille : marqueurs dans 5 décors hors de votre zone" },
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          { vp: 4, label: KILLED_ON_OBJECTIVE },
          { vp: 4, label: { en: "You hold the terrain of your last marker", fr: "Vous tenez le décor de votre dernier marqueur" } },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      {
        rounds: "end",
        when: "end",
        items: [{ vp: 5, label: { en: "You hold the terrain of your last marker", fr: "Vous tenez le décor de votre dernier marqueur" } }],
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
    sections: [
      {
        rounds: ALL,
        when: "yours",
        items: [
          {
            per: 2,
            label: { en: "Per objective decoyed", fr: "Par objectif leurré" },
            bonus: { per: 2, label: { en: "Bonus per one in enemy territory", fr: "Bonus par objectif en territoire adverse" } },
          },
        ],
      },
      { rounds: FROM_2, when: "command", items: [{ vp: 4, label: CONTROL_ONE }] },
      { rounds: "end", when: "end", items: [{ vp: 10, label: { en: "4+ objectives decoyed", fr: "4+ objectifs leurrés" } }] },
    ],
  }),
];

/** The primary card of a player, given both force dispositions */
export function primaryFor(mine: Disposition, theirs: Disposition): PrimaryCard {
  return PRIMARY_CARDS.find((primary) => primary.deck === mine && primary.vs === theirs)!;
}
