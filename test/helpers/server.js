const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function token(sub, extra = {}) {
  return `x.${b64({ sub, email: `${sub}@example.com`, email_verified: true, name: sub, exp: Math.floor(Date.now() / 1000) + 3600, ...extra })}.y`;
}

let nextPort = 18000 + Math.floor(Math.random() * 1000);

async function startServer(env = {}) {
  const port = nextPort++;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrc-test-"));
  const child = spawn(process.execPath, ["--require", path.join(__dirname, "stub-external.js"), path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir, GOOGLE_CLIENT_ID: "test-client", TBA_API_KEY: "test-key", GLOBAL_ADMIN_EMAILS: "", ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (log.includes("listening")) break;
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 50));
  }

  async function call(method, urlPath, { tok, body, headers = {} } = {}) {
    const res = await fetch(base + urlPath, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  }

  return {
    base, port, dataDir, call, log: () => log,
    stop: () => new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGTERM"); }),
    cleanup() { fs.rmSync(dataDir, { recursive: true, force: true }); }
  };
}

module.exports = { startServer, token };
