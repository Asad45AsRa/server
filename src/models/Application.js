const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  jobId:            { type: mongoose.Schema.Types.ObjectId, ref: 'JobPosting', required: true },
  applicantName:    { type: String, required: true },
  applicantEmail:   { type: String, required: true },
  applicantPhone:   { type: String, required: true },
  applicantAddress: { type: String },
  coverLetter:      { type: String },

  status: {
    type: String,
    enum: ['applied','reviewing','interview','selected','rejected','hired'],
    default: 'applied'
  },

  // Interview scheduling
  interviewDate:  { type: Date },
  interviewTime:  { type: String },
  interviewMode:  { type: String, enum: ['in-person','phone','video'], default: 'in-person' },
  interviewNotes: { type: String },

  // After hire
  hiredAt:        { type: Date },
  createdUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Prevent duplicate applications for same job+email
applicationSchema.index({ jobId: 1, applicantEmail: 1 }, { unique: true });

module.exports = mongoose.model('Application', applicationSchema);