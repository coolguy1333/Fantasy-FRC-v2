import { store } from "../store.js";
import { $, el, notice, openModal, closeModal } from "../ui.js";

function genCode(existingCodes) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const taken = new Set(Object.values(existingCodes || {}).map((c) => String(c).toUpperCase()));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
    if (!taken.has(code)) return code;
  }
  // Astronomically unlikely with 50 attempts at 32^5 possibilities, but never hand out a duplicate.
  throw new Error("could_not_generate_unique_code");
}

function findTeamByCode(code) {
  const codes = store.state.teamInviteCodes || {};
  const entry = Object.entries(codes).find(([, c]) => String(c).toUpperCase() === String(code).toUpperCase());
  return entry ? entry[0] : null;
}

export function createTeam(name) {
  const teamId = `team_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const code = genCode(store.state.teamInviteCodes);
  store.mutate((state) => {
    state.groups[teamId] = { name, createdAt: Date.now() };
    state.teamInviteCodes[teamId] = code;
    state.teamAdmins[teamId] = [store.profileId];
    state.profileTeams[store.profileId] = teamId;
  });
  return { teamId, code };
}

export function joinTeamByCode(code) {
  const teamId = findTeamByCode(code);
  if (!teamId) return { ok: false, error: "invalid_code" };
  store.mutate((state) => {
    state.profileTeams[store.profileId] = teamId;
  });
  return { ok: true, teamId };
}

export function completeOnboarding() {
  const mode = document.querySelector('input[name="setupMode"]:checked')?.value;
  notice("onboardingError", "");

  if (mode === "join") {
    const code = $("onboardingTeamCode").value.trim();
    if (!code) return notice("onboardingError", "Enter a team code.", "error");
    const result = joinTeamByCode(code);
    if (!result.ok) return notice("onboardingError", "That team code wasn't found.", "error");
  } else if (mode === "create") {
    const name = $("onboardingTeamName").value.trim();
    if (!name) return notice("onboardingError", "Enter a team name.", "error");
    try {
      createTeam(name);
    } catch {
      return notice("onboardingError", "Could not create a team right now. Try again.", "error");
    }
  }

  const number = $("onboardingTeamNumber").value.trim();
  store.mutate((state) => {
    state.profiles[store.profileId] = { ...(state.profiles[store.profileId] || {}), teamNumber: number, name: store.user?.name || "Guest" };
    state.profileSetupDone[store.profileId] = true;
  });
  closeModal("onboardingModal");
}

export function skipOnboarding() {
  store.mutate((state) => {
    state.profiles[store.profileId] = { ...(state.profiles[store.profileId] || {}), name: store.user?.name || "Guest" };
    state.profileSetupDone[store.profileId] = true;
  });
  closeModal("onboardingModal");
}

export function maybeShowOnboarding() {
  if (!store.user) return;
  if (!store.state.profileSetupDone[store.profileId]) {
    const list = $("onboardingTeamCodeList");
    if (list) {
      list.innerHTML = "";
      for (const [teamId, code] of Object.entries(store.state.teamInviteCodes || {})) {
        const name = store.state.groups[teamId]?.name || teamId;
        list.append(el("option", { value: code }, name));
      }
    }
    openModal("onboardingModal");
  }
}

document.addEventListener("change", (e) => {
  if (e.target.name === "setupMode") {
    $("joinTeamRow")?.classList.toggle("hidden", e.target.value !== "join");
    $("createTeamRow")?.classList.toggle("hidden", e.target.value !== "create");
  }
});
