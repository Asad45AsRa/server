const mongoose = require('mongoose');

const dealSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  products: [{
    // Product item (optional - only for product type)
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    // Cold drink item (optional - only for cold_drink type)
    coldDrinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'ColdDrink' },
    // Item type discriminator
    itemType: { type: String, enum: ['product', 'cold_drink'], default: 'product' },
    size: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 }
  }],
  originalPrice: { type: Number, required: true },
  discountedPrice: { type: Number, required: true },
  discountPercentage: { type: Number, required: true },
  image: { type: String },
  isActive: { type: Boolean, default: true },
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

module.exports = mongoose.model('Deal', dealSchema);