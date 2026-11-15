import { runtime } from "./runtime.js";

// Every API answer says which build of the app the server is running. If it isn't
// the one this page loaded, a deploy happened: tell the page once ("appupdate").
let updateAnnounced = false;
function checkBuild(res) {
  const serverBuild = res.headers.get("X-App-Build");
  const mine = runtime.config.build;
  if (updateAnnounced || !serverBuild || !mine || serverBuild === mine) return;
  updateAnnounced = true;
  document.dispatchEvent(new CustomEvent("appupdate", { detail: serverBuild }));
}

// A request that never answers would otherwise wedge the save queue forever.
const REQUEST_TIMEOUT_MS = 20000;

// The browser sends the session cookie itself (same origin), so there is no
// token to manage here.
async function request(path, options = {}, { withMeta = false } = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const init = { ...options, headers };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(path, init);
  checkBuild(res);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `request_failed_${res.status}`);
    err.status = res.status;
    err.detail = data;
    throw err;
  }
  if (!withMeta) return data;
  // TBA data can be served from the server's last good copy while TBA is down.
  return { data, asOf: Number(res.headers.get("X-Data-As-Of")) || Date.now() };
}

export const api = {
  runtimeConfig: () => request("/api/runtime-config"),
  session: () => request("/api/auth/session"),
  verifyGoogle: (idToken) => request("/api/auth/verify", { method: "POST", body: JSON.stringify({ idToken }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  // With `since`, the server answers { unchanged: true } if that is still the current version,
  // or - with delta - { patch } holding just what changed since then. `admin` is the role
  // our copy was built for; if it changed, the server sends the whole document instead.
  getState: (since, { delta = false, admin = false } = {}) =>
    request(since === undefined ? "/api/state" : `/api/state?since=${encodeURIComponent(since)}${delta ? `&delta=1&admin=${admin ? 1 : 0}` : ""}`),
  // updatedAt is the version this was based on; the server answers 409 if it moved on.
  putState: (payload, updatedAt) => request("/api/state", { method: "PUT", body: JSON.stringify({ payload, updatedAt }) }),
  patchState: (patch, updatedAt) => request("/api/state", { method: "PATCH", body: JSON.stringify({ patch, updatedAt }) }),
  // Team codes are checked by the server: preview shows which team a code is for, join does it.
  previewTeam: (code) => request("/api/teams/preview", { method: "POST", body: JSON.stringify({ code }) }),
  joinTeam: (code) => request("/api/teams/join", { method: "POST", body: JSON.stringify({ code }) }),
  // Global admin tools.
  claimAdmin: (code) => request("/api/admin/claim", { method: "POST", body: JSON.stringify({ code }) }),
  adminAccounts: () => request("/api/admin/accounts"),
  revokeSessions: (sub) => request("/api/admin/revoke-sessions", { method: "POST", body: JSON.stringify({ sub }) }),
  sendFeedback: (entry) => request("/api/feedback", { method: "POST", body: JSON.stringify(entry) }),

  tbaEventsForYear: (year) => request(`/api/tba/events/${year}/simple`),
  tbaEventMatches: (eventKey) => request(`/api/tba/event/${eventKey}/matches`),
  // { data, asOf } - asOf is when the server last got this from TBA.
  tbaEventMatchesWithAge: (eventKey) => request(`/api/tba/event/${eventKey}/matches`, {}, { withMeta: true }),
  tbaEventTeams: (eventKey) => request(`/api/tba/event/${eventKey}/teams/simple`),
  tbaEventAlliances: (eventKey) => request(`/api/tba/event/${eventKey}/alliances`)
};
