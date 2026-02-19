const Attendance = require('../models/Attendance');
const Salary = require('../models/Salary');
const User = require('../models/User');
const { getMonthDateRange } = require('../utils/dateHelpers');

exports.calculateEmployeeSalary = async (userId, month, year) => {
  const { startDate, endDate } = getMonthDateRange(month, year);

  const attendance = await Attendance.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  });

  const totalHours = attendance.reduce((sum, att) => {
    if (att.status === 'half_day') {
      return sum + (att.hoursWorked / 2);
    }
    return sum + (att.hoursWorked || 0);
  }, 0);

  const user = await User.findById(userId);
  const baseSalary = totalHours * (user.hourlyRate || 0);

  return {
    userId,
    month,
    year,
    totalHours,
    hourlyRate: user.hourlyRate,
    baseSalary
  };
};

exports.processMonthlySalaries = async (branchId, month, year) => {
  const employees = await User.find({ branchId, isActive: true });

  const salaries = await Promise.all(
    employees.map(async (employee) => {
      const calculation = await this.calculateEmployeeSalary(employee._id, month, year);
      
      const salary = await Salary.findOneAndUpdate(
        { userId: employee._id, month, year },
        {
          ...calculation,
          branchId,
          totalSalary: calculation.baseSalary
        },
        { new: true, upsert: true }
      );

      return salary;
    })
  );

  return salaries;
};

module.exports = exports;