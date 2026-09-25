import { api } from "./api.js";
import { store } from "./store.js";
import { $, showTab, notice, closeModal, openModal } from "./ui.js";
import { initAuth, signOut } from "./views/auth.js";
import { initMatchesView } from "./views/matches.js";
import { initBracketView } from "./views/bracket.js";
import { initScoreView } from "./views/score.js";
import { initLeaderboardView } from "./views/leaderboard.js";
import { initAdminView } from "./views/admin.js";
import { maybeShowOnboarding } from "./views/teams.js";

window.showTab = showTab;

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

function wireHeaderProfileMenu() {
  const btn = $("headerProfileBtn");
  const panel = $("headerProfilePanel");
  if (!btn || !panel) return;
  window.toggleHeaderProfileMenu = (e) => {
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
      signOutBtn.onclick = () => {
        signOut();
        panel.classList.add("hidden");
      };
      panel.append(name, signOutBtn);
    }
  };
  document.addEventListener("click", () => panel.classList.add("hidden"));
}

function wireFeedbackForm() {
  const form = $("feedbackForm");
  if (!form) return;
  window.submitFeedbackForm = (e) => {
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
  };
}

function wireTeamInviteLink() {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get("team");
  if (!inviteCode) return;
  const unsubscribe = store.subscribe(() => {
    if (!store.user) return;
    $("teamInviteConfirmCode").textContent = `Code: ${inviteCode}`;
    const codes = store.state.teamInviteCodes || {};
    const teamId = Object.keys(codes).find((id) => codes[id] === inviteCode);
    $("teamInviteConfirmName").textContent = teamId ? store.state.groups[teamId]?.name || teamId : "Unknown team";
    openModal("teamInviteConfirmModal");
    unsubscribe();
  });
  window.confirmPendingTeamInviteJoin = () => {
    import("./views/teams.js").then(({ joinTeamByCode }) => {
      joinTeamByCode(inviteCode);
      closeModal("teamInviteConfirmModal");
    });
  };
  window.declinePendingTeamInviteJoin = () => closeModal("teamInviteConfirmModal");
}

async function boot() {
  const config = await api.runtimeConfig().catch(() => ({}));
  document.querySelector('meta[name="app-version"]')?.setAttribute("content", config.appVersion || "dev");
  document.querySelector('meta[name="google-signin-client_id"]')?.setAttribute("content", config.googleClientId || "");

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
  });

  initMatchesView();
  initBracketView();
  initScoreView();
  initLeaderboardView();
  initAdminView();
  wireHeaderProfileMenu();
  wireFeedbackForm();
  wireTeamInviteLink();

  renderHeaderProfile();
  renderAuthPanel();
}

boot();
