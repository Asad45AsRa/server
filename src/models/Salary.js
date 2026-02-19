const mongoose = require('mongoose');

const salarySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  month:    { type: Number, required: true },
  year:     { type: Number, required: true },

  // Wage type snapshot at time of salary creation
  wageType:    { type: String, enum: ['hourly','daily','monthly'], default: 'hourly' },
  hourlyRate:  { type: Number, default: 0 },
  dailyRate:   { type: Number, default: 0 },
  monthlyRate: { type: Number, default: 0 },

  totalHours:  { type: Number, required: true },
  baseSalary:  { type: Number, required: true },
  bonus:       { type: Number, default: 0 },
  deductions:  { type: Number, default: 0 },
  totalSalary: { type: Number, required: true },

  isPaid:   { type: Boolean, default: false },
  paidDate: { type: Date },
  paidBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes:    { type: String },
}, { timestamps: true });

salarySchema.index({ userId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Salary', salarySchema);