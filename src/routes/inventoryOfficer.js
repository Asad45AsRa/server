const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { checkRole } = require('../middlewares/roleCheck');
const { UserRole } = require('../config/constants');
const { createInventoryItem, deleteInventoryItem } = require('../controllers/inventoryController');
 
const {
  recordPurchase,
  getPurchaseHistory,
  issueInventory,
  getIssueHistory,
  createRequest,
  getAllRequests,
  approveRequest,
  rejectRequest,
  issueApprovedRequest,
  createSupplier,
  getAllSuppliers,
  updateSupplier,
  getSupplierDetail,
  recordSupplierPayment,
  getSupplierPayments,
  getInventoryReport,
  getCostAnalysis,
  issueInventoryToChef,
  getChefInventoryRecords,
  getLowStockItems,
  receiveChefReturn,
  getTotalStock,
  getPendingReturnRequests,
  approveReturnRequest,
  rejectReturnRequest,
  issueColdDrinksToBarman,
  getBarmanStockRequests,
  rejectBarmanRequest,
  getBarmanInventoryRecords,
  receiveBarmanReturn,
  issueRequestCustomQty,
} = require('../controllers/inventoryOfficerController');
 
router.use(protect);
router.use(checkRole(UserRole.ADMIN, 'inventory_officer'));
 
// ── Inventory Item CRUD ───────────────────────────────────────────────────────
router.post  ('/inventory',      createInventoryItem);
router.delete('/inventory/:id',  deleteInventoryItem);
 
// ── Purchases ────────────────────────────────────────────────────────────────
router.post('/purchases', recordPurchase);
router.get ('/purchases', getPurchaseHistory);
 
// ── Issues ───────────────────────────────────────────────────────────────────
router.post('/issues', issueInventory);
router.get ('/issues', getIssueHistory);
 
// ── Chef Issue & Records ──────────────────────────────────────────────────────
router.post('/issue-to-chef',   issueInventoryToChef);
router.get ('/chef-inventory',  getChefInventoryRecords);
router.get ('/low-stock',       getLowStockItems);
 
// ── Chef Return ───────────────────────────────────────────────────────────────
router.post('/chef-return', receiveChefReturn);
 
// ── Total Stock ───────────────────────────────────────────────────────────────
router.get('/total-stock', getTotalStock);
 
// ── Inventory Requests ────────────────────────────────────────────────────────
router.get('/requests',              getAllRequests);
router.put('/requests/:id/approve',  approveRequest);
router.put('/requests/:id/reject',   rejectRequest);
router.put('/requests/:id/issue',    issueApprovedRequest);
 
// Chef request create (alag role check)
router.post('/requests/create', protect, checkRole(UserRole.CHEF), createRequest);
 
// ── Suppliers ─────────────────────────────────────────────────────────────────
router.post('/suppliers',              createSupplier);
router.get ('/suppliers',              getAllSuppliers);
router.put ('/suppliers/:id',          updateSupplier);
router.get ('/suppliers/:id/detail',   getSupplierDetail);
router.get ('/suppliers/:id/payments', getSupplierPayments);
router.post('/suppliers/payment',      recordSupplierPayment);
 
// ── Reports ──────────────────────────────────────────────────────────────────
router.get('/reports/inventory',     getInventoryReport);
router.get('/reports/cost-analysis', getCostAnalysis);
 
// ── Chef Return Requests ──────────────────────────────────────────────────────
router.get('/return-requests',              getPendingReturnRequests);
router.put('/return-requests/:id/approve',  approveReturnRequest);
router.put('/return-requests/:id/reject',   rejectReturnRequest);
 
// ── Barman Cold Drink Issue ───────────────────────────────────────────────────
router.post('/issue-cold-drinks',           issueColdDrinksToBarman);
 
// ── Barman Cold Drink Requests ────────────────────────────────────────────────
router.get('/barman-requests',              getBarmanStockRequests);
router.put('/barman-requests/:id/reject',   rejectBarmanRequest);
 
// ── Barman Inventory Records & Returns ───────────────────────────────────────
router.get ('/barman-inventory',  getBarmanInventoryRecords);
router.post('/barman-return',     receiveBarmanReturn);
router.post('/issue-cold-drinks',           issueColdDrinksToBarman);
router.post('/requests/issue-custom', issueRequestCustomQty);
 
module.exports = router;