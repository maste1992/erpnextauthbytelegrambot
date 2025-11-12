// api/config.js
module.exports = {
    ERP_URL: process.env.ERP_URL || 'https://your-erpnext-instance.com',
    WS_RECONNECT_ATTEMPTS: 5,
    WS_RECONNECT_INTERVAL: 5000
};