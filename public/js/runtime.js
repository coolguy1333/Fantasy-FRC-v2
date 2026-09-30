// Small shared state that isn't part of the synced document: what the server
// says is configured, and which event is on screen (so the Score and
// Leaderboard tabs update the moment someone picks one).

export const runtime = {
  config: {}, // GET /api/runtime-config
  event: { key: "", name: "", matches: [], status: "idle" } // status: idle | loading | error | ready
};

const listeners = new Set();

export function onEventChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setEvent(patch) {
  Object.assign(runtime.event, patch);
  for (const fn of listeners) fn(runtime.event);
}
