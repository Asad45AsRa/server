const Order         = require('../models/Order');
const Inventory     = require('../models/Inventory');
const ChefInventory = require('../models/Chefinventory');
const { InventoryRequest, InventoryTransaction } = require('../models/InventoryOfficer');
const notificationService    = require('../services/notificationService');
const InventoryReturnRequest = require('../models/InventoryReturnRequest');

// ══════════════════════════════════════════════════════════════════════════════
//  UNIT CONVERSION HELPER
//  Inventory unit (kg/liter/pieces) ↔ Ingredient unit (g/ml/pieces etc.)
// ══════════════════════════════════════════════════════════════════════════════
const UNIT_TO_BASE = {
  // Weight — base unit: kg
  kg:          1,
  half_kg:     0.5,
  quarter_kg:  0.25,
  g:           0.001,
  gram:        0.001,
  grams:       0.001,

  // Volume — base unit: liter
  liter:       1,
  litre:       1,
  l:           1,
  half_liter:  0.5,
  ml:          0.001,
  milliliter:  0.001,
  millilitre:  0.001,

  // Count — base unit: pieces
  pieces:      1,
  piece:       1,
  pcs:         1,
  nos:         1,
};

/**
 * Convert ingredient quantity to inventory unit.
 * e.g. ingredient says 200 (g), inventory is in kg → returns 0.2
 *
 * @param {number}  ingredientQty  — quantity written on the product ingredient
 * @param {string}  ingredientUnit — unit on the product ingredient (g, ml, pieces …)
 * @param {string}  inventoryUnit  — unit of the inventory item (kg, liter, pieces …)
 * @returns {number} quantity in inventory units
 */
const convertToInventoryUnit = (ingredientQty, ingredientUnit, inventoryUnit) => {
  const qty = parseFloat(ingredientQty) || 0;
  if (qty === 0) return 0;

  const fromUnit = (ingredientUnit || '').toLowerCase().trim();
  const toUnit   = (inventoryUnit  || '').toLowerCase().trim();

  if (fromUnit === toUnit) return qty;   // same unit, no conversion

  const fromBase = UNIT_TO_BASE[fromUnit];
  const toBase   = UNIT_TO_BASE[toUnit];

  if (!fromBase || !toBase) {
    // Unknown unit — log and return as-is
    console.warn(`[UnitConvert] Unknown units: ${fromUnit} → ${toUnit}. Returning qty as-is.`);
    return qty;
  }

  // Convert: qty in fromUnit → base → toUnit
  return (qty * fromBase) / toBase;
};

// ══════════════════════════════════════════════════════════════════════════════
//  ORDER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
//  UPDATE ORDER STATUS
//
//  When status → 'ready':
//    1. Products: deduct ingredients FROM CHEF's personal ChefInventory
//       (unit conversion handled: g→kg, ml→liter, etc.)
//    2. Cold Drinks: deduct directly from ColdDrink model stock
//    3. Main Inventory: NOT touched here — already reduced when items
//       were issued to chef by inventory officer
// ══════════════════════════════════════════════════════════════════════════════
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
    //  READY → DEDUCT STOCK
    // ════════════════════════════════════════════════════════
    if (status === 'ready' && !order.stockDeducted) {
      order.readyAt = new Date();

      // Load chef's active ChefInventory for today
      const today    = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      const chefRecord = await ChefInventory.findOne({
        chefId: req.user._id,
        status: 'active',
        date: { $gte: today, $lt: tomorrow },
      });

      // Track which chef-inventory items were modified
      let chefRecordDirty = false;

      for (const item of order.items) {
        const orderQty = item.quantity || 1;

        // ── COLD DRINK: deduct directly from ColdDrink model ──────────────
        if (item.isColdDrink && item.coldDrinkId && item.coldDrinkSizeId) {
          try {
            const drink = await ColdDrink.findById(item.coldDrinkId);
            if (drink) {
              const variant = drink.sizes.id(item.coldDrinkSizeId);
              if (variant) {
                variant.currentStock = Math.max(0, variant.currentStock - orderQty);
                await drink.save();
                console.log(`[ColdDrink] Deducted: ${drink.name} ${variant.size} -${orderQty}`);
              }
            }
          } catch (e) {
            console.error('[ColdDrink] Deduct error:', e.message);
          }
          continue; // Cold drinks don't use chef inventory
        }

        // ── PRODUCT INGREDIENTS: deduct from chef's ChefInventory ─────────
        // Order items mein ingredients nahi hoti — Product model se fetch karo
        const Product = require('../models/Product');
        let ingredients = [];

        try {
          const product = await Product.findById(item.itemId).lean();
          if (product) {
            const sizeData = product.sizes.find(s => s.size === item.size);
            if (sizeData && sizeData.ingredients && sizeData.ingredients.length > 0) {
              ingredients = sizeData.ingredients;
            }
          }
        } catch (e) {
          console.error('[Ingredients] Product fetch error:', e.message);
        }

        if (ingredients.length === 0) continue;

        for (const ing of ingredients) {
          if (!ing.inventoryItemId || !ing.quantity) continue;

          try {
            // ── Unit conversion ────────────────────────────────────────────
            // ing.unit  = unit set on product ingredient (g, ml, pieces …)
            // We need inventory unit to do proper conversion
            const invItem = await Inventory.findById(ing.inventoryItemId).lean();
            if (!invItem) {
              console.warn(`[Ingredients] Inventory item not found: ${ing.inventoryItemId}`);
              continue;
            }

            // Convert ingredient qty (e.g. 200 g) → inventory unit (e.g. 0.2 kg)
            const ingredientQtyInInventoryUnit = convertToInventoryUnit(
              ing.quantity * orderQty,  // total for this order line
              ing.unit || invItem.unit, // ingredient's own unit
              invItem.unit              // inventory unit
            );

            console.log(
              `[Ingredients] ${invItem.name}: ${ing.quantity * orderQty} ${ing.unit || invItem.unit}` +
              ` → ${ingredientQtyInInventoryUnit.toFixed(4)} ${invItem.unit}`
            );

            // ── Deduct from ChefInventory ──────────────────────────────────
            if (chefRecord) {
              const chefItem = chefRecord.items.find(
                ci => ci.inventoryItemId.toString() === ing.inventoryItemId.toString()
              );

              if (chefItem) {
                const remaining = chefItem.issuedQuantity
                  - chefItem.usedQuantity
                  - chefItem.returnedQuantity;

                // Don't exceed what was issued to chef
                const actualDeduct = Math.min(ingredientQtyInInventoryUnit, Math.max(remaining, 0));
                if (actualDeduct > 0) {
                  chefItem.usedQuantity += actualDeduct;
                  chefRecordDirty = true;
                  console.log(
                    `[ChefInventory] ${invItem.name}: usedQty +${actualDeduct.toFixed(4)} ${invItem.unit}`
                  );
                } else {
                  console.warn(
                    `[ChefInventory] ${invItem.name}: no remaining stock for chef (remaining=${remaining})`
                  );
                }
              } else {
                // Item not in chef's record (was not issued to chef) — skip
                console.warn(
                  `[ChefInventory] ${invItem.name} not found in chef's issued items. Skipping.`
                );
              }
            } else {
              // Chef has no active inventory record today
              // This means ingredients were NOT pre-issued to chef
              // In this case deduct directly from main inventory as fallback
              console.warn(
                `[ChefInventory] No active record for chef ${req.user._id}. ` +
                `Falling back to main inventory deduction for ${invItem.name}.`
              );
              await Inventory.findByIdAndUpdate(ing.inventoryItemId, {
                $inc: { currentStock: -ingredientQtyInInventoryUnit },
                $push: {
                  stockHistory: {
                    date: new Date(),
                    quantity: ingredientQtyInInventoryUnit,
                    type: 'out',
                  },
                },
              });
            }
          } catch (e) {
            console.error(`[Ingredients] Error processing ingredient ${ing.inventoryItemId}:`, e.message);
          }
        }
      }

      // Save chef record once if any items were modified
      if (chefRecord && chefRecordDirty) {
        try {
          await chefRecord.save();
          console.log('[ChefInventory] Record saved after order-ready deductions.');
        } catch (e) {
          console.error('[ChefInventory] Save error:', e.message);
        }
      }

      // Mark stock as deducted to prevent double deduction
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

// ══════════════════════════════════════════════════════════════════════════════
//  CHEF'S OWN INVENTORY
// ══════════════════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════════════════
//  INVENTORY (chef view)
// ══════════════════════════════════════════════════════════════════════════════

exports.getInventory = async (req, res) => {
  try {
    const branchId = req.user.branchId;
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