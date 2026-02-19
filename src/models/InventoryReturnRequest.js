const mongoose = require('mongoose');

const inventoryReturnRequestSchema = new mongoose.Schema({
  chefId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  chefInventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChefInventory', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  items: [{
    inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    name: { type: String },
    unit: { type: String },
    returnQuantity: { type: Number, required: true },
  }],
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  notes: { type: String },
  rejectionReason: { type: String },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('InventoryReturnRequest', inventoryReturnRequestSchema);