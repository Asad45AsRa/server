const { body } = require('express-validator');

const loginValidator = [
  body('email').isEmail().withMessage('Please provide valid email'),
  body('password').notEmpty().withMessage('Password is required')
];

const createUserValidator = [
  body('name').notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Please provide valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').notEmpty().withMessage('Role is required'),
  body('phone').notEmpty().withMessage('Phone is required')
];

const createProductValidator = [
  body('name').notEmpty().withMessage('Product name is required'),
  body('category').notEmpty().withMessage('Category is required'),
  body('sizes').isArray({ min: 1 }).withMessage('At least one size is required')
];

const createOrderValidator = [
  body('orderType').notEmpty().withMessage('Order type is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required')
];

module.exports = {
  loginValidator,
  createUserValidator,
  createProductValidator,
  createOrderValidator
};