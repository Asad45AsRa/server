const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const {
  getMenu,
  createDeliveryOrder,
  getMyOrders,
  updateOrderStatus,
  completeDelivery,
  updateOrder
} = require('../controllers/deliveryController');

router.use(protect);
router.use(checkRole(UserRole.DELIVERY));

router.get('/menu', getMenu);
router.post('/orders', createDeliveryOrder);
router.get('/orders/my-orders', getMyOrders);
router.put('/orders/status', updateOrderStatus);
router.put('/orders/complete', completeDelivery);
router.put('/orders/:id', updateOrder);   // Edit pending order (must be last to avoid conflicts)

module.exports = router;

///zdaJHY9i8At00Bta
//zdaJHY9i8At00Bta
//mongodb+srv://granasahib379_db_user:<db_password>@cluster0.otfqs7z.mongodb.net/?appName=Cluster0