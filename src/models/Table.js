const mongoose = require('mongoose');

const tableSchema = new mongoose.Schema({
  tableNumber: { type: Number, required: true },
  capacity: { type: Number, required: true },
  floor: { 
    type: String, 
    required: true,
    enum: ['ground_floor', 'first_floor', 'second_floor', 'outdoor'],
    default: 'ground_floor'
  },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  isOccupied: { type: Boolean, default: false },
  currentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Unique index: same table number can exist on different floors
tableSchema.index({ branchId: 1, tableNumber: 1, floor: 1 }, { unique: true });

module.exports = mongoose.model('Table', tableSchema);