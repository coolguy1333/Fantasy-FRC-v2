// Preloaded (node --require) into a child server process so tests never touch
// Google or The Blue Alliance. Tokens are "x.<base64url json claims>.y".
const { OAuth2Client } = require("google-auth-library");

OAuth2Client.prototype.verifyIdToken = async ({ idToken }) => {
  const claims = JSON.parse(Buffer.from(String(idToken).split(".")[1] || "", "base64url").toString() || "null");
  if (!claims || claims.bad) throw new Error("Invalid token signature");
  if (claims.exp * 1000 < Date.now()) throw new Error("Token used too late");
  return { getPayload: () => claims };
};

const nowSec = () => Math.floor(Date.now() / 1000);
const match = (key, level, num, time, red, blue) => ({
  key, comp_level: level, match_number: num, time,
  alliances: {
    red: { score: red, team_keys: ["frc1", "frc2", "frc3"] },
    blue: { score: blue, team_keys: ["frc4", "frc5", "frc6"] }
  }
});

// Fixture event "2099test": one played, one locked-by-window, one open, one far in the future.
function fixtureMatches() {
  const t = nowSec();
  return [
    match("2099test_qm1", "qm", 1, t - 3600, 90, 70),
    match("2099test_qm2", "qm", 2, t + 300, -1, -1),
    match("2099test_qm3", "qm", 3, t + 7200, -1, -1),
    match("2099test_qm4", "qm", 4, t + 9000, -1, -1)
  ];
}

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith("https://www.thebluealliance.com/api/v3")) return realFetch(url, opts);
  const path = u.replace("https://www.thebluealliance.com/api/v3", "");
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (path === "/event/2099test/matches") return json(fixtureMatches());
  if (/^\/events\/\d{4}\/simple$/.test(path)) return json([{ key: "2099test", name: "Test Event", country: "USA", state_prov: "CA", start_date: "2000-01-01", end_date: "2100-01-01" }]);
  return json({ Error: "not found" }, 404);
};
