const mongoose = require('mongoose');

// =================== INVENTORY TRANSACTION ===================
const inventoryTransactionSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
  type: { type: String, enum: ['purchase', 'issue', 'return', 'adjustment'], required: true },
  quantity: { type: Number, required: true },
  unit: { type: String, required: true },
  pricePerUnit: { type: Number },
  totalCost: { type: Number },
  supplier: { type: String },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issuedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paymentType: { type: String, enum: ['cash', 'credit', 'advance'], default: 'cash' },
  advanceAmount: { type: Number, default: 0 },
  creditAmount: { type: Number, default: 0 },
  paymentDueDate: { type: Date },
  notes: { type: String },
  invoiceNumber: { type: String },
  date: { type: Date, default: Date.now }
}, { timestamps: true });

// =================== INVENTORY REQUEST ===================
const inventoryRequestSchema = new mongoose.Schema({
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    requestedQuantity: { type: Number, required: true },
    unit: { type: String, required: true },
    purpose: { type: String }
  }],
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'issued'], default: 'pending' },
  requestDate: { type: Date, default: Date.now },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedDate: { type: Date },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issuedDate: { type: Date },
  notes: { type: String },
  rejectionReason: { type: String }
}, { timestamps: true });

// =================== SUPPLIER ===================
const supplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  contact: { type: String, required: true },
  email: { type: String },
  address: { type: String },
  itemsSupplied: [{ type: String }],
  creditLimit: { type: Number, default: 0 },

  // Outstanding credit (amount we OWE supplier from credit purchases)
  currentCredit: { type: Number, default: 0 },

  // Advance payments (amount supplier OWES us — we paid in advance)
  totalAdvancePaid: { type: Number, default: 0 },

  // Running totals for reporting
  totalCreditCleared: { type: Number, default: 0 },
  totalPurchaseValue: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Virtual: net balance
// Positive = we owe supplier | Negative = supplier owes us
supplierSchema.virtual('netBalance').get(function () {
  return this.currentCredit - this.totalAdvancePaid;
});

supplierSchema.set('toJSON', { virtuals: true });

// =================== SUPPLIER PAYMENT ===================
// Records every payment transaction with supplier
const supplierPaymentSchema = new mongoose.Schema({
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: { type: String }, // denormalized for reports

  paymentType: {
    type: String,
    // credit_payment: clearing outstanding credit (we pay supplier)
    // advance_payment: paying supplier in advance for future purchases
    // advance_refund: supplier returns our advance money
    enum: ['credit_payment', 'advance_payment', 'advance_refund'],
    required: true
  },

  amount: { type: Number, required: true },
  notes: { type: String },
  recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  date: { type: Date, default: Date.now },

  // Snapshot at time of payment (for audit trail)
  creditBeforePayment: { type: Number, default: 0 },
  advanceBeforePayment: { type: Number, default: 0 },
  creditAfterPayment: { type: Number, default: 0 },
  advanceAfterPayment: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = {
  InventoryTransaction: mongoose.model('InventoryTransaction', inventoryTransactionSchema),
  InventoryRequest: mongoose.model('InventoryRequest', inventoryRequestSchema),
  Supplier: mongoose.model('Supplier', supplierSchema),
  SupplierPayment: mongoose.model('SupplierPayment', supplierPaymentSchema)
};