const mongoose = require('mongoose');

// Individual advance payment record
const advanceSchema = new mongoose.Schema({
  amount:      { type: Number, required: true },
  date:        { type: Date,   default: Date.now },
  reason:      { type: String, default: '' },
  givenBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deducted:    { type: Boolean, default: false }, // Has this been deducted from final salary?
}, { _id: true });

const salarySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  month:    { type: Number, required: true },
  year:     { type: Number, required: true },

  // Wage type snapshot at time of salary creation
  wageType:    { type: String, enum: ['hourly', 'daily', 'monthly'], default: 'hourly' },
  hourlyRate:  { type: Number, default: 0 },
  dailyRate:   { type: Number, default: 0 },
  monthlyRate: { type: Number, default: 0 },

  // Work summary
  totalHours:    { type: Number, default: 0 },
  totalOvertime: { type: Number, default: 0 },  // overtime hours this month
  overtimeRate:  { type: Number, default: 0 },  // rate per overtime hour
  overtimePay:   { type: Number, default: 0 },  // overtimeHours * overtimeRate

  // Salary components
  baseSalary:    { type: Number, required: true },
  bonus:         { type: Number, default: 0 },
  deductions:    { type: Number, default: 0 },  // manual deductions

  // Advance salary tracking
  advances: [advanceSchema],
  totalAdvancePaid:     { type: Number, default: 0 }, // sum of all advance amounts
  advanceDeducted:      { type: Number, default: 0 }, // amount deducted from this month's salary

  // Final calculation
  // totalSalary = baseSalary + overtimePay + bonus - deductions - advanceDeducted
  totalSalary:   { type: Number, required: true },
  netPayable:    { type: Number, default: 0 }, // after all deductions including advance

  isPaid:   { type: Boolean, default: false },
  paidDate: { type: Date },
  paidBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  notes:    { type: String },
}, { timestamps: true });

salarySchema.index({ userId: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Salary', salarySchema);