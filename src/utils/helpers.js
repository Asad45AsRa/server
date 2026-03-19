const mongoose = require('mongoose');
const Counter = require('../models/Counter');

const generateOrderNumber = async () => {
  let counter = await Counter.findById('orderNumber');

  if (!counter) {
    const Order = mongoose.model('Order');
    const lastOrder = await Order.findOne(
      { orderNumber: { $regex: /^ORD-\d+$/ } },
      { orderNumber: 1 },
      { sort: { orderNumber: -1 } }
    );

    let startFrom = 0;
    if (lastOrder) {
      const num = parseInt(lastOrder.orderNumber.replace('ORD-', ''));
      startFrom = isNaN(num) ? 0 : num;
    }

    counter = await Counter.findByIdAndUpdate(
      'orderNumber',
      { $setOnInsert: { seq: startFrom } },
      { new: true, upsert: true }
    );
  }

  const updated = await Counter.findByIdAndUpdate(
    'orderNumber',
    { $inc: { seq: 1 } },
    { new: true }
  );

  return `ORD-${String(updated.seq).padStart(4, '0')}`;
};


const calculateTotalTime = (items) => {
  if (!items || items.length === 0) return 0;
  return Math.max(...items.map(item => item.preparationTime || 0));
};

const calculateOrderTotal = (items, discount = 0, taxRate = 0) => {
  const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax - discount;

  return {
    subtotal,
    tax,
    total
  };
};

module.exports = {
  generateOrderNumber,
  calculateTotalTime,
  calculateOrderTotal
};