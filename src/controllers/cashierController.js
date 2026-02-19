const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Table = require('../models/Table');
const Inventory = require('../models/Inventory');
const { PaymentStatus } = require('../config/constants');

// ========== INVENTORY DEDUCTION HELPER ==========
// Yeh function chef ke order accept karne par call hogi
// Cashier ko yeh show nahi hogi - backend mein quietly chalta hai

const deductInventoryForOrder = async (order) => {
  try {
    for (const item of order.items) {
      // item.itemId could be a Product or Deal
      let product = null;

      // Try to find as product first
      product = await Product.findById(item.itemId)
        .populate('sizes.ingredients.inventoryItemId');

      if (product) {
        // Find matching size
        const sizeData = product.sizes.find(
          s => s.size.toLowerCase() === (item.size || 'medium').toLowerCase()
        );

        if (sizeData && sizeData.ingredients && sizeData.ingredients.length > 0) {
          for (const ingredient of sizeData.ingredients) {
            const deductQty = ingredient.quantity * (item.quantity || 1);

            await Inventory.findByIdAndUpdate(
              ingredient.inventoryItemId._id || ingredient.inventoryItemId,
              {
                $inc: { currentStock: -deductQty }
              }
            );

            console.log(
              `Inventory deducted: ${ingredient.inventoryItemId.name || ingredient.inventoryItemId} - ${deductQty} units`
            );
          }
        }
      }

      // If item is from a deal
      const deal = await Deal.findById(item.itemId)
        .populate({
          path: 'products.productId',
          populate: { path: 'sizes.ingredients.inventoryItemId' }
        });

      if (deal) {
        for (const dealProduct of deal.products) {
          const prod = dealProduct.productId;
          if (!prod) continue;

          const sizeData = prod.sizes.find(
            s => s.size.toLowerCase() === (dealProduct.size || 'medium').toLowerCase()
          );

          if (sizeData && sizeData.ingredients) {
            for (const ingredient of sizeData.ingredients) {
              const deductQty = ingredient.quantity * (dealProduct.quantity || 1) * (item.quantity || 1);

              await Inventory.findByIdAndUpdate(
                ingredient.inventoryItemId._id || ingredient.inventoryItemId,
                { $inc: { currentStock: -deductQty } }
              );
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Inventory deduction error (non-fatal):', error);
    // Non-fatal - order still proceeds even if deduction fails
  }
};

// Export so chef/order controller can also use it
exports.deductInventoryForOrder = deductInventoryForOrder;

// ========== ORDERS ==========

exports.getPendingOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const orders = await Order.find({
      branchId,
      status: { $in: ['pending', 'accepted', 'preparing', 'ready'] }
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name')
      .populate('items.itemId')
      .sort({ createdAt: 1 });

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get pending orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCompletedOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { startDate, endDate } = req.query;

    let query = { branchId, status: 'completed' };

    if (startDate && endDate) {
      query.completedAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59))
      };
    }

    const orders = await Order.find(query)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name')
      .populate('cashierId', 'name')
      .populate('items.itemId')
      .sort({ completedAt: -1 })
      .limit(100);

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get completed orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PAYMENT ==========

exports.receivePayment = async (req, res) => {
  try {
    const { orderId, amount, method, receivedAmount, transactionId, notes } = req.body;

    const order = await Order.findById(orderId)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const changeAmount = receivedAmount ? receivedAmount - amount : 0;

    const payment = await Payment.create({
      orderId,
      branchId: req.user.branchId,
      amount,
      method,
      status: PaymentStatus.PAID,
      cashierId: req.user._id,
      waiterId: order.waiterId,
      deliveryBoyId: order.deliveryBoyId,
      receivedAmount,
      changeAmount,
      transactionId,
      notes,
      paidAt: new Date()
    });

    // Update order status
    order.status = 'completed';
    order.completedAt = new Date();
    order.cashierId = req.user._id;
    await order.save();

    // Free up table if dine-in
    if (order.tableNumber) {
      await Table.findOneAndUpdate(
        { branchId: req.user.branchId, tableNumber: order.tableNumber },
        { isOccupied: false, currentOrderId: null }
      );
    }

    // Populate payment for slip
    const populatedPayment = await Payment.findById(payment._id)
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .populate('orderId');

    res.json({
      success: true,
      payment: populatedPayment,
      order,
      slipData: buildSlipData(order, populatedPayment),
      message: 'Payment received successfully'
    });
  } catch (error) {
    console.error('Receive payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PAYMENT SLIP ==========

const buildSlipData = (order, payment) => {
  return {
    orderNumber: order.orderNumber,
    orderType: order.orderType,
    tableNumber: order.tableNumber,
    items: order.items.map(item => ({
      name: item.itemId?.name || item.name || 'Item',
      size: item.size,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.price * item.quantity
    })),
    subtotal: order.subtotal || order.total,
    discount: order.discount || 0,
    tax: order.tax || 0,
    total: order.total,
    paymentMethod: payment.method,
    receivedAmount: payment.receivedAmount,
    changeAmount: payment.changeAmount,
    cashier: payment.cashierId?.name || 'Cashier',
    waiter: payment.waiterId?.name || null,
    paidAt: payment.paidAt,
    branchName: order.branchId?.name || 'Restaurant'
  };
};

exports.getPaymentSlip = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .populate({
        path: 'orderId',
        populate: [
          { path: 'items.itemId' },
          { path: 'branchId', select: 'name address phone' }
        ]
      });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }

    const order = payment.orderId;
    const slipData = buildSlipData(order, payment);

    res.json({ success: true, slipData });
  } catch (error) {
    console.error('Get payment slip error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPaymentHistory = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { startDate, endDate } = req.query;

    let query = { branchId };

    if (startDate && endDate) {
      query.paidAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59))
      };
    }

    const payments = await Payment.find(query)
      .populate('orderId', 'orderNumber total orderType')
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .sort({ paidAt: -1 })
      .limit(100);

    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

    res.json({
      success: true,
      payments,
      summary: { totalPayments: payments.length, totalAmount }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== HOURLY INCOME REPORT ==========

exports.getHourlyIncomeReport = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { date } = req.query;

    // Default to today
    const reportDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    const payments = await Payment.find({
      branchId,
      paidAt: { $gte: startOfDay, $lte: endOfDay }
    }).populate('orderId', 'orderType orderNumber');

    // Group by hour
    const hourlyData = {};
    for (let h = 0; h < 24; h++) {
      hourlyData[h] = {
        hour: h,
        label: `${h.toString().padStart(2, '0')}:00 - ${(h + 1).toString().padStart(2, '0')}:00`,
        totalAmount: 0,
        orderCount: 0,
        cash: 0,
        card: 0,
        online: 0
      };
    }

    payments.forEach(payment => {
      const hour = new Date(payment.paidAt).getHours();
      hourlyData[hour].totalAmount += payment.amount;
      hourlyData[hour].orderCount += 1;
      if (payment.method === 'cash') hourlyData[hour].cash += payment.amount;
      else if (payment.method === 'card') hourlyData[hour].card += payment.amount;
      else if (payment.method === 'online') hourlyData[hour].online += payment.amount;
    });

    const hourlyArray = Object.values(hourlyData).filter(h => h.totalAmount > 0 || h.orderCount > 0);

    const summary = {
      totalRevenue: payments.reduce((s, p) => s + p.amount, 0),
      totalOrders: payments.length,
      cashTotal: payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0),
      cardTotal: payments.filter(p => p.method === 'card').reduce((s, p) => s + p.amount, 0),
      onlineTotal: payments.filter(p => p.method === 'online').reduce((s, p) => s + p.amount, 0),
      peakHour: hourlyArray.length > 0
        ? hourlyArray.reduce((max, h) => h.totalAmount > max.totalAmount ? h : max, hourlyArray[0])
        : null
    };

    res.json({
      success: true,
      date: reportDate.toISOString().split('T')[0],
      hourlyData: hourlyArray,
      summary
    });
  } catch (error) {
    console.error('Hourly income report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ORDER STATUS UPDATE (for chef to call deduction) ==========
// Yeh route chef controller mein bhi honi chahiye
// Jab bhi order status 'accepted' ho, inventory deduct ho

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id).populate('items.itemId');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const previousStatus = order.status;
    order.status = status;

    // Jab chef accept kare - inventory deduct karo (cashier ko show nahi hoga)
    if (status === 'accepted' && previousStatus === 'pending') {
      await deductInventoryForOrder(order);
    }

    await order.save();

    res.json({ success: true, order, message: `Order status updated to ${status}` });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PRODUCTS ==========

exports.createProduct = async (req, res) => {
  try {
    const productData = {
      ...req.body,
      branchId: req.user.branchId,
      createdBy: req.user._id
    };

    const product = await Product.create(productData);

    const populatedProduct = await Product.findById(product._id)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit');

    res.status(201).json({
      success: true,
      product: populatedProduct,
      message: 'Product created successfully'
    });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit');

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({ success: true, product, message: 'Product updated successfully' });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const products = await Product.find({ branchId })
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit')
      .sort({ createdAt: -1 });

    res.json({ success: true, products, count: products.length });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DEALS ==========

exports.createDeal = async (req, res) => {
  try {
    const dealData = {
      ...req.body,
      branchId: req.user.branchId,
      createdBy: req.user._id
    };

    const deal = await Deal.create(dealData);

    const populatedDeal = await Deal.findById(deal._id)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('products.productId', 'name image');

    res.status(201).json({ success: true, deal: populatedDeal, message: 'Deal created successfully' });
  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDeal = async (req, res) => {
  try {
    const deal = await Deal.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('products.productId', 'name image');

    if (!deal) {
      return res.status(404).json({ success: false, message: 'Deal not found' });
    }

    res.json({ success: true, deal, message: 'Deal updated successfully' });
  } catch (error) {
    console.error('Update deal error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDeals = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const deals = await Deal.find({ branchId })
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('products.productId', 'name image')
      .sort({ createdAt: -1 });

    res.json({ success: true, deals, count: deals.length });
  } catch (error) {
    console.error('Get deals error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== TABLES ==========

exports.getTables = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const tables = await Table.find({ branchId })
      .populate({
        path: 'currentOrderId',
        select: 'orderNumber total status items',
        populate: { path: 'waiterId', select: 'name' }
      })
      .sort({ tableNumber: 1 });

    res.json({ success: true, tables, count: tables.length });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createTable = async (req, res) => {
  try {
    const { tableNumber, capacity } = req.body;

    const existingTable = await Table.findOne({ branchId: req.user.branchId, tableNumber });
    if (existingTable) {
      return res.status(400).json({ success: false, message: 'Table number already exists' });
    }

    const table = await Table.create({
      tableNumber,
      capacity,
      branchId: req.user.branchId,
      isOccupied: false,
      isActive: true
    });

    res.status(201).json({ success: true, table, message: 'Table created successfully' });
  } catch (error) {
    console.error('Create table error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateTable = async (req, res) => {
  try {
    const table = await Table.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    res.json({ success: true, table, message: 'Table updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteTable = async (req, res) => {
  try {
    const table = await Table.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!table) return res.status(404).json({ success: false, message: 'Table not found' });
    res.json({ success: true, message: 'Table deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getColdDrinks = async (req, res) => {
  try {
    const coldDrinks = await Inventory.find({
      branchId: req.user.branchId,
      category: 'cold_drinks',
      isActive: true
    }).sort({ name: 1 });
    res.json({ success: true, coldDrinks, count: coldDrinks.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createColdDrink = async (req, res) => {
  try {
    const coldDrink = await Inventory.create({
      ...req.body,
      branchId: req.user.branchId,
      category: 'cold_drinks'
    });
    res.status(201).json({ success: true, coldDrink, message: 'Cold drink added to inventory' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;