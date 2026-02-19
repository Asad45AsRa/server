const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { UserRole } = require('../config/constants');

const managerRightsSchema = new mongoose.Schema({
  orders:      { type: Boolean, default: false },
  parcel:      { type: Boolean, default: false },
  staff:       { type: Boolean, default: false },
  inventory:   { type: Boolean, default: false },
  products:    { type: Boolean, default: false },
  deals:       { type: Boolean, default: false },
  reports:     { type: Boolean, default: false },
  hr:          { type: Boolean, default: false },
  fullControl: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  email:        { type: String, required: true, unique: true },
  password:     { type: String, required: true },
  role: {
    type: String,
    enum: Object.values(UserRole),
    required: true
  },
  phone:        { type: String, required: true },
  address:      { type: String },
  branchId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },

  // ---- Wage configuration (HR sets this) ----
  wageType:     { type: String, enum: ['hourly','daily','monthly'], default: 'hourly' },
  hourlyRate:   { type: Number, default: 0 },
  dailyRate:    { type: Number, default: 0 },
  monthlyRate:  { type: Number, default: 0 },

  // ---- Leave policy ----
  leavesPerMonth: { type: Number, default: 2 },

  // ---- Account state ----
  isActive:     { type: Boolean, default: true },
  profileImage: { type: String },
  joinDate:     { type: Date, default: Date.now },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isApproved:   { type: Boolean, default: false },

  // Manager-specific rights
  managerRights: {
    type: managerRightsSchema,
    default: () => ({})
  }
}, { timestamps: true });

// Virtual: resolved rights (fullControl overrides everything)
userSchema.virtual('resolvedRights').get(function () {
  if (this.role !== 'manager') return null;
  const r = this.managerRights || {};
  if (r.fullControl) {
    return {
      orders: true, parcel: true, staff: true,
      inventory: true, products: true, deals: true,
      reports: true, hr: true, fullControl: true
    };
  }
  return r;
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);