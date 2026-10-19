// ===== state.js =====
// The whole game lives in one object, saved to the browser after every change
// so a refresh or a locked phone never loses your game.

import { CONFIG } from "./config.js";

const GAME_KEY = CONFIG.storageKey;
const SCRIPTS_KEY = CONFIG.storageKey + "-scripts";

export function freshGame(scriptKey = "tb", players = []) {
  return {
    scriptKey,
    phase: "setup",        // "setup" | "night" | "day"
    night: 0,              // 1 = first night
    day: 0,
    players: players.map((p) => freshPlayer(p.name, p.id)),
    bag: [],               // character ids chosen for this game
    bluffs: ["", "", ""],
    done: {},              // step key -> true
    choices: {},           // step key -> { players, guess, answer, point, used }
    diedTonight: [],       // player ids
    today: blankDay(),     // what happened during the current / most recent day
    lastDay: blankDay(),   // the day before the current night
    log: [],               // { when, text }
  };
}

export function blankDay() {
  return { died: [], executed: null, demonDied: false, nominations: [] };
}

let nextId = 1;
export function freshPlayer(name, id) {
  return {
    id: id || "p" + Date.now().toString(36) + (nextId++),
    name,
    character: "",
    thinks: "",           // what a Drunk / Marionette / Lunatic believes they are
    alignment: "",        // "" = from their character's team
    alive: true,
    ghostVote: true,
    tokens: [],           // { label, from, clears }
    note: "",
  };
}

export let S = freshGame();
export let customScripts = []; // scripts added by paste/drop, kept between games

export function setState(next) { S = next; }

export function save() {
  try { localStorage.setItem(GAME_KEY, JSON.stringify(S)); } catch { /* storage may be blocked */ }
}

export function saveScripts() {
  try { localStorage.setItem(SCRIPTS_KEY, JSON.stringify(customScripts)); } catch { }
}

export function load() {
  try {
    const g = JSON.parse(localStorage.getItem(GAME_KEY) || "null");
    if (g && Array.isArray(g.players)) S = { ...freshGame(), ...g };
  } catch { }
  try {
    const s = JSON.parse(localStorage.getItem(SCRIPTS_KEY) || "[]");
    if (Array.isArray(s)) customScripts = s;
  } catch { }
}

export function addCustomScript(script) {
  customScripts.push(script);
  saveScripts();
}

export function removeCustomScript(key) {
  customScripts = customScripts.filter((s) => s.key !== key);
  saveScripts();
}

export function log(text) {
  const when = S.phase === "night" ? `Night ${S.night}` : S.phase === "day" ? `Day ${S.day}` : "Setup";
  S.log.push({ when, text });
}

export const playerById = (id) => S.players.find((p) => p.id === id);
