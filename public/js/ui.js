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
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Replace a node's children, skipping null/false - unlike replaceChildren(null),
// which would write the text "null" onto the page.
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
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
  document.querySelectorAll(".nav-btn").forEach((n) => {
    n.classList.remove("active");
    n.removeAttribute("aria-current");
  });
  $(tabId)?.classList.remove("hidden");
  button?.classList.add("active");
  button?.setAttribute("aria-current", "page");
  document.body.dataset.tab = tabId;
  document.dispatchEvent(new CustomEvent("tabchange", { detail: tabId }));
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

// A short confirmation that fades by itself ("Copied", "Team created").
export function toast(message, kind = "success") {
  let host = $("toasts");
  if (!host) {
    host = el("div", { id: "toasts", class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  const node = el("div", { class: `toast toast-${kind}` }, message);
  host.append(node);
  setTimeout(() => node.classList.add("toast-out"), 3200);
  setTimeout(() => node.remove(), 3700);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el("textarea", { "aria-hidden": "true", style: "position:fixed;opacity:0" }, text);
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

let modalCount = 0;

// An accessible dialog: labelled, closes on Escape / backdrop click, keeps Tab
// inside it, and puts focus back where it was. `render(body, close)` fills the
// body and may be called again by the caller to redraw.
export function showModal({ title, render, dismissible = true, onClose }) {
  const previouslyFocused = document.activeElement;
  modalCount += 1;
  const titleId = `modal-title-${modalCount}`;
  const body = el("div", { class: "modal-body" });
  const card = el("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId }, [el("h3", { id: titleId }, title), body]);
  const backdrop = el("div", { class: "modal-backdrop" }, card);
  document.body.classList.add("modal-open");

  const focusables = () => [...card.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled && n.offsetParent !== null);
  function onKey(e) {
    if (e.key === "Escape" && dismissible) return close();
    if (e.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    if (!document.querySelector(".modal-backdrop")) document.body.classList.remove("modal-open");
    previouslyFocused?.focus?.();
    onClose?.();
  }

  if (dismissible) backdrop.addEventListener("mousedown", (e) => e.target === backdrop && close());
  document.addEventListener("keydown", onKey);
  render(body, close);
  document.body.append(backdrop);
  (body.querySelector("[autofocus], input, select, textarea, button") || card).focus?.();
  return { close, body };
}

// Resolves true/false. Destructive actions use this instead of acting on one click.
export function confirmDialog(message, { title = "Are you sure?", confirmLabel = "Confirm", danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value, close) => {
      answered = true;
      close();
      resolve(value);
    };
    showModal({
      title,
      onClose: () => !answered && resolve(false),
      render: (body, close) => {
        body.replaceChildren(
          el("p", {}, message),
          el("div", { class: "modal-actions" }, [
            el("button", { class: danger ? "danger-btn" : "load-btn", onclick: () => answer(true, close), autofocus: true }, confirmLabel),
            el("button", { class: "secondary-btn", onclick: () => answer(false, close) }, "Cancel")
          ])
        );
      }
    });
  });
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

// "3:18 PM" today, "Sat 3:18 PM" otherwise - no seconds, no date noise.
export function formatMatchTime(ms, now = Date.now()) {
  if (!ms) return "";
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === new Date(now).toDateString() ? time : `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
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

export function teamNumbers(alliance) {
  return (alliance?.team_keys || []).map((k) => k.replace("frc", ""));
}

export function teamList(alliance) {
  return teamNumbers(alliance).join(", ");
}
