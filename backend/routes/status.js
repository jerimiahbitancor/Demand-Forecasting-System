// routes/status.js
//
// GET /api/status — logged-in only. Every part of the system in one
// answer (see services/statusService.js). The public GET /health in
// server.js stays as it is, for the platform's liveness probe.

const express = require('express');
const logger = require('../utils/logger');

function createStatusRouter({ authenticate, getStatusService }) {
  const router = express.Router();

  router.get('/', authenticate, async (req, res) => {
    try {
      const data = await getStatusService().getStatus();
      res.json({ success: true, data });
    } catch (err) {
      // getStatus() isolates each check, so this is only reached if the
      // engine itself breaks.
      logger.error('status_failed', { err });
      res.status(500).json({ success: false, error: 'Could not build the status report', requestId: req.id });
    }
  });

  return router;
}

module.exports = createStatusRouter({
  authenticate: require('../middleware/auth'),
  getStatusService: () => require('../services/statusService').getDefaultStatusService(),
});
module.exports.createStatusRouter = createStatusRouter;
