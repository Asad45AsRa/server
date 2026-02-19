require('dotenv').config();
const http = require('http');
const socketIO = require('socket.io');
const app = require('./src/app');
const connectDB = require('./src/config/database');
const { port } = require('./src/config/config');

// Connect Database
connectDB();

const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: function (origin, callback) {
      callback(null, true); // Allow all origins (mobile + browser)
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  },
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  socket.on('join-branch', (branchId) => {
    socket.join(`branch-${branchId}`);
    console.log(`📍 Client ${socket.id} joined branch: ${branchId}`);
  });

  socket.on('order-update', (data) => {
    io.to(`branch-${data.branchId}`).emit('order-notification', data);
  });

  socket.on('inventory-alert', (data) => {
    io.to(`branch-${data.branchId}`).emit('inventory-notification', data);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

app.set('io', io);

const PORT = port || 5000;

const getLocalIP = () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
};

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();

  console.log('\n' + '='.repeat(60));
  console.log('🚀 ALMADINA FAST FOOD — SERVER STARTED');
  console.log('='.repeat(60));
  console.log(`\n📡 Status  : RUNNING`);
  console.log(`⏰ Time    : ${new Date().toLocaleString()}\n`);
  console.log('🌐 URLs:');
  console.log(`   Local   : http://localhost:${PORT}`);
  console.log(`   Network : http://${localIP}:${PORT}`);
  console.log(`\n📱 Mobile API URL:`);
  console.log(`   http://${localIP}:${PORT}/api`);
  console.log(`\n🔍 Health  : http://${localIP}:${PORT}/health`);
  console.log('\n' + '='.repeat(60));

  console.log('\n💡 Test Login Credentials (password: password123)');
  console.log('   Admin     : admin@almadina.com');
  console.log('   Manager   : manager1@almadina.com');
  console.log('   HR        : hr1@almadina.com');
  console.log('   Inventory : inventory1@almadina.com');
  console.log('   Cashier   : cashier.waqas@almadina.com');
  console.log('   Chef      : chef.alihamza@almadina.com');
  console.log('   Waiter    : waiter.shoaib@almadina.com');
  console.log('   Delivery  : delivery.umir@almadina.com');

  console.log('\n🔧 Environment: ' + (process.env.NODE_ENV || 'development'));
  console.log('='.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n⚠️  SIGTERM — shutting down...');
  server.close(() => { console.log('✅ Server closed'); process.exit(0); });
});
process.on('SIGINT', () => {
  console.log('\n⚠️  SIGINT — shutting down...');
  server.close(() => { console.log('✅ Server closed'); process.exit(0); });
});
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
});

module.exports = server;