let currentIdToken = null;

export function setAuthToken(token) {
  currentIdToken = token || null;
}

export function getAuthToken() {
  return currentIdToken;
}

// A request that never answers would otherwise wedge the save queue forever.
const REQUEST_TIMEOUT_MS = 20000;

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (currentIdToken) headers.Authorization = `Bearer ${currentIdToken}`;
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
  verifyGoogle: (idToken) => request("/api/auth/verify", { method: "POST", body: JSON.stringify({ idToken }) }),
  getState: () => request("/api/state"),
  // updatedAt is the version this payload was based on; the server answers 409 if it moved on.
  putState: (payload, updatedAt) => request("/api/state", { method: "PUT", body: JSON.stringify({ payload, updatedAt }) }),
  sendFeedback: (entry) => request("/api/feedback", { method: "POST", body: JSON.stringify(entry) }),

  tbaEventsForYear: (year) => request(`/api/tba/events/${year}/simple`),
  tbaEventMatches: (eventKey) => request(`/api/tba/event/${eventKey}/matches`),
  tbaEventTeams: (eventKey) => request(`/api/tba/event/${eventKey}/teams/simple`),
  tbaEventAlliances: (eventKey) => request(`/api/tba/event/${eventKey}/alliances`)
};
