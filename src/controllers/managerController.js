const Order = require('../models/Order');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Inventory = require('../models/Inventory');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Attendance = require('../models/Attendance');
const Salary = require('../models/Salary');
const { getMonthDateRange } = require('../utils/dateHelpers');

// ✅ FIX: Always fetch fresh user from DB so managerRights are always up-to-date
// (req.user from JWT might not have latest rights after admin updates them)
const getFreshUser = async (userId) => {
  return await User.findById(userId).select('-password').populate('branchId', 'name city');
};

// Helper: resolve rights (fullControl overrides all)
const getRights = (user) => {
  const r = user?.managerRights || {};
  if (r.fullControl) {
    return {
      orders: true, parcel: true, staff: true, inventory: true,
      products: true, deals: true, reports: true, hr: true, fullControl: true
    };
  }
  return {
    orders: r.orders || false,
    parcel: r.parcel || false,
    staff: r.staff || false,
    inventory: r.inventory || false,
    products: r.products || false,
    deals: r.deals || false,
    reports: r.reports || false,
    hr: r.hr || false,
    fullControl: false,
  };
};

// ========== MY RIGHTS ==========
exports.getMyRights = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    if (!freshUser) return res.status(404).json({ success: false, message: 'User not found' });

    const rights = getRights(freshUser);
    res.json({
      success: true,
      rights,
      manager: {
        name: freshUser.name,
        email: freshUser.email,
        branchId: freshUser.branchId
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DASHBOARD ==========
exports.getDashboard = async (req, res) => {
  try {
    // ✅ Always fresh user for latest rights
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);
    const { month, year } = req.query;

    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Manager is not assigned to any branch' });
    }

    let dateQuery = {};
    if (month && year) {
      const { startDate, endDate } = getMonthDateRange(month, year);
      dateQuery = { createdAt: { $gte: startDate, $lte: endDate } };
    }

    const branchFilter = { branchId };
    const query = { ...branchFilter, ...dateQuery };

    // Basic stats (always visible)
    const totalOrders = await Order.countDocuments(query);
    const completedOrders = await Order.countDocuments({ ...query, status: 'completed' });
    const pendingOrders = await Order.countDocuments({ ...branchFilter, status: 'pending', ...dateQuery });

    const revenue = await Payment.aggregate([
      { $match: { branchId, status: 'paid', ...(dateQuery.createdAt ? { createdAt: dateQuery.createdAt } : {}) } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenue.length > 0 ? revenue[0].total : 0;

    // Staff (if right granted)
    let staffData = {};
    if (rights.staff || rights.fullControl) {
      const totalStaff = await User.countDocuments({ branchId, isActive: true, role: { $ne: 'admin' } });
      const activeStaff = await User.countDocuments({ branchId, isActive: true, isApproved: true, role: { $ne: 'admin' } });
      staffData = { totalStaff, activeStaff };
    }

    // Inventory (if right granted)
    let inventoryData = {};
    if (rights.inventory || rights.fullControl) {
      const lowStockItems = await Inventory.countDocuments({
        branchId, isActive: true,
        $expr: { $lte: ['$currentStock', '$minimumStock'] }
      });
      inventoryData = { lowStockItems };
    }

    // Recent orders (if orders or parcel right granted)
    let recentOrders = [];
    if (rights.orders || rights.parcel || rights.fullControl) {
      let orderFilter = { ...branchFilter, ...dateQuery };
      if (rights.parcel && !rights.orders && !rights.fullControl) {
        orderFilter.orderType = 'delivery';
      }
      recentOrders = await Order.find(orderFilter)
        .populate('waiterId chefId deliveryBoyId', 'name')
        .sort({ createdAt: -1 })
        .limit(10);
    }

    const completionRate = totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      rights,  // ✅ Send rights so frontend knows what to show
      data: {
        totalOrders,
        completedOrders,
        pendingOrders,
        totalRevenue,
        completionRate,
        ...staffData,
        ...inventoryData,
        recentOrders
      }
    });
  } catch (error) {
    console.error('Manager Dashboard Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ORDERS ==========
exports.getBranchOrders = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);
    const { status, startDate, endDate, orderType } = req.query;

    // Must have at least orders or parcel right
    if (!rights.orders && !rights.parcel && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied: Orders right not granted' });
    }

    let query = { branchId };

    // Parcel-only managers see only delivery orders
    if (!rights.orders && !rights.fullControl && rights.parcel) {
      query.orderType = 'delivery';
    } else if (orderType) {
      query.orderType = orderType;
    }

    if (status) query.status = status;
    if (startDate && endDate) {
      query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    const orders = await Order.find(query)
      .populate('waiterId chefId deliveryBoyId cashierId', 'name role')
      .sort({ createdAt: -1 });

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.orders && !rights.parcel && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { status } = req.body;
    const validStatuses = ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    // Ensure order belongs to manager's branch
    const existingOrder = await Order.findOne({ _id: req.params.id, branchId });
    if (!existingOrder) {
      return res.status(404).json({ success: false, message: 'Order not found in your branch' });
    }

    const updateData = { status };
    const timestampMap = {
      accepted: 'acceptedAt', preparing: 'preparingAt', ready: 'readyAt',
      delivered: 'deliveredAt', completed: 'completedAt'
    };
    if (timestampMap[status]) updateData[timestampMap[status]] = new Date();

    const updated = await Order.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .populate('waiterId chefId deliveryBoyId cashierId', 'name');

    res.json({ success: true, order: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== STAFF ==========
exports.getBranchStaff = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.staff && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied: Staff right not granted' });
    }

    const staff = await User.find({ branchId, role: { $ne: 'admin' } })
      .select('-password')
      .sort({ name: 1 });

    res.json({ success: true, staff, count: staff.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== INVENTORY ==========
exports.getBranchInventory = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.inventory && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied: Inventory right not granted' });
    }

    const inventory = await Inventory.find({ branchId, isActive: true }).sort({ name: 1 });
    const lowStockItems = inventory.filter(i => i.currentStock <= i.minimumStock);
    const totalValue = inventory.reduce((sum, i) => sum + (i.currentStock * (i.averageCost || i.pricePerUnit)), 0);

    res.json({
      success: true, inventory,
      statistics: { totalItems: inventory.length, lowStockCount: lowStockItems.length, totalValue }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PRODUCTS ==========
exports.getBranchProducts = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.products && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied: Products right not granted' });
    }

    const products = await Product.find({ branchId, isAvailable: true })
      .populate('createdBy', 'name');

    res.json({ success: true, products, count: products.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBranchProduct = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.products && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, branchId },
      req.body,
      { new: true }
    );
    if (!product) return res.status(404).json({ success: false, message: 'Product not found in your branch' });

    res.json({ success: true, product });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DEALS ==========
exports.getBranchDeals = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.deals && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied: Deals right not granted' });
    }

    const deals = await Deal.find({ branchId, isActive: true })
      .populate('products.productId', 'name');

    res.json({ success: true, deals, count: deals.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== REPORTS ==========
exports.getBranchReports = async (req, res) => {
  try {
    const freshUser = await getFreshUser(req.user._id);
    const branchId = freshUser.branchId?._id || freshUser.branchId;
    const rights = getRights(freshUser);

    if (!rights.reports && !rights.fullControl) {
      return res.status(403).json({ success: false, message: 'Access denied: Reports right not granted' });
    }

    const { startDate, endDate, reportType } = req.query;
    let query = { branchId };
    if (startDate && endDate) {
      query.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }

    let reportData = {};

    if (reportType === 'sales') {
      const orders = await Order.find(query).populate('waiterId cashierId', 'name');
      const rev = await Payment.aggregate([
        { $match: { branchId, status: 'paid', ...(startDate ? { createdAt: query.createdAt } : {}) } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      reportData = {
        orders,
        totalSales: rev.length > 0 ? rev[0].total : 0,
        totalOrders: orders.length,
        completedOrders: orders.filter(o => o.status === 'completed').length
      };
    }

    if (reportType === 'staff') {
      if (!rights.staff && !rights.fullControl) {
        return res.status(403).json({ success: false, message: 'Staff right required for staff reports' });
      }
      reportData.staff = await User.find({ branchId }).select('-password');
    }

    if (reportType === 'inventory') {
      if (!rights.inventory && !rights.fullControl) {
        return res.status(403).json({ success: false, message: 'Inventory right required for inventory reports' });
      }
      const inventory = await Inventory.find({ branchId, isActive: true });
      reportData.inventory = inventory;
      reportData.totalValue = inventory.reduce((sum, i) => sum + (i.currentStock * (i.averageCost || i.pricePerUnit)), 0);
    }

    res.json({ success: true, report: reportData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};