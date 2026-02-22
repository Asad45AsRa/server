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
  name:     { type: String, required: true, trim: true },
  email:    { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role:     { type: String, enum: Object.values(UserRole), required: true },

  cnic:     { type: String, default: '', trim: true },  // <-- CNIC
  phone:    { type: String, required: true },
  address:  { type: String, default: '' },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },

  wageType:    { type: String, enum: ['hourly', 'daily', 'monthly'], default: 'hourly' },
  hourlyRate:  { type: Number, default: 0 },
  dailyRate:   { type: Number, default: 0 },
  monthlyRate: { type: Number, default: 0 },

  leavesPerMonth: { type: Number, default: 2 },

  isActive:     { type: Boolean, default: true },
  isApproved:   { type: Boolean, default: false },   // admin must approve before login
  profileImage: { type: String, default: null },
  joinDate:     { type: Date, default: Date.now },

  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  managerRights: { type: managerRightsSchema, default: () => ({}) },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (this.password.startsWith('$2a$') || this.password.startsWith('$2b$')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);