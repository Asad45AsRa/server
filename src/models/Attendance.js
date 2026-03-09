const mongoose = require('mongoose');

const AttendanceStatus = {
  PRESENT:  'present',
  ABSENT:   'absent',
  HALF_DAY: 'half_day',
  LEAVE:    'leave',
  HOLIDAY:  'holiday',
};

const attendanceSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User',   required: true },
  branchId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  date:        { type: Date, required: true },

  checkIn:     { type: Date },
  checkOut:    { type: Date },

  status:      { type: String, enum: Object.values(AttendanceStatus), required: true },

  // Auto-calculated from checkIn / checkOut
  hoursWorked:    { type: Number, default: 0 },

  // Regular hours threshold per day (e.g. 8). Hours above this = overtime
  regularHoursPerDay: { type: Number, default: 8 },

  // Auto-calculated: hoursWorked - regularHoursPerDay (if positive)
  overtimeHours:  { type: Number, default: 0 },

  // Manual override overtime (if HR sets manually)
  manualOvertime: { type: Number, default: 0 },

  // Final overtime = overtimeHours + manualOvertime
  totalOvertime:  { type: Number, default: 0 },

  notes:       { type: String, default: '' },
  markedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

attendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
module.exports.AttendanceStatus = AttendanceStatus;