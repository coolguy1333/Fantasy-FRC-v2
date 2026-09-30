import { store } from "../store.js";
import { runtime } from "../runtime.js";
import { $, el, notice, makeGuardedRender, toast, copyText, confirmDialog, fill } from "../ui.js";
import { inviteLinkFor } from "./profile.js";

const isGlobalAdmin = () => Boolean(store.isGlobalAdmin);

function myAdminTeams() {
  const teamAdmins = store.state.teamAdmins || {};
  return Object.keys(teamAdmins).filter((teamId) => (teamAdmins[teamId] || []).includes(store.profileId));
}

function card(title, ...children) {
  return el("section", { class: "admin-section" }, [el("h4", {}, title), ...children]);
}

const row = (...children) => el("div", { class: "admin-row" }, children);

function copyButton(text, label, done) {
  return el("button", { type: "button", class: "secondary-btn", onclick: async () => toast((await copyText(text)) ? done : "Couldn't copy - select it and copy manually", "success") }, label);
}

function status(ok, title, detail) {
  return el("div", { class: `check ${ok ? "check-ok" : "check-bad"}` }, [
    el("span", { class: "check-badge" }, ok ? "OK" : "Fix"),
    el("div", {}, [el("strong", {}, title), el("div", { class: "muted small" }, detail)])
  ]);
}

// What to check when something isn't working - the things a new deployment usually trips over.
function setupChecklist() {
  const cfg = runtime.config;
  const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  const extra = (store.state.globalAdminEmails || []).length;
  return card(
    "Setup checklist",
    status(Boolean(cfg.authConfigured), "Google sign-in", cfg.authConfigured ? "GOOGLE_CLIENT_ID is set." : "GOOGLE_CLIENT_ID isn't set, so nobody can sign in. Set it in your app's settings."),
    el("div", { class: "check check-info" }, [
      el("span", { class: "check-badge" }, "Info"),
      el("div", {}, [
        el("strong", {}, "Authorized JavaScript origin"),
        el("div", { class: "muted small" }, "In Google Cloud Console, open your OAuth client (type: Web application) and add this exact address. Without it, Google's sign-in fails with an origin error. No client secret is needed."),
        el("div", { class: "invite-row" }, [el("code", { class: "origin" }, location.origin), copyButton(location.origin, "Copy", "Address copied")])
      ])
    ]),
    status(Boolean(cfg.tbaConfigured), "Live event data", cfg.tbaConfigured ? "TBA_API_KEY is set." : "TBA_API_KEY isn't set, so no events or matches can load. Get a free key at thebluealliance.com/account."),
    status(secure, "HTTPS", secure ? "This page is served securely." : "Google sign-in needs HTTPS (except on localhost). Serve the app over https://."),
    status(true, "Admins", `You are a global admin${extra ? ` (plus ${extra} more added below)` : ""}.`),
    el("p", { class: "muted small" }, `App version ${cfg.appVersion || "unknown"}`)
  );
}

function teamsSection() {
  const groups = store.state.groups || {};
  const members = {};
  for (const teamId of Object.values(store.state.profileTeams || {})) members[teamId] = (members[teamId] || 0) + 1;
  const wrap = card(`Teams (${Object.keys(groups).length})`);
  if (!Object.keys(groups).length) wrap.append(el("p", { class: "muted" }, "No teams yet. Players create teams from their profile."));
  for (const [teamId, team] of Object.entries(groups)) {
    const code = store.state.teamInviteCodes?.[teamId];
    wrap.append(
      row(
        el("div", { class: "grow" }, [el("strong", {}, team.name), el("div", { class: "muted small" }, `${members[teamId] || 0} member${members[teamId] === 1 ? "" : "s"}${code ? ` · code ${code}` : ""}`)]),
        code ? copyButton(inviteLinkFor(code), "Copy invite link", "Invite link copied") : null,
        el(
          "button",
          {
            type: "button",
            class: "danger-btn",
            onclick: async () => {
              const ok = await confirmDialog(`Delete ${team.name}? Its ${members[teamId] || 0} member(s) will be taken off the team. Their picks and points are kept.`, { title: "Delete team", confirmLabel: "Delete team", danger: true });
              if (!ok) return;
              store.mutate((state) => {
                delete state.groups[teamId];
                delete state.teamInviteCodes[teamId];
                delete state.teamAdmins[teamId];
                for (const pid of Object.keys(state.profileTeams)) if (state.profileTeams[pid] === teamId) delete state.profileTeams[pid];
              });
              toast("Team deleted");
            }
          },
          "Delete"
        )
      )
    );
  }
  return wrap;
}

function playersSection() {
  const profiles = store.state.profiles || {};
  const groups = store.state.groups || {};
  const ids = Object.keys(profiles);
  const wrap = card(`Players (${ids.length})`);
  if (!ids.length) wrap.append(el("p", { class: "muted" }, "Nobody has set up a profile yet."));
  for (const id of ids) {
    const teamId = store.state.profileTeams?.[id];
    const picks = Object.keys(store.state.predictionsByProfile?.[id] || {}).length;
    wrap.append(
      row(
        el("div", { class: "grow" }, [
          el("strong", {}, profiles[id]?.name || "Player"),
          el("div", { class: "muted small" }, [teamId && groups[teamId] ? groups[teamId].name : "No team", ` · ${picks} pick${picks === 1 ? "" : "s"}`, profiles[id]?.teamNumber ? ` · FRC ${profiles[id].teamNumber}` : ""])
        ])
      )
    );
  }
  return wrap;
}

function feedbackSection() {
  const items = [...(store.state.feedback || [])].reverse();
  const wrap = card(`Feedback (${items.length})`);
  if (!items.length) wrap.append(el("p", { class: "muted" }, "No feedback yet."));
  for (const item of items) {
    const contact = String(item.contact || "");
    wrap.append(
      el("div", { class: "feedback-item" }, [
        el("div", { class: "feedback-head" }, [
          el("strong", {}, item.name || "Anonymous"),
          contact ? (contact.includes("@") ? el("a", { href: `mailto:${contact}`, class: "link" }, contact) : el("span", { class: "muted" }, contact)) : el("span", { class: "muted small" }, "no contact given"),
          el("span", { class: "muted small" }, new Date(item.at || 0).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))
        ]),
        el("p", { class: "feedback-message" }, item.message)
      ])
    );
  }
  return wrap;
}

function settingsSection() {
  const wrap = card("Settings");
  wrap.append(
    el("label", { class: "check-row" }, [
      el("input", {
        type: "checkbox",
        checked: Boolean(store.state.showAllEventsInCatalog),
        onchange: (e) =>
          store.mutate((state) => {
            state.showAllEventsInCatalog = e.target.checked;
          })
      }),
      el("span", {}, [el("strong", {}, "Show every event to everyone"), el("span", { class: "muted small block" }, "By default the event list only shows events happening around now.")])
    ])
  );

  const emailInput = el("input", { class: "field-input", type: "email", placeholder: "name@example.com", "aria-label": "Email to grant global admin" });
  const grant = () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!email.includes("@")) return toast("Enter a valid email address", "error");
    if (store.state.globalAdminEmails.includes(email)) return toast("They're already an admin", "error");
    store.mutate((state) => {
      state.globalAdminEmails.push(email);
    });
    toast(`${email} is now an admin`);
  };
  wrap.append(
    el("h5", {}, "Global admins"),
    el("p", { class: "muted small" }, "Admins can manage every team and see feedback. Add someone by the email of their Google account."),
    el("div", { class: "inline-form" }, [emailInput, el("button", { type: "button", class: "load-btn", onclick: grant }, "Make admin")])
  );
  for (const email of store.state.globalAdminEmails || []) {
    wrap.append(
      row(
        el("span", { class: "grow" }, email),
        el(
          "button",
          {
            type: "button",
            class: "secondary-btn",
            onclick: async () => {
              if (!(await confirmDialog(`Remove admin access for ${email}?`, { title: "Remove admin", confirmLabel: "Remove", danger: true }))) return;
              store.mutate((state) => {
                state.globalAdminEmails = state.globalAdminEmails.filter((e) => e !== email);
              });
            }
          },
          "Remove"
        )
      )
    );
  }
  return wrap;
}

function myTeamSection(teamId) {
  const team = store.state.groups[teamId];
  const code = store.state.teamInviteCodes?.[teamId];
  const wrap = card(team?.name || "My team");
  const nameInput = el("input", { class: "field-input", maxlength: "40", value: team?.name || "", "aria-label": "Team name" });
  wrap.append(
    el("div", { class: "inline-form" }, [
      nameInput,
      el(
        "button",
        {
          type: "button",
          class: "secondary-btn",
          onclick: () => {
            const name = nameInput.value.trim();
            if (!name) return toast("A team needs a name", "error");
            store.mutate((state) => {
              state.groups[teamId] = { ...state.groups[teamId], name };
            });
            toast("Team renamed");
          }
        },
        "Rename"
      )
    ])
  );
  if (code) {
    const link = inviteLinkFor(code);
    wrap.append(
      el("p", { class: "muted small" }, `Team code ${code}. Share the link so teammates can join in one tap.`),
      el("div", { class: "invite-row" }, [el("input", { class: "field-input", readonly: true, value: link, "aria-label": "Invite link", onfocus: (e) => e.target.select() }), copyButton(link, "Copy link", "Invite link copied")])
    );
  }
  wrap.append(el("h5", {}, "Members"));
  const members = Object.entries(store.state.profileTeams || {}).filter(([, t]) => t === teamId);
  for (const [profileId] of members) {
    const name = store.state.profiles[profileId]?.name || "Player";
    wrap.append(
      row(
        el("span", { class: "grow" }, [name, profileId === store.profileId ? el("span", { class: "tag tag-pick you" }, "You") : null]),
        profileId === store.profileId
          ? null
          : el(
              "button",
              {
                type: "button",
                class: "secondary-btn",
                onclick: async () => {
                  if (!(await confirmDialog(`Remove ${name} from ${team.name}?`, { title: "Remove member", confirmLabel: "Remove", danger: true }))) return;
                  store.mutate((state) => {
                    delete state.profileTeams[profileId];
                  });
                }
              },
              "Remove"
            )
      )
    );
  }
  return wrap;
}

function renderNow() {
  const panel = $("adminPanel");
  if (!panel) return;
  const admin = isGlobalAdmin();
  const teams = myAdminTeams();
  $("nav-admin")?.classList.toggle("hidden", !admin && !teams.length);
  if (!admin && !teams.length) {
    fill(panel);
    notice("adminAccessNotice", "You don't have admin access.", "info");
    return;
  }
  notice("adminAccessNotice", "");
  fill(panel, 
    ...(admin ? [setupChecklist(), teamsSection(), playersSection(), feedbackSection(), settingsSection()] : []),
    ...teams.filter((id) => store.state.groups[id]).map((id) => myTeamSection(id))
  );
}

const render = makeGuardedRender(() => [$("adminPanel")], renderNow);

export function initAdminView() {
  store.subscribe(render);
  document.addEventListener("tabchange", (e) => e.detail === "adminTab" && render());
  render();
}
