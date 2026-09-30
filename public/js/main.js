import { api } from "./api.js";
import { store } from "./store.js";
import { runtime } from "./runtime.js";
import { $, el, showTab, notice, fill } from "./ui.js";
import { initGoogleSignIn, signOut } from "./views/auth.js";
import { initMatchesView } from "./views/matches.js";
import { initScoreView } from "./views/score.js";
import { initLeaderboardView } from "./views/leaderboard.js";
import { initAdminView } from "./views/admin.js";
import { initGuestMigration } from "./views/guest.js";
import { handleInviteLink, maybeShowOnboarding, openProfile, pendingInviteCode } from "./views/profile.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function renderHeaderProfile() {
  const wrap = $("headerProfileWrap");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !store.user);
  if (store.user) {
    const name = store.state.profiles?.[store.user.sub]?.name || store.user.name || store.user.email || "?";
    $("headerProfileInitial").textContent = name[0].toUpperCase();
    $("headerProfileBtn").setAttribute("aria-label", `Account menu for ${name}`);
  }
}

function renderAuthPanel() {
  $("authPanel")?.classList.toggle("hidden", Boolean(store.user));
  // No Google client ID configured: don't tell people to click a button that isn't there.
  const noSignIn = runtime.config.authConfigured === false;
  const copy = document.querySelector("#authPanel .auth-copy");
  if (copy && noSignIn) {
    fill(copy, el("h2", {}, "Playing as a guest"), el("p", {}, "Your picks are saved on this device. Sign-in isn't set up on this site yet, so teams and the leaderboard aren't available."));
  }
  $("googleSignInHost")?.classList.toggle("hidden", noSignIn);
  // Someone arriving from an invite link needs to know why they should sign in.
  const banner = $("inviteBanner");
  if (banner) {
    const waiting = Boolean(pendingInviteCode()) && !store.user;
    banner.classList.toggle("hidden", !waiting);
    if (waiting) banner.textContent = "You've been invited to join a team. Sign in with Google to accept.";
  }
}

const REJECTION_MESSAGES = {
  prediction_locked: "That pick locked before it could be saved, so it was undone. Picks lock 10 minutes before a match starts.",
  forbidden_state_change: "The server didn't allow that change, so it was undone.",
  payload_too_large: "That change was too large to save, so it was undone.",
  duplicate_team_code: "Another team already uses that code, so the new team wasn't created. Please try again."
};

function syncMessage() {
  if (store.syncError === "session_expired") {
    return "You've been signed out. Sign in again to keep saving - changes since then are only on this device until you do.";
  }
  if (store.syncError === "load_failed") {
    return "Couldn't load the latest data - retrying. You can keep making picks; they'll save once the connection is back.";
  }
  if (store.syncError === "rejected") {
    return REJECTION_MESSAGES[store.syncErrorCode] || "The server rejected your last change, so it was undone.";
  }
  return "Couldn't save your last change to the server. Retrying - it's kept on this device in the meantime.";
}

function renderSyncStatus() {
  const banner = $("serverStatusBanner");
  if (!banner) return;
  if (!store.syncError) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  banner.className = "notice notice-error";
  banner.textContent = syncMessage();
}

// A small "Saving... / Saved" indicator, so a tap on Red or Blue visibly does something.
let lastStatus = "guest";
let savedTimer = null;
function renderSaveStatus() {
  const pill = $("saveStatus");
  if (!pill) return;
  const status = store.status;
  clearTimeout(savedTimer);
  pill.className = "save-status";
  if (status === "saving") {
    pill.textContent = "Saving...";
  } else if (status === "error") {
    pill.textContent = "Not saved - retrying";
    pill.classList.add("save-error");
  } else if (status === "saved" && (lastStatus === "saving" || lastStatus === "error")) {
    pill.textContent = "Saved";
    pill.classList.add("save-ok");
    savedTimer = setTimeout(() => (pill.className = "save-status hidden"), 2500);
  } else if (status === "saved") {
    pill.className = "save-status hidden";
  } else {
    pill.className = "save-status hidden"; // guests: nothing to sync
  }
  lastStatus = status;
}

function wireNav() {
  document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showTab(btn.dataset.tab, btn);
      window.scrollTo({ top: 0 });
    });
  });
  document.body.dataset.tab = "matchesTab";
}

function wireProfileMenu() {
  const btn = $("headerProfileBtn");
  const panel = $("headerProfilePanel");
  if (!btn || !panel) return;
  const close = () => {
    panel.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!panel.classList.contains("hidden")) return close();
    const name = store.state.profiles?.[store.profileId]?.name || store.user?.name || "Signed in";
    fill(panel, 
      el("div", { class: "profile-panel-name" }, name),
      store.user?.email ? el("div", { class: "muted small profile-panel-email" }, store.user.email) : null,
      el("button", { type: "button", class: "menu-item", onclick: () => (close(), openProfile()) }, "Profile & team"),
      el("button", { type: "button", class: "menu-item", onclick: () => (close(), signOut()) }, "Sign out")
    );
    panel.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
    panel.querySelector("button")?.focus();
  });
  document.addEventListener("click", (e) => !panel.contains(e.target) && close());
  document.addEventListener("keydown", (e) => e.key === "Escape" && close());
}

function wireFeedbackForm() {
  const form = $("feedbackForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("feedbackName").value.trim();
    const contact = $("feedbackContact").value.trim();
    const message = $("feedbackMessage").value.trim();
    if (!message) return;
    // Feedback is delivered to the admins by the server, so it needs an account.
    if (!store.user) return notice("feedbackNotice", "Sign in with Google to send feedback.", "error");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api.sendFeedback({ name, contact, message });
      notice("feedbackNotice", "Thanks for the feedback!", "success");
      form.reset();
    } catch (err) {
      const text = err.status === 429 ? "You've already sent a lot of feedback - thank you!" : "Could not send feedback. Please try again.";
      notice("feedbackNotice", text, "error");
    } finally {
      button.disabled = false;
    }
  });
}

// Unsaved predictions live only in memory until the server confirms them.
function warnBeforeLosingUnsavedChanges() {
  window.addEventListener("beforeunload", (e) => {
    if (!store.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

async function loadRuntimeConfig() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await api.runtimeConfig();
    } catch {
      if (attempt < 3) await sleep(attempt * 1000);
    }
  }
  return {};
}

async function boot() {
  // Ask right away whether an earlier visit left a session; don't wait for
  // Google's script. The page starts in a neutral "signing you in" state
  // (body.auth-pending) so a returning player never sees a signed-out flash.
  store.enterGuestMode();
  const sessionCheck = store.restoreSession().catch((err) => {
    console.warn("Could not check for a saved sign-in:", err);
    return false;
  });
  const [config] = await Promise.all([loadRuntimeConfig(), Promise.race([sessionCheck, sleep(3000)])]);
  runtime.config = config;
  document.body.classList.remove("auth-pending");
  document.querySelector('meta[name="app-version"]')?.setAttribute("content", config.appVersion || "dev");

  let wasSignedIn = false;
  const onStoreChange = () => {
    renderHeaderProfile();
    renderAuthPanel();
    renderSyncStatus();
    renderSaveStatus();
    if (store.user && !wasSignedIn) {
      wasSignedIn = true;
      maybeShowOnboarding();
      handleInviteLink();
    } else if (!store.user) {
      wasSignedIn = false;
    }
  };

  initMatchesView({ tbaConfigured: config.tbaConfigured !== false });
  initScoreView();
  initLeaderboardView();
  initAdminView();
  initGuestMigration();
  wireNav();
  wireProfileMenu();
  wireFeedbackForm();
  warnBeforeLosingUnsavedChanges();

  store.subscribe(onStoreChange);
  initGoogleSignIn(config.googleClientId);
  onStoreChange();
}

boot();
