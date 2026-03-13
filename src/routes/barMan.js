const express = require('express');
const router  = express.Router();
const { protect }   = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const ctrl = require('../controllers/barmanController');
 
// ColdDrink controller — barman apna stock dekh sake, restock bhi kar sake
// (jab inventory officer se maal aaye)
const coldDrinkCtrl = require('../controllers/Colddrinkcontroller');
 
router.use(protect);
router.use(checkRole('barman'));
 
// ── Orders ───────────────────────────────────────────────────────────────────
// Pending = cold drinks deliver nahi ki abhi tak
router.get('/orders/pending',    ctrl.getPendingOrders);
 
// My orders = is barman ne accept ki hain
router.get('/orders/my-orders',  ctrl.getMyOrders);
 
// History = deliver ho gayi orders
router.get('/orders/completed',  ctrl.getCompletedOrders);
 
// ── MAIN ACTION: Cold drinks deliver karo ─────────────────────────────────
// POST body: { orderId }
router.post('/orders/deliver',   ctrl.deliverColdDrinks);
 
// Single order detail — /:id ALWAYS LAST
router.get('/orders/:id',        ctrl.getOrderById);
 
// ── Cold Drinks Stock ─────────────────────────────────────────────────────
// Barman apni branch ka full cold drink stock dekhe
router.get('/cold-drinks',       ctrl.getColdDrinksStock);
 
// Barman mobile menu ke liye (jo stock available hai)
router.get('/cold-drinks/mobile', coldDrinkCtrl.getColdDrinksForMobile);
 
// Barman cold drink restock kar sakta hai (inventory officer se maal aane pe)
// PUT /api/barman/cold-drinks/:id/sizes/:sizeId/restock
// body: { quantity, purchasePrice?, expiryDate? }
router.put('/cold-drinks/:id/sizes/:sizeId/restock', coldDrinkCtrl.restockSize);
 
module.exports = router;