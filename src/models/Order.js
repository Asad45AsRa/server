const mongoose = require('mongoose');
const { OrderStatus, OrderType } = require('../config/constants');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  orderType: { type: String, enum: Object.values(OrderType), required: true },
  tableNumber: { type: Number },
  floor: {
    type: String,
    enum: ['ground_floor', 'first_floor', 'second_floor', 'outdoor']
  },

  items: [{
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'items.itemType' },
    itemType: { type: String, enum: ['Product', 'Deal', 'Inventory'], required: true },
    type: { type: String, enum: ['product', 'deal', 'cold_drink'], required: true },
    name: { type: String, required: true },
    size: { type: String },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    preparationTime: { type: Number, default: 0 }
  }],

  subtotal: { type: Number, required: true },
  tax: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },

  status: { type: String, enum: Object.values(OrderStatus), default: OrderStatus.PENDING },

  waiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chefId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deliveryBoyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cashierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  customerName: { type: String },
  customerPhone: { type: String },
  deliveryAddress: { type: String },

  estimatedTime: { type: Number },
  actualTime: { type: Number },
  additionalDelay: { type: Number, default: 0 },

  notes: { type: String },

  // ✅ Delivery meter tracking fields
  startMeterReading:  { type: Number },   // km reading before departure
  endMeterReading:    { type: Number },   // km reading after return
  distanceTravelled:  { type: Number },   // endMeter - startMeter
  cashReceived:       { type: Number },   // cash collected from customer

  // Timestamps
  acceptedAt:   { type: Date },
  preparingAt:  { type: Date },
  readyAt:      { type: Date },
  departedAt:   { type: Date },  
  deliveredAt:  { type: Date },
  completedAt:  { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);