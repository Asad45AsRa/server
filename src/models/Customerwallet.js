const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['credit_purchase', 'advance_payment', 'balance_used', 'refund'],
    required: true
  },
  amount: { type: Number, required: true },
  description: { type: String },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  balanceBefore: { type: Number },
  balanceAfter: { type: Number },
  createdAt: { type: Date, default: Date.now }
});

const customerWalletSchema = new mongoose.Schema({
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },

  // Customer Info
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String },
  address: { type: String },
  notes: { type: String },

  // Balance
  // Positive = customer ne advance diya (hamara unpar koi debt nahi)
  // Negative = customer par hamara credit hai (unhone udhaar liya)
  balance: { type: Number, default: 0 },

  // Limits
  creditLimit: { type: Number, default: 5000 }, // Max udhaar allowed

  isActive: { type: Boolean, default: true },
  transactions: [walletTransactionSchema],
}, { timestamps: true });

// Virtual: kitna udhaar baaki hai
walletTransactionSchema.virtual('isCredit').get(function () {
  return this.type === 'credit_purchase';
});

module.exports = mongoose.model('CustomerWallet', customerWalletSchema);