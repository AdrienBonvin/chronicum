/*
 * Two phones change the same game. Each keeps the state it last agreed on with the server; when
 * both changed it meanwhile, the local changes are replayed on top of the remote state, field by
 * field. Arrays and a few groups (the clocks, a player's cards) move as one block, so a merge
 * never mixes two halves of them.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Change = { path: string[]; value: Json | undefined };

/** Kept whole: the clocks only make sense together, and so do a player's piles of cards */
const ATOMIC = [["clock"], ["secondaries", "*"]];

const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAtomic = (path: string[]): boolean =>
  ATOMIC.some((pattern) => pattern.length === path.length && pattern.every((part, i) => part === "*" || part === path[i]));

function changes(base: Json | undefined, next: Json | undefined, path: string[] = [], out: Change[] = []): Change[] {
  if (isObject(base) && isObject(next) && !isAtomic(path)) {
    for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) changes(base[key], next[key], [...path, key], out);
  } else if (JSON.stringify(base) !== JSON.stringify(next)) {
    out.push({ path, value: next });
  }
  return out;
}

function apply(target: Json, { path, value }: Change): Json {
  if (path.length === 0) return value ?? null;
  const root = isObject(target) ? target : {};
  let node = root;
  for (const key of path.slice(0, -1)) {
    if (!isObject(node[key])) node[key] = {};
    node = node[key] as { [key: string]: Json };
  }
  const last = path[path.length - 1];
  if (value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

/** `remote` with what changed from `base` to `local` replayed on it (JSON strings in and out) */
export function merge(remote: string, base: string, local: string): string {
  if (local === base) return remote;
  if (remote === base) return local;
  let result = JSON.parse(remote) as Json;
  for (const change of changes(JSON.parse(base) as Json, JSON.parse(local) as Json)) result = apply(result, change);
  return JSON.stringify(result);
}
