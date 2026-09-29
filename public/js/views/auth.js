import { store } from "../store.js";
import { notice } from "../ui.js";

const SCRIPT_WAIT_WARNING_TRIES = 75; // x 200ms = 15s
const RENEWAL_THROTTLE_MS = 60 * 1000;

let googleReady = false;
let lastPromptAt = 0;

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

// One Tap: signs a returning person straight back in when their Google session
// allows it. Throttled so a failing sign-in can't turn into a prompt loop.
function promptSignIn() {
  if (!googleReady || store.user || Date.now() - lastPromptAt < RENEWAL_THROTTLE_MS) return;
  lastPromptAt = Date.now();
  window.google.accounts.id.prompt();
}

async function handleCredential(response) {
  try {
    await store.signIn(response.credential);
    notice("authNotice", "");
  } catch (err) {
    console.error("Sign-in failed:", err);
    notice("authNotice", `Sign-in failed (${describe(err)}). Try again, or keep playing as a guest.`, "error");
  }
}

// Sets up Google's button and One Tap. Being signed in does not depend on any of
// this - a saved session is restored by the store without waiting for Google.
export function initGoogleSignIn(clientId) {
  if (!clientId) return;

  // The session ended (expired or signed out elsewhere): offer a quick way back in.
  store.subscribe(() => {
    if (store.syncError === "session_expired") {
      lastPromptAt = 0;
      promptSignIn();
    }
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
    promptSignIn();
  };
  tryInit();
}

export function signOut() {
  if (googleReady) window.google?.accounts?.id?.disableAutoSelect();
  store.signOut();
}
