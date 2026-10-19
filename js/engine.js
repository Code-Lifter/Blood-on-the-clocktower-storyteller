// ===== engine.js =====
// The bookkeeping: who is evil, who sits next to whom, which steps happen
// tonight, and the "by the book" answers. No DOM code in here.

import { S, log, blankDay, playerById } from "./state.js";
import { getRole, roleName, nightOrderFor, GOOD_TEAMS, EVIL_TEAMS } from "./data.js";
import { promptFor, SPECIAL_STEPS } from "./plain-english.js";

/** Characters that believe they are something else, and what they can think they are. */
export const THINKS = {
  drunk: "townsfolk",      // thinks they're a Townsfolk
  marionette: "good",      // thinks they're a good character
  lunatic: "demon",        // thinks they're the Demon
};

// ------------------------------------------------------------------ players

export const teamOf = (p, script) => getRole(p?.character, script)?.team || "";

export function alignmentOf(p, script) {
  if (p.alignment) return p.alignment;
  const team = teamOf(p, script);
  if (EVIL_TEAMS.has(team)) return "evil";
  if (GOOD_TEAMS.has(team)) return "good";
  return team === "traveller" ? "good" : "";
}

export const isEvil = (p, script) => alignmentOf(p, script) === "evil";
export const alive = () => S.players.filter((p) => p.alive);
export const nonTravellers = (script) => S.players.filter((p) => teamOf(p, script) !== "traveller");
export const votesNeeded = () => Math.ceil(alive().length / 2);
export const hasToken = (p, label) => p.tokens.some((t) => t.label.toLowerCase() === label.toLowerCase());

/** Poisoned, drunk, or believes they're someone else. */
export function impairment(p, script) {
  const out = [];
  if (hasToken(p, "Poisoned")) out.push("poisoned");
  if (hasToken(p, "Drunk")) out.push("drunk");
  if (p.thinks) out.push(`really the ${roleName(p.character, script)}`);
  return out;
}

/** The living players next to seat i (skips the dead), as [left, right]. */
export function livingNeighbours(p) {
  const n = S.players.length;
  const i = S.players.indexOf(p);
  const find = (dir) => {
    for (let k = 1; k < n; k++) {
      const q = S.players[(i + dir * k + n) % n];
      if (q !== p && q.alive) return q;
    }
    return null;
  };
  const l = find(-1), r = find(1);
  return l === r ? [l].filter(Boolean) : [l, r].filter(Boolean);
}

// ------------------------------------------------------------------ the night list

/** Map of character id -> players who wake as it (real character, or what they think they are). */
export function wakersById(script, order) {
  const map = new Map();
  const add = (id, p, via) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push({ player: p, via });
  };
  const orderSet = new Set(order);
  S.players.forEach((p) => {
    // A Lunatic has their own step; a Drunk doesn't, so the Drunk wakes as their fake Townsfolk.
    if (p.thinks && !orderSet.has(p.character)) add(p.thinks, p, p.character);
    else add(p.character, p, null);
  });
  return map;
}

/**
 * Builds tonight's steps.
 * Each step: { key, id, special, name, prompt, wakers:[{player, via}], dim, reason }
 */
export function buildNight(script) {
  const type = S.night <= 1 ? "first" : "other";
  const order = nightOrderFor(script, type === "first" ? "firstNight" : "otherNight");
  const wakers = wakersById(script, order);
  const steps = [];

  order.forEach((id) => {
    const special = SPECIAL_STEPS[id];
    if (special) {
      steps.push(makeStep(id, true, special.name, special, [], script));
      return;
    }
    if (!wakers.has(id)) return;
    const role = getRole(id, script);
    const prompt = promptFor(id, type) || genericPrompt(role, type);
    steps.push(makeStep(id, false, role?.name || id, prompt, wakers.get(id), script));
  });
  return steps;
}

function genericPrompt(role, type) {
  const reminder = type === "first" ? role?.firstNightReminder : role?.otherNightReminder;
  return {
    say: `You are the ${role?.name || "?"}. ${role?.ability || ""}`.trim(),
    st: reminder ? cleanReminder(reminder) : "",
    generic: true,
  };
}

/** Turns "Point to the *KNOW* player. :reminder:" into plain text. */
export const cleanReminder = (t) => String(t || "").replace(/:reminder:/g, "(reminder)").replace(/\*([^*]+)\*/g, "“$1”").trim();

function makeStep(id, special, name, prompt, wakers, script) {
  const key = `n${S.night}:${id}`;
  const step = { key, id, special, name, prompt, wakers, dim: false, reason: "" };

  if (prompt.when) {
    const ok = checkWhen(prompt.when, wakers, script);
    if (!ok.pass) { step.dim = true; step.reason = ok.reason; }
  }
  if (!special && !step.dim && wakers.length && wakers.every((w) => !w.player.alive)) {
    const wakesWhenDead = ["diedTonight", "diedRecently"].includes(prompt.when);
    if (!wakesWhenDead) { step.dim = true; step.reason = "Dead, so they don't wake"; }
  }
  return step;
}

export function checkWhen(when, wakers, script) {
  const ids = wakers.map((w) => w.player.id);
  const last = S.lastDay || blankDay();
  switch (when) {
    case "sevenPlus": {
      const n = nonTravellers(script).length;
      return { pass: n >= 7, reason: "Fewer than 7 players, so skip this" };
    }
    case "diedTonight":
      return { pass: ids.some((id) => S.diedTonight.includes(id)), reason: "Only if they died tonight" };
    case "diedRecently":
      return { pass: ids.some((id) => S.diedTonight.includes(id) || last.died.includes(id)), reason: "Only if they died today or tonight" };
    case "executedToday":
      return { pass: !!last.executed, reason: "Nobody was executed today" };
    case "demonDied":
      return { pass: !!last.demonDied, reason: "Only if the Demon died today" };
    case "noDeathToday":
      return { pass: last.died.length === 0, reason: "Someone died today, so they don't kill" };
    case "outsiderDiedToday":
      return {
        pass: last.died.some((id) => teamOf(playerById(id), script) === "outsider"),
        reason: "Only if an Outsider died today",
      };
    default:
      return { pass: true, reason: "" };
  }
}

// ------------------------------------------------------------------ evil team

export function evilTeam(script) {
  const demons = [], minions = [];
  S.players.forEach((p) => {
    const team = teamOf(p, script);
    if (team === "demon") demons.push(p);
    else if (team === "minion") minions.push(p);
  });
  return { demons, minions };
}

// ------------------------------------------------------------------ "by the book" helpers
// Each returns a short sentence, or "" if it has nothing to say.
// They never decide anything for you: they're there so you don't have to count.

const registersNote = (script) => {
  const tricky = S.players.filter((p) => ["recluse", "spy"].includes(p.character));
  return tricky.length ? ` (${tricky.map((p) => roleName(p.character, script)).join(" & ")} may register differently.)` : "";
};

const nameWithChar = (p, script) => `${p.name} (${roleName(p.character, script)})`;

export const HINTS = {
  "inPlay:townsfolk": (c) => listTeam(c, "townsfolk"),
  "inPlay:outsider": (c) => listTeam(c, "outsider") || "No Outsiders in play.",
  "inPlay:minion": (c) => listTeam(c, "minion"),
  "inPlay:good": (c) => {
    const list = S.players.filter((p) => !c.actorIds.includes(p.id) && alignmentOf(p, c.script) === "good");
    return list.length ? "Good players: " + list.map((p) => nameWithChar(p, c.script)).join(", ") : "";
  },
  chef: (c) => {
    const n = S.players.length;
    let pairs = 0;
    for (let i = 0; i < n; i++) {
      if (isEvil(S.players[i], c.script) && isEvil(S.players[(i + 1) % n], c.script)) pairs++;
    }
    return `By the book: ${pairs}.` + registersNote(c.script);
  },
  empath: (c) => c.actors.map((p) => {
    const nb = livingNeighbours(p);
    const evil = nb.filter((q) => isEvil(q, c.script)).length;
    return `${p.name}: ${evil} (neighbours ${nb.map((q) => q.name).join(" & ")})`;
  }).join(". ") + "." + registersNote(c.script),
  clockmaker: (c) => {
    const { demons, minions } = evilTeam(c.script);
    if (!demons.length || !minions.length) return "";
    const n = S.players.length;
    let best = Infinity;
    demons.forEach((d) => minions.forEach((m) => {
      const a = S.players.indexOf(d), b = S.players.indexOf(m);
      const dist = Math.min((a - b + n) % n, (b - a + n) % n);
      best = Math.min(best, dist);
    }));
    return `By the book: ${best}.`;
  },
  oracle: (c) => {
    const dead = S.players.filter((p) => !p.alive);
    return `By the book: ${dead.filter((p) => isEvil(p, c.script)).length} of ${dead.length} dead players are evil.` + registersNote(c.script);
  },
  executed: (c) => {
    const p = playerById(S.lastDay?.executed);
    return p ? `Executed today: ${nameWithChar(p, c.script)}.` : "";
  },
  fortuneteller: (c) => {
    const chosen = (c.choice?.players || []).map(playerById).filter(Boolean);
    if (chosen.length < 2) return "Once they've pointed, record both players and I'll check.";
    const hit = chosen.filter((p) => teamOf(p, c.script) === "demon" || hasToken(p, "Red Herring"));
    const herring = S.players.find((p) => hasToken(p, "Red Herring"));
    return (hit.length ? `By the book: YES (${hit.map((p) => p.name).join(", ")}).` : "By the book: NO.") +
      (herring ? ` Red Herring: ${herring.name}.` : " No Red Herring marked yet — add one on a good player's sheet.") +
      registersNote(c.script);
  },
  targetCharacter: (c) => {
    const p = playerById(c.choice?.players?.[0]);
    return p ? `${p.name} is the ${roleName(p.character, c.script)}.` : "";
  },
  isDemon: (c) => {
    const p = playerById(c.choice?.players?.[0]);
    if (!p) return "";
    return teamOf(p, c.script) === "demon" ? `${p.name} IS the Demon.` : `${p.name} is not the Demon.`;
  },
  demonPlayer: (c) => {
    const { demons } = evilTeam(c.script);
    return demons.length ? `The Demon is ${demons.map((p) => p.name).join(", ")}.` : "";
  },
  sameTeam: (c) => {
    const [a, b] = (c.choice?.players || []).map(playerById);
    if (!a || !b) return "";
    return alignmentOf(a, c.script) === alignmentOf(b, c.script) ? "By the book: YES, same team." : "By the book: NO, different teams.";
  },
  gamble: (c) => {
    const p = playerById(c.choice?.players?.[0]);
    if (!p || !c.choice?.guess) return "";
    return p.character === c.choice.guess ? "They guessed right." : `Wrong: ${p.name} is the ${roleName(p.character, c.script)}. The Gambler dies.`;
  },
};

function listTeam(c, team) {
  const list = S.players.filter((p) => !c.actorIds.includes(p.id) && teamOf(p, c.script) === team);
  return list.length ? "In play: " + list.map((p) => nameWithChar(p, c.script)).join(", ") : "";
}

export function hintFor(step, script) {
  const name = step.prompt?.hint;
  if (!name || !HINTS[name]) return "";
  const actors = step.wakers.map((w) => w.player);
  try {
    return HINTS[name]({ script, step, actors, actorIds: actors.map((p) => p.id), choice: S.choices[step.key] });
  } catch (e) {
    console.warn(e);
    return "";
  }
}

/** What this character chose the last time they woke (for "different to last night"). */
export function lastChoiceFor(id) {
  for (let n = S.night - 1; n >= 1; n--) {
    const c = S.choices[`n${n}:${id}`];
    if (c?.players?.length) return { night: n, players: c.players };
  }
  return null;
}

// ------------------------------------------------------------------ phase changes

/** Dusk: tidy up yesterday and begin a night. */
export function startNight() {
  S.lastDay = S.today;
  S.today = blankDay();
  S.night += 1;
  S.phase = "night";
  S.diedTonight = [];
  clearTokens("dusk");
  log("Night falls.");
}

/** Dawn: tidy up the night and begin a day. Returns who died overnight. */
export function startDay() {
  clearTokens("dawn");
  S.day = S.night;
  S.phase = "day";
  S.today = blankDay();
  const died = S.diedTonight.map(playerById).filter(Boolean);
  log(died.length ? `Dawn. Died in the night: ${died.map((p) => p.name).join(", ")}.` : "Dawn. Nobody died in the night.");
  return died;
}

function clearTokens(when) {
  S.players.forEach((p) => { p.tokens = p.tokens.filter((t) => t.clears !== when); });
}

export function kill(p, script, cause = "") {
  if (!p || !p.alive) return;
  p.alive = false;
  if (S.phase === "night") S.diedTonight.push(p.id);
  else S.today.died.push(p.id);
  if (teamOf(p, script) === "demon") S.today.demonDied = true;
  log(`${p.name} (${roleName(p.character, script)}) died${cause ? " — " + cause : ""}.`);
}

export function revive(p, script) {
  if (!p || p.alive) return;
  p.alive = true;
  S.diedTonight = S.diedTonight.filter((id) => id !== p.id);
  S.today.died = S.today.died.filter((id) => id !== p.id);
  log(`${p.name} (${roleName(p.character, script)}) is alive again.`);
}

export function execute(p, script) {
  if (!p) return;
  S.today.executed = p.id;
  if (p.alive) kill(p, script, "executed");
  else log(`${p.name} was executed (already dead).`);
}

/** Puts a reminder on a player, replacing the same reminder from the same character. */
export function placeToken(targets, label, from, clears) {
  S.players.forEach((p) => { p.tokens = p.tokens.filter((t) => !(t.label === label && t.from === from)); });
  targets.forEach((p) => p.tokens.push({ label, from, clears: clears || "" }));
}

/** Simple end-of-game warnings. Never decides the game; just flags it. */
export function gameWarnings(script) {
  const out = [];
  const living = alive();
  const livingDemons = living.filter((p) => teamOf(p, script) === "demon");
  const anyDemon = S.players.some((p) => teamOf(p, script) === "demon");
  if (anyDemon && !livingDemons.length) out.push("No Demon is alive. Good wins — unless something like the Scarlet Woman takes over.");
  if (livingDemons.length && living.length <= 2) out.push("Only 2 players are alive with a Demon among them. Evil wins.");
  return out;
}
