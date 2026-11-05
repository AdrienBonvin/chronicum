/*
 * The actions some missions are scored with, told on the back of their card: when a unit starts
 * one, which unit, how often, when it completes and what it does. In our own words, as the rest
 * of the cards: the exact rules stay on gdmissions.app.
 */
import type { Text } from "./secondaries";

export type MissionAction = {
  name: string;
  starts: Text;
  units: Text;
  limit: Text;
  completes: Text;
  effect: Text;
  /** When a unit may not start it */
  restriction?: Text;
};

const SHOOTING: Text = { en: "Your Shooting phase", fr: "Votre phase de tir" };
const SHOOTING_FROM_2: Text = { en: "Your Shooting phase, from the second battle round", fr: "Votre phase de tir, dès le deuxième round" };
const ON_OBJECTIVE: Text = {
  en: "A unit within range of an objective (not your home objective)",
  fr: "Une unité à portée d'un objectif (hors objectif maison)",
};
const ON_CENTRAL: Text = { en: "A unit within range of a central objective", fr: "Une unité à portée d'un objectif central" };
const ONCE: Text = { en: "Once per turn", fr: "Une fois par tour" };
const ONE_PER_OBJECTIVE: Text = { en: "No limit, one unit per objective", fr: "Illimité, une unité par objectif" };
const STILL_HOLDING: Text = {
  en: "End of your turn, if the unit still controls the objective",
  fr: "Fin de votre tour, si l'unité contrôle toujours l'objectif",
};
const AT_ONCE: Text = { en: "At once", fr: "Immédiatement" };
const PLACE_MARKER: Text = { en: "Place one of your markers within range of the objective", fr: "Posez un de vos marqueurs à portée de l'objectif" };

const sensorSweep: MissionAction = {
  name: "Sensor Sweep",
  starts: SHOOTING,
  units: ON_CENTRAL,
  limit: ONCE,
  completes: STILL_HOLDING,
  effect: { en: "Remove one marker from the battlefield", fr: "Retirez un marqueur de la table" },
  restriction: { en: "Not while a single marker is left", fr: "Impossible s'il ne reste qu'un marqueur" },
};

export const ACTIONS = {
  cleanse: {
    name: "Cleanse",
    starts: SHOOTING,
    units: ON_OBJECTIVE,
    limit: ONE_PER_OBJECTIVE,
    completes: STILL_HOLDING,
    effect: { en: "The objective is cleansed", fr: "L'objectif est purifié" },
  },
  plunder: {
    name: "Plunder",
    starts: SHOOTING,
    units: {
      en: "A unit within a terrain area that is not within your territory",
      fr: "Une unité dans un décor (même en partie) entièrement hors de votre territoire",
    },
    limit: ONCE,
    completes: AT_ONCE,
    effect: { en: "The terrain area is plundered", fr: "Le décor est pillé" },
  },
  extractIntelligence: {
    name: "Extract Intelligence",
    starts: SHOOTING_FROM_2,
    units: {
      en: "A unit within range of an objective (not your home objective) with none of your markers within range of it",
      fr: "Une unité à portée d'un objectif (hors objectif maison) sans marqueur à vous",
    },
    limit: ONE_PER_OBJECTIVE,
    completes: STILL_HOLDING,
    effect: PLACE_MARKER,
  },
  surveil: {
    name: "Surveil the Foe",
    starts: SHOOTING,
    units: { en: "Any of your units", fr: "N'importe laquelle de vos unités" },
    limit: { en: "No limit", fr: "Illimité" },
    completes: AT_ONCE,
    effect: {
      en: "An enemy unit within 18\" and visible is surveilled until the end of the turn, once per enemy unit",
      fr: "Une unité ennemie visible à 18\" est surveillée jusqu'à la fin du tour, une fois par unité ennemie",
    },
  },
  triangulate: {
    name: "Triangulate",
    starts: SHOOTING_FROM_2,
    units: ON_OBJECTIVE,
    limit: ONCE,
    completes: STILL_HOLDING,
    effect: { en: "The objective is triangulated: place one of your markers within range of it", fr: "L'objectif est triangulé : posez un de vos marqueurs à sa portée" },
  },
  sensorSweep,
  sabotage: {
    name: "Sabotage",
    starts: SHOOTING,
    units: ON_OBJECTIVE,
    limit: ONE_PER_OBJECTIVE,
    completes: STILL_HOLDING,
    effect: { en: "The unit commits sabotage", fr: "L'unité commet un sabotage" },
  },
  secureAsset: {
    name: "Secure Asset",
    starts: SHOOTING,
    units: ON_OBJECTIVE,
    limit: ONCE,
    completes: STILL_HOLDING,
    effect: { en: "The unit secures the asset", fr: "L'unité sécurise la cible" },
  },
  vanguard: {
    name: "Vanguard Operation",
    starts: SHOOTING,
    units: {
      en: "A unit within a terrain area that is within enemy territory",
      fr: "Une unité dans un décor (même en partie) qui touche le territoire adverse",
    },
    limit: ONCE,
    completes: {
      en: "End of your turn, if no enemy unit is within that terrain area",
      fr: "Fin de votre tour, si aucun ennemi n'est dans ce décor (même en partie)",
    },
    effect: { en: "The unit performs a vanguard operation", fr: "L'unité mène une opération d'avant-garde" },
  },
  maintainControl: {
    name: "Maintain Control",
    starts: SHOOTING,
    units: ON_CENTRAL,
    limit: ONCE,
    completes: STILL_HOLDING,
    effect: PLACE_MARKER,
  },
  boobyTrap: {
    name: "Booby Trap",
    starts: SHOOTING,
    units: {
      en: "A unit within range of an objective (not your home objective) or within a terrain area not within your deployment zone, not trapped by you yet",
      fr: "Une unité à portée d'un objectif (hors objectif maison) ou dans un décor (même en partie) entièrement hors de votre zone de déploiement, pas encore piégé par vous",
    },
    limit: { en: "No limit, one unit per terrain area", fr: "Illimité, une unité par décor" },
    completes: AT_ONCE,
    effect: { en: "The terrain area is trapped: place one of your markers within it", fr: "Le décor est piégé : posez-y un de vos marqueurs" },
  },
  decoy: {
    name: "Decoy",
    starts: SHOOTING,
    units: {
      en: "A unit within range of an objective (not your home objective) not decoyed yet",
      fr: "Une unité à portée d'un objectif (hors objectif maison) pas encore leurré",
    },
    limit: ONE_PER_OBJECTIVE,
    completes: STILL_HOLDING,
    effect: { en: "The objective is decoyed: place one of your markers within range of it", fr: "L'objectif est leurré : posez un de vos marqueurs à sa portée" },
  },
} satisfies Record<string, MissionAction>;
