const generateOrderNumber = () => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `ORD-${timestamp}-${random}`;
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