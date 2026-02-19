const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const ChefInventory = require('../models/Chefinventory');
const { InventoryRequest, InventoryTransaction } = require('../models/InventoryOfficer');
const notificationService = require('../services/notificationService');
const InventoryReturnRequest = require('../models/InventoryReturnRequest');
// ══════════════════════════════════════════════════════
//  ORDER MANAGEMENT
// ══════════════════════════════════════════════════════

// GET PENDING ORDERS
exports.getPendingOrders = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const orders = await Order.find({ branchId, status: 'pending' })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .sort({ createdAt: 1 })
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    console.error('Get pending orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET MY ORDERS (accepted / preparing / ready)
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      chefId: req.user._id,
      status: { $in: ['accepted', 'preparing', 'ready'] }
    })
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .sort({ acceptedAt: 1 })
      .lean();

    res.json({ success: true, orders, count: orders.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ACCEPT ORDER
exports.acceptOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'pending')
      return res.status(400).json({ success: false, message: 'Order is not pending' });

    order.status = 'accepted';
    order.chefId = req.user._id;
    order.acceptedAt = new Date();
    await order.save();

    // Notify waiter / delivery boy
    const notifyId = order.waiterId || order.deliveryBoyId;
    if (notifyId) {
      await notificationService.sendOrderNotification(notifyId, order.orderNumber, 'accepted');
    }

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name');

    res.json({ success: true, order: populated, message: 'Order accepted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// UPDATE ORDER STATUS  (preparing → ready) with optional delay
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status, additionalDelay } = req.body;
    const order = await Order.findById(orderId);

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.chefId && order.chefId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, message: 'Not authorized' });

    order.status = status;

    if (additionalDelay && parseInt(additionalDelay) > 0) {
      order.additionalDelay = (order.additionalDelay || 0) + parseInt(additionalDelay);
    }

    if (status === 'preparing') order.preparingAt = new Date();
    if (status === 'ready')     order.readyAt    = new Date();

    await order.save();

    // Notify
    const notifyId = order.waiterId || order.deliveryBoyId;
    if (notifyId) {
      await notificationService.sendOrderNotification(notifyId, order.orderNumber, status);
    }

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name');

    res.json({ success: true, order: populated, message: `Order updated to ${status}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  CHEF's OWN INVENTORY (issued by inventory officer)
// ══════════════════════════════════════════════════════

// GET: Chef apni current day ki inventory dekhe
exports.getMyInventory = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const chefInventory = await ChefInventory.findOne({
      chefId: req.user._id,
      status: 'active',
      date: { $gte: today, $lt: tomorrow }
    }).populate('items.inventoryItemId', 'name unit currentStock');

    res.json({ success: true, chefInventory: chefInventory || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST: Chef use record kare (kitna use kiya kisi item ka)
exports.updateItemUsage = async (req, res) => {
  try {
    const { chefInventoryId, inventoryItemId, usedQuantity } = req.body;

    const record = await ChefInventory.findOne({
      _id: chefInventoryId,
      chefId: req.user._id
    });

    if (!record) return res.status(404).json({ success: false, message: 'Chef inventory not found' });

    const item = record.items.find(i => i.inventoryItemId.toString() === inventoryItemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found in your inventory' });

    const totalUsed = item.usedQuantity + parseFloat(usedQuantity);
    if (totalUsed + item.returnedQuantity > item.issuedQuantity) {
      return res.status(400).json({ success: false, message: 'Usage exceeds issued quantity' });
    }

    item.usedQuantity = totalUsed;
    await record.save(); // pre-save hook recalculates remaining

    res.json({ success: true, chefInventory: record, message: 'Usage updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST: Chef bachi hui inventory return kare — auto main inventory + ho jaye gi
exports.returnInventory = async (req, res) => {
  try {
    const { chefInventoryId, returnItems } = req.body;
    // returnItems: [{ inventoryItemId, returnQuantity }]

    const record = await ChefInventory.findOne({
      _id: chefInventoryId,
      chefId: req.user._id,
      status: 'active'
    });

    if (!record) return res.status(404).json({ success: false, message: 'Active chef inventory not found' });

    for (const ret of returnItems) {
      const item = record.items.find(i => i.inventoryItemId.toString() === ret.inventoryItemId);
      if (!item) continue;

      const maxReturnable = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
      const actualReturn = Math.min(parseFloat(ret.returnQuantity), maxReturnable);

      if (actualReturn <= 0) continue;

      item.returnedQuantity += actualReturn;

      // ✅ Auto-add back to main inventory
      await Inventory.findByIdAndUpdate(
        ret.inventoryItemId,
        {
          $inc: { currentStock: actualReturn },
          $push: {
            stockHistory: {
              date: new Date(),
              quantity: actualReturn,
              type: 'in'
            }
          }
        }
      );

      // Record transaction
      await InventoryTransaction.create({
        itemId: ret.inventoryItemId,
        type: 'return',
        quantity: actualReturn,
        unit: item.unit,
        issuedTo: req.user._id,
        receivedBy: req.user._id,
        notes: `Returned by chef ${req.user.name} after shift`,
        date: new Date()
      });
    }

    // Check if all items returned
    const allReturned = record.items.every(
      i => i.usedQuantity + i.returnedQuantity >= i.issuedQuantity
    );
    record.status = allReturned ? 'returned' : 'partial_return';
    record.returnedAt = new Date();

    await record.save();

    res.json({ success: true, chefInventory: record, message: 'Inventory returned successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET: Chef ki return history
exports.getMyReturnHistory = async (req, res) => {
  try {
    const records = await ChefInventory.find({
      chefId: req.user._id,
      status: { $in: ['returned', 'partial_return'] }
    })
      .populate('items.inventoryItemId', 'name unit')
      .sort({ returnedAt: -1 })
      .limit(30);

    res.json({ success: true, records });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  INVENTORY REQUESTS  (agar aur chahiye)
// ══════════════════════════════════════════════════════

// GET: Main inventory (chef dekhe kya available hai)
exports.getInventory = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const inventory = await Inventory.find({ branchId, isActive: true })
      .sort({ name: 1 })
      .lean();

    const withFlags = inventory.map(item => ({
      ...item,
      isLowStock: item.currentStock <= item.minimumStock
    }));

    res.json({ success: true, inventory: withFlags, count: inventory.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST: Request for more inventory
exports.requestInventory = async (req, res) => {
  try {
    const { items, notes } = req.body;
    if (!items || items.length === 0)
      return res.status(400).json({ success: false, message: 'At least one item is required' });

    const request = await InventoryRequest.create({
      requestedBy: req.user._id,
      items,
      notes,
      status: 'pending'
    });

    const populated = await InventoryRequest.findById(request._id)
      .populate('requestedBy', 'name role')
      .populate('items.inventoryItemId', 'name unit currentStock');

    res.status(201).json({
      success: true,
      request: populated,
      message: 'Inventory request submitted successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET: My requests history
exports.getMyRequests = async (req, res) => {
  try {
    const requests = await InventoryRequest.find({ requestedBy: req.user._id })
      .populate('approvedBy', 'name')
      .populate('issuedBy', 'name')
      .populate('items.inventoryItemId', 'name unit currentStock')
      .sort({ requestDate: -1 });

    res.json({ success: true, requests, count: requests.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.submitReturnRequest = async (req, res) => {
  try {
    const { chefInventoryId, items, notes } = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ success: false, message: 'Kam se kam ek item zaroori hai' });

    const record = await ChefInventory.findOne({
      _id: chefInventoryId,
      chefId: req.user._id,
      status: 'active'
    });
    if (!record)
      return res.status(404).json({ success: false, message: 'Active inventory record nahi mili' });

    // Validate: return quantity issued se zyada na ho
    for (const ret of items) {
      const item = record.items.find(
        i => i.inventoryItemId.toString() === ret.inventoryItemId
      );
      if (!item)
        return res.status(400).json({ success: false, message: `Item aapki inventory mein nahi: ${ret.inventoryItemId}` });

      const maxReturn = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
      if (parseFloat(ret.returnQuantity) > maxReturn) {
        return res.status(400).json({
          success: false,
          message: `${item.name}: max returnable ${maxReturn} ${item.unit} hai`
        });
      }
    }

    const returnRequest = await InventoryReturnRequest.create({
      chefId: req.user._id,
      chefInventoryId,
      branchId: req.user.branchId,
      items,
      notes
    });

    res.status(201).json({
      success: true,
      returnRequest,
      message: 'Return request submit ho gayi. Officer approve karega.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Chef: Apni return requests dekhe
exports.getMyReturnRequests = async (req, res) => {
  try {
    const requests = await InventoryReturnRequest.find({ chefId: req.user._id })
      .populate('items.inventoryItemId', 'name unit')
      .sort({ createdAt: -1 });
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;