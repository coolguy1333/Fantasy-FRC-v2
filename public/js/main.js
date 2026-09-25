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

function renderSyncStatus() {
  const banner = $("serverStatusBanner");
  if (!banner) return;
  if (!store.syncError) {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  banner.className = "notice notice-error";
  banner.textContent =
    store.syncError === "session_expired"
      ? "Your sign-in expired. Sign in again to keep syncing predictions - anything made since is only saved on this device until you do."
      : "Couldn't save your last change to the server. Retrying - your predictions are safe on this device in the meantime.";
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
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("feedbackName").value.trim();
    const contact = $("feedbackContact").value.trim();
    const message = $("feedbackMessage").value.trim();
    if (!message) return;
    store
      .mutate((state) => {
        state.feedback.push({ profileId: store.profileId, name, contact, message, at: Date.now() });
      })
      .then((result) => {
        if (result.ok) {
          notice("feedbackNotice", "Thanks for the feedback!", "success");
          form.reset();
        } else {
          notice("feedbackNotice", "Could not send feedback. Sign in first.", "error");
        }
      });
  });
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
  const config = await api.runtimeConfig().catch(() => ({}));
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

  initMatchesView();
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

  renderHeaderProfile();
  renderAuthPanel();
  renderSyncStatus();
}

boot();
