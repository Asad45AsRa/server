const Order = require('../models/Order');
const Inventory = require('../models/Inventory');
const Product = require('../models/Product');

exports.checkInventoryAvailability = async (items) => {
  for (const item of items) {
    if (item.type === 'product') {
      const product = await Product.findById(item.itemId)
        .populate('sizes.ingredients.inventoryItemId');
      
      const sizeData = product.sizes.find(s => s.size === item.size);
      
      if (sizeData && sizeData.ingredients) {
        for (const ingredient of sizeData.ingredients) {
          const inventory = await Inventory.findById(ingredient.inventoryItemId);
          const requiredQty = ingredient.quantity * item.quantity;
          
          if (inventory.currentStock < requiredQty) {
            return {
              available: false,
              message: `Insufficient ${inventory.name} for ${product.name}`
            };
          }
        }
      }
    }
  }

  return { available: true };
};

exports.deductInventory = async (items) => {
  for (const item of items) {
    if (item.type === 'product') {
      const product = await Product.findById(item.itemId)
        .populate('sizes.ingredients.inventoryItemId');
      
      const sizeData = product.sizes.find(s => s.size === item.size);
      
      if (sizeData && sizeData.ingredients) {
        for (const ingredient of sizeData.ingredients) {
          const requiredQty = ingredient.quantity * item.quantity;
          await Inventory.findByIdAndUpdate(
            ingredient.inventoryItemId,
            { $inc: { currentStock: -requiredQty } }
          );
        }
      }
    } else if (item.type === 'cold_drink') {
      await Inventory.findByIdAndUpdate(
        item.itemId,
        { $inc: { currentStock: -item.quantity } }
      );
    }
  }
};

module.exports = exports;