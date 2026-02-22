const Order = require('../models/Order');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Inventory = require('../models/Inventory');
const ColdDrink = require('../models/Colddrink'); // ✅ Use same ColdDrink model as waiter
const { generateOrderNumber, calculateTotalTime, calculateOrderTotal } = require('../utils/helpers');

// ─── Helper: map type string → itemType for Order schema ─────────────────────
const resolveItemType = (item) => {
  if (item.itemType) return item.itemType; // already set on frontend
  if (item.type === 'cold_drink') return 'Inventory';
  if (item.type === 'deal') return 'Deal';
  return 'Product';
};

// ========== MENU ==========

exports.getMenu = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const products = await Product.find({ branchId, isAvailable: true })
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit')
      .lean();

    const rawDeals = await Deal.find({
      branchId,
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() }
    })
      .populate('products.productId', 'name image')
      .lean();

    // ✅ FIX: price field add karo takey frontend deal.price se access kar sake
    const deals = rawDeals.map(d => ({
      ...d,
      price: d.discountedPrice,
    }));

    // ✅ Use ColdDrink model (same as waiter) — not raw Inventory
    const now = new Date();
    let coldDrinks = [];
    try {
      const rawColdDrinks = await ColdDrink.find({ branchId, isActive: true }).lean();
      coldDrinks = rawColdDrinks
        .map(d => ({
          _id: d._id,
          name: d.name,
          company: d.company,
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
    } catch (e) {
      // Fallback: old Inventory-based cold drinks if ColdDrink model not found
      const invDrinks = await Inventory.find({
        branchId, category: 'cold_drinks', isActive: true, currentStock: { $gt: 0 }
      }).lean();
      coldDrinks = invDrinks;
    }

    res.json({
      success: true,
      menu: { products, deals, coldDrinks },
      counts: { products: products.length, deals: deals.length, coldDrinks: coldDrinks.length }
    });
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREATE DELIVERY ORDER ==========

exports.createDeliveryOrder = async (req, res) => {
  try {
    const { items, customerName, customerPhone, deliveryAddress, notes } = req.body;

    if (!customerName || !customerPhone || !deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Customer name, phone, and delivery address are required'
      });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    // ✅ FIX: ensure itemType is set on every item
    const processedItems = items.map(item => ({
      ...item,
      itemType: resolveItemType(item),
    }));

    // Inventory availability checks
    for (const item of processedItems) {
      if (item.type === 'product') {
        const product = await Product.findById(item.itemId)
          .populate('sizes.ingredients.inventoryItemId');
        if (!product) {
          return res.status(404).json({ success: false, message: `Product not found: ${item.name}` });
        }
        const sizeData = product.sizes.find(s => s.size === item.size);
        if (sizeData && sizeData.ingredients) {
          for (const ingredient of sizeData.ingredients) {
            const inventory = await Inventory.findById(ingredient.inventoryItemId);
            const requiredQty = ingredient.quantity * item.quantity;
            if (!inventory || inventory.currentStock < requiredQty) {
              return res.status(400).json({
                success: false,
                message: `Insufficient stock for ${product.name}`
              });
            }
          }
        }
      } else if (item.type === 'cold_drink') {
        try {
          const coldDrink = await ColdDrink.findOne({ 'sizes._id': item.itemId });
          if (coldDrink) {
            const sizeVariant = coldDrink.sizes.id(item.itemId);
            if (sizeVariant && sizeVariant.currentStock < item.quantity) {
              return res.status(400).json({
                success: false,
                message: `Insufficient stock for ${coldDrink.name} (${sizeVariant.size})`
              });
            }
          }
        } catch (e) {
          const coldDrink = await Inventory.findById(item.itemId);
          if (!coldDrink || coldDrink.currentStock < item.quantity) {
            return res.status(400).json({ success: false, message: 'Insufficient stock for cold drink' });
          }
        }
      }
    }

    const { subtotal, tax, total } = calculateOrderTotal(processedItems, 0, 5);
    const estimatedTime = calculateTotalTime(processedItems) + 20; // +20 for delivery

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      branchId: req.user.branchId,
      orderType: 'delivery',
      items: processedItems,
      subtotal,
      tax,
      total,
      estimatedTime,
      deliveryBoyId: req.user._id,
      customerName,
      customerPhone,
      deliveryAddress,
      notes,
      status: 'pending'
    });

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId', 'name');

    res.status(201).json({
      success: true,
      order: populatedOrder,
      message: 'Delivery order created successfully'
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
      status: { $nin: ['completed', 'cancelled'] }
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

// ========== UPDATE ORDER STATUS ==========

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status, startMeterReading } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.deliveryBoyId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this order' });
    }

    order.status = status;

    if (status === 'out_for_delivery' && startMeterReading !== undefined) {
      order.startMeterReading = startMeterReading;
      order.departedAt = new Date();
    }
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');

    res.json({
      success: true,
      order: populatedOrder,
      message: `Order updated to ${status}`
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== COMPLETE DELIVERY (meter + cash — wapsi pay cashier verify karega) ==========

exports.completeDelivery = async (req, res) => {
  try {
    const { orderId, endMeterReading, cashReceived, distanceTravelled } = req.body;

    if (!orderId || !endMeterReading || !cashReceived) {
      return res.status(400).json({
        success: false,
        message: 'orderId, endMeterReading, and cashReceived are required'
      });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.deliveryBoyId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (order.status !== 'out_for_delivery') {
      return res.status(400).json({
        success: false,
        message: 'Order must be out_for_delivery to complete'
      });
    }

    // ✅ FIX: 'completed' nahi, 'returned' set karo
    // Delivery boy wapas aaya — cashier payment verify karega tab 'completed' hoga
    order.status = 'returned';
    order.endMeterReading = endMeterReading;
    order.cashReceived = cashReceived;
    order.distanceTravelled = distanceTravelled ||
      (order.startMeterReading ? endMeterReading - order.startMeterReading : 0);
    order.deliveredAt = new Date();
    // ✅ completedAt cashier set karega receivePayment mein

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');

    res.json({
      success: true,
      order: populatedOrder,
      summary: {
        distanceTravelled: order.distanceTravelled,
        cashReceived: order.cashReceived,
        orderTotal: order.total,
        change: cashReceived - order.total,
      },
      message: 'Wapas aa gaye! Cashier se payment verify karwaein'
    });
  } catch (error) {
    console.error('Complete delivery error:', error);
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

    if (order.deliveryBoyId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update order after chef acceptance'
      });
    }

    if (items) {
      if (items.length === 0) {
        return res.status(400).json({ success: false, message: 'Order must have at least one item' });
      }
      const processedItems = items.map(item => ({
        ...item,
        itemType: resolveItemType(item),
      }));
      const { subtotal, tax, total } = calculateOrderTotal(processedItems, order.discount, 5);
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

module.exports = exports;