const mongoose = require('mongoose');

// ─── Size variant sub-schema ───────────────────────────────────────────────
// Ek cold drink ke multiple sizes ho sakte hain, har size ki apni price hogi
const sizeVariantSchema = new mongoose.Schema({
  size:          { type: String, required: true },   // e.g. "250ml", "500ml", "1.5L"
  purchasePrice: { type: Number, required: true, default: 0 },
  salePrice:     { type: Number, required: true, default: 0 },
  currentStock:  { type: Number, default: 0 },
  minimumStock:  { type: Number, default: 5 },
  expiryDate:    { type: Date },
}, { _id: true });

// ─── Main Cold Drink schema ────────────────────────────────────────────────
const coldDrinkSchema = new mongoose.Schema({
  name:     { type: String, required: true, trim: true },   // e.g. "Pepsi"
  company:  { type: String, required: true, trim: true },   // e.g. "PepsiCo"
  sizes:    { type: [sizeVariantSchema], default: [] },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  isActive: { type: Boolean, default: true },
  notes:    { type: String },
}, { timestamps: true });

module.exports = mongoose.model('ColdDrink', coldDrinkSchema);