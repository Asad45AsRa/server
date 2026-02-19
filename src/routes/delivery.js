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
  updateOrder
} = require('../controllers/deliveryController');

router.use(protect);
router.use(checkRole(UserRole.DELIVERY));

router.get('/menu', getMenu);
router.post('/orders', createDeliveryOrder);
router.get('/orders/my-orders', getMyOrders);
router.put('/orders/status', updateOrderStatus);
router.put('/orders/:id', updateOrder);

module.exports = router;