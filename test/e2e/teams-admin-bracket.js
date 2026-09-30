const { open } = require("./rig");
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
(async () => {
  const rig = await open();
  const boss = rig.token("boss", { email: "boss@example.com" });
  const serverState = async () => (await rig.s.call("GET", "/api/state", { tok: boss })).json.payload;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- first visit: help open until an event is chosen; no "null" text anywhere
  let page = await rig.newPage();
  await page.goto(rig.s.base);
  await page.waitForSelector("#howToPlay");
  check("rules open on a first visit with no event", await page.evaluate(() => document.getElementById("howToPlay").open));
  check("empty state invites choosing an event", (await page.locator("#matchesEmpty").innerText()).includes("Choose an event"));
  await page.selectOption("#eventRegionSelect", "2099demo");
  await page.waitForSelector(".match-row");
  check("rules tuck away once an event is chosen", !(await page.evaluate(() => document.getElementById("howToPlay").open)));
  check("open/locked/completed sections with counts", (await page.locator(".match-section h3").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")).join("|").match(/Open for picks.*Locked or in progress.*Completed/) !== null);
  const done = page.locator(".match-section", { has: page.locator("h3", { hasText: "Completed" }) }).locator(".match-row").first();
  check("finished match names its winner", (await done.locator(".tag-won").count()) === 1);
  check("no literal 'null' on the page", !(await page.evaluate(() => document.body.innerText)).includes("null"));

  // ---- create a team from the welcome dialog; the invite link is offered right away
  page = await rig.newPage();
  await page.goto(rig.s.base);
  await rig.signIn(page, "fay", "Fay Founder");
  await page.waitForSelector(".modal-card");
  check("welcome dialog is a labelled dialog", (await page.locator(".modal-card").getAttribute("role")) === "dialog");
  check("dialog has no 'null' text", !(await page.locator(".modal-card").innerText()).includes("null"));
  await page.fill('input[aria-label="New team name"]', "Team 1114 Simbotics");
  await page.click("text=Create team");
  await page.waitForSelector(".modal-card .invite-row input");
  const link = await page.locator(".modal-card .invite-row input").inputValue();
  check("invite link shown after creating a team", /\/\?team=[A-Z0-9]{5}$/.test(link), link);
  await page.fill('input[value="Fay Founder"]', "Fay F.");
  await page.click("button:has-text('Save')");
  await wait(600);
  const st = await serverState();
  check("team saved with fay as its only admin", Object.values(st.groups).some((g) => g.name === "Team 1114 Simbotics") && Object.values(st.teamAdmins).some((a) => a.length === 1 && a[0] === "fay"));
  check("display name saved", st.profiles.fay.name === "Fay F.");
  const strangerCodes = (await rig.s.call("GET", "/api/state", { tok: rig.token("stranger") })).json.payload.teamInviteCodes;
  check("a stranger can't read any team code", Object.keys(strangerCodes).length === 0, JSON.stringify(strangerCodes));

  // ---- a second person follows the invite link
  const inviteUrl = link;
  page = await rig.newPage();
  await page.goto(inviteUrl);
  await page.waitForTimeout(500);
  check("signed-out invitee is told why to sign in", (await page.locator("#inviteBanner").innerText()).toLowerCase().includes("invited"));
  await rig.signIn(page, "gus", "Gus Guest");
  await page.waitForSelector(".modal-card");
  check("invite code is prefilled in the welcome dialog", (await page.locator(".code-input").inputValue()).length === 5);
  await page.locator(".modal-card button", { hasText: /^Join$/ }).click();
  await page.waitForSelector(".modal-card .team-name");
  await page.click("button:has-text('Save')");
  await wait(600);
  check("invitee joined through the server", (await serverState()).profileTeams.gus !== undefined);
  check("invite param cleared from the URL", !page.url().includes("team="));

  // ---- leave team needs confirmation
  await page.click("#headerProfileBtn");
  await page.click(".menu-item >> text=Profile & team");
  await page.click("button:has-text('Leave team')");
  await page.waitForSelector("text=Leave team >> nth=1");
  await page.click(".modal-card >> nth=1 >> button:has-text('Cancel')");
  await wait(300);
  check("cancelling keeps the team", (await serverState()).profileTeams.gus !== undefined);
  await page.click("button:has-text('Leave team')");
  await page.click(".modal-card >> nth=1 >> button:has-text('Leave team')");
  await wait(600);
  check("confirming leaves the team", (await serverState()).profileTeams.gus === undefined);
  await page.keyboard.press("Escape");

  // ---- admin: checklist, confirm before delete
  page = await rig.newPage();
  await page.goto(rig.s.base);
  await rig.signIn(page, "boss", "Coach Rivera");
  await page.click('[data-tab="adminTab"]');
  await page.waitForSelector(".check");
  const checklist = await page.locator(".admin-section").first().innerText();
  check("setup checklist lists Google, origin, TBA, HTTPS", ["Google sign-in", "Authorized JavaScript origin", "Live event data", "HTTPS"].every((t) => checklist.includes(t)) && checklist.includes(rig.s.base));
  const teamsBefore = Object.keys((await serverState()).groups).length;
  await page.locator(".admin-row", { hasText: "Team 1114" }).locator("button:has-text('Delete')").click();
  await page.click(".modal-card >> button:has-text('Cancel')");
  await wait(300);
  check("cancel keeps the team", Object.keys((await serverState()).groups).length === teamsBefore);
  await page.locator(".admin-row", { hasText: "Team 1114" }).locator("button:has-text('Delete')").click();
  await page.click(".modal-card >> button:has-text('Delete team')");
  await wait(600);
  check("confirm deletes it", Object.keys((await serverState()).groups).length === teamsBefore - 1);
  check("feedback shows contact details", (await page.locator(".feedback-item").first().innerText()).length > 0 && (await page.locator(".feedback-item a[href^='mailto:']").count()) === 1);

  // ---- playoffs: real TBA shape grades every decided game; undecided games can't be picked
  page = await rig.newPage();
  await page.goto(rig.s.base);
  await page.selectOption("#eventRegionSelect", "2099playoffs");
  await rig.signIn(page, "ava", "Ava Chen");
  await page.click("text=Skip for now").catch(() => {});
  await page.waitForSelector(".bracket-card");
  check("bracket is the default once qualifying is over", (await page.locator("#viewSwitch .seg-btn.active").innerText()) === "Playoff bracket");
  check("all six played games show as final", (await page.locator(".bracket-card.state-played").count()) === 6);
  check("games waiting on earlier ones are not pickable", (await page.locator(".bracket-card.state-tbd .alliance-btn:not([disabled])").count()) === 0);
  check("an open game is pickable", (await page.locator(".bracket-card.state-open .alliance-btn:not([disabled])").count()) >= 2);
  await page.locator(".bracket-card.state-open .alliance-red").first().click();
  await wait(700);
  check("bracket pick saved under <event>:<game>", Object.keys((await serverState()).bracketPicksByProfile.ava).some((k) => k.startsWith("2099playoffs:")));
  await page.click('#viewSwitch [data-view="matches"]');
  check("switching to the match list works", (await page.locator("#matchesView .match-row").count()) > 0);

  // ---- save indicator
  await page.click('#viewSwitch [data-view="bracket"]');
  await page.locator(".bracket-card.state-open .alliance-blue").first().click();
  await page.waitForFunction(() => /Saving|Saved/.test(document.getElementById("saveStatus").textContent), null, { timeout: 4000 }).catch(() => {});
  check("save indicator appears", /Saving|Saved/.test(await page.locator("#saveStatus").textContent()));

  check("no uncaught page errors", page.errors.length === 0, page.errors.join(" | "));
  await rig.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
