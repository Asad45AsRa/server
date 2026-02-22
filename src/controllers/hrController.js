const User       = require('../models/User');
const Attendance = require('../models/Attendance');
const Salary     = require('../models/Salary');
const { getMonthDateRange, calculateHours } = require('../utils/dateHelpers');

/* ================================================================
   EMPLOYEES  —  HR creates, Admin approves
   ================================================================ */

// POST /hr/employees
// HR registers a new employee (isApproved:false until admin approves)
exports.createEmployee = async (req, res) => {
  try {
    const { name, cnic, phone, address, email, password, role,
            wageType, hourlyRate, dailyRate, monthlyRate, branchId } = req.body;

    if (!name || !email || !password || !phone || !role)
      return res.status(400).json({ success: false, message: 'name, email, password, phone, role are required' });

    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    if (await User.findOne({ email }))
      return res.status(400).json({ success: false, message: 'Email already registered' });

    const employee = await User.create({
      name, cnic: cnic || '', phone, address: address || '',
      email, password, role,
      // ✅ FIX: use provided branchId or default to HR's own branch
      branchId: branchId || req.user.branchId || null,
      wageType:    wageType    || 'monthly',
      hourlyRate:  hourlyRate  || 0,
      dailyRate:   dailyRate   || 0,
      monthlyRate: monthlyRate || 0,
      isApproved:  false,
      createdBy:   req.user._id,
    });

    res.status(201).json({
      success:  true,
      employee: { ...employee.toObject(), password: undefined },
      message:  employee.name + ' added. Pending admin approval.',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /hr/employees
exports.getAllEmployees = async (req, res) => {
  try {
    const q = {};
    if (req.query.branchId)    q.branchId    = req.query.branchId;
    if (req.query.role)        q.role        = req.query.role;
    if (req.query.isApproved !== undefined)
      q.isApproved = req.query.isApproved === 'true';

    const employees = await User.find(q)
      .select('-password')
      .populate('branchId', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /hr/employees/:id
exports.updateEmployee = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (!updates.password) delete updates.password; // don't clear pw if not sent

    const employee = await User.findByIdAndUpdate(req.params.id, updates, { new: true }).select('-password');
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================================================================
   ATTENDANCE
   ================================================================ */

// POST /hr/attendance
exports.markAttendance = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut, notes, overtime } = req.body;
    const dateStr = new Date(date).toISOString().split('T')[0];

    let hoursWorked = 0;
    if (checkIn && checkOut)
      hoursWorked = calculateHours(
        new Date(dateStr + 'T' + checkIn),
        new Date(dateStr + 'T' + checkOut)
      );

    const attendance = await Attendance.findOneAndUpdate(
      { userId, date: new Date(date) },
      {
        userId, branchId: req.user.branchId, date: new Date(date),
        checkIn:  checkIn  ? new Date(dateStr + 'T' + checkIn)  : null,
        checkOut: checkOut ? new Date(dateStr + 'T' + checkOut) : null,
        status, hoursWorked, notes,
        overtime: parseFloat(overtime) || 0,
        markedBy: req.user._id,
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /hr/attendance/bulk
exports.bulkMarkAttendance = async (req, res) => {
  try {
    if (!Array.isArray(req.body))
      return res.status(400).json({ success: false, message: 'Array expected' });

    const results = await Promise.allSettled(req.body.map(r => {
      const dateStr = new Date(r.date).toISOString().split('T')[0];
      const hoursWorked = (r.checkIn && r.checkOut)
        ? calculateHours(new Date(dateStr + 'T' + r.checkIn), new Date(dateStr + 'T' + r.checkOut))
        : 0;
      return Attendance.findOneAndUpdate(
        { userId: r.userId, date: new Date(r.date) },
        {
          userId: r.userId, branchId: req.user.branchId, date: new Date(r.date),
          checkIn:  r.checkIn  ? new Date(dateStr + 'T' + r.checkIn)  : null,
          checkOut: r.checkOut ? new Date(dateStr + 'T' + r.checkOut) : null,
          status: r.status, hoursWorked, notes: r.notes,
          overtime: parseFloat(r.overtime) || 0, markedBy: req.user._id,
        },
        { new: true, upsert: true }
      );
    }));

    const saved = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, count: saved, message: 'Marked for ' + saved + ' employees' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /hr/attendance
exports.getAttendance = async (req, res) => {
  try {
    const q = {};
    if (req.query.userId)   q.userId   = req.query.userId;
    if (req.query.branchId) q.branchId = req.query.branchId;
    if (req.query.month && req.query.year) {
      const { startDate, endDate } = getMonthDateRange(req.query.month, req.query.year);
      q.date = { $gte: startDate, $lte: endDate };
    }
    const attendance = await Attendance.find(q)
      .populate('userId', 'name email role')
      .sort({ date: -1 });
    res.json({ success: true, attendance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /hr/attendance/summary
exports.getAttendanceSummary = async (req, res) => {
  try {
    const q = {};
    if (req.query.branchId) q.branchId = req.query.branchId;
    if (req.query.month && req.query.year) {
      const { startDate, endDate } = getMonthDateRange(req.query.month, req.query.year);
      q.date = { $gte: startDate, $lte: endDate };
    }
    const records = await Attendance.find(q);
    const by = s => records.filter(r => r.status === s).length;
    const presentCount = by('present');

    res.json({
      success: true,
      summary: {
        totalPresent:  presentCount,
        totalAbsent:   by('absent'),
        totalHalfDay:  by('half_day'),
        totalLeave:    by('leave'),
        totalHoliday:  by('holiday'),
        totalHours:    records.reduce((s, r) => s + (r.hoursWorked || 0), 0),
        totalOvertime: records.reduce((s, r) => s + (r.overtime    || 0), 0),
        avgHours: presentCount > 0
          ? records.reduce((s, r) => s + (r.hoursWorked || 0), 0) / presentCount : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================================================================
   SALARY
   ================================================================ */

// POST /hr/salary/calculate
exports.calculateMonthlySalary = async (req, res) => {
  try {
    const { userId, month, year } = req.body;
    const { startDate, endDate }  = getMonthDateRange(month, year);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Employee not found' });

    const records = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } });
    const present = records.filter(r => ['present', 'half_day'].includes(r.status));

    let baseSalary = 0;
    const wageType = user.wageType || 'monthly';

    if (wageType === 'hourly') {
      const totalHours = present.reduce((s, a) =>
        s + (a.status === 'half_day' ? a.hoursWorked / 2 : a.hoursWorked), 0);
      const overtime = present.reduce((s, a) => s + (a.overtime || 0), 0);
      baseSalary = (totalHours + overtime) * (user.hourlyRate || 0);
      return res.json({ success: true, calculation: { wageType, totalHours, overtime, rateUsed: user.hourlyRate, baseSalary } });
    }

    if (wageType === 'daily') {
      const days = present.reduce((s, a) => s + (a.status === 'half_day' ? 0.5 : 1), 0);
      baseSalary = days * (user.dailyRate || 0);
      return res.json({ success: true, calculation: { wageType, daysPresent: days, rateUsed: user.dailyRate, baseSalary } });
    }

    // monthly
    const absences   = records.filter(r => r.status === 'absent').length;
    const leaves     = records.filter(r => r.status === 'leave').length;
    const allowed    = user.leavesPerMonth || 2;
    const unpaid     = Math.max(0, leaves - allowed) + absences;
    baseSalary = Math.max(0, (user.monthlyRate || 0) - unpaid * ((user.monthlyRate || 0) / 26));
    res.json({ success: true, calculation: { wageType, rateUsed: user.monthlyRate, absences, leaves, allowed, unpaid, baseSalary } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /hr/salary
exports.createSalary = async (req, res) => {
  try {
    const { userId, month, year, baseSalary, bonus, deductions, notes } = req.body;
    const user = await User.findById(userId);
    const { startDate, endDate } = getMonthDateRange(month, year);
    const records = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } });
    const totalHours = records.reduce((s, r) => s + (r.hoursWorked || 0), 0);

    const total = Math.max(0,
      parseFloat(baseSalary) + parseFloat(bonus || 0) - parseFloat(deductions || 0));

    const salary = await Salary.findOneAndUpdate(
      { userId, month, year },
      {
        userId, branchId: user.branchId, month, year,
        wageType: user.wageType, totalHours,
        hourlyRate: user.hourlyRate, dailyRate: user.dailyRate, monthlyRate: user.monthlyRate,
        baseSalary, bonus: bonus || 0, deductions: deductions || 0,
        totalSalary: total, notes,
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, salary });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /hr/salary
exports.getSalaries = async (req, res) => {
  try {
    const q = {};
    if (req.query.userId)   q.userId   = req.query.userId;
    if (req.query.month)    q.month    = req.query.month;
    if (req.query.year)     q.year     = req.query.year;
    if (req.query.branchId) q.branchId = req.query.branchId;

    const salaries = await Salary.find(q)
      .populate('userId', 'name email role wageType hourlyRate dailyRate monthlyRate')
      .populate('paidBy', 'name')
      .sort({ year: -1, month: -1 });
    res.json({ success: true, salaries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /hr/salary/:id/pay
exports.paySalary = async (req, res) => {
  try {
    const salary = await Salary.findByIdAndUpdate(
      req.params.id,
      { isPaid: true, paidDate: new Date(), paidBy: req.user._id },
      { new: true }
    );
    if (!salary) return res.status(404).json({ success: false, message: 'Salary record not found' });
    res.json({ success: true, salary, message: 'Salary marked as paid' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};