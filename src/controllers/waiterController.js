const Order = require('../models/Order');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Inventory = require('../models/Inventory');
const ColdDrink = require('../models/Colddrink');
const Table = require('../models/Table');
const User = require('../models/User');
const { generateOrderNumber, calculateTotalTime, calculateOrderTotal } = require('../utils/helpers');

const BRANCH_NAME = 'Al Madina Fast Food Shahkot';

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

    const deals = rawDeals.map(d => ({ ...d, price: d.discountedPrice }));

    const now = new Date();
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
      counts: { products: products.length, deals: deals.length, coldDrinks: coldDrinks.length }
    });
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== GET DELIVERY BOYS ==========

exports.getDeliveryBoys = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const boys = await User.find({
      branchId,
      role: 'delivery',
      isApproved: true,
    }).select('name phone _id').lean();

    res.json({ success: true, deliveryBoys: boys });
  } catch (error) {
    console.error('Get delivery boys error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== TABLES ==========

exports.getTables = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { floor } = req.query;

    const query = { branchId, isActive: true };
    if (floor) query.floor = floor;

    const tables = await Table.find(query)
      .populate({
        path: 'currentOrderId',
        select: 'orderNumber total status items createdAt',
        populate: { path: 'waiterId', select: 'name' }
      })
      .sort({ floor: 1, tableNumber: 1 })
      .lean();

    const groupedTables = {
      ground_floor: [],
      first_floor:  [],
      second_floor: [],
      outdoor:      []
    };

    tables.forEach(table => {
      if (groupedTables[table.floor]) groupedTables[table.floor].push(table);
    });

    res.json({ success: true, tables, groupedTables, count: tables.length });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREATE ORDER ==========
// Supports: dine_in, takeaway, delivery
//
// ✅ UPDATED DELIVERY LOGIC:
//   - Agar waiter ne deliveryBoyId diya → directly us ko assign karo (koi broadcast nahi)
//   - Agar deliveryBoyId nahi diya → order unassigned banao, Chef ke "ready" karne ke
//     baad chefController mein broadcast hoga (yahan nahi)

exports.createOrder = async (req, res) => {
  try {
    const {
      orderType,
      tableNumber,
      floor,
      items,
      customerName,
      customerPhone,
      deliveryAddress,
      notes,
      cashierNote,
      deliveryBoyId,
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    const processedItems = items.map(item => {
      let itemType = 'Product';
      if (item.type === 'cold_drink') itemType = 'Inventory';
      else if (item.type === 'deal')  itemType = 'Deal';
      return { ...item, itemType: item.itemType || itemType };
    });

    // ── Validation ──────────────────────────────────────────────────────────
    if (orderType === 'dine_in' && (!tableNumber || !floor)) {
      return res.status(400).json({
        success: false,
        message: 'Table number and floor are required for dine-in orders',
      });
    }

    if ((orderType === 'takeaway' || orderType === 'delivery') && (!customerName || !customerPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Customer name and phone are required for takeaway/delivery orders',
      });
    }

    if (orderType === 'delivery' && !deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address is required for delivery orders',
      });
    }

    // ── Cold drink stock check ──────────────────────────────────────────────
    for (const item of processedItems) {
      if (item.type === 'cold_drink') {
        const coldDrink = await ColdDrink.findOne({ 'sizes._id': item.itemId });
        if (coldDrink) {
          const sizeVariant = coldDrink.sizes.id(item.itemId);
          if (sizeVariant && sizeVariant.currentStock < item.quantity) {
            return res.status(400).json({
              success: false,
              message: `Insufficient stock for ${coldDrink.name} (${sizeVariant.size})`,
            });
          }
        }
      }
    }

    const { subtotal, tax, total } = calculateOrderTotal(processedItems, 0, 0);
    const estimatedTime = calculateTotalTime(processedItems);

    // ── Build cashier note ─────────────────────────────────────────────────
    let finalCashierNote = cashierNote || '';
    if (!finalCashierNote) {
      if (orderType === 'dine_in') {
        const floorLabel = (floor || '').replace(/_/g, ' ');
        finalCashierNote = `🪑 Dine In — Table ${tableNumber} (${floorLabel})`;
      } else if (orderType === 'takeaway') {
        finalCashierNote = `🥡 Takeaway — ${customerName}${customerPhone ? ' | ' + customerPhone : ''}`;
      } else if (orderType === 'delivery') {
        finalCashierNote = `🚚 Delivery — ${customerName} | ${customerPhone}`;
      }
    }

    const orderData = {
      orderNumber: generateOrderNumber(),
      branchId:    req.user.branchId,
      orderType,
      items:        processedItems,
      subtotal, tax, total, estimatedTime,
      waiterId:    req.user._id,
      notes,
      cashierNote: finalCashierNote,
      status:      'pending',
    };

    if (orderType === 'dine_in') {
      orderData.tableNumber = tableNumber;
      orderData.floor       = floor;
    }

    if (orderType === 'takeaway' || orderType === 'delivery') {
      orderData.customerName  = customerName;
      orderData.customerPhone = customerPhone;
    }

    if (orderType === 'delivery') {
      orderData.deliveryAddress = deliveryAddress;
      // ✅ Sirf tab assign karo jab waiter ne explicitly select kiya ho
      if (deliveryBoyId) {
        orderData.deliveryBoyId = deliveryBoyId;
      }
      // ❌ Agar nahi select kiya → deliveryBoyId null rahega
      // ✅ Chef "ready" karega tab chefController mein broadcast hoga
    }

    const order = await Order.create(orderData);

    // ── Auto-occupy table for dine_in ──────────────────────────────────────
    if (orderType === 'dine_in') {
      let table = await Table.findOne({ branchId: req.user.branchId, tableNumber, floor });

      if (!table) {
        table = await Table.create({
          tableNumber, capacity: 4, floor,
          branchId: req.user.branchId,
          isActive: true, isOccupied: false,
        });
      }

      if (table.isOccupied) {
        await Order.findByIdAndDelete(order._id);
        return res.status(400).json({
          success: false,
          message: `Table ${tableNumber} is already occupied`,
        });
      }

      table.isOccupied     = true;
      table.currentOrderId = order._id;
      await table.save();
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId',  'name image');

    // ✅ NOTE: Unassigned delivery broadcast ab yahan NAHI hoga.
    // Chef ke "ready" karne par chefController.updateOrderStatus mein hoga.
    // Agar deliveryBoyId assign hua hai to notification socket se ja sakti hai (optional).
    if (orderType === 'delivery' && deliveryBoyId) {
      const io = req.app.get('io');
      if (io) {
        io.to(`branch-${req.user.branchId}`).emit('delivery-assigned', {
          orderId:         String(populatedOrder._id),
          orderNumber:     populatedOrder.orderNumber,
          customerName,
          deliveryAddress,
          total,
          deliveryBoyId:   String(deliveryBoyId),
          assignedBy:      req.user.name || 'Waiter',
        });
        console.log(`[Waiter] Delivery order ${populatedOrder.orderNumber} assigned to boy ${deliveryBoyId}`);
      }
    }

    res.status(201).json({
      success: true,
      order:   populatedOrder,
      message: orderType === 'delivery' && !deliveryBoyId
        ? 'Order created. Jab chef ready karega tab delivery boys ko notify kiya jayega.'
        : 'Order created successfully',
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MY ORDERS ==========

exports.getMyOrders = async (req, res) => {
  try {
    const { showHistory } = req.query;

    let query;
    if (showHistory === 'true') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      query = { waiterId: req.user._id, createdAt: { $gte: sevenDaysAgo } };
    } else {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      query = { waiterId: req.user._id, createdAt: { $gte: oneDayAgo } };
    }

    const orders = await Order.find(query)
      .populate('chefId',       'name')
      .populate('deliveryBoyId','name phone')
      .populate('items.itemId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get my orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE ORDER ==========

exports.updateOrder = async (req, res) => {
  try {
    const orderId = req.params.id;
    const { items, notes, cashierNote } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.waiterId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this order' });
    }

    const EDITABLE_STATUSES = ['pending', 'accepted', 'preparing'];
    if (!EDITABLE_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot update order with status: ${order.status}`,
      });
    }

    if (items && items.length > 0) {
      const processedItems = items.map(item => {
        let itemType = item.itemType;
        if (!itemType) {
          if (item.type === 'cold_drink') itemType = 'Inventory';
          else if (item.type === 'deal')  itemType = 'Deal';
          else                            itemType = 'Product';
        }
        return { ...item, itemType };
      });
      const { subtotal, tax, total } = calculateOrderTotal(processedItems, order.discount, 0);
      order.items         = processedItems;
      order.subtotal      = subtotal;
      order.tax           = tax;
      order.total         = total;
      order.estimatedTime = calculateTotalTime(processedItems);
    } else if (items && items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    if (notes       !== undefined) order.notes       = notes;
    if (cashierNote !== undefined) order.cashierNote = cashierNote;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId',  'name');

    res.json({ success: true, order: populatedOrder, message: 'Order updated successfully' });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MARK DELIVERED ==========

exports.markDelivered = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.waiterId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    if (order.status !== 'ready') {
      return res.status(400).json({
        success: false,
        message: 'Order must be in "ready" status to mark as delivered',
      });
    }

    order.status      = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('waiterId',     'name')
      .populate('items.itemId', 'name');

    res.json({ success: true, order: populatedOrder, message: 'Order marked as delivered' });
  } catch (error) {
    console.error('Mark delivered error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== GET ORDER SLIP ==========

exports.getOrderSlip = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('waiterId',      'name')
      .populate('cashierId',     'name')
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId',  'name');

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.waiterId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const slipData = {
      orderNumber:  order.orderNumber,
      orderType:    order.orderType,
      tableNumber:  order.tableNumber,
      floor:        order.floor?.replace(/_/g, ' '),
      cashierNote:  order.cashierNote,
      items: order.items.map(item => ({
        name:     item.itemId?.name || item.name || 'Item',
        size:     item.size,
        quantity: item.quantity,
        price:    item.price,
        subtotal: item.price * item.quantity,
      })),
      subtotal:   order.subtotal || order.total,
      discount:   order.discount || 0,
      tax:        order.tax || 0,
      total:      order.total,
      waiter:     order.waiterId?.name   || null,
      deliveryBoy:order.deliveryBoyId?.name || null,
      branchName: BRANCH_NAME,
      createdAt:  order.createdAt,
      status:     order.status,
    };

    res.json({ success: true, slipData });
  } catch (error) {
    console.error('Get order slip error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DELETE ORDER ==========

exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.waiterId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this order' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Cannot delete order after chef acceptance' });
    }

    order.status = 'cancelled';
    await order.save();

    if (order.tableNumber) {
      await Table.findOneAndUpdate(
        { branchId: req.user.branchId, tableNumber: order.tableNumber, floor: order.floor },
        { isOccupied: false, currentOrderId: null }
      );
    }

    res.json({ success: true, message: 'Order cancelled successfully' });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== REQUEST PRINT ==========

exports.requestPrint = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('waiterId',      'name')
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId',  'name');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const waiterId = order.waiterId?._id?.toString() || order.waiterId?.toString();
    if (waiterId !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const slipData = {
      orderNumber:     order.orderNumber,
      orderType:       order.orderType,
      tableNumber:     order.tableNumber   || null,
      floor:           order.floor         ? order.floor.replace(/_/g, ' ') : null,
      cashierNote:     order.cashierNote   || null,
      customerName:    order.customerName  || null,
      customerPhone:   order.customerPhone || null,
      deliveryAddress: order.deliveryAddress || null,
      deliveryBoy:     order.deliveryBoyId?.name || null,
      waiter:          order.waiterId?.name || null,
      items: (order.items || []).map(item => ({
        name:     item.itemId?.name || item.name || 'Item',
        size:     item.size     || null,
        quantity: item.quantity || 1,
        price:    item.price    || 0,
        subtotal: (item.price || 0) * (item.quantity || 1),
      })),
      subtotal:  order.subtotal || order.total,
      discount:  order.discount || 0,
      tax:       order.tax      || 0,
      total:     order.total,
      branchName: BRANCH_NAME,
      createdAt:  order.createdAt,
      status:     order.status,
      printRequestedAt: new Date(),
      printRequestedBy: req.user.name || 'Waiter',
    };

    const io = req.app.get('io');
    if (io) {
      const branchIdStr = String(order.branchId);
      const room = `branch-${branchIdStr}`;

      io.to(room).emit('print-order', {
        orderId:     String(order._id),
        orderNumber: order.orderNumber,
        branchId:    branchIdStr,
        slipData,
        requestedBy: req.user.name || 'Waiter',
        requestedAt: new Date(),
      });

      console.log(`[PrintRequest] ✅ Order ${order.orderNumber} → ${room}`);
    }

    res.json({
      success: true,
      message: 'Print request sent! Desktop par automatically print ho jayega.',
      orderNumber: order.orderNumber,
    });
  } catch (error) {
    console.error('requestPrint error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;