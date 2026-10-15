// Admin access is granted by email, so two spellings of the same inbox must
// match. Gmail ignores dots and "+tags" in the local part, and googlemail.com is
// gmail.com, so "First.Last+ffrc@googlemail.com" and "firstlast@gmail.com" are
// the same person. Lists may be separated by commas, semicolons or spaces, and
// people paste addresses with quotes or <angle brackets> around them.

function normalizeEmail(raw) {
  const email = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[\s"'<[(]+|[\s"'>\])]+$/g, "");
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.split("+")[0].replace(/\./g, "");
  return `${local}@${domain}`;
}

function parseList(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((v) => v.trim().replace(/^["'<[(]+|["'>\])]+$/g, ""))
    .filter(Boolean);
}

const parseEmailList = (value) => parseList(value).map(normalizeEmail).filter((e) => e.includes("@"));

// For logs: enough to recognise your own address, not enough to harvest it.
function maskEmail(email) {
  const at = email.indexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
}

module.exports = { normalizeEmail, parseList, parseEmailList, maskEmail };
