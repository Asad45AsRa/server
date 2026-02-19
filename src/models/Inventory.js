const mongoose = require('mongoose');
const { InventoryUnit } = require('../config/constants');

const inventorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  unit: { type: String, enum: Object.values(InventoryUnit), required: true },
  currentStock: { type: Number, default: 0 },
  minimumStock: { type: Number, default: 0 },
  pricePerUnit: { type: Number, required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  lastRestocked: { type: Date },
  supplier: { type: String },
  isActive: { type: Boolean, default: true },
  // NEW FIELDS
  averageCost: { type: Number, default: 0 }, // For cost calculation
  totalPurchaseValue: { type: Number, default: 0 },
  totalIssueValue: { type: Number, default: 0 },
  stockHistory: [{
    date: { type: Date, default: Date.now },
    quantity: { type: Number },
    type: { type: String, enum: ['in', 'out'] },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryTransaction' }
  }]
}, { timestamps: true });

// Calculate average cost
inventorySchema.methods.calculateAverageCost = function() {
  if (this.currentStock > 0 && this.totalPurchaseValue > 0) {
    this.averageCost = this.totalPurchaseValue / this.currentStock;
  }
  return this.averageCost;
};

module.exports = mongoose.model('Inventory', inventorySchema);