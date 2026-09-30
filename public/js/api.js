// A request that never answers would otherwise wedge the save queue forever.
const REQUEST_TIMEOUT_MS = 20000;

// The browser sends the session cookie itself (same origin), so there is no
// token to manage here.
async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  const init = { ...options, headers };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const res = await fetch(path, init);
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
  return data;
}

export const api = {
  runtimeConfig: () => request("/api/runtime-config"),
  session: () => request("/api/auth/session"),
  verifyGoogle: (idToken) => request("/api/auth/verify", { method: "POST", body: JSON.stringify({ idToken }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  // With `since`, the server answers { unchanged: true } if that is still the current version.
  getState: (since) => request(since === undefined ? "/api/state" : `/api/state?since=${encodeURIComponent(since)}`),
  // updatedAt is the version this payload was based on; the server answers 409 if it moved on.
  putState: (payload, updatedAt) => request("/api/state", { method: "PUT", body: JSON.stringify({ payload, updatedAt }) }),
  // Team codes are checked by the server: preview shows which team a code is for, join does it.
  previewTeam: (code) => request("/api/teams/preview", { method: "POST", body: JSON.stringify({ code }) }),
  joinTeam: (code) => request("/api/teams/join", { method: "POST", body: JSON.stringify({ code }) }),
  sendFeedback: (entry) => request("/api/feedback", { method: "POST", body: JSON.stringify(entry) }),

  tbaEventsForYear: (year) => request(`/api/tba/events/${year}/simple`),
  tbaEventMatches: (eventKey) => request(`/api/tba/event/${eventKey}/matches`),
  tbaEventTeams: (eventKey) => request(`/api/tba/event/${eventKey}/teams/simple`),
  tbaEventAlliances: (eventKey) => request(`/api/tba/event/${eventKey}/alliances`)
};
