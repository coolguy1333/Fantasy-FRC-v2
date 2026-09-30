const path = require("path");
const Database = require("better-sqlite3");
const { open } = require("./rig");
const results = [];
const check = (name, ok, extra = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`); };
(async () => {
  const rig = await open();
  const page = await rig.newPage();
  await page.addInitScript(() => {
    window.__flash = false;
    const check = () => {
      const p = document.querySelector(".auth-panel"), w = document.getElementById("headerProfileWrap");
      if (p && w && getComputedStyle(p).visibility !== "hidden" && getComputedStyle(p).display !== "none" && w.classList.contains("hidden")) window.__flash = true;
    };
    document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(function loop() { check(); requestAnimationFrame(loop); }));
  });
  const signedIn = () => page.evaluate(() => !document.getElementById("headerProfileWrap").classList.contains("hidden"));
  await page.goto(rig.s.base);
  await rig.signIn(page, "ava", "Ava Chen");
  check("signed in", await signedIn());

  // Block Google entirely and reload: the saved session must not need it.
  await page.context().route("https://accounts.google.com/**", (r) => r.abort());
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains("auth-pending"));
  check("restored with Google's script blocked", await signedIn());
  check("no signed-out flash while restoring", (await page.evaluate(() => window.__flash)) === false);
  const name = await page.evaluate(async () => (await import("/js/store.js")).store.user.name);
  check("restored the right person", name === "Ava Chen");

  // Revoke on the server: the next poll/save must say so instead of silently failing.
  const db = new Database(path.join(rig.s.dataDir, "fantasyfrc.db"));
  db.prepare("DELETE FROM sessions").run(); db.close();
  const outcome = await page.evaluate(async () => {
    const { store } = await import("/js/store.js");
    const r = await store.mutate((st) => { st.profiles[store.profileId] = { ...(st.profiles[store.profileId] || {}), name: "Ava C." }; });
    return { ok: r.ok, error: store.syncError, dirty: store.dirty };
  });
  check("revoked session is reported, change kept locally", outcome.ok === false && outcome.error === "session_expired" && outcome.dirty === true, JSON.stringify(outcome));
  check("banner explains it", (await page.locator("#serverStatusBanner").innerText()).toLowerCase().includes("sign"));

  // Sign in again: the queued change is pushed, not lost.
  await page.context().unroute("https://accounts.google.com/**");
  await page.evaluate(async (t) => { const { store } = await import("/js/store.js"); await store.signIn(t); }, rig.token("ava", { name: "Ava Chen" }));
  await page.waitForTimeout(500);
  const saved = (await rig.s.call("GET", "/api/state", { tok: rig.token("boss", { email: "boss@example.com" }) })).json.payload.profiles.ava.name;
  check("queued change delivered after signing back in", saved === "Ava C.", saved);

  // Sign out for real: stays signed out after a refresh.
  await page.evaluate(async () => { (await import("/js/store.js")).store.signOut(); });
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains("auth-pending"));
  check("sign-out sticks across a refresh", (await signedIn()) === false);
  check("no uncaught page errors", page.errors.length === 0, page.errors.join(" | "));
  await rig.close();
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
