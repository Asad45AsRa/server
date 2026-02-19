const Order = require('../models/Order');
const Product = require('../models/Product');
const Deal = require('../models/Deal');
const Inventory = require('../models/Inventory');
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

    // Get all COLD DRINKS from inventory
    const coldDrinks = await Inventory.find({ 
      branchId, 
      category: 'cold_drinks',
      isActive: true,
      currentStock: { $gt: 0 }
    }).lean();

    console.log(`📋 Menu fetched for delivery (branch ${branchId}):`, {
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

// ========== CREATE DELIVERY ORDER ==========

exports.createDeliveryOrder = async (req, res) => {
  try {
    const { items, customerName, customerPhone, deliveryAddress, notes } = req.body;

    console.log('🚚 Creating delivery order:', {
      itemsCount: items.length,
      branchId: req.user.branchId,
      deliveryBoy: req.user.name
    });

    // Validate required fields
    if (!customerName || !customerPhone || !deliveryAddress) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer name, phone, and delivery address are required' 
      });
    }

    // Validate items
    if (!items || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order must have at least one item' 
      });
    }

    // Check inventory availability
    for (const item of items) {
      if (item.type === 'product') {
        const product = await Product.findById(item.itemId)
          .populate('sizes.ingredients.inventoryItemId');
        
        if (!product) {
          return res.status(404).json({ 
            success: false, 
            message: 'Product not found' 
          });
        }

        const sizeData = product.sizes.find(s => s.size === item.size);
        
        if (sizeData && sizeData.ingredients) {
          for (const ingredient of sizeData.ingredients) {
            const inventory = await Inventory.findById(ingredient.inventoryItemId);
            const requiredQty = ingredient.quantity * item.quantity;
            
            if (inventory.currentStock < requiredQty) {
              return res.status(400).json({ 
                success: false, 
                message: `Insufficient stock for ${product.name}` 
              });
            }
          }
        }
      } 
      else if (item.type === 'cold_drink') {
        const coldDrink = await Inventory.findById(item.itemId);
        
        if (!coldDrink || coldDrink.currentStock < item.quantity) {
          return res.status(400).json({ 
            success: false, 
            message: 'Insufficient stock for cold drink' 
          });
        }
      }
    }

    // Calculate totals
    const { subtotal, tax, total } = calculateOrderTotal(items, 0, 5);
    const estimatedTime = calculateTotalTime(items) + 20; // Add 20 min for delivery

    // Create order
    const order = await Order.create({
      orderNumber: generateOrderNumber(),
      branchId: req.user.branchId,
      orderType: 'delivery',
      items,
      subtotal,
      tax,
      total,
      estimatedTime,
      deliveryBoyId: req.user._id,
      customerName,
      customerPhone,
      deliveryAddress,
      notes,
      status: 'pending'
    });

    // Populate order
    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name phone')
      .populate('items.itemId', 'name');

    console.log('✅ Delivery order created:', populatedOrder.orderNumber);

    res.status(201).json({ 
      success: true, 
      order: populatedOrder,
      message: 'Delivery order created successfully' 
    });
  } catch (error) {
    console.error('Create delivery order error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== MY ORDERS ==========

exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ 
      deliveryBoyId: req.user._id,
      status: { $nin: ['completed', 'cancelled'] }
    })
    .populate('chefId', 'name')
    .populate('items.itemId', 'name')
    .sort({ createdAt: -1 })
    .lean();

    console.log(`📋 Delivery orders fetched:`, orders.length);

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

// ========== UPDATE ORDER STATUS ==========

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId, status } = req.body;

    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Verify this is the delivery boy's order
    if (order.deliveryBoyId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized to update this order' 
      });
    }

    order.status = status;
    
    if (status === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
      .populate('items.itemId', 'name');

    res.json({ 
      success: true, 
      order: populatedOrder,
      message: `Order ${status} successfully` 
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE ORDER ==========

exports.updateOrder = async (req, res) => {
  try {
    const { orderId, items, customerName, customerPhone, deliveryAddress, notes } = req.body;

    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Can only update pending orders
    if (order.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Cannot update order after chef acceptance' 
      });
    }

    // Update fields
    if (items) {
      const { subtotal, tax, total } = calculateOrderTotal(items, order.discount, 5);
      order.items = items;
      order.subtotal = subtotal;
      order.tax = tax;
      order.total = total;
      order.estimatedTime = calculateTotalTime(items) + 20;
    }

    if (customerName) order.customerName = customerName;
    if (customerPhone) order.customerPhone = customerPhone;
    if (deliveryAddress) order.deliveryAddress = deliveryAddress;
    if (notes) order.notes = notes;

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('deliveryBoyId', 'name')
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

module.exports = exports;