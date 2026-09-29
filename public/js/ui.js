import { LOCK_WINDOW_MS } from "./constants.js";
import { isDoubleElimEvent, setNumberOf } from "./scoring.js";

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

// Views re-render on a timer and on every sync. Rebuilding the DOM while
// someone is typing in a field wipes what they typed and steals focus, so a
// render requested during editing is held back and flushed once they leave the
// field. (If focus moved to a button, that button's own click re-renders.)
export function isEditing(...containers) {
  const active = document.activeElement;
  if (!active || !active.matches?.("input:not([type=checkbox]):not([type=radio]), textarea, select")) return false;
  return containers.some((c) => c && c.contains(active));
}

export function makeGuardedRender(getContainers, renderFn) {
  let pending = false;
  const guarded = () => {
    if (isEditing(...getContainers())) {
      pending = true;
      return;
    }
    pending = false;
    renderFn();
  };
  document.addEventListener("focusout", (e) => {
    if (pending) setTimeout(guarded, e.relatedTarget ? 500 : 0);
  });
  return guarded;
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
  const set = setNumberOf(match);
  const replay = match.match_number > 1 ? " (replay)" : "";
  switch (match.comp_level) {
    case "qm":
      return `Qual ${match.match_number}`;
    case "pm":
      return "Practice";
    case "f":
      return `Final ${match.match_number}`;
    case "sf":
      // 2023+ double elimination numbers every bracket game by set; older events had two semifinal sets.
      return isDoubleElimEvent(match) ? `Playoff Match ${set ?? match.match_number}${replay}` : `Semifinal ${set ?? ""} - Match ${match.match_number}`.replace("  ", " ");
    case "qf":
      return `Quarterfinal ${set ?? ""} - Match ${match.match_number}`.replace("  ", " ");
    case "ef":
      return `Eighthfinal ${set ?? ""} - Match ${match.match_number}`.replace("  ", " ");
    default:
      return `${match.comp_level} ${match.match_number}`;
  }
}

export function teamList(alliance) {
  return (alliance?.team_keys || []).map((k) => k.replace("frc", "")).join(", ");
}
