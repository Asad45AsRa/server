const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
let expo = new Expo();

// Store push tokens in memory (use database in production)
const pushTokens = new Map();

/**
 * Register a user's push token
 */
const registerPushToken = (userId, pushToken) => {
  try {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      return false;
    }
    
    pushTokens.set(userId.toString(), pushToken);
    console.log(`✅ Registered push token for user ${userId}`);
    return true;
  } catch (error) {
    console.error('Error registering push token:', error);
    return false;
  }
};

/**
 * Send push notification to a single user
 */
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    const pushToken = pushTokens.get(userId.toString());
    
    if (!pushToken) {
      console.log(`No push token found for user ${userId}`);
      return { success: false, message: 'No push token registered' };
    }

    const messages = [{
      to: pushToken,
      sound: 'default',
      title: title,
      body: body,
      data: data,
      priority: 'high',
      badge: 1,
    }];

    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];

    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending notification chunk:', error);
      }
    }

    console.log(`✅ Sent notification to user ${userId}:`, title);
    return { success: true, tickets };
    
  } catch (error) {
    console.error('Error sending push notification:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send push notifications to multiple users
 */
const sendBulkPushNotifications = async (userIds, title, body, data = {}) => {
  try {
    const messages = [];
    
    for (const userId of userIds) {
      const pushToken = pushTokens.get(userId.toString());
      if (pushToken && Expo.isExpoPushToken(pushToken)) {
        messages.push({
          to: pushToken,
          sound: 'default',
          title: title,
          body: body,
          data: data,
          priority: 'high',
          badge: 1,
        });
      }
    }

    if (messages.length === 0) {
      return { success: false, message: 'No valid push tokens found' };
    }

    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];

    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending bulk notification chunk:', error);
      }
    }

    console.log(`✅ Sent ${messages.length} notifications`);
    return { success: true, count: messages.length, tickets };
    
  } catch (error) {
    console.error('Error sending bulk push notifications:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send order notification
 */
const sendOrderNotification = async (userId, orderNumber, status) => {
  const titles = {
    pending: '🔔 New Order',
    accepted: '✅ Order Accepted',
    preparing: '👨‍🍳 Order Preparing',
    ready: '✨ Order Ready',
    delivered: '🚚 Order Delivered',
    completed: '🎉 Order Completed'
  };

  const bodies = {
    pending: `Order ${orderNumber} is pending`,
    accepted: `Order ${orderNumber} has been accepted`,
    preparing: `Order ${orderNumber} is being prepared`,
    ready: `Order ${orderNumber} is ready for pickup/delivery`,
    delivered: `Order ${orderNumber} has been delivered`,
    completed: `Order ${orderNumber} is completed`
  };

  return await sendPushNotification(
    userId,
    titles[status] || '📋 Order Update',
    bodies[status] || `Order ${orderNumber} status: ${status}`,
    { type: 'order', orderNumber, status }
  );
};

/**
 * Send inventory alert
 */
const sendInventoryAlert = async (userId, itemName, currentStock) => {
  return await sendPushNotification(
    userId,
    '⚠️ Low Inventory Alert',
    `${itemName} is running low (${currentStock} remaining)`,
    { type: 'inventory', itemName, currentStock }
  );
};

module.exports = {
  registerPushToken,
  sendPushNotification,
  sendBulkPushNotifications,
  sendOrderNotification,
  sendInventoryAlert
};