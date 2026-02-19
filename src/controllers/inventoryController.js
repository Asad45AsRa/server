const Inventory = require('../models/Inventory');
const Product = require('../models/Product');

exports.getAllInventory = async (req, res) => {
  try {
    const { branchId, category } = req.query;
    let query = { isActive: true };
    
    // If user has branchId, filter by it
    if (req.user.branchId) {
      query.branchId = req.user.branchId;
    } else if (branchId) {
      query.branchId = branchId;
    }
    
    if (category) query.category = category;

    const inventory = await Inventory.find(query).sort({ name: 1 });
    
    res.json({ 
      success: true, 
      inventory,
      count: inventory.length 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateInventoryItem = async (req, res) => {
  try {
    const item = await Inventory.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json({ success: true, item });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.restockInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, pricePerUnit } = req.body;

    const item = await Inventory.findById(id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    item.currentStock += quantity;
    if (pricePerUnit) item.pricePerUnit = pricePerUnit;
    item.lastRestocked = new Date();

    await item.save();

    res.json({ success: true, item, message: 'Inventory restocked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getLowStockItems = async (req, res) => {
  try {
    const { branchId } = req.query;
    const query = { 
      branchId: branchId || req.user.branchId, 
      isActive: true 
    };

    const items = await Inventory.find(query).where('currentStock').lte(this.minimumStock);
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

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