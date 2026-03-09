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
    paidTo: {
      type:  String,
      trim:  true,
      default: '',
    },
    description: {
      type:  String,
      trim:  true,
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

// Index for fast queries by branch + date
ExpenseSchema.index({ branchId: 1, date: -1 });
ExpenseSchema.index({ branchId: 1, category: 1 });

module.exports = mongoose.model('Expense', ExpenseSchema);