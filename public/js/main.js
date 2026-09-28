import { api } from "./api.js";
import { store } from "./store.js";
import { $, showTab, notice, closeModal, openModal } from "./ui.js";
import { initAuth, signOut } from "./views/auth.js";
import { initMatchesView } from "./views/matches.js";
import { initBracketView } from "./views/bracket.js";
import { initScoreView } from "./views/score.js";
import { initLeaderboardView } from "./views/leaderboard.js";
import { initAdminView } from "./views/admin.js";
import { maybeShowOnboarding, completeOnboarding, skipOnboarding, joinTeamByCode } from "./views/teams.js";

function renderHeaderProfile() {
  const wrap = $("headerProfileWrap");
  const initialEl = $("headerProfileInitial");
  if (!wrap) return;
  if (store.user) {
    wrap.classList.remove("hidden");
    initialEl.textContent = (store.user.name || store.user.email || "?")[0].toUpperCase();
  } else {
    wrap.classList.add("hidden");
  }
}

function renderAuthPanel() {
  const authPanel = document.querySelector(".auth-panel");
  const preScreen = $("prePredictScreen");
  if (store.user) {
    authPanel?.classList.add("hidden");
    preScreen?.classList.add("hidden");
  } else {
    authPanel?.classList.remove("hidden");
  }
}

const REJECTION_MESSAGES = {
  prediction_locked: "That pick locked before it could be saved, so it was undone. Picks lock 10 minutes before a match starts.",
  forbidden_state_change: "The server didn't allow that change, so it was undone.",
  payload_too_large: "That change was too large to save, so it was undone."
};

function syncMessage() {
  if (store.syncError === "session_expired") {
    return "Your sign-in expired. Renewing it - if that doesn't work, sign in again. Changes since then are only on this device until you do.";
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

function wireNav() {
  document.querySelectorAll(".nav-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showTab(btn.dataset.tab, btn));
  });
}

function wireMobileNav() {
  const nav = $("mainNav");
  const hamburger = $("navHamburger");
  if (!nav || !hamburger) return;
  hamburger.addEventListener("click", () => {
    const open = nav.classList.toggle("nav-open");
    hamburger.classList.toggle("is-open", open);
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("#mainNav .nav-btn")) {
      nav.classList.remove("nav-open");
      hamburger.classList.remove("is-open");
    }
  });
}

function wireHeaderProfileMenu() {
  const btn = $("headerProfileBtn");
  const panel = $("headerProfilePanel");
  if (!btn || !panel) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      panel.innerHTML = "";
      const name = document.createElement("div");
      name.className = "profile-panel-name";
      name.textContent = store.user?.name || store.user?.email || "Signed in";
      const signOutBtn = document.createElement("button");
      signOutBtn.className = "secondary-btn";
      signOutBtn.textContent = "Sign out";
      signOutBtn.addEventListener("click", () => {
        signOut();
        panel.classList.add("hidden");
      });
      panel.append(name, signOutBtn);
    }
  });
  document.addEventListener("click", () => panel.classList.add("hidden"));
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
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  return {};
}

function wireOnboardingModal() {
  $("onboardingSaveBtn")?.addEventListener("click", completeOnboarding);
  $("onboardingSkipBtn")?.addEventListener("click", skipOnboarding);
}

function wireTeamInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get("team");
  if (!inviteCode) return;

  $("teamInviteJoinBtn")?.addEventListener("click", () => {
    joinTeamByCode(inviteCode);
    closeModal("teamInviteConfirmModal");
  });
  $("teamInviteDeclineBtn")?.addEventListener("click", () => closeModal("teamInviteConfirmModal"));

  const unsubscribe = store.subscribe(() => {
    if (!store.user) return;
    $("teamInviteConfirmCode").textContent = `Code: ${inviteCode}`;
    const codes = store.state.teamInviteCodes || {};
    const teamId = Object.keys(codes).find((id) => codes[id] === inviteCode);
    $("teamInviteConfirmName").textContent = teamId ? store.state.groups[teamId]?.name || teamId : "Unknown team";
    openModal("teamInviteConfirmModal");
    unsubscribe();
  });
}

async function boot() {
  const config = await loadRuntimeConfig();
  document.querySelector('meta[name="app-version"]')?.setAttribute("content", config.appVersion || "dev");

  initAuth(config.googleClientId, {
    onSignIn: () => {
      renderHeaderProfile();
      renderAuthPanel();
      maybeShowOnboarding();
    }
  });

  store.subscribe(() => {
    renderHeaderProfile();
    renderAuthPanel();
    renderSyncStatus();
  });

  initMatchesView({ tbaConfigured: config.tbaConfigured !== false });
  initBracketView();
  initScoreView();
  initLeaderboardView();
  initAdminView();
  wireNav();
  wireMobileNav();
  wireHeaderProfileMenu();
  wireFeedbackForm();
  wireOnboardingModal();
  wireTeamInviteLink();
  warnBeforeLosingUnsavedChanges();

  renderHeaderProfile();
  renderAuthPanel();
  renderSyncStatus();
}

boot();
