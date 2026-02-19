const express = require('express');
const router  = express.Router();
const { protect }    = require('../middlewares/auth');
const { checkRole }  = require('../middlewares/roleCheck');
const { UserRole }   = require('../config/constants');
const ctrl = require('../controllers/Colddrinkcontroller');

router.use(protect);

// ── Inventory Officer & Admin: Full CRUD ──────────────────────────────────
router.get('/',    checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.getAllColdDrinks);
router.post('/',   checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.createColdDrink);
router.put('/:id', checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.updateColdDrink);
router.delete('/:id', checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.deleteColdDrink);

// Size management
router.post('/:id/sizes',                    checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.addSize);
router.put('/:id/sizes/:sizeId',             checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.updateSize);
router.put('/:id/sizes/:sizeId/restock',     checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.restockSize);
router.delete('/:id/sizes/:sizeId',          checkRole(UserRole.ADMIN, 'inventory_officer'), ctrl.deleteSize);

// ── Mobile API endpoint (used by mobile app to build menu) ────────────────
// Mobile app will call: GET /api/cold-drinks/mobile?branchId=xxx
router.get('/mobile', ctrl.getColdDrinksForMobile);

module.exports = router;