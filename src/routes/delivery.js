// routes/deliver.js
const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getMenu,
  createDeliveryOrder,
  getMyOrders,
  getUnassignedOrders,   // ✅ ADD
  claimOrder,            // ✅ ADD
  updateOrderStatus,
  completeDelivery,
  updateOrder,
  getDeliveryHistory
} = require('../controllers/deliveryController');

router.use(protect);
router.use(checkRole(UserRole.DELIVERY));

router.get('/menu', getMenu);
router.post('/orders', createDeliveryOrder);
router.get('/orders/my-orders', getMyOrders);
router.get('/orders/unassigned', getUnassignedOrders);   // ✅ ADD — specific pehle
router.put('/orders/claim', claimOrder);                  // ✅ ADD
router.put('/orders/status', updateOrderStatus);
router.put('/orders/complete', completeDelivery);
router.get('/orders/history', getDeliveryHistory);
router.put('/orders/:id', updateOrder);   // /:id HAMESHA LAST

module.exports = router;

///zdaJHY9i8At00Bta
//zdaJHY9i8At00Bta
//mongodb+srv://granasahib379_db_user:<db_password>@cluster0.otfqs7z.mongodb.net/?appName=Cluster0