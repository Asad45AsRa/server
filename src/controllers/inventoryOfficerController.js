const { InventoryTransaction, InventoryRequest, Supplier, SupplierPayment } = require('../models/InventoryOfficer');
const Inventory     = require('../models/Inventory');
const User          = require('../models/User');
const { getMonthDateRange } = require('../utils/dateHelpers');
const ChefInventory = require('../models/Chefinventory');
const InventoryReturnRequest = require('../models/InventoryReturnRequest');

// ══════════════════════════════════════════════════════
//  PURCHASE MANAGEMENT
// ══════════════════════════════════════════════════════

exports.recordPurchase = async (req, res) => {
  try {
    const {
      itemId, quantity, pricePerUnit, supplier, paymentType,
      advanceAmount, creditAmount, paymentDueDate, invoiceNumber, notes
    } = req.body;

    const item = await Inventory.findById(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' });

    const totalCost = quantity * pricePerUnit;

    const transaction = await InventoryTransaction.create({
      itemId, type: 'purchase', quantity, unit: item.unit, pricePerUnit, totalCost,
      supplier, receivedBy: req.user._id, paymentType,
      advanceAmount: advanceAmount || 0, creditAmount: creditAmount || 0,
      paymentDueDate, invoiceNumber, notes, date: new Date()
    });

    item.currentStock += quantity;
    item.lastRestocked = new Date();
    item.totalPurchaseValue += totalCost;
    item.stockHistory.push({ date: new Date(), quantity, type: 'in', transactionId: transaction._id });
    item.calculateAverageCost();
    await item.save();

    if (supplier) {
      const supplierDoc = await Supplier.findOne({ name: supplier });
      if (supplierDoc) {
        supplierDoc.totalPurchaseValue = (supplierDoc.totalPurchaseValue || 0) + totalCost;
        if (paymentType === 'credit') supplierDoc.currentCredit += (creditAmount || totalCost);
        if (paymentType === 'advance') {
          const adv = advanceAmount || 0;
          if (supplierDoc.totalAdvancePaid >= adv) {
            supplierDoc.totalAdvancePaid -= adv;
          } else {
            supplierDoc.currentCredit += (adv - supplierDoc.totalAdvancePaid);
            supplierDoc.totalAdvancePaid = 0;
          }
        }
        await supplierDoc.save();
      }
    }

    res.status(201).json({ success: true, transaction, message: 'Purchase recorded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.createInventoryItem = async (req, res) => {
  try {
    const inventoryData = { ...req.body, branchId: req.user.branchId, lastRestocked: new Date() };
    const item = await Inventory.create(inventoryData);
    res.status(201).json({ success: true, item });
  } catch (error) {
    console.error('Create inventory error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPurchaseHistory = async (req, res) => {
  try {
    const { startDate, endDate, itemId, supplier } = req.query;
    let query = { type: 'purchase' };
    if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    if (itemId)   query.itemId   = itemId;
    if (supplier) query.supplier = supplier;

    const purchases = await InventoryTransaction.find(query)
      .populate('itemId', 'name unit')
      .populate('receivedBy', 'name')
      .sort({ date: -1 });

    const totalCost    = purchases.reduce((sum, p) => sum + (p.totalCost    || 0), 0);
    const totalAdvance = purchases.reduce((sum, p) => sum + (p.advanceAmount || 0), 0);
    const totalCredit  = purchases.reduce((sum, p) => sum + (p.creditAmount  || 0), 0);

    res.json({
      success: true, purchases,
      summary: { totalPurchases: purchases.length, totalCost, totalAdvance, totalCredit, totalPaid: totalCost - totalCredit }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  ISSUE MANAGEMENT
// ══════════════════════════════════════════════════════

exports.issueInventory = async (req, res) => {
  try {
    const { itemId, quantity, issuedTo, notes } = req.body;

    const item = await Inventory.findById(itemId);
    if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' });

    if (item.currentStock < quantity)
      return res.status(400).json({ success: false, message: 'Insufficient stock available' });

    const issueCost = quantity * (item.averageCost || item.pricePerUnit);

    const transaction = await InventoryTransaction.create({
      itemId, type: 'issue', quantity, unit: item.unit,
      pricePerUnit: item.averageCost || item.pricePerUnit,
      totalCost: issueCost, issuedTo, receivedBy: req.user._id, notes, date: new Date()
    });

    item.currentStock    -= quantity;
    item.totalIssueValue += issueCost;
    item.stockHistory.push({ date: new Date(), quantity, type: 'out', transactionId: transaction._id });
    await item.save();

    // ── Chef ki aaj ki ChefInventory bhi update karo ──────────────────────
    if (issuedTo) {
      const today    = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

      let chefRecord = await ChefInventory.findOne({
        chefId: issuedTo, status: 'active',
        date: { $gte: today, $lt: tomorrow }
      });

      const issuedItemData = {
        inventoryItemId: itemId, name: item.name, unit: item.unit,
        issuedQuantity: quantity, usedQuantity: 0, returnedQuantity: 0,
      };

      if (chefRecord) {
        const existing = chefRecord.items.find(i => i.inventoryItemId.toString() === itemId.toString());
        if (existing) { existing.issuedQuantity += quantity; }
        else          { chefRecord.items.push(issuedItemData); }
        await chefRecord.save();
      } else {
        await ChefInventory.create({
          chefId: issuedTo, branchId: req.user.branchId,
          items: [issuedItemData], issuedBy: req.user._id, notes,
        });
      }
    }

    res.status(201).json({ success: true, transaction, message: 'Inventory issued successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getIssueHistory = async (req, res) => {
  try {
    const { startDate, endDate, itemId, issuedTo } = req.query;
    let query = { type: 'issue' };
    if (startDate && endDate) query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    if (itemId)   query.itemId   = itemId;
    if (issuedTo) query.issuedTo = issuedTo;

    const issues = await InventoryTransaction.find(query)
      .populate('itemId',     'name unit')
      .populate('issuedTo',   'name role')
      .populate('receivedBy', 'name')
      .sort({ date: -1 });

    const totalCost = issues.reduce((sum, i) => sum + (i.totalCost || 0), 0);
    res.json({ success: true, issues, summary: { totalIssues: issues.length, totalCost } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  CHEF ISSUE (bulk daily issue)
// ══════════════════════════════════════════════════════

exports.issueInventoryToChef = async (req, res) => {
  try {
    const { chefId, items, notes } = req.body;

    if (!chefId || !items || items.length === 0)
      return res.status(400).json({ success: false, message: 'chefId and items required' });

    const issuedItems = [];

    for (const item of items) {
      const invItem = await Inventory.findById(item.inventoryItemId);
      if (!invItem)
        return res.status(404).json({ success: false, message: `Item ${item.inventoryItemId} not found` });
      if (invItem.currentStock < item.issuedQuantity)
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${invItem.name}. Available: ${invItem.currentStock} ${invItem.unit}`
        });

      invItem.currentStock    -= item.issuedQuantity;
      invItem.totalIssueValue += item.issuedQuantity * (invItem.averageCost || invItem.pricePerUnit);
      invItem.stockHistory.push({ date: new Date(), quantity: item.issuedQuantity, type: 'out' });
      await invItem.save();

      await InventoryTransaction.create({
        itemId: item.inventoryItemId, type: 'issue',
        quantity: item.issuedQuantity, unit: invItem.unit,
        pricePerUnit: invItem.averageCost || invItem.pricePerUnit,
        totalCost: item.issuedQuantity * (invItem.averageCost || invItem.pricePerUnit),
        issuedTo: chefId, receivedBy: req.user._id,
        notes: notes || 'Daily issue to chef', date: new Date()
      });

      issuedItems.push({
        inventoryItemId: item.inventoryItemId, name: invItem.name,
        unit: invItem.unit, issuedQuantity: item.issuedQuantity
      });
    }

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    let chefRecord = await ChefInventory.findOne({
      chefId, status: 'active', date: { $gte: today, $lt: tomorrow }
    });

    if (chefRecord) {
      for (const newItem of issuedItems) {
        const existing = chefRecord.items.find(
          i => i.inventoryItemId.toString() === newItem.inventoryItemId.toString()
        );
        if (existing) { existing.issuedQuantity += newItem.issuedQuantity; }
        else          { chefRecord.items.push({ ...newItem, usedQuantity: 0, returnedQuantity: 0 }); }
      }
      await chefRecord.save();
    } else {
      chefRecord = await ChefInventory.create({
        chefId, branchId: req.user.branchId,
        items: issuedItems.map(i => ({ ...i, usedQuantity: 0, returnedQuantity: 0 })),
        issuedBy: req.user._id, notes
      });
    }

    res.status(201).json({ success: true, chefInventory: chefRecord, message: 'Inventory issued to chef successfully' });
  } catch (error) {
    console.error('Issue to chef error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  RECEIVE CHEF RETURN
// ══════════════════════════════════════════════════════

exports.receiveChefReturn = async (req, res) => {
  try {
    const { chefInventoryId, returnedItems, notes } = req.body;

    const chefRecord = await ChefInventory.findById(chefInventoryId);
    if (!chefRecord)
      return res.status(404).json({ success: false, message: 'Chef inventory record not found' });
    if (chefRecord.status === 'returned')
      return res.status(400).json({ success: false, message: 'Already fully returned' });

    for (const ret of returnedItems) {
      const recordItem = chefRecord.items.find(
        i => i.inventoryItemId.toString() === ret.inventoryItemId.toString()
      );
      if (!recordItem) continue;

      const maxReturn = recordItem.issuedQuantity - recordItem.returnedQuantity;
      const toReturn  = Math.min(parseFloat(ret.returnedQuantity) || 0, maxReturn);
      if (toReturn <= 0) continue;

      const invItem = await Inventory.findById(ret.inventoryItemId);
      if (invItem) {
        invItem.currentStock += toReturn;
        invItem.stockHistory.push({ date: new Date(), quantity: toReturn, type: 'in' });
        await invItem.save();

        await InventoryTransaction.create({
          itemId: ret.inventoryItemId, type: 'return',
          quantity: toReturn, unit: invItem.unit,
          pricePerUnit: invItem.averageCost || invItem.pricePerUnit,
          totalCost: toReturn * (invItem.averageCost || invItem.pricePerUnit),
          receivedBy: req.user._id,
          notes: notes || 'Return from chef', date: new Date()
        });
      }

      recordItem.returnedQuantity += toReturn;
      if (ret.usedQuantity !== undefined) {
        recordItem.usedQuantity = parseFloat(ret.usedQuantity) || recordItem.usedQuantity;
      }
      recordItem.remainingQuantity =
        recordItem.issuedQuantity - recordItem.returnedQuantity - recordItem.usedQuantity;
    }

    const allDone = chefRecord.items.every(
      i => i.returnedQuantity + i.usedQuantity >= i.issuedQuantity
    );
    chefRecord.status = allDone ? 'returned' : 'partial_return';
    if (notes) chefRecord.notes = (chefRecord.notes || '') + ' | ' + notes;
    await chefRecord.save();

    res.json({ success: true, chefInventory: chefRecord, message: 'Return received & stock updated' });
  } catch (error) {
    console.error('Chef return error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  LOW STOCK
// ══════════════════════════════════════════════════════

exports.getLowStockItems = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const items = await Inventory.find({
      branchId, isActive: true,
      $expr: { $lte: ['$currentStock', '$minimumStock'] }
    }).sort({ name: 1 });

    res.json({ success: true, items, count: items.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getChefInventoryRecords = async (req, res) => {
  try {
    const { chefId, status, date } = req.query;
    const query = { branchId: req.user.branchId };
    if (chefId)  query.chefId = chefId;
    if (status)  query.status = status;
    if (date) {
      const d    = new Date(date); d.setHours(0, 0, 0, 0);
      const next = new Date(d);   next.setDate(next.getDate() + 1);
      query.date = { $gte: d, $lt: next };
    }

    const records = await ChefInventory.find(query)
      .populate('chefId',              'name')
      .populate('issuedBy',            'name')
      .populate('items.inventoryItemId', 'name unit')
      .sort({ date: -1 });

    res.json({ success: true, records, count: records.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  TOTAL STOCK
// ══════════════════════════════════════════════════════

exports.getTotalStock = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const ColdDrink = require('../models/Colddrink');

    const [inventory, coldDrinks] = await Promise.all([
      Inventory.find({ branchId, isActive: true }).sort({ category: 1, name: 1 }),
      ColdDrink.find({ branchId, isActive: true }).sort({ company: 1, name: 1 }),
    ]);

    const inventoryStock = inventory.map(item => ({
      _id: item._id, name: item.name, category: item.category, type: 'inventory',
      currentStock: item.currentStock, minimumStock: item.minimumStock, unit: item.unit,
      averageCost: item.averageCost || item.pricePerUnit || 0,
      stockValue:  item.currentStock * (item.averageCost || item.pricePerUnit || 0),
      isLow: item.currentStock > 0 && item.currentStock <= item.minimumStock,
      isOut: item.currentStock === 0,
    }));

    const coldDrinkStock = [];
    for (const drink of coldDrinks) {
      for (const size of drink.sizes) {
        coldDrinkStock.push({
          _id: `${drink._id}_${size._id}`, drinkId: drink._id, sizeId: size._id,
          name: `${drink.name} (${size.size})`, company: drink.company,
          category: 'Cold Drinks', type: 'cold_drink',
          currentStock: size.currentStock, minimumStock: size.minimumStock || 0,
          unit: 'pieces', averageCost: size.purchasePrice || 0, salePrice: size.salePrice || 0,
          stockValue: size.currentStock * (size.purchasePrice || 0),
          isLow: size.currentStock > 0 && size.currentStock <= (size.minimumStock || 0),
          isOut: size.currentStock === 0, expiryDate: size.expiryDate,
        });
      }
    }

    const allStock        = [...inventoryStock, ...coldDrinkStock];
    const totalValue      = allStock.reduce((s, i) => s + (i.stockValue || 0), 0);
    const lowStockCount   = allStock.filter(i => i.isLow).length;
    const outOfStockCount = allStock.filter(i => i.isOut).length;

    res.json({
      success: true, stock: allStock,
      summary: {
        totalItems: allStock.length, inventoryItems: inventoryStock.length,
        coldDrinkVariants: coldDrinkStock.length,
        totalValue, lowStockCount, outOfStockCount,
      }
    });
  } catch (error) {
    console.error('getTotalStock error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  REQUEST MANAGEMENT
// ══════════════════════════════════════════════════════

exports.createRequest = async (req, res) => {
  try {
    const { items, notes } = req.body;
    const request = await InventoryRequest.create({
      requestedBy: req.user._id, items, notes, status: 'pending'
    });
    res.status(201).json({ success: true, request, message: 'Inventory request created successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const requests = await InventoryRequest.find(query)
      .populate('requestedBy', 'name role')
      .populate('approvedBy',  'name')
      .populate('issuedBy',    'name')
      .populate('items.inventoryItemId', 'name unit currentStock')
      .sort({ requestDate: -1 });

    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveRequest = async (req, res) => {
  try {
    const request = await InventoryRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedBy: req.user._id, approvedDate: new Date() },
      { new: true }
    );
    res.json({ success: true, request, message: 'Request approved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const request = await InventoryRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', approvedBy: req.user._id, approvedDate: new Date(), rejectionReason },
      { new: true }
    );
    res.json({ success: true, request, message: 'Request rejected' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  ISSUE APPROVED REQUEST  ← MAIN FIX
//  Ab ye ChefInventory bhi create/update karta hai
//  taake chef apni issued inventory dekh sake
// ══════════════════════════════════════════════════════

exports.issueApprovedRequest = async (req, res) => {
  try {
    const request = await InventoryRequest.findById(req.params.id)
      .populate('items.inventoryItemId')
      .populate('requestedBy', 'name role branchId');

    if (!request)
      return res.status(404).json({ success: false, message: 'Request not found' });
    if (request.status !== 'approved')
      return res.status(400).json({ success: false, message: 'Only approved requests can be issued' });

    const issuedTransactions = [];
    const issuedItemsForChef = [];   // ChefInventory ke liye

    for (const reqItem of request.items) {
      const invItem = await Inventory.findById(reqItem.inventoryItemId);
      if (!invItem) continue;

      const qtyToIssue = reqItem.requestedQuantity;

      if (invItem.currentStock < qtyToIssue) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${invItem.name}. Available: ${invItem.currentStock} ${invItem.unit}`
        });
      }

      const issueCost = qtyToIssue * (invItem.averageCost || invItem.pricePerUnit || 0);

      const transaction = await InventoryTransaction.create({
        itemId: invItem._id, type: 'issue',
        quantity: qtyToIssue, unit: invItem.unit,
        pricePerUnit: invItem.averageCost || invItem.pricePerUnit || 0,
        totalCost: issueCost,
        issuedTo:   request.requestedBy._id,
        receivedBy: req.user._id,
        notes:  `Issued against request ID: ${request._id}`,
        date:   new Date()
      });

      invItem.currentStock     -= qtyToIssue;
      invItem.totalIssueValue   = (invItem.totalIssueValue || 0) + issueCost;
      invItem.stockHistory.push({ date: new Date(), quantity: qtyToIssue, type: 'out', transactionId: transaction._id });
      await invItem.save();

      issuedTransactions.push(transaction);

      // ✅ ChefInventory ke liye list tayyar karo
      issuedItemsForChef.push({
        inventoryItemId: invItem._id,
        name:            invItem.name,
        unit:            invItem.unit,
        issuedQuantity:  qtyToIssue,
        usedQuantity:    0,
        returnedQuantity: 0,
      });
    }

    // ✅ Chef ki aaj ki ChefInventory create/update karo
    // Taake chef mobile app mein dekh sake
    const chefId   = request.requestedBy._id;
    const branchId = request.requestedBy.branchId || req.user.branchId;

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    let chefRecord = await ChefInventory.findOne({
      chefId, status: 'active',
      date: { $gte: today, $lt: tomorrow }
    });

    if (chefRecord) {
      // Existing record mein add/update karo
      for (const newItem of issuedItemsForChef) {
        const existing = chefRecord.items.find(
          i => i.inventoryItemId.toString() === newItem.inventoryItemId.toString()
        );
        if (existing) { existing.issuedQuantity += newItem.issuedQuantity; }
        else          { chefRecord.items.push(newItem); }
      }
      await chefRecord.save();
    } else {
      // Naya record banao
      chefRecord = await ChefInventory.create({
        chefId, branchId,
        items:    issuedItemsForChef,
        issuedBy: req.user._id,
        notes:    `Issued via request ${request._id}`,
        status:   'active',
      });
    }

    // Request ko issued mark karo
    request.status     = 'issued';
    request.issuedBy   = req.user._id;
    request.issuedDate = new Date();
    await request.save();

    res.json({
      success: true, request, issuedTransactions,
      chefInventory: chefRecord,
      message: 'Request issued successfully — chef ki inventory update ho gayi'
    });
  } catch (error) {
    console.error('issueApprovedRequest error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  SUPPLIER MANAGEMENT
// ══════════════════════════════════════════════════════

exports.createSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.create(req.body);
    res.status(201).json({ success: true, supplier });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find().sort({ name: 1 });
    res.json({ success: true, suppliers });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, supplier });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSupplierDetail = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    const payments = await SupplierPayment.find({ supplierId: req.params.id })
      .populate('recordedBy', 'name').sort({ date: -1 });

    const totalCreditPayments  = payments.filter(p => p.paymentType === 'credit_payment').reduce((s, p) => s + p.amount, 0);
    const totalAdvancePayments = payments.filter(p => p.paymentType === 'advance_payment').reduce((s, p) => s + p.amount, 0);
    const totalAdvanceRefunds  = payments.filter(p => p.paymentType === 'advance_refund').reduce((s, p) => s + p.amount, 0);

    res.json({
      success: true, supplier, payments,
      summary: {
        currentCredit:      supplier.currentCredit,
        totalAdvancePaid:   supplier.totalAdvancePaid,
        netBalance:         supplier.currentCredit - supplier.totalAdvancePaid,
        totalCreditPayments, totalAdvancePayments, totalAdvanceRefunds,
        totalPurchaseValue: supplier.totalPurchaseValue || 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.recordSupplierPayment = async (req, res) => {
  try {
    const { supplierId, paymentType, amount, notes } = req.body;
    const supplier = await Supplier.findById(supplierId);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    const parsedAmount = parseFloat(amount);
    if (parsedAmount <= 0)
      return res.status(400).json({ success: false, message: 'Amount must be positive' });

    const creditBefore  = supplier.currentCredit;
    const advanceBefore = supplier.totalAdvancePaid;

    if (paymentType === 'credit_payment') {
      if (parsedAmount > supplier.currentCredit)
        return res.status(400).json({ success: false, message: `Cannot pay more than outstanding credit (${supplier.currentCredit})` });
      supplier.currentCredit       -= parsedAmount;
      supplier.totalCreditCleared   = (supplier.totalCreditCleared || 0) + parsedAmount;
    } else if (paymentType === 'advance_payment') {
      supplier.totalAdvancePaid += parsedAmount;
    } else if (paymentType === 'advance_refund') {
      if (parsedAmount > supplier.totalAdvancePaid)
        return res.status(400).json({ success: false, message: `Cannot refund more than advance paid (${supplier.totalAdvancePaid})` });
      supplier.totalAdvancePaid -= parsedAmount;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment type' });
    }

    await supplier.save();

    const payment = await SupplierPayment.create({
      supplierId, supplierName: supplier.name, paymentType,
      amount: parsedAmount, notes, recordedBy: req.user._id,
      creditBeforePayment:  creditBefore,  advanceBeforePayment: advanceBefore,
      creditAfterPayment:   supplier.currentCredit, advanceAfterPayment: supplier.totalAdvancePaid
    });

    res.status(201).json({ success: true, payment, supplier, message: 'Payment recorded successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSupplierPayments = async (req, res) => {
  try {
    const payments = await SupplierPayment.find({ supplierId: req.params.id })
      .populate('recordedBy', 'name').sort({ date: -1 });
    res.json({ success: true, payments, count: payments.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  REPORTS
// ══════════════════════════════════════════════════════

exports.getInventoryReport = async (req, res) => {
  try {
    const { month, year } = req.query;
    const branchId = req.user.branchId;
    const { startDate, endDate } = getMonthDateRange(month, year);

    const purchases = await InventoryTransaction.find({ type: 'purchase', date: { $gte: startDate, $lte: endDate } });
    const totalPurchaseCost = purchases.reduce((sum, p) => sum + (p.totalCost || 0), 0);

    const issues = await InventoryTransaction.find({ type: 'issue', date: { $gte: startDate, $lte: endDate } });
    const totalIssueCost = issues.reduce((sum, i) => sum + (i.totalCost || 0), 0);

    const inventory = await Inventory.find({ branchId });
    const currentStockValue = inventory.reduce(
      (sum, item) => sum + (item.currentStock * (item.averageCost || item.pricePerUnit)), 0
    );

    const lowStockItems  = inventory.filter(i => i.currentStock <= i.minimumStock);
    const cashPayments   = purchases.filter(p => p.paymentType === 'cash').reduce((s, p) => s + (p.totalCost   || 0), 0);
    const creditPayments = purchases.filter(p => p.paymentType === 'credit').reduce((s, p) => s + (p.creditAmount || 0), 0);
    const advancePayments= purchases.filter(p => p.paymentType === 'advance').reduce((s, p) => s + (p.advanceAmount|| 0), 0);

    res.json({
      success: true,
      report: {
        period: { month, year, startDate, endDate },
        purchases: { total: purchases.length, totalCost: totalPurchaseCost, cashPayments, creditPayments, advancePayments },
        issues: { total: issues.length, totalCost: totalIssueCost },
        currentStock: {
          totalValue: currentStockValue, items: inventory.length,
          lowStockCount: lowStockItems.length,
          lowStockItems: lowStockItems.map(i => ({
            _id: i._id, name: i.name, currentStock: i.currentStock, minimumStock: i.minimumStock, unit: i.unit
          }))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getCostAnalysis = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const inventory = await Inventory.find({ branchId });

    const analysis = inventory.map(item => ({
      itemName:           item.name, currentStock: item.currentStock, unit: item.unit,
      averageCost:        item.averageCost,
      currentValue:       item.currentStock * item.averageCost,
      totalPurchaseValue: item.totalPurchaseValue,
      totalIssueValue:    item.totalIssueValue
    }));

    const totalInventoryValue = analysis.reduce((sum, a) => sum + a.currentValue, 0);
    res.json({ success: true, analysis, summary: { totalItems: analysis.length, totalInventoryValue } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ══════════════════════════════════════════════════════
//  RETURN REQUEST MANAGEMENT (chef ki requests)
// ══════════════════════════════════════════════════════

exports.getPendingReturnRequests = async (req, res) => {
  try {
    const requests = await InventoryReturnRequest.find({
      branchId: req.user.branchId, status: 'pending'
    })
      .populate('chefId',         'name')
      .populate('chefInventoryId','date')
      .populate('items.inventoryItemId', 'name unit currentStock')
      .sort({ createdAt: -1 });

    res.json({ success: true, requests, count: requests.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.approveReturnRequest = async (req, res) => {
  try {
    const returnReq = await InventoryReturnRequest.findById(req.params.id);
    if (!returnReq || returnReq.status !== 'pending')
      return res.status(400).json({ success: false, message: 'Request nahi mili ya already reviewed hai' });

    const chefRecord = await ChefInventory.findById(returnReq.chefInventoryId);
    if (!chefRecord)
      return res.status(404).json({ success: false, message: 'Chef inventory record nahi mila' });

    for (const ret of returnReq.items) {
      const chefItem = chefRecord.items.find(
        i => i.inventoryItemId.toString() === ret.inventoryItemId.toString()
      );
      if (!chefItem) continue;

      const maxReturnable = chefItem.issuedQuantity - chefItem.usedQuantity - chefItem.returnedQuantity;
      const actualReturn  = Math.min(parseFloat(ret.returnQuantity), maxReturnable);
      if (actualReturn <= 0) continue;

      chefItem.returnedQuantity += actualReturn;

      await Inventory.findByIdAndUpdate(ret.inventoryItemId, {
        $inc:  { currentStock: actualReturn },
        $push: { stockHistory: { date: new Date(), quantity: actualReturn, type: 'in' } }
      });

      await InventoryTransaction.create({
        itemId: ret.inventoryItemId, type: 'return',
        quantity: actualReturn, unit: ret.unit || chefItem.unit,
        issuedTo:   returnReq.chefId,
        receivedBy: req.user._id,
        notes: `Chef return — officer approved. Request ID: ${returnReq._id}`,
        date: new Date()
      });
    }

    const allDone = chefRecord.items.every(
      i => i.usedQuantity + i.returnedQuantity >= i.issuedQuantity
    );
    chefRecord.status = allDone ? 'returned' : 'partial_return';
    if (allDone) chefRecord.returnedAt = new Date();
    await chefRecord.save();

    returnReq.status     = 'approved';
    returnReq.reviewedBy = req.user._id;
    returnReq.reviewedAt = new Date();
    await returnReq.save();

    res.json({ success: true, message: 'Return approved aur stock update ho gaya' });
  } catch (error) {
    console.error('approveReturnRequest error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.rejectReturnRequest = async (req, res) => {
  try {
    const { reason } = req.body;
    const returnReq = await InventoryReturnRequest.findByIdAndUpdate(
      req.params.id,
      {
        status: 'rejected',
        rejectionReason: reason || 'No reason provided',
        reviewedBy: req.user._id,
        reviewedAt: new Date()
      },
      { new: true }
    );
    if (!returnReq)
      return res.status(404).json({ success: false, message: 'Request nahi mili' });

    res.json({ success: true, message: 'Return request reject kar di gayi', returnReq });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;