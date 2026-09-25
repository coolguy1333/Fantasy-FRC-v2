import { store } from "../store.js";

let googleReady = false;
let onSignedIn = () => {};

function renderButton(hostId) {
  const host = document.getElementById(hostId);
  if (!host || !window.google?.accounts?.id) return;
  host.innerHTML = "";
  window.google.accounts.id.renderButton(host, { theme: "outline", size: "large", text: "signin_with" });
}

async function handleCredential(response) {
  try {
    await store.signIn(response.credential);
    onSignedIn();
  } catch (err) {
    console.error("Sign-in failed:", err);
  }
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
    window.google.accounts.id.initialize({ client_id: clientId, callback: handleCredential, auto_select: false });
    googleReady = true;
    renderButton("googleSignInHost");
    renderButton("googleGateHost");
  };
  tryInit();
}

export function signOut() {
  if (googleReady) window.google?.accounts?.id?.disableAutoSelect();
  store.signOut();
}
