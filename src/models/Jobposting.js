const mongoose = require('mongoose');

const jobPostingSchema = new mongoose.Schema({
  title:        { type: String, required: true },
  role:         { type: String, required: true },
  description:  { type: String },
  requirements: { type: String },
  salary:       { type: Number },
  salaryType:   { type: String, enum: ['hourly','daily','monthly'], default: 'monthly' },
  slots:        { type: Number, default: 1 },
  deadline:     { type: Date },
  isOpen:       { type: Boolean, default: true },
  branchId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('JobPosting', jobPostingSchema);