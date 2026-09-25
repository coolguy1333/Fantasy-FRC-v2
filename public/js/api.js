let currentIdToken = null;

export function setAuthToken(token) {
  currentIdToken = token || null;
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (currentIdToken) headers.Authorization = `Bearer ${currentIdToken}`;
  const res = await fetch(path, { ...options, headers });
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
  putState: (payload) => request("/api/state", { method: "PUT", body: JSON.stringify({ payload }) }),
  health: () => request("/api/health"),

  tbaEventsForYear: (year) => request(`/api/tba/events/${year}/simple`),
  tbaEventMatches: (eventKey) => request(`/api/tba/event/${eventKey}/matches`),
  tbaEventTeams: (eventKey) => request(`/api/tba/event/${eventKey}/teams/simple`),
  tbaEventAlliances: (eventKey) => request(`/api/tba/event/${eventKey}/alliances`)
};
