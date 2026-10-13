// backend/utils/ingredientMatch.js
//
// Shared fuzzy matching between DA "Daily Price Index" commodity names and the
// inventory's ingredient list. Used by:
//   * routes/marketPrices.js  — the receipt/price-list review screen (match
//     suggestions, never auto-saves);
//   * services/daPriceImportService.js — the scheduled importer, which ONLY
//     writes rows whose match clears the confidence bar below.
//
// Fuse's threshold is "reject anything scoring worse than this". 0.5 keeps
// plural/singular and word-order differences ("Pork, Ground" vs
// "Ground Pork") while dropping unrelated words; the flip side is that a
// passing score can still be a weak match, which is exactly what
// `confidence` (1 - score) and the <0.6 low-confidence highlight in the UI
// are for.
'use strict';

const Fuse = require('fuse.js');

const FUZZY_THRESHOLD = 0.5;
const CANDIDATE_COUNT = 5;

// DA commodity names embed their specification ("Galunggong, Local Male,
// Medium (12-14 pcs/kg)"), which a straight fuzzy search scores poorly against
// the ingredient's own short name. Searching the full string AND a stripped
// "core" (parentheticals removed, up to the first comma) and keeping the better
// hit lets both a clean "Basmati Rice" and a spec-heavy "Mango (Carabao) Ripe,
// 3-4 pcs/kg" land on the right ingredient.
const toCoreName = (name) =>
  String(name)
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim();

const createIngredientFuse = (ingredients) =>
  new Fuse(ingredients, {
    keys: ['name'],
    threshold: FUZZY_THRESHOLD,
    ignoreLocation: true,
    includeScore: true,
  });

// Nameless per-unit rows ("100/k") have no name to search — Fuse treats a
// non-string pattern as an extended-search expression (crash), so the guard is
// explicit; they reach review unassigned.
//
// `useCore` is opt-in: receipt lines are already short and must keep matching
// on their full text exactly as before, so only DA sheets (whose names carry a
// specification) search the stripped core as a second candidate.
const matchIngredient = (fuse, name, { useCore = false } = {}) => {
  if (!name) return { top: null, candidates: [] };

  const terms = [name];
  const core = useCore ? toCoreName(name) : name;
  if (core && core !== name) terms.push(core);

  let bestHits = [];
  for (const term of terms) {
    const hits = fuse.search(term);
    if (hits.length && (!bestHits.length || hits[0].score < bestHits[0].score)) {
      bestHits = hits;
    }
  }

  return {
    top: bestHits[0] || null,
    candidates: bestHits.slice(0, CANDIDATE_COUNT).map((hit) => ({
      id: hit.item.id,
      name: hit.item.name,
    })),
  };
};

const matchConfidence = (top) =>
  top ? Math.max(0, Math.min(1, 1 - top.score)) : 0;

module.exports = {
  FUZZY_THRESHOLD,
  CANDIDATE_COUNT,
  toCoreName,
  createIngredientFuse,
  matchIngredient,
  matchConfidence,
};