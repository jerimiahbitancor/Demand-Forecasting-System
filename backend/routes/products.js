// routes/products.js
//
// Merge duplicate products (owner's v3 flowchart, page 4). Product CRUD
// itself stays at /api/mapping/products.
//
//   GET  /api/products/duplicates                 "Possible duplicates" suggestions
//   GET  /api/products/modifier-keywords          keywords from modifier_rules
//   GET  /api/products/:id/merge-preview?targetId=&modifierKeyword=   counts only
//   GET  /api/products/settings                   { mergeEnabled } for the UI
//   POST /api/products/:id/merge  { targetId, modifierKeyword? }      runs the merge
//
// All require a login. The merge is one database transaction
// (public.merge_products); afterwards every product's status is recomputed.
// POST .../merge answers 403 MERGE_DISABLED unless PRODUCT_MERGE_ENABLED is
// true (utils/featureFlags.js); preview, duplicates and settings stay
// read-only and always work.

const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const mappingService = require('../services/mappingService');
const {
  getMergePreview, mergeProducts, listModifierKeywords, getPossibleDuplicates, MergeError,
} = require('../services/productMergeService');

const { productMergeEnabled } = require('../utils/featureFlags');

const MERGE_DISABLED_MESSAGE = 'Combining products is turned off for now. You can still preview what would change.';
const actorOf = (req) => req.user?.name || req.user?.email || null;
const toId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
};

function sendError(res, error, fallback) {
  if (error instanceof MergeError) {
    return res.status(error.status).json({ success: false, error: error.message });
  }
  console.error(fallback, error);
  return res.status(500).json({ success: false, error: fallback });
}

router.get('/duplicates', authenticate, async (req, res) => {
  try {
    const pairs = await getPossibleDuplicates(supabaseAdmin);
    res.json({ success: true, data: { pairs } });
  } catch (error) {
    sendError(res, error, 'Could not look for possible duplicates');
  }
});

router.get('/modifier-keywords', authenticate, async (req, res) => {
  try {
    res.json({ success: true, data: { keywords: await listModifierKeywords(supabaseAdmin) } });
  } catch (error) {
    sendError(res, error, 'Could not load the modifier keywords');
  }
});

router.get('/:id/merge-preview', authenticate, async (req, res) => {
  try {
    const data = await getMergePreview(supabaseAdmin, {
      sourceId: toId(req.params.id),
      targetId: toId(req.query.targetId),
      modifierKeyword: req.query.modifierKeyword || null,
    });
    res.json({ success: true, data });
  } catch (error) {
    sendError(res, error, 'Could not preview this combine');
  }
});

// GET /api/products/settings — what the Product Management page needs to
// know about merging (the Merge into... button is shown but disabled while
// merging is off).
router.get('/settings', authenticate, (req, res) => {
  res.json({ success: true, data: { mergeEnabled: productMergeEnabled(), mergeDisabledMessage: MERGE_DISABLED_MESSAGE } });
});

router.post('/:id/merge', authenticate, async (req, res) => {
  // PRODUCT_MERGE_ENABLED (default off): merge_products() is live in the
  // database, but merges wait until after the defense. Checked before
  // anything else, so the database function is never reached.
  if (!productMergeEnabled()) {
    return res.status(403).json({
      success: false, code: 'MERGE_DISABLED', message: MERGE_DISABLED_MESSAGE, error: MERGE_DISABLED_MESSAGE,
    });
  }
  try {
    const { targetId, modifierKeyword } = req.body || {};
    const userId = req.user?.user_id || req.user?.id || null;
    const out = await mergeProducts(
      supabaseAdmin,
      { sourceId: toId(req.params.id), targetId: toId(targetId), modifierKeyword: modifierKeyword || null, actor: actorOf(req) },
      {
        afterMerge: async () => {
          const refreshed = await mappingService.reconcileProductActivation();
          const numericId = await mappingService.getNumericUserId(userId);
          if (numericId) mappingService.clearSession(numericId);
          return refreshed;
        },
      }
    );
    res.json({ success: true, data: out });
  } catch (error) {
    sendError(res, error, 'Combining failed. Nothing was changed.');
  }
});

module.exports = router;
