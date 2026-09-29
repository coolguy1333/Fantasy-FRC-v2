import { api } from "./api.js";
import { GUEST_PROFILE_ID, POLL_INTERVAL_MS } from "./constants.js";

const GUEST_STORAGE_KEY = "ffrc_guest_state_v1";
const RETRY_BASE_MS = 5000;
const RETRY_MAX_MS = 60000;
const MAX_CONFLICT_RETRIES = 4;
const REJECTION_BANNER_MS = 8000;

// 4xx answers other than "sign in again", "slow down" and "someone else saved
// first" mean the server will never accept this change, so retrying is pointless.
function isRejection(err) {
  const status = err?.status;
  return status >= 400 && status < 500 && ![401, 408, 409, 429].includes(status);
}

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

// Picks made as a guest, so signing in can offer to bring them along.
export function readGuestPicks() {
  const guest = loadGuestState();
  const own = (domain) => guest[domain]?.[GUEST_PROFILE_ID] || {};
  return { predictions: own("predictionsByProfile"), bracketPicks: own("bracketPicksByProfile"), bracketScores: own("bracketScoreByProfile") };
}

export function removeGuestPicks({ predictions = [], bracketPicks = [], bracketScores = [] }) {
  const guest = loadGuestState();
  const drop = (domain, keys) => keys.forEach((k) => guest[domain]?.[GUEST_PROFILE_ID] && delete guest[domain][GUEST_PROFILE_ID][k]);
  drop("predictionsByProfile", predictions);
  drop("bracketPicksByProfile", bracketPicks);
  drop("bracketScoreByProfile", bracketScores);
  saveGuestState(guest);
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
    this._retryHandle = null;
    this._retryDelay = RETRY_BASE_MS;

    // Changes made since the server last confirmed a save, oldest first. If
    // someone else saved in between, the server answers 409 and we reload the
    // fresh document and re-apply these on top of it.
    this.pending = [];
    // dirty = true means this.state has local changes the server hasn't
    // confirmed yet. While dirty, polling must never overwrite this.state -
    // that would silently discard whatever the user just did.
    this.dirty = false;
    // null | "session_expired" | "save_failed" | "rejected" - surfaced by the UI
    // so a failed save is never just silent. syncErrorCode is the server's reason.
    this.syncError = null;
    this.syncErrorCode = null;
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

  _resetSync() {
    this.pending = [];
    this.dirty = false;
    this.syncError = null;
    this.syncErrorCode = null;
    this._clearRetry();
  }

  // Called once at startup: is there already a session cookie from an earlier visit?
  async restoreSession() {
    const result = await api.session();
    if (!result.user) return false;
    this.user = result.user;
    this.isGlobalAdmin = Boolean(result.isGlobalAdmin);
    if (!(await this._loadAfterSignIn(true))) return false;
    this.startPolling();
    return true;
  }

  // Load the document right after we know who someone is. A hiccup here must not
  // make a signed-in person look signed out, so it becomes a retrying banner - only
  // a 401 (the session vanished between the two calls) means they aren't signed in.
  async _loadAfterSignIn(force) {
    try {
      await this.loadRemote({ force });
    } catch (err) {
      if (err?.status === 401) {
        this.user = null;
        this.isGlobalAdmin = false;
        return false;
      }
      this.syncError = "load_failed";
      this.emit();
    }
    return true;
  }

  // Google vouches for the person once; the server answers by setting a
  // long-lived session cookie, so this only happens when signed out.
  async signIn(idToken) {
    const previous = { user: this.user, isGlobalAdmin: this.isGlobalAdmin };
    const result = await api.verifyGoogle(idToken); // if this fails nothing has changed
    if (previous.user && previous.user.sub !== result.user.sub) this._resetSync(); // never replay one account's changes onto another
    this.user = result.user;
    this.isGlobalAdmin = Boolean(result.isGlobalAdmin);
    if (this.dirty) {
      // A local change from before this sign-in (e.g. the session ended
      // mid-use) - push it rather than pulling the server's version over it.
      await this._persistRemote();
    } else if (!(await this._loadAfterSignIn(!previous.user))) {
      this.user = previous.user;
      this.isGlobalAdmin = previous.isGlobalAdmin;
      throw new Error("session_not_established");
    }
    this.startPolling();
    return this.user;
  }

  signOut() {
    api.logout().catch(() => {}); // revoke the session on the server; the local reset below doesn't depend on it
    this.user = null;
    this.isGlobalAdmin = false;
    this._resetSync();
    this.stopPolling();
    this.updatedAt = 0;
    this.state = loadGuestState();
    this.emit();
  }

  enterGuestMode() {
    this.user = null;
    this._resetSync();
    this.state = loadGuestState();
    this.emit();
  }

  // Pull the server's version now (after something the server changed on our behalf, like joining a team).
  async reload() {
    if (this.dirty) await this._persistRemote();
    if (!this.dirty) await this.loadRemote({ force: true });
  }

  // "guest" | "saving" | "saved" | "error" - what the save indicator shows.
  get status() {
    if (!this.user) return "guest";
    if (this.syncError === "save_failed" || this.syncError === "session_expired" || this.syncError === "load_failed") return "error";
    if (this.dirty || this._saveInFlight) return "saving";
    return "saved";
  }

  async loadRemote({ force = false } = {}) {
    if (this.dirty) return; // never clobber an unsaved local change
    const result = await api.getState(force ? undefined : this.updatedAt);
    // Something may have changed while the request was in flight.
    if (this.dirty || !this.user) return;
    const recovered = this.syncError === "session_expired" || this.syncError === "save_failed" || this.syncError === "load_failed";
    if (recovered) {
      this.syncError = null;
      this.syncErrorCode = null;
    }
    if (result.unchanged) {
      if (recovered) this.emit();
      return;
    }
    if (force || result.updatedAt !== this.updatedAt) {
      this.state = result.payload;
      this.updatedAt = result.updatedAt;
      this.emit();
    } else if (recovered) {
      this.emit();
    }
  }

  // Poll while the tab is in view, and catch up the moment it comes back.
  startPolling() {
    this.stopPolling();
    const poll = () => {
      if (document.hidden || !this.user || this._saveInFlight || this.dirty) return;
      this.loadRemote().catch((err) => {
        if (err?.status === 401) {
          this.syncError = "session_expired";
          this.emit();
        }
      });
    };
    this._pollHandle = setInterval(poll, POLL_INTERVAL_MS);
    this._onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", this._onVisible);
  }

  stopPolling() {
    if (this._pollHandle) clearInterval(this._pollHandle);
    this._pollHandle = null;
    if (this._onVisible) document.removeEventListener("visibilitychange", this._onVisible);
    this._onVisible = null;
  }

  _clearRetry() {
    if (this._retryHandle) clearTimeout(this._retryHandle);
    this._retryHandle = null;
    this._retryDelay = RETRY_BASE_MS;
  }

  // Apply `mutator(state)` locally, re-render immediately, then persist.
  // Signed-in writes go to the server; guest writes go to localStorage.
  // A mutator must only depend on the state it is handed (it may be re-applied
  // to a newer copy of the document after a conflict).
  async mutate(mutator) {
    mutator(this.state);
    this.emit();
    if (!this.user) {
      saveGuestState(this.state);
      return { ok: true };
    }
    this.pending.push(mutator);
    this.dirty = true;
    return this._persistRemote();
  }

  _persistRemote() {
    if (!this._saveInFlight) {
      this._saveInFlight = this._flush().finally(() => {
        this._saveInFlight = null;
      });
    }
    return this._saveInFlight;
  }

  async _flush() {
    for (let conflicts = 0; conflicts <= MAX_CONFLICT_RETRIES; ) {
      const sent = this.pending.length;
      try {
        const result = await api.putState(this.state, this.updatedAt);
        this.updatedAt = result.updatedAt;
        this.pending.splice(0, sent);
        this.dirty = this.pending.length > 0;
        this.syncError = null;
        this.syncErrorCode = null;
        this._clearRetry();
        this.emit();
        if (!this.dirty) return { ok: true };
        // More changes arrived while this save was in flight: send them too.
      } catch (err) {
        if (err?.status !== 409) return this._onSaveError(err);
        conflicts += 1;
        try {
          await this._rebase();
        } catch (rebaseErr) {
          return this._onSaveError(rebaseErr);
        }
      }
    }
    return this._onSaveError(new Error("too_many_conflicts"));
  }

  async _rebase() {
    const { payload, updatedAt } = await api.getState();
    this.state = payload;
    this.updatedAt = updatedAt;
    for (const mutator of this.pending) {
      try {
        mutator(this.state);
      } catch (err) {
        console.warn("Could not re-apply a pending change:", err);
      }
    }
    this.emit();
  }

  async _onSaveError(err) {
    if (isRejection(err)) {
      // The server refuses this change outright (e.g. the match locked while it
      // was queued). Drop it and show the real state instead of retrying forever.
      this.pending = [];
      this.dirty = false;
      this._clearRetry();
      this.syncError = "rejected";
      this.syncErrorCode = err.message;
      setTimeout(() => {
        if (this.syncError === "rejected") {
          this.syncError = null;
          this.emit();
        }
      }, REJECTION_BANNER_MS);
      try {
        await this.loadRemote({ force: true });
      } catch {
        this.emit();
      }
      return { ok: false, rejected: true, error: err };
    }
    this.syncError = err?.status === 401 ? "session_expired" : "save_failed";
    this.syncErrorCode = err?.message || null;
    this.emit();
    this._scheduleRetry();
    return { ok: false, error: err };
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
