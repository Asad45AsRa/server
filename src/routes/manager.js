const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getDashboard,
  getBranchOrders,
  updateOrderStatus,
  getBranchStaff,
  getBranchInventory,
  getBranchProducts,
  updateBranchProduct,
  getBranchDeals,
  getBranchReports,
  getMyRights,
} = require('../controllers/managerController');

router.use(protect);
router.use(checkRole(UserRole.MANAGER));

// Always available
router.get('/dashboard', getDashboard);
router.get('/my-rights', getMyRights);

// Orders (requires orders or parcel right - checked inside controller)
router.get('/orders', getBranchOrders);
router.put('/orders/:id/status', updateOrderStatus);

// Staff (requires staff right)
router.get('/staff', getBranchStaff);

// Inventory (requires inventory right)
router.get('/inventory', getBranchInventory);

// Products (requires products right)
router.get('/products', getBranchProducts);
router.put('/products/:id', updateBranchProduct);

// Deals (requires deals right)
router.get('/deals', getBranchDeals);

// Reports (requires reports right)
router.get('/reports', getBranchReports);

module.exports = router;

////ahmad556sahib_db_user
//d8NrZTEYycMEb3IU