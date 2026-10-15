import { api } from "../api.js";
import { store } from "../store.js";
import { runtime } from "../runtime.js";
import { el, toast, copyText } from "../ui.js";
import { totalsFor } from "../scoring.js";

export const card = (title, ...children) => el("section", { class: "admin-section" }, [title ? el("h4", {}, title) : null, ...children]);
export const row = (...children) => el("div", { class: "admin-row" }, children);
export const button = (label, onclick, cls = "secondary-btn", extra = {}) => el("button", { type: "button", class: cls, onclick, ...extra }, label);

export function copyButton(text, label, done) {
  return button(label, async () => toast((await copyText(text)) ? done : "Couldn't copy - select it and copy manually", "success"));
}

export const nameOf = (sub) => store.state.profiles?.[sub]?.name || "Player";
export const teamNameOf = (teamId) => store.state.groups?.[teamId]?.name || "";

// Everyone who has ever done anything: a profile, a pick or a team membership.
export function allPlayerIds() {
  const s = store.state;
  const ids = new Set([...Object.keys(s.profiles || {}), ...Object.keys(s.predictionsByProfile || {}), ...Object.keys(s.bracketPicksByProfile || {}), ...Object.keys(s.profileTeams || {})]);
  ids.delete("guest");
  return [...ids].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
}

export function pointsAtEvent(sub) {
  const { event } = runtime;
  return event.key ? totalsFor(store.state, sub, event.matches, event.key).points : null;
}

export const picksCount = (sub) => Object.keys(store.state.predictionsByProfile?.[sub] || {}).length;

// Emails aren't in the shared document; the server lists them for global admins.
export const accounts = { loaded: false, loading: false, bySub: {}, pending: null };

// Load once and redraw when done. Sharing the pending promise matters: redrawing
// calls this again, and a fresh already-resolved promise would redraw forever.
export function needAccounts(rerender) {
  if (accounts.loaded || accounts.pending) return;
  accounts.pending = loadAccounts().finally(() => (accounts.pending = null));
  accounts.pending.then(rerender);
}

export async function loadAccounts() {
  accounts.loading = true;
  try {
    const { accounts: list } = await api.adminAccounts();
    accounts.bySub = Object.fromEntries(list.map((a) => [a.sub, a]));
    accounts.loaded = true;
  } catch {
    // Shown as "email unknown". Don't retry on every redraw - that would spin.
    accounts.error = true;
  } finally {
    accounts.loading = false;
    accounts.loaded = true;
  }
}

export function isSiteAdmin(sub) {
  if (sub === store.profileId && store.isGlobalAdmin) return true;
  const email = accounts.bySub[sub]?.email?.toLowerCase();
  return (store.state.globalAdminIds || []).includes(sub) || Boolean(email && (store.state.globalAdminEmails || []).includes(email));
}

export const isTeamAdmin = (sub, teamId) => (store.state.teamAdmins?.[teamId] || []).includes(sub);

export function ago(ms) {
  if (!ms) return "";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60 * 24) return "today";
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// store.mutate plus a confirmation toast once the server has accepted it.
export async function change(mutator, done) {
  const result = await store.mutate(mutator);
  if (result.ok && done) toast(done);
  return result;
}
