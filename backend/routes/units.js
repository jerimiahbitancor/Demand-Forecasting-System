const express = require('express');
const authenticateToken = require('../middleware/auth');
const { getUnits, createUnit, updateUnit } = require('../controllers/unitsController');

const router = express.Router();
router.use(authenticateToken);
router.get('/', getUnits);
router.post('/', createUnit);
router.put('/:id', updateUnit);

module.exports = router;