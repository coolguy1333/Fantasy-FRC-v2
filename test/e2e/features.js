// Crowd picks, clear pick, next unpicked, player card, season standings, recent
// results, light theme and the "new version" prompt - against the seeded demo league.
const { open } = require("./rig");

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const rig = await open();
  const bossTok = rig.token("boss", { email: "boss@example.com" });
  const state = async () => (await rig.s.call("GET", "/api/state", { tok: bossTok })).json.payload;

  const page = await rig.newPage();
  await page.goto(rig.s.base);
  await page.selectOption("#eventRegionSelect", "2099demo");
  await page.waitForSelector(".match-row");
  await rig.signIn(page, "ava", "Ava Chen");
  await page.waitForSelector(".match-row .crowd");
  const row = (label) => page.locator(".match-row", { has: page.locator(".match-label", { hasText: new RegExp(`^${label}$`) }) });

  // ---- crowd picks: shown once a match locks, never while it's open
  check("finished matches show how the crowd picked", (await row("Qual 10").locator(".crowd-text").innerText()).includes("5 picks"));
  check("open matches don't show the crowd", (await row("Qual 13").locator(".crowd").count()) === 0);

  // ---- clear pick and the score-only hint
  const q16 = row("Qual 16");
  await q16.locator(".alliance-red").click();
  await wait(700);
  check("pick saved", (await state()).predictionsByProfile.ava["2099demo_qm16"]?.winner === "red");
  await q16.locator(".clear-pick").click();
  await wait(700);
  check("Clear pick removes it from the server", !(await state()).predictionsByProfile.ava["2099demo_qm16"]);
  const q17 = row("Qual 17");
  await q17.locator(".score-guess-input").fill("90");
  await q17.locator(".score-guess-input").press("Tab");
  await wait(700);
  check("a score without a winner says it won't count", (await q17.locator(".score-guess-hint").count()) === 1);

  // ---- next unpicked
  await page.click(".next-unpicked");
  await wait(600);
  const focused = await page.evaluate(() => document.activeElement?.closest(".match-row")?.dataset.match);
  const ava = (await state()).predictionsByProfile.ava;
  check("Next unpicked jumps to an open match without a pick", Boolean(focused) && !ava[focused]?.winner, focused);

  // ---- leaderboard: only people who played, player card, season
  await page.click('[data-tab="leaderboardTab"]');
  await page.waitForSelector(".leaderboard-table");
  const names = await page.locator(".leaderboard-table .player-name").allInnerTexts();
  check("standings leave out people with no picks at the event", !names.includes("Coach Rivera") && names.includes("Ben Ortiz"), names.join(","));
  await page.click(".player-link:has-text('Ben Ortiz')");
  await page.waitForSelector(".modal-card .pick-row");
  const card = await page.locator(".modal-card").innerText();
  check("a player's card shows their stats and locked picks", card.includes("Accuracy") && card.includes("Qual 1"));
  check("a player's card never shows picks on open matches", !/Qual 1[345]\b/.test(card));
  await page.keyboard.press("Escape");
  await page.click("#leaderboardScope button:has-text('Season')");
  await page.waitForSelector(".leaderboard-table th:has-text('Events')");
  const avaEvents = await page.locator(".leaderboard-table tr", { hasText: "Ava Chen" }).locator("td.num").first().innerText();
  check("season standings add up every event with picks", (await page.locator("#leaderboardEvent").innerText()).includes("2099 season") && avaEvents === "2", avaEvents);

  // ---- recent results on My Score
  await page.click('[data-tab="scoreTab"]');
  check("My Score lists recent results", (await page.locator("#scoreContent .pick-row").count()) > 0);

  // ---- light theme, remembered
  await page.selectOption("#themeSelect", "light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("light theme applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light" && bg === "rgb(244, 245, 248)", bg);
  await page.reload();
  await page.waitForSelector("#themeSelect");
  check("theme is remembered", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light" && (await page.locator("#themeSelect").inputValue()) === "light");

  // ---- a deploy while the page is open
  const old = await rig.newPage();
  await old.route("**/api/runtime-config", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, build: "an-older-build" } });
  });
  await old.goto(rig.s.base);
  await old.selectOption("#eventRegionSelect", "2099demo");
  await old.waitForSelector("#updateBanner:not(.hidden)", { timeout: 8000 }).catch(() => {});
  check("an old tab is told a new version is available", (await old.locator("#updateBanner").innerText()).includes("new version"));

  check("no uncaught page errors", page.errors.length === 0 && old.errors.length === 0, [...page.errors, ...old.errors].join(" | "));
  await rig.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
