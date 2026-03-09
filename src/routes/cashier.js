// routes/cashier.js
const express = require('express');
const router  = express.Router();
const { protect }   = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole }  = require('../config/constants');

const {
  getPendingOrders,
  getCompletedOrders,
  receivePayment,
  getPaymentHistory,
  getPaymentSlip,
  getHourlyIncomeReport,
  updateOrderStatus,
  createOrder,              // ✅ NEW
  createProduct,
  updateProduct,
  getProducts,
  createDeal,
  updateDeal,
  getDeals,
  getTables,
  createTable,
  updateTable,
  deleteTable,
  seedTables,
  receiveAdvancePayment,
  completeAdvancePaidOrder,
  getOrderById,
} = require('../controllers/cashierController');

const {
  getAllCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  addAdvancePayment,
  creditPurchase,
  useBalance,
  clearDebt,
  getWalletSummary,
} = require('../controllers/walletController');

const coldDrinkCtrl = require('../controllers/Colddrinkcontroller');

router.use(protect);
router.use(checkRole(UserRole.CASHIER));

// ===== ORDERS — SPECIFIC ROUTES FIRST (before /:id) =====
router.get('/orders/pending',   getPendingOrders);
router.get('/orders/completed', getCompletedOrders);

// ✅ NEW: Create order from POS/cashier desktop
router.post('/orders',                          createOrder);

// Advance payment routes BEFORE /:id to avoid conflict
router.post('/orders/:id/advance-payment',      receiveAdvancePayment);
router.post('/orders/:id/complete-advance',     completeAdvancePaidOrder);
router.put('/orders/:id/status',                updateOrderStatus);

// Single order fetch (used by socket fallback + reprint)
router.get('/orders/:id',                       getOrderById);

// ===== PAYMENTS =====
router.post('/payment',         receivePayment);
router.get('/payments',         getPaymentHistory);
router.get('/payment-slip/:id', getPaymentSlip);

// ===== REPORTS =====
router.get('/reports/hourly-income', getHourlyIncomeReport);

// ===== PRODUCTS =====
router.post('/products',    createProduct);
router.put('/products/:id', updateProduct);
router.get('/products',     getProducts);

// ===== DEALS =====
router.post('/deals',    createDeal);
router.put('/deals/:id', updateDeal);
router.get('/deals',     getDeals);

// ===== TABLES — /tables/seed MUST be before /:id =====
router.post('/tables/seed',  seedTables);
router.get('/tables',        getTables);
router.post('/tables',       createTable);
router.put('/tables/:id',    updateTable);
router.delete('/tables/:id', deleteTable);

// ===== COLD DRINKS =====
router.get('/cold-drinks', coldDrinkCtrl.getAllColdDrinks);

// ===== CUSTOMER WALLET — /wallet/summary MUST be before /:id =====
router.get('/wallet/summary',           getWalletSummary);
router.get('/wallet',                   getAllCustomers);
router.get('/wallet/:id',               getCustomer);
router.post('/wallet',                  createCustomer);
router.put('/wallet/:id',               updateCustomer);
router.post('/wallet/:id/advance',      addAdvancePayment);
router.post('/wallet/:id/credit',       creditPurchase);
router.post('/wallet/:id/use-balance',  useBalance);
router.post('/wallet/:id/clear-debt',   clearDebt);

module.exports = router;