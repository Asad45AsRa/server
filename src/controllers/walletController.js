const CustomerWallet = require('../models/Customerwallet');

// ========== GET ALL CUSTOMERS (with wallet) ==========
exports.getAllCustomers = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { search } = req.query;

    let query = { branchId, isActive: true };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const customers = await CustomerWallet.find(query)
      .select('-transactions')
      .sort({ name: 1 });

    res.json({ success: true, customers, count: customers.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== GET SINGLE CUSTOMER WITH TRANSACTIONS ==========
exports.getCustomer = async (req, res) => {
  try {
    const customer = await CustomerWallet.findById(req.params.id)
      .populate('transactions.processedBy', 'name')
      .populate('transactions.orderId', 'orderNumber');

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREATE CUSTOMER ==========
exports.createCustomer = async (req, res) => {
  try {
    const { name, phone, email, address, notes, creditLimit } = req.body;

    // Check duplicate phone in same branch
    const existing = await CustomerWallet.findOne({
      branchId: req.user.branchId,
      phone,
      isActive: true
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Is phone number ka customer pehle se exist karta hai'
      });
    }

    const customer = await CustomerWallet.create({
      branchId: req.user.branchId,
      name,
      phone,
      email,
      address,
      notes,
      creditLimit: creditLimit || 5000,
      balance: 0
    });

    res.status(201).json({ success: true, customer, message: 'Customer wallet bana diya' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE CUSTOMER ==========
exports.updateCustomer = async (req, res) => {
  try {
    const { name, phone, email, address, notes, creditLimit } = req.body;

    const customer = await CustomerWallet.findByIdAndUpdate(
      req.params.id,
      { name, phone, email, address, notes, creditLimit },
      { new: true }
    ).select('-transactions');

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({ success: true, customer, message: 'Customer update ho gaya' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== ADVANCE PAYMENT (Customer pehle paise de) ==========
exports.addAdvancePayment = async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount dein' });
    }

    const customer = await CustomerWallet.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const balanceBefore = customer.balance;
    customer.balance += parseFloat(amount);

    customer.transactions.push({
      type: 'advance_payment',
      amount: parseFloat(amount),
      description: description || 'Advance payment received',
      processedBy: req.user._id,
      balanceBefore,
      balanceAfter: customer.balance
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${amount} advance payment add ho gaya`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREDIT PURCHASE (Customer udhaar leta hai) ==========
exports.creditPurchase = async (req, res) => {
  try {
    const { amount, orderId, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount dein' });
    }

    const customer = await CustomerWallet.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Check credit limit
    const currentDebt = customer.balance < 0 ? Math.abs(customer.balance) : 0;
    const newDebt = currentDebt + parseFloat(amount);

    if (newDebt > customer.creditLimit) {
      return res.status(400).json({
        success: false,
        message: `Credit limit exceed ho jayegi. Limit: Rs. ${customer.creditLimit}, Current debt: Rs. ${currentDebt}, Requested: Rs. ${amount}`
      });
    }

    const balanceBefore = customer.balance;
    customer.balance -= parseFloat(amount); // Minus karo kyunke udhaar hai

    customer.transactions.push({
      type: 'credit_purchase',
      amount: parseFloat(amount),
      description: description || 'Credit purchase',
      orderId: orderId || null,
      processedBy: req.user._id,
      balanceBefore,
      balanceAfter: customer.balance
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${amount} credit purchase record ho gaya`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== USE BALANCE FOR ORDER (Advance balance use karo) ==========
exports.useBalance = async (req, res) => {
  try {
    const { amount, orderId, description } = req.body;

    const customer = await CustomerWallet.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.balance <= 0) {
      return res.status(400).json({ success: false, message: 'Customer ka balance available nahi hai' });
    }

    if (parseFloat(amount) > customer.balance) {
      return res.status(400).json({
        success: false,
        message: `Sirf Rs. ${customer.balance} balance available hai`
      });
    }

    const balanceBefore = customer.balance;
    customer.balance -= parseFloat(amount);

    customer.transactions.push({
      type: 'balance_used',
      amount: parseFloat(amount),
      description: description || 'Balance used for order',
      orderId: orderId || null,
      processedBy: req.user._id,
      balanceBefore,
      balanceAfter: customer.balance
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${amount} balance use ho gaya`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CLEAR DEBT (Customer pehle ka udhaar deta hai) ==========
exports.clearDebt = async (req, res) => {
  try {
    const { amount, description } = req.body;

    const customer = await CustomerWallet.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    if (customer.balance >= 0) {
      return res.status(400).json({ success: false, message: 'Customer par koi udhaar nahi hai' });
    }

    const payAmount = Math.min(parseFloat(amount), Math.abs(customer.balance));
    const balanceBefore = customer.balance;
    customer.balance += payAmount;

    customer.transactions.push({
      type: 'advance_payment',
      amount: payAmount,
      description: description || 'Debt cleared - payment received',
      processedBy: req.user._id,
      balanceBefore,
      balanceAfter: customer.balance
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${payAmount} debt clear ho gaya`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== WALLET SUMMARY (Total debt / advance report) ==========
exports.getWalletSummary = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const customers = await CustomerWallet.find({ branchId, isActive: true }).select('name phone balance creditLimit');

    const totalAdvance = customers
      .filter(c => c.balance > 0)
      .reduce((sum, c) => sum + c.balance, 0);

    const totalDebt = customers
      .filter(c => c.balance < 0)
      .reduce((sum, c) => sum + Math.abs(c.balance), 0);

    const debtCustomers = customers.filter(c => c.balance < 0);
    const advanceCustomers = customers.filter(c => c.balance > 0);

    res.json({
      success: true,
      summary: {
        totalCustomers: customers.length,
        totalAdvance,
        totalDebt,
        debtCustomers: debtCustomers.length,
        advanceCustomers: advanceCustomers.length,
      },
      debtors: debtCustomers.sort((a, b) => a.balance - b.balance), // Sabse zyada udhaar pehle
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;