const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');

const {
  getPendingOrders,
  getCompletedOrders,
  receivePayment,
  getPaymentHistory,
  getPaymentSlip,
  getHourlyIncomeReport,
  updateOrderStatus,
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
  getColdDrinks,
  createColdDrink
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

router.use(protect);
router.use(checkRole(UserRole.CASHIER));

// ===== ORDERS =====
router.get('/orders/pending', getPendingOrders);
router.get('/orders/completed', getCompletedOrders);
router.put('/orders/:id/status', updateOrderStatus);

// ===== PAYMENTS =====
router.post('/payment', receivePayment);
router.get('/payments', getPaymentHistory);
router.get('/payment-slip/:id', getPaymentSlip);

// ===== REPORTS =====
router.get('/reports/hourly-income', getHourlyIncomeReport);

// ===== PRODUCTS =====
router.post('/products', createProduct);
router.put('/products/:id', updateProduct);
router.get('/products', getProducts);

// ===== DEALS =====
router.post('/deals', createDeal);
router.put('/deals/:id', updateDeal);
router.get('/deals', getDeals);

// ===== TABLES =====
router.get('/tables', getTables);
router.post('/tables', createTable);
router.put('/tables/:id', updateTable);
router.delete('/tables/:id', deleteTable);

// ===== COLD DRINKS =====
router.get('/cold-drinks', getColdDrinks);
router.post('/cold-drinks', createColdDrink);

// ===== CUSTOMER WALLET =====
// NOTE: /wallet/summary PEHLE hona chahiye /:id se pehle
router.get('/wallet/summary', getWalletSummary);
router.get('/wallet', getAllCustomers);
router.get('/wallet/:id', getCustomer);
router.post('/wallet', createCustomer);
router.put('/wallet/:id', updateCustomer);

// Wallet Transactions
router.post('/wallet/:id/advance', addAdvancePayment);
router.post('/wallet/:id/credit', creditPurchase);
router.post('/wallet/:id/use-balance', useBalance);
router.post('/wallet/:id/clear-debt', clearDebt);

module.exports = router;