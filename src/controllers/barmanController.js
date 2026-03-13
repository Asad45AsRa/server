const Order    = require('../models/Order');
const ColdDrink = require('../models/Colddrink');
 
// ── HELPER: item cold drink hai? ─────────────────────────────────────────────
const isColdDrinkItem = (item) =>
  item.isColdDrink === true || item.type === 'cold_drink';
 
// ── HELPER: order mein food (non-cold-drink) items hain? ─────────────────────
const orderHasFoodItems = (order) =>
  (order.items || []).some(item => !isColdDrinkItem(item));
 
// ══════════════════════════════════════════════════════════════════════════════
//  GET PENDING COLD DRINK ORDERS
//  Barman ke liye — hasColdDrinks=true, coldDrinksStatus=pending
// ══════════════════════════════════════════════════════════════════════════════
exports.getPendingOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
 
    const orders = await Order.find({
      branchId,
      hasColdDrinks: true,
      coldDrinksStatus: 'pending',
      status: { $nin: ['completed', 'cancelled'] },
    })
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name')
      .populate('cashierId',     'name')
      .populate('items.itemId')
      .sort({ createdAt: 1 })
      .lean();
 
    // Sirf cold drink items filter karke bhejna optional hai —
    // frontend sab items dekh sake taake context rahe
    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Barman getPendingOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
// ══════════════════════════════════════════════════════════════════════════════
//  GET MY ACTIVE ORDERS
//  Barman ne jo orders accept ki hain aur abhi deliver nahi ki
// ══════════════════════════════════════════════════════════════════════════════
exports.getMyOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
 
    const orders = await Order.find({
      branchId,
      barmanId: req.user._id,
      coldDrinksStatus: 'pending',
      status: { $nin: ['completed', 'cancelled'] },
    })
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId')
      .sort({ createdAt: 1 })
      .lean();
 
    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Barman getMyOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
// ══════════════════════════════════════════════════════════════════════════════
//  DELIVER COLD DRINKS  ← MAIN ACTION
//  1. ColdDrink stock se deduct karo
//  2. Order mein coldDrinksStatus = 'delivered' set karo
//  3. Agar sirf cold drinks wali order hai → status = 'delivered' (cashier complete kar sake)
//  4. Socket event emit karo → waiter/delivery ko tick dikhaye har cold drink item pe
// ══════════════════════════════════════════════════════════════════════════════
exports.deliverColdDrinks = async (req, res) => {
  try {
    const { orderId } = req.body;
 
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId zaroori hai' });
    }
 
    const order = await Order.findById(orderId).populate('items.itemId');
 
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order nahi mili' });
    }
 
    if (String(order.branchId) !== String(req.user.branchId)) {
      return res.status(403).json({ success: false, message: 'Yeh aapki branch ki order nahi' });
    }
 
    if (!order.hasColdDrinks) {
      return res.status(400).json({ success: false, message: 'Is order mein cold drinks nahi hain' });
    }
 
    if (order.coldDrinksStatus === 'delivered') {
      return res.status(400).json({ success: false, message: 'Cold drinks pehle hi deliver ho chuki hain' });
    }
 
    if (['completed', 'cancelled'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Order already ${order.status} hai`,
      });
    }
 
    // ── 1. Cold drink stock deduct karo ──────────────────────────────────────
    const deliveredColdDrinkItems = []; // Socket event ke liye
 
    for (const item of order.items) {
      if (!isColdDrinkItem(item)) continue;
 
      deliveredColdDrinkItems.push({
        name:     item.name     || 'Cold Drink',
        size:     item.size     || null,
        quantity: item.quantity || 1,
      });
 
      if (item.coldDrinkId && item.coldDrinkSizeId) {
        try {
          const drink = await ColdDrink.findById(item.coldDrinkId);
          if (drink) {
            const variant = drink.sizes.id(item.coldDrinkSizeId);
            if (variant) {
              variant.currentStock = Math.max(0, variant.currentStock - (item.quantity || 1));
              await drink.save();
              console.log(
                `[Barman] Stock deducted: ${drink.name} ${variant.size} -${item.quantity || 1}`
              );
            }
          }
        } catch (e) {
          console.error('[Barman] Cold drink stock deduction error (non-fatal):', e.message);
        }
      }
    }
 
    // ── 2. Order update karo ─────────────────────────────────────────────────
    order.coldDrinksStatus     = 'delivered';
    order.barmanId             = req.user._id;
    order.coldDrinksDeliveredAt = new Date();
 
    // ── 3. Cold-drink-only order? → status = 'delivered' so cashier can pay ─
    const foodExists = orderHasFoodItems(order);
    if (!foodExists) {
      order.status      = 'delivered';
      order.deliveredAt = new Date();
    }
 
    await order.save();
 
    // ── 4. Socket emit → waiter, delivery, cashier ko notify karo ──────────
    const io = req.app.get('io');
    if (io) {
      io.to(`branch-${String(order.branchId)}`).emit('cold-drinks-delivered', {
        orderId:               String(order._id),
        orderNumber:           order.orderNumber,
        orderType:             order.orderType,
        tableNumber:           order.tableNumber  || null,
        floor:                 order.floor        || null,
        barmanId:              String(req.user._id),
        barmanName:            req.user.name      || 'Barman',
        coldDrinksDeliveredAt: order.coldDrinksDeliveredAt,
        newOrderStatus:        order.status,
        // Frontend yeh list use kare har cold drink item pe tick dikhane ke liye
        coldDrinkItems:        deliveredColdDrinkItems,
        message: `🧃 Cold drinks delivered for #${order.orderNumber} by ${req.user.name}`,
      });
    }
 
    const populated = await Order.findById(order._id)
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name')
      .populate('barmanId',      'name')
      .populate('items.itemId');
 
    res.json({
      success: true,
      order:   populated,
      message: `✅ Cold drinks deliver ho gayi order #${order.orderNumber} ke liye`,
    });
  } catch (error) {
    console.error('deliverColdDrinks error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
// ══════════════════════════════════════════════════════════════════════════════
//  GET COMPLETED ORDERS (history)
// ══════════════════════════════════════════════════════════════════════════════
exports.getCompletedOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const page     = parseInt(req.query.page)  || 1;
    const limit    = parseInt(req.query.limit) || 30;
    const skip     = (page - 1) * limit;
 
    const query = {
      branchId,
      barmanId:          req.user._id,
      coldDrinksStatus:  'delivered',
    };
 
    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('waiterId',      'name')
        .populate('deliveryBoyId', 'name')
        .populate('barmanId',      'name')
        .sort({ coldDrinksDeliveredAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
    ]);
 
    res.json({
      success: true,
      orders,
      count: orders.length,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('Barman getCompletedOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
// ══════════════════════════════════════════════════════════════════════════════
//  GET COLD DRINKS STOCK
//  Barman apni branch ke cold drinks ka stock dekhe
// ══════════════════════════════════════════════════════════════════════════════
exports.getColdDrinksStock = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const now      = new Date();
 
    const drinks = await ColdDrink.find({ branchId, isActive: true })
      .sort({ company: 1, name: 1 });
 
    const result = drinks.map(d => ({
      _id:        d._id,
      name:       d.name,
      company:    d.company,
      totalStock: d.sizes.reduce((s, v) => s + v.currentStock, 0),
      sizes:      d.sizes.map(s => ({
        _id:          s._id,
        size:         s.size,
        currentStock: s.currentStock,
        minimumStock: s.minimumStock || 0,
        salePrice:    s.salePrice,
        purchasePrice:s.purchasePrice,
        expiryDate:   s.expiryDate || null,
        isLow:        s.currentStock > 0 && s.currentStock <= (s.minimumStock || 0),
        isOut:        s.currentStock === 0,
        isExpired:    s.expiryDate ? new Date(s.expiryDate) <= now : false,
      })),
    }));
 
    const lowStockCount = result.reduce(
      (n, d) => n + d.sizes.filter(s => s.isLow).length, 0
    );
    const outOfStockCount = result.reduce(
      (n, d) => n + d.sizes.filter(s => s.isOut).length, 0
    );
 
    res.json({
      success: true,
      coldDrinks: result,
      count:      result.length,
      summary:    { lowStockCount, outOfStockCount },
    });
  } catch (error) {
    console.error('Barman getColdDrinksStock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
// ══════════════════════════════════════════════════════════════════════════════
//  GET SINGLE ORDER
// ══════════════════════════════════════════════════════════════════════════════
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name')
      .populate('barmanId',      'name')
      .populate('cashierId',     'name')
      .populate('items.itemId');
 
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order nahi mili' });
    }
 
    if (String(order.branchId) !== String(req.user.branchId)) {
      return res.status(403).json({ success: false, message: 'Yeh aapki branch ki order nahi' });
    }
 
    res.json({ success: true, order });
  } catch (error) {
    console.error('Barman getOrderById error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
 
module.exports = exports;