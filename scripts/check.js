// Syntax-checks every server and browser script without running any of them.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const filesIn = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(path.join(dir, e.name)) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : []));

let failed = 0;
const check = (file, args, input) => {
  try {
    execFileSync(process.execPath, args, { input, stdio: ["pipe", "ignore", "pipe"] });
  } catch (err) {
    failed += 1;
    console.error(`${path.relative(root, file)}:\n${err.stderr}`);
  }
};
const server = filesIn(path.join(root, "server"));
const browser = filesIn(path.join(root, "public", "js"));
for (const file of server) check(file, ["--check", file]);
// The browser's files are ES modules; check them as such.
for (const file of browser) check(file, ["--input-type=module", "--check"], fs.readFileSync(file));
console.log(failed ? `${failed} file(s) with syntax errors` : `Syntax OK (${server.length + browser.length} files)`);
process.exit(failed ? 1 : 0);
