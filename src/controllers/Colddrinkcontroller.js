const ColdDrink = require('../models/Colddrink');

// ── Helper: branchId resolve karo (admin ke pass branchId nahi hota) ─────────
const resolveBranchId = (req) => {
  if (req.user.role === 'admin') {
    // Admin: query param se lo, warna sab branches
    return req.query.branchId || null;
  }
  return req.user.branchId || null;
};

// ── GET all ───────────────────────────────────────────────────────────────────
exports.getAllColdDrinks = async (req, res) => {
  try {
    const branchId = resolveBranchId(req);

    // ✅ FIX: branchId null ho (admin, no filter) toh sab aaye
    const query = branchId ? { branchId } : {};

    const drinks = await ColdDrink.find(query).sort({ company: 1, name: 1 });
    res.json({ success: true, coldDrinks: drinks, count: drinks.length });
  } catch (e) {
    console.error('getAllColdDrinks error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── CREATE ────────────────────────────────────────────────────────────────────
exports.createColdDrink = async (req, res) => {
  try {
    const drink = await ColdDrink.create({
      ...req.body,
      branchId: req.user.branchId,
    });
    res.status(201).json({ success: true, coldDrink: drink });
  } catch (e) {
    console.error('createColdDrink error:', e);
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────
exports.updateColdDrink = async (req, res) => {
  try {
    const drink = await ColdDrink.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
exports.deleteColdDrink = async (req, res) => {
  try {
    await ColdDrink.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── ADD SIZE ──────────────────────────────────────────────────────────────────
exports.addSize = async (req, res) => {
  try {
    const drink = await ColdDrink.findById(req.params.id);
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });

    const exists = drink.sizes.find(s => s.size === req.body.size);
    if (exists) return res.status(400).json({ success: false, message: 'This size already exists' });

    drink.sizes.push(req.body);
    await drink.save();
    res.status(201).json({ success: true, coldDrink: drink });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── UPDATE SIZE ───────────────────────────────────────────────────────────────
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

// ── RESTOCK SIZE ──────────────────────────────────────────────────────────────
exports.restockSize = async (req, res) => {
  try {
    const { quantity, purchasePrice, expiryDate } = req.body;
    const drink = await ColdDrink.findById(req.params.id);
    if (!drink) return res.status(404).json({ success: false, message: 'Not found' });

    const variant = drink.sizes.id(req.params.sizeId);
    if (!variant) return res.status(404).json({ success: false, message: 'Size not found' });

    variant.currentStock += parseInt(quantity) || 0;
    if (purchasePrice) variant.purchasePrice = parseFloat(purchasePrice);
    if (expiryDate)    variant.expiryDate    = new Date(expiryDate);

    await drink.save();
    res.json({ success: true, coldDrink: drink, message: `Restocked +${quantity}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ── DELETE SIZE ───────────────────────────────────────────────────────────────
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

// ── MOBILE API ────────────────────────────────────────────────────────────────
exports.getColdDrinksForMobile = async (req, res) => {
  try {
    const branchId = req.query.branchId || req.user?.branchId;
    const now = new Date();

    const query = branchId ? { branchId, isActive: true } : { isActive: true };
    const drinks = await ColdDrink.find(query).sort({ company: 1, name: 1 });

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
    })).filter(d => d.sizes.length > 0);

    res.json({ success: true, coldDrinks: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = exports;