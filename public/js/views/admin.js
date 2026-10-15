import { store, emptyState } from "../store.js";
import { runtime } from "../runtime.js";
import { $, el, notice, makeGuardedRender, toast, confirmDialog, fill } from "../ui.js";
import { accounts, allPlayerIds, button, card, change, copyButton, needAccounts, nameOf, row } from "./admin-common.js";
import { myTeamsSection, teamsSection } from "./admin-teams.js";
import { playersSection } from "./admin-players.js";
import { picksSection } from "./admin-picks.js";

const GLOBAL_SECTIONS = [
  ["overview", "Overview"],
  ["players", "Players"],
  ["teams", "Teams"],
  ["picks", "Picks"],
  ["feedback", "Feedback"],
  ["settings", "Settings"]
];

let section = null;
let feedbackFilter = "open";

const isGlobalAdmin = () => Boolean(store.isGlobalAdmin);

function myAdminTeams() {
  const teamAdmins = store.state.teamAdmins || {};
  return Object.keys(teamAdmins).filter((teamId) => (teamAdmins[teamId] || []).includes(store.profileId) && store.state.groups?.[teamId]);
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
    el("p", { class: "muted small" }, `App version ${cfg.appVersion || "unknown"}`)
  );
}

function stat(label, value, sub) {
  return el("div", { class: "score-card" }, [el("span", { class: "score-label" }, label), el("span", { class: "score-value" }, String(value)), sub ? el("span", { class: "score-sub" }, sub) : null]);
}

function goTo(name) {
  section = name;
  renderNow();
  $("adminPanel")?.scrollIntoView({ block: "start" });
}

function overviewSection(rerender) {
  needAccounts(rerender);
  const s = store.state;
  const players = allPlayerIds();
  const picks = players.reduce((n, sub) => n + Object.keys(s.predictionsByProfile?.[sub] || {}).length, 0);
  const openFeedback = (s.feedback || []).filter((f) => !f.handled).length;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const active = Object.values(accounts.bySub).filter((a) => a.lastActiveAt >= dayAgo).length;
  return [
    el("div", { class: "score-grid" }, [
      stat("Players", players.length, accounts.loaded ? `${active} active today` : null),
      stat("Teams", Object.keys(s.groups || {}).length),
      stat("Picks made", picks),
      stat("Open feedback", openFeedback)
    ]),
    card(
      "Quick actions",
      el("div", { class: "modal-actions" }, [
        button("Edit players", () => goTo("players")),
        button("Manage teams", () => goTo("teams")),
        button("Fix picks or locks", () => goTo("picks")),
        button(`Read feedback${openFeedback ? ` (${openFeedback})` : ""}`, () => goTo("feedback")),
        button("Post an announcement", () => goTo("settings")),
        button("Download a backup", downloadBackup)
      ])
    ),
    setupChecklist()
  ];
}

const sameFeedback = (a, b) => a.at === b.at && a.profileId === b.profileId && a.message === b.message;

function feedbackSection(rerender) {
  const all = [...(store.state.feedback || [])].reverse();
  const items = all.filter((f) => (feedbackFilter === "open" ? !f.handled : feedbackFilter === "done" ? f.handled : true));
  const filters = el(
    "div",
    { class: "segmented" },
    [
      ["open", `Open (${all.filter((f) => !f.handled).length})`],
      ["done", "Handled"],
      ["all", "All"]
    ].map(([value, label]) => el("button", { type: "button", class: `seg-btn${feedbackFilter === value ? " active" : ""}`, "aria-pressed": String(feedbackFilter === value), onclick: () => ((feedbackFilter = value), rerender()) }, label))
  );
  return [
    card(
      "Feedback",
      filters,
      items.length ? null : el("p", { class: "muted" }, feedbackFilter === "open" ? "Nothing waiting - all caught up." : "Nothing here."),
      ...items.map((item) => {
        const contact = String(item.contact || "");
        return el("div", { class: `feedback-item${item.handled ? " handled" : ""}` }, [
          el("div", { class: "feedback-head" }, [
            el("strong", {}, item.name || (item.profileId ? nameOf(item.profileId) : "Anonymous")),
            contact ? (contact.includes("@") ? el("a", { href: `mailto:${contact}`, class: "link" }, contact) : el("span", { class: "muted" }, contact)) : el("span", { class: "muted small" }, "no contact given"),
            el("span", { class: "muted small" }, new Date(item.at || 0).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))
          ]),
          el("p", { class: "feedback-message" }, item.message),
          el("div", { class: "modal-actions" }, [
            button(item.handled ? "Reopen" : "Mark handled", () =>
              change((state) => {
                const target = state.feedback.find((f) => sameFeedback(f, item));
                if (target) target.handled = !item.handled;
              })
            ),
            button(
              "Delete",
              async () => {
                if (!(await confirmDialog("Delete this feedback for good?", { title: "Delete feedback", confirmLabel: "Delete", danger: true }))) return;
                change((state) => {
                  state.feedback = state.feedback.filter((f) => !sameFeedback(f, item));
                }, "Feedback deleted");
              },
              "danger-btn"
            )
          ])
        ]);
      })
    )
  ];
}

function downloadBackup() {
  const payload = { app: "fantasy-frc", version: runtime.config.appVersion || "", exportedAt: new Date().toISOString(), state: store.state };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const a = el("a", { href: url, download: `fantasy-frc-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Backup downloaded");
}

async function restoreBackup(file) {
  let data;
  try {
    const parsed = JSON.parse(await file.text());
    data = parsed && typeof parsed === "object" && parsed.state ? parsed.state : parsed;
  } catch {
    return toast("That file isn't a Fantasy FRC backup (not valid JSON)", "error");
  }
  const domains = Object.keys(emptyState());
  if (!data || typeof data !== "object" || !["profiles", "predictionsByProfile"].every((k) => data[k] && typeof data[k] === "object")) {
    return toast("That file isn't a Fantasy FRC backup", "error");
  }
  const players = Object.keys(data.profiles).length;
  if (!(await confirmDialog(`Replace ALL current data with this backup (${players} players)? Everything changed since it was made is lost. Download a backup of the current data first if you might want it.`, { title: "Restore backup", confirmLabel: "Replace everything", danger: true }))) return;
  const fresh = emptyState();
  const result = await change((state) => {
    for (const key of domains) state[key] = key in data ? data[key] : fresh[key];
  });
  toast(result.ok ? "Backup restored" : "The server rejected that backup - nothing was changed", result.ok ? "success" : "error");
}

function settingsSection() {
  const s = store.state;
  const text = el("textarea", { class: "field-input footer-textarea", maxlength: "500", placeholder: "e.g. Picks for Saturday's matches open at 8am!", "aria-label": "Announcement" }, s.announcement?.text || "");
  const announcement = card(
    "Announcement",
    el("p", { class: "muted small" }, "Shown at the top of the site for everyone, including guests, until they dismiss it. Changing the text shows it again."),
    text,
    el("div", { class: "modal-actions" }, [
      button("Publish", () => change((state) => (state.announcement = { text: text.value.trim(), updatedAt: Date.now() }), text.value.trim() ? "Announcement published" : "Announcement cleared"), "load-btn"),
      s.announcement?.text ? button("Clear", () => change((state) => (state.announcement = { text: "", updatedAt: Date.now() }), "Announcement cleared")) : null
    ])
  );

  const featured = s.siteSettings?.featuredEvent || "";
  const onScreen = runtime.event.key;
  const featuredRow = el("div", { class: "check-row" }, [
    el("span", { class: "grow" }, [
      el("strong", {}, "Featured event"),
      el("span", { class: "muted small block" }, featured ? `Everyone who hasn't chosen an event starts on ${featured === onScreen ? runtime.event.name : featured}.` : "None - people choose their own event."),
      el("span", { class: "muted small block" }, onScreen ? `On screen now: ${runtime.event.name}.` : "Choose an event on the Matches tab to feature it.")
    ]),
    onScreen && onScreen !== featured ? button("Feature this event", () => change((state) => (state.siteSettings = { ...state.siteSettings, featuredEvent: onScreen }), `${runtime.event.name} is now featured`), "load-btn") : null,
    featured ? button("Stop featuring", () => change((state) => (state.siteSettings = { ...state.siteSettings, featuredEvent: "" }), "No featured event")) : null
  ]);
  const events = card(
    "Events",
    featuredRow,
    el("label", { class: "check-row" }, [
      el("input", { type: "checkbox", checked: Boolean(s.showAllEventsInCatalog), onchange: (e) => change((state) => (state.showAllEventsInCatalog = e.target.checked)) }),
      el("span", {}, [el("strong", {}, "Show every event to everyone"), el("span", { class: "muted small block" }, "By default the event list only shows events happening around now.")])
    ])
  );

  const emailInput = el("input", { class: "field-input", type: "email", placeholder: "name@gmail.com", "aria-label": "Email to make a site admin" });
  const grant = () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!email.includes("@")) return toast("Enter a valid email address", "error");
    if (s.globalAdminEmails.includes(email)) return toast("They're already an admin", "error");
    change((state) => state.globalAdminEmails.push(email), `${email} is now a site admin`);
  };
  const remove = (label, mutator) =>
    button("Remove", async () => {
      if (!(await confirmDialog(`Remove site admin access for ${label}?`, { title: "Remove admin", confirmLabel: "Remove", danger: true }))) return;
      change(mutator);
    });
  const admins = card(
    "Site admins",
    el("p", { class: "muted small" }, "Site admins can use everything in this tab. Add someone by the email of their Google account, or tick \"Site admin\" on a player. Admins listed in the server's GLOBAL_ADMIN_EMAILS setting aren't shown here and can only be changed there."),
    el("div", { class: "inline-form" }, [emailInput, button("Make admin", grant, "load-btn")]),
    ...(s.globalAdminEmails || []).map((email) => row(el("span", { class: "grow" }, email), remove(email, (state) => (state.globalAdminEmails = state.globalAdminEmails.filter((e) => e !== email))))),
    ...(s.globalAdminIds || []).map((sub) =>
      row(el("span", { class: "grow" }, [nameOf(sub), sub === store.profileId ? el("span", { class: "tag tag-pick you" }, "You") : null]), remove(nameOf(sub), (state) => (state.globalAdminIds = state.globalAdminIds.filter((id) => id !== sub))))
    )
  );

  const fileInput = el("input", { type: "file", accept: "application/json,.json", class: "hidden", onchange: (e) => e.target.files[0] && restoreBackup(e.target.files[0]) });
  const data = card(
    "Data",
    el("p", { class: "muted small" }, "A backup is one file with every player, pick, team and setting. Restoring replaces everything with the file's contents."),
    el("div", { class: "modal-actions" }, [button("Download backup", downloadBackup, "load-btn"), button("Restore from backup...", () => fileInput.click()), fileInput])
  );

  return [announcement, events, admins, data];
}

function sectionNav(choices) {
  return el(
    "nav",
    { class: "admin-nav", "aria-label": "Admin sections" },
    choices.map(([value, label]) => el("button", { type: "button", class: `seg-btn${section === value ? " active" : ""}`, "aria-pressed": String(section === value), onclick: () => ((section = value), renderNow()) }, label))
  );
}

function renderNow() {
  const panel = $("adminPanel");
  if (!panel) return;
  const admin = isGlobalAdmin();
  const teams = myAdminTeams();
  $("nav-admin")?.classList.toggle("hidden", !admin && !teams.length);
  const roleBadge = $("adminRole");
  if (roleBadge) {
    roleBadge.textContent = admin ? "Site admin" : teams.length ? "Team admin" : "";
    roleBadge.classList.toggle("hidden", !admin && !teams.length);
  }
  if (!admin && !teams.length) {
    fill(panel);
    notice("adminAccessNotice", "You don't have admin access. If you run this site, open the menu at the top right, choose \"Profile & team\" and use the admin setup code from the server log.", "info");
    return;
  }
  notice("adminAccessNotice", "");

  const choices = [...(admin ? GLOBAL_SECTIONS : []), ...(teams.length ? [["myteam", teams.length === 1 ? "My team" : "My teams"]] : [])];
  if (!choices.some(([value]) => value === section)) section = choices[0][0];

  const rerender = () => render();
  let content;
  if (section === "overview") content = overviewSection(rerender);
  else if (section === "players") content = playersSection(rerender);
  else if (section === "teams") content = teamsSection();
  else if (section === "picks") content = picksSection();
  else if (section === "feedback") content = feedbackSection(rerender);
  else if (section === "settings") content = settingsSection();
  else content = myTeamsSection(teams);

  fill(panel, choices.length > 1 ? sectionNav(choices) : null, ...content);
}

const render = makeGuardedRender(() => [$("adminPanel")], renderNow);

export function initAdminView() {
  store.subscribe(render);
  document.addEventListener("tabchange", (e) => e.detail === "adminTab" && render());
  render();
}
