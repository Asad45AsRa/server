const ColdDrink = require('../models/Colddrink');

// ── GET all (inventory officer / admin) ──────────────────────────────────
exports.getAllColdDrinks = async (req, res) => {
  try {
    const drinks = await ColdDrink.find({ branchId: req.user.branchId })
      .sort({ company: 1, name: 1 });
    res.json({ success: true, coldDrinks: drinks, count: drinks.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── CREATE new cold drink ─────────────────────────────────────────────────
exports.createColdDrink = async (req, res) => {
  try {
    const drink = await ColdDrink.create({
      ...req.body,
      branchId: req.user.branchId,
    });
    res.status(201).json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── UPDATE cold drink (name, company, notes, isActive) ──────────────────
exports.updateColdDrink = async (req, res) => {
  try {
    const drink = await ColdDrink.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── DELETE cold drink ────────────────────────────────────────────────────
exports.deleteColdDrink = async (req, res) => {
  try {
    await ColdDrink.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── ADD a new size to existing drink ─────────────────────────────────────
exports.addSize = async (req, res) => {
  try {
    // req.body: { size, purchasePrice, salePrice, currentStock, minimumStock, expiryDate }
    const drink = await ColdDrink.findById(req.params.id);
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });

    // Prevent duplicate size
    const exists = drink.sizes.find(s => s.size === req.body.size);
    if (exists) return res.status(400).json({ success: false, message: 'This size already exists for this drink' });

    drink.sizes.push(req.body);
    await drink.save();
    res.status(201).json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── UPDATE a specific size ────────────────────────────────────────────────
exports.updateSize = async (req, res) => {
  try {
    const drink = await ColdDrink.findById(req.params.id);
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });

    const variant = drink.sizes.id(req.params.sizeId);
    if (!variant) return res.status(404).json({ success: false, message: 'Size not found' });

    Object.assign(variant, req.body);
    await drink.save();
    res.json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── RESTOCK a specific size ───────────────────────────────────────────────
exports.restockSize = async (req, res) => {
  try {
    const { quantity, purchasePrice, expiryDate } = req.body;
    const drink = await ColdDrink.findById(req.params.id);
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });

    const variant = drink.sizes.id(req.params.sizeId);
    if (!variant) return res.status(404).json({ success: false, message: 'Size not found' });

    variant.currentStock += parseInt(quantity) || 0;
    if (purchasePrice)  variant.purchasePrice = parseFloat(purchasePrice);
    if (expiryDate)     variant.expiryDate    = new Date(expiryDate);

    await drink.save();
    res.json({ success: true, coldDrink: drink, message: `Restocked +${quantity}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── DELETE a size ─────────────────────────────────────────────────────────
exports.deleteSize = async (req, res) => {
  try {
    const drink = await ColdDrink.findById(req.params.id);
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });

    drink.sizes = drink.sizes.filter(s => s._id.toString() !== req.params.sizeId);
    await drink.save();
    res.json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── GET all (for mobile API — public-style, used by mobile app) ───────────
// Mobile app will call this to build its own menu
exports.getColdDrinksForMobile = async (req, res) => {
  try {
    const branchId = req.query.branchId || req.user?.branchId;
    const now = new Date();

    const drinks = await ColdDrink.find({ branchId, isActive: true }).sort({ company: 1, name: 1 });

    // Flatten to mobile-friendly format: one entry per drink with its sizes
    const result = drinks.map(d => ({
      _id:     d._id,
      name:    d.name,
      company: d.company,
      sizes: d.sizes
        .filter(s => s.currentStock > 0 && (!s.expiryDate || new Date(s.expiryDate) > now))
        .map(s => ({
          _id:       s._id,
          size:      s.size,
          salePrice: s.salePrice,
          stock:     s.currentStock,
        })),
    })).filter(d => d.sizes.length > 0); // only drinks with at least one available size

    res.json({ success: true, coldDrinks: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = exports;