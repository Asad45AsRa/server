const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getPendingOrders,
  getMyOrders,
  acceptOrder,
  updateOrderStatus,
  getInventory,
  requestInventory,
  getMyRequests, 
  getMyInventory,
  updateItemUsage,
  returnInventory,
  getMyReturnHistory,
  submitReturnRequest,
  getMyReturnRequests
} = require('../controllers/chefController');

router.use(protect);
router.use(checkRole(UserRole.CHEF));

// Orders
router.get('/orders/pending', getPendingOrders);
router.get('/orders/my-orders', getMyOrders);
router.post('/orders/accept', acceptOrder);
router.put('/orders/status', updateOrderStatus);

// Inventory
router.get('/inventory', getInventory);
router.post('/inventory/request', requestInventory);
router.get('/inventory/my-requests', getMyRequests);

router.get('/my-inventory',         getMyInventory);
router.put('/my-inventory/use',     updateItemUsage);
router.post('/my-inventory/return', returnInventory);
router.get('/my-inventory/history', getMyReturnHistory);
router.get('/inventory',             getInventory);
router.post('/inventory/request',    requestInventory);
router.get('/inventory/my-requests', getMyRequests);
router.post('/inventory/return-request',  submitReturnRequest);
router.get('/inventory/return-requests',  getMyReturnRequests);

module.exports = router;
