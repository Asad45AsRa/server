const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  category: { type: String, required: true },
  image: { type: String },
  sizes: [{
    size: { type: String, required: true },
    price: { type: Number, required: true },
    ingredients: [{
      inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      quantity: { type: Number, required: true }
    }]
  }],
  preparationTime: { type: Number, default: 15 },
  isAvailable: { type: Boolean, default: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);