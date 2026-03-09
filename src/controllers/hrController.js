const User       = require('../models/User');
const Attendance = require('../models/Attendance');
const Salary     = require('../models/Salary');
const { getMonthDateRange, calculateHours } = require('../utils/dateHelpers');

/* ================================================================
   HELPER — Auto generate email from role + name
   ================================================================ */
const generateEmail = async (role, name) => {
  const firstName = name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = `${role}.${firstName}@almadina.com`;
  const exists = await User.findOne({ email: base });
  if (!exists) return base;
  let n = 2;
  while (true) {
    const candidate = `${role}.${firstName}${n}@almadina.com`;
    const taken = await User.findOne({ email: candidate });
    if (!taken) return candidate;
    n++;
  }
};

/* ================================================================
   HELPER — Calculate overtime from hours worked
   regularHours default = 8 per day
   ================================================================ */
const calcOvertime = (hoursWorked, regularHoursPerDay = 8) => {
  return Math.max(0, hoursWorked - regularHoursPerDay);
};

/* ================================================================
   EMPLOYEES  —  HR creates, Admin approves
   ================================================================ */

// POST /hr/employees
exports.createEmployee = async (req, res) => {
  try {
    const {
      name, cnic, phone, address, password, role,
      wageType, hourlyRate, dailyRate, monthlyRate,
      leavesPerMonth, joiningDate, branchId,
      regularHoursPerDay,        // ✅ NEW: working hours per day
      overtimeRateMultiplier,    // ✅ NEW: e.g. 1.5x for overtime
      email: providedEmail,
    } = req.body;

    if (!name || !password || !phone || !role)
      return res.status(400).json({ success: false, message: 'name, password, phone, role are required' });

    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    let email = providedEmail ? providedEmail.trim().toLowerCase() : null;
    if (!email) {
      email = await generateEmail(role, name);
    } else {
      if (await User.findOne({ email }))
        return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const employee = await User.create({
      name:                  name.trim(),
      cnic:                  cnic          || '',
      phone:                 phone.trim(),
      address:               address       || '',
      email,
      password,
      role,
      branchId:              branchId || req.user.branchId || null,
      wageType:              wageType      || 'monthly',
      hourlyRate:            Number(hourlyRate)  || 0,
      dailyRate:             Number(dailyRate)   || 0,
      monthlyRate:           Number(monthlyRate) || 0,
      leavesPerMonth:        Number(leavesPerMonth) || 2,
      regularHoursPerDay:    Number(regularHoursPerDay) || 8,   // ✅
      overtimeRateMultiplier:Number(overtimeRateMultiplier) || 1.5, // ✅
      joinDate:              joiningDate ? new Date(joiningDate) : new Date(),
      isApproved:            false,
      isActive:              true,
      createdBy:             req.user._id,
    });

    const emp = employee.toObject();
    delete emp.password;

    res.status(201).json({
      success:  true,
      employee: emp,
      credentials: {
        email,
        password,
        loginNote: 'Employee can login after Admin approves the account.',
      },
      message: `${employee.name} added as ${role}. Pending admin approval.`,
    });
  } catch (err) {
    console.error('createEmployee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /hr/employees
exports.getAllEmployees = async (req, res) => {
  try {
    const q = {};
    if (req.query.branchId)  q.branchId = req.query.branchId;
    if (req.query.role)      q.role     = req.query.role;
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
    if (!updates.password) delete updates.password;

    const employee = await User.findByIdAndUpdate(
      req.params.id, updates, { new: true }
    ).select('-password');

    if (!employee)
      return res.status(404).json({ success: false, message: 'Employee not found' });

    res.json({ success: true, employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================================================================
   ATTENDANCE  — with auto overtime calculation
   ================================================================ */

// POST /hr/attendance
exports.markAttendance = async (req, res) => {
  try {
    const { userId, date, status, checkIn, checkOut, notes, manualOvertime } = req.body;
    const dateStr = new Date(date).toISOString().split('T')[0];

    // Get employee to know their regularHoursPerDay
    const employee = await User.findById(userId).select('regularHoursPerDay');
    const regularHours = employee?.regularHoursPerDay || 8;

    let hoursWorked    = 0;
    let overtimeHours  = 0;
    let totalOvertime  = 0;

    if (checkIn && checkOut) {
      hoursWorked   = calculateHours(
        new Date(dateStr + 'T' + checkIn),
        new Date(dateStr + 'T' + checkOut)
      );
      // Auto-calculate overtime
      overtimeHours = calcOvertime(hoursWorked, regularHours);
    }

    const manOT       = parseFloat(manualOvertime) || 0;
    totalOvertime     = overtimeHours + manOT;

    const attendance = await Attendance.findOneAndUpdate(
      { userId, date: new Date(date) },
      {
        userId,
        branchId:           req.user.branchId,
        date:               new Date(date),
        checkIn:            checkIn  ? new Date(dateStr + 'T' + checkIn)  : null,
        checkOut:           checkOut ? new Date(dateStr + 'T' + checkOut) : null,
        status,
        hoursWorked,
        regularHoursPerDay: regularHours,
        overtimeHours,
        manualOvertime:     manOT,
        totalOvertime,
        notes:              notes || '',
        markedBy:           req.user._id,
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

    // Pre-fetch all employees for regularHoursPerDay
    const userIds    = [...new Set(req.body.map(r => r.userId))];
    const employees  = await User.find({ _id: { $in: userIds } }).select('_id regularHoursPerDay');
    const empMap     = {};
    employees.forEach(e => { empMap[e._id.toString()] = e.regularHoursPerDay || 8; });

    const results = await Promise.allSettled(req.body.map(r => {
      const dateStr     = new Date(r.date).toISOString().split('T')[0];
      const regularHrs  = empMap[r.userId] || 8;

      let hoursWorked   = 0;
      let overtimeHours = 0;

      if (r.checkIn && r.checkOut) {
        hoursWorked   = calculateHours(
          new Date(dateStr + 'T' + r.checkIn),
          new Date(dateStr + 'T' + r.checkOut)
        );
        overtimeHours = calcOvertime(hoursWorked, regularHrs);
      }

      const manOT       = parseFloat(r.manualOvertime) || 0;
      const totalOT     = overtimeHours + manOT;

      return Attendance.findOneAndUpdate(
        { userId: r.userId, date: new Date(r.date) },
        {
          userId:             r.userId,
          branchId:           req.user.branchId,
          date:               new Date(r.date),
          checkIn:            r.checkIn  ? new Date(dateStr + 'T' + r.checkIn)  : null,
          checkOut:           r.checkOut ? new Date(dateStr + 'T' + r.checkOut) : null,
          status:             r.status,
          hoursWorked,
          regularHoursPerDay: regularHrs,
          overtimeHours,
          manualOvertime:     manOT,
          totalOvertime:      totalOT,
          notes:              r.notes || '',
          markedBy:           req.user._id,
        },
        { new: true, upsert: true }
      );
    }));

    const saved = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, count: saved, message: `Marked for ${saved} employees` });
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
      .populate('userId', 'name email role regularHoursPerDay')
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
    if (req.query.userId)   q.userId   = req.query.userId;
    if (req.query.month && req.query.year) {
      const { startDate, endDate } = getMonthDateRange(req.query.month, req.query.year);
      q.date = { $gte: startDate, $lte: endDate };
    }

    const records      = await Attendance.find(q);
    const by           = s => records.filter(r => r.status === s).length;
    const presentCount = by('present');
    const totalHours   = records.reduce((s, r) => s + (r.hoursWorked   || 0), 0);
    const totalOT      = records.reduce((s, r) => s + (r.totalOvertime || 0), 0);

    res.json({
      success: true,
      summary: {
        totalPresent:  presentCount,
        totalAbsent:   by('absent'),
        totalHalfDay:  by('half_day'),
        totalLeave:    by('leave'),
        totalHoliday:  by('holiday'),
        totalHours,
        totalOvertime: totalOT,
        avgHours:      presentCount > 0 ? totalHours / presentCount : 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================================================================
   ADVANCE SALARY
   ================================================================ */

// POST /hr/salary/advance  — give advance to employee
exports.giveAdvance = async (req, res) => {
  try {
    const { userId, amount, reason, month, year } = req.body;

    if (!userId || !amount || amount <= 0)
      return res.status(400).json({ success: false, message: 'userId and amount > 0 required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Employee not found' });

    const currentMonth = month || new Date().getMonth() + 1;
    const currentYear  = year  || new Date().getFullYear();

    // Find or create salary record for that month
    let salary = await Salary.findOne({ userId, month: currentMonth, year: currentYear });

    const advanceEntry = {
      amount:   Number(amount),
      date:     new Date(),
      reason:   reason || '',
      givenBy:  req.user._id,
      deducted: false,
    };

    if (salary) {
      salary.advances.push(advanceEntry);
      salary.totalAdvancePaid = (salary.totalAdvancePaid || 0) + Number(amount);
      await salary.save();
    } else {
      // Create a placeholder salary record to track advances
      salary = await Salary.create({
        userId,
        branchId:        user.branchId,
        month:           currentMonth,
        year:            currentYear,
        wageType:        user.wageType || 'monthly',
        hourlyRate:      user.hourlyRate  || 0,
        dailyRate:       user.dailyRate   || 0,
        monthlyRate:     user.monthlyRate || 0,
        totalHours:      0,
        baseSalary:      0,
        totalSalary:     0,
        netPayable:      0,
        advances:        [advanceEntry],
        totalAdvancePaid:Number(amount),
      });
    }

    res.json({
      success: true,
      salary,
      message: `Advance of Rs. ${amount} given to ${user.name}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /hr/salary/advances/:userId  — advance history for an employee
exports.getAdvanceHistory = async (req, res) => {
  try {
    const salaries = await Salary.find({ userId: req.params.userId })
      .select('month year advances totalAdvancePaid advanceDeducted')
      .populate('advances.givenBy', 'name')
      .sort({ year: -1, month: -1 });

    const allAdvances = [];
    salaries.forEach(s => {
      (s.advances || []).forEach(a => {
        allAdvances.push({
          ...a.toObject(),
          month: s.month,
          year:  s.year,
        });
      });
    });

    const totalPending = salaries.reduce((sum, s) => {
      return sum + (s.advances || []).filter(a => !a.deducted).reduce((x, a) => x + a.amount, 0);
    }, 0);

    res.json({ success: true, advances: allAdvances, totalPending });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================================================================
   SALARY — Calculate & Create with full advance deduction
   ================================================================ */

// POST /hr/salary/calculate
exports.calculateMonthlySalary = async (req, res) => {
  try {
    const { userId, month, year } = req.body;
    const { startDate, endDate }  = getMonthDateRange(month, year);

    const user = await User.findById(userId);
    if (!user)
      return res.status(404).json({ success: false, message: 'Employee not found' });

    const records  = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } });
    const present  = records.filter(r => ['present', 'half_day'].includes(r.status));
    const wageType = user.wageType || 'monthly';

    // Total overtime hours this month
    const totalOvertimeHours = records.reduce((s, r) => s + (r.totalOvertime || 0), 0);

    // Overtime rate = hourlyRate * overtimeRateMultiplier (default 1.5x)
    const overtimeMultiplier = user.overtimeRateMultiplier || 1.5;
    const hourlyEquivalent   =
      wageType === 'hourly'  ? (user.hourlyRate  || 0) :
      wageType === 'daily'   ? (user.dailyRate   || 0) / (user.regularHoursPerDay || 8) :
      /* monthly */            (user.monthlyRate || 0) / 26 / (user.regularHoursPerDay || 8);
    const overtimeRate = hourlyEquivalent * overtimeMultiplier;
    const overtimePay  = totalOvertimeHours * overtimeRate;

    // Get existing advances this month
    const existingSalary     = await Salary.findOne({ userId, month, year });
    const totalAdvancePaid   = existingSalary?.totalAdvancePaid || 0;

    let baseSalary   = 0;
    let calculation  = {};

    if (wageType === 'hourly') {
      // For hourly: use regular hours only (not overtime hours, those are separate)
      const regularHours = present.reduce((s, a) => {
        const hrs = a.hoursWorked || 0;
        const reg = Math.min(hrs, a.regularHoursPerDay || user.regularHoursPerDay || 8);
        return s + (a.status === 'half_day' ? reg / 2 : reg);
      }, 0);
      baseSalary = regularHours * (user.hourlyRate || 0);
      calculation = {
        wageType, regularHours, totalOvertimeHours,
        overtimeRate: overtimeRate.toFixed(2),
        overtimePay:  overtimePay.toFixed(2),
        rateUsed: user.hourlyRate, baseSalary,
        totalAdvancePaid,
        netAfterAdvance: Math.max(0, baseSalary + overtimePay - totalAdvancePaid),
      };
    } else if (wageType === 'daily') {
      const days     = present.reduce((s, a) => s + (a.status === 'half_day' ? 0.5 : 1), 0);
      baseSalary     = days * (user.dailyRate || 0);
      const totalHrs = present.reduce((s, a) => s + (a.hoursWorked || 0), 0);
      calculation    = {
        wageType, daysPresent: days, totalHours: totalHrs,
        totalOvertimeHours,
        overtimeRate: overtimeRate.toFixed(2),
        overtimePay:  overtimePay.toFixed(2),
        rateUsed: user.dailyRate, baseSalary,
        totalAdvancePaid,
        netAfterAdvance: Math.max(0, baseSalary + overtimePay - totalAdvancePaid),
      };
    } else {
      // Monthly
      const absences = records.filter(r => r.status === 'absent').length;
      const leaves   = records.filter(r => r.status === 'leave').length;
      const allowed  = user.leavesPerMonth || 2;
      const unpaid   = Math.max(0, leaves - allowed) + absences;
      const perDay   = (user.monthlyRate || 0) / 26;
      baseSalary     = Math.max(0, (user.monthlyRate || 0) - unpaid * perDay);
      const totalHrs = present.reduce((s, a) => s + (a.hoursWorked || 0), 0);
      calculation    = {
        wageType, rateUsed: user.monthlyRate,
        absences, leaves, allowed, unpaid,
        totalHours: totalHrs,
        totalOvertimeHours,
        overtimeRate: overtimeRate.toFixed(2),
        overtimePay:  overtimePay.toFixed(2),
        baseSalary,
        totalAdvancePaid,
        netAfterAdvance: Math.max(0, baseSalary + overtimePay - totalAdvancePaid),
      };
    }

    res.json({ success: true, calculation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /hr/salary
exports.createSalary = async (req, res) => {
  try {
    const {
      userId, month, year,
      baseSalary, bonus, deductions,
      advanceDeducted,  // ✅ How much advance to deduct this month
      notes,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Employee not found' });

    const { startDate, endDate } = getMonthDateRange(month, year);
    const records    = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } });
    const totalHours = records.reduce((s, r) => s + (r.hoursWorked   || 0), 0);
    const totalOT    = records.reduce((s, r) => s + (r.totalOvertime || 0), 0);

    // Calculate overtime pay
    const overtimeMultiplier = user.overtimeRateMultiplier || 1.5;
    const hourlyEquivalent   =
      user.wageType === 'hourly'  ? (user.hourlyRate  || 0) :
      user.wageType === 'daily'   ? (user.dailyRate   || 0) / (user.regularHoursPerDay || 8) :
      (user.monthlyRate || 0) / 26 / (user.regularHoursPerDay || 8);
    const overtimeRate = hourlyEquivalent * overtimeMultiplier;
    const overtimePay  = totalOT * overtimeRate;

    // Advance handling
    const advDed   = parseFloat(advanceDeducted) || 0;
    const grossPay = parseFloat(baseSalary) + overtimePay + parseFloat(bonus || 0);
    const total    = Math.max(0, grossPay - parseFloat(deductions || 0) - advDed);

    // Get existing record (may have advances recorded)
    const existing = await Salary.findOne({ userId, month, year });

    const salaryData = {
      userId,
      branchId:        user.branchId,
      month,
      year,
      wageType:        user.wageType     || 'monthly',
      hourlyRate:      user.hourlyRate   || 0,
      dailyRate:       user.dailyRate    || 0,
      monthlyRate:     user.monthlyRate  || 0,
      totalHours,
      totalOvertime:   totalOT,
      overtimeRate:    parseFloat(overtimeRate.toFixed(2)),
      overtimePay:     parseFloat(overtimePay.toFixed(2)),
      baseSalary:      parseFloat(baseSalary),
      bonus:           parseFloat(bonus      || 0),
      deductions:      parseFloat(deductions || 0),
      advanceDeducted: advDed,
      totalAdvancePaid: existing?.totalAdvancePaid || 0,
      advances:         existing?.advances || [],
      totalSalary:     parseFloat(grossPay.toFixed(2)),
      netPayable:      parseFloat(total.toFixed(2)),
      notes,
    };

    // Mark advances as deducted if advanceDeducted > 0
    if (advDed > 0 && existing?.advances?.length) {
      let remaining = advDed;
      salaryData.advances = existing.advances.map(a => {
        if (remaining <= 0 || a.deducted) return a;
        remaining -= a.amount;
        return { ...a.toObject(), deducted: true };
      });
    }

    const salary = await Salary.findOneAndUpdate(
      { userId, month, year },
      salaryData,
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
      .populate('userId', 'name email role wageType hourlyRate dailyRate monthlyRate regularHoursPerDay overtimeRateMultiplier')
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
    if (!salary)
      return res.status(404).json({ success: false, message: 'Salary record not found' });

    res.json({ success: true, salary, message: 'Salary marked as paid' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};