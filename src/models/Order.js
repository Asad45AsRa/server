const mongoose = require('mongoose');
const { OrderStatus, OrderType } = require('../config/constants');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true, unique: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  orderType: { type: String, enum: Object.values(OrderType), required: true },
  tableNumber: { type: Number, default: null },

  floor: {
    type: String,
    enum: ['ground_floor', 'first_floor', 'second_floor', 'outdoor', null],
    default: null,
  },

  items: [{
    itemId:   { type: mongoose.Schema.Types.ObjectId, required: true, refPath: 'items.itemType' },
    itemType: { type: String, enum: ['Product', 'Deal', 'Inventory'], required: true },
    type:     { type: String, enum: ['product', 'deal', 'cold_drink'], required: true },
    name:     { type: String, required: true },
    size:     { type: String },
    quantity: { type: Number, required: true },
    price:    { type: Number, required: true },
    subtotal: { type: Number, default: 0 },
    preparationTime: { type: Number, default: 0 },

    // Cold drink extra fields
    isColdDrink:     { type: Boolean, default: false },
    coldDrinkId:     { type: mongoose.Schema.Types.ObjectId, default: null },
    coldDrinkSizeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  }],

  subtotal: { type: Number, required: true },
  tax:      { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  total:    { type: Number, required: true },

  status: { type: String, enum: Object.values(OrderStatus), default: OrderStatus.PENDING },

  waiterId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  chefId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deliveryBoyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  cashierId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  customerName:    { type: String, default: null },
  customerPhone:   { type: String, default: null },
  deliveryAddress: { type: String, default: null },

  cashierNote: { type: String, default: '' },

  estimatedTime:   { type: Number },
  actualTime:      { type: Number },
  additionalDelay: { type: Number, default: 0 },

  notes: { type: String },

  // ✅ Waiter update tracking
  updatedByWaiter: { type: Boolean, default: false },
  waiterUpdatedAt: { type: Date, default: null },
  waiterUpdatedBy: { type: String, default: null },

  // ✅ Stock deduction tracking
  stockDeducted: { type: Boolean, default: false },

  // Delivery meter tracking
  startMeterReading: { type: Number },
  endMeterReading:   { type: Number },
  distanceTravelled: { type: Number },
  cashReceived:      { type: Number },

  // Payment tracking
  paymentMethod:  { type: String, default: null },
  receivedAmount: { type: Number, default: 0 },
  changeAmount:   { type: Number, default: 0 },
  paidAt:         { type: Date, default: null },

  // Advance payment tracking
  advancePaid:          { type: Number, default: 0 },
  advancePaymentMethod: { type: String, default: 'cash' },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'partial_advance', 'fully_advance'],
    default: 'unpaid',
  },

  // Timestamps
  acceptedAt:  { type: Date },
  preparingAt: { type: Date },
  readyAt:     { type: Date },
  departedAt:  { type: Date },
  deliveredAt: { type: Date },
  completedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);