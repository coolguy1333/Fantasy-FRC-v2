import { store } from "../store.js";
import { runtime } from "../runtime.js";
import { el, fill, confirmDialog, showModal, isEditing, toast } from "../ui.js";
import { genCode, inviteLinkFor } from "./profile.js";
import { allPlayerIds, button, card, change, copyButton, isTeamAdmin, nameOf, pointsAtEvent, row, teamNameOf } from "./admin-common.js";

const membersOf = (teamId) => Object.entries(store.state.profileTeams || {}).filter(([, t]) => t === teamId).map(([sub]) => sub);

function deleteTeam(teamId) {
  return (state) => {
    delete state.groups[teamId];
    delete state.teamInviteCodes[teamId];
    delete state.teamAdmins[teamId];
    for (const pid of Object.keys(state.profileTeams)) if (state.profileTeams[pid] === teamId) delete state.profileTeams[pid];
  };
}

function setAdmin(teamId, sub, on) {
  return (state) => {
    const list = (state.teamAdmins[teamId] || []).filter((id) => id !== sub);
    state.teamAdmins[teamId] = on ? [...list, sub] : list;
  };
}

// Everything about one team, for its admins and for site admins. `global` adds the
// things only a site admin may do (put anyone on the team).
export function teamManager(teamId, { global = false, onDeleted } = {}) {
  const team = store.state.groups?.[teamId];
  if (!team) return el("p", { class: "muted" }, "This team no longer exists.");
  const code = store.state.teamInviteCodes?.[teamId];
  const members = membersOf(teamId);
  const admins = store.state.teamAdmins?.[teamId] || [];
  const me = store.profileId;
  const eventName = runtime.event.key ? runtime.event.name : "";

  const nameInput = el("input", { class: "field-input", maxlength: "40", value: team.name, "aria-label": "Team name" });
  const rename = el("div", { class: "inline-form" }, [
    nameInput,
    button("Rename", () => {
      const name = nameInput.value.trim();
      if (!name) return toast("A team needs a name", "error");
      change((state) => {
        state.groups[teamId] = { ...state.groups[teamId], name };
      }, "Team renamed");
    })
  ]);

  const invite = code
    ? el("div", {}, [
        el("p", { class: "muted small" }, `Invite code ${code}. Anyone with the link can join.`),
        el("div", { class: "invite-row" }, [
          el("input", { class: "field-input", readonly: true, value: inviteLinkFor(code), "aria-label": "Invite link", onfocus: (e) => e.target.select() }),
          copyButton(inviteLinkFor(code), "Copy link", "Invite link copied")
        ]),
        button("New code", async () => {
          if (!(await confirmDialog("Make a new invite code? The current link and code will stop working.", { title: "New invite code", confirmLabel: "Make new code" }))) return;
          change((state) => {
            state.teamInviteCodes[teamId] = genCode(state.teamInviteCodes);
          }, "New invite code ready");
        })
      ])
    : el("p", { class: "muted small" }, "This team has no invite code.");

  const memberRows = members.length
    ? members.map((sub) => {
        const admin = admins.includes(sub);
        const points = pointsAtEvent(sub);
        const lastAdmin = admin && admins.length === 1;
        return row(
          el("div", { class: "grow" }, [
            el("strong", {}, nameOf(sub)),
            sub === me ? el("span", { class: "tag tag-pick you" }, "You") : null,
            admin ? el("span", { class: "tag tag-muted you" }, "Admin") : null,
            el("div", { class: "muted small" }, points === null ? "" : `${points} pts at ${eventName}`)
          ]),
          button(admin ? "Remove admin" : "Make admin", async () => {
            if (admin && lastAdmin && !(await confirmDialog(`${nameOf(sub)} is this team's only admin. Without one, only a site admin can manage the team.`, { title: "Remove last admin", confirmLabel: "Remove admin", danger: true }))) return;
            change(setAdmin(teamId, sub, !admin), admin ? `${nameOf(sub)} is no longer an admin` : `${nameOf(sub)} is now a team admin`);
          }),
          sub === me
            ? null
            : button(
                "Remove",
                async () => {
                  if (!(await confirmDialog(`Remove ${nameOf(sub)} from ${team.name}? Their picks and points are kept.`, { title: "Remove member", confirmLabel: "Remove", danger: true }))) return;
                  change((state) => {
                    delete state.profileTeams[sub];
                    setAdmin(teamId, sub, false)(state);
                  }, `${nameOf(sub)} removed`);
                },
                "danger-btn"
              )
        );
      })
    : [el("p", { class: "muted" }, "No members yet - share the invite link.")];

  let adder = null;
  if (global) {
    const others = allPlayerIds().filter((sub) => store.state.profileTeams?.[sub] !== teamId);
    const select = el("select", { class: "field-input", "aria-label": "Player to add" }, [
      el("option", { value: "" }, "Add a player..."),
      ...others.map((sub) => el("option", { value: sub }, `${nameOf(sub)}${store.state.profileTeams?.[sub] ? ` (on ${teamNameOf(store.state.profileTeams[sub]) || "another team"})` : ""}`))
    ]);
    adder = el("div", { class: "inline-form" }, [
      select,
      button("Add to team", () => {
        const sub = select.value;
        if (!sub) return;
        change((state) => {
          const previous = state.profileTeams[sub];
          if (previous && state.teamAdmins[previous]) state.teamAdmins[previous] = state.teamAdmins[previous].filter((id) => id !== sub);
          state.profileTeams[sub] = teamId;
        }, `${nameOf(sub)} added to ${team.name}`);
      })
    ]);
  }

  return el("div", { class: "team-manager" }, [
    el("h5", {}, "Name"),
    rename,
    el("h5", {}, "Invite"),
    invite,
    el("h5", {}, `Members (${members.length})`),
    ...memberRows,
    adder,
    el("h5", { class: "danger-heading" }, "Danger zone"),
    button(
      "Delete team",
      async () => {
        if (!(await confirmDialog(`Delete ${team.name}? Its ${members.length} member(s) will be taken off the team. Their picks and points are kept.`, { title: "Delete team", confirmLabel: "Delete team", danger: true }))) return;
        await change(deleteTeam(teamId), "Team deleted");
        onDeleted?.();
      },
      "danger-btn"
    )
  ]);
}

// A team manager in a dialog that keeps itself up to date (but never redraws under someone typing).
export function openTeamManager(teamId) {
  let unsubscribe = () => {};
  showModal({
    title: teamNameOf(teamId) || "Team",
    onClose: () => unsubscribe(),
    render: (body, close) => {
      const draw = () => {
        if (isEditing(body)) return;
        fill(body, teamManager(teamId, { global: true, onDeleted: close }), el("div", { class: "modal-actions" }, [button("Done", close, "load-btn")]));
      };
      draw();
      unsubscribe = store.subscribe(draw);
    }
  });
}

export function teamsSection() {
  const groups = store.state.groups || {};
  const ids = Object.keys(groups).sort((a, b) => teamNameOf(a).localeCompare(teamNameOf(b)));
  const nameInput = el("input", { class: "field-input", maxlength: "40", placeholder: "New team name", "aria-label": "New team name" });
  const create = el("div", { class: "inline-form" }, [
    nameInput,
    button(
      "Create team",
      () => {
        const name = nameInput.value.trim();
        if (!name) return toast("Give the team a name", "error");
        const teamId = `team_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        change((state) => {
          state.groups[teamId] = { name, createdAt: Date.now() };
          state.teamInviteCodes[teamId] = genCode(state.teamInviteCodes);
          state.teamAdmins[teamId] = [];
        }, `${name} created - add members or share its invite link`);
      },
      "load-btn"
    )
  ]);

  const list = ids.length
    ? ids.map((teamId) => {
        const members = membersOf(teamId);
        const admins = (store.state.teamAdmins?.[teamId] || []).map(nameOf);
        return row(
          el("div", { class: "grow" }, [
            el("strong", {}, teamNameOf(teamId)),
            el("div", { class: "muted small" }, [
              `${members.length} member${members.length === 1 ? "" : "s"}`,
              store.state.teamInviteCodes?.[teamId] ? ` · code ${store.state.teamInviteCodes[teamId]}` : "",
              ` · ${admins.length ? `admin${admins.length === 1 ? "" : "s"}: ${admins.join(", ")}` : "no admin"}`
            ])
          ]),
          button("Manage", () => openTeamManager(teamId), "load-btn")
        );
      })
    : [el("p", { class: "muted" }, "No teams yet.")];

  return [card("Create a team", el("p", { class: "muted small" }, "Players can also create their own teams from their profile."), create), card(`Teams (${ids.length})`, ...list)];
}

export function myTeamsSection(teamIds) {
  return teamIds.filter((id) => store.state.groups?.[id]).map((teamId) => card(teamNameOf(teamId), teamManager(teamId, { global: false })));
}

export const isAdminOfAnyTeam = () => Object.keys(store.state.teamAdmins || {}).some((teamId) => isTeamAdmin(store.profileId, teamId) && store.state.groups?.[teamId]);
