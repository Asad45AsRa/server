const express = require('express');
const router  = express.Router();
const { protect }    = require('../middlewares/auth');
const { checkRole }  = require('../middlewares/roleCheck');
const { UserRole }   = require('../config/constants');
const ctrl = require('../controllers/Colddrinkcontroller');

router.use(protect);

// ── READ: Saray authenticated users cold drinks dekh sakte hain ───────────
// Admin, Inventory Officer, Cashier, Manager, Waiter, Delivery — sab
router.get('/', ctrl.getAllColdDrinks);

// ── Mobile API (menu ke liye) ─────────────────────────────────────────────
router.get('/mobile', ctrl.getColdDrinksForMobile);

// ── WRITE: Sirf Admin aur Inventory Officer ───────────────────────────────
router.post('/',      checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.createColdDrink);
router.put('/:id',    checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.updateColdDrink);
router.delete('/:id', checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.deleteColdDrink);

// ── Size management: Sirf Admin aur Inventory Officer ────────────────────
router.post('/:id/sizes',                checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.addSize);
router.put('/:id/sizes/:sizeId',         checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.updateSize);
router.put('/:id/sizes/:sizeId/restock', checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.restockSize);
router.delete('/:id/sizes/:sizeId',      checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.deleteSize);

module.exports = router;