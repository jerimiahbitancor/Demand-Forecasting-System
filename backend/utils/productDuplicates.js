// utils/productDuplicates.js
//
// "Possible duplicates" for Product Management: pairs of NON-archived
// products whose names look alike. Suggestions only — the owner decides and
// merges by hand; nothing here changes data. Pure.
//
// Two names look alike when either:
//   * typo:         Fuse.js scores them <= TYPO_THRESHOLD and their lengths
//                   are within LENGTH_RATIO of each other — "Cheesy Spicy
//                   Hunggarian" / "Cheesy Spicy Hungarian". The length check
//                   stops a name matching a longer name that merely starts
//                   with it ("Add Chili" / "Add Chili Garlic").
//   * abbreviation: same words in the same order except one, where one word
//                   is an abbreviation of the other (same first letter, its
//                   letters appear in order) — "OG Tapsilog" / "Original
//                   Tapsilog".
// Ignored: pairs that differ only by a size word (Small / Medium / Large) or
// a modifier ("NO EGG", "NO FRIES", any modifier_rules keyword) — those are
// variants of one dish, not two spellings of it.

'use strict';

const Fuse = require('fuse.js');
const { productNameKey } = require('./productNameKey');

const TYPO_THRESHOLD = 0.25;
const LENGTH_RATIO = 0.8;
const SIZE_WORDS = ['small', 'medium', 'large'];

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Name with size words and modifiers removed, for the "only a variant" test.
// Any trailing "NO <word>" counts as a modifier even before it is a
// modifier_rules keyword ("Chick & Fries NO FRIES").
function variantBase(name, modifierKeywords = []) {
  let text = ` ${productNameKey(name)} `;
  for (const keyword of modifierKeywords) {
    const k = productNameKey(keyword);
    if (k) text = text.replace(new RegExp(`[\\s(,-]${escapeRegExp(k)}[\\s),]`, 'g'), ' ');
  }
  text = text.replace(/\sno\s+[a-z]+\s*$/, ' ');
  for (const word of SIZE_WORDS) text = text.replace(new RegExp(`\\s${word}(?=\\s)`, 'g'), ' ');
  // Brackets and separators left behind ("Porksilog - NO EGG") don't count.
  return text.replace(/[()[\],/\-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

const words = (name) => productNameKey(name).split(' ').filter(Boolean);

// "og" abbreviates "original": same first letter, letters in order, shorter.
function isAbbreviation(short, long) {
  if (!short || !long || short.length >= long.length || short[0] !== long[0]) return false;
  let i = 0;
  for (const ch of long) if (ch === short[i]) i += 1;
  return i === short.length;
}

function abbreviationMatch(a, b) {
  const wa = words(a);
  const wb = words(b);
  if (wa.length !== wb.length || wa.length < 2) return false;
  let differing = 0;
  for (let i = 0; i < wa.length; i += 1) {
    if (wa[i] === wb[i]) continue;
    differing += 1;
    if (differing > 1) return false;
    if (!isAbbreviation(wa[i], wb[i]) && !isAbbreviation(wb[i], wa[i])) return false;
  }
  return differing === 1;
}

/**
 * @param {Array<{ id, name, archived?: boolean, status?: string }>} products
 * @param {{ modifierKeywords?: string[] }} [options]
 * @returns {Array<{ a: {id, name}, b: {id, name}, reason: 'typo'|'abbreviation', score: number|null }>}
 *   Each pair once (lower id first), most alike first.
 */
function findPossibleDuplicates(products = [], { modifierKeywords = [] } = {}) {
  const live = products.filter((p) => p && p.name && !p.archived && p.status !== 'archived');
  const pairs = new Map();
  const add = (p, q, reason, score) => {
    const [a, b] = p.id < q.id ? [p, q] : [q, p];
    const key = `${a.id}-${b.id}`;
    if (pairs.has(key)) return;
    if (variantBase(a.name, modifierKeywords) === variantBase(b.name, modifierKeywords)) return;
    if (productNameKey(a.name) === productNameKey(b.name)) return;
    pairs.set(key, { a: { id: a.id, name: a.name }, b: { id: b.id, name: b.name }, reason, score });
  };

  const fuse = new Fuse(live, { keys: ['name'], threshold: TYPO_THRESHOLD, ignoreLocation: true, includeScore: true });
  for (const p of live) {
    for (const hit of fuse.search(p.name)) {
      const q = hit.item;
      if (q.id === p.id) continue;
      // Fuse's threshold is only a search cut-off; hits can still come back
      // scored above it, so the bar is applied to the score itself.
      if (!(hit.score <= TYPO_THRESHOLD)) continue;
      const la = p.name.trim().length;
      const lb = q.name.trim().length;
      if (Math.min(la, lb) / Math.max(la, lb) < LENGTH_RATIO) continue;
      add(p, q, 'typo', Math.round(hit.score * 1000) / 1000);
    }
  }

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      if (abbreviationMatch(live[i].name, live[j].name)) add(live[i], live[j], 'abbreviation', null);
    }
  }

  return [...pairs.values()].sort((x, y) => (x.score ?? 1) - (y.score ?? 1) || x.a.id - y.a.id);
}

module.exports = { findPossibleDuplicates, variantBase, abbreviationMatch, isAbbreviation };
