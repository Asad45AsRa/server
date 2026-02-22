const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getMenu,
  getTables,
  createOrder,
  getMyOrders,
  updateOrder,
  deleteOrder,
  markDelivered,
  getOrderSlip,
} = require('../controllers/waiterController');

router.use(protect);
router.use(checkRole(UserRole.WAITER));

router.get('/menu',                  getMenu);
router.get('/tables',                getTables);
router.post('/orders',               createOrder);
router.get('/orders/my-orders',      getMyOrders);
router.put('/orders/:id',            updateOrder);
router.delete('/orders/:id',         deleteOrder);

// ✅ NEW: Waiter marks order as delivered
router.put('/orders/:id/deliver',    markDelivered);

// ✅ NEW: Waiter gets bill/slip data to print or share
router.get('/orders/:id/slip',       getOrderSlip);

module.exports = router;