const mongoose = require('mongoose');

// ─── Chef Daily Inventory Assignment ─────────────────────────────────────────
// Jab inventory officer chef ko items issue karta hai, yahan record hota hai
const chefInventorySchema = new mongoose.Schema({
  chefId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  date: { type: Date, default: Date.now },

  items: [{
    inventoryItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory',
      required: true
    },
    name: { type: String, required: true },
    unit: { type: String, required: true },
    issuedQuantity: { type: Number, required: true },    // kitna mila
    usedQuantity: { type: Number, default: 0 },          // kitna use kiya
    returnedQuantity: { type: Number, default: 0 },      // kitna wapas kiya
    remainingQuantity: { type: Number },                  // bacha hua (auto calc)
  }],

  status: {
    type: String,
    enum: ['active', 'returned', 'partial_return'],
    default: 'active'
  },

  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },  // inventory officer
  returnedAt: { type: Date },
  notes: { type: String }

}, { timestamps: true });

// Auto-calculate remaining before save
chefInventorySchema.pre('save', function (next) {
  this.items.forEach(item => {
    item.remainingQuantity = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
    if (item.remainingQuantity < 0) item.remainingQuantity = 0;
  });
  next();
});

module.exports = mongoose.model('ChefInventory', chefInventorySchema);