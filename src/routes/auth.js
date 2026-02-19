const express = require('express');
const router = express.Router();
const { login, getMe, changePassword, createUser, registerPushToken } = require('../controllers/authController');
const { protect } = require('../middlewares/auth');
const { loginValidator, createUserValidator } = require('../utils/validators');
const { validate } = require('../middlewares/validation');

// Public Routes
router.post('/login', loginValidator, validate, login);
router.post('/signup', createUserValidator, validate, createUser);

// Protected Routes
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);

// ✅ NEW: Register push notification token
router.post('/register-push-token', protect, registerPushToken);

module.exports = router;