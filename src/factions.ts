/*
 * Factions theme: each player's half takes the colors of their army, with a band along their edge
 * and a texture over their half. The patterns live in the CSS, drawn with the two colors below.
 */
import type { Text } from "./secondaries";

export type FactionGroup = "imperium" | "chaos" | "xenos";

export type Band = "hazard" | "trim" | "checks" | "dashes" | "beads" | "spines" | "fangs" | "stripes" | "rivets";

export type Texture =
  | "masonry"
  | "lattice"
  | "circuit"
  | "carapace"
  | "scrap"
  | "rays"
  | "gems"
  | "plates"
  | "embers"
  | "claws"
  | "halo"
  | "camo"
  | "streaks"
  | "bubbles"
  | "hexgrid";

export type Faction = {
  id: string;
  name: Text;
  group: FactionGroup;
  /** A Space Marine chapter: picked under "Space Marines" */
  chapter?: boolean;
  /** The player's color, and the color of their clock digits */
  color: string;
  time: string;
  /** Second color of the band and of some textures */
  accent: string;
  band: Band;
  texture: Texture;
};

const same = (name: string): Text => ({ en: name, fr: name });

export const SPACE_MARINES = "space-marines";
export const SPACE_MARINES_NAME = same("Space Marines");

const GOLD = "#d4af37";
const BLACK = "#0b0b0a";
const BONE = "#e9e4d8";

export const FACTIONS: Faction[] = [
  // Imperium
  { id: "adepta-sororitas", name: same("Adepta Sororitas"), group: "imperium", color: "#e0455f", time: "#ffe3e8", accent: GOLD, band: "beads", texture: "embers" },
  { id: "adeptus-custodes", name: same("Adeptus Custodes"), group: "imperium", color: "#e3b04b", time: "#fff1d1", accent: "#8c1c2b", band: "trim", texture: "lattice" },
  { id: "adeptus-mechanicus", name: same("Adeptus Mechanicus"), group: "imperium", color: "#e0603a", time: "#ffe4d9", accent: "#b8c0c8", band: "dashes", texture: "circuit" },
  { id: "astra-militarum", name: same("Astra Militarum"), group: "imperium", color: "#b5a46a", time: "#f3eedb", accent: BLACK, band: "hazard", texture: "camo" },
  { id: "grey-knights", name: same("Grey Knights"), group: "imperium", color: "#9fb8e0", time: "#eef3fb", accent: "#4c8dff", band: "trim", texture: "rays" },
  { id: "imperial-agents", name: { en: "Imperial Agents", fr: "Agents de l'Imperium" }, group: "imperium", color: "#c9a36a", time: "#f6ecdc", accent: "#8a1f1f", band: "trim", texture: "streaks" },
  { id: "imperial-knights", name: { en: "Imperial Knights", fr: "Chevaliers Impériaux" }, group: "imperium", color: "#4f86e0", time: "#e5eeff", accent: "#f0ece2", band: "checks", texture: "plates" },

  // Space Marines, by chapter
  { id: "black-templars", name: same("Black Templars"), group: "imperium", chapter: true, color: "#e9e1cf", time: "#ffffff", accent: "#e9e1cf", band: "checks", texture: "lattice" },
  { id: "blood-angels", name: same("Blood Angels"), group: "imperium", chapter: true, color: "#d4213b", time: "#ffe1e5", accent: GOLD, band: "trim", texture: "halo" },
  { id: "dark-angels", name: same("Dark Angels"), group: "imperium", chapter: true, color: "#3ea35f", time: "#dff3e5", accent: "#d9cfb4", band: "trim", texture: "lattice" },
  { id: "deathwatch", name: same("Deathwatch"), group: "imperium", chapter: true, color: "#c0c7d0", time: "#f0f3f6", accent: BLACK, band: "hazard", texture: "plates" },
  { id: "imperial-fists", name: same("Imperial Fists"), group: "imperium", chapter: true, color: "#f5c518", time: "#fff2c2", accent: BLACK, band: "hazard", texture: "masonry" },
  { id: "iron-hands", name: same("Iron Hands"), group: "imperium", chapter: true, color: "#b9c2cc", time: "#f0f3f6", accent: "#1b1d20", band: "rivets", texture: "plates" },
  { id: "raven-guard", name: same("Raven Guard"), group: "imperium", chapter: true, color: "#cdd5e3", time: "#f4f6fa", accent: "#eef1f5", band: "fangs", texture: "streaks" },
  { id: "salamanders", name: same("Salamanders"), group: "imperium", chapter: true, color: "#33b864", time: "#ddf6e6", accent: "#ff7a1a", band: "fangs", texture: "embers" },
  { id: "space-wolves", name: same("Space Wolves"), group: "imperium", chapter: true, color: "#86a9d6", time: "#e6eef8", accent: BONE, band: "fangs", texture: "claws" },
  { id: "ultramarines", name: same("Ultramarines"), group: "imperium", chapter: true, color: "#3d7cf0", time: "#e2ebff", accent: GOLD, band: "trim", texture: "lattice" },
  { id: "white-scars", name: same("White Scars"), group: "imperium", chapter: true, color: "#f2eee6", time: "#ffffff", accent: "#c8102e", band: "fangs", texture: "streaks" },
  { id: SPACE_MARINES, name: { en: "Other chapter", fr: "Autre chapitre" }, group: "imperium", chapter: true, color: "#7f9cc4", time: "#e6edf7", accent: GOLD, band: "trim", texture: "plates" },

  // Chaos
  { id: "chaos-daemons", name: { en: "Chaos Daemons", fr: "Démons du Chaos" }, group: "chaos", color: "#d14bd6", time: "#fbe3fc", accent: "#ffb347", band: "fangs", texture: "embers" },
  { id: "chaos-knights", name: { en: "Chaos Knights", fr: "Chevaliers du Chaos" }, group: "chaos", color: "#c47a3a", time: "#fae8d6", accent: "#3a0d10", band: "stripes", texture: "plates" },
  { id: "chaos-space-marines", name: { en: "Chaos Space Marines", fr: "Space Marines du Chaos" }, group: "chaos", color: "#e0313f", time: "#ffe0e2", accent: "#c8892c", band: "stripes", texture: "rays" },
  { id: "death-guard", name: same("Death Guard"), group: "chaos", color: "#a3a86b", time: "#eef0d8", accent: "#6b4f2a", band: "rivets", texture: "bubbles" },
  { id: "emperors-children", name: same("Emperor's Children"), group: "chaos", color: "#e85aa8", time: "#ffe2f1", accent: GOLD, band: "beads", texture: "lattice" },
  { id: "thousand-sons", name: same("Thousand Sons"), group: "chaos", color: "#2a9df4", time: "#e0f1ff", accent: GOLD, band: "beads", texture: "rays" },
  { id: "world-eaters", name: same("World Eaters"), group: "chaos", color: "#cf2f2a", time: "#ffe0dd", accent: "#c8892c", band: "fangs", texture: "claws" },

  // Xenos
  { id: "aeldari", name: same("Aeldari"), group: "xenos", color: "#1fc8d6", time: "#dff9fb", accent: "#efe6d2", band: "beads", texture: "gems" },
  { id: "drukhari", name: same("Drukhari"), group: "xenos", color: "#a46bff", time: "#efe5ff", accent: "#2fe0b0", band: "fangs", texture: "streaks" },
  { id: "genestealer-cults", name: { en: "Genestealer Cults", fr: "Cultes Genestealers" }, group: "xenos", color: "#d8a83a", time: "#fbf0d6", accent: "#8a4fd6", band: "stripes", texture: "carapace" },
  { id: "leagues-of-votann", name: { en: "Leagues of Votann", fr: "Ligues de Votann" }, group: "xenos", color: "#e08a2e", time: "#fdebd6", accent: "#2b3a4a", band: "rivets", texture: "plates" },
  { id: "necrons", name: { en: "Necrons", fr: "Nécrons" }, group: "xenos", color: "#2ee68a", time: "#dcffee", accent: "#2ee68a", band: "dashes", texture: "circuit" },
  { id: "orks", name: same("Orks"), group: "xenos", color: "#8cc63f", time: "#eef7d8", accent: BONE, band: "checks", texture: "scrap" },
  { id: "tau-empire", name: { en: "T'au Empire", fr: "Empire T'au" }, group: "xenos", color: "#e3a857", time: "#fbeedb", accent: "#3b5f7a", band: "dashes", texture: "hexgrid" },
  { id: "tyranids", name: { en: "Tyranids", fr: "Tyranides" }, group: "xenos", color: "#b45fe0", time: "#f1e5cf", accent: "#f1e5cf", band: "spines", texture: "carapace" },
];

export const FACTION_BY_ID = new Map(FACTIONS.map((faction) => [faction.id, faction]));
