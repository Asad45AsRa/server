const User = require('../models/User');
const Branch = require('../models/Branch');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Salary = require('../models/Salary');
const Attendance = require('../models/Attendance');
const Inventory = require('../models/Inventory');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const bcrypt = require('bcryptjs');
const { getMonthDateRange } = require('../utils/dateHelpers');

// ========== DASHBOARD ==========
exports.getDashboard = async (req, res) => {
  try {
    const { month, year, branchId } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    let dateQuery = {};
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };
    }

    const totalOrders = await Order.countDocuments({ ...query, ...dateQuery });
    const completedOrders = await Order.countDocuments({ ...query, ...dateQuery, status: 'completed' });
    const pendingOrders = await Order.countDocuments({ ...query, ...dateQuery, status: 'pending' });
    const orderCompletionRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

    const revenueData = await Payment.aggregate([
      { $match: { ...query, ...(dateQuery.createdAt && { createdAt: dateQuery.createdAt }), status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

    let salaryQuery = { ...query };
    if (month && year) { salaryQuery.month = parseInt(month); salaryQuery.year = parseInt(year); }
    const salariesData = await Salary.aggregate([
      { $match: salaryQuery },
      { $group: { _id: null, total: { $sum: '$totalSalary' } } }
    ]);
    const totalSalaries = salariesData.length > 0 ? salariesData[0].total : 0;

    const inventoryData = await Inventory.aggregate([
      { $match: { ...(branchId ? { branchId } : {}), isActive: true } },
      { $project: { totalValue: { $multiply: ['$currentStock', { $ifNull: ['$averageCost', '$pricePerUnit'] }] } } },
      { $group: { _id: null, total: { $sum: '$totalValue' } } }
    ]);
    const totalInventoryCost = inventoryData.length > 0 ? inventoryData[0].total : 0;

    const totalExpenses = totalSalaries + (totalInventoryCost * 0.1);
    const profit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : 0;

    const totalWorkers = await User.countDocuments({ ...query, role: { $ne: 'admin' } });
    const activeWorkers = await User.countDocuments({ ...query, isActive: true, isApproved: true, role: { $ne: 'admin' } });
    const inactiveWorkers = await User.countDocuments({ ...query, isActive: false, role: { $ne: 'admin' } });
    const pendingWorkers = await User.countDocuments({ ...query, isApproved: false, isActive: true, role: { $ne: 'admin' } });

    const totalProducts = await Product.countDocuments({ ...(branchId ? { branchId } : {}), isAvailable: true });
    const totalBranches = await Branch.countDocuments({});
    const activeBranches = await Branch.countDocuments({ isActive: true });
    const inactiveBranches = await Branch.countDocuments({ isActive: false });

    let attendanceQuery = { ...(branchId ? { branchId } : {}) };
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      attendanceQuery.date = { $gte: startDate, $lte: endDate };
    }
    const attendanceSummary = await Attendance.aggregate([
      { $match: attendanceQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const attendanceCounts = { present: 0, absent: 0, half_day: 0, leave: 0 };
    attendanceSummary.forEach(item => { attendanceCounts[item._id] = item.count; });
    const presentDays = attendanceCounts.present;
    const absentDays = attendanceCounts.absent;
    const totalAttendanceDays = presentDays + absentDays + attendanceCounts.half_day;
    const attendanceRate = totalAttendanceDays > 0 ? Math.round((presentDays / totalAttendanceDays) * 100) : 0;

    const lowStockItems = await Inventory.countDocuments({
      ...(branchId ? { branchId } : {}), isActive: true,
      $expr: { $lte: ['$currentStock', '$minimumStock'] }
    });

    const recentOrders = await Order.find({ ...query, ...dateQuery })
      .populate('waiterId chefId deliveryBoyId', 'name')
      .populate('branchId', 'name')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      success: true,
      data: {
        totalOrders, completedOrders, pendingOrders, orderCompletionRate,
        totalRevenue, totalExpenses, totalSalaries, totalInventoryCost,
        profit, loss: profit < 0 ? Math.abs(profit) : 0, profitMargin,
        totalWorkers, activeWorkers, inactiveWorkers, pendingWorkers,
        totalProducts, totalBranches, activeBranches, inactiveBranches, lowStockItems,
        presentDays, absentDays, attendanceRate, attendance: attendanceCounts,
        recentOrders
      }
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== BRANCHES ==========
exports.getAllBranches = async (req, res) => {
  try {
    const branches = await Branch.find().populate('managerId', 'name email managerRights');
    res.json({ success: true, branches });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.createBranch = async (req, res) => {
  try {
    const branch = await Branch.create(req.body);
    res.status(201).json({ success: true, branch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, branch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteBranch = async (req, res) => {
  try {
    await Branch.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Branch deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== USERS ==========
exports.getAllUsers = async (req, res) => {
  try {
    const { role, branchId } = req.query;
    let query = {};
    if (role) query.role = role;
    if (branchId) query.branchId = branchId;
    const users = await User.find(query).select('-password').populate('branchId', 'name city');
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isApproved: true, approvedBy: req.user._id },
      { new: true }
    ).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id, { role, isApproved: false }, { new: true }
    ).select('-password');
    res.json({ success: true, user, message: 'Role updated, pending admin approval' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ FIXED: resetUserPassword
// Bug was: manually hashing + findByIdAndUpdate could cause double-hash
// if User model also has pre('findOneAndUpdate') hook.
// Fix: use findById + user.save() so pre('save') hook handles hashing correctly.
exports.resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Set plain-text password — pre('save') hook in User model will hash it
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: `Password reset successfully for ${user.name}`,
      user: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error('resetUserPassword Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MANAGER RIGHTS ==========
const DEFAULT_RIGHTS = {
  orders: false, parcel: false, staff: false, inventory: false,
  products: false, deals: false, reports: false, hr: false, fullControl: false
};

exports.getManagerRights = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('name email role managerRights branchId')
      .populate('branchId', 'name city');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let managerRights = { ...DEFAULT_RIGHTS };
    if (user.managerRights) {
      const raw = typeof user.managerRights.toObject === 'function'
        ? user.managerRights.toObject()
        : user.managerRights;
      const { _id, __v, ...cleanRights } = raw;
      managerRights = { ...DEFAULT_RIGHTS, ...cleanRights };
    }

    res.json({
      success: true,
      user: {
        _id: user._id, name: user.name, email: user.email,
        role: user.role, branchId: user.branchId, managerRights
      }
    });
  } catch (error) {
    console.error('getManagerRights Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.assignManagerRights = async (req, res) => {
  try {
    const { userId, rights } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId is required' });
    if (!rights) return res.status(400).json({ success: false, message: 'rights are required' });

    const targetUser = await User.findById(userId);
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });

    let resolvedRights = { ...DEFAULT_RIGHTS, ...rights };
    if (rights.fullControl) {
      resolvedRights = {
        orders: true, parcel: true, staff: true, inventory: true,
        products: true, deals: true, reports: true, hr: true, fullControl: true
      };
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { managerRights: resolvedRights } },
      { new: true, runValidators: false }
    ).select('-password').populate('branchId', 'name');

    res.json({ success: true, message: `Rights updated for ${user.name}`, user, assignedRights: resolvedRights });
  } catch (error) {
    console.error('assignManagerRights Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== WORKER STATS ==========
exports.getWorkerStats = async (req, res) => {
  try {
    const { userId, month, year } = req.query;
    if (!userId || !month || !year) {
      return res.status(400).json({ success: false, message: 'userId, month, and year are required' });
    }
    const { startDate, endDate } = getMonthDateRange(month, year);
    const user = await User.findById(userId).select('-password').populate('branchId', 'name city');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const ordersQuery = {
      $or: [{ waiterId: userId }, { deliveryBoyId: userId }, { chefId: userId }, { cashierId: userId }],
      createdAt: { $gte: startDate, $lte: endDate }
    };
    const totalOrders = await Order.countDocuments(ordersQuery);
    const completedOrders = await Order.countDocuments({ ...ordersQuery, status: 'completed' });
    const recentOrders = await Order.find(ordersQuery)
      .populate('branchId', 'name').sort({ createdAt: -1 }).limit(20);

    const attendance = await Attendance.find({ userId, date: { $gte: startDate, $lte: endDate } }).sort({ date: -1 });
    const totalHours = attendance.reduce((sum, att) => sum + (att.hoursWorked || 0), 0);
    const presentDays = attendance.filter(a => a.status === 'present').length;
    const absentDays = attendance.filter(a => a.status === 'absent').length;
    const halfDays = attendance.filter(a => a.status === 'half_day').length;
    const leaveDays = attendance.filter(a => a.status === 'leave').length;

    const salary = await Salary.findOne({ userId, month: parseInt(month), year: parseInt(year) });

    let managerRights = null;
    if (user.role === 'manager') {
      managerRights = user.managerRights
        ? (typeof user.managerRights.toObject === 'function' ? user.managerRights.toObject() : user.managerRights)
        : DEFAULT_RIGHTS;
    }

    res.json({
      success: true,
      stats: {
        user: {
          _id: user._id, name: user.name, email: user.email, role: user.role,
          phone: user.phone, hourlyRate: user.hourlyRate, branch: user.branchId,
          joinDate: user.joinDate, isActive: user.isActive, isApproved: user.isApproved,
          managerRights
        },
        orders: { total: totalOrders, completed: completedOrders, recentOrders },
        attendance: {
          totalHours: Math.round(totalHours * 10) / 10,
          presentDays, absentDays, halfDays, leaveDays, totalDays: attendance.length
        },
        salary: salary || null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PRODUCTS ==========
exports.getAllProducts = async (req, res) => {
  try {
    const { branchId } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    const products = await Product.find(query)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit');
    res.json({ success: true, products, count: products.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteProduct = async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isAvailable: false });
    res.json({ success: true, message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DEALS ==========
exports.getAllDeals = async (req, res) => {
  try {
    const { branchId } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    const deals = await Deal.find(query)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('products.productId', 'name');
    res.json({ success: true, deals, count: deals.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteDeal = async (req, res) => {
  try {
    await Deal.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Deal deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== INVENTORY ==========
exports.getAllInventory = async (req, res) => {
  try {
    const { branchId, category } = req.query;
    let query = { isActive: true };
    if (branchId) query.branchId = branchId;
    if (category) query.category = category;
    const inventory = await Inventory.find(query).populate('branchId', 'name').sort({ name: 1 });
    const totalValue = inventory.reduce((sum, i) => sum + (i.currentStock * (i.averageCost || i.pricePerUnit)), 0);
    const lowStockCount = inventory.filter(i => i.currentStock <= i.minimumStock).length;
    res.json({ success: true, inventory, statistics: { totalItems: inventory.length, totalValue, lowStockCount } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ORDERS ==========
exports.getAllOrders = async (req, res) => {
  try {
    const { branchId, status, startDate, endDate } = req.query;
    let query = {};
    if (branchId) query.branchId = branchId;
    if (status) query.status = status;
    if (startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end = new Date(endDate); end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    const orders = await Order.find(query)
      .populate('branchId', 'name')
      .populate('waiterId chefId deliveryBoyId cashierId', 'name role')
      .sort({ createdAt: -1 }).lean();
    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });
    const validStatuses = ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });
    const updateData = { status };
    const tsMap = { accepted: 'acceptedAt', preparing: 'preparingAt', ready: 'readyAt', delivered: 'deliveredAt', completed: 'completedAt' };
    if (tsMap[status]) updateData[tsMap[status]] = new Date();
    const order = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate('branchId waiterId chefId deliveryBoyId cashierId', 'name');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;