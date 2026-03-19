const mongoose = require('mongoose');
const Counter = require('../models/Counter');

const generateOrderNumber = async () => {
  const Order = mongoose.model('Order');

  // Har baar DB se highest existing order number lo
  const lastOrder = await Order.findOne(
    { orderNumber: { $regex: /^ORD-\d+$/ } },
    { orderNumber: 1 },
    { sort: { createdAt: -1 } }  // ✅ createdAt se sort — string sort galat hoti
  );

  let maxExisting = 0;
  if (lastOrder) {
    const num = parseInt(lastOrder.orderNumber.replace('ORD-', ''));
    maxExisting = isNaN(num) ? 0 : num;
  }

  // Counter ko max existing se upar rakho — kabhi neeche nahi jaaye
  const updated = await Counter.findByIdAndUpdate(
    'orderNumber',
    [
      {
        $set: {
          seq: {
            $cond: {
              if: { $lte: ['$seq', maxExisting] },
              then: maxExisting + 1,   // ✅ existing se aage
              else: { $add: ['$seq', 1] }  // ✅ already aage hai toh normal increment
            }
          }
        }
      }
    ],
    { new: true, upsert: true }
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
  return { subtotal, tax, total };
};

module.exports = {
  generateOrderNumber,
  calculateTotalTime,
  calculateOrderTotal
};