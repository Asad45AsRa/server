const mongoose = require('mongoose');
const { PaymentStatus, PaymentMethod } = require('../config/constants');

const paymentSchema = new mongoose.Schema({
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  amount: { type: Number, required: true },
  method: { type: String, enum: Object.values(PaymentMethod), required: true },
  status: { type: String, enum: Object.values(PaymentStatus), default: PaymentStatus.PENDING },
  cashierId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  waiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deliveryBoyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receivedAmount: { type: Number },
  changeAmount: { type: Number },
  transactionId: { type: String },
  notes: { type: String },
  paidAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);