#!/usr/bin/env node
/*
 * Games Workshop IP guard. Chronicum is an unofficial fan tool: it keeps names and point values,
 * short labels in our own words, and links to gdmissions.app for the full text. This script fails
 * as soon as something official slips in. It runs before every build (npm prebuild) and after
 * every file Claude writes (.claude/settings.json). The rules behind it are in CLAUDE.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Longest label a mission card may carry: past that, it starts to read like the card itself */
const MAX_LABEL_WORDS = 30;
const MISSION_DATA = ["src/secondaries.ts", "src/primaries.ts", "src/actions.ts"];

/** Shipped files scanned for official names, links and claims */
const SHIPPED = ["index.html", "vite.config.ts"];
const SHIPPED_DIRS = ["src"];

/** No GW resource is loaded or linked by the app: images, PDFs, fonts, pages */
const GW_HOSTS = /\b(?:[\w-]+\.)*(?:warhammer-community\.com|games-workshop\.com|warhammer\.com|warhammerworld\.[\w.]+)\b/i;
/** The words a disclaimer line uses: the only place where Games Workshop may be named */
const DISCLAIMER = /affiliated|affiliée|affilié|sans lien|non officiel|unofficial|trademark|marque de/i;

/**
 * Every file under public/ is our own work or royalty-free. A new one is added here only once
 * Adrien has checked where it comes from: no GW art, logo, icon, font or photo of their models
 */
const OWN_ASSETS = new Set([
  "apple-touch-icon.png",
  "favicon.svg",
  "icon.svg",
  "pwa-192.png",
  "pwa-512.png",
  "music/calm.mp3",
  "music/epic.mp3",
  "music/tense.m4a",
  "sounds/vs-hit.mp3",
  "sounds/war-horn.mp3",
]);

const problems = [];
const read = (path) => readFileSync(join(ROOT, path), "utf8");

function walk(dir) {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// 1. Mission cards: short labels only, never the card text
for (const file of MISSION_DATA) {
  const source = read(file);
  for (const match of source.matchAll(/\b(?:en|fr):\s*"((?:[^"\\]|\\.)*)"/g)) {
    const words = match[1].trim().split(/\s+/).length;
    if (words > MAX_LABEL_WORDS) {
      const line = source.slice(0, match.index).split("\n").length;
      problems.push(`${file}:${line} label of ${words} words (max ${MAX_LABEL_WORDS}): shorten it in our own words, the full text stays on gdmissions.app`);
    }
  }
}

// 2. Shipped files: no GW link, no GW name outside a disclaimer, no copyright line, no "official"
const shipped = [...SHIPPED, ...SHIPPED_DIRS.flatMap(walk).filter((path) => /\.(ts|css|html)$/.test(path))];
for (const file of shipped) {
  read(file)
    .split("\n")
    .forEach((text, i) => {
      const at = `${file}:${i + 1}`;
      if (GW_HOSTS.test(text)) problems.push(`${at} link to a Games Workshop site: the app loads and links nothing of theirs (use gdmissions.app)`);
      if (/games\s*workshop/i.test(text) && !DISCLAIMER.test(text)) problems.push(`${at} "Games Workshop" outside a disclaimer line`);
      if (/©|\(c\)\s*games|copyright/i.test(text)) problems.push(`${at} copyright line: none belongs in the app`);
      if (/(?<!un)official\b/i.test(text) || /(?<!non )officiel/i.test(text)) problems.push(`${at} "official": the app never claims or suggests it`);
    });
}

// 3. The app's name: never Warhammer, 40K or 40,000
const title = read("index.html").match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const vite = read("vite.config.ts");
const names = [title, vite.match(/\bname:\s*"([^"]*)"/)?.[1] ?? "", vite.match(/short_name:\s*"([^"]*)"/)?.[1] ?? ""];
for (const name of names) {
  if (/warhammer|40\s*k|40,?000/i.test(name)) problems.push(`app name "${name}": no Warhammer, 40K or 40,000 in the name, title or manifest`);
}

// 4. The disclaimer stays where people first see the app
for (const [file, text] of [["index.html", read("index.html")], ["vite.config.ts", vite], ["src/i18n.ts", read("src/i18n.ts")]]) {
  if (!/not affiliated with Games Workshop/i.test(text)) problems.push(`${file} lost its "not affiliated with Games Workshop" disclaimer`);
}

// 5. Every asset is ours
for (const path of walk("public").map((path) => relative("public", path))) {
  if (!OWN_ASSETS.has(path) && !path.endsWith(".DS_Store")) {
    problems.push(`public/${path} is not in OWN_ASSETS (scripts/ip-guard.mjs): add it only once its origin is checked, never GW art, logos, icons or fonts`);
  }
}

if (problems.length > 0) {
  console.error(`Games Workshop IP guard: ${problems.length} problem(s). Rules in CLAUDE.md.\n- ${problems.join("\n- ")}`);
  process.exit(2);
}
