import { store } from "../store.js";

const TOKEN_KEY = "ffrc_id_token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let googleReady = false;
let onSignedIn = () => {};
let refreshTimer = null;

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
  refreshTimer = setTimeout(() => window.google?.accounts?.id?.prompt(), delay);
}

function renderButton(hostId) {
  const host = document.getElementById(hostId);
  if (!host || !window.google?.accounts?.id) return;
  host.innerHTML = "";
  window.google.accounts.id.renderButton(host, { theme: "outline", size: "large", text: "signin_with" });
}

async function handleCredential(response) {
  const wasSignedIn = Boolean(store.user);
  try {
    await store.signIn(response.credential);
    storeToken(response.credential);
    scheduleRefresh(response.credential);
    if (!wasSignedIn) onSignedIn();
    return true;
  } catch (err) {
    console.error("Sign-in failed:", err);
    clearToken();
    return false;
  }
}

async function restoreSession() {
  const stored = readStoredToken();
  if (stored && (await handleCredential({ credential: stored }))) return;
  window.google.accounts.id.prompt();
}

export function initAuth(clientId, { onSignIn } = {}) {
  onSignedIn = onSignIn || (() => {});
  store.enterGuestMode();
  if (!clientId) return;
  const tryInit = () => {
    if (!window.google?.accounts?.id) {
      setTimeout(tryInit, 200);
      return;
    }
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
