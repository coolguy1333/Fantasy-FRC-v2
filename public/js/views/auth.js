import { store } from "../store.js";
import { notice } from "../ui.js";

const TOKEN_KEY = "ffrc_id_token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const RENEWAL_THROTTLE_MS = 60 * 1000;
const SCRIPT_WAIT_WARNING_TRIES = 75; // x 200ms = 15s

let googleReady = false;
let onSignedIn = () => {};
let refreshTimer = null;
let lastRenewalAt = 0;

// Google ID tokens are short-lived (~1h) and only held in memory by the store,
// so without this a page refresh or the hour rolling over signs the user out.
// The token is kept in sessionStorage (this tab only) purely to survive
// reloads; One Tap auto-select handles returning visits and renewals.
function tokenExpiryMs(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Number(payload.exp) * 1000;
  } catch {
    return 0;
  }
}

function readStoredToken() {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token && tokenExpiryMs(token) - Date.now() > 60 * 1000) return token;
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  return null;
}

function storeToken(token) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

function scheduleRefresh(token) {
  clearTimeout(refreshTimer);
  const delay = Math.max(tokenExpiryMs(token) - Date.now() - REFRESH_MARGIN_MS, 30 * 1000);
  refreshTimer = setTimeout(requestRenewal, delay);
}

// Asks Google for a fresh ID token; with auto-select this is silent when the
// person is still signed in to Google, and shows One Tap otherwise.
function requestRenewal() {
  if (!googleReady || Date.now() - lastRenewalAt < RENEWAL_THROTTLE_MS) return;
  lastRenewalAt = Date.now();
  window.google.accounts.id.prompt();
}

function describe(err) {
  const detail = err?.detail?.detail;
  return detail ? `${err.message}: ${detail}` : err?.message || "unknown error";
}

function renderButton(hostId) {
  const host = document.getElementById(hostId);
  if (!host || !window.google?.accounts?.id) return;
  host.innerHTML = "";
  window.google.accounts.id.renderButton(host, { theme: "outline", size: "large", text: "signin_with" });
}

// Returns null on success, or the error. `restoring` is a sign-in attempt with a
// token we saved earlier, where failing quietly and falling back to a fresh
// prompt is the right thing (unless the server just couldn't be reached).
async function handleCredential(response, { restoring = false } = {}) {
  const wasSignedIn = Boolean(store.user);
  try {
    await store.signIn(response.credential);
  } catch (err) {
    console.error("Sign-in failed:", err);
    // Only a token the server actually rejected is worth forgetting.
    if (err?.status === 401) clearToken();
    if (!restoring || err?.status !== 401) {
      notice("authNotice", `Sign-in failed (${describe(err)}). Try again, or keep playing as a guest.`, "error");
    }
    return err;
  }
  notice("authNotice", "");
  storeToken(response.credential);
  scheduleRefresh(response.credential);
  if (!wasSignedIn) onSignedIn();
  return null;
}

async function restoreSession() {
  const stored = readStoredToken();
  if (stored && !(await handleCredential({ credential: stored }, { restoring: true }))) return;
  window.google.accounts.id.prompt();
}

export function initAuth(clientId, { onSignIn } = {}) {
  onSignedIn = onSignIn || (() => {});
  store.enterGuestMode();
  if (!clientId) return;

  // A save or poll that gets a 401 means the token expired: ask for a new one.
  store.subscribe(() => {
    if (store.syncError === "session_expired") requestRenewal();
  });

  let tries = 0;
  const tryInit = () => {
    if (!window.google?.accounts?.id) {
      tries += 1;
      if (tries === SCRIPT_WAIT_WARNING_TRIES) {
        notice(
          "authNotice",
          "Google sign-in hasn't loaded. An ad blocker or network filter may be blocking accounts.google.com - you can keep playing as a guest.",
          "error"
        );
      }
      setTimeout(tryInit, 200);
      return;
    }
    if (tries >= SCRIPT_WAIT_WARNING_TRIES) notice("authNotice", "");
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, auto_select: true });
    googleReady = true;
    renderButton("googleSignInHost");
    renderButton("googleGateHost");
    restoreSession();
  };
  tryInit();
}

export function signOut() {
  clearTimeout(refreshTimer);
  clearToken();
  if (googleReady) window.google?.accounts?.id?.disableAutoSelect();
  store.signOut();
}
