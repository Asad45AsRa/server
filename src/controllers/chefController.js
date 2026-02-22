const Order         = require('../models/Order');
const Inventory     = require('../models/Inventory');
const ChefInventory = require('../models/Chefinventory');
const { InventoryRequest, InventoryTransaction } = require('../models/InventoryOfficer');
const notificationService   = require('../services/notificationService');
const InventoryReturnRequest = require('../models/InventoryReturnRequest');

// ══════════════════════════════════════════════════════
//  ORDER MANAGEMENT
// ══════════════════════════════════════════════════════

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
    console.error('getPendingOrders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      chefId: req.user._id,
      status: { $in: ['accepted', 'preparing', 'ready'] },
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

exports.acceptOrder = async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.status !== 'pending')
      return res.status(400).json({ success: false, message: 'Order is not pending' });

    order.status     = 'accepted';
    order.chefId     = req.user._id;
    order.acceptedAt = new Date();
    await order.save();

    const notifyId = order.waiterId || order.deliveryBoyId;
    if (notifyId)
      await notificationService.sendOrderNotification(notifyId, order.orderNumber, 'accepted');

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name');

    res.json({ success: true, order: populated, message: 'Order accepted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── UPDATE ORDER STATUS ──────────────────────────────────────────────────────
// Jab status === 'ready':
//   1. Cold drink stock minus karo ColdDrink model se
//   2. Product ingredients inventory se minus karo
//   3. Chef ki aaj ki ChefInventory se bhi usedQuantity update karo
exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status, additionalDelay } = req.body;
    const ColdDrink = require('../models/Colddrink');

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    if (order.chefId && order.chefId.toString() !== req.user._id.toString())
      return res.status(403).json({ success: false, message: 'Not authorized' });

    order.status = status;

    if (additionalDelay && parseInt(additionalDelay) > 0)
      order.additionalDelay = (order.additionalDelay || 0) + parseInt(additionalDelay);

    if (status === 'preparing') order.preparingAt = new Date();

    // ════════════════════════════════════════════════════════
    //  READY — STOCK DEDUCTION
    // ════════════════════════════════════════════════════════
    if (status === 'ready' && !order.stockDeducted) {
      order.readyAt = new Date();

      // Chef ki aaj ki inventory record (optional — usedQuantity update ke liye)
      const today    = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const chefRecord = await ChefInventory.findOne({
        chefId: req.user._id,
        status: 'active',
        date: { $gte: today, $lt: tomorrow },
      });

      for (const item of order.items) {
        const orderQty = item.quantity || 1;

        // ── 1. COLD DRINK stock minus ──────────────────────────────────
        if (item.isColdDrink && item.coldDrinkId && item.coldDrinkSizeId) {
          try {
            const drink = await ColdDrink.findById(item.coldDrinkId);
            if (drink) {
              const variant = drink.sizes.id(item.coldDrinkSizeId);
              if (variant) {
                variant.currentStock = Math.max(0, variant.currentStock - orderQty);
                await drink.save();
                console.log(`Cold drink deducted: ${drink.name} ${variant.size} -${orderQty}`);
              }
            }
          } catch (e) {
            console.error('Cold drink deduct error:', e.message);
          }
          continue; // cold drink ka koi inventory ingredient nahi
        }

        // ── 2. PRODUCT INGREDIENTS inventory minus ─────────────────────
        if (item.ingredients && item.ingredients.length > 0) {
          for (const ing of item.ingredients) {
            if (!ing.inventoryItemId || !ing.quantity) continue;
            try {
              const invItem = await Inventory.findById(ing.inventoryItemId);
              if (!invItem) continue;

              const deductQty = parseFloat(ing.quantity) * orderQty;
              invItem.currentStock    = Math.max(0, invItem.currentStock - deductQty);
              invItem.totalIssueValue = (invItem.totalIssueValue || 0) +
                deductQty * (invItem.averageCost || invItem.pricePerUnit || 0);
              invItem.stockHistory.push({ date: new Date(), quantity: deductQty, type: 'out' });
              await invItem.save();

              // Chef record mein bhi usedQuantity update karo (agar hai)
              if (chefRecord) {
                const chefItem = chefRecord.items.find(
                  ci => ci.inventoryItemId.toString() === ing.inventoryItemId.toString()
                );
                if (chefItem) {
                  const newUsed = chefItem.usedQuantity + deductQty;
                  // issuedQuantity se zyada nahi hoga
                  chefItem.usedQuantity = Math.min(newUsed, chefItem.issuedQuantity);
                }
              }

              console.log(`Ingredient deducted: ${invItem.name} -${deductQty} ${ing.unit || invItem.unit}`);
            } catch (e) {
              console.error('Ingredient deduct error:', e.message);
            }
          }
        }
      }

      // Chef record save karo agar update hua
      if (chefRecord) {
        try { await chefRecord.save(); } catch (e) { console.error('ChefRecord save error:', e.message); }
      }

      // Double deduction se bachao
      order.stockDeducted = true;
    }

    await order.save();

    // Notify waiter / delivery boy
    const notifyId = order.waiterId || order.deliveryBoyId;
    if (notifyId)
      await notificationService.sendOrderNotification(notifyId, order.orderNumber, status);

    const populated = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('deliveryBoyId', 'name')
      .populate('chefId', 'name');

    res.json({ success: true, order: populated, message: `Order updated to ${status}` });
  } catch (error) {
    console.error('updateOrderStatus error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  CHEF'S OWN INVENTORY (issued by inventory officer)
// ══════════════════════════════════════════════════════

exports.getMyInventory = async (req, res) => {
  try {
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const chefInventory = await ChefInventory.findOne({
      chefId: req.user._id,
      status: 'active',
      date: { $gte: today, $lt: tomorrow },
    }).populate('items.inventoryItemId', 'name unit currentStock');

    res.json({ success: true, chefInventory: chefInventory || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateItemUsage = async (req, res) => {
  try {
    const { chefInventoryId, inventoryItemId, usedQuantity } = req.body;

    const record = await ChefInventory.findOne({ _id: chefInventoryId, chefId: req.user._id });
    if (!record) return res.status(404).json({ success: false, message: 'Chef inventory not found' });

    const item = record.items.find(i => i.inventoryItemId.toString() === inventoryItemId);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const totalUsed = item.usedQuantity + parseFloat(usedQuantity);
    if (totalUsed + item.returnedQuantity > item.issuedQuantity)
      return res.status(400).json({ success: false, message: 'Usage exceeds issued quantity' });

    item.usedQuantity = totalUsed;
    await record.save();

    res.json({ success: true, chefInventory: record, message: 'Usage updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.returnInventory = async (req, res) => {
  try {
    const { chefInventoryId, returnItems } = req.body;

    const record = await ChefInventory.findOne({
      _id: chefInventoryId,
      chefId: req.user._id,
      status: 'active',
    });
    if (!record) return res.status(404).json({ success: false, message: 'Active chef inventory not found' });

    for (const ret of returnItems) {
      const item = record.items.find(i => i.inventoryItemId.toString() === ret.inventoryItemId);
      if (!item) continue;

      const maxReturnable = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
      const actualReturn  = Math.min(parseFloat(ret.returnQuantity), maxReturnable);
      if (actualReturn <= 0) continue;

      item.returnedQuantity += actualReturn;

      await Inventory.findByIdAndUpdate(ret.inventoryItemId, {
        $inc: { currentStock: actualReturn },
        $push: { stockHistory: { date: new Date(), quantity: actualReturn, type: 'in' } },
      });

      await InventoryTransaction.create({
        itemId: ret.inventoryItemId, type: 'return',
        quantity: actualReturn, unit: item.unit,
        issuedTo: req.user._id, receivedBy: req.user._id,
        notes: `Returned by chef ${req.user.name}`, date: new Date(),
      });
    }

    const allReturned = record.items.every(
      i => i.usedQuantity + i.returnedQuantity >= i.issuedQuantity
    );
    record.status     = allReturned ? 'returned' : 'partial_return';
    record.returnedAt = new Date();
    await record.save();

    res.json({ success: true, chefInventory: record, message: 'Inventory returned successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getMyReturnHistory = async (req, res) => {
  try {
    const records = await ChefInventory.find({
      chefId: req.user._id,
      status: { $in: ['returned', 'partial_return'] },
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
//  INVENTORY (chef ki nazar se — sirf regular inventory)
//  Cold drinks IS NOT returned here
// ══════════════════════════════════════════════════════

exports.getInventory = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    // Cold drinks NAHI aayengi — sirf Inventory model se
    const inventory = await Inventory.find({ branchId, isActive: true }).sort({ name: 1 }).lean();

    const withFlags = inventory.map(item => ({
      ...item,
      isLowStock: item.currentStock <= item.minimumStock,
    }));

    res.json({ success: true, inventory: withFlags, count: withFlags.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.requestInventory = async (req, res) => {
  try {
    const { items, notes } = req.body;
    if (!items || items.length === 0)
      return res.status(400).json({ success: false, message: 'At least one item required' });

    const normalizedItems = items.map(item => ({
      inventoryItemId:   item.inventoryItemId || item.itemId,
      requestedQuantity: item.requestedQuantity || item.quantity,
      unit:              item.unit || 'kg',
      purpose:           item.purpose || '',
    }));

    const request = await InventoryRequest.create({
      requestedBy: req.user._id,
      items: normalizedItems,
      notes,
      status: 'pending',
    });

    const populated = await InventoryRequest.findById(request._id)
      .populate('requestedBy', 'name role')
      .populate('items.inventoryItemId', 'name unit currentStock');

    res.status(201).json({ success: true, request: populated, message: 'Request submitted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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
      _id: chefInventoryId, chefId: req.user._id, status: 'active',
    });
    if (!record)
      return res.status(404).json({ success: false, message: 'Active inventory record nahi mili' });

    for (const ret of items) {
      const item = record.items.find(i => i.inventoryItemId.toString() === ret.inventoryItemId);
      if (!item)
        return res.status(400).json({ success: false, message: `Item nahi mila: ${ret.inventoryItemId}` });

      const maxReturn = item.issuedQuantity - item.usedQuantity - item.returnedQuantity;
      if (parseFloat(ret.returnQuantity) > maxReturn)
        return res.status(400).json({
          success: false,
          message: `${item.name}: max returnable ${maxReturn} ${item.unit}`,
        });
    }

    const returnRequest = await InventoryReturnRequest.create({
      chefId: req.user._id, chefInventoryId,
      branchId: req.user.branchId, items, notes,
    });

    res.status(201).json({
      success: true, returnRequest,
      message: 'Return request submit ho gayi. Officer approve karega.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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