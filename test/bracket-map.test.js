const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { gameIdForMatch, findGameMatch } = require("../server/state/locks");

// Load the browser's ES modules from a scratch copy so this works on any Node version.
async function loadClient() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrc-client-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  for (const file of ["scoring.js", "constants.js"]) fs.copyFileSync(path.join(__dirname, "..", "public", "js", file), path.join(dir, file));
  return import(pathToFileURL(path.join(dir, "scoring.js")).href);
}

// Shaped like The Blue Alliance: bracket games are comp_level "sf", numbered by set_number.
const sf = (set, match = 1, year = 2099) => ({ key: `${year}x_sf${set}m${match}`, comp_level: "sf", set_number: set, match_number: match });
const fin = (match) => ({ key: `2099x_f1m${match}`, comp_level: "f", set_number: 1, match_number: match });

test("every bracket game maps to its own id, from real TBA data", async () => {
  const client = await loadClient();
  const expected = ["u1", "u2", "u3", "u4", "l1", "l2", "u5", "u6", "l3", "l4", "u7", "l5", "l6"];
  expected.forEach((id, i) => {
    assert.equal(client.gameIdForMatch(sf(i + 1)), id);
    assert.equal(gameIdForMatch(sf(i + 1)), id);
  });
  [1, 2, 3].forEach((m) => {
    assert.equal(client.gameIdForMatch(fin(m)), `f${m}`);
    assert.equal(gameIdForMatch(fin(m)), `f${m}`);
  });
});

test("client and server agree on every input", async () => {
  const client = await loadClient();
  const cases = [];
  for (const level of ["qm", "qf", "sf", "f", "ef", "pm"]) {
    for (const set of [1, 2, 7, 13, 14]) {
      for (const match of [1, 2, 3, 4]) {
        for (const year of [2019, 2022, 2023, 2099]) cases.push({ key: `${year}x_${level}${set}m${match}`, comp_level: level, set_number: set, match_number: match });
      }
    }
  }
  cases.push({ key: "2099x_sf5m1", comp_level: "sf", match_number: 1 }); // no set_number: falls back to the key
  for (const m of cases) assert.equal(client.gameIdForMatch(m), gameIdForMatch(m), JSON.stringify(m));
});

test("pre-2023 events have no double-elimination bracket", async () => {
  const client = await loadClient();
  assert.equal(client.gameIdForMatch(sf(1, 1, 2019)), null);
  assert.equal(gameIdForMatch(sf(1, 1, 2019)), null);
});

test("a replayed game resolves to the replay", async () => {
  const client = await loadClient();
  const matches = [sf(5, 1), sf(5, 2), sf(6, 1)];
  assert.equal(client.findGameMatch(matches, "l1").match_number, 2);
  assert.equal(findGameMatch(matches, "l1").match_number, 2);
  assert.equal(client.findGameMatch(matches, "u1"), null);
});

test("a full bracket is graded per game, not collapsed onto u1", async () => {
  const client = await loadClient();
  const matches = [];
  for (let set = 1; set <= 6; set += 1) {
    matches.push({ ...sf(set), alliances: { red: { score: 80 }, blue: { score: 60 } } });
  }
  const picks = { u1: "red", u2: "red", u3: "blue", l1: "red" };
  const result = client.scoreBracket(matches, picks, {});
  assert.equal(result.gradedGames, 6);
  assert.equal(result.correctPicks, 3);
  assert.equal(result.points, 1 + 1 + 2);
});
