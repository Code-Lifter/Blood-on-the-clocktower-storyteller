// ===== ui.js =====
// Small reusable pieces: escaping, icons, modals and the picker.

import { roleIcon, roleName, getRole } from "./data.js";

export const qs = (sel, scope = document) => scope.querySelector(sel);
export const qsa = (sel, scope = document) => Array.from(scope.querySelectorAll(sel));

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** <img> for a character icon that hides itself if the image is missing. */
export function iconHtml(id, script, alignment = "", cls = "token-sm") {
  if (!id) return `<span class="${cls} token-blank"></span>`;
  return `<img class="${cls}" src="${esc(roleIcon(id, script, alignment))}" alt="${esc(roleName(id, script))}" loading="lazy" onerror="this.classList.add('token-missing');this.removeAttribute('src')">`;
}

let openCount = 0;
export function showModal(el, show) {
  const was = el.classList.contains("is-open");
  el.classList.toggle("is-open", show);
  el.setAttribute("aria-hidden", String(!show));
  if (show && !was) openCount++;
  if (!show && was) openCount = Math.max(0, openCount - 1);
  document.body.classList.toggle("modal-open", openCount > 0);
}

// ------------------------------------------------------------------ picker
// items: [{ value, label, sub, icon, disabled }]
// opts:  { title, max (1 = pick one and close), min, selected: [values], onDone(values) }

let pickerState = null;

export function openPicker(items, opts) {
  pickerState = { items, opts, selected: new Set(opts.selected || []) };
  qs("#pickerTitle").textContent = opts.title || "Pick";
  qs("#pickerSearch").value = "";
  qs("#pickerSearch").hidden = items.length < 8;
  renderPickerList();
  showModal(qs("#picker"), true);
  if (items.length >= 8 && window.matchMedia("(pointer:fine)").matches) qs("#pickerSearch").focus();
}

function renderPickerList() {
  const { items, opts, selected } = pickerState;
  const max = opts.max ?? 1;
  const list = qs("#pickerList");
  list.innerHTML = items.map((it) => `
    <div class="picker-item ${selected.has(it.value) ? "selected" : ""} ${it.disabled ? "disabled" : ""}" data-value="${esc(it.value)}" role="option" aria-selected="${selected.has(it.value)}">
      <span class="picker-main">${it.icon || ""}<span><span class="picker-label">${esc(it.label)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ""}</span></span>
      <span class="picker-tick">${selected.has(it.value) ? "✓" : ""}</span>
    </div>`).join("") || `<p class="muted">Nothing to pick.</p>`;
  qs("#pickerOk").hidden = max === 1;
  qs("#pickerCount").textContent = max === 1 ? "" : `${selected.size} of ${max === Infinity ? "any" : max}`;
}

export function initPicker() {
  qs("#pickerList").addEventListener("click", (e) => {
    const row = e.target.closest(".picker-item");
    if (!row || row.classList.contains("disabled") || !pickerState) return;
    const v = row.dataset.value;
    const { opts, selected } = pickerState;
    const max = opts.max ?? 1;
    if (max === 1) {
      finishPicker([v]);
      return;
    }
    if (selected.has(v)) selected.delete(v);
    else if (selected.size < max) selected.add(v);
    renderPickerList();
  });
  qs("#pickerOk").addEventListener("click", () => pickerState && finishPicker([...pickerState.selected]));
  qs("#pickerCancel").addEventListener("click", closePicker);
  qs("#pickerSearch").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    qsa(".picker-item").forEach((el) => { el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none"; });
  });
}

function finishPicker(values) {
  const cb = pickerState?.opts.onDone;
  closePicker();
  if (cb) cb(values);
}

export function closePicker() {
  pickerState = null;
  showModal(qs("#picker"), false);
}

export const pickerIsOpen = () => !!pickerState;

/** Picker items for a list of character ids. */
export function characterItems(ids, script) {
  return ids.map((id) => {
    const r = getRole(id, script);
    return { value: id, label: r?.name || id, sub: r?.team ? cap(r.team) : "", icon: iconHtml(id, script, "", "token-xs") };
  });
}

export const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
