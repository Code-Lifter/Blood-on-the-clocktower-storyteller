// ===== data.js =====
// Loads the official data files and turns scripts (built-in or pasted) into
// one consistent shape the rest of the app can use.

import { dataUrl, iconUrl, genericIconUrl } from "./config.js";

export const TEAMS = ["townsfolk", "outsider", "minion", "demon", "traveller", "fabled", "loric"];
export const TEAM_LABEL = {
  townsfolk: "Townsfolk", outsider: "Outsiders", minion: "Minions", demon: "Demons",
  traveller: "Travellers", fabled: "Fabled", loric: "Loric",
};
export const GOOD_TEAMS = new Set(["townsfolk", "outsider"]);
export const EVIL_TEAMS = new Set(["minion", "demon"]);

export const BUILTIN_SCRIPTS = [
  { key: "tb", name: "Trouble Brewing", edition: "tb" },
  { key: "bmr", name: "Bad Moon Rising", edition: "bmr" },
  { key: "snv", name: "Sects & Violets", edition: "snv" },
];

/** Everything loaded from the official files. */
export const DB = {
  roles: new Map(),       // id -> role object
  firstNight: [],         // ordered ids, includes dusk/minioninfo/demoninfo/dawn
  otherNight: [],
  jinxes: new Map(),      // id -> [{id, reason}]
};

/** Character ids are lower-case letters/numbers only ("Fortune Teller" -> "fortuneteller"). */
export const normaliseId = (raw) => String(raw ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status})`);
  return res.json();
}

export async function loadDatabase() {
  const [roles, night, jinxes] = await Promise.all([
    fetchJSON(dataUrl("roles")),
    fetchJSON(dataUrl("nightsheet")),
    fetchJSON(dataUrl("jinxes")).catch(() => []), // jinxes are nice-to-have
  ]);
  DB.roles.clear();
  roles.forEach((r) => DB.roles.set(r.id, r));
  DB.firstNight = night.firstNight || [];
  DB.otherNight = night.otherNight || [];
  DB.jinxes.clear();
  (jinxes || []).forEach((j) => DB.jinxes.set(j.id, j.jinx || []));
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------
// A script, once loaded, always looks like this:
// {
//   key, name, author, edition (for the logo, if any),
//   characters: [ids in script order],
//   homebrew: { id: roleObject }   // characters not in roles.json
//   firstNight / otherNight: [ids] // only if the script provides its own order
//   warnings: [strings]
// }

export function builtinScript(key) {
  const def = BUILTIN_SCRIPTS.find((s) => s.key === key);
  if (!def) return null;
  const characters = [...DB.roles.values()]
    .filter((r) => r.edition === def.edition && ["townsfolk", "outsider", "minion", "demon", "traveller"].includes(r.team))
    .map((r) => r.id);
  return { key: def.key, name: def.name, author: "The Pandemonium Institute", edition: def.edition, characters, homebrew: {}, warnings: [], builtin: true };
}

/**
 * Turns pasted / dropped JSON text into a script.
 * Accepts the official script format: an array of ids and/or objects,
 * with an optional {"id":"_meta", ...} entry. Also accepts {characters:[...]}.
 */
export function parseScript(text, fallbackName = "Custom script") {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error("That isn't valid JSON. Check for a missing comma or bracket.");
  }
  if (!Array.isArray(raw)) {
    if (raw && Array.isArray(raw.characters)) raw = raw.characters;
    else if (raw && Array.isArray(raw.roles)) raw = raw.roles;
    else throw new Error("A script should be a list: [ {\"id\":\"_meta\"...}, \"washerwoman\", ... ]");
  }

  const script = { key: "", name: fallbackName, author: "", edition: "", characters: [], homebrew: {}, warnings: [] };

  raw.forEach((entry) => {
    if (entry == null) return;
    if (typeof entry === "string") {
      addId(script, entry);
      return;
    }
    if (typeof entry !== "object") return;
    if (entry.id === "_meta") {
      script.name = entry.name || script.name;
      script.author = entry.author || "";
      if (entry.logo) script.logo = entry.logo;
      if (Array.isArray(entry.firstNight)) script.firstNight = entry.firstNight.map(normaliseId);
      if (Array.isArray(entry.otherNight)) script.otherNight = entry.otherNight.map(normaliseId);
      if (Array.isArray(entry.bootlegger)) script.bootlegger = entry.bootlegger;
      return;
    }
    // Object entry: either {id} pointing at an official character, or a full homebrew character
    const id = normaliseId(entry.id);
    if (!id) return;
    const isFull = entry.name && entry.team;
    if (DB.roles.has(id) && !isFull) {
      addId(script, id);
    } else if (isFull) {
      script.homebrew[id] = { ...entry, id, team: String(entry.team).toLowerCase(), edition: entry.edition || "custom", homebrew: true };
      if (!script.characters.includes(id)) script.characters.push(id);
    } else {
      script.warnings.push(`Unknown character "${entry.id}" was skipped.`);
    }
  });

  if (!script.characters.length) throw new Error("No characters were found in that script.");
  script.key = "custom-" + normaliseId(script.name).slice(0, 40) + "-" + Date.now().toString(36);
  return script;
}

function addId(script, rawId) {
  const id = normaliseId(rawId);
  if (DB.roles.has(id)) {
    if (!script.characters.includes(id)) script.characters.push(id);
  } else {
    script.warnings.push(`Unknown character "${rawId}" was skipped.`);
  }
}

// ---------------------------------------------------------------------------
// Character helpers (work for official and homebrew characters)
// ---------------------------------------------------------------------------

/** Look up a character: script homebrew first, then the official list. */
export function getRole(id, script) {
  if (!id) return null;
  return (script && script.homebrew && script.homebrew[id]) || DB.roles.get(id) || null;
}

export function roleName(id, script) {
  return getRole(id, script)?.name || id || "—";
}

/** Default side of a team: "g", "e" or "" (unaligned). */
export function defaultSide(team) {
  if (GOOD_TEAMS.has(team)) return "g";
  if (EVIL_TEAMS.has(team)) return "e";
  return "";
}

/** Icon URL for a character, optionally drawn as a given alignment. */
export function roleIcon(id, script, alignment) {
  const role = getRole(id, script);
  if (!role) return genericIconUrl("custom", "");
  // Homebrew characters may carry their own image(s)
  if (role.image) {
    const imgs = Array.isArray(role.image) ? role.image : [role.image];
    if (alignment === "evil" && imgs[2]) return imgs[2];
    if (alignment === "good" && imgs[1]) return imgs[1];
    return imgs[0];
  }
  if (role.homebrew) return genericIconUrl(role.team, defaultSide(role.team));
  let side = defaultSide(role.team);
  if (alignment === "good") side = "g";
  if (alignment === "evil") side = "e";
  if (role.team === "fabled" || role.team === "loric") side = "";
  if (role.team === "traveller" && !alignment) side = "";
  return iconUrl(role.edition, role.id, side);
}

/** The text in [square brackets] in an ability, e.g. "+2 Outsiders". */
export function setupNote(role) {
  const m = role?.ability?.match(/\[(.+?)\]/);
  return m ? m[1] : "";
}

/** Jinxes that apply between characters on this script. */
export function jinxesFor(ids) {
  const set = new Set(ids);
  const out = [];
  ids.forEach((a) => {
    (DB.jinxes.get(a) || []).forEach((j) => {
      if (set.has(j.id)) out.push({ a, b: j.id, reason: j.reason });
    });
  });
  return out;
}

/** Night order for a script: the script's own order if given, else the official one. */
export function nightOrderFor(script, which /* "firstNight" | "otherNight" */) {
  if (script[which]?.length) return script[which];
  const order = [...DB[which]];
  // Homebrew characters with a night number go just before dawn, sorted by their number
  const extras = Object.values(script.homebrew || {})
    .filter((r) => Number(r[which]) > 0)
    .sort((x, y) => Number(x[which]) - Number(y[which]))
    .map((r) => r.id);
  if (extras.length) {
    const dawn = order.indexOf("dawn");
    order.splice(dawn < 0 ? order.length : dawn, 0, ...extras);
  }
  return order;
}

/** Standard character counts by player count (Travellers don't count). */
export const COUNTS = {
  5: [3, 0, 1, 1], 6: [3, 1, 1, 1], 7: [5, 0, 1, 1], 8: [5, 1, 1, 1], 9: [5, 2, 1, 1],
  10: [7, 0, 2, 1], 11: [7, 1, 2, 1], 12: [7, 2, 2, 1], 13: [9, 0, 3, 1], 14: [9, 1, 3, 1], 15: [9, 2, 3, 1],
};
export function countsFor(n) {
  const c = COUNTS[Math.min(Math.max(n, 5), 15)];
  return n < 5 ? null : { townsfolk: c[0], outsider: c[1], minion: c[2], demon: c[3] };
}
