import { LOCK_WINDOW_MS } from "./constants.js";

export const $ = (id) => document.getElementById(id);

// Every child is inserted as a text node (or appended as an existing Node) -
// never as raw HTML - so content built from user-supplied strings (profile
// names, feedback text, team names, ...) can never be interpreted as markup.
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function showTab(tabId, button) {
  document.querySelectorAll(".tab-panel").forEach((n) => n.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach((n) => n.classList.remove("active"));
  $(tabId)?.classList.remove("hidden");
  button?.classList.add("active");
}

export function notice(containerId, message, kind = "info") {
  const node = $(containerId);
  if (!node) return;
  if (!message) {
    node.classList.add("hidden");
    node.textContent = "";
    return;
  }
  node.classList.remove("hidden");
  node.textContent = message;
  node.className = `notice notice-${kind}`;
}

export function openModal(id) {
  $(id)?.classList.remove("hidden");
}

export function closeModal(id) {
  $(id)?.classList.add("hidden");
}

export function matchStartMs(match) {
  const t = match.predicted_time || match.time;
  return t ? t * 1000 : null;
}

export function isLocked(match, now = Date.now()) {
  const start = matchStartMs(match);
  if (!start) return false;
  return now >= start - LOCK_WINDOW_MS;
}

export function msUntilLock(match, now = Date.now()) {
  const start = matchStartMs(match);
  if (!start) return null;
  return start - LOCK_WINDOW_MS - now;
}

export function formatCountdown(ms) {
  if (ms === null || ms < 0) return "";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function matchLabel(match) {
  const level = { qm: "Qual", ef: "Eighth", qf: "Quarter", sf: "Playoff", f: "Final" }[match.comp_level] || match.comp_level;
  if (match.comp_level === "pm") return "Practice";
  return `${level} ${match.match_number}`;
}

export function teamList(alliance) {
  return (alliance?.team_keys || []).map((k) => k.replace("frc", "")).join(", ");
}
