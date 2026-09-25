import { store } from "../store.js";
import { $, el, notice } from "../ui.js";

function isGlobalAdmin() {
  return Boolean(store.isGlobalAdmin);
}

function myAdminTeams() {
  const teamAdmins = store.state.teamAdmins || {};
  return Object.keys(teamAdmins).filter((teamId) => (teamAdmins[teamId] || []).includes(store.profileId));
}

function section(title, contentNode) {
  return el("div", { class: "admin-section" }, [el("h4", {}, title), contentNode]);
}

function renderTeamsSection() {
  const wrap = el("div");
  const groups = store.state.groups || {};
  for (const [teamId, team] of Object.entries(groups)) {
    const code = store.state.teamInviteCodes[teamId] || "-";
    wrap.append(
      el("div", { class: "admin-row" }, [
        el("span", {}, `${team.name} (code: ${code})`),
        el(
          "button",
          {
            class: "secondary-btn",
            onclick: () =>
              store.mutate((state) => {
                delete state.groups[teamId];
                delete state.teamInviteCodes[teamId];
                delete state.teamAdmins[teamId];
                for (const pid of Object.keys(state.profileTeams)) {
                  if (state.profileTeams[pid] === teamId) delete state.profileTeams[pid];
                }
              })
          },
          "Delete Team"
        )
      ])
    );
  }
  return wrap;
}

function renderPlayersSection() {
  const wrap = el("div");
  const profiles = store.state.profiles || {};
  for (const [id, profile] of Object.entries(profiles)) {
    wrap.append(el("div", { class: "admin-row" }, [el("span", {}, profile.name || id)]));
  }
  return wrap;
}

function renderFeedbackSection() {
  const wrap = el("div");
  const items = store.state.feedback || [];
  if (!items.length) wrap.append(el("p", { class: "muted" }, "No feedback yet."));
  for (const item of [...items].reverse()) {
    wrap.append(
      el("div", { class: "admin-row" }, [
        el("strong", {}, item.name || "Anonymous"),
        el("span", {}, item.message),
        el("span", { class: "muted small" }, new Date(item.at || 0).toLocaleString())
      ])
    );
  }
  return wrap;
}

function renderPermissionsSection() {
  const wrap = el("div");
  const emailInput = el("input", { class: "admin-input", placeholder: "Email to grant global admin" });
  wrap.append(
    el("div", { class: "admin-row" }, [
      emailInput,
      el(
        "button",
        {
          class: "load-btn",
          onclick: () =>
            store.mutate((state) => {
              const email = emailInput.value.trim().toLowerCase();
              if (email && !state.globalAdminEmails.includes(email)) state.globalAdminEmails.push(email);
            })
        },
        "Grant Global Admin"
      )
    ])
  );
  for (const email of store.state.globalAdminEmails || []) {
    wrap.append(
      el("div", { class: "admin-row" }, [
        el("span", {}, email),
        el(
          "button",
          {
            class: "secondary-btn",
            onclick: () =>
              store.mutate((state) => {
                state.globalAdminEmails = state.globalAdminEmails.filter((e) => e !== email);
              })
          },
          "Revoke"
        )
      ])
    );
  }
  return wrap;
}

function renderMyTeamSection(teamId) {
  const wrap = el("div");
  const team = store.state.groups[teamId];
  wrap.append(el("h5", {}, team?.name || teamId));
  wrap.append(el("p", { class: "muted" }, `Invite code: ${store.state.teamInviteCodes[teamId] || "-"}`));
  const members = Object.entries(store.state.profileTeams || {}).filter(([, t]) => t === teamId);
  for (const [profileId] of members) {
    const name = store.state.profiles[profileId]?.name || profileId;
    wrap.append(
      el("div", { class: "admin-row" }, [
        el("span", {}, name),
        el(
          "button",
          {
            class: "secondary-btn",
            onclick: () =>
              store.mutate((state) => {
                delete state.profileTeams[profileId];
              })
          },
          "Remove"
        )
      ])
    );
  }
  return wrap;
}

function render() {
  const panel = $("adminPanel");
  if (!panel) return;
  const admin = isGlobalAdmin();
  const teams = myAdminTeams();
  $("nav-admin")?.classList.toggle("hidden", !admin && !teams.length);
  panel.innerHTML = "";

  if (!admin && !teams.length) {
    notice("adminAccessNotice", "You don't have admin access.", "info");
    return;
  }
  notice("adminAccessNotice", "");

  if (admin) {
    panel.append(
      section("Teams", renderTeamsSection()),
      section("Players", renderPlayersSection()),
      section("Feedback", renderFeedbackSection()),
      section("Permissions", renderPermissionsSection())
    );
  }
  for (const teamId of teams) {
    panel.append(section("My Team", renderMyTeamSection(teamId)));
  }
}

export function initAdminView() {
  store.subscribe(render);
}
