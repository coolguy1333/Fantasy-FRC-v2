// The site owner can always become an admin, even if GLOBAL_ADMIN_EMAILS is
// missing or mistyped: at startup the server prints a one-time setup code to its
// own log, which only the owner can read. Entering it in the app (profile menu)
// makes the signed-in account a global admin. It only works while nobody has been
// made an admin from inside the app, and a new code is generated on every start.

const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const raw = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
const SETUP_CODE = `${raw.slice(0, 4)}-${raw.slice(4)}`;

const claimAvailable = (state) => !(state.globalAdminEmails?.length || state.globalAdminIds?.length);

function checkSetupCode(input) {
  const given = Buffer.from(String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const expected = Buffer.from(raw);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = { SETUP_CODE, claimAvailable, checkSetupCode };
