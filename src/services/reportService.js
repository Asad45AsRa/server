const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Salary = require('../models/Salary');
const User = require('../models/User');

exports.generateSalesReport = async (branchId, startDate, endDate) => {
  const orders = await Order.find({
    branchId,
    status: 'completed',
    completedAt: { $gte: startDate, $lte: endDate }
  }).populate('items.itemId');

  const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
  const totalOrders = orders.length;

  return {
    totalSales,
    totalOrders,
    averageOrderValue: totalSales / totalOrders || 0,
    orders
  };
};

exports.generateStaffReport = async (branchId, month, year) => {
  const staff = await User.find({ branchId }).select('-password');
  
  const staffWithStats = await Promise.all(staff.map(async (employee) => {
    const orders = await Order.countDocuments({
      $or: [
        { waiterId: employee._id },
        { deliveryBoyId: employee._id },
        { chefId: employee._id }
      ],
      createdAt: { 
        $gte: new Date(year, month - 1, 1),
        $lte: new Date(year, month, 0)
      }
    });

    const salary = await Salary.findOne({ userId: employee._id, month, year });

    return {
      employee,
      totalOrders: orders,
      salary
    };
  }));

  return staffWithStats;
};

exports.generateInventoryReport = async (branchId) => {
  const Inventory = require('../models/Inventory');
  
  const inventory = await Inventory.find({ branchId });
  
  const lowStockItems = inventory.filter(item => item.currentStock <= item.minimumStock);
  const totalValue = inventory.reduce((sum, item) => sum + (item.currentStock * item.pricePerUnit), 0);

  return {
    totalItems: inventory.length,
    lowStockItems: lowStockItems.length,
    totalValue,
    inventory
  };
};

module.exports = exports;