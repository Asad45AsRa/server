const Order = require('../models/Order');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Inventory = require('../models/Inventory');
const ColdDrink = require('../models/Colddrink');
const { generateOrderNumber, calculateTotalTime, calculateOrderTotal } = require('../utils/helpers');

// ─── Helper ───────────────────────────────────────────────────────────────────
const resolveItemType = (item) => {
  if (item.itemType) return item.itemType;
  if (item.type === 'cold_drink') return 'Inventory';
  if (item.type === 'deal') return 'Deal';
  return 'Product';
};

// ========== MENU ==========

exports.getMenu = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const now = new Date();
 
    const products = await Product.find({ branchId, isAvailable: true })
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit')
      .lean();
 
    // ✅ FIX: Waiter jaise sirf isActive check — koi date filter nahi
    const rawDeals = await Deal.find({ branchId, isActive: true })
      .populate('products.productId', 'name image')
      .lean();
 
    const deals = rawDeals.map(d => ({ ...d, price: d.discountedPrice }));
 
    const rawColdDrinks = await ColdDrink.find({ branchId, isActive: true }).lean();
 
    const coldDrinks = rawColdDrinks
      .map(d => ({
        _id: d._id,
        name: d.name,
        company: d.company,
        description: d.company,
        category: 'cold_drinks',
        sizes: d.sizes
          .filter(s => s.currentStock > 0 && (!s.expiryDate || new Date(s.expiryDate) > now))
          .map(s => ({
            _id: s._id,
            size: s.size,
            price: s.salePrice,
            currentStock: s.currentStock,
          })),
      }))
      .filter(d => d.sizes.length > 0);
 
    res.json({
      success: true,
      menu: { products, deals, coldDrinks },
      counts: { products: products.length, deals: deals.length, coldDrinks: coldDrinks.length },
    });
  } catch (error) {
    console.error('Get delivery menu error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREATE DELIVERY ORDER ==========

exports.createDeliveryOrder = async (req, res) => {
  try {
    const {
      items, customerName, customerPhone,
      deliveryAddress, notes,
      orderType = 'delivery',
    } = req.body;

    if (!customerName || !customerPhone) {
      return res.status(400).json({ success: false, message: 'Customer name aur phone zaroori hain' });
    }
    if (orderType === 'delivery' && !deliveryAddress) {
      return res.status(400).json({ success: false, message: 'Delivery address zaroori hai' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Kam se kam ek item hona chahiye' });
    }

    const resolveItemType = (item) => {
      if (item.itemType) return item.itemType;
      if (item.type === 'cold_drink') return 'Inventory';
      if (item.type === 'deal') return 'Deal';
      return 'Product';
    };

    const processedItems = items.map(item => ({
      ...item,
      itemType: resolveItemType(item),
    }));

    // Stock check for cold drinks
    for (const item of processedItems) {
      if (item.type === 'cold_drink') {
        try {
          const coldDrink = await ColdDrink.findOne({ 'sizes._id': item.itemId });
          if (coldDrink) {
            const sizeVariant = coldDrink.sizes.id(item.itemId);
            if (sizeVariant && sizeVariant.currentStock < item.quantity) {
              return res.status(400).json({
                success: false,
                message: `Insufficient stock: ${coldDrink.name} (${sizeVariant.size})`,
              });
            }
          }
        } catch { }
      }
    }

    const { subtotal, tax, total } = calculateOrderTotal(processedItems, 0, 0);
    const estimatedTime = calculateTotalTime(processedItems) + (orderType === 'takeaway' ? 10 : 20);

    // ✅ ADDED: Detect cold drinks
    const hasColdDrinksInOrder = processedItems.some(
      item => item.isColdDrink || item.type === 'cold_drink'
    );

    let cashierNote = '';
    if (orderType === 'takeaway') {
      cashierNote = `🥡 Takeaway — ${customerName} | ${customerPhone}`;
    } else {
      cashierNote = `🚚 Delivery — ${customerName} | ${customerPhone}`;
    }

    const orderData = {
      orderNumber: generateOrderNumber(),
      branchId: req.user.branchId,
      orderType,
      items: processedItems,
      subtotal, tax, total, estimatedTime,
      deliveryBoyId: req.user._id,
      customerName, customerPhone,
      notes,
      cashierNote,
      status: 'pending',
      // ✅ ADDED: Cold drinks flags
      hasColdDrinks: hasColdDrinksInOrder,
      coldDrinksStatus: hasColdDrinksInOrder ? 'pending' : 'delivered',
    };

    if (orderType === 'delivery' && deliveryAddress) {
      orderData.deliveryAddress = deliveryAddress;
    }

    const order = await Order.create(orderData);

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId', 'name');

    // ✅ ADDED: Barman ko notify karo agar cold drinks hain
    const io = req.app.get('io');
    if (io && hasColdDrinksInOrder) {
      io.to(`branch-${String(req.user.branchId)}`).emit('new-colddrink-order', {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        total: order.total,
        customerName,
        coldDrinkItems: processedItems
          .filter(i => i.isColdDrink || i.type === 'cold_drink')
          .map(i => ({
            name: i.name,
            size: i.size || null,
            quantity: i.quantity,
          })),
        message: `🧃 New cold drink order #${order.orderNumber}`,
      });
    }

    res.status(201).json({
      success: true,
      order: populatedOrder,
      message: orderType === 'takeaway'
        ? '🥡 Takeaway order kitchen mein bhej diya!'
        : '🚚 Delivery order create ho gaya!',
    });
  } catch (error) {
    console.error('Create delivery order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MY ORDERS ==========

exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      deliveryBoyId: req.user._id,
      status: { $nin: ['completed', 'cancelled'] },
    })
      .populate('chefId', 'name')
      .populate('items.itemId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get my orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== GET UNASSIGNED ORDERS ==========

exports.getUnassignedOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const orders = await Order.find({
      branchId,
      orderType: 'delivery',
      status: 'ready',
      deliveryBoyId: null,
    })
      .populate('waiterId', 'name')
      .populate('items.itemId', 'name')
      .sort({ readyAt: 1 })
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get unassigned orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CLAIM ORDER ==========

exports.claimOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });

    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        orderType: 'delivery',
        status: 'ready',
        deliveryBoyId: null,
        branchId: req.user.branchId,
      },
      { $set: { deliveryBoyId: req.user._id } },
      { new: true }
    )
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId', 'name');

    if (!order) {
      return res.status(409).json({
        success: false,
        message: 'Yeh order pehle hi kisi aur ne claim kar li ya available nahi hai',
      });
    }

    const io = req.app.get('io');
    if (io) {
      io.to(`branch-${req.user.branchId}`).emit('order-claimed', {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        claimedBy: req.user.name || 'Delivery Boy',
        claimedById: String(req.user._id),
      });
    }

    res.json({ success: true, order, message: `Order ${order.orderNumber} aapne claim kar li!` });
  } catch (error) {
    console.error('Claim order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status, departureMeterReading } = req.body;
 
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
 
    if (String(order.deliveryBoyId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
 
    if (order.orderType === 'takeaway' && status === 'out_for_delivery') {
      return res.status(400).json({
        success: false,
        message: 'Takeaway orders ke liye /mark-delivered route use karein',
      });
    }
 
    order.status = status;
 
    if (status === 'out_for_delivery') {
      order.departedAt = new Date();
      // ── NEW: save departure meter reading ──
      if (departureMeterReading != null && !isNaN(departureMeterReading)) {
        order.departureMeterReading = parseFloat(departureMeterReading);
      }
    }
    if (status === 'delivered') order.deliveredAt = new Date();
 
    await order.save();
 
    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');
 
    res.json({ success: true, order: populatedOrder, message: `Status updated to ${status}` });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


exports.completeDelivery = async (req, res) => {
  try {
    const { orderId, cashReceived, returnMeterReading } = req.body;
 
    if (!orderId || cashReceived === undefined || cashReceived === null) {
      return res.status(400).json({
        success: false,
        message: 'orderId and cashReceived are required',
      });
    }
 
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
 
    if (String(order.deliveryBoyId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
 
    if (order.status !== 'out_for_delivery') {
      return res.status(400).json({
        success: false,
        message: 'Order must be out_for_delivery to mark as returned',
      });
    }
 
    order.status       = 'returned';
    order.cashReceived = parseFloat(cashReceived);
    order.returnedAt   = new Date();
 
    // ── NEW: save return reading and calculate distance ──
    if (returnMeterReading != null && !isNaN(returnMeterReading)) {
      order.returnMeterReading = parseFloat(returnMeterReading);
      if (order.departureMeterReading && order.returnMeterReading > order.departureMeterReading) {
        order.distanceTravelled = parseFloat(
          (order.returnMeterReading - order.departureMeterReading).toFixed(1)
        );
      }
    }
 
    await order.save();
 
    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');
 
    res.json({
      success: true,
      order: populatedOrder,
      summary: {
        cashReceived:       order.cashReceived,
        orderTotal:         order.total,
        change:             parseFloat(cashReceived) - order.total,
        distanceTravelled:  order.distanceTravelled || null,
      },
      message: '🏠 Wapas aa gaye! Cashier se payment verify karwaein — woh order complete karega.',
    });
  } catch (error) {
    console.error('Complete delivery error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.requestPrint = async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // ✅ Verify delivery boy owns this order
    if (String(order.deliveryBoyId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    // Set printRequested flag — Cashier Desktop polls/listens for this
    order.printRequested = true;
    order.printRequestedAt = new Date();
    await order.save();

    // Emit socket event so Cashier Desktop prints immediately if online
    const io = req.app.get('io');
    if (io) {
      io.to(`branch-${req.user.branchId}`).emit('print-request', {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        orderType: 'delivery',
        requestedBy: req.user.name || 'Delivery Boy',
      });
    }

    res.json({
      success: true,
      message: `Print request sent for order #${order.orderNumber}`,
    });
  } catch (error) {
    console.error('Request print error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE ORDER (edit pending orders only) ==========

exports.updateOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { items, customerName, customerPhone, deliveryAddress, notes } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (String(order.deliveryBoyId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update order after chef acceptance',
      });
    }

    if (items) {
      if (items.length === 0) {
        return res.status(400).json({ success: false, message: 'Order must have at least one item' });
      }
      const processedItems = items.map(item => ({ ...item, itemType: resolveItemType(item) }));
      const { subtotal, tax, total } = calculateOrderTotal(processedItems, order.discount, 0);
      order.items = processedItems;
      order.subtotal = subtotal;
      order.tax = tax;
      order.total = total;
      order.estimatedTime = calculateTotalTime(processedItems) + 20;
    }

    if (customerName) order.customerName = customerName;
    if (customerPhone) order.customerPhone = customerPhone;
    if (deliveryAddress) order.deliveryAddress = deliveryAddress;
    if (notes !== undefined) order.notes = notes;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');

    res.json({ success: true, order: populatedOrder, message: 'Order updated successfully' });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DELIVERY HISTORY ==========

exports.getDeliveryHistory = async (req, res) => {
  try {
    const orders = await Order.find({
      deliveryBoyId: req.user._id,
      status: { $in: ['completed', 'returned', 'delivered', 'cancelled'] },
    })
      .populate('items.itemId', 'name')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get delivery history error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.markDeliveredTakeaway = async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await Order.findById(orderId); createDeliveryOrder
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Only delivery boy jo is order ka owner hai
    if (String(order.deliveryBoyId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: 'Yeh aapki order nahi hai' });
    }

    // Sirf takeaway orders
    if (order.orderType !== 'takeaway') {
      return res.status(400).json({
        success: false,
        message: 'Yeh function sirf takeaway orders ke liye hai',
      });
    }

    // Sirf ready orders deliver ho sakti hain
    if (order.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: `Order sirf ready hone ke baad deliver ho sakti hai. Current status: ${order.status}`,
      });
    }

    order.status = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    // Notify cashier via socket
    const io = req.app.get('io');
    if (io) {
      io.to(`branch-${req.user.branchId}`).emit('order-updated', {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        newStatus: 'delivered',
        orderType: 'takeaway',
        message: `🥡 Takeaway #${order.orderNumber} — Customer ko de diya. Payment pending.`,
      });
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');

    res.json({
      success: true,
      order: populatedOrder,
      message: `✅ Order #${order.orderNumber} delivered! Cashier payment receive karega.`,
    });
  } catch (error) {
    console.error('markDeliveredTakeaway error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.extractMeterReading = async (req, res) => {
  try {
    const { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ success: false, reading: null, message: 'base64Image required' });
    }
 
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // No API key → tell frontend to use manual mode
      return res.json({ success: false, reading: null, message: 'OCR not configured — enter manually' });
    }
 
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 50,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: base64Image },
            },
            {
              type: 'text',
              text: 'This is a bike odometer/speedometer. Extract ONLY the total kilometers reading (odometer value) as a plain number. Return ONLY the number, nothing else. Example: 12345',
            },
          ],
        }],
      }),
    });
 
    if (!response.ok) {
      const err = await response.text();
      return res.json({ success: false, reading: null, message: `OCR API error: ${response.status}` });
    }
 
    const data = await response.json();
    const rawText = data.content?.[0]?.text?.trim() || '';
    // Extract numeric value — remove commas, spaces, units
    const numeric = parseFloat(rawText.replace(/[^0-9.]/g, ''));
 
    if (isNaN(numeric) || numeric <= 0) {
      return res.json({ success: false, reading: null, message: 'Could not extract reading — enter manually' });
    }
 
    res.json({ success: true, reading: numeric });
  } catch (error) {
    console.error('Extract meter reading error:', error);
    res.json({ success: false, reading: null, message: error.message });
  }
};

exports.getDeliveryBoyStats = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const now      = new Date();
 
    // ── Shift window: 9:00 AM → 4:00 AM next day ──
    // Determine shift start: if current hour < 9, shift started yesterday
    let shiftStart = new Date(now);
    shiftStart.setHours(9, 0, 0, 0);
 
    if (now.getHours() < 9) {
      // Between midnight and 9 AM → shift started yesterday at 9 AM
      shiftStart.setDate(shiftStart.getDate() - 1);
    }
 
    const shiftEnd = new Date(shiftStart);
    shiftEnd.setDate(shiftEnd.getDate() + 1);
    shiftEnd.setHours(4, 0, 0, 0); // 4 AM next day
 
    // ── Only DELIVERY orders (not takeaway), within this shift ──
    const orders = await Order.find({
      branchId,
      orderType: { $in: ['delivery', null, undefined] }, // exclude takeaway
      $or: [{ orderType: 'delivery' }, { orderType: { $exists: false } }],
      createdAt: { $gte: shiftStart, $lte: shiftEnd },
      deliveryBoyId: { $ne: null },
    })
      .populate('deliveryBoyId', 'name phone')
      .lean();
 
    // ── Group stats by delivery boy ──
    const statsMap = {};
    for (const order of orders) {
      if (!order.deliveryBoyId) continue;
      // Extra guard: skip takeaway
      if (order.orderType === 'takeaway') continue;
 
      const dbId = String(order.deliveryBoyId._id || order.deliveryBoyId);
      if (!statsMap[dbId]) {
        statsMap[dbId] = {
          deliveryBoy:      order.deliveryBoyId,
          totalOrders:      0,
          completedOrders:  0,
          activeOrders:     0,
          totalKm:          0,
          totalCashCollected: 0,
          ordersList:       [],
        };
      }
 
      statsMap[dbId].totalOrders++;
 
      if (['completed', 'returned'].includes(order.status)) {
        statsMap[dbId].completedOrders++;
        statsMap[dbId].totalCashCollected += order.cashReceived || order.total || 0;
      } else if (!['cancelled'].includes(order.status)) {
        statsMap[dbId].activeOrders++;
      }
 
      if (order.distanceTravelled) {
        statsMap[dbId].totalKm = parseFloat(
          (statsMap[dbId].totalKm + order.distanceTravelled).toFixed(1)
        );
      }
 
      statsMap[dbId].ordersList.push({
        orderNumber:        order.orderNumber,
        status:             order.status,
        total:              order.total,
        cashReceived:       order.cashReceived,
        distanceTravelled:  order.distanceTravelled,
        customerName:       order.customerName,
        departureMeterReading: order.departureMeterReading,
        returnMeterReading:    order.returnMeterReading,
        createdAt:          order.createdAt,
      });
    }
 
    const stats = Object.values(statsMap).sort(
      (a, b) => b.completedOrders - a.completedOrders
    );
 
    res.json({
      success: true,
      shiftStart,
      shiftEnd,
      shiftLabel: `${shiftStart.toLocaleDateString('en-PK')} 9:00 AM — ${shiftEnd.toLocaleDateString('en-PK')} 4:00 AM`,
      stats,
      summary: {
        totalDeliveryOrders: orders.filter(o => o.orderType !== 'takeaway').length,
        totalDeliveryBoys:   stats.length,
        totalKmAll:          stats.reduce((s, d) => s + d.totalKm, 0).toFixed(1),
      },
    });
  } catch (error) {
    console.error('Get delivery boy stats error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;