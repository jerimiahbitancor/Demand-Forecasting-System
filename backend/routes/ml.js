// routes/ml.js
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const mlService = require('../services/mlService');
const { createNotification } = require('../services/notificationService');
const { supabaseAdmin } = require('../config/supabase');

const userIdOf = (req) => req.user?.user_id || req.user?.id || null;

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
      createNotification({
        userId: userIdOf(req),
        type: 'pending',
        title: 'Training on hold',
        message: 'The most recent upload has not finished processing yet — training will not start until it completes.',
        link: '/data-management',
        metadata: { kind: 'training', status: 'deferred' },
      });
      return res.status(409).json({
        success: false,
        error: 'The most recent upload has not finished processing yet',
        uploadStatus: latestUpload.status,
      });
    }

    createNotification({
      userId: userIdOf(req),
      type: 'pending',
      title: 'Forecast model training started',
      message: 'Training the forecast model on your uploaded data — you will be notified when it finishes.',
      link: '/analytics',
      metadata: { kind: 'training', status: 'started' },
    });

    const result = await mlService.train();

    createNotification({
      userId: userIdOf(req),
      type: 'success',
      title: 'Forecast model training completed',
      message: 'Training finished successfully — the forecast model is ready for the current data.',
      link: '/analytics',
      metadata: { kind: 'training', status: 'completed' },
    });

    res.json({ success: true, data: result });
  } catch (error) {
    createNotification({
      userId: userIdOf(req),
      type: 'error',
      title: 'Model training failed',
      message: `Forecast training failed — ${(error && error.message) || 'check data quality.'}`,
      link: '/analytics',
      metadata: { kind: 'training', status: 'failed' },
    });
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

    createNotification({
      userId: userIdOf(req),
      type: 'success',
      title: 'Forecast report is ready',
      message: `Forecast${horizonDays === 7 ? ' for the next week' : ' for today'} has been generated and saved. Check the Forecasts page to review it.`,
      link: '/analytics',
      metadata: { kind: 'forecast', status: 'ready', horizon_days: horizonDays || 1 },
    });

    res.json({ success: true, data: result });
  } catch (error) {
    createNotification({
      userId: userIdOf(req),
      type: 'error',
      title: 'Forecast generation failed',
      message: `Could not generate the forecast — ${(error && error.message) || 'check data quality or model availability.'}`,
      link: '/analytics',
      metadata: { kind: 'forecast', status: 'failed' },
    });
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
