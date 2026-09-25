import { api, setAuthToken } from "./api.js";
import { GUEST_PROFILE_ID, POLL_INTERVAL_MS } from "./constants.js";

const GUEST_STORAGE_KEY = "ffrc_guest_state_v1";

function emptyState() {
  return {
    profiles: {},
    predictionsByProfile: {},
    groups: {},
    profileTeams: {},
    teamAdmins: {},
    teamInviteCodes: {},
    globalAdminIds: [],
    globalAdminEmails: [],
    eventSummaries: {},
    bracketPicksByProfile: {},
    bracketScoreByProfile: {},
    pointAdjustments: {},
    adminByEvent: {},
    profileSetupDone: {},
    showAllEventsInCatalog: false,
    feedback: []
  };
}

function loadGuestState() {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore corrupt local storage */
  }
  return emptyState();
}

function saveGuestState(state) {
  try {
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage may be unavailable (private browsing, quota) - fail silently */
  }
}

class Store {
  constructor() {
    this.user = null; // { sub, email, name, picture } | null
    this.isGlobalAdmin = false;
    this.state = emptyState();
    this.updatedAt = 0;
    this.listeners = new Set();
    this._pollHandle = null;
    this._saveInFlight = null;
    this._saveQueued = false;
  }

  get profileId() {
    return this.user ? this.user.sub : GUEST_PROFILE_ID;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  async signIn(idToken) {
    setAuthToken(idToken);
    const result = await api.verifyGoogle(idToken);
    this.user = result.user;
    this.isGlobalAdmin = Boolean(result.isGlobalAdmin);
    await this.loadRemote();
    this.startPolling();
    return this.user;
  }

  signOut() {
    setAuthToken(null);
    this.user = null;
    this.isGlobalAdmin = false;
    this.stopPolling();
    this.state = loadGuestState();
    this.emit();
  }

  enterGuestMode() {
    this.user = null;
    setAuthToken(null);
    this.state = loadGuestState();
    this.emit();
  }

  async loadRemote() {
    const { payload, updatedAt } = await api.getState();
    this.state = payload;
    this.updatedAt = updatedAt;
    this.emit();
  }

  startPolling() {
    this.stopPolling();
    this._pollHandle = setInterval(() => {
      if (!this.user || this._saveInFlight) return;
      this.loadRemote().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  stopPolling() {
    if (this._pollHandle) clearInterval(this._pollHandle);
    this._pollHandle = null;
  }

  // Apply `mutator(state)` locally, re-render immediately, then persist.
  // Signed-in writes go to the server; guest writes go to localStorage.
  async mutate(mutator) {
    mutator(this.state);
    this.emit();
    if (!this.user) {
      saveGuestState(this.state);
      return { ok: true };
    }
    return this._persistRemote();
  }

  async _persistRemote() {
    if (this._saveInFlight) {
      this._saveQueued = true;
      return this._saveInFlight;
    }
    this._saveInFlight = (async () => {
      try {
        const result = await api.putState(this.state);
        this.updatedAt = result.updatedAt;
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err };
      } finally {
        this._saveInFlight = null;
        if (this._saveQueued) {
          this._saveQueued = false;
          this._persistRemote();
        }
      }
    })();
    return this._saveInFlight;
  }
}

export const store = new Store();
