// ===== app.js =====
// Wires everything together: setup, the grimoire, the night list, the step
// card, the day, and the table view.

import { CONFIG, editionLogoUrl } from "./config.js";
import {
  DB, loadDatabase, BUILTIN_SCRIPTS, builtinScript, parseScript, getRole, roleName,
  setupNote, jinxesFor, countsFor, TEAM_LABEL, GOOD_TEAMS,
} from "./data.js";
import {
  S, setState, freshGame, freshPlayer, save, load, log, playerById,
  customScripts, addCustomScript, removeCustomScript,
} from "./state.js";
import {
  THINKS, teamOf, alignmentOf, alive, nonTravellers, votesNeeded, impairment, livingNeighbours,
  buildNight, cleanReminder, hintFor, lastChoiceFor, startNight, startDay, kill, revive, execute,
  placeToken, gameWarnings, evilTeam,
} from "./engine.js";
import { SPECIAL_STEPS } from "./plain-english.js";
import {
  qs, qsa, esc, iconHtml, showModal, openPicker, initPicker, closePicker, pickerIsOpen,
  characterItems, cap, shuffle,
} from "./ui.js";

let SCRIPT = null;     // the script being played
let CARD = null;       // { key, playerView }
let SHEET = null;      // player id whose sheet is open
let TABLE = null;      // "town" | "sheet" | "grimoire"
let HIDE = false;      // grimoire shows names only (a viewing preference, not part of undo)

const HIDE_KEY = CONFIG.storageKey + "-hide";

const PLAY_TEAMS = ["townsfolk", "outsider", "minion", "demon", "traveller"];

// =========================================================================== boot

async function init() {
  qs("#cccLogo").src = CONFIG.cccLogo;
  load();
  try { HIDE = localStorage.getItem(HIDE_KEY) === "1"; } catch { }
  initPicker();
  bindEvents();
  try {
    await loadDatabase();
  } catch (e) {
    console.error(e);
    qs("#loadError").hidden = false;
    qs("#loadError").innerHTML = `<h2>Couldn't load the character data</h2>
      <p>${esc(e.message)}</p>
      <p class="muted">Check your internet connection, or the links in <code>js/config.js</code>.
      If you're opening the file straight from your computer, run it from a local server or GitHub Pages instead.</p>`;
    qs("#scriptTitle").textContent = "";
    return;
  }
  selectScript(S.scriptKey, false);
  render();
}

function currentScriptFor(key) {
  return builtinScript(key) || customScripts.find((s) => s.key === key) || builtinScript("tb");
}

function selectScript(key, resetBag = true) {
  SCRIPT = currentScriptFor(key);
  S.scriptKey = SCRIPT.key;
  if (resetBag) {
    S.bag = [];
    S.bluffs = ["", "", ""];
    S.players.forEach((p) => { p.character = ""; p.thinks = ""; p.alignment = ""; });
  }
}

/** Every character on the script, grouped and ordered by team. */
function scriptIdsByTeam() {
  const out = {};
  PLAY_TEAMS.forEach((t) => (out[t] = []));
  SCRIPT.characters.forEach((id) => {
    const r = getRole(id, SCRIPT);
    if (r && out[r.team]) out[r.team].push(id);
  });
  return out;
}

// =========================================================================== undo / redo
// Every change goes through commit(). It compares the game with the last saved
// copy; if anything changed, the old copy goes on the undo stack. So undo works
// for everything without each feature having to remember to record itself.

const HISTORY_MAX = 300;
let undoStack = [];
let redoStack = [];
let lastJson = null;

function snapshot() {
  // Opening a card can leave an empty record behind; that isn't a real change.
  Object.keys(S.choices).forEach((k) => {
    const c = S.choices[k];
    if (c && typeof c === "object" && !Object.keys(c).length) delete S.choices[k];
  });
  return JSON.stringify(S);
}

function commit() {
  const json = snapshot();
  if (lastJson !== null && json !== lastJson) {
    undoStack.push(lastJson);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack = [];
  }
  lastJson = json;
  save();
  updateHistoryButtons();
}

function travel(json, verb) {
  const before = S;
  const after = JSON.parse(json);
  // Describe the step using the log: whichever side has the extra entry did the action.
  const [longer, shorter] = verb === "Undone" ? [before, after] : [after, before];
  const what = longer.log.length > shorter.log.length ? longer.log[longer.log.length - 1].text : "";
  setState(after);
  lastJson = json;
  SCRIPT = currentScriptFor(S.scriptKey);
  if (pickerIsOpen()) closePicker();
  render();
  toast(what ? `${verb}: ${what}` : `${verb}.`);
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(lastJson);
  travel(undoStack.pop(), "Undone");
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(lastJson);
  travel(redoStack.pop(), "Redone");
}

function updateHistoryButtons() {
  qs("#undoBtn").disabled = !undoStack.length;
  qs("#redoBtn").disabled = !redoStack.length;
}

let toastTimer = null;
function toast(text) {
  const el = qs("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// =========================================================================== render

function render() {
  if (!SCRIPT) return;
  qs("#scriptTitle").textContent = SCRIPT.name + (SCRIPT.author && !SCRIPT.builtin ? ` · by ${SCRIPT.author}` : "");
  const logo = qs("#scriptLogo");
  const logoSrc = SCRIPT.logo || (SCRIPT.edition ? editionLogoUrl(SCRIPT.edition) : "");
  logo.hidden = !logoSrc;
  if (logoSrc && logo.getAttribute("src") !== logoSrc) logo.src = logoSrc;

  const inSetup = S.phase === "setup";
  qs("#setupSection").hidden = !inSetup;
  qs("#gameSection").hidden = inSetup;
  if (inSetup) renderSetup();
  else renderGame();
  if (CARD) renderCard();
  if (SHEET) renderSheet();
  if (TABLE) renderTable();
  commit();
}

// =========================================================================== setup

function renderSetup() {
  // --- script choices
  const chips = BUILTIN_SCRIPTS.map((s) => `<button type="button" class="chip ${S.scriptKey === s.key ? "on" : ""}" data-script="${s.key}">${esc(s.name)}</button>`);
  customScripts.forEach((s) => chips.push(`<span class="chip-wrap"><button type="button" class="chip ${S.scriptKey === s.key ? "on" : ""}" data-script="${esc(s.key)}">${esc(s.name)}</button><button type="button" class="chip-x" data-remove-script="${esc(s.key)}" title="Remove this script">×</button></span>`));
  qs("#scriptChoices").innerHTML = chips.join("");

  const jinx = jinxesFor(SCRIPT.characters);
  qs("#scriptInfo").innerHTML = `
    <p class="muted small">${SCRIPT.characters.length} characters${SCRIPT.author ? ` · ${esc(SCRIPT.author)}` : ""}${Object.keys(SCRIPT.homebrew || {}).length ? ` · ${Object.keys(SCRIPT.homebrew).length} homebrew` : ""}</p>
    ${(SCRIPT.warnings || []).map((w) => `<p class="warn small">${esc(w)}</p>`).join("")}
    ${jinx.length ? `<details class="jinx-list"><summary>${jinx.length} jinx${jinx.length > 1 ? "es" : ""} on this script</summary>${jinx.map(jinxHtml).join("")}</details>` : ""}
    ${(SCRIPT.bootlegger || []).length ? `<details class="jinx-list" open><summary>House rules</summary>${SCRIPT.bootlegger.map((b) => `<p>${esc(b)}</p>`).join("")}</details>` : ""}`;

  // --- seats
  qs("#seatList").innerHTML = S.players.map((p, i) => `
    <li data-id="${p.id}">
      <span class="seat-no">${i + 1}</span>
      <input class="seat-name" value="${esc(p.name)}" aria-label="Name for seat ${i + 1}" />
      <button type="button" class="icon-btn" data-move="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" class="icon-btn" data-move="1" title="Move down" ${i === S.players.length - 1 ? "disabled" : ""}>↓</button>
      <button type="button" class="icon-btn" data-remove title="Remove">×</button>
    </li>`).join("") || `<p class="muted small">No players yet.</p>`;

  // --- counts
  const travellers = S.players.filter((p) => teamOf(p, SCRIPT) === "traveller").length;
  const n = S.players.length - travellers;
  const need = countsFor(n);
  qs("#countsDisplay").innerHTML = need
    ? ["townsfolk", "outsider", "minion", "demon"].map((t) => `<div class="count-item ${GOOD_TEAMS.has(t) ? "good" : "evil"}"><div class="count-label">${TEAM_LABEL[t]}</div><div class="count-num">${need[t]}</div></div>`).join("") +
      (travellers ? `<p class="muted small full">${travellers} Traveller${travellers > 1 ? "s" : ""} not counted.</p>` : "")
    : `<p class="muted small">Add at least 5 players to see how many of each type you need.</p>`;

  // --- bag
  const byTeam = scriptIdsByTeam();
  const picked = {};
  PLAY_TEAMS.forEach((t) => (picked[t] = S.bag.filter((id) => getRole(id, SCRIPT)?.team === t).length));
  const targets = bagTargets(n);
  qs("#bag").innerHTML = PLAY_TEAMS.filter((t) => byTeam[t].length).map((t) => {
    const target = targets && targets[t] ? targets[t] : null;
    const status = target === null ? "" : target.includes(picked[t]) ? "ok" : "off";
    const changed = target && targets.adjusted && (t === "outsider" || t === "townsfolk");
    return `<fieldset class="team-${t}">
      <legend>${TEAM_LABEL[t]} <span class="tally ${status}" ${changed ? `title="Changed by a setup character"` : ""}>${picked[t]}${target !== null ? " / " + target.join(" or ") + (changed ? "*" : "") : ""}</span></legend>
      ${byTeam[t].map((id) => {
        const r = getRole(id, SCRIPT);
        return `<label class="role-item" title="${esc(r.ability || "")}">
          <input type="checkbox" data-bag="${esc(id)}" ${S.bag.includes(id) ? "checked" : ""} />
          ${iconHtml(id, SCRIPT)}
          <span class="role-text"><span class="role-name">${esc(r.name)}</span><span class="role-ability">${esc(r.ability || "")}</span></span>
        </label>`;
      }).join("")}
    </fieldset>`;
  }).join("");

  const notes = S.bag.map((id) => ({ id, note: setupNote(getRole(id, SCRIPT)) })).filter((x) => x.note);
  qs("#setupNotes").innerHTML = notes.length
    ? `<div class="notice"><strong>Setup changes:</strong> ${notes.map((x) => `${esc(roleName(x.id, SCRIPT))} — ${esc(x.note)}`).join(" · ")}<br><span class="muted small">The counts marked * already allow for these. Anything else in the note is up to you.</span></div>`
    : "";

  // --- assignment
  const assigned = new Map();
  S.players.forEach((p) => p.character && assigned.set(p.character, (assigned.get(p.character) || 0) + 1));
  const goodIds = [...byTeam.townsfolk, ...byTeam.outsider];
  qs("#assignList").innerHTML = S.players.length ? S.players.map((p) => {
    const options = [...new Set([...S.bag, ...byTeam.traveller, p.character].filter(Boolean))];
    const sel = `<select class="assign-select" data-assign="${p.id}">
      <option value="">— character —</option>
      ${options.map((id) => `<option value="${esc(id)}" ${p.character === id ? "selected" : ""}>${esc(roleName(id, SCRIPT))}${assigned.get(id) && p.character !== id ? " (taken)" : ""}${!S.bag.includes(id) && getRole(id, SCRIPT)?.team === "traveller" ? " (Traveller)" : ""}</option>`).join("")}
    </select>`;
    let extra = "";
    const kind = THINKS[p.character];
    if (kind) {
      const pool = kind === "townsfolk" ? byTeam.townsfolk : kind === "good" ? goodIds : byTeam.demon;
      extra = `<select class="assign-select" data-thinks="${p.id}">
        <option value="">— thinks they are —</option>
        ${pool.map((id) => `<option value="${esc(id)}" ${p.thinks === id ? "selected" : ""}>${esc(roleName(id, SCRIPT))}${S.bag.includes(id) && kind !== "demon" ? " (in play!)" : ""}</option>`).join("")}
      </select>`;
    }
    if (teamOf(p, SCRIPT) === "traveller") {
      extra += `<select class="assign-select" data-align="${p.id}">
        <option value="good" ${alignmentOf(p, SCRIPT) === "good" ? "selected" : ""}>Good</option>
        <option value="evil" ${alignmentOf(p, SCRIPT) === "evil" ? "selected" : ""}>Evil</option>
      </select>`;
    }
    return `<div class="assign-row">${iconHtml(p.character, SCRIPT, alignmentOf(p, SCRIPT))}<span class="assign-name">${esc(p.name)}</span>${sel}${extra}</div>`;
  }).join("") : `<p class="muted small">Add players first.</p>`;

  // --- bluffs
  qs("#bluffs").innerHTML = [0, 1, 2].map((i) => `
    <select class="assign-select" data-bluff="${i}">
      <option value="">— bluff ${i + 1} —</option>
      ${goodIds.map((id) => `<option value="${esc(id)}" ${S.bluffs[i] === id ? "selected" : ""}>${esc(roleName(id, SCRIPT))}${S.bag.includes(id) ? " (in play!)" : ""}</option>`).join("")}
    </select>`).join("");

  // --- problems
  qs("#setupProblems").innerHTML = setupProblems().map((m) => `<p class="warn small">${esc(m)}</p>`).join("");
}

function jinxHtml(j) {
  return `<p class="jinx">${iconHtml(j.a, SCRIPT, "", "token-xs")}${iconHtml(j.b, SCRIPT, "", "token-xs")} <strong>${esc(roleName(j.a, SCRIPT))} & ${esc(roleName(j.b, SCRIPT))}:</strong> ${esc(j.reason)}</p>`;
}

function setupProblems() {
  const out = [];
  if (S.players.length < 5) out.push("You need at least 5 players.");
  const targets = bagTargets(nonTravellers(SCRIPT).length);
  if (targets) {
    ["townsfolk", "outsider", "minion", "demon"].forEach((t) => {
      const have = S.bag.filter((id) => getRole(id, SCRIPT)?.team === t).length;
      if (!targets[t].includes(have)) out.push(`${TEAM_LABEL[t]}: ${have} in the bag, should be ${targets[t].join(" or ")}.`);
    });
  }
  const missing = S.players.filter((p) => !p.character);
  if (missing.length) out.push(`No character yet: ${missing.map((p) => p.name).join(", ")}.`);
  const seen = new Map();
  S.players.forEach((p) => p.character && seen.set(p.character, (seen.get(p.character) || 0) + 1));
  seen.forEach((n, id) => { if (n > 1) out.push(`${roleName(id, SCRIPT)} is given to ${n} players.`); });
  S.players.filter((p) => THINKS[p.character] && !p.thinks).forEach((p) => out.push(`${p.name} is the ${roleName(p.character, SCRIPT)}: choose who they think they are.`));
  if (!S.bluffs.filter(Boolean).length && S.players.length >= 7) out.push("No Demon bluffs chosen yet.");
  return out;
}

function addPlayers(text) {
  const names = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  names.forEach((name) => S.players.push(freshPlayer(name)));
  render();
}

function dealRandomly() {
  const seats = S.players.filter((p) => teamOf(p, SCRIPT) !== "traveller");
  const pool = S.bag.filter((id) => getRole(id, SCRIPT)?.team !== "traveller");
  if (pool.length !== seats.length) {
    alert(`The bag has ${pool.length} characters but there are ${seats.length} players (not counting Travellers). Make them match first.`);
    return;
  }
  const dealt = shuffle(pool);
  seats.forEach((p, i) => { p.character = dealt[i]; p.thinks = ""; p.alignment = ""; });
  autoThinks();
  render();
}

/**
 * How a character changes the number of Outsiders, from the [brackets] in its ability.
 * "+2 Outsiders" -> 2.  "-1 or +1 Outsider" -> picks one.  No note -> 0.
 * ok:false means the note does something else (e.g. "+the King"), so random setup skips it.
 */
function outsiderOptions(id) {
  const note = setupNote(getRole(id, SCRIPT));
  if (!note) return [0];
  const m = note.replace(/−/g, "-").match(/^([+-]\d+)(?:\s*or\s*([+-]\d+))?\s*Outsiders?$/i);
  if (!m) return null;
  return [m[1], m[2]].filter(Boolean).map((v) => parseInt(v, 10) || 0);
}

function outsiderModifier(id) {
  const opts = outsiderOptions(id);
  if (!opts) return { ok: false };
  return { ok: true, mod: opts[Math.floor(Math.random() * opts.length)], canChange: opts.some((v) => v !== 0) };
}

/**
 * How many of each type the bag should hold, allowing for setup characters already in it.
 * Each team gets a list of acceptable numbers, e.g. a Godfather makes Outsiders "1 or 3".
 */
function bagTargets(n) {
  const base = countsFor(n);
  if (!base) return null;
  let shifts = new Set([0]);
  S.bag.forEach((id) => {
    const opts = outsiderOptions(id);
    if (!opts || (opts.length === 1 && opts[0] === 0)) return;
    const next = new Set();
    shifts.forEach((a) => opts.forEach((b) => next.add(a + b)));
    shifts = next;
  });
  const out = { minion: [base.minion], demon: [base.demon], outsider: [], townsfolk: [] };
  [...shifts].sort((a, b) => a - b).forEach((sh) => {
    const o = Math.max(0, base.outsider + sh);
    out.outsider.push(o);
    out.townsfolk.push(n - base.minion - base.demon - o);
  });
  out.outsider = [...new Set(out.outsider)];
  out.townsfolk = [...new Set(out.townsfolk)];
  out.adjusted = shifts.size > 1 || !shifts.has(0);
  return out;
}

/** Fills the bag with a legal random set of characters for this many players. */
function randomBag() {
  const msg = qs("#randomBagMsg");
  const n = nonTravellers(SCRIPT).length;
  const need = countsFor(n);
  if (!need) { msg.textContent = "Add at least 5 players first."; return; }
  if (S.bag.some((id) => getRole(id, SCRIPT)?.team !== "traveller") && !confirm("Replace the characters already ticked?")) return;

  const byTeam = scriptIdsByTeam();
  const skipped = [];
  const mods = new Map();
  // Evil characters may change the Outsider count. Good ones that do are skipped, since
  // they'd have to be chosen before the Outsiders they change.
  const eligible = (ids, allowChange) => ids.filter((id) => {
    const m = outsiderModifier(id);
    const ok = m.ok && (allowChange || !m.canChange);
    if (ok) mods.set(id, m.mod);
    else skipped.push(roleName(id, SCRIPT));
    return ok;
  });
  const demons = eligible(byTeam.demon, true);
  const minions = eligible(byTeam.minion, true);
  const outs = eligible(byTeam.outsider, false);
  const towns = eligible(byTeam.townsfolk, false);
  if (demons.length < need.demon || minions.length < need.minion) {
    msg.textContent = "This script doesn't have enough Demons or Minions for that many players.";
    return;
  }

  const pickD = shuffle(demons).slice(0, need.demon);
  const pickM = shuffle(minions).slice(0, need.minion);
  const changes = [...pickD, ...pickM].filter((id) => mods.get(id)).map((id) => {
    const v = mods.get(id);
    return `${roleName(id, SCRIPT)} ${v > 0 ? "+" : ""}${v} Outsider${Math.abs(v) === 1 ? "" : "s"}`;
  });
  let outsiders = need.outsider + [...pickD, ...pickM].reduce((sum, id) => sum + (mods.get(id) || 0), 0);
  outsiders = Math.max(0, Math.min(outsiders, outs.length));
  const townsfolk = n - pickD.length - pickM.length - outsiders;
  if (townsfolk > towns.length) { msg.textContent = "This script doesn't have enough Townsfolk for that many players."; return; }

  const travellers = S.bag.filter((id) => getRole(id, SCRIPT)?.team === "traveller");
  S.bag = [...shuffle(towns).slice(0, townsfolk), ...shuffle(outs).slice(0, outsiders), ...pickM, ...pickD, ...travellers];
  pruneAfterBagChange();
  log(`Random characters: ${S.bag.map((id) => roleName(id, SCRIPT)).join(", ")}.`);
  msg.textContent = (changes.length ? `Setup changes applied: ${changes.join(", ")}. ` : "") +
    (skipped.length ? `Not used by random (they change setup in other ways): ${skipped.join(", ")}.` : "");
  render();
}

/** After the bag changes, un-assign characters that left it and drop bluffs that are now in play. */
function pruneAfterBagChange() {
  S.players.forEach((p) => {
    if (p.character && !S.bag.includes(p.character) && teamOf(p, SCRIPT) !== "traveller") {
      p.character = ""; p.thinks = ""; p.alignment = "";
    }
  });
  S.bluffs = S.bluffs.map((id) => (S.bag.includes(id) ? "" : id));
}

/** Picks a sensible "thinks they are" for a Drunk / Marionette / Lunatic who hasn't got one. */
function autoThinks() {
  const byTeam = scriptIdsByTeam();
  S.players.forEach((p) => {
    const kind = THINKS[p.character];
    if (!kind || p.thinks) return;
    let pool;
    if (kind === "townsfolk") pool = byTeam.townsfolk.filter((id) => !S.bag.includes(id));
    else if (kind === "good") pool = [...byTeam.townsfolk, ...byTeam.outsider].filter((id) => !S.bag.includes(id));
    else pool = S.bag.filter((id) => getRole(id, SCRIPT)?.team === "demon");
    if (!pool.length && kind === "demon") pool = byTeam.demon;
    p.thinks = shuffle(pool)[0] || "";
  });
}

function suggestBluffs() {
  const byTeam = scriptIdsByTeam();
  const used = new Set([...S.bag, ...S.players.map((p) => p.thinks)]);
  const pool = shuffle([...byTeam.townsfolk, ...byTeam.townsfolk, ...byTeam.outsider].filter((id) => !used.has(id)));
  S.bluffs = [...new Set(pool)].slice(0, 3);
  while (S.bluffs.length < 3) S.bluffs.push("");
  render();
}

function startGame() {
  const problems = setupProblems();
  if (problems.length && !confirm("Start anyway?\n\n" + problems.join("\n"))) return;
  S.phase = "night";
  S.night = 0;
  S.log = [];
  log(`New game of ${SCRIPT.name} with ${S.players.length} players.`);
  S.players.forEach((p) => log(`${p.name}: ${roleName(p.character, SCRIPT)}${p.thinks ? ` (thinks they are the ${roleName(p.thinks, SCRIPT)})` : ""}.`));
  if (S.bluffs.some(Boolean)) log(`Demon bluffs: ${S.bluffs.filter(Boolean).map((id) => roleName(id, SCRIPT)).join(", ")}.`);
  startNight();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function newGame() {
  if (S.phase !== "setup" && !confirm("Start a new game? This game will be cleared (players and script are kept).")) return;
  const keep = S.players.map((p) => ({ name: p.name }));
  setState(freshGame(SCRIPT?.key || "tb", keep));
  CARD = null; SHEET = null; TABLE = null;
  showModal(qs("#textCard"), false);
  showModal(qs("#playerSheet"), false);
  showModal(qs("#tableView"), false);
  render();
}

// =========================================================================== game

function renderGame() {
  qs("#warnings").innerHTML = gameWarnings(SCRIPT).map((w) => `<div class="card notice big-notice">${esc(w)}</div>`).join("");
  renderGrimoire();

  qs("#phaseCard").innerHTML = S.phase === "night" ? nightHtml() : dayHtml();
  qs("#logList").innerHTML = S.log.slice().reverse().map((l) => `<li><span class="log-when">${esc(l.when)}</span> ${esc(l.text)}</li>`).join("");
}

/** The players laid out in a circle, seat 1 at the top, going clockwise. */
function renderGrimoire() {
  const el = qs("#grimoire");
  const n = S.players.length;
  el.classList.toggle("hidden-ids", HIDE);
  const btn = qs("#hideIdBtn");
  btn.textContent = HIDE ? "👁 Show identities" : "🙈 Hide identities";
  btn.setAttribute("aria-pressed", String(HIDE));
  btn.classList.toggle("on", HIDE);
  qs("#grimoireHelp").textContent = HIDE
    ? "Characters, teams and reminders are hidden. Names and alive/dead still show."
    : "Tap a player to change their status, character or reminders.";

  // Sizes are in "cqw": percent of the circle's width, so it scales to any screen.
  // With lots of players the circle stretches into a tall oval, so the names on
  // the left and right have room under their tokens.
  const step = (2 * Math.PI) / Math.max(n, 1);
  const Rx = 37;                                         // horizontal radius to each token's centre
  const Ry = Rx * Math.min(1.32, 1 + Math.max(0, n - 9) * 0.055);
  const d = Math.min(16, Rx * step * 0.8);               // token size
  const w = Math.min(24, Rx * step * 1.02);              // label width
  const cx = 50, cy = Ry + d / 2 + 4;                    // leave room above the top seat
  el.style.aspectRatio = `100 / ${(cy + Ry + d / 2 + 10).toFixed(1)}`; // and for names under the bottom seat
  el.style.setProperty("--table-h", `${(2 * Ry).toFixed(1)}cqw`);
  el.style.setProperty("--table-top", `${(cy - Ry).toFixed(1)}cqw`);
  const inset = d / 2 + 12.5;                            // reminders sit nearer the middle, clear of the names

  const seats = S.players.map((p, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = cx + Rx * Math.cos(a), y = cy + Ry * Math.sin(a);
    const align = alignmentOf(p, SCRIPT);
    const ghost = !p.alive ? `<span class="c-ghost" title="${p.ghostVote ? "Has their ghost vote" : "Ghost vote used"}">${p.ghostVote ? "👻" : "✕"}</span>` : "";
    const token = HIDE
      ? `<span class="ctoken ctoken-blank">${i + 1}</span>`
      : iconHtml(p.character, SCRIPT, align, "ctoken");
    const seat = `<button type="button" class="cseat ${p.alive ? "" : "dead"} ${HIDE ? "" : align}" data-sheet="${p.id}"
        style="left:${x.toFixed(2)}cqw; top:${(y - d / 2).toFixed(2)}cqw; width:${w.toFixed(2)}cqw; --d:${d.toFixed(2)}cqw"
        aria-label="Seat ${i + 1}: ${esc(p.name)}${p.alive ? "" : ", dead"}">
      <span class="c-ring">${token}${p.alive ? "" : `<span class="c-shroud">☠</span>`}${HIDE ? "" : `<span class="c-num">${i + 1}</span>`}${ghost}</span>
      <span class="c-name">${esc(p.name)}</span>
      ${HIDE ? "" : `<span class="c-char" title="${esc(roleName(p.character, SCRIPT))}${p.thinks ? " — thinks they are the " + esc(roleName(p.thinks, SCRIPT)) : ""}">${esc(roleName(p.character, SCRIPT))}${p.thinks ? `<em> → ${esc(roleName(p.thinks, SCRIPT))}</em>` : ""}</span>`}
    </button>`;
    const rems = !HIDE && p.tokens.length
      ? `<div class="c-rems" style="left:${(cx + (Rx - inset) * Math.cos(a)).toFixed(2)}cqw; top:${(cy + (Ry - inset) * Math.sin(a)).toFixed(2)}cqw">
          ${p.tokens.map((t) => `<span class="tok" title="${esc(t.label)}${t.from ? " (" + esc(roleName(t.from.split(":")[0], SCRIPT)) + ")" : ""}">${esc(t.label)}</span>`).join("")}
        </div>`
      : "";
    return seat + rems;
  }).join("");

  const living = alive().length;
  const phase = S.phase === "night" ? `🌙 Night ${S.night}` : `☀️ Day ${S.day}`;
  el.innerHTML = `${seats}
    <div class="c-centre" style="left:${cx}cqw; top:${cy}cqw">
      <div class="c-phase">${phase}</div>
      <div class="c-stat"><strong>${living}</strong>/${n} alive</div>
      <div class="c-stat"><strong>${votesNeeded()}</strong> to execute</div>
    </div>`;
}

function nightHtml() {
  const steps = buildNight(SCRIPT);
  const doneCount = steps.filter((s) => S.done[s.key]).length;
  return `
    <div class="card-head">
      <h2>🌙 Night ${S.night}</h2>
      <span class="pill">${S.night === 1 ? "First night" : "Other nights"} · ${doneCount}/${steps.length} done</span>
    </div>
    <p class="muted small">Tap each step in order. Greyed steps can usually be skipped (the reason is shown).</p>
    <ol class="night-list">
      ${steps.map((s) => stepRowHtml(s)).join("")}
    </ol>
    <div class="actions">
      <button type="button" class="ghost" data-action="someoneDied">Someone died…</button>
      <button type="button" data-action="startDay">☀️ Start the day</button>
    </div>`;
}

function stepRowHtml(s) {
  const who = s.wakers.map(({ player: p, via }) => {
    const flags = impairment(p, SCRIPT);
    return `<span class="who ${p.alive ? "" : "dead"}">${esc(p.name)}${via ? ` <em>(${esc(roleName(via, SCRIPT))})</em>` : ""}${flags.filter((f) => !f.startsWith("really")).map((f) => ` <span class="flag">${esc(f)}</span>`).join("")}${p.alive ? "" : " ☠️"}</span>`;
  }).join(", ");
  const icon = s.special ? `<span class="token-sm special-icon">${{ dusk: "🌆", dawn: "🌅", minioninfo: "😈", demoninfo: "👹" }[s.id] || "•"}</span>` : iconHtml(s.id, SCRIPT, "", "token-sm");
  return `<li class="step ${S.done[s.key] ? "done" : ""} ${s.dim ? "dim" : ""}" data-step="${esc(s.key)}">
    ${icon}
    <span class="step-text"><strong>${esc(s.name)}</strong>${who ? ` · ${who}` : ""}
      ${s.prompt.storyteller ? `<span class="muted small"> — you only</span>` : ""}
      ${s.dim ? `<span class="reason">${esc(s.reason)}</span>` : ""}
    </span>
    <span class="tick">${S.done[s.key] ? "✓" : ""}</span>
  </li>`;
}

function dayHtml() {
  const diedNight = S.diedTonight.map(playerById).filter(Boolean);
  const living = alive();
  const noms = S.today.nominations;
  const need = votesNeeded();
  const top = noms.reduce((m, n) => Math.max(m, n.votes), 0);
  const leaders = noms.filter((n) => n.votes === top && top >= need);
  const block = leaders.length === 1 ? playerById(leaders[0].nominee) : null;
  const opts = (list) => list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");

  return `
    <div class="card-head"><h2>☀️ Day ${S.day}</h2></div>
    <div class="announce">
      ${diedNight.length ? `Last night, <strong>${diedNight.map((p) => esc(p.name)).join(" and ")}</strong> died.` : "Nobody died last night."}
    </div>
    <div class="stat-row">
      <div class="stat"><div class="stat-num">${living.length}</div><div class="stat-label">alive</div></div>
      <div class="stat"><div class="stat-num">${need}</div><div class="stat-label">votes to execute</div></div>
    </div>

    <h3>Nominations</h3>
    <div class="row wrap nominate">
      <select id="nomBy"><option value="">Nominator</option>${opts(alive())}</select>
      <span>nominates</span>
      <select id="nomWho"><option value="">Nominee</option>${opts(S.players)}</select>
      <input id="nomVotes" type="number" min="0" placeholder="votes" />
      <button type="button" data-action="recordNom">Record</button>
    </div>
    ${noms.length ? `<ol class="nom-list">${noms.map((n, i) => `<li>${esc(playerById(n.by)?.name || "?")} → <strong>${esc(playerById(n.nominee)?.name || "?")}</strong>: ${n.votes} vote${n.votes === 1 ? "" : "s"} ${n.votes >= need ? "✓" : ""} <button type="button" class="icon-btn" data-remove-nom="${i}" title="Remove">×</button></li>`).join("")}</ol>` : `<p class="muted small">Nothing nominated yet. Each player may nominate once and be nominated once per day.</p>`}
    <p class="block-line">${block ? `On the block: <strong>${esc(block.name)}</strong> (${top} votes).` : top >= need ? "Tied — nobody is on the block." : "Nobody on the block yet."}</p>
    ${S.today.executed ? `<p class="announce">Executed today: <strong>${esc(playerById(S.today.executed)?.name || "?")}</strong></p>` : ""}

    <div class="actions">
      <button type="button" class="ghost" data-action="execute">${block && !S.today.executed ? `Execute ${esc(block.name)}` : "Execute…"}</button>
      <button type="button" class="ghost" data-action="someoneDied">Someone died…</button>
      <button type="button" data-action="startNight">🌙 Go to night</button>
    </div>`;
}

function recordNomination() {
  const by = qs("#nomBy").value, nominee = qs("#nomWho").value;
  const votes = parseInt(qs("#nomVotes").value, 10);
  if (!by || !nominee || Number.isNaN(votes)) { alert("Pick both players and enter the number of votes."); return; }
  S.today.nominations.push({ by, nominee, votes });
  log(`${playerById(by).name} nominated ${playerById(nominee).name}: ${votes} vote${votes === 1 ? "" : "s"}.`);
  render();
}

function executeFlow() {
  const need = votesNeeded();
  const noms = S.today.nominations;
  const top = noms.reduce((m, n) => Math.max(m, n.votes), 0);
  const leaders = noms.filter((n) => n.votes === top && top >= need);
  const doIt = (id) => {
    const p = playerById(id);
    if (!p) return;
    if (S.today.executed && !confirm("Someone was already executed today. Execute again?")) return;
    execute(p, SCRIPT);
    render();
  };
  if (leaders.length === 1 && !S.today.executed) {
    if (confirm(`Execute ${playerById(leaders[0].nominee).name}?`)) doIt(leaders[0].nominee);
    return;
  }
  openPicker(playerItems(S.players), { title: "Who is executed?", onDone: ([id]) => doIt(id) });
}

function someoneDied() {
  openPicker(playerItems(alive()), {
    title: "Who died?",
    max: Infinity,
    onDone: (ids) => { ids.forEach((id) => kill(playerById(id), SCRIPT)); render(); },
  });
}

function playerItems(list, opts = {}) {
  return list.map((p) => ({
    value: p.id,
    label: p.name,
    sub: [opts.hideChars ? "" : roleName(p.character, SCRIPT), p.alive ? "" : "dead", ...p.tokens.map((t) => t.label)].filter(Boolean).join(" · "),
    icon: opts.hideChars ? "" : iconHtml(p.character, SCRIPT, alignmentOf(p, SCRIPT), "token-xs"),
  }));
}

// =========================================================================== step card

function findStep(key) {
  return buildNight(SCRIPT).find((s) => s.key === key);
}

function openStep(key) {
  CARD = { key, playerView: false };
  showModal(qs("#textCard"), true);
  renderCard();
}

function closeCard() {
  CARD = null;
  showModal(qs("#textCard"), false);
  render();
}

const choiceFor = (key) => S.choices[key] || {};

function renderCard() {
  const step = findStep(CARD.key);
  if (!step) { closeCard(); return; }
  const p = step.prompt;
  const c = choiceFor(step.key);
  const inner = qs("#textCardInner");
  const answer = answerHtml(step, c);

  if (CARD.playerView) {
    inner.className = "inner player-view";
    inner.innerHTML = `
      <div class="bigtext">${esc(p.say)}</div>
      ${answer ? `<div class="answer">${answer}</div>` : ""}
      <p class="muted small tap-back">Tap anywhere to go back</p>`;
    return;
  }

  inner.className = "inner";
  const actors = step.wakers.map((w) => w.player);
  const icon = step.special ? "" : iconHtml(step.id, SCRIPT, "", "token-md");
  const whoLine = step.wakers.map(({ player: q, via }) => `${esc(q.name)}${via ? ` <em>(really ${esc(roleName(via, SCRIPT))})</em>` : ""}${q.alive ? "" : " ☠️"}`).join(", ");

  // ---- notes for you only
  const notes = [];
  if (step.dim) notes.push(`<p class="warn">⚠ ${esc(step.reason)}.</p>`);
  actors.forEach((q) => {
    const flags = impairment(q, SCRIPT);
    if (flags.length) notes.push(`<p class="warn">⚠ ${esc(q.name)} is ${esc(flags.join(", "))}: their ability doesn't really work, and you can give them false info.</p>`);
  });
  if (p.st) notes.push(`<p>${esc(p.st)}</p>`);
  const role = getRole(step.id, SCRIPT);
  if (role && !step.special) {
    const official = S.night <= 1 ? role.firstNightReminder : role.otherNightReminder;
    if (official && !p.generic) notes.push(`<p class="muted small">Official: ${esc(cleanReminder(official))}</p>`);
    if (p.generic && p.st) { /* already shown */ }
  }
  const hint = hintFor(step, SCRIPT);
  if (hint) notes.push(`<p class="hint">💡 ${esc(hint)}</p>`);
  if (p.choose || p.chooseMax || p.generic) {
    const last = lastChoiceFor(step.id);
    if (last) notes.push(`<p class="muted small">Last time (night ${last.night}) they chose: ${last.players.map((id) => esc(playerById(id)?.name || "?")).join(", ")}.</p>`);
  }
  if (step.id === "demoninfo" || p.bluffs) {
    notes.push(`<p class="muted small">Bluffs come from setup. <button type="button" class="link-btn" data-card="bluffs">Change bluffs</button></p>`);
  }

  // ---- controls
  const ctrls = [];
  const choose = p.choose || p.chooseMax || (p.generic ? Infinity : 0);
  if (choose) ctrls.push(`<button type="button" class="ghost" data-card="choose">${c.players?.length ? "Change choice" : "They chose…"}</button>`);
  if (p.guess || p.generic) ctrls.push(`<button type="button" class="ghost" data-card="guess">${c.guess ? "Change character" : "They named a character…"}</button>`);
  if (p.point) ctrls.push(`<button type="button" class="ghost" data-card="point">You pointed at…</button>`);
  const show = p.show || (p.generic ? "any" : "");
  if (show === "number" || show === "any") {
    ctrls.push(`<span class="numpad">${[0, 1, 2, 3, 4, 5].map((n) => `<button type="button" class="ghost num ${c.answer?.type === "number" && c.answer.value === n ? "on" : ""}" data-num="${n}">${n}</button>`).join("")}<button type="button" class="ghost num" data-card="moreNum">…</button></span>`);
  }
  if (show === "yesno" || show === "any") {
    ctrls.push(`<button type="button" class="ghost ${c.answer?.value === "yes" ? "on" : ""}" data-yesno="yes">👍 Yes</button><button type="button" class="ghost ${c.answer?.value === "no" ? "on" : ""}" data-yesno="no">👎 No</button>`);
  }
  if (show === "character" || show === "any") ctrls.push(`<button type="button" class="ghost" data-card="showChar">Show a character…</button>`);
  if (show === "characters") ctrls.push(`<button type="button" class="ghost" data-card="showChars">Show characters…</button>`);
  if (p.zero) ctrls.push(`<button type="button" class="ghost" data-card="zero">None in play</button>`);
  if (show === "grimoire") ctrls.push(`<button type="button" class="ghost" data-card="grimoire">Open the Grimoire</button>`);
  if (p.once) ctrls.push(`<button type="button" class="ghost" data-card="used">Mark ability used</button>`);
  if (!step.special || step.id === "dawn") ctrls.push(`<button type="button" class="ghost" data-card="died">Someone died…</button>`);

  inner.innerHTML = `
    <div class="card-top">${icon}<div><div class="card-role">${esc(step.name)}</div>${whoLine ? `<div class="muted">${whoLine}</div>` : ""}</div></div>
    <div class="bigtext">${esc(p.say)}</div>
    ${answer ? `<div class="answer">${answer}</div>` : ""}
    ${c.players?.length ? `<div class="chosen">They chose: <strong>${c.players.map((id) => esc(playerById(id)?.name || "?")).join(", ")}</strong>${c.guess ? ` · named <strong>${esc(roleName(c.guess, SCRIPT))}</strong>` : ""}</div>` : c.guess ? `<div class="chosen">Named: <strong>${esc(roleName(c.guess, SCRIPT))}</strong></div>` : ""}
    ${p.kills && c.players?.length ? killHtml(c.players, step) : ""}
    ${ctrls.length ? `<div class="controls">${ctrls.join("")}</div>` : ""}
    ${notes.length ? `<div class="st-notes"><div class="st-label">For you only</div>${notes.join("")}</div>` : ""}
    <div class="toolbar">
      ${p.storyteller ? "" : `<button type="button" class="ghost" data-card="playerView">👁 Show player</button>`}
      ${step.id === "dawn" ? `<button type="button" data-card="startDay">☀️ Start the day</button>` : `<button type="button" data-card="done">Done ✓</button>`}
      <button type="button" class="ghost" data-card="close">Close</button>
    </div>`;
}

/** The big answer you show the player. */
function answerHtml(step, c) {
  const p = step.prompt;
  if (p.show === "evilteam") return evilTeamHtml(p.bluffs || step.id === "demoninfo");
  const a = c.answer;
  if (!a) return "";
  if (a.type === "number") return `<div class="big-num">${a.value}</div>`;
  if (a.type === "yesno") return `<div class="big-num">${a.value === "yes" ? "👍 YES" : "👎 NO"}</div>`;
  if (a.type === "zero") return `<div class="big-num">0</div><div class="answer-cap">None in play</div>`;
  if (a.type === "characters") {
    return `<div class="token-row">${a.value.map((id) => `<figure>${iconHtml(id, SCRIPT, "", "token-lg")}<figcaption>${esc(roleName(id, SCRIPT))}</figcaption></figure>`).join("")}</div>`;
  }
  return "";
}

function evilTeamHtml(withBluffs) {
  const { demons, minions } = evilTeam(SCRIPT);
  const fig = (q, label) => `<figure>${iconHtml(q.character, SCRIPT, "evil", "token-lg")}<figcaption><span class="fig-name">${esc(q.name)}</span><span class="fig-sub">${esc(label)}</span></figcaption></figure>`;
  const bluffs = S.bluffs.filter(Boolean);
  return `
    <div class="token-row">${demons.map((q) => fig(q, "Demon")).join("")}${minions.map((q) => fig(q, roleName(q.character, SCRIPT))).join("")}</div>
    ${withBluffs ? `<div class="answer-cap">Not in play</div><div class="token-row">${bluffs.length ? bluffs.map((id) => `<figure>${iconHtml(id, SCRIPT, "good", "token-lg")}<figcaption>${esc(roleName(id, SCRIPT))}</figcaption></figure>`).join("") : `<p class="muted">No bluffs chosen.</p>`}</div>` : ""}`;
}

function killHtml(ids, step) {
  return `<div class="kill-box">${ids.map((id) => {
    const t = playerById(id);
    if (!t) return "";
    const r = getRole(t.character, SCRIPT);
    const warn = [];
    if (t.tokens.length) warn.push(`Reminders: ${t.tokens.map((x) => `${x.label}${x.from ? ` (${roleName(x.from, SCRIPT)})` : ""}`).join(", ")}`);
    const flags = impairment(t, SCRIPT);
    if (flags.length) warn.push(`${t.name} is ${flags.join(", ")}`);
    if (r?.ability) warn.push(`${r.name}: ${r.ability}`);
    if (livingNeighbours(t).some((q) => q.character === "tealady")) warn.push("Sits next to the Tea Lady.");
    if (step.wakers.some((w) => w.player.id === id)) warn.push("They chose themselves.");
    const died = !t.alive && S.diedTonight.includes(t.id);
    const survived = (S.choices[step.key]?.survived || []).includes(t.id);
    return `<div class="kill-row">
      <div><strong>${esc(t.name)}</strong> ${t.alive ? "" : "☠️"}<div class="muted small">${warn.map(esc).join("<br>")}</div></div>
      <div class="kill-btns">${died
        ? `<span>Died ✓</span><button type="button" class="ghost" data-revive="${t.id}">Undo</button>`
        : survived && t.alive ? `<span>Survives</span><button type="button" class="ghost" data-kill="${t.id}">Actually dies</button>`
        : t.alive ? `<button type="button" data-kill="${t.id}">Dies</button><button type="button" class="ghost" data-survive="${t.id}">Survives</button>` : `<span class="muted">Already dead</span>`}</div>
    </div>`;
  }).join("")}</div>`;
}

function onCardClick(e) {
  if (!CARD) return;
  if (CARD.playerView) { CARD.playerView = false; renderCard(); return; }
  const btn = e.target.closest("button");
  if (!btn) return;
  const step = findStep(CARD.key);
  if (!step) return;
  const p = step.prompt;
  const c = (S.choices[step.key] ||= {});
  const actors = step.wakers.map((w) => w.player);
  const actorName = actors.map((q) => q.name).join(" & ") || step.name;
  const setAnswer = (a) => { c.answer = a; render(); };

  if (btn.dataset.num !== undefined) { setAnswer({ type: "number", value: +btn.dataset.num }); logAnswer(step, actorName, btn.dataset.num); return; }
  if (btn.dataset.yesno) { setAnswer({ type: "yesno", value: btn.dataset.yesno }); logAnswer(step, actorName, btn.dataset.yesno.toUpperCase()); return; }
  if (btn.dataset.kill) { kill(playerById(btn.dataset.kill), SCRIPT, `killed by the ${step.name}`); render(); return; }
  if (btn.dataset.revive) { revive(playerById(btn.dataset.revive), SCRIPT); render(); return; }
  if (btn.dataset.survive) {
    (c.survived ||= []).push(btn.dataset.survive);
    log(`${playerById(btn.dataset.survive).name} survived the ${step.name}'s attack.`);
    render();
    return;
  }

  switch (btn.dataset.card) {
    case "close": closeCard(); break;
    case "done": S.done[step.key] = true; closeCard(); break;
    case "startDay": S.done[step.key] = true; CARD = null; showModal(qs("#textCard"), false); doStartDay(); break;
    case "playerView": CARD.playerView = true; renderCard(); break;
    case "choose": {
      const max = p.choose || p.chooseMax || Infinity;
      let list = S.players.filter((q) => p.dead || p.generic || q.alive);
      if (!p.self && !p.generic) list = list.filter((q) => !actors.includes(q));
      openPicker(playerItems(list), {
        title: `Who did the ${step.name} choose?`, max, selected: c.players || [],
        onDone: (ids) => {
          c.players = ids;
          const targets = ids.map(playerById);
          if (p.token && targets.length) placeToken(targets, p.token, step.id, p.clears);
          log(`${actorName} (${step.name}) chose ${targets.map((q) => q.name).join(", ") || "nobody"}.`);
          render();
        },
      });
      break;
    }
    case "guess":
      openPicker(characterItems(SCRIPT.characters, SCRIPT), {
        title: "Which character did they name?",
        onDone: ([id]) => { c.guess = id; log(`${actorName} (${step.name}) named the ${roleName(id, SCRIPT)}.`); render(); },
      });
      break;
    case "point":
      openPicker(playerItems(S.players), {
        title: "Which players did you point at?", max: p.point, selected: c.point || [],
        onDone: (ids) => { c.point = ids; log(`${step.name}: pointed at ${ids.map((id) => playerById(id).name).join(" & ")}.`); render(); },
      });
      break;
    case "showChar":
      openPicker(characterItems(allCharacterIds(), SCRIPT), {
        title: "Which character do you show?",
        onDone: ([id]) => { setAnswer({ type: "characters", value: [id] }); logAnswer(step, actorName, roleName(id, SCRIPT)); },
      });
      break;
    case "showChars":
      openPicker(characterItems(allCharacterIds(), SCRIPT), {
        title: "Which characters do you show?", max: p.showCount || 3, selected: c.answer?.type === "characters" ? c.answer.value : [],
        onDone: (ids) => { setAnswer({ type: "characters", value: ids }); logAnswer(step, actorName, ids.map((id) => roleName(id, SCRIPT)).join(", ")); },
      });
      break;
    case "moreNum": {
      const v = parseInt(prompt("Number to show:", ""), 10);
      if (!Number.isNaN(v)) { setAnswer({ type: "number", value: v }); logAnswer(step, actorName, v); }
      break;
    }
    case "zero": setAnswer({ type: "zero" }); logAnswer(step, actorName, "none in play"); break;
    case "grimoire": openTable("grimoire"); break;
    case "bluffs":
      openPicker(characterItems([...scriptIdsByTeam().townsfolk, ...scriptIdsByTeam().outsider], SCRIPT), {
        title: "Demon bluffs (pick 3)", max: 3, selected: S.bluffs.filter(Boolean),
        onDone: (ids) => { S.bluffs = [...ids, "", "", ""].slice(0, 3); render(); },
      });
      break;
    case "used":
      actors.forEach((q) => placeToken([q], "No Ability", step.id + ":" + q.id, ""));
      log(`${actorName} (${step.name}) used their once-per-game ability.`);
      render();
      break;
    case "died": someoneDied(); break;
  }
}

function logAnswer(step, actorName, what) {
  log(`${actorName} (${step.name}) was shown: ${what}.`);
  commit();
}

/** Script characters first, then every other official character (for "shown as" choices). */
function allCharacterIds() {
  const rest = [...DB.roles.values()].filter((r) => PLAY_TEAMS.includes(r.team) && !SCRIPT.characters.includes(r.id)).map((r) => r.id);
  return [...SCRIPT.characters, ...rest];
}

function doStartDay() {
  startDay();
  render();
  window.scrollTo({ top: qs("#phaseCard").offsetTop - 10, behavior: "smooth" });
}

// =========================================================================== player sheet

function openSheet(id) {
  SHEET = id;
  showModal(qs("#playerSheet"), true);
  renderSheet();
}

function closeSheet() {
  SHEET = null;
  showModal(qs("#playerSheet"), false);
  render();
}

function reminderOptions() {
  const inPlay = new Set(S.players.map((p) => p.character));
  const ids = [...SCRIPT.characters].sort((a, b) => (inPlay.has(b) ? 1 : 0) - (inPlay.has(a) ? 1 : 0));
  const out = [];
  const seen = new Set();
  ids.forEach((id) => {
    const r = getRole(id, SCRIPT);
    [...(r?.reminders || []), ...(r?.remindersGlobal || [])].forEach((label) => {
      const k = id + "|" + label;
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ value: k, label: `${label} (${r.name})${inPlay.has(id) ? "" : " · not in play"}` });
    });
  });
  ["Poisoned", "Drunk", "Safe", "Mad", "Dead", "No Ability"].forEach((l) => out.push({ value: "|" + l, label: `${l} (general)` }));
  return out;
}

function renderSheet() {
  const p = playerById(SHEET);
  if (!p) { closeSheet(); return; }
  const kind = THINKS[p.character];
  const byTeam = scriptIdsByTeam();
  const charOpts = [...new Set([...SCRIPT.characters, p.character].filter(Boolean))];
  let thinksPool = [];
  if (kind === "townsfolk") thinksPool = byTeam.townsfolk;
  if (kind === "good") thinksPool = [...byTeam.townsfolk, ...byTeam.outsider];
  if (kind === "demon") thinksPool = byTeam.demon;
  const align = alignmentOf(p, SCRIPT);
  const role = getRole(p.character, SCRIPT);

  qs("#playerSheetInner").innerHTML = `
    <div class="picker-head sheet-head">
      ${iconHtml(p.character, SCRIPT, align, "token-md")}
      <input id="sheetName" class="sheet-name" value="${esc(p.name)}" aria-label="Player name" />
    </div>
    <div class="sheet-body">
      ${role ? `<p class="muted small">${esc(role.ability || "")}</p>` : ""}
      <label class="field">Character
        <select id="sheetChar"><option value="">— none —</option>${charOpts.map((id) => `<option value="${esc(id)}" ${p.character === id ? "selected" : ""}>${esc(roleName(id, SCRIPT))}</option>`).join("")}</select>
      </label>
      ${kind ? `<label class="field">Thinks they are
        <select id="sheetThinks"><option value="">— none —</option>${thinksPool.map((id) => `<option value="${esc(id)}" ${p.thinks === id ? "selected" : ""}>${esc(roleName(id, SCRIPT))}</option>`).join("")}</select>
      </label>` : ""}
      <div class="field">Team
        <div class="seg">
          ${["", "good", "evil"].map((a) => `<button type="button" class="ghost ${p.alignment === a ? "on" : ""}" data-sheet-align="${a}">${a ? cap(a) : `Auto (${align || "?"})`}</button>`).join("")}
        </div>
      </div>
      <div class="field">Status
        <div class="seg">
          <button type="button" class="${p.alive ? "" : "ghost"}" data-sheet-alive="1">Alive</button>
          <button type="button" class="${p.alive ? "ghost" : ""}" data-sheet-alive="0">Dead</button>
          ${p.alive ? "" : `<button type="button" class="ghost" data-sheet-ghost>${p.ghostVote ? "👻 Ghost vote: unused" : "Ghost vote: used"}</button>`}
        </div>
      </div>
      <div class="field">Reminders
        <div class="tok-list">${p.tokens.map((t, i) => `<span class="tok big">${esc(t.label)}${t.from ? ` <small>${esc(roleName(t.from.split(":")[0], SCRIPT))}</small>` : ""}${t.clears ? ` <small>until ${t.clears}</small>` : ""}<button type="button" class="chip-x" data-sheet-untoken="${i}" title="Remove">×</button></span>`).join("") || `<span class="muted small">None</span>`}</div>
        <div class="row wrap">
          <select id="sheetTokenSel"><option value="">Add a reminder…</option>${reminderOptions().map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>
          <input id="sheetTokenCustom" placeholder="or type your own" />
          <button type="button" class="ghost" data-sheet-addtoken>Add</button>
        </div>
      </div>
      <label class="field">Notes
        <textarea id="sheetNote" rows="2" placeholder="Claims, who they talked to…">${esc(p.note)}</textarea>
      </label>
    </div>
    <div class="picker-actions"><button type="button" data-sheet-close>Close</button></div>`;
}

function onSheetClick(e) {
  const p = playerById(SHEET);
  if (!p) return;
  if (e.target === qs("#playerSheet")) { closeSheet(); return; }
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.sheetClose !== undefined) { closeSheet(); return; }
  if (b.dataset.sheetAlign !== undefined) { p.alignment = b.dataset.sheetAlign; log(`${p.name} is now ${p.alignment || "back to their character's"} team.`); }
  if (b.dataset.sheetAlive !== undefined) {
    if (b.dataset.sheetAlive === "1") revive(p, SCRIPT);
    else kill(p, SCRIPT);
  }
  if (b.dataset.sheetGhost !== undefined) { p.ghostVote = !p.ghostVote; log(`${p.name} ${p.ghostVote ? "has their ghost vote back" : "used their ghost vote"}.`); }
  if (b.dataset.sheetUntoken !== undefined) p.tokens.splice(+b.dataset.sheetUntoken, 1);
  if (b.dataset.sheetAddtoken !== undefined) {
    const custom = qs("#sheetTokenCustom").value.trim();
    const sel = qs("#sheetTokenSel").value;
    if (custom) p.tokens.push({ label: custom, from: "", clears: "" });
    else if (sel) { const [from, label] = sel.split("|"); p.tokens.push({ label, from, clears: "" }); }
  }
  render();
}

function onSheetChange(e) {
  const p = playerById(SHEET);
  if (!p || ["sheetTokenSel", "sheetTokenCustom"].includes(e.target.id)) return;
  if (e.target.id === "sheetName") p.name = e.target.value.trim() || p.name;
  if (e.target.id === "sheetChar") {
    const old = p.character;
    p.character = e.target.value;
    if (!THINKS[p.character]) p.thinks = "";
    p.alignment = "";
    if (S.phase !== "setup") log(`${p.name} changed from the ${roleName(old, SCRIPT)} to the ${roleName(p.character, SCRIPT)}.`);
  }
  if (e.target.id === "sheetThinks") p.thinks = e.target.value;
  if (e.target.id === "sheetNote") p.note = e.target.value;
  render();
}

// =========================================================================== table view

function openTable(mode) {
  TABLE = mode;
  showModal(qs("#tableView"), true);
  renderTable();
}

function closeTable() {
  TABLE = null;
  showModal(qs("#tableView"), false);
}

function renderTable() {
  const el = qs("#tableViewInner");
  const tabs = `<div class="seg table-tabs">
    <button type="button" class="${TABLE === "town" ? "" : "ghost"}" data-table="town">Town</button>
    <button type="button" class="${TABLE === "sheet" ? "" : "ghost"}" data-table="sheet">Script sheet</button>
    <button type="button" class="ghost" data-table="close">Close</button>
  </div>`;

  if (TABLE === "sheet") {
    const byTeam = scriptIdsByTeam();
    const n = nonTravellers(SCRIPT).length;
    const need = countsFor(n);
    el.innerHTML = `${tabs}
      <h2>${esc(SCRIPT.name)}</h2>
      ${need ? `<p class="muted">${n} players: ${["townsfolk", "outsider", "minion", "demon"].map((t) => `${need[t]} ${TEAM_LABEL[t]}`).join(" · ")}</p>` : ""}
      ${PLAY_TEAMS.filter((t) => byTeam[t].length).map((t) => `
        <h3 class="team-head team-${t}">${TEAM_LABEL[t]}</h3>
        <div class="sheet-grid">${byTeam[t].map((id) => {
          const r = getRole(id, SCRIPT);
          return `<div class="sheet-item">${iconHtml(id, SCRIPT, "", "token-md")}<div><strong>${esc(r.name)}</strong><p>${esc(r.ability || "")}</p></div></div>`;
        }).join("")}</div>`).join("")}
      ${jinxesFor(SCRIPT.characters).length ? `<h3>Jinxes</h3>${jinxesFor(SCRIPT.characters).map(jinxHtml).join("")}` : ""}`;
    return;
  }

  const showChars = TABLE === "grimoire";
  const living = alive().length;
  el.innerHTML = `${showChars ? `<div class="seg table-tabs"><button type="button" data-table="close">Close the Grimoire</button></div>` : tabs}
    <h2>${S.phase === "setup" ? "Town square" : S.phase === "night" ? `Night ${S.night}` : `Day ${S.day}`}</h2>
    ${S.phase === "setup" ? "" : `<div class="stat-row">
      <div class="stat"><div class="stat-num">${living}</div><div class="stat-label">alive</div></div>
      <div class="stat"><div class="stat-num">${votesNeeded()}</div><div class="stat-label">votes to execute</div></div>
      <div class="stat"><div class="stat-num">${S.players.filter((p) => !p.alive && p.ghostVote).length}</div><div class="stat-label">ghost votes left</div></div>
    </div>`}
    <div class="town">${S.players.map((p, i) => `
      <div class="town-seat ${p.alive ? "" : "dead"}">
        <span class="seat-num">${i + 1}</span>
        ${showChars ? iconHtml(p.character, SCRIPT, alignmentOf(p, SCRIPT), "token-md") : ""}
        <span class="town-name">${esc(p.name)}</span>
        ${showChars ? `<span class="muted small">${esc(roleName(p.character, SCRIPT))}${p.thinks ? ` (thinks ${esc(roleName(p.thinks, SCRIPT))})` : ""}</span>` : ""}
        <span class="town-status">${p.alive ? "" : p.ghostVote ? "☠️ 👻 has a vote" : "☠️ no vote"}</span>
        ${showChars && p.tokens.length ? `<span class="seat-tokens">${p.tokens.map((t) => `<span class="tok">${esc(t.label)}</span>`).join("")}</span>` : ""}
      </div>`).join("")}</div>
    ${S.phase === "day" && S.today.nominations.length ? `<h3>Today's nominations</h3><ol class="nom-list">${S.today.nominations.map((n) => `<li>${esc(playerById(n.by)?.name)} → <strong>${esc(playerById(n.nominee)?.name)}</strong>: ${n.votes}</li>`).join("")}</ol>` : ""}`;
}

// =========================================================================== events

function bindEvents() {
  // header
  qs("#newGameBtn").addEventListener("click", newGame);
  qs("#tableViewBtn").addEventListener("click", () => openTable("town"));
  qs("#scriptSheetBtn").addEventListener("click", () => openTable("sheet"));

  // script choice
  qs("#scriptChoices").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-remove-script]");
    if (rm) {
      if (!confirm("Remove this script?")) return;
      removeCustomScript(rm.dataset.removeScript);
      if (S.scriptKey === rm.dataset.removeScript) selectScript("tb");
      render();
      return;
    }
    const b = e.target.closest("[data-script]");
    if (!b || b.dataset.script === S.scriptKey) return;
    if (S.bag.length && !confirm("Switch script? Your character choices will be cleared.")) return;
    selectScript(b.dataset.script);
    render();
  });

  // add script: paste, file, drop
  const addFromText = (text, name) => {
    const msg = qs("#addScriptMsg");
    try {
      const script = parseScript(text, name);
      addCustomScript(script);
      selectScript(script.key);
      qs("#scriptPaste").value = "";
      msg.textContent = `Added "${script.name}" (${script.characters.length} characters).${script.warnings.length ? " Some entries were skipped — see below." : ""}`;
      msg.className = "ok-text";
      render();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "warn";
    }
  };
  qs("#addScriptBtn").addEventListener("click", () => addFromText(qs("#scriptPaste").value));
  const readFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addFromText(String(reader.result), file.name.replace(/\.json$/i, ""));
    reader.readAsText(file);
  };
  qs("#scriptFile").addEventListener("change", (e) => readFile(e.target.files[0]));
  const dz = qs("#dropZone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove("over")));
  dz.addEventListener("drop", (e) => { e.preventDefault(); readFile(e.dataTransfer.files[0]); });

  // players
  qs("#addPlayersBtn").addEventListener("click", () => { addPlayers(qs("#playerInput").value); qs("#playerInput").value = ""; });
  qs("#playerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); qs("#addPlayersBtn").click(); }
  });
  qs("#seatList").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    const b = e.target.closest("button");
    if (!li || !b) return;
    const i = S.players.findIndex((p) => p.id === li.dataset.id);
    if (b.dataset.remove !== undefined) S.players.splice(i, 1);
    if (b.dataset.move) {
      const j = i + +b.dataset.move;
      [S.players[i], S.players[j]] = [S.players[j], S.players[i]];
    }
    render();
  });
  qs("#seatList").addEventListener("change", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || !e.target.classList.contains("seat-name")) return;
    const p = playerById(li.dataset.id);
    p.name = e.target.value.trim() || p.name;
    render();
  });

  // bag & assignment
  qs("#bag").addEventListener("change", (e) => {
    const id = e.target.dataset.bag;
    if (!id) return;
    if (e.target.checked) S.bag.push(id);
    else S.bag = S.bag.filter((x) => x !== id);
    render();
  });
  qs("#assignCard").addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.assign) {
      const p = playerById(t.dataset.assign);
      p.character = t.value;
      p.alignment = "";
      if (!THINKS[p.character]) p.thinks = "";
      autoThinks();
    }
    if (t.dataset.thinks) playerById(t.dataset.thinks).thinks = t.value;
    if (t.dataset.align) playerById(t.dataset.align).alignment = t.value;
    if (t.dataset.bluff !== undefined) S.bluffs[+t.dataset.bluff] = t.value;
    render();
  });
  qs("#dealBtn").addEventListener("click", dealRandomly);
  qs("#randomBagBtn").addEventListener("click", randomBag);
  qs("#clearBagBtn").addEventListener("click", () => {
    S.bag = S.bag.filter((id) => getRole(id, SCRIPT)?.team === "traveller");
    pruneAfterBagChange();
    qs("#randomBagMsg").textContent = "";
    render();
  });
  qs("#suggestBluffsBtn").addEventListener("click", suggestBluffs);
  qs("#startGameBtn").addEventListener("click", startGame);

  // game
  qs("#hideIdBtn").addEventListener("click", () => {
    HIDE = !HIDE;
    try { localStorage.setItem(HIDE_KEY, HIDE ? "1" : "0"); } catch { }
    renderGrimoire();
  });
  qs("#undoBtn").addEventListener("click", undo);
  qs("#redoBtn").addEventListener("click", redo);
  qs("#grimoire").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sheet]");
    if (b) openSheet(b.dataset.sheet);
  });
  qs("#phaseCard").addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step) { openStep(step.dataset.step); return; }
    const rmNom = e.target.closest("[data-remove-nom]");
    if (rmNom) { S.today.nominations.splice(+rmNom.dataset.removeNom, 1); render(); return; }
    const a = e.target.closest("[data-action]")?.dataset.action;
    if (a === "someoneDied") someoneDied();
    if (a === "startDay") doStartDay();
    if (a === "startNight") {
      if (!S.today.executed && !confirm("Nobody was executed today. Go to night anyway?")) return;
      startNight();
      render();
      window.scrollTo({ top: qs("#phaseCard").offsetTop - 10, behavior: "smooth" });
    }
    if (a === "recordNom") recordNomination();
    if (a === "execute") executeFlow();
  });

  // overlays
  qs("#textCard").addEventListener("click", onCardClick);
  qs("#playerSheet").addEventListener("click", onSheetClick);
  qs("#playerSheet").addEventListener("change", onSheetChange);
  qs("#tableView").addEventListener("click", (e) => {
    const b = e.target.closest("[data-table]");
    if (!b) return;
    if (b.dataset.table === "close") closeTable();
    else { TABLE = b.dataset.table; renderTable(); }
  });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redo(); return; }
    if (e.key !== "Escape") return;
    if (pickerIsOpen()) closePicker();
    else if (SHEET) closeSheet();
    else if (CARD) closeCard();
    else if (TABLE) closeTable();
  });
}

document.addEventListener("DOMContentLoaded", init);
