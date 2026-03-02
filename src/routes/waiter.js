const express = require('express');
const router = express.Router();
const { protect }   = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole }  = require('../config/constants');

const {
  getMenu,
  getTables,
  getDeliveryBoys,
  createOrder,
  getMyOrders,
  updateOrder,
  markDelivered,
  getOrderSlip,
  deleteOrder,
  requestPrint,
  acknowledgeOrderUpdate,   // ✅ NEW
} = require('../controllers/waiterController');

router.use(protect);
router.use(checkRole(UserRole.WAITER));

// Menu
router.get('/menu', getMenu);

// Tables
router.get('/tables', getTables);

// Delivery boys — MUST be before /:id style routes
router.get('/delivery-boys', getDeliveryBoys);

// Orders — specific routes FIRST, then /:id
router.post('/orders',                        createOrder);
router.get('/orders/my-orders',               getMyOrders);
// ✅ NEW: Chef ke "Dekh Liya" button se updatedByWaiter flag clear hota hai
// NOTE: yeh route /:id se PEHLE hona chahiye warna Express isko id samajh leta
router.post('/orders/acknowledge-update',     acknowledgeOrderUpdate);
router.put('/orders/:id/deliver',             markDelivered);
router.get('/orders/:id/slip',                getOrderSlip);
router.post('/orders/:id/print-request',      requestPrint);
router.put('/orders/:id',                     updateOrder);
router.delete('/orders/:id',                  deleteOrder);

module.exports = router;