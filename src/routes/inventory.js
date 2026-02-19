const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getAllInventory,
  createInventoryItem,
  updateInventoryItem,
  restockInventory,
  getLowStockItems,
  assignInventoryToChef
} = require('../controllers/inventoryController');

router.use(protect);

// All authenticated users can view inventory
router.get('/', getAllInventory);

// Admin and Manager can manage inventory
router.post('/', checkRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, 'inventory_officer'), createInventoryItem);
router.put('/:id', checkRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, 'inventory_officer'), updateInventoryItem);
router.put('/:id/restock', checkRole(UserRole.ADMIN, UserRole.MANAGER, 'inventory_officer'), restockInventory);
router.get('/low-stock', checkRole(UserRole.ADMIN, UserRole.MANAGER, 'inventory_officer'), getLowStockItems);
router.post('/assign-chef', checkRole(UserRole.ADMIN, UserRole.MANAGER, 'inventory_officer'), assignInventoryToChef);

module.exports = router;