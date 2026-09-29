// Shared rig for the browser tests: starts the real server (Google/TBA stubbed), seeds a small
// league of players/teams/picks, and exposes helpers. Also handy for taking screenshots.
const fs = require("fs");
const { startServer, token } = require("../helpers/server");

// Playwright is optional (it isn't a dependency of the app): use a local install, or a global one.
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    try {
      return require(require("path").join(require("child_process").execSync("npm root -g").toString().trim(), "playwright"));
    } catch {
      return null;
    }
  }
}
const playwright = loadPlaywright();
const chromium = playwright && playwright.chromium;
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const GOOGLE_STUB = `window.google={accounts:{id:{initialize:(o)=>{window.__cb=o.callback},renderButton(el){const b=document.createElement('div');b.textContent='[Google sign-in button]';b.style.cssText='padding:8px 16px;border:1px solid #888;border-radius:4px;background:#fff;color:#333;font:14px sans-serif;display:inline-block';el.appendChild(b)},prompt(){},disableAutoSelect(){}}}};`;

async function seed(s) {
  const boss = token("boss", { name: "Coach Rivera", email: "boss@example.com" });
  const { payload, updatedAt } = (await s.call("GET", "/api/state", { tok: boss })).json;
  const p = payload;
  const people = { boss: "Coach Rivera", ava: "Ava Chen", ben: "Ben Ortiz", cy: "Cy Patel", dee: "Dee Nakamura", eli: "Eli Brooks" };
  for (const [id, name] of Object.entries(people)) { p.profiles[id] = { name, teamNumber: id === "ava" || id === "ben" ? "254" : id === "cy" ? "1678" : "" }; p.profileSetupDone[id] = true; }
  p.groups = { t254: { name: "Team 254 Cheesy Poofs", createdAt: 1 }, t1678: { name: "Team 1678 Citrus Circuits", createdAt: 2 } };
  p.teamAdmins = { t254: ["ava"], t1678: ["cy"] };
  p.teamInviteCodes = { t254: "K7QM2", t1678: "R4XW9" };
  p.profileTeams = { ava: "t254", ben: "t254", cy: "t1678", eli: "t1678" };
  const winner = (i) => ((40 + ((i * 7) % 50)) > (35 + ((i * 11) % 55)) ? "red" : "blue");
  const guessers = { ava: 0, ben: 1, cy: 2, dee: 3, eli: 4 };
  for (const [id, skill] of Object.entries(guessers)) {
    p.predictionsByProfile[id] = {};
    for (let i = 1; i <= 10; i += 1) {
      const right = (i + skill) % 3 !== 0;
      const w = winner(i);
      p.predictionsByProfile[id][`2099demo_qm${i}`] = { winner: right ? w : w === "red" ? "blue" : "red", score: right ? (w === "red" ? 40 + ((i * 7) % 50) : 35 + ((i * 11) % 55)) + skill : null, predictedAt: 1 };
    }
    for (let i = 13; i <= 15; i += 1) p.predictionsByProfile[id][`2099demo_qm${i}`] = { winner: i % 2 ? "red" : "blue", predictedAt: 1 };
  }
  p.bracketPicksByProfile.ava = { "2099playoffs:u1": "red", "2099playoffs:u2": "blue", "2099playoffs:u3": "red", "2099playoffs:l1": "blue" };
  p.feedback = [
    { profileId: "ben", name: "Ben", contact: "ben@example.com", message: "Love it! Could we get a season-long leaderboard?", at: Date.now() - 3600e3 },
    { profileId: "dee", name: "", contact: "", message: "Score box is hard to tap on my phone.", at: Date.now() - 600e3 }
  ];
  const res = await s.call("PUT", "/api/state", { tok: boss, body: { payload: p, updatedAt } });
  if (res.status !== 200) throw new Error("seed failed " + JSON.stringify(res.json));
}

async function open({ mobile = false } = {}) {
  const s = await startServer({ GLOBAL_ADMIN_EMAILS: "boss@example.com" });
  await seed(s);
  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  const newPage = async () => {
    const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
    await ctx.route("https://accounts.google.com/gsi/client", (r) => r.fulfill({ contentType: "text/javascript", body: GOOGLE_STUB }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    return page;
  };
  const signIn = async (page, sub, name) => {
    await page.waitForFunction(() => window.__cb);
    await page.evaluate((t) => window.__cb({ credential: t }), token(sub, { name: name || sub, email: sub === "boss" ? "boss@example.com" : `${sub}@example.com` }));
    await page.waitForFunction(() => !document.getElementById("headerProfileWrap").classList.contains("hidden"));
  };
  return { s, browser, newPage, signIn, token, close: async () => { await browser.close(); await s.stop(); s.cleanup(); } };
}
module.exports = { open, chromium, executablePath, startServer, token, available: Boolean(chromium) };
