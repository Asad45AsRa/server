module.exports = {
  port: process.env.PORT || 5000,
  jwtSecret: process.env.JWT_SECRET || 'default_secret_key',
  jwtExpire: process.env.JWT_EXPIRE || '30d',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/restaurant_management',
  nodeEnv: process.env.NODE_ENV || 'development'
};