const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getAllInventory,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,        // ✅ NEW
  restockInventory,
  getLowStockItems,
  assignInventoryToChef
} = require('../controllers/inventoryController');

router.use(protect);

// ── READ: Saray authenticated users inventory dekh sakte hain ─────────────
router.get('/', getAllInventory);
router.get('/low-stock', getLowStockItems);

// ── WRITE: Sirf authorized roles ──────────────────────────────────────────
router.post('/',
  checkRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, 'inventory_officer'),
  createInventoryItem
);
router.put('/:id',
  checkRole(UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, 'inventory_officer'),
  updateInventoryItem
);
router.put('/:id/restock',
  checkRole(UserRole.ADMIN, UserRole.MANAGER, 'inventory_officer'),
  restockInventory
);
router.post('/assign-chef',
  checkRole(UserRole.ADMIN, UserRole.MANAGER, 'inventory_officer'),
  assignInventoryToChef
);

// ✅ NEW: Delete — sirf Admin, Manager, aur Inventory Officer kar sakta hai
router.delete('/:id',
  checkRole(UserRole.ADMIN, UserRole.MANAGER, 'inventory_officer'),
  deleteInventoryItem
);

module.exports = router;