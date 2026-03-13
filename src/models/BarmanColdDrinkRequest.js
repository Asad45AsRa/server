const mongoose = require('mongoose');

const requestItemSchema = new mongoose.Schema({
  coldDrinkId:    mongoose.Schema.Types.ObjectId,
  coldDrinkSizeId:mongoose.Schema.Types.ObjectId,
  name:    String,
  size:    String,
  quantity:{ type: Number, required: true },
});

const barmanColdDrinkRequestSchema = new mongoose.Schema({
  barmanId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  items:    [requestItemSchema],
  notes:    String,
  status:   { type: String, enum: ['pending', 'issued', 'rejected'], default: 'pending' },
  issuedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  issuedAt:        Date,
  rejectedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  rejectionReason: String,
}, { timestamps: true });

module.exports = mongoose.model('BarmanColdDrinkRequest', barmanColdDrinkRequestSchema);