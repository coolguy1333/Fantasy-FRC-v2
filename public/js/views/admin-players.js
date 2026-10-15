import { api } from "../api.js";
import { store } from "../store.js";
import { runtime } from "../runtime.js";
import { el, fill, confirmDialog, showModal, toast } from "../ui.js";
import { accounts, ago, allPlayerIds, button, card, change, isSiteAdmin, isTeamAdmin, needAccounts, nameOf, picksCount, pointsAtEvent, row, teamNameOf } from "./admin-common.js";

let query = "";

const PLAYER_DOMAINS = ["profiles", "predictionsByProfile", "eventSummaries", "bracketPicksByProfile", "bracketScoreByProfile", "profileSetupDone", "profileTeams", "pointAdjustments"];

function removePlayer(sub) {
  return (state) => {
    for (const domain of PLAYER_DOMAINS) delete state[domain][sub];
    for (const teamId of Object.keys(state.teamAdmins)) state.teamAdmins[teamId] = (state.teamAdmins[teamId] || []).filter((id) => id !== sub);
    state.globalAdminIds = state.globalAdminIds.filter((id) => id !== sub);
  };
}

function field(label, input, hint) {
  return el("label", { class: "field" }, [el("span", { class: "field-label" }, label), input, hint ? el("span", { class: "field-hint" }, hint) : null]);
}

function openPlayer(sub) {
  const profile = store.state.profiles?.[sub] || {};
  const account = accounts.bySub[sub];
  const currentTeam = store.state.profileTeams?.[sub] || "";
  const { event } = runtime;
  const adj = store.state.pointAdjustments?.[sub];
  const eventAdj = event.key && adj && typeof adj === "object" ? adj[event.key] || {} : {};
  const self = sub === store.profileId;

  showModal({
    title: nameOf(sub),
    render: (body, close) => {
      const name = el("input", { class: "field-input", maxlength: "40", value: profile.name || "" });
      const number = el("input", { class: "field-input", maxlength: "5", inputmode: "numeric", value: profile.teamNumber || "" });
      const team = el("select", { class: "field-input" }, [
        el("option", { value: "" }, "No team"),
        ...Object.keys(store.state.groups || {}).map((id) => el("option", { value: id, selected: id === currentTeam }, teamNameOf(id)))
      ]);
      const teamAdmin = el("input", { type: "checkbox", checked: Boolean(currentTeam && isTeamAdmin(sub, currentTeam)) });
      const siteAdmin = el("input", { type: "checkbox", checked: (store.state.globalAdminIds || []).includes(sub) });
      const points = el("input", { class: "field-input", type: "number", step: "0.5", value: eventAdj.points ?? "", placeholder: "0" });
      const reason = el("input", { class: "field-input", maxlength: "200", value: eventAdj.reason || "", placeholder: "e.g. replayed match" });

      const save = () => {
        const newName = name.value.trim();
        if (!newName) return toast("A player needs a name", "error");
        const newTeam = team.value;
        const pts = points.value === "" ? 0 : Number(points.value);
        if (!Number.isFinite(pts)) return toast("Points must be a number", "error");
        const why = reason.value.trim();
        change((state) => {
          state.profiles[sub] = { ...(state.profiles[sub] || {}), name: newName, teamNumber: number.value.replace(/\D/g, "") };
          const previous = state.profileTeams[sub];
          if (previous && previous !== newTeam && state.teamAdmins[previous]) state.teamAdmins[previous] = state.teamAdmins[previous].filter((id) => id !== sub);
          if (newTeam) state.profileTeams[sub] = newTeam;
          else delete state.profileTeams[sub];
          if (newTeam) {
            const admins = (state.teamAdmins[newTeam] || []).filter((id) => id !== sub);
            state.teamAdmins[newTeam] = teamAdmin.checked ? [...admins, sub] : admins;
          }
          state.globalAdminIds = state.globalAdminIds.filter((id) => id !== sub);
          if (siteAdmin.checked) state.globalAdminIds.push(sub);
          if (event.key) {
            const existing = state.pointAdjustments[sub];
            const perEvent = existing && typeof existing === "object" ? { ...existing } : {};
            if (pts || why) perEvent[event.key] = { points: pts, reason: why };
            else delete perEvent[event.key];
            if (Object.keys(perEvent).length) state.pointAdjustments[sub] = perEvent;
            else delete state.pointAdjustments[sub];
          }
        }, `${newName} saved`);
        close();
      };

      fill(
        body,
        el("p", { class: "muted small" }, [
          account?.email || "Email not known yet - it appears after their next sign-in",
          account?.lastActiveAt ? ` · active ${ago(account.lastActiveAt)}` : "",
          ` · ${picksCount(sub)} picks`
        ]),
        field("Display name", name),
        field("FRC team number", number),
        field("Team", team),
        el("label", { class: "check-row" }, [teamAdmin, el("span", {}, "Admin of this team")]),
        el("label", { class: "check-row" }, [
          siteAdmin,
          el("span", {}, [el("strong", {}, "Site admin"), el("span", { class: "muted small block" }, self ? "This is you - removing it takes away your admin access (unless you're listed in the server's GLOBAL_ADMIN_EMAILS)." : "Can manage everything in this Admin tab.")])
        ]),
        event.key
          ? el("div", { class: "team-card" }, [
              el("h4", {}, `Points adjustment at ${event.name}`),
              el("p", { class: "muted small" }, `Added to (or, if negative, taken from) their score at this event. Currently ${pointsAtEvent(sub)} pts including any adjustment.`),
              field("Points", points),
              field("Reason (optional, shown to admins)", reason)
            ])
          : el("p", { class: "muted small" }, "Choose an event on the Matches tab to adjust points for it."),
        el("div", { class: "modal-actions" }, [button("Save", save, "load-btn"), button("Cancel", close)]),
        el("h5", { class: "danger-heading" }, "Danger zone"),
        el("div", { class: "modal-actions" }, [
          button("Sign out everywhere", async () => {
            try {
              const { revoked } = await api.revokeSessions(sub);
              toast(`Signed out of ${revoked} session${revoked === 1 ? "" : "s"}`);
            } catch {
              toast("Couldn't sign them out right now", "error");
            }
          }),
          self
            ? null
            : button(
                "Delete player",
                async () => {
                  if (!(await confirmDialog(`Delete ${nameOf(sub)}? Their profile, every pick and their team memberships are removed, and they're signed out. If they sign in again they start from scratch.`, { title: "Delete player", confirmLabel: "Delete player", danger: true }))) return;
                  const result = await change(removePlayer(sub), `${nameOf(sub)} deleted`);
                  if (result.ok) api.revokeSessions(sub).catch(() => {});
                  close();
                },
                "danger-btn"
              )
        ])
      );
    }
  });
}

// Filter rows in place: the admin panel never redraws while someone is typing,
// so a search that re-rendered would just appear to do nothing.
function applySearch(list) {
  const q = query.trim().toLowerCase();
  let visible = 0;
  for (const node of list.querySelectorAll("[data-search]")) {
    const match = !q || node.dataset.search.includes(q);
    node.classList.toggle("hidden", !match);
    if (match) visible += 1;
  }
  list.querySelector(".no-match")?.classList.toggle("hidden", visible > 0 || !q);
}

export function playersSection(rerender) {
  needAccounts(rerender);
  const ids = allPlayerIds();
  const eventName = runtime.event.key ? runtime.event.name : "";
  const list = el("div", {}, [
    ...ids.map((sub) => {
      const teamId = store.state.profileTeams?.[sub];
      const points = pointsAtEvent(sub);
      const email = accounts.bySub[sub]?.email;
      const node = row(
        el("div", { class: "grow" }, [
          el("strong", {}, nameOf(sub)),
          sub === store.profileId ? el("span", { class: "tag tag-pick you" }, "You") : null,
          isSiteAdmin(sub) ? el("span", { class: "tag tag-muted you" }, "Site admin") : null,
          el("div", { class: "muted small" }, [email || (accounts.loaded ? "email unknown" : "loading email..."), ` \u00b7 ${teamId ? teamNameOf(teamId) : "no team"} \u00b7 ${picksCount(sub)} picks`, points === null ? "" : ` \u00b7 ${points} pts`])
        ]),
        button("Edit", () => openPlayer(sub), "load-btn")
      );
      node.dataset.search = [nameOf(sub), email || "", teamNameOf(teamId)].join(" ").toLowerCase();
      return node;
    }),
    el("p", { class: "muted no-match hidden" }, "Nobody matches that search.")
  ]);
  const search = el("input", { type: "search", class: "field-input", placeholder: "Search by name, email or team", "aria-label": "Search players", value: query, oninput: (e) => ((query = e.target.value), applySearch(list)) });
  applySearch(list);

  return [
    card(
      `Players (${ids.length})`,
      search,
      eventName ? el("p", { class: "muted small" }, `Points shown are for ${eventName}.`) : null,
      list,
      ids.length ? null : el("p", { class: "muted" }, "No players yet.")
    )
  ];
}
