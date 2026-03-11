// models/Expense.js
const mongoose = require('mongoose');

const ExpenseSchema = new mongoose.Schema(
  {
    branchId: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Branch',
      required: true,
    },
    title: {
      type:     String,
      required: true,
      trim:     true,
    },
    amount: {
      type:     Number,
      required: true,
      min:      0,
    },
    category: {
      type:    String,
      enum:    ['salary', 'utility', 'rent', 'grocery', 'maintenance', 'transport', 'other'],
      default: 'other',
    },
    // ✅ NEW: Payment method field
    paymentMethod: {
      type:    String,
      enum:    ['cash', 'card', 'jazz_cash', 'easypaisa'],
      default: 'cash',
    },
    paidTo: {
      type:    String,
      trim:    true,
      default: '',
    },
    description: {
      type:    String,
      trim:    true,
      default: '',
    },
    date: {
      type:    Date,
      default: Date.now,
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },
  },
  { timestamps: true }
);

// Indexes for fast queries
ExpenseSchema.index({ branchId: 1, date: -1 });
ExpenseSchema.index({ branchId: 1, category: 1 });
ExpenseSchema.index({ branchId: 1, paymentMethod: 1 }); // ✅ NEW

module.exports = mongoose.model('Expense', ExpenseSchema);