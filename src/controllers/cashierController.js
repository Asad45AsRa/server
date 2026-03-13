// controllers/cashierController.js  — RELEVANT SECTIONS
// Only the changed/added functions shown — rest of file stays the same

const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Table = require('../models/Table');
const Inventory = require('../models/Inventory');
const Expense = require('../models/Expense'); // ✅ NEW
const { PaymentStatus } = require('../config/constants');

const BRANCH_NAME = 'Al Madina Fast Food Shahkot';

// ========== INVENTORY DEDUCTION HELPER ==========

function getSessionWindow() {
  const now = new Date();
  const hour = now.getHours();

  const sessionStart = new Date(now);
  if (hour < 9) {
    // Before 9 AM: session started yesterday
    sessionStart.setDate(sessionStart.getDate() - 1);
  }
  sessionStart.setHours(9, 0, 0, 0);

  const sessionEnd = new Date(sessionStart);
  sessionEnd.setDate(sessionEnd.getDate() + 1);
  sessionEnd.setHours(4, 0, 0, 0);

  return { sessionStart, sessionEnd };
}

const deductInventoryForOrder = async (order) => {
  try {
    for (const item of order.items) {
      let product = await Product.findById(item.itemId)
        .populate('sizes.ingredients.inventoryItemId');

      if (product) {
        const sizeData = product.sizes.find(
          s => s.size.toLowerCase() === (item.size || 'medium').toLowerCase()
        );
        if (sizeData && sizeData.ingredients && sizeData.ingredients.length > 0) {
          for (const ingredient of sizeData.ingredients) {
            const deductQty = ingredient.quantity * (item.quantity || 1);
            await Inventory.findByIdAndUpdate(
              ingredient.inventoryItemId._id || ingredient.inventoryItemId,
              { $inc: { currentStock: -deductQty } }
            );
          }
        }
      }

      const deal = await Deal.findById(item.itemId).populate({
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
  }
};

exports.deductInventoryForOrder = deductInventoryForOrder;

// ========== ORDERS ==========

exports.getPendingOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const orders = await Order.find({
      branchId,
      status: {
        $in: [
          'pending',
          'accepted',
          'preparing',
          'ready',
          'out_for_delivery',
          'delivered',
          'returned',
        ],
      },
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name')
      // ✅ ADDED: barmanId populate so cashier knows who delivered cold drinks
      .populate('barmanId', 'name')
      .populate('items.itemId')
      .sort({ createdAt: 1 });

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get pending orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ UPDATED: getCompletedOrders now supports last24hours, date range, and date+time range
exports.getCompletedOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const {
      startDate,
      endDate,
      startDateTime,
      endDateTime,
      last24hours,
      mySession,     // ✅ NEW param
    } = req.query;

    let query = { branchId, status: 'completed' };

    // ── ✅ mySession: only this cashier's orders, 9AM–4AM window ────────
    if (mySession === 'true') {
      query.cashierId = req.user._id;
      const { sessionStart, sessionEnd } = getSessionWindow();
      query.completedAt = { $gte: sessionStart, $lte: sessionEnd };

      // ── Existing: precise datetime range ────────────────────────────────
    } else if (startDateTime && endDateTime) {
      query.completedAt = {
        $gte: new Date(startDateTime),
        $lte: new Date(endDateTime),
      };

      // ── Existing: date-only range ────────────────────────────────────────
    } else if (startDate && endDate) {
      query.completedAt = {
        $gte: new Date(startDate),
        $lte: new Date(new Date(endDate).setHours(23, 59, 59)),
      };
    } else if (startDate && !endDate) {
      query.completedAt = { $gte: new Date(startDate) };

      // ── Existing: last 24 hours (default fallback) ───────────────────────
    } else if (last24hours === 'true') {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      query.completedAt = { $gte: since };

      // ── Existing: no params → last 24 hours ─────────────────────────────
    } else {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      query.completedAt = { $gte: since };
    }

    const orders = await Order.find(query)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name')
      .populate('cashierId', 'name')
      .populate('items.itemId')
      .sort({ completedAt: -1 })
      .limit(500);

    // ── Return session window info when in mySession mode ────────────────
    let sessionMeta = null;
    if (mySession === 'true') {
      const { sessionStart, sessionEnd } = getSessionWindow();
      sessionMeta = {
        start: sessionStart.toISOString(),
        end: sessionEnd.toISOString(),
      };
    }

    res.json({
      success: true,
      orders,
      count: orders.length,
      sessionMeta,   // null unless mySession=true
    });
  } catch (error) {
    console.error('Get completed orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ✅ NEW: Get single order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name')
      .populate('cashierId', 'name')
      .populate('items.itemId');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (String(order.branchId) !== String(req.user.branchId)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    res.json({ success: true, order });
  } catch (error) {
    console.error('Get order by ID error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ADVANCE PAYMENT ==========

exports.receiveAdvancePayment = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { amount, method = 'cash', transactionId, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount required' });
    }

    const order = await Order.findById(orderId)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Order already completed hai' });
    }

    const prevAdvance = Number(order.advancePaid || 0);
    const orderTotal = Number(order.total || 0);
    const newAdvance = prevAdvance + Number(amount);
    const cappedAdvance = Math.min(newAdvance, orderTotal);

    order.advancePaid = cappedAdvance;
    order.advancePaymentMethod = method;
    order.paymentStatus = cappedAdvance >= orderTotal ? 'fully_advance' : 'partial_advance';
    await order.save();

    await Payment.create({
      orderId: order._id,
      branchId: req.user.branchId,
      amount: Number(amount),
      method,
      status: 'partial',
      cashierId: req.user._id,
      waiterId: order.waiterId,
      deliveryBoyId: order.deliveryBoyId,
      receivedAmount: Number(amount),
      changeAmount: 0,
      transactionId: transactionId || '',
      notes: notes || 'Advance payment',
      paidAt: new Date(),
    });

    const remaining = orderTotal - cappedAdvance;

    res.json({
      success: true,
      order,
      advancePaid: cappedAdvance,
      remaining,
      isFullyPaid: cappedAdvance >= orderTotal,
      message: cappedAdvance >= orderTotal
        ? `✅ Full advance paid! Order complete hone pe sirf slip print hogi.`
        : `✅ Advance Rs.${Number(amount).toLocaleString()} record. Remaining: Rs.${remaining.toLocaleString()}`,
    });
  } catch (error) {
    console.error('Receive advance payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== COMPLETE ADVANCE-PAID ORDER ==========

exports.completeAdvancePaidOrder = async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await Order.findById(orderId)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const advance = Number(order.advancePaid || 0);
    const total = Number(order.total || 0);

    if (advance < total) {
      return res.status(400).json({
        success: false,
        message: `Order fully paid nahi hai. Remaining: Rs.${(total - advance).toLocaleString()}`,
      });
    }

    const payment = await Payment.create({
      orderId: order._id,
      branchId: req.user.branchId,
      amount: total,
      method: order.advancePaymentMethod || 'cash',
      status: PaymentStatus.PAID,
      cashierId: req.user._id,
      waiterId: order.waiterId,
      deliveryBoyId: order.deliveryBoyId,
      receivedAmount: advance,
      changeAmount: Math.max(0, advance - total),
      notes: 'Advance paid — order completed',
      paidAt: new Date(),
    });

    order.status = 'completed';
    order.completedAt = new Date();
    order.cashierId = req.user._id;
    await order.save();

    if (order.tableNumber) {
      await Table.findOneAndUpdate(
        { branchId: req.user.branchId, tableNumber: order.tableNumber },
        { isOccupied: false, currentOrderId: null }
      );
    }

    const populatedPayment = await Payment.findById(payment._id)
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .populate('orderId');

    res.json({
      success: true,
      payment: populatedPayment,
      order,
      slipData: buildSlipData(order, populatedPayment),
      message: 'Order completed successfully',
    });
  } catch (error) {
    console.error('Complete advance paid order error:', error);
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

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    // ✅ ADDED: Cold drinks validation
    // Agar order mein cold drinks hain aur barman ne deliver nahi ki toh payment rok do
    if (order.hasColdDrinks && order.coldDrinksStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Cold drinks abhi barman ne deliver nahi ki hain. Pehle barman se confirm karein.',
        coldDrinksStatus: order.coldDrinksStatus,
        hasColdDrinks: true,
      });
    }

    const advance = Number(order.advancePaid || 0);
    const orderTotal = Number(order.total || 0);
    const remainingAmount = Math.max(0, orderTotal - advance);
    const finalAmount = amount !== undefined ? Number(amount) : remainingAmount;
    const finalReceived = receivedAmount || order.cashReceived || finalAmount;
    const changeAmount = Math.max(0, Number(finalReceived) - remainingAmount);

    const payment = await Payment.create({
      orderId,
      branchId: req.user.branchId,
      amount: finalAmount,
      method,
      status: PaymentStatus.PAID,
      cashierId: req.user._id,
      waiterId: order.waiterId,
      deliveryBoyId: order.deliveryBoyId,
      receivedAmount: finalReceived,
      changeAmount,
      transactionId,
      notes,
      paidAt: new Date(),
    });

    order.status = 'completed';
    order.completedAt = new Date();
    order.cashierId = req.user._id;
    await order.save();

    if (order.tableNumber) {
      await Table.findOneAndUpdate(
        { branchId: req.user.branchId, tableNumber: order.tableNumber },
        { isOccupied: false, currentOrderId: null }
      );
    }

    const populatedPayment = await Payment.findById(payment._id)
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .populate('orderId');

    res.json({
      success: true,
      payment: populatedPayment,
      order,
      slipData: buildSlipData(order, populatedPayment),
      message: 'Payment received successfully',
    });
  } catch (error) {
    console.error('Receive payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== PAYMENT SLIP ==========

const buildSlipData = (order, payment) => ({
  orderNumber: order.orderNumber,
  orderType: order.orderType,
  tableNumber: order.tableNumber,
  customerName: order.customerName || null,
  customerPhone: order.customerPhone || null,
  deliveryAddress: order.deliveryAddress || null,
  deliveryBoy: payment.deliveryBoyId?.name || null,
  distanceTravelled: order.distanceTravelled || null,
  startMeterReading: order.startMeterReading || null,
  endMeterReading: order.endMeterReading || null,
  items: order.items.map(item => ({
    name: item.itemId?.name || item.name || 'Item',
    size: item.size,
    quantity: item.quantity,
    price: item.price,
    subtotal: item.price * item.quantity,
  })),
  subtotal: order.subtotal || order.total,
  discount: order.discount || 0,
  total: order.total,
  advancePaid: order.advancePaid || 0,
  paymentMethod: payment.method,
  receivedAmount: payment.receivedAmount,
  changeAmount: payment.changeAmount,
  cashier: payment.cashierId?.name || 'Cashier',
  waiter: payment.waiterId?.name || null,
  paidAt: payment.paidAt,
  branchName: BRANCH_NAME,
});

exports.getPaymentSlip = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate({
        path: 'orderId',
        populate: [
          { path: 'items.itemId' },
          { path: 'branchId', select: 'name address phone' },
        ],
      });

    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

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
        $lte: new Date(new Date(endDate).setHours(23, 59, 59)),
      };
    }

    const payments = await Payment.find(query)
      .populate('orderId', 'orderNumber total orderType')
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .sort({ paidAt: -1 })
      .limit(100);

    const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);

    res.json({ success: true, payments, summary: { totalPayments: payments.length, totalAmount } });
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

    const reportDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(reportDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reportDate); endOfDay.setHours(23, 59, 59, 999);

    const payments = await Payment.find({
      branchId,
      paidAt: { $gte: startOfDay, $lte: endOfDay },
      status: 'paid',
    }).populate('orderId', 'orderType orderNumber');

    const hourlyData = {};
    for (let h = 0; h < 24; h++) {
      hourlyData[h] = {
        hour: h,
        label: `${h.toString().padStart(2, '0')}:00 - ${(h + 1).toString().padStart(2, '0')}:00`,
        totalAmount: 0, orderCount: 0, cash: 0, card: 0, online: 0,
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
        : null,
    };

    res.json({ success: true, date: reportDate.toISOString().split('T')[0], hourlyData: hourlyArray, summary });
  } catch (error) {
    console.error('Hourly income report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ✅ NEW: CASHIER SHIFT SLIP REPORT ==========
// Returns all payments + expenses for a given date+time range
// Frontend (Electron) uses this to build the POS-58 cashier slip
exports.getCashierShiftReport = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { startDateTime, endDateTime } = req.query;

    if (!startDateTime || !endDateTime) {
      return res.status(400).json({ success: false, message: 'startDateTime aur endDateTime zaroori hain' });
    }

    const start = new Date(startDateTime);
    const end = new Date(endDateTime);

    // ── Payments in range ──
    const payments = await Payment.find({
      branchId,
      paidAt: { $gte: start, $lte: end },
      status: 'paid',               // ← only fully completed payments
    })
      .populate('cashierId', 'name')
      .populate('orderId', 'orderNumber orderType');

    // ── Expenses in range ──
    const expenses = await Expense.find({
      branchId,
      date: { $gte: start, $lte: end },
    }).populate('addedBy', 'name');

    // ── Revenue summary ──
    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const cashReceived = payments.filter(p => p.method === 'cash').reduce((s, p) => s + p.amount, 0);
    const cardReceived = payments.filter(p => p.method === 'card').reduce((s, p) => s + p.amount, 0);
    const onlineReceived = payments.filter(p => p.method === 'online').reduce((s, p) => s + p.amount, 0);
    const jazzReceived = payments.filter(p => p.method === 'jazz_cash').reduce((s, p) => s + p.amount, 0);
    const easyReceived = payments.filter(p => p.method === 'easypaisa').reduce((s, p) => s + p.amount, 0);

    // ── Expense summary ──
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

    // ✅ NEW: Expense breakdown by payment method
    const expensesByMethod = {};
    expenses.forEach(e => {
      const method = e.paymentMethod || 'cash';
      expensesByMethod[method] = (expensesByMethod[method] || 0) + e.amount;
    });

    const netAmount = totalRevenue - totalExpenses;

    res.json({
      success: true,
      period: { start: start.toISOString(), end: end.toISOString() },
      payments,
      expenses,
      summary: {
        totalOrders: payments.length,
        totalRevenue,
        cashReceived,
        cardReceived,
        onlineReceived,
        jazzReceived,
        easyReceived,
        totalExpenses,
        expensesByMethod,   // ✅ NEW
        netAmount,
      },
    });
  } catch (error) {
    console.error('Cashier shift report error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ORDER STATUS UPDATE ==========

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id).populate('items.itemId');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const previousStatus = order.status;
    order.status = status;

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
    const productData = { ...req.body, branchId: req.user.branchId, createdBy: req.user._id };
    const product = await Product.create(productData);
    const populatedProduct = await Product.findById(product._id)
      .populate('branchId', 'name')
      .populate('createdBy', 'name')
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit');
    res.status(201).json({ success: true, product: populatedProduct, message: 'Product created successfully' });
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
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
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
    const { products, ...rest } = req.body;
    const cleanedProducts = (products || []).map(item => {
      const cleaned = { itemType: item.itemType || 'product', size: item.size, quantity: parseInt(item.quantity) || 1 };
      if (item.itemType === 'cold_drink') { if (item.coldDrinkId) cleaned.coldDrinkId = item.coldDrinkId; }
      else { if (item.productId) cleaned.productId = item.productId; }
      return cleaned;
    });
    const deal = await Deal.create({ ...rest, products: cleanedProducts, branchId: req.user.branchId, createdBy: req.user._id });
    const populatedDeal = await Deal.findById(deal._id)
      .populate('branchId', 'name').populate('createdBy', 'name').populate('products.productId', 'name image');
    res.status(201).json({ success: true, deal: populatedDeal, message: 'Deal created successfully' });
  } catch (error) {
    console.error('Create deal error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDeal = async (req, res) => {
  try {
    const { products, ...rest } = req.body;
    const cleanedProducts = (products || []).map(item => {
      const cleaned = { itemType: item.itemType || 'product', size: item.size, quantity: parseInt(item.quantity) || 1 };
      if (item.itemType === 'cold_drink') { if (item.coldDrinkId) cleaned.coldDrinkId = item.coldDrinkId; }
      else { if (item.productId) cleaned.productId = item.productId; }
      return cleaned;
    });
    const deal = await Deal.findByIdAndUpdate(req.params.id, { ...rest, products: cleanedProducts }, { new: true })
      .populate('branchId', 'name').populate('createdBy', 'name').populate('products.productId', 'name image');
    if (!deal) return res.status(404).json({ success: false, message: 'Deal not found' });
    res.json({ success: true, deal, message: 'Deal updated successfully' });
  } catch (error) {
    console.error('Update deal error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getDeals = async (req, res) => {
  try {
    const deals = await Deal.find({ branchId: req.user.branchId })
      .populate('branchId', 'name').populate('createdBy', 'name').populate('products.productId', 'name image')
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
    const tables = await Table.find({ branchId: req.user.branchId })
      .populate({ path: 'currentOrderId', select: 'orderNumber total status items', populate: { path: 'waiterId', select: 'name' } })
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
    if (existingTable) return res.status(400).json({ success: false, message: 'Table number already exists' });
    const table = await Table.create({ tableNumber, capacity, branchId: req.user.branchId, isOccupied: false, isActive: true });
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

exports.seedTables = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const floors = ['ground_floor', 'first_floor', 'second_floor', 'outdoor'];
    const TABLES_PER_FLOOR = 30;
    let created = 0, skipped = 0;

    for (const floor of floors) {
      for (let tableNum = 1; tableNum <= TABLES_PER_FLOOR; tableNum++) {
        const existing = await Table.findOne({ branchId, tableNumber: tableNum, floor });
        if (!existing) { await Table.create({ tableNumber: tableNum, capacity: 4, floor, branchId, isActive: true, isOccupied: false }); created++; }
        else { skipped++; }
      }
    }

    res.json({ success: true, message: `Tables seeded! Created: ${created}, Already existed: ${skipped}`, total: floors.length * TABLES_PER_FLOOR, created, skipped });
  } catch (error) {
    console.error('Seed tables error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getColdDrinks = async (req, res) => {
  try {
    const coldDrinks = await Inventory.find({ branchId: req.user.branchId, category: 'cold_drinks', isActive: true }).sort({ name: 1 });
    res.json({ success: true, coldDrinks, count: coldDrinks.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const {
      orderType, tableNumber, floor, customerName, customerPhone,
      deliveryAddress, cashierNote, notes, discount = 0, items = [],
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Items required' });
    }

    const branchId = req.user.branchId;
    let subtotal = 0;
    const processedItems = [];

    for (const item of items) {
      const itemSubtotal = item.subtotal != null
        ? Number(item.subtotal)
        : Number(item.price || 0) * Number(item.quantity || 1);

      subtotal += itemSubtotal;

      processedItems.push({
        itemId: item.itemId,
        itemType: item.itemType || 'Product',
        type: item.type || 'product',
        name: item.name || 'Item',
        size: item.size || null,
        quantity: Number(item.quantity) || 1,
        price: Number(item.price) || 0,
        subtotal: itemSubtotal,
        preparationTime: item.preparationTime || 0,
        isColdDrink: item.isColdDrink || false,
        coldDrinkId: item.coldDrinkId || null,
        coldDrinkSizeId: item.coldDrinkSizeId || null,
      });
    }

    const discountAmt = Math.min(Number(discount) || 0, subtotal);
    const total = subtotal - discountAmt;

    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const count = await Order.countDocuments({
      branchId,
      createdAt: { $gte: new Date(today.setHours(0, 0, 0, 0)) },
    });
    const orderNumber = `ORD-${dateStr}-${String(count + 1).padStart(4, '0')}`;

    // ✅ ADDED: Detect cold drinks in order
    const hasColdDrinksInOrder = processedItems.some(
      item => item.isColdDrink || item.type === 'cold_drink'
    );

    const order = await Order.create({
      orderNumber,
      branchId,
      orderType: orderType || 'dine_in',
      tableNumber: tableNumber || null,
      floor: floor || null,
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      deliveryAddress: deliveryAddress || null,
      cashierNote: cashierNote || '',
      notes: notes || '',
      items: processedItems,
      subtotal,
      discount: discountAmt,
      total,
      tax: 0,
      status: 'pending',
      cashierId: req.user._id,
      // ✅ ADDED: Cold drinks flags
      hasColdDrinks: hasColdDrinksInOrder,
      coldDrinksStatus: hasColdDrinksInOrder ? 'pending' : 'delivered',
    });

    if (orderType === 'dine_in' && tableNumber && floor) {
      await Table.findOneAndUpdate(
        { branchId, tableNumber, floor },
        { isOccupied: true, currentOrderId: order._id }
      );
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('cashierId', 'name')
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId');

    const io = req.app.get('io');
    if (io) {
      // ✅ Existing: chef ke liye new-order event
      io.to(String(branchId)).emit('new-order', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        tableNumber: order.tableNumber,
        floor: order.floor,
        total: order.total,
        itemCount: processedItems.length,
      });

      // ✅ ADDED: Agar cold drinks hain toh barman ko bhi notify karo
      if (hasColdDrinksInOrder) {
        io.to(String(branchId)).emit('new-colddrink-order', {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          orderType: order.orderType,
          tableNumber: order.tableNumber || null,
          floor: order.floor || null,
          total: order.total,
          coldDrinkItems: processedItems
            .filter(i => i.isColdDrink || i.type === 'cold_drink')
            .map(i => ({
              name: i.name,
              size: i.size,
              quantity: i.quantity,
            })),
          message: `🧃 New cold drink order #${order.orderNumber}`,
        });
      }
    }

    res.status(201).json({
      success: true,
      order: populatedOrder,
      message: `Order #${orderNumber} created successfully`,
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAmountSummary = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { sessionStart, sessionEnd } = getSessionWindow();

    const payments = await Payment.find({
      branchId,
      paidAt: { $gte: sessionStart, $lte: sessionEnd },
      status: 'paid',
    })
      .populate('orderId', 'orderNumber orderType')
      .sort({ paidAt: -1 });

    // Breakdown by method
    const breakdown = {};
    for (const m of ['cash', 'card', 'online', 'jazz_cash', 'easypaisa']) {
      breakdown[`${m}Total`] = payments
        .filter(p => p.method === m)
        .reduce((s, p) => s + p.amount, 0);
    }

    const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
    const totalTransactions = payments.length;
    const recentPayments = payments.slice(0, 10);

    res.json({
      success: true,
      period: {
        start: sessionStart.toISOString(),
        end: sessionEnd.toISOString(),
      },
      summary: {
        totalRevenue,
        totalTransactions,
        ...breakdown,
      },
      recentPayments,
    });
  } catch (error) {
    console.error('Amount summary error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addMissedOrderPayment = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { orderId, orderNumber, amount, method, notes } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId zaroori hai' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount zaroori hai' });
    }

    // Verify the order belongs to this branch
    const order = await Order.findOne({ _id: orderId, branchId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order nahi mila ya unauthorized' });
    }

    const payment = await Payment.create({
      orderId,
      branchId,
      amount: Number(amount),
      method: method || 'cash',
      status: 'paid',
      cashierId: req.user._id,
      receivedAmount: Number(amount),
      changeAmount: 0,
      notes: notes || `Missed payment manually added for ${orderNumber || order.orderNumber}`,
      paidAt: new Date(),
    });

    const populated = await Payment.findById(payment._id)
      .populate('cashierId', 'name')
      .populate('orderId', 'orderNumber total orderType');

    res.json({
      success: true,
      payment: populated,
      message: `✅ Missed payment Rs.${Number(amount).toLocaleString()} added for ${order.orderNumber}`,
    });
  } catch (error) {
    console.error('Add missed payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addManualPayment = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { description, amount, method, receivedFrom, transactionId, notes } = req.body;

    if (!description?.trim()) {
      return res.status(400).json({ success: false, message: 'Description zaroori hai' });
    }
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount zaroori hai' });
    }

    const payment = await Payment.create({
      // orderId intentionally omitted (make it optional in schema)
      branchId,
      amount: Number(amount),
      method: method || 'cash',
      status: 'paid',
      cashierId: req.user._id,
      receivedAmount: Number(amount),
      changeAmount: 0,
      transactionId: transactionId || '',
      notes: [
        description,
        receivedFrom ? `From: ${receivedFrom}` : '',
        notes || '',
      ].filter(Boolean).join(' | '),
      isManual: true,   // flag for UI distinction
      paidAt: new Date(),
    });

    const populated = await Payment.findById(payment._id)
      .populate('cashierId', 'name');

    res.json({
      success: true,
      payment: populated,
      message: `✅ Manual payment Rs.${Number(amount).toLocaleString()} add ho gayi`,
    });
  } catch (error) {
    console.error('Manual payment error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;