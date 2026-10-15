const fs = require("fs");
const os = require("os");
const path = require("path");
const { open, startServer, token, chromium, executablePath } = require("./rig");

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const rig = await open();
  const bossTok = token("boss", { email: "boss@example.com" });
  const state = async () => (await rig.s.call("GET", "/api/state", { tok: bossTok })).json.payload;

  const page = await rig.newPage();
  await page.goto(rig.s.base);
  await page.selectOption("#eventRegionSelect", "2099demo");
  await page.waitForSelector(".match-row");
  await rig.signIn(page, "boss", "Coach Rivera");
  await page.click("#headerProfileBtn");
  check("menu shows the role", (await page.locator("#headerProfilePanel").innerText()).toLowerCase().includes("site admin"));
  await page.click(".menu-item >> text=Admin");
  await page.waitForSelector(".admin-nav");
  const section = async (name) => { await page.click(`.admin-nav button:has-text("${name}")`); await wait(300); };
  check("site admin sees every section", (await page.locator(".admin-nav button").allInnerTexts()).join(",") === "Overview,Players,Teams,Picks,Feedback,Settings");
  check("overview counts players", (await page.locator("#adminPanel .score-card").first().innerText()).includes("6"));

  // ---- players: search filters while typing, edit saves name + adjustment
  await section("Players");
  await page.fill('input[aria-label="Search players"]', "ava");
  check("search filters as you type", (await page.locator("#adminPanel .admin-row:not(.hidden)").count()) === 1);
  await page.locator(".admin-row", { hasText: "Ava Chen" }).locator("button:has-text('Edit')").click();
  await page.waitForSelector(".modal-card");
  await page.locator(".modal-card .field", { hasText: "Display name" }).locator("input").fill("Ava C.");
  await page.locator(".modal-card .field", { hasText: "Points" }).first().locator("input").fill("2");
  await page.locator(".modal-card .field", { hasText: "Reason" }).locator("input").fill("Replayed match");
  await page.click(".modal-card button:has-text('Save')");
  await wait(800);
  let s = await state();
  check("player renamed", s.profiles.ava.name === "Ava C.");
  check("points adjusted for this event", s.pointAdjustments.ava?.["2099demo"]?.points === 2 && s.pointAdjustments.ava["2099demo"].reason === "Replayed match");
  await page.click('[data-tab="leaderboardTab"]');
  await wait(300);
  check("leaderboard includes the adjustment", (await page.locator("tr", { hasText: "Ava C." }).innerText()).includes("16"));
  await page.click('[data-tab="adminTab"]');

  // ---- teams: create, add member, promote, delete
  await section("Teams");
  await page.fill('input[aria-label="New team name"]', "Team 118 Robonauts");
  await page.click("button:has-text('Create team')");
  await wait(800);
  check("team created", Object.values((await state()).groups).some((g) => g.name === "Team 118 Robonauts"));
  await page.locator(".admin-row", { hasText: "Team 118" }).locator("button:has-text('Manage')").click();
  await page.waitForSelector(".modal-card .team-manager");
  const deeSub = "dee";
  await page.selectOption('select[aria-label="Player to add"]', deeSub);
  await page.click(".modal-card button:has-text('Add to team')");
  await wait(800);
  const t118 = Object.entries((await state()).groups).find(([, g]) => g.name === "Team 118 Robonauts")[0];
  check("player added to team", (await state()).profileTeams.dee === t118);
  await page.locator(".modal-card .admin-row", { hasText: "Dee" }).locator("button:has-text('Make admin')").click();
  await wait(800);
  check("member made team admin", (await state()).teamAdmins[t118].includes("dee"));
  await page.click(".modal-card button:has-text('Delete team')");
  await page.click(".modal-card >> nth=1 >> button:has-text('Delete team')");
  await wait(800);
  s = await state();
  check("team deleted and its member released", !s.groups[t118] && !s.profileTeams.dee);
  await page.keyboard.press("Escape").catch(() => {});

  // ---- picks: lock overrides apply to players at once; editing someone's pick
  await section("Picks");
  await page.locator(".admin-row", { hasText: "Qual 14" }).locator("select").selectOption("locked");
  await wait(800);
  await page.locator(".admin-row", { hasText: "Qual 12" }).locator("select").selectOption("open");
  await wait(800);
  s = await state();
  check("overrides saved", s.adminByEvent["2099demo"].locks["2099demo_qm14"] === "locked" && s.adminByEvent["2099demo"].locks["2099demo_qm12"] === "open");
  const ava = await rig.newPage();
  await ava.goto(rig.s.base);
  await ava.selectOption("#eventRegionSelect", "2099demo");
  await rig.signIn(ava, "ava", "Ava C.");
  await ava.waitForSelector(".match-row");
  const card = (label) => ava.locator(".match-row", { has: ava.locator(".match-label", { hasText: new RegExp(`^${label}$`) }) });
  check("force-locked match can't be picked", (await card("Qual 14").locator(".alliance-btn:not([disabled])").count()) === 0 && (await card("Qual 14").innerText()).includes("Locked by an admin"));
  check("kept-open match can be picked", (await card("Qual 12").locator(".alliance-btn:not([disabled])").count()) === 2);
  await card("Qual 12").locator(".alliance-red").click();
  await wait(800);
  check("server accepts a pick on a kept-open match", (await state()).predictionsByProfile.ava["2099demo_qm12"]?.winner === "red");
  await page.locator(".admin-row", { hasText: "Qual 3" }).first().locator("button:has-text('Picks')").click();
  await page.waitForSelector(".pick-edit-row");
  await page.selectOption('select[aria-label="Dee Nakamura\'s pick"]', "blue");
  await page.click(".modal-card button:has-text('Save')");
  await wait(800);
  const dee3 = (await state()).predictionsByProfile.dee["2099demo_qm3"];
  check("admin can fix a pick on a finished match", dee3.winner === "blue" && dee3.editedByAdmin === true);

  // ---- feedback
  await section("Feedback");
  await page.locator(".feedback-item").first().locator("button:has-text('Mark handled')").click();
  await wait(800);
  check("feedback marked handled", (await state()).feedback.filter((f) => f.handled).length === 1);
  check("open filter hides it", (await page.locator(".feedback-item").count()) === 1);
  await page.locator(".feedback-item").first().locator("button:has-text('Delete')").click();
  await page.click(".modal-card button:has-text('Delete')");
  await wait(800);
  check("feedback deleted", (await state()).feedback.length === 1);

  // ---- settings: announcement + featured event reach a brand-new guest
  await section("Settings");
  await page.fill('textarea[aria-label="Announcement"]', "Picks for the finals open at noon!");
  await page.click("button:has-text('Publish')");
  await wait(800);
  await page.click("button:has-text('Feature this event')");
  await wait(800);
  const guest = await rig.newPage();
  await guest.goto(rig.s.base);
  await guest.waitForSelector(".match-row");
  check("new visitors start on the featured event", (await guest.locator("#eventRegionSelect").inputValue()) === "2099demo");
  check("announcement shown to guests", (await guest.locator("#announcement").innerText()).includes("finals open at noon"));
  await guest.click("#announcement button");
  await guest.reload();
  await wait(800);
  check("dismissed announcement stays dismissed", await guest.locator("#announcement").evaluate((el) => el.classList.contains("hidden")));

  // ---- backup and restore
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Download backup')")]);
  const file = path.join(os.tmpdir(), `ffrc-backup-${Date.now()}.json`);
  await download.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  check("backup holds the whole document", backup.state.profiles.ava.name === "Ava C." && backup.app === "fantasy-frc");
  backup.state.profiles.ben.name = "Restored Ben";
  fs.writeFileSync(file, JSON.stringify(backup));
  await page.setInputFiles('input[type="file"]', file);
  await page.click(".modal-card button:has-text('Replace everything')");
  await wait(1000);
  check("restore replaces the data", (await state()).profiles.ben.name === "Restored Ben");
  fs.rmSync(file, { force: true });

  // ---- delete a player (also signs them out)
  const eli = await rig.newPage();
  await eli.goto(rig.s.base);
  await rig.signIn(eli, "eli", "Eli Brooks");
  await section("Players");
  await page.fill('input[aria-label="Search players"]', "");
  await page.locator(".admin-row", { hasText: "Eli Brooks" }).locator("button:has-text('Edit')").click();
  await page.click(".modal-card button:has-text('Delete player')");
  await page.click(".modal-card >> nth=1 >> button:has-text('Delete player')");
  await wait(1000);
  s = await state();
  check("player and their picks removed", !s.profiles.eli && !s.predictionsByProfile.eli && !s.profileTeams.eli);
  check("their sessions are revoked", (await eli.evaluate(async () => (await fetch("/api/auth/session")).json())).user === null);

  // ---- a team admin sees only their team
  await ava.click('[data-tab="adminTab"]');
  await wait(400);
  check("team admin sees only their team", (await ava.locator(".admin-nav").count()) === 0 && (await ava.locator(".team-manager").count()) === 1);
  const codeBefore = (await state()).teamInviteCodes.t254;
  await ava.click("button:has-text('New code')");
  await ava.click(".modal-card button:has-text('Make new code')");
  await wait(800);
  check("team admin can replace the invite code", (await state()).teamInviteCodes.t254 !== codeBefore);

  check("no uncaught page errors", [page, ava, guest, eli].every((p) => p.errors.length === 0), [page, ava, guest, eli].flatMap((p) => p.errors).join(" | "));
  await rig.close();

  // ---- the setup code, through the UI, on a site with no admins configured
  const s2 = await startServer({ GLOBAL_ADMIN_EMAILS: "" });
  const code = /Admin setup code: ([A-Z0-9-]+)/.exec(s2.log())[1];
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: "window.google={accounts:{id:{initialize:(o)=>{window.__cb=o.callback},renderButton(){},prompt(){},disableAutoSelect(){}}}};" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const owner = await ctx.newPage();
  await owner.goto(s2.base);
  await owner.waitForFunction(() => window.__cb);
  await owner.evaluate((t) => window.__cb({ credential: t }), token("owner", { name: "Site Owner" }));
  await owner.click("text=Skip for now");
  check("no Admin tab before claiming", await owner.locator("#nav-admin").evaluate((el) => el.classList.contains("hidden")));
  await owner.click("#headerProfileBtn");
  await owner.click(".menu-item >> text=Profile & team");
  await owner.click("summary:has-text('Become its admin')");
  await owner.fill('input[aria-label="Admin setup code"]', code);
  await owner.click("button:has-text('Become admin')");
  await owner.waitForFunction(() => !document.getElementById("nav-admin").classList.contains("hidden"), null, { timeout: 5000 }).catch(() => {});
  check("setup code in the profile makes you a site admin", !(await owner.locator("#nav-admin").evaluate((el) => el.classList.contains("hidden"))));
  await browser.close();
  await s2.stop();
  s2.cleanup();

  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
