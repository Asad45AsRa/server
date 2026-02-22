const Inventory = require('../models/Inventory');
const Product = require('../models/Product');

// ── Helper: branchId resolve karo ─────────────────────────────────────────────
const resolveBranchId = (req) => {
  if (req.user.role === 'admin') {
    return req.query.branchId || null;
  }
  return req.user.branchId || null;
};

// ── GET ALL INVENTORY ─────────────────────────────────────────────────────────
exports.getAllInventory = async (req, res) => {
  try {
    const { category } = req.query;
    const branchId = resolveBranchId(req);

    let query = { isActive: true };
    if (branchId) query.branchId = branchId;
    if (category) query.category = category;

    const inventory = await Inventory.find(query)
      .populate('branchId', 'name')
      .sort({ name: 1 });

    const totalValue = inventory.reduce(
      (sum, i) => sum + (i.currentStock * (i.averageCost || i.pricePerUnit || 0)), 0
    );
    const lowStockCount = inventory.filter(i => i.currentStock <= i.minimumStock).length;

    res.json({
      success: true,
      inventory,
      count: inventory.length,
      statistics: { totalItems: inventory.length, totalValue, lowStockCount }
    });
  } catch (error) {
    console.error('getAllInventory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── CREATE INVENTORY ITEM ─────────────────────────────────────────────────────
exports.createInventoryItem = async (req, res) => {
  try {
    const inventoryData = {
      ...req.body,
      branchId: req.body.branchId || req.user.branchId,
      lastRestocked: new Date()
    };
    const item = await Inventory.create(inventoryData);
    res.status(201).json({ success: true, item });
  } catch (error) {
    console.error('createInventoryItem error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── UPDATE INVENTORY ITEM ─────────────────────────────────────────────────────
exports.updateInventoryItem = async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── RESTOCK ───────────────────────────────────────────────────────────────────
exports.restockInventory = async (req, res) => {
  try {
    const { quantity, pricePerUnit } = req.body;
    const item = await Inventory.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    item.currentStock += parseFloat(quantity) || 0;
    if (pricePerUnit) item.pricePerUnit = pricePerUnit;
    item.lastRestocked = new Date();
    await item.save();

    res.json({ success: true, item, message: 'Inventory restocked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── LOW STOCK ITEMS ───────────────────────────────────────────────────────────
// ✅ BUG FIX: "this.minimumStock" galat tha — MongoDB $expr use karo
exports.getLowStockItems = async (req, res) => {
  try {
    const branchId = resolveBranchId(req);

    const query = {
      isActive: true,
      $expr: { $lte: ['$currentStock', '$minimumStock'] }
    };
    if (branchId) query.branchId = branchId;

    const items = await Inventory.find(query).sort({ name: 1 });
    res.json({ success: true, items, count: items.length });
  } catch (error) {
    console.error('getLowStockItems error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── ASSIGN TO CHEF ────────────────────────────────────────────────────────────
exports.assignInventoryToChef = async (req, res) => {
  try {
    const { chefId, items } = req.body;

    for (const item of items) {
      await Inventory.findByIdAndUpdate(
        item.inventoryItemId,
        { $inc: { currentStock: -item.quantity } }
      );
    }

    res.json({
      success: true,
      message: 'Inventory assigned to chef successfully',
      chefId,
      items
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;