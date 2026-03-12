const CustomerWallet = require('../models/Customerwallet');
const Expense = require('../models/Expense'); // ✅ NEW: Expense model

// ========== GET ALL CUSTOMERS (with wallet) ==========
exports.getAllCustomers = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { search } = req.query;

    let query = { branchId, isActive: true };

    if (search) {
      query.$or = [
        { name:  { $regex: search, $options: 'i' } },
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

    const existing = await CustomerWallet.findOne({
      branchId: req.user.branchId,
      phone,
      isActive: true,
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Is phone number ka customer pehle se exist karta hai',
      });
    }

    const customer = await CustomerWallet.create({
      branchId: req.user.branchId,
      name, phone, email, address, notes,
      creditLimit: creditLimit || 5000,
      balance: 0,
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

// ========== ADVANCE PAYMENT ==========
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
      balanceAfter: customer.balance,
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${amount} advance payment add ho gaya`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CREDIT PURCHASE ==========
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

    const currentDebt = customer.balance < 0 ? Math.abs(customer.balance) : 0;
    const newDebt = currentDebt + parseFloat(amount);

    if (newDebt > customer.creditLimit) {
      return res.status(400).json({
        success: false,
        message: `Credit limit exceed ho jayegi. Limit: Rs. ${customer.creditLimit}, Current debt: Rs. ${currentDebt}, Requested: Rs. ${amount}`,
      });
    }

    const balanceBefore = customer.balance;
    customer.balance -= parseFloat(amount);

    customer.transactions.push({
      type: 'credit_purchase',
      amount: parseFloat(amount),
      description: description || 'Credit purchase',
      orderId: orderId || null,
      processedBy: req.user._id,
      balanceBefore,
      balanceAfter: customer.balance,
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${amount} credit purchase record ho gaya`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== USE BALANCE ==========
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
        message: `Sirf Rs. ${customer.balance} balance available hai`,
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
      balanceAfter: customer.balance,
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${amount} balance use ho gaya`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== CLEAR DEBT ==========
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
      balanceAfter: customer.balance,
    });

    await customer.save();

    res.json({
      success: true,
      customer,
      newBalance: customer.balance,
      message: `Rs. ${payAmount} debt clear ho gaya`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== WALLET SUMMARY ==========
exports.getWalletSummary = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const customers = await CustomerWallet.find({ branchId, isActive: true })
      .select('name phone balance creditLimit');

    const totalAdvance = customers.filter(c => c.balance > 0).reduce((sum, c) => sum + c.balance, 0);
    const totalDebt    = customers.filter(c => c.balance < 0).reduce((sum, c) => sum + Math.abs(c.balance), 0);

    const debtCustomers    = customers.filter(c => c.balance < 0);
    const advanceCustomers = customers.filter(c => c.balance > 0);

    res.json({
      success: true,
      summary: {
        totalCustomers:   customers.length,
        totalAdvance,
        totalDebt,
        debtCustomers:    debtCustomers.length,
        advanceCustomers: advanceCustomers.length,
      },
      debtors: debtCustomers.sort((a, b) => a.balance - b.balance),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================
// ✅ EXPENSE SECTION (new additions below — wallet untouched)
// ============================================================

// ========== GET EXPENSES ==========
exports.getExpenses = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { date, category, paymentMethod, startDate, endDate } = req.query;  // ✅ added paymentMethod

    let query = { branchId };

    if (date) {
      const start = new Date(date); start.setHours(0, 0, 0, 0);
      const end   = new Date(date); end.setHours(23, 59, 59, 999);
      query.date  = { $gte: start, $lte: end };
    }

    if (!date && startDate && endDate) {
      const start = new Date(startDate); start.setHours(0, 0, 0, 0);
      const end   = new Date(endDate);   end.setHours(23, 59, 59, 999);
      query.date  = { $gte: start, $lte: end };
    }

    if (category)      query.category      = category;
    if (paymentMethod) query.paymentMethod = paymentMethod;  // ✅ NEW

    const expenses = await Expense.find(query)
      .populate('addedBy', 'name')
      .sort({ date: -1, createdAt: -1 });

    res.json({ success: true, expenses, count: expenses.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ========== CREATE EXPENSE ==========
exports.createExpense = async (req, res) => {
  try {
    const { title, amount, category, paymentMethod, paidTo, description, date } = req.body;

    if (!title || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Title aur valid amount zaroori hai' });
    }

    const expense = await Expense.create({
      branchId:      req.user.branchId,
      title,
      amount:        parseFloat(amount),
      category:      category      || 'other',
      paymentMethod: paymentMethod || 'cash',   // ✅ NEW
      paidTo:        paidTo        || '',
      description:   description   || '',
      date:          date ? new Date(date) : new Date(),
      addedBy:       req.user._id,
    });

    const populated = await Expense.findById(expense._id).populate('addedBy', 'name');

    res.status(201).json({ success: true, expense: populated, message: 'Expense add ho gaya' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE EXPENSE ==========
exports.updateExpense = async (req, res) => {
  try {
    const { title, amount, category, paymentMethod, paidTo, description, date } = req.body;

    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, branchId: req.user.branchId },
      {
        title,
        amount:        parseFloat(amount),
        category:      category      || 'other',
        paymentMethod: paymentMethod || 'cash',   // ✅ NEW
        paidTo:        paidTo        || '',
        description:   description   || '',
        date:          date ? new Date(date) : undefined,
      },
      { new: true }
    ).populate('addedBy', 'name');

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    res.json({ success: true, expense, message: 'Expense update ho gaya' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ========== DELETE EXPENSE ==========
exports.deleteExpense = async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({
      _id:      req.params.id,
      branchId: req.user.branchId,
    });

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    res.json({ success: true, message: 'Expense delete ho gaya' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== EXPENSE SUMMARY ==========
exports.getExpenseSummary = async (req, res) => {
  try {
    const branchId = req.user.branchId;

    const now        = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const allExpenses   = await Expense.find({ branchId });
    const todayExpenses = allExpenses.filter(e => e.date >= todayStart && e.date <= todayEnd);
    const monthExpenses = allExpenses.filter(e => e.date >= monthStart && e.date <= monthEnd);

    // Category breakdown (all time)
    const byCategory = {};
    allExpenses.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    });

    // ✅ NEW: Payment Method breakdown (all time)
    const byPaymentMethod = {};
    allExpenses.forEach(e => {
      const method = e.paymentMethod || 'cash';
      byPaymentMethod[method] = (byPaymentMethod[method] || 0) + e.amount;
    });

    res.json({
      success:         true,
      today:           todayExpenses.reduce((s, e) => s + e.amount, 0),
      todayCount:      todayExpenses.length,
      thisMonth:       monthExpenses.reduce((s, e) => s + e.amount, 0),
      thisMonthCount:  monthExpenses.length,
      total:           allExpenses.reduce((s, e) => s + e.amount, 0),
      byCategory,
      byPaymentMethod,  // ✅ NEW
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


// ========== GET EXPENSES FOR DATE+TIME RANGE (used by cashier slip) ==========
exports.getExpensesByDateTimeRange = async (req, res) => {
  try {
    const branchId = req.user.branchId;
    const { startDateTime, endDateTime, category, paymentMethod } = req.query;
 
    let query = { branchId };
 
    if (startDateTime && endDateTime) {
      query.date = {
        $gte: new Date(startDateTime),
        $lte: new Date(endDateTime),
      };
    }
 
    if (category)      query.category      = category;
    if (paymentMethod) query.paymentMethod = paymentMethod;
 
    const expenses = await Expense.find(query)
      .populate('addedBy', 'name')
      .sort({ date: -1 });
 
    const total = expenses.reduce((s, e) => s + e.amount, 0);
 
    res.json({ success: true, expenses, total, count: expenses.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = exports;