// routes/inventory.js
const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const {
  getInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  archiveInventoryItem,
  restoreInventoryItem,
  restockInventoryItem,
  getItemTransactions
} = require('../controllers/inventoryController');

// All routes require authentication
router.use(authenticateToken);

// Inventory routes
router.get('/items', getInventoryItems);
router.get('/items/:id', getInventoryItem);
router.post('/items', createInventoryItem);
router.put('/items/:id', updateInventoryItem);
router.delete('/items/:id', deleteInventoryItem);
router.patch('/items/:id/archive', archiveInventoryItem);
router.patch('/items/:id/restore', restoreInventoryItem);
router.post('/items/:id/restock', restockInventoryItem);
router.get('/items/:id/transactions', getItemTransactions);

module.exports = router;