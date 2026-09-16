// routes/ml.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const mlService = require('../services/mlService');
const { supabaseAdmin } = require('../config/supabase');

function respondWithMlError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);
  const status = error instanceof mlService.MlServiceError ? error.status : 500;
  res.status(status).json({
    success: false,
    error: error.message || fallbackMessage,
    details: error.details,
  });
}

// POST /api/ml/train — the owner-facing "Start Training" button.
// Manual only, per the confirmed design (never auto-triggered on a
// data threshold). Before calling ml-service, verifies the most recent
// upload actually finished — otherwise a click during an in-flight
// upload could train against a half-written dataset. The separate
// "12 months of history" gate is enforced inside ml-service's own
// /train (see ml-service/app.py) since it needs to inspect the actual
// pooled data, not just upload status.
router.post('/train', authenticate, async (req, res) => {
  try {
    const { data: latestUpload, error } = await supabaseAdmin
      .from('uploads')
      .select('id, status, upload_date')
      .order('upload_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (latestUpload && latestUpload.status && latestUpload.status !== 'completed') {
      return res.status(409).json({
        success: false,
        error: 'The most recent upload has not finished processing yet',
        uploadStatus: latestUpload.status,
      });
    }

    const result = await mlService.train();
    res.json({ success: true, data: result });
  } catch (error) {
    respondWithMlError(res, error, 'Failed to trigger training');
  }
});

// POST /api/ml/forecast — { horizonDays: 1 | 7 }. 1 for the daily
// refresh (today only), 7 for the weekly Monday run (this week,
// Mon-Sun) — see generate_forecast()'s docstring in forecast_service.py
// for exactly what each does. Intended callers: a scheduled job for
// the real 8AM/Monday runs, and this same route for an owner-triggered
// manual refresh.
router.post('/forecast', authenticate, async (req, res) => {
  try {
    const { horizonDays, runType } = req.body || {};
    const result = await mlService.forecast({ horizonDays, runType });
    res.json({ success: true, data: result });
  } catch (error) {
    respondWithMlError(res, error, 'Failed to trigger forecast');
  }
});

// GET /api/ml/health — lets the frontend show "ML service offline"
// before the owner even clicks Start Training, instead of only finding
// out after a failed POST.
router.get('/health', authenticate, async (req, res) => {
  const isUp = await mlService.checkHealth();
  res.json({ success: true, data: { up: isUp } });
});

// GET /api/ml/training-status — lets the Dashboard poll whether the
// blocking POST /train call above is currently in flight.
router.get('/training-status', authenticate, async (req, res) => {
  res.json({ success: true, data: { isTraining: mlService.isTrainingInFlight() } });
});

module.exports = router;
