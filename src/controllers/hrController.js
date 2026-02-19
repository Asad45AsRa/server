const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Salary = require('../models/Salary');
const JobPosting = require('../models/Jobposting');
const Application = require('../models/Application');
const { getMonthDateRange, calculateHours } = require('../utils/dateHelpers');
const bcrypt = require('bcryptjs');

// =========================================================
//  EMPLOYEES
// =========================================================

exports.createEmployee = async (req, res) => {
  try {
    const employee = await User.create({
      ...req.body,
      createdBy: req.user._id,
      isApproved: false
    });
    res.status(201).json({ success: true, employee, message: 'Employee created, pending admin approval' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllEmployees = async (req, res) => {
  try {
    const { branchId, role } = req.query;
    const query = {};
    if (branchId) query.branchId = branchId;
    if (role)     query.role = role;

    const employees = await User.find(query).select('-password').populate('branchId');
    res.json({ success: true, employees });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (req.body.role && req.body.role !== req.user.role) updates.isApproved = false;

    const employee = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    res.json({
      success: true, employee,
      message: updates.isApproved === false ? 'Changes pending admin approval' : 'Employee updated'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
//  ATTENDANCE
// =========================================================

exports.markAttendance = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut, notes, overtime } = req.body;

    let hoursWorked = 0;
    if (checkIn && checkOut) {
      // Build full datetime from today's date + time strings like "09:00"
      const dateStr = new Date(date).toISOString().split('T')[0];
      hoursWorked = calculateHours(
        new Date(`${dateStr}T${checkIn}`),
        new Date(`${dateStr}T${checkOut}`)
      );
    }

    const attendance = await Attendance.findOneAndUpdate(
      { userId, date: new Date(date) },
      {
        userId,
        branchId: req.user.branchId,
        date: new Date(date),
        checkIn:  checkIn  ? new Date(`${new Date(date).toISOString().split('T')[0]}T${checkIn}`)  : null,
        checkOut: checkOut ? new Date(`${new Date(date).toISOString().split('T')[0]}T${checkOut}`) : null,
        status, hoursWorked, notes,
        overtime: parseFloat(overtime) || 0,
        markedBy: req.user._id
      },
      { new: true, upsert: true }
    );

    res.json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.bulkMarkAttendance = async (req, res) => {
  try {
    // req.body = array of { userId, date, status, checkIn, checkOut, notes }
    const records = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ success: false, message: 'Array expected' });

    const results = await Promise.allSettled(records.map(async (r) => {
      const { userId, date, status, checkIn, checkOut, notes, overtime } = r;
      const dateStr = new Date(date).toISOString().split('T')[0];

      let hoursWorked = 0;
      if (checkIn && checkOut) {
        hoursWorked = calculateHours(
          new Date(`${dateStr}T${checkIn}`),
          new Date(`${dateStr}T${checkOut}`)
        );
      }

      return Attendance.findOneAndUpdate(
        { userId, date: new Date(date) },
        {
          userId, branchId: req.user.branchId, date: new Date(date),
          checkIn:  checkIn  ? new Date(`${dateStr}T${checkIn}`)  : null,
          checkOut: checkOut ? new Date(`${dateStr}T${checkOut}`) : null,
          status, hoursWorked, notes,
          overtime: parseFloat(overtime) || 0,
          markedBy: req.user._id
        },
        { new: true, upsert: true }
      );
    }));

    const count = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, count, message: `Attendance marked for ${count} employees` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAttendance = async (req, res) => {
  try {
    const { userId, month, year, branchId } = req.query;
    const query = {};
    if (userId)   query.userId = userId;
    if (branchId) query.branchId = branchId;
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      query.date = { $gte: startDate, $lte: endDate };
    }

    const attendance = await Attendance.find(query)
      .populate('userId', 'name email role')
      .sort({ date: -1 });

    res.json({ success: true, attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAttendanceSummary = async (req, res) => {
  try {
    const { month, year, branchId } = req.query;
    const query = {};
    if (branchId) query.branchId = branchId;
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      query.date = { $gte: startDate, $lte: endDate };
    }

    const records = await Attendance.find(query);

    const summary = {
      totalPresent:  records.filter(r => r.status === 'present').length,
      totalAbsent:   records.filter(r => r.status === 'absent').length,
      totalHalfDay:  records.filter(r => r.status === 'half_day').length,
      totalLeave:    records.filter(r => r.status === 'leave').length,
      totalHoliday:  records.filter(r => r.status === 'holiday').length,
      totalHours:    records.reduce((s, r) => s + (r.hoursWorked || 0), 0),
      totalOvertime: records.reduce((s, r) => s + (r.overtime || 0), 0),
    };
    summary.avgHours = records.length > 0
      ? summary.totalHours / records.filter(r => r.status === 'present').length || 0
      : 0;

    res.json({ success: true, summary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
//  SALARY  (supports hourly / daily / monthly wage types)
// =========================================================

exports.calculateMonthlySalary = async (req, res) => {
  try {
    const { userId, month, year } = req.body;
    const { startDate, endDate } = getMonthDateRange(month, year);

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Employee not found' });

    const attendance = await Attendance.find({
      userId,
      date: { $gte: startDate, $lte: endDate },
      status: { $in: ['present', 'half_day'] }
    });

    const wageType = user.wageType || 'hourly';
    let totalHours = 0, daysPresent = 0, baseSalary = 0, rateUsed = 0;

    if (wageType === 'hourly') {
      totalHours = attendance.reduce((sum, att) => {
        return sum + (att.status === 'half_day' ? att.hoursWorked / 2 : att.hoursWorked);
      }, 0);
      const overtimeHours = attendance.reduce((sum, att) => sum + (att.overtime || 0), 0);
      rateUsed   = user.hourlyRate || 0;
      baseSalary = (totalHours + overtimeHours) * rateUsed;

      res.json({ success: true, calculation: {
        totalHours, overtimeHours, hourlyRate: rateUsed, rateUsed,
        baseSalary, wageType, userId, month, year,
        daysPresent: attendance.filter(a => a.status === 'present').length
      }});

    } else if (wageType === 'daily') {
      // Count days: full day = 1, half day = 0.5
      daysPresent = attendance.reduce((sum, att) => {
        return sum + (att.status === 'half_day' ? 0.5 : 1);
      }, 0);
      totalHours = attendance.reduce((sum, att) => sum + att.hoursWorked, 0);
      rateUsed   = user.dailyRate || 0;
      baseSalary = daysPresent * rateUsed;

      res.json({ success: true, calculation: {
        daysPresent, totalHours, dailyRate: rateUsed, rateUsed,
        baseSalary, wageType, userId, month, year
      }});

    } else {
      // monthly fixed — still count attendance for deductions
      daysPresent = attendance.filter(a => a.status === 'present').length;
      totalHours  = attendance.reduce((sum, att) => sum + att.hoursWorked, 0);
      rateUsed    = user.monthlyRate || 0;

      // Count unpaid absences (beyond allowed leaves)
      const allRecords = await Attendance.find({
        userId, date: { $gte: startDate, $lte: endDate }
      });
      const absences     = allRecords.filter(r => r.status === 'absent').length;
      const leavesUsed   = allRecords.filter(r => r.status === 'leave').length;
      const allowedLeaves = user.leavesPerMonth || 2;
      const unpaidLeaves = Math.max(0, leavesUsed - allowedLeaves) + absences;

      // Deduct per working day
      const workingDaysInMonth = 26; // standard
      const perDayRate = rateUsed / workingDaysInMonth;
      baseSalary = rateUsed - (unpaidLeaves * perDayRate);

      res.json({ success: true, calculation: {
        daysPresent, totalHours, monthlyRate: rateUsed, rateUsed,
        absences, leavesUsed, allowedLeaves, unpaidLeaves,
        baseSalary: Math.max(0, baseSalary), wageType, userId, month, year
      }});
    }

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createSalary = async (req, res) => {
  try {
    const { userId, month, year, baseSalary, bonus, deductions, notes } = req.body;
    const totalSalary = parseFloat(baseSalary) + parseFloat(bonus || 0) - parseFloat(deductions || 0);

    const user = await User.findById(userId);
    const { startDate, endDate } = getMonthDateRange(month, year);

    const attendance = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } });
    const totalHours = attendance.reduce((sum, att) => sum + att.hoursWorked, 0);

    const salary = await Salary.findOneAndUpdate(
      { userId, month, year },
      {
        userId, branchId: user.branchId, month, year,
        totalHours, wageType: user.wageType || 'hourly',
        hourlyRate: user.hourlyRate || 0,
        dailyRate: user.dailyRate || 0,
        monthlyRate: user.monthlyRate || 0,
        baseSalary, bonus: bonus || 0, deductions: deductions || 0,
        totalSalary: Math.max(0, totalSalary), notes
      },
      { new: true, upsert: true }
    );

    res.json({ success: true, salary });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSalaries = async (req, res) => {
  try {
    const { userId, month, year, branchId } = req.query;
    const query = {};
    if (userId)   query.userId = userId;
    if (month)    query.month = month;
    if (year)     query.year = year;
    if (branchId) query.branchId = branchId;

    const salaries = await Salary.find(query)
      .populate('userId', 'name email role wageType hourlyRate dailyRate monthlyRate')
      .populate('paidBy', 'name')
      .sort({ year: -1, month: -1 });

    res.json({ success: true, salaries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.paySalary = async (req, res) => {
  try {
    const salary = await Salary.findByIdAndUpdate(
      req.params.id,
      { isPaid: true, paidDate: new Date(), paidBy: req.user._id },
      { new: true }
    );
    res.json({ success: true, salary, message: 'Salary paid successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
//  RECRUITMENT — JOB POSTINGS
// =========================================================

exports.createJobPosting = async (req, res) => {
  try {
    const job = await JobPosting.create({
      ...req.body,
      createdBy: req.user._id,
      branchId: req.user.branchId,
    });
    res.status(201).json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getJobPostings = async (req, res) => {
  try {
    const { isOpen, role } = req.query;
    const query = {};
    if (isOpen !== undefined) query.isOpen = isOpen === 'true';
    if (role) query.role = role;

    const jobs = await JobPosting.find(query).populate('createdBy', 'name').sort({ createdAt: -1 });
    res.json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateJobPosting = async (req, res) => {
  try {
    const job = await JobPosting.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
//  RECRUITMENT — APPLICATIONS
// =========================================================

exports.getApplications = async (req, res) => {
  try {
    const { status, jobId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (jobId)  query.jobId = jobId;

    const applications = await Application.find(query)
      .populate('jobId', 'title role salary salaryType')
      .sort({ createdAt: -1 });

    res.json({ success: true, applications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateApplicationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const application = await Application.findByIdAndUpdate(
      req.params.id, { status }, { new: true }
    ).populate('jobId');
    res.json({ success: true, application });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.scheduleInterview = async (req, res) => {
  try {
    const { date, time, mode, notes } = req.body;
    const application = await Application.findByIdAndUpdate(
      req.params.id,
      {
        status: 'interview',
        interviewDate: new Date(date),
        interviewTime: time,
        interviewMode: mode,
        interviewNotes: notes,
      },
      { new: true }
    ).populate('jobId');
    res.json({ success: true, application });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * HIRE applicant:
 *  1. Creates a User account with a auto-generated password
 *  2. Marks the application as 'hired'
 *  3. Closes the job if slots filled
 *  4. Returns the generated credentials (so HR can share them)
 */
exports.hireApplicant = async (req, res) => {
  try {
    const application = await Application.findById(req.params.id).populate('jobId');
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

    const job = application.jobId;

    // Generate a simple temp password
    const tempPassword = `${application.applicantName.split(' ')[0].toLowerCase()}@${Math.floor(1000 + Math.random() * 9000)}`;

    // Check if user already exists
    let user = await User.findOne({ email: application.applicantEmail });
    if (user) {
      return res.status(400).json({ success: false, message: 'A user with this email already exists' });
    }

    // Create the user account
    user = await User.create({
      name:      application.applicantName,
      email:     application.applicantEmail,
      password:  tempPassword,   // will be hashed by pre-save hook
      role:      job?.role || 'waiter',
      phone:     application.applicantPhone,
      address:   application.applicantAddress || '',
      branchId:  req.user.branchId,
      wageType:  job?.salaryType || 'monthly',
      monthlyRate: parseFloat(job?.salary) || 0,
      isApproved: false,   // still needs admin approval
      createdBy: req.user._id,
      joinDate: new Date(),
    });

    // Mark application hired
    await Application.findByIdAndUpdate(req.params.id, {
      status: 'hired',
      hiredAt: new Date(),
      createdUserId: user._id,
    });

    // Check remaining slots on the job posting
    if (job) {
      const hiredCount = await Application.countDocuments({ jobId: job._id, status: 'hired' });
      if (hiredCount >= (job.slots || 1)) {
        await JobPosting.findByIdAndUpdate(job._id, { isOpen: false });
      }
    }

    res.json({
      success: true,
      message: `${application.applicantName} hired successfully`,
      credentials: {
        email: user.email,
        tempPassword,
        note: 'Share these credentials with the employee. Admin approval required before first login.'
      },
      user: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// =========================================================
//  PUBLIC — submit application (no auth required)
// =========================================================

exports.submitPublicApplication = async (req, res) => {
  try {
    const { jobId, applicantName, applicantEmail, applicantPhone, applicantAddress, coverLetter } = req.body;

    // Validate job exists and is open
    const job = await JobPosting.findById(jobId);
    if (!job)      return res.status(404).json({ success: false, message: 'Job not found' });
    if (!job.isOpen) return res.status(400).json({ success: false, message: 'This job is no longer accepting applications' });
    if (job.deadline && new Date(job.deadline) < new Date()) {
      return res.status(400).json({ success: false, message: 'Application deadline has passed' });
    }

    // Prevent duplicate applications
    const existing = await Application.findOne({ jobId, applicantEmail });
    if (existing) return res.status(400).json({ success: false, message: 'You have already applied for this position' });

    const application = await Application.create({
      jobId, applicantName, applicantEmail, applicantPhone,
      applicantAddress, coverLetter, status: 'applied',
    });

    res.status(201).json({ success: true, application, message: 'Application submitted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPublicJobs = async (req, res) => {
  try {
    const jobs = await JobPosting.find({ isOpen: true, $or: [
      { deadline: { $gte: new Date() } },
      { deadline: null }
    ]}).select('-createdBy').sort({ createdAt: -1 });
    res.json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};