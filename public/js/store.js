import { api, setAuthToken } from "./api.js";
import { GUEST_PROFILE_ID, POLL_INTERVAL_MS } from "./constants.js";

const GUEST_STORAGE_KEY = "ffrc_guest_state_v1";
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;

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
    this._retryHandle = null;
    this._retryDelay = RETRY_BASE_MS;

    // dirty = true means this.state has local changes the server hasn't
    // confirmed yet. While dirty, polling must never overwrite this.state -
    // that would silently discard whatever the user just did.
    this.dirty = false;
    // null | "session_expired" | "save_failed" - surfaced by the UI so a
    // failed save is never just silent.
    this.syncError = null;
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
    if (this.dirty) {
      // There's a local change from before this sign-in (e.g. the previous
      // token expired mid-session) - push it rather than pulling the server's
      // version over it and losing it.
      await this._persistRemote();
    } else {
      await this.loadRemote();
    }
    this.startPolling();
    return this.user;
  }

  signOut() {
    setAuthToken(null);
    this.user = null;
    this.isGlobalAdmin = false;
    this.dirty = false;
    this.syncError = null;
    this._clearRetry();
    this.stopPolling();
    this.state = loadGuestState();
    this.emit();
  }

  enterGuestMode() {
    this.user = null;
    setAuthToken(null);
    this.dirty = false;
    this.syncError = null;
    this._clearRetry();
    this.state = loadGuestState();
    this.emit();
  }

  async loadRemote() {
    if (this.dirty) return; // never clobber an unsaved local change
    const { payload, updatedAt } = await api.getState();
    this.state = payload;
    this.updatedAt = updatedAt;
    this.emit();
  }

  startPolling() {
    this.stopPolling();
    this._pollHandle = setInterval(() => {
      if (!this.user || this._saveInFlight || this.dirty) return;
      this.loadRemote().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  stopPolling() {
    if (this._pollHandle) clearInterval(this._pollHandle);
    this._pollHandle = null;
  }

  _clearRetry() {
    if (this._retryHandle) clearTimeout(this._retryHandle);
    this._retryHandle = null;
    this._retryDelay = RETRY_BASE_MS;
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
    this.dirty = true;
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
        this.dirty = false;
        this.syncError = null;
        this._clearRetry();
        this.emit();
        return { ok: true };
      } catch (err) {
        this.syncError = err?.status === 401 ? "session_expired" : "save_failed";
        this.emit();
        this._scheduleRetry();
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

  _scheduleRetry() {
    if (this._retryHandle) return; // already scheduled
    this._retryHandle = setTimeout(() => {
      this._retryHandle = null;
      this._retryDelay = Math.min(this._retryDelay * 2, RETRY_MAX_MS);
      if (this.user && this.dirty) this._persistRemote();
    }, this._retryDelay);
  }
}

export const store = new Store();
