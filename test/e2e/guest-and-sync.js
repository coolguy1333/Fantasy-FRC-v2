const { chromium, executablePath, startServer, token } = require("./rig");

const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };

(async () => {
  const s = await startServer({ GLOBAL_ADMIN_EMAILS: "boss@example.com" });
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: `
    window.google={accounts:{id:{initialize:(o)=>{window.__cb=o.callback},renderButton(){},prompt(){window.__prompts=(window.__prompts||0)+1},disableAutoSelect(){}}}};` }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  const alice = token("alice");
  const api = async (method, p, tok, body) => (await s.call(method, p, { tok, body })).json;
  const serverState = async () => (await api("GET", "/api/state", token("boss"))).payload;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const signedIn = () => page.evaluate(() => !document.getElementById("headerProfileWrap").classList.contains("hidden"));
  async function selectEvent() {
    await page.waitForFunction(() => document.querySelectorAll("#eventRegionSelect option").length > 1);
    await page.selectOption("#eventRegionSelect", "2099test");
    await page.waitForSelector(".match-row");
  }
  const rowFor = (label) => page.locator(".match-row", { has: page.locator(".match-label", { hasText: label }) });

  // ---------- guest
  await page.goto(s.base);
  await page.click('[data-tab="leaderboardTab"]');
  check("leaderboard asks a guest with no event to pick one", (await page.locator("#leaderboardContent").innerText()).includes("Pick an event"));
  await page.click('[data-tab="matchesTab"]');
  await selectEvent();
  check("matches render for the selected event", (await page.locator(".match-row").count()) === 4);
  const qm4 = rowFor("Qual 4");
  const input = qm4.locator(".score-guess-input");
  await input.click();
  await input.pressSequentially("85", { delay: 1300 });   // slower than the 1s re-render tick
  check("typing a score is not wiped by the 1s re-render", (await input.inputValue()) === "85" && (await input.evaluate((el) => el === document.activeElement)));
  await page.keyboard.press("Tab");
  await wait(800);
  const guest = await page.evaluate(() => JSON.parse(localStorage.getItem("ffrc_guest_state_v1")));
  check("score saved to guest storage on blur", guest.predictionsByProfile.guest?.["2099test_qm4"]?.score === 85, JSON.stringify(guest.predictionsByProfile));
  await rowFor("Qual 3").locator(".alliance-red").click();
  check("alliance click registers", (await rowFor("Qual 3").locator(".alliance-red.picked").count()) === 1);
  await page.reload();
  await page.waitForSelector(".match-row");
  check("selected event survives a refresh", (await page.locator("#eventRegionSelect").inputValue()) === "2099test");
  check("guest picks survive a refresh", (await rowFor("Qual 3").locator(".alliance-red.picked").count()) === 1);
  await page.click("summary:has-text('Send feedback')");
  await page.fill("#feedbackMessage", "hello");
  await page.click("#feedbackForm button[type=submit]");
  check("guest feedback says to sign in", (await page.locator("#feedbackNotice").innerText()).includes("Sign in"));

  // ---------- sign in
  await page.waitForFunction(() => window.__cb);
  await page.evaluate((t) => window.__cb({ credential: t }), alice);
  await page.waitForFunction(() => !document.getElementById("headerProfileWrap").classList.contains("hidden"));
  await page.click("text=Skip for now");
  await page.waitForSelector("text=Bring your guest picks");     // this guest had made picks: the carry-over dialog appears
  await page.click(".modal-card button:has-text('Cancel')");
  check("signed in", await signedIn());
  await rowFor("Qual 4").locator(".alliance-blue").click();
  await wait(700);
  check("prediction reaches the server", (await serverState()).predictionsByProfile.alice?.["2099test_qm4"]?.winner === "blue");
  await page.reload();
  await page.waitForSelector(".match-row");
  await page.waitForFunction(() => !document.getElementById("headerProfileWrap").classList.contains("hidden"), null, { timeout: 5000 }).catch(() => {});
  check("STILL SIGNED IN after a refresh", await signedIn());
  check("server pick shows after refresh", (await rowFor("Qual 4").locator(".alliance-blue.picked").count()) === 1);

  // ---------- conflict: someone else saves, then we save from a stale copy
  const bobTok = token("bob");
  const b = await api("GET", "/api/state", bobTok);
  b.payload.profiles.bob = { name: "Bob" };
  await api("PUT", "/api/state", bobTok, { payload: b.payload, updatedAt: b.updatedAt });
  await rowFor("Qual 3").locator(".alliance-blue").click();
  await wait(1200);
  const after = await serverState();
  check("stale save rebases: my pick saved", after.predictionsByProfile.alice?.["2099test_qm3"]?.winner === "blue");
  check("stale save rebases: other user's data kept", after.profiles.bob?.name === "Bob");
  check("no error banner after a rebase", await page.locator("#serverStatusBanner").evaluate((el) => el.classList.contains("hidden")));

  // ---------- server-side lock rejection
  const outcome = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    const r = await store.mutate((st) => { st.predictionsByProfile[store.profileId]["2099test_qm2"] = { winner: "red" }; });
    return { r: { ok: r.ok, rejected: r.rejected }, undone: !store.state.predictionsByProfile[store.profileId]["2099test_qm2"], dirty: store.dirty, error: store.syncError };
  });
  check("locked pick is rejected and undone", outcome.r.rejected === true && outcome.undone && outcome.dirty === false && outcome.error === "rejected", JSON.stringify(outcome));
  check("user is told why", (await page.locator("#serverStatusBanner").innerText()).includes("locked"));

  // ---------- feedback + privacy
  await page.click("summary:has-text('Send feedback')").catch(() => {});
  await page.fill("#feedbackMessage", "great app");
  await page.fill("#feedbackContact", "alice@private.example");
  await page.click("#feedbackForm button[type=submit]");
  await page.waitForFunction(() => document.getElementById("feedbackNotice").textContent.includes("Thanks"));
  check("signed-in feedback is delivered", (await serverState()).feedback.some((f) => f.message === "great app" && f.profileId === "alice"));
  const aliceView = await page.evaluate(async () => (await import("/js/store.js")).store.state.feedback.length);
  check("non-admin's copy of state has no feedback", aliceView === 0);

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await browser.close(); await s.stop(); s.cleanup();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
