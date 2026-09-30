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
const teams = (n) => [0, 1, 2].map((i) => `frc${100 + ((n * 3 + i) % 900)}`);
// Shaped like The Blue Alliance's match objects: quals are numbered by
// match_number; double-elimination playoff games are comp_level "sf" numbered by
// set_number 1-13 (match_number 1); finals are set 1, match_number 1-3.
const match = (key, level, num, time, red, blue, set = 1) => ({
  key, comp_level: level, set_number: set, match_number: num, time, predicted_time: time,
  alliances: {
    red: { score: red, team_keys: red === undefined ? [] : teams(num + set) },
    blue: { score: blue, team_keys: blue === undefined ? [] : teams(num + set + 40) }
  }
});

// Demo event "2099demo" for exploring the UI: a live qualification schedule.
function demoQuals() {
  const t = nowSec();
  const out = [];
  for (let i = 1; i <= 24; i += 1) {
    const time = t + (i - 11) * 8 * 60;
    const played = i <= 10;
    out.push(match(`2099demo_qm${i}`, "qm", i, time, played ? 40 + ((i * 7) % 50) : -1, played ? 35 + ((i * 11) % 55) : -1));
  }
  return out;
}

// Demo event "2099playoffs": quals done, double-elimination bracket part-way through.
function demoPlayoffs() {
  const t = nowSec();
  const out = [];
  for (let i = 1; i <= 6; i += 1) out.push(match(`2099playoffs_qm${i}`, "qm", i, t - 86400 + i * 480, 50 + i, 45 + i));
  const scores = [[88, 71], [64, 90], [102, 99], [75, 60], [55, 81], [93, 92]];
  for (let set = 1; set <= 6; set += 1) out.push(match(`2099playoffs_sf${set}m1`, "sf", 1, t - 7200 + set * 900, scores[set - 1][0], scores[set - 1][1], set));
  out.push(match("2099playoffs_sf7m1", "sf", 1, t + 1200, -1, -1, 7));
  out.push(match("2099playoffs_sf8m1", "sf", 1, t + 2400, -1, -1, 8));
  for (let set = 9; set <= 13; set += 1) out.push({ ...match(`2099playoffs_sf${set}m1`, "sf", 1, null, -1, -1, set), predicted_time: null, time: null, alliances: { red: { score: -1, team_keys: [] }, blue: { score: -1, team_keys: [] } } });
  for (let m = 1; m <= 3; m += 1) out.push({ ...match(`2099playoffs_f1m${m}`, "f", m, null, -1, -1, 1), predicted_time: null, time: null, alliances: { red: { score: -1, team_keys: [] }, blue: { score: -1, team_keys: [] } } });
  return out;
}

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
  if (path === "/event/2099demo/matches") return json(demoQuals());
  if (path === "/event/2099playoffs/matches") return json(demoPlayoffs());
  if (/^\/events\/\d{4}\/simple$/.test(path)) {
    const ev = (key, name, state) => ({ key, name, country: "USA", state_prov: state, start_date: "2000-01-01", end_date: "2100-01-01" });
    return json([ev("2099test", "Test Event", "CA"), ev("2099demo", "Silicon Valley Regional", "CA"), ev("2099playoffs", "Einstein Field Playoffs", "TX")]);
  }
  return json({ Error: "not found" }, 404);
};
