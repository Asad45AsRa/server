const express = require('express');
const router  = express.Router();
const { protect }   = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole }  = require('../config/constants');

const {
  getMenu,
  getTables,
  initializeTables,      // ✅ NEW — 30 tables per floor banao
  resetTableOccupancy,   // ✅ NEW — sari tables free karo (new shift)
  getDeliveryBoys,
  createOrder,
  getMyOrders,
  updateOrder,
  markDelivered,
  getOrderSlip,
  deleteOrder,
  requestPrint,
  acknowledgeOrderUpdate,
} = require('../controllers/waiterController');

router.use(protect);
router.use(checkRole(UserRole.WAITER));

// ── Menu ──────────────────────────────────────────────────────────
router.get('/menu', getMenu);

// ── Tables ───────────────────────────────────────────────────────
router.get('/tables',             getTables);

// ✅ NEW: Ek baar chalao → 4 floors × 30 tables = 120 tables create
// POST /api/waiter/tables/initialize
router.post('/tables/initialize', initializeTables);

// ✅ NEW: Shift shuru karte waqt sari tables free karo
// POST /api/waiter/tables/reset
router.post('/tables/reset',      resetTableOccupancy);

// ── Delivery boys (MUST be before /:id style routes) ─────────────
router.get('/delivery-boys', getDeliveryBoys);

// ── Orders — specific routes FIRST, then /:id ────────────────────
router.post('/orders',                     createOrder);
router.get('/orders/my-orders',            getMyOrders);

// ✅ acknowledge-update — /:id se PEHLE warna Express id samajh leta
router.post('/orders/acknowledge-update',  acknowledgeOrderUpdate);

router.put('/orders/:id/deliver',          markDelivered);
router.get('/orders/:id/slip',             getOrderSlip);
router.post('/orders/:id/print-request',   requestPrint);
router.put('/orders/:id',                  updateOrder);
router.delete('/orders/:id',               deleteOrder);

module.exports = router;