const Order = require('../models/Order');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Inventory = require('../models/Inventory');
const ColdDrink = require('../models/Colddrink'); // ✅ ColdDrink model
const Table = require('../models/Table');
const { generateOrderNumber, calculateTotalTime, calculateOrderTotal } = require('../utils/helpers');

// ========== MENU ==========

exports.getMenu = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    // Get all AVAILABLE products from THIS branch
    const products = await Product.find({
      branchId,
      isAvailable: true
    })
      .populate('sizes.ingredients.inventoryItemId', 'name currentStock unit')
      .lean();

    // Get all ACTIVE deals from THIS branch
    const deals = await Deal.find({
      branchId,
      isActive: true,
      validFrom: { $lte: new Date() },
      validUntil: { $gte: new Date() }
    })
      .populate('products.productId', 'name image')
      .lean();

    // ✅ Get cold drinks from ColdDrink model (with sizes)
    const now = new Date();
    const rawColdDrinks = await ColdDrink.find({
      branchId,
      isActive: true,
    }).lean();

    // Normalize to menu-friendly format (sizes with salePrice -> price)
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
            price: s.salePrice, // ✅ map salePrice -> price for frontend
            currentStock: s.currentStock,
          })),
      }))
      .filter(d => d.sizes.length > 0);

    console.log(`📋 Menu fetched for branch ${branchId}:`, {
      products: products.length,
      deals: deals.length,
      coldDrinks: coldDrinks.length
    });

    res.json({
      success: true,
      menu: {
        products,
        deals,
        coldDrinks
      },
      counts: {
        products: products.length,
        deals: deals.length,
        coldDrinks: coldDrinks.length
      }
    });
  } catch (error) {
    console.error('Get menu error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== TABLES ==========

exports.getTables = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { floor } = req.query;

    const query = { branchId, isActive: true };
    if (floor) {
      query.floor = floor;
    }

    const tables = await Table.find(query)
      .populate({
        path: 'currentOrderId',
        select: 'orderNumber total status items createdAt',
        populate: {
          path: 'waiterId',
          select: 'name'
        }
      })
      .sort({ floor: 1, tableNumber: 1 })
      .lean();

    // Group by floor
    const groupedTables = {
      ground_floor: [],
      first_floor: [],
      second_floor: [],
      outdoor: []
    };

    tables.forEach(table => {
      if (groupedTables[table.floor]) {
        groupedTables[table.floor].push(table);
      }
    });

    console.log(`🪑 Tables fetched for branch ${branchId}:`, tables.length);

    res.json({
      success: true,
      tables,
      groupedTables,
      count: tables.length
    });
  } catch (error) {
    console.error('Get tables error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREATE ORDER ==========

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
      notes
    } = req.body;

    console.log('📝 Creating order:', {
      orderType,
      tableNumber,
      floor,
      itemsCount: items ? items.length : 0,
      branchId: req.user.branchId
    });

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order must have at least one item'
      });
    }

    const processedItems = items.map(item => {
      let itemType = 'Product';
      if (item.type === 'cold_drink') itemType = 'Inventory';
      else if (item.type === 'deal') itemType = 'Deal';
      return { ...item, itemType: item.itemType || itemType };
    });

    if (orderType === 'dine_in' && (!tableNumber || !floor)) {
      return res.status(400).json({
        success: false,
        message: 'Table number and floor are required for dine-in orders'
      });
    }

    // Inventory checks
    for (const item of processedItems) {
      if (item.type === 'product') {
        const product = await Product.findById(item.itemId).populate('sizes.ingredients.inventoryItemId');
        if (!product) {
          return res.status(404).json({ success: false, message: `Product not found: ${item.itemId}` });
        }
        const sizeData = product.sizes.find(s => s.size === item.size);
        if (!sizeData) {
          return res.status(400).json({ success: false, message: `Size ${item.size} not found for ${product.name}` });
        }
        if (sizeData.ingredients && sizeData.ingredients.length > 0) {
          for (const ingredient of sizeData.ingredients) {
            const inventory = await Inventory.findById(ingredient.inventoryItemId);
            const requiredQty = ingredient.quantity * item.quantity;
            if (inventory.currentStock < requiredQty) {
              return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name} (${inventory.name})` });
            }
          }
        }
      } else if (item.type === 'cold_drink') {
        // ✅ Check ColdDrink stock using size's _id stored in itemId
        // itemId for cold_drink = the size subdocument _id
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
      }
    }

    const { subtotal, tax, total } = calculateOrderTotal(processedItems, 0, 5);
    const estimatedTime = calculateTotalTime(processedItems);

    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      branchId: req.user.branchId,
      orderType,
      tableNumber: orderType === 'dine_in' ? tableNumber : null,
      floor: orderType === 'dine_in' ? floor : null,
      items: processedItems,
      subtotal,
      tax,
      total,
      estimatedTime,
      waiterId: req.user._id,
      customerName,
      customerPhone,
      deliveryAddress,
      notes,
      status: 'pending'
    });

    // AUTO-CREATE / OCCUPY TABLE
    if (orderType === 'dine_in') {
      console.log('🔍 AUTO-CREATE: Looking for table...');

      let table = await Table.findOne({
        branchId: req.user.branchId,
        tableNumber: tableNumber,
        floor: floor
      });

      if (!table) {
        console.log('⚠️ AUTO-CREATE: Table not found, creating new table...');
        table = await Table.create({
          tableNumber: tableNumber,
          capacity: 4,
          floor: floor,
          branchId: req.user.branchId,
          isActive: true,
          isOccupied: false
        });
        console.log('✅ AUTO-CREATE: New table created!', table.tableNumber);
      }

      if (table.isOccupied) {
        await Order.findByIdAndDelete(order._id);
        return res.status(400).json({ success: false, message: `Table ${tableNumber} is already occupied` });
      }

      table.isOccupied = true;
      table.currentOrderId = order._id;
      await table.save();
      console.log('✅ AUTO-CREATE: Table marked as occupied');
    }

    const populatedOrder = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('items.itemId', 'name image');

    console.log('✅ Order created successfully!');

    res.status(201).json({
      success: true,
      order: populatedOrder,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('❌ Create order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MY ORDERS ==========

// ✅ FIX: Ab last 24 ghante ke SAARE orders return karo (completed/cancelled bhi)
// Pehle completed/cancelled filter ho jaate the, jis se OrderDetails mein
// "Order not found" error aata tha jab order complete/cancel ho jaata tha.
exports.getMyOrders = async (req, res) => {
  try {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      waiterId: req.user._id,
      createdAt: { $gte: last24Hours }
    })
      .populate('chefId', 'name')
      .populate('items.itemId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📋 Waiter orders fetched:`, orders.length);

    res.json({
      success: true,
      orders,
      count: orders.length
    });
  } catch (error) {
    console.error('Get my orders error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE ORDER ==========

exports.updateOrder = async (req, res) => {
  try {
    // ✅ orderId req.params.id se aata hai (route: PUT /orders/:id)
    const orderId = req.params.id;
    const { items, notes } = req.body;

    console.log('✏️ Updating order:', orderId);

    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Sirf apna order update kar sakta hai waiter
    if (order.waiterId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this order' });
    }

    // Can only update pending orders
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update order after chef acceptance'
      });
    }

    // Update items if provided
    if (items && items.length > 0) {
      // ✅ FIX: itemType ensure karo — yeh Order model mein required field hai
      const processedItems = items.map(item => {
        let itemType = item.itemType;
        if (!itemType) {
          if (item.type === 'cold_drink') itemType = 'Inventory';
          else if (item.type === 'deal')  itemType = 'Deal';
          else                             itemType = 'Product';
        }
        return { ...item, itemType };
      });

      const { subtotal, tax, total } = calculateOrderTotal(processedItems, order.discount, 5);
      order.items = processedItems;
      order.subtotal = subtotal;
      order.tax = tax;
      order.total = total;
      order.estimatedTime = calculateTotalTime(processedItems);
    } else if (items && items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must have at least one item' });
    }

    // Update notes if provided
    if (notes !== undefined) order.notes = notes;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('waiterId', 'name')
      .populate('items.itemId', 'name');

    res.json({
      success: true,
      order: populatedOrder,
      message: 'Order updated successfully'
    });
  } catch (error) {
    console.error('Update order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== DELETE ORDER ==========

exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Sirf apna order cancel kar sakta hai waiter
    if (order.waiterId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to cancel this order' });
    }

    // Can only delete pending orders
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete order after chef acceptance'
      });
    }

    // Cancel order
    order.status = 'cancelled';
    await order.save();

    // Free up table if dine-in
    if (order.tableNumber) {
      await Table.findOneAndUpdate(
        { branchId: req.user.branchId, tableNumber: order.tableNumber, floor: order.floor },
        { isOccupied: false, currentOrderId: null }
      );
    }

    res.json({
      success: true,
      message: 'Order cancelled successfully'
    });
  } catch (error) {
    console.error('Delete order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;