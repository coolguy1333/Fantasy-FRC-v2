const { open } = require("./rig");
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
(async () => {
  const rig = await open();
  const boss = rig.token("boss", { email: "boss@example.com" });
  const serverState = async () => (await rig.s.call("GET", "/api/state", { tok: boss })).json.payload;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = (page, label) => page.locator(".match-row", { has: page.locator(".match-label", { hasText: label }) });

  async function guestWithPicks() {
    const page = await rig.newPage();
    await page.goto(rig.s.base);
    await page.selectOption("#eventRegionSelect", "2099test");
    await page.waitForSelector(".match-row");
    await row(page, "Qual 3").locator(".alliance-red").click();
    await row(page, "Qual 4").locator(".alliance-blue").click();
    await wait(300);
    return page;
  }

  // ---- accept
  let page = await guestWithPicks();
  await rig.signIn(page, "hank", "Hank Hill");
  await page.click("text=Skip for now");
  await page.waitForSelector("text=Bring your guest picks");
  check("dialog offers to move 2 picks", (await page.locator(".modal-card").innerText()).includes("2 picks"));
  await page.click("button:has-text('Add my picks')");
  await wait(700);
  const st = await serverState();
  check("picks moved to the account", st.predictionsByProfile.hank?.["2099test_qm3"]?.winner === "red" && st.predictionsByProfile.hank?.["2099test_qm4"]?.winner === "blue");
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem("ffrc_guest_state_v1")).predictionsByProfile.guest);
  check("guest copy removed", Object.keys(left).length === 0, JSON.stringify(left));
  await page.reload();
  await wait(1200);
  check("not asked again", (await page.locator("text=Bring your guest picks").count()) === 0);

  // ---- decline
  page = await guestWithPicks();
  await rig.signIn(page, "ida", "Ida Inn");
  await page.click("text=Skip for now");
  await page.waitForSelector("text=Bring your guest picks");
  await page.click(".modal-card button:has-text('Cancel')");
  await wait(500);
  check("declining adds nothing", !(await serverState()).predictionsByProfile.ida);
  await page.reload();
  await wait(1200);
  check("declining is remembered", (await page.locator("text=Bring your guest picks").count()) === 0);

  // ---- a data hiccup at load must not look like being signed out
  const jane = await rig.newPage();
  await jane.goto(rig.s.base);
  await rig.signIn(jane, "jane", "Jane Doe");
  await jane.click("text=Skip for now");
  await wait(500);
  await jane.route("**/api/state**", (r) => r.request().method() === "GET" ? r.fulfill({ status: 503, json: { error: "down" } }) : r.continue());
  await jane.reload();
  await jane.waitForFunction(() => !document.body.classList.contains("auth-pending"));
  await wait(500);
  check("still shown as signed in", !(await jane.evaluate(() => document.getElementById("headerProfileWrap").classList.contains("hidden"))));
  check("banner explains the load problem", (await jane.locator("#serverStatusBanner").innerText()).includes("Couldn't load"));
  await jane.unroute("**/api/state**");
  await jane.evaluate(async () => { await (await import("/js/store.js")).store.loadRemote({ force: true }); });
  await wait(300);
  check("banner clears once it can load", await jane.locator("#serverStatusBanner").evaluate((el) => el.classList.contains("hidden")));
  check("no uncaught page errors", jane.errors.length === 0 && page.errors.length === 0, jane.errors.concat(page.errors).join(" | "));
  await rig.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
