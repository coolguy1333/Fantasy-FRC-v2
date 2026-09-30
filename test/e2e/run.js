// Browser tests: drive the real app in headless Chromium with Google and TBA stubbed.
// Optional - Playwright isn't an app dependency. Install it (npm i -D playwright, or globally)
// and its Chromium, or point CHROMIUM_PATH at a Chromium binary.
const { spawnSync } = require("child_process");
const path = require("path");
const { available } = require("./rig");

if (!available) {
  console.log("Skipping browser tests: Playwright isn't installed (npm i -D playwright && npx playwright install chromium).");
  process.exit(0);
}

const scripts = ["guest-and-sync.js", "session.js", "teams-admin-bracket.js", "guest-picks.js"];
let failed = 0;
for (const script of scripts) {
  console.log(`\n=== ${script}`);
  const run = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: "inherit", timeout: 300000 });
  if (run.status !== 0) failed += 1;
}
console.log(failed ? `\n${failed} browser test file(s) failed` : "\nAll browser tests passed");
process.exit(failed ? 1 : 0);
