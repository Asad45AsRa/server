require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Branch = require('../models/Branch');
require('dotenv').config();

const seedDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://ahmad556sahib_db_user:d8NrZTEYycMEb3IU@cluster0.lk13axb.mongodb.net/restaurant_management?retryWrites=true&w=majority');
    console.log('✅ MongoDB Connected');

    console.log('\n🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Branch.deleteMany({});
    console.log('✅ Old data cleared');

    // ─── Single Branch ───────────────────────────────────────────────────────
    console.log('\n🏢 Creating branch...');
    const branches = await Branch.insertMany([
      {
        name: 'AlMadina Fast Food - Shahkot',
        address: 'Main Bazar, Shahkot',
        city: 'Shahkot',
        phone: '0410000001',
        isActive: true,
        openingTime: '09:00',
        closingTime: '23:00',
      },
    ]);
    console.log(`✅ Created ${branches.length} branch`);

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('password123', salt);
    const branch = branches[0]._id;

    console.log('\n👥 Creating users...');
    const users = await User.create([

      // ── Admin ────────────────────────────────────────────────────────────
      {
        name: 'Admin',
        email: 'admin@almadina.com',
        password: hashedPassword,
        role: 'admin',
        phone: '03001111111',
        address: 'Shahkot',
        isActive: true,
        isApproved: true,
        joinDate: new Date(),
        wageType: 'monthly',
        monthlyRate: 80000,
        leavesPerMonth: 3,
      },

      // ── Manager — 3 placeholder seats (no real names) ────────────────────
      { name: 'Manager Seat 1', email: 'manager1@almadina.com', password: hashedPassword, role: 'manager', phone: '03010000001', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 60000, leavesPerMonth: 3, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Manager Seat 2', email: 'manager2@almadina.com', password: hashedPassword, role: 'manager', phone: '03010000002', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 60000, leavesPerMonth: 3, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Manager Seat 3', email: 'manager3@almadina.com', password: hashedPassword, role: 'manager', phone: '03010000003', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 60000, leavesPerMonth: 3, isActive: true, isApproved: true, joinDate: new Date() },

      // ── HR — 3 placeholder seats ─────────────────────────────────────────
      { name: 'HR Seat 1', email: 'hr1@almadina.com', password: hashedPassword, role: 'hr', phone: '03020000001', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 45000, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'HR Seat 2', email: 'hr2@almadina.com', password: hashedPassword, role: 'hr', phone: '03020000002', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 45000, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'HR Seat 3', email: 'hr3@almadina.com', password: hashedPassword, role: 'hr', phone: '03020000003', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 45000, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },

      // ── Inventory Officer — 3 placeholder seats ──────────────────────────
      { name: 'Inventory Seat 1', email: 'inventory1@almadina.com', password: hashedPassword, role: 'inventory_officer', phone: '03030000001', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 40000, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Inventory Seat 2', email: 'inventory2@almadina.com', password: hashedPassword, role: 'inventory_officer', phone: '03030000002', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 40000, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Inventory Seat 3', email: 'inventory3@almadina.com', password: hashedPassword, role: 'inventory_officer', phone: '03030000003', address: 'Shahkot', branchId: branch, wageType: 'monthly', monthlyRate: 40000, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },

      // ── Cashiers (hourly) ────────────────────────────────────────────────
      { name: 'Waqas',   email: 'cashier.waqas@almadina.com',   password: hashedPassword, role: 'cashier', phone: '03040000001', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 300, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Mustafa', email: 'cashier.mustafa@almadina.com', password: hashedPassword, role: 'cashier', phone: '03040000002', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 300, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },

      // ── Chefs (daily) ────────────────────────────────────────────────────
      { name: 'Ali Hamza', email: 'chef.alihamza@almadina.com', password: hashedPassword, role: 'chef', phone: '03050000001', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 2500, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Waqar',     email: 'chef.waqar@almadina.com',    password: hashedPassword, role: 'chef', phone: '03050000002', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 2500, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Muzam',     email: 'chef.muzam@almadina.com',    password: hashedPassword, role: 'chef', phone: '03050000003', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 2500, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Asad',      email: 'chef.asad@almadina.com',     password: hashedPassword, role: 'chef', phone: '03050000004', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 2500, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Umar Chef', email: 'chef.umar@almadina.com',     password: hashedPassword, role: 'chef', phone: '03050000005', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 2500, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Moshin',    email: 'chef.moshin@almadina.com',   password: hashedPassword, role: 'chef', phone: '03050000006', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 2500, leavesPerMonth: 2, isActive: true, isApproved: true, joinDate: new Date() },

      // ── Waiters (hourly) ─────────────────────────────────────────────────
      { name: 'Samar Qamar', email: 'waiter.samarqamar@almadina.com', password: hashedPassword, role: 'waiter', phone: '03060000001', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 200, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Shoaib',      email: 'waiter.shoaib@almadina.com',     password: hashedPassword, role: 'waiter', phone: '03060000002', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 200, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Abdullah',    email: 'waiter.abdullah@almadina.com',   password: hashedPassword, role: 'waiter', phone: '03060000003', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 200, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Umar Waiter', email: 'waiter.umar@almadina.com',       password: hashedPassword, role: 'waiter', phone: '03060000004', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 200, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Hasnain',     email: 'waiter.hasnain@almadina.com',    password: hashedPassword, role: 'waiter', phone: '03060000005', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 200, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Rafiq',       email: 'waiter.rafiq@almadina.com',      password: hashedPassword, role: 'waiter', phone: '03060000006', address: 'Shahkot', branchId: branch, wageType: 'hourly', hourlyRate: 200, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },

      // ── Delivery Boys (daily) ────────────────────────────────────────────
      { name: 'Umir',   email: 'delivery.umir@almadina.com',   password: hashedPassword, role: 'delivery', phone: '03070000001', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 1500, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Zahid',  email: 'delivery.zahid@almadina.com',  password: hashedPassword, role: 'delivery', phone: '03070000002', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 1500, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },
      { name: 'Khaliq', email: 'delivery.khaliq@almadina.com', password: hashedPassword, role: 'delivery', phone: '03070000003', address: 'Shahkot', branchId: branch, wageType: 'daily', dailyRate: 1500, leavesPerMonth: 1, isActive: true, isApproved: true, joinDate: new Date() },

    ]);
    console.log(`✅ Created ${users.length} users`);

    // Link first manager seat to branch
    console.log('\n🔗 Linking manager to branch...');
    await Branch.findByIdAndUpdate(branch, {
      managerId: users.find(u => u.email === 'manager1@almadina.com')._id,
    });
    console.log('✅ Manager linked to branch');

    console.log('\n' + '='.repeat(60));
    console.log('🎉 DATABASE SEEDED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('\n📊 SUMMARY:');
    console.log(`   Branch  : AlMadina Fast Food - Shahkot`);
    console.log(`   Users   : ${users.length}`);
    console.log('\n🔑 DEFAULT PASSWORD FOR ALL USERS: password123');
    console.log('\n📧 PLACEHOLDER SEAT EMAILS (no real names):');
    console.log('   Manager  → manager1@almadina.com / manager2 / manager3');
    console.log('   HR       → hr1@almadina.com / hr2 / hr3');
    console.log('   Inventory→ inventory1@almadina.com / inventory2 / inventory3');
    console.log('\n💰 WAGE TYPES:');
    console.log('   Manager / HR / Inventory — Monthly Fixed');
    console.log('   Chefs / Delivery         — Daily Rate');
    console.log('   Cashiers / Waiters       — Hourly Rate');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    process.exit(1);
  }
};

seedDatabase();