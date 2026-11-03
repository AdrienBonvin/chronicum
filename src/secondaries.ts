/*
 * 11th edition secondary mission deck, tactical scoring. Only names and point values are kept,
 * with short labels in our own words: the full card text stays on gdmissions.app (see `url`).
 */

export type Text = { en: string; fr: string };

/** One click scores `vp`, or a count of things scores `per` each up to `max` */
export type ScoreOption = { vp: number; label: Text } | { per: number; max: number; label: Text };

export type SecondaryCard = {
  id: string;
  name: string;
  url: string;
  /** When the card scores */
  when?: "yours" | "any" | "opponent";
  /** Something to set up when the card is drawn */
  note?: Text;
  /** Free redraw allowed when drawn under a condition: the card goes back to the deck or to the discard */
  redraw?: { condition: Text; to: "deck" | "discard" };
  options: ScoreOption[];
};

const card = (id: string, name: string, rest: Omit<SecondaryCard, "id" | "name" | "url">): SecondaryCard => ({
  id,
  name,
  url: `https://gdmissions.app/11th/secondary-missions/${id}-defender`,
  ...rest,
});

const FIRST_ROUND: Text = { en: "First battle round", fr: "Premier round de bataille" };

export const SECONDARY_CARDS: SecondaryCard[] = [
  card("a-grievous-blow", "A Grievous Blow", {
    when: "any",
    redraw: { condition: { en: "No enemy unit of 13+ models", fr: "Aucune unité ennemie de 13+ figurines" }, to: "discard" },
    options: [{ vp: 5, label: { en: "Enemy unit of 13+ models destroyed", fr: "Unité ennemie de 13+ figurines détruite" } }],
  }),
  card("a-tempting-target", "A Tempting Target", {
    when: "yours",
    note: { en: "Your opponent picks an objective in No Man's Land", fr: "L'adversaire choisit un objectif du no man's land" },
    options: [{ vp: 5, label: { en: "You control the tempting target", fr: "Vous contrôlez la cible tentante" } }],
  }),
  card("assassination", "Assassination", {
    when: "any",
    options: [
      { vp: 5, label: { en: "Enemy character destroyed, or all of them", fr: "Personnage ennemi détruit, ou tous" } },
    ],
  }),
  card("beacon", "Beacon", {
    when: "opponent",
    note: { en: "Pick a friendly unit as your beacon", fr: "Choisissez une unité alliée comme balise" },
    options: [
      { vp: 3, label: { en: "Beacon out of your deployment zone", fr: "Balise hors de votre zone de déploiement" } },
      { vp: 5, label: { en: "Beacon out of your territory", fr: "Balise hors de votre territoire" } },
    ],
  }),
  card("behind-enemy-lines", "Behind Enemy Lines", {
    when: "yours",
    redraw: { condition: FIRST_ROUND, to: "deck" },
    options: [
      { per: 3, max: 5, label: { en: "Per unit in the enemy deployment zone", fr: "Par unité dans la zone de déploiement adverse" } },
    ],
  }),
  card("bring-it-down", "Bring it Down", {
    when: "any",
    redraw: { condition: { en: "No enemy model with 10+ wounds", fr: "Aucune figurine ennemie à 10+ PV" }, to: "discard" },
    options: [{ vp: 5, label: { en: "Enemy model with 10+ wounds destroyed", fr: "Figurine ennemie à 10+ PV détruite" } }],
  }),
  card("burden-of-trust", "Burden of Trust", {
    when: "opponent",
    note: { en: "Assign guards to objectives", fr: "Assignez des gardes aux objectifs" },
    options: [{ per: 2, max: 5, label: { en: "Per objective guarded", fr: "Par objectif gardé" } }],
  }),
  card("centre-ground", "Centre Ground", {
    when: "yours",
    options: [
      { vp: 3, label: { en: "Unit within 3\" of the centre, no enemy within 3\"", fr: "Unité à 3\" du centre, aucun ennemi à 3\"" } },
      { vp: 5, label: { en: "Unit within 3\" of the centre, no enemy within 6\"", fr: "Unité à 3\" du centre, aucun ennemi à 6\"" } },
    ],
  }),
  card("cleanse", "Cleanse", {
    when: "yours",
    redraw: { condition: { en: "Plunder is active", fr: "Plunder est active" }, to: "deck" },
    options: [
      { vp: 2, label: { en: "1 objective cleansed", fr: "1 objectif purifié" } },
      { vp: 5, label: { en: "2+ objectives cleansed", fr: "2+ objectifs purifiés" } },
    ],
  }),
  card("defend-stronghold", "Defend Stronghold", {
    when: "opponent",
    redraw: { condition: { en: "First battle round (required)", fr: "Premier round (obligatoire)" }, to: "deck" },
    options: [
      { vp: 3, label: { en: "You control your home objective", fr: "Vous contrôlez votre objectif de base" } },
      { vp: 5, label: { en: "…and no enemy in your deployment zone", fr: "…et aucun ennemi dans votre zone" } },
    ],
  }),
  card("display-of-might", "Display of Might", {
    options: [
      { vp: 2, label: { en: "More units than the enemy wholly in No Man's Land, your turn", fr: "Plus d'unités que l'ennemi entièrement au no man's land, votre tour" } },
      { vp: 5, label: { en: "More units than the enemy wholly in No Man's Land, enemy turn", fr: "Plus d'unités que l'ennemi entièrement au no man's land, tour adverse" } },
    ],
  }),
  card("engage-on-all-fronts", "Engage on All Fronts", {
    when: "yours",
    options: [
      { vp: 3, label: { en: "Presence in 3 table quarters", fr: "Présence dans 3 quarts de table" } },
      { vp: 5, label: { en: "Presence in 4 table quarters", fr: "Présence dans 4 quarts de table" } },
    ],
  }),
  card("forward-position", "Forward Position", {
    when: "yours",
    redraw: { condition: FIRST_ROUND, to: "deck" },
    options: [
      { vp: 5, label: { en: "You control the enemy home objective and/or each expansion objective", fr: "Vous contrôlez l'objectif de base adverse et/ou chaque objectif d'expansion" } },
    ],
  }),
  card("no-prisoners", "No Prisoners", {
    when: "any",
    options: [{ per: 2, max: 5, label: { en: "Per enemy unit destroyed", fr: "Par unité ennemie détruite" } }],
  }),
  card("outflank", "Outflank", {
    when: "yours",
    options: [
      { vp: 3, label: { en: "Unit by a board edge, out of your territory", fr: "Unité près d'un bord, hors de votre territoire" } },
      { vp: 5, label: { en: "Units by opposite board edges", fr: "Unités près de bords opposés" } },
    ],
  }),
  card("overwhelming-force", "Overwhelming Force", {
    when: "any",
    options: [
      { per: 3, max: 5, label: { en: "Per enemy unit destroyed that started the turn in range of an objective", fr: "Par unité ennemie détruite qui commençait le tour à portée d'un objectif" } },
    ],
  }),
  card("plunder", "Plunder", {
    when: "yours",
    redraw: { condition: { en: "Cleanse is active", fr: "Cleanse est active" }, to: "deck" },
    options: [{ vp: 5, label: { en: "A terrain area was plundered", fr: "Un décor a été pillé" } }],
  }),
  card("secure-no-man-s-land", "Secure No Man's Land", {
    when: "yours",
    options: [{ vp: 5, label: { en: "You control 2+ objectives in No Man's Land", fr: "Vous contrôlez 2+ objectifs du no man's land" } }],
  }),
];

export const SECONDARY_BY_ID = new Map(SECONDARY_CARDS.map((secondary) => [secondary.id, secondary]));
