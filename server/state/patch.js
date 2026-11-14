// Small writes and reads of the shared document. Instead of sending the whole
// document for every pick, a client sends only what changed, per domain and key:
//
//   { [domain]: { set: { [key]: value }, unset: [key, ...] } }   object domains
//   { [domain]: { value: <whole new value> } }                   arrays / booleans
//
// The server answers polls the same way. Keep in sync with public/js/patch.js
// (test/patch.test.js fails if the two drift).
const { DOMAINS } = require("./schema");

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function diffState(prev, next) {
  const patch = {};
  for (const domain of DOMAINS) {
    const a = prev?.[domain];
    const b = next?.[domain];
    if (isPlainObject(a) && isPlainObject(b)) {
      const set = {};
      const unset = [];
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (!has(b, key)) unset.push(key);
        else if (!has(a, key) || !same(a[key], b[key])) set[key] = b[key];
      }
      const entry = {};
      if (Object.keys(set).length) entry.set = set;
      if (unset.length) entry.unset = unset;
      if (entry.set || entry.unset) patch[domain] = entry;
    } else if (!same(a, b)) {
      patch[domain] = { value: b };
    }
  }
  return patch;
}

// Throws { status: 400 } on anything that isn't a well-formed patch.
function checkPatch(patch) {
  const bad = (detail) => Object.assign(new Error("invalid_patch"), { status: 400, detail });
  if (!isPlainObject(patch)) throw bad("not_an_object");
  for (const [domain, entry] of Object.entries(patch)) {
    if (!DOMAINS.includes(domain)) throw bad(`unknown_domain:${domain}`);
    if (!isPlainObject(entry)) throw bad(`entry:${domain}`);
    if (has(entry, "value")) {
      if (has(entry, "set") || has(entry, "unset")) throw bad(`mixed:${domain}`);
      continue;
    }
    if (has(entry, "set") && !isPlainObject(entry.set)) throw bad(`set:${domain}`);
    if (has(entry, "unset") && !(Array.isArray(entry.unset) && entry.unset.every((k) => typeof k === "string"))) throw bad(`unset:${domain}`);
    const keys = [...Object.keys(entry.set || {}), ...(entry.unset || [])];
    const forbidden = keys.find((k) => FORBIDDEN_KEYS.has(k));
    if (forbidden) throw bad(`key:${forbidden}`);
  }
}

// Returns a new state with the patch applied; `state` itself is not modified.
function applyPatch(state, patch) {
  checkPatch(patch);
  const out = { ...state };
  for (const [domain, entry] of Object.entries(patch)) {
    if (has(entry, "value")) {
      out[domain] = entry.value;
      continue;
    }
    const target = isPlainObject(out[domain]) ? { ...out[domain] } : {};
    for (const [key, value] of Object.entries(entry.set || {})) target[key] = value;
    for (const key of entry.unset || []) delete target[key];
    out[domain] = target;
  }
  return out;
}

// One patch with the effect of applying `patches` in order.
function mergePatches(patches) {
  const merged = {};
  for (const patch of patches) {
    for (const [domain, entry] of Object.entries(patch)) {
      if (has(entry, "value")) {
        merged[domain] = { value: entry.value };
        continue;
      }
      const into = merged[domain] && !has(merged[domain], "value") ? merged[domain] : { set: {}, unset: [] };
      if (merged[domain] && has(merged[domain], "value")) {
        // A keyed change on top of a whole value: fold it into the value.
        merged[domain] = { value: applyPatch({ [domain]: merged[domain].value }, { [domain]: entry })[domain] };
        continue;
      }
      into.set = into.set || {};
      into.unset = into.unset || [];
      for (const [key, value] of Object.entries(entry.set || {})) {
        into.set[key] = value;
        into.unset = into.unset.filter((k) => k !== key);
      }
      for (const key of entry.unset || []) {
        delete into.set[key];
        if (!into.unset.includes(key)) into.unset.push(key);
      }
      merged[domain] = into;
    }
  }
  for (const entry of Object.values(merged)) {
    if (entry.set && !Object.keys(entry.set).length) delete entry.set;
    if (entry.unset && !entry.unset.length) delete entry.unset;
  }
  return merged;
}

module.exports = { diffState, applyPatch, checkPatch, mergePatches };
