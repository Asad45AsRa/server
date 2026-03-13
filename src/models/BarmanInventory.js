const mongoose = require('mongoose');

const barmanInventoryItemSchema = new mongoose.Schema({
  coldDrinkId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ColdDrink' },
  coldDrinkSizeId:  mongoose.Schema.Types.ObjectId,
  name:             { type: String, required: true },
  size:             { type: String, required: true },
  company:          { type: String },
  issuedQuantity:   { type: Number, default: 0 },
  deliveredQuantity:{ type: Number, default: 0 },   // delivered to customers
  returnedQuantity: { type: Number, default: 0 },
}, { _id: true });

const barmanInventorySchema = new mongoose.Schema({
  barmanId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  branchId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  issuedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items:     [barmanInventoryItemSchema],
  status:    { type: String, enum: ['active', 'partial_return', 'returned'], default: 'active' },
  date:      { type: Date, default: Date.now },
  notes:     { type: String },
  returnedAt:{ type: Date },
}, { timestamps: true });

module.exports = mongoose.model('BarmanInventory', barmanInventorySchema);