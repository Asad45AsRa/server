const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { jwtSecret, jwtExpire } = require('../config/config');
const notificationService = require('../services/notificationService');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, jwtSecret, { expiresIn: jwtExpire || '30d' });
};

// ========== LOGIN ==========
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user with branchId populated
    const user = await User.findOne({ email })
      .populate('branchId', 'name city address phone isActive');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Check if active
    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated. Contact admin.' });
    }

    // Check if approved (skip for admin)
    if (!user.isApproved && user.role !== 'admin') {
      return res.status(401).json({ 
        success: false, 
        message: 'Your account is pending admin approval. Please wait.' 
      });
    }

    const token = generateToken(user._id);

    // Build user object (no password)
    const userData = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      branchId: user.branchId,        // ✅ populated object
      wageType: user.wageType,
      hourlyRate: user.hourlyRate,
      dailyRate: user.dailyRate,
      monthlyRate: user.monthlyRate,
      isActive: user.isActive,
      isApproved: user.isApproved,
      profileImage: user.profileImage,
      joinDate: user.joinDate,
      managerRights: user.managerRights || null,
    };

    res.json({
      success: true,
      token,
      user: userData,
      message: `Welcome back, ${user.name}!`
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== GET ME (current user) ==========
exports.getMe = async (req, res) => {
  try {
    // Always fetch fresh from DB so we get latest rights/status
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('branchId', 'name city address phone isActive openingTime closingTime');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, user });

  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CHANGE PASSWORD ==========
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both current and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword; // pre('save') hook will hash it
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREATE USER (signup) ==========
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone, branchId, address, cnic } = req.body;

    // Check duplicate email
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      phone,
      branchId: branchId || null,
      address: address || '',
      cnic: cnic || '',
      isApproved: false,  // needs admin approval
      isActive: true,
    });

    res.status(201).json({
      success: true,
      message: 'Account created. Waiting for admin approval.',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== REGISTER PUSH TOKEN ==========
exports.registerPushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ success: false, message: 'Push token is required' });
    }

    const registered = notificationService.registerPushToken(req.user._id, pushToken);

    if (!registered) {
      return res.status(400).json({ success: false, message: 'Invalid push token format' });
    }

    res.json({ success: true, message: 'Push token registered successfully' });

  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;