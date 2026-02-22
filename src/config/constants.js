const UserRole = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  HR: 'hr',
  CASHIER: 'cashier',
  CHEF: 'chef',
  WAITER: 'waiter',
  DELIVERY: 'delivery',
  INVENTORY_OFFICER: 'inventory_officer'
};

const OrderStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PREPARING: 'preparing',
  READY: 'ready',
  OUT_FOR_DELIVERY: 'out_for_delivery',   // ✅ ADDED — fixes enum validation error
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const OrderType = {
  DINE_IN: 'dine_in',
  DELIVERY: 'delivery',
  TAKEAWAY: 'takeaway'
};

const PaymentStatus = {
  PENDING: 'pending',
  PAID: 'paid',
  PARTIAL: 'partial'
};

const PaymentMethod = {
  CASH: 'cash',
  CARD: 'card',
  ONLINE: 'online'
};

const InventoryUnit = {
  KG: 'kg',
  HALF_KG: 'half_kg',
  QUARTER_KG: 'quarter_kg',
  LITER: 'liter',
  HALF_LITER: 'half_liter',
  PIECES: 'pieces',
  GRAMS: 'grams'
};

const AttendanceStatus = {
  PRESENT: 'present',
  ABSENT: 'absent',
  HALF_DAY: 'half_day',
  LEAVE: 'leave'
};

const PRODUCT_SIZES = ['small', 'medium', 'large', 'extra_large'];

module.exports = {
  UserRole,
  OrderStatus,
  OrderType,
  PaymentStatus,
  PaymentMethod,
  InventoryUnit,
  AttendanceStatus,
  PRODUCT_SIZES
};