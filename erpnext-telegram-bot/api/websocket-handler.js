const WebSocket = require('ws');
const axios = require('axios');
const { ERP_URL } = require('./config');

/**
 * Sends a formatted notification to a user
 * @param {Object} user - User object containing chatId and other user data
 * @param {Object} notification - Notification data
 * @param {string} notification.owner - Who allocated/created the notification
 * @param {string} notification.reference_type - Type of the reference
 * @param {string} notification.description - Description of the notification
 */
async function sendFormattedNotification(user, notification) {
    try {
        const { chatId } = user;
        const { owner, reference_type, description } = notification;
        
        const message = `
<b>New Notification Arrived! 🔔</b>

<u>Notification Details:</u>
  • <b>Allocated by</b>: ${owner || 'System'}
  • <b>Reference Type</b>: ${reference_type || 'N/A'}
  • <b>Description</b>: ${description || 'No description provided'}

<em>Tibeb Design & Build ERP</em>
`;

        await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
        console.log(`📨 Sent formatted notification to user ${chatId}`);
    } catch (error) {
        console.error('❌ Error sending formatted notification:', error);
        throw error;
    }
}

let instance = null;

class WebSocketHandler {
    constructor(bot) {
        if (!instance) {
            this.bot = bot;
            this.ws = null;
            this.connectedUsers = new Map(); // Map of email to user data
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 5;
            this.reconnectInterval = 5000; // 5 seconds
            this.isConnecting = false;
            this.reconnectTimeout = null;
            instance = this;
            
            // Bind the sendFormattedNotification method to the instance
            this.sendFormattedNotification = sendFormattedNotification.bind(this);
        }
        return instance;
    }

    /**
     * Sends a notification to a specific user
     * @param {string} email - User's email
     * @param {Object} notification - Notification data
     */
    async sendUserNotification(email, notification) {
        try {
            const user = this.connectedUsers.get(email);
            if (!user) {
                console.log(`User ${email} not found in connected users`);
                return false;
            }
            
            // Check if user has notifications enabled
            if (user.sessionData.notificationsEnabled !== false) {
                await this.sendFormattedNotification(user, notification);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`Error sending notification to ${email}:`, error);
            return false;
        }
    }

    /**
     * Broadcasts a notification to all connected users
     * @param {Object} notification - Notification data
     * @param {Array} [excludeEmails=[]] - Array of emails to exclude
     */
    async broadcastNotification(notification, excludeEmails = []) {
        try {
            let sentCount = 0;
            for (const [email, user] of this.connectedUsers.entries()) {
                if (!excludeEmails.includes(email)) {
                    const sent = await this.sendUserNotification(email, notification);
                    if (sent) sentCount++;
                }
            }
            console.log(`📢 Broadcasted notification to ${sentCount} users`);
            return sentCount;
        } catch (error) {
            console.error('Error broadcasting notification:', error);
            throw error;
        }
    }

    // Add or update user in connected users
    addUser(email, chatId, sessionData) {
        console.log(`👤 Adding/updating user: ${email}`);
        console.log(`📱 Chat ID: ${chatId}`);
        
        // Ensure we have the required session data
        if (!sessionData || !sessionData.apiKey || !sessionData.apiSecret) {
            console.error('❌ Missing required API credentials in session data');
            if (process.env.ERPNEXT_API_KEY && process.env.ERPNEXT_API_SECRET) {
                console.log('ℹ️ Using API credentials from environment variables');
                sessionData = {
                    ...sessionData,
                    apiKey: process.env.ERPNEXT_API_KEY,
                    apiSecret: process.env.ERPNEXT_API_SECRET
                };
            } else {
                console.error('❌ No API credentials available in environment variables');
            }
        }
        
        // Store the user session
        this.connectedUsers.set(email, { 
            chatId, 
            sessionData,
            lastActive: new Date().toISOString()
        });
        
        console.log(`✅ User ${email} added/updated. Total connected users: ${this.connectedUsers.size}`);
        
        // Ensure WebSocket connection is active
        this.ensureConnection().catch(error => {
            console.error('❌ Error ensuring WebSocket connection:', error);
        });
        
        return true;
    }

    // Remove user from connected users
    removeUser(email) {
        this.connectedUsers.delete(email);
        if (this.connectedUsers.size === 0) {
            this.disconnect();
        }
    }

    // Ensure WebSocket connection is active
    ensureConnection() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        return this.connect();
    }

    // Connect to WebSocket
    async connect() {
        if (this.isConnecting) {
            console.log('ℹ️ WebSocket connection already in progress...');
            return;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached');
            return;
        }

        this.isConnecting = true;
        let wsUrl = ERP_URL.replace('http', 'ws') + '/ws';
        
        // Ensure proper WebSocket URL format
        if (wsUrl.startsWith('wss://') && !wsUrl.includes('erp.tibebgroup.com')) {
            // If using HTTPS, ensure the WebSocket URL is correct
            wsUrl = 'wss://erp.tibebgroup.com/ws';
        } else if (wsUrl.startsWith('ws://') && !wsUrl.includes('erp.tibebgroup.com')) {
            wsUrl = 'ws://erp.tibebgroup.com/ws';
        }
        
        console.log(`🌐 Attempting to connect to WebSocket at: ${wsUrl}`);
        console.log(`🔌 Current connection state: ${this.ws ? this.ws.readyState : 'No active connection'}`);
        
        try {
            console.log('🔌 Creating new WebSocket instance...');
            this.ws = new WebSocket(wsUrl);

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.ws.removeAllListeners();
                    this.ws.terminate();
                    this.ws = null;
                    this.isConnecting = false;
                    reject(new Error('WebSocket connection timeout'));
                }, 10000); // 10 second timeout

                this.ws.once('open', () => {
                    clearTimeout(timeout);
                    this.reconnectAttempts = 0;
                    this.isConnecting = false;
                    console.log('✅ WebSocket connection established successfully');
                    console.log('📡 Ready state:', this.ws.readyState);
                    
                    // Wait a moment before subscribing to ensure the connection is fully established
                    setTimeout(async () => {
                        try {
                            console.log('🔄 Attempting to subscribe to task updates...');
                            const subscribed = await this.subscribeToTaskUpdates();
                            if (subscribed) {
                                console.log('✅ Successfully subscribed to task updates');
                            } else {
                                console.error('❌ Failed to subscribe to task updates');
                            }
                            resolve();
                        } catch (error) {
                            console.error('❌ Error during subscription:', error);
                            reject(error);
                        }
                    }, 1000);
                });

                this.ws.on('message', (data) => {
                    try {
                        console.log('📩 Raw WebSocket message received:', data);
                        const message = typeof data === 'string' ? JSON.parse(data) : data;
                        console.log('📨 Parsed WebSocket message:', JSON.stringify(message, null, 2));
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('❌ Error parsing WebSocket message:', error);
                        console.error('Raw message that caused error:', data);
                    }
                });

                this.ws.on('close', (code, reason) => {
                    clearTimeout(timeout);
                    const closeMessage = `❌ WebSocket connection closed - Code: ${code}, Reason: ${reason || 'No reason provided'}`;
                    console.log(closeMessage);
                    console.log('🔌 Ready state on close:', this.ws ? this.ws.readyState : 'No WebSocket instance');
                    
                    if (this.ws) {
                        this.ws.removeAllListeners();
                        this.ws = null;
                    }
                    
                    this.isConnecting = false;
                    
                    // Only attempt to reconnect if this wasn't a normal closure
                    if (code !== 1000) {
                        console.log('🔄 Scheduling reconnection...');
                        this.scheduleReconnect();
                    } else {
                        console.log('ℹ️ Normal WebSocket closure, not reconnecting');
                    }
                });

                this.ws.on('error', (error) => {
                    clearTimeout(timeout);
                    console.error('❌ WebSocket error:', error);
                    console.error('Error stack:', error.stack);
                    
                    if (this.ws) {
                        console.log('🔌 WebSocket state before termination:', this.ws.readyState);
                        try {
                            this.ws.terminate();
                        } catch (e) {
                            console.error('Error terminating WebSocket:', e);
                        }
                        this.ws = null;
                    }
                    
                    this.isConnecting = false;
                    this.scheduleReconnect();
                    reject(error);
                });
            });
        } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            this.isConnecting = false;
            this.scheduleReconnect();
            throw error;
        }
    }

    // Schedule reconnection attempt
    scheduleReconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5); // Cap the multiplier
            console.log(`⏳ Attempting to reconnect in ${delay/1000} seconds (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = null;
                this.ensureConnection().catch(console.error);
            }, delay);
        } else {
            console.error('❌ Max reconnection attempts reached. Giving up.');
            // Notify all connected users
            this.notifyAllUsers('🔴 Connection lost. Please restart the bot to receive notifications.');
        }
    }

    // Notify all connected users
    async notifyAllUsers(message) {
        for (const [email, userData] of this.connectedUsers.entries()) {
            try {
                await this.bot.sendMessage(userData.chatId, message);
            } catch (error) {
                console.error(`Failed to notify user ${email}:`, error);
            }
        }
    }

    // Subscribe to task updates
    async subscribeToTaskUpdates() {
        console.log('🔄 Starting subscription to task updates...');
        
        if (!this.ws) {
            console.error('❌ No WebSocket instance available');
            return false;
        }
        
        const state = this.ws.readyState;
        console.log(`🔌 WebSocket readyState: ${state} (${this.getReadyStateName(state)})`);
        
        if (state !== WebSocket.OPEN) {
            console.error(`❌ WebSocket is not open (state: ${state})`);
            return false;
        }

        try {
            // First, subscribe to list updates
            const listSubscribe = {
                cmd: 'subscribe',
                channel: 'list',
                doctype: 'Task',
                user: 'all',
                after: 0
            };
            
            // Then, subscribe to document updates
            const docSubscribe = {
                cmd: 'subscribe',
                channel: 'doc',
                doctype: 'Task',
                name: 'all',
                user: 'all'
            };

            console.log('📡 Subscribing to task list updates...');
            this.ws.send(JSON.stringify(listSubscribe));
            
            console.log('📡 Subscribing to task document updates...');
            this.ws.send(JSON.stringify(docSubscribe));
            
            console.log('✅ Subscription requests sent');
            return true;
            
        } catch (error) {
            console.error('❌ Error in subscribeToTaskUpdates:', error);
            if (error.stack) {
                console.error('Stack trace:', error.stack);
            }
            return false;
        }
    }
    
    // Helper to get WebSocket ready state name
    getReadyStateName(state) {
        const states = {
            0: 'CONNECTING',
            1: 'OPEN',
            2: 'CLOSING',
            3: 'CLOSED'
        };
        return states[state] || `UNKNOWN (${state})`;
    }

    // Handle incoming messages
    async handleMessage(message) {
        try {
            if (!message) {
                console.log('⚠️ Received empty message');
                return;
            }

            console.log('\n📨 === New WebSocket Message ===');
            console.log('Message type:', typeof message);
            console.log('Message content:', JSON.stringify(message, null, 2));
            
            // Handle subscription confirmations
            if (message.cmd === 'subscribe') {
                if (message.message === 'added') {
                    console.log(`✅ Successfully subscribed to channel: ${message.channel}`);
                } else if (message.message === 'removed') {
                    console.log(`ℹ️ Unsubscribed from channel: ${message.channel}`);
                } else {
                    console.log('ℹ️ Subscription status update:', message);
                }
                return;
            }
            
            // Handle different message types
            if (message.type === 'list_update') {
                console.log(`🔄 List update for ${message.doctype}`);
                if (message.doctype === 'Task' && message.name) {
                    await this.handleTaskUpdate(message.name);
                }
                return;
            }
            
            // Handle document updates
            if (message.doctype === 'Task' && message.name) {
                console.log(`📝 Document update for Task: ${message.name}`);
                if (message.data && message.data.doctype === 'Task') {
                    // Direct task data is included
                    await this.processTaskUpdate(message.data);
                } else {
                    // Need to fetch the task
                    await this.handleTaskUpdate(message.name);
                }
                return;
            }
            
            // Handle custom events
            if (message.event) {
                console.log(`🎯 Event received: ${message.event}`);
                if (message.doctype === 'Task' && message.name) {
                    await this.handleTaskUpdate(message.name);
                }
                return;
            }

            console.log('ℹ️ Unhandled message type:', message.type || 'unknown');
            console.log('Full message:', JSON.stringify(message, null, 2));
            
        } catch (error) {
            console.error('❌ Error in handleMessage:', error);
            if (error.response) {
                console.error('Error response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            console.error('Message that caused error:', JSON.stringify(message, null, 2));
        }
    }
    
    // Process task update with direct task data
    async processTaskUpdate(taskData) {
        try {
            if (!taskData || !taskData.name) {
                console.error('❌ Invalid task data received');
                return;
            }
            
            console.log(`🔄 Processing task update: ${taskData.name}`);
            
            // Proceed with the task update handling
            await this.notifyTaskUpdate(taskData);
            
        } catch (error) {
            console.error('❌ Error in processTaskUpdate:', error);
            throw error;
        }
    }

    // Handle task updates by fetching the latest task data
    async handleTaskUpdate(taskId) {
        if (!taskId) {
            console.error('❌ No task ID provided for update');
            return;
        }

        console.log(`\n🔄 === Processing Task Update ===`);
        console.log(`Task ID: ${taskId}`);
        
        try {
            // Get API credentials from the first connected user (for demonstration)
            // In production, you'd want to use the appropriate user's credentials
            const userSession = this.connectedUsers.values().next().value;
            if (!userSession) {
                console.error('❌ No active user sessions available');
                return;
            }

            console.log(`🔍 Fetching task details for: ${taskId}`);
            const taskResponse = await axios.get(
                `${ERP_URL}/api/resource/Task/${encodeURIComponent(taskId)}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `token ${userSession.sessionData.apiKey}:${userSession.sessionData.apiSecret}`
                    },
                    timeout: 15000 // 15 seconds timeout
                }
            );

            const taskData = taskResponse.data.data;
            if (!taskData) {
                console.error('❌ No task data received from API');
                return;
            }

            console.log(`📋 Task data received:`, JSON.stringify({
                name: taskData.name,
                subject: taskData.subject,
                status: taskData.status,
                assigned_to: taskData.assigned_to,
                modified: taskData.modified
            }, null, 2));

            // Process the task update
            await this.processTaskUpdate(taskData);
            
        } catch (error) {
            console.error('❌ Error in handleTaskUpdate:', error);
            if (error.response) {
                console.error('Error response:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data
                });
            } else if (error.request) {
                console.error('No response received:', error.request);
            } else {
                console.error('Error details:', error.message);
            }
        }
    }
    
    // Process task data and send notifications
    async processTaskUpdate(taskData) {
        try {
            if (!taskData || !taskData.assigned_to) {
                console.log('⚠️ No assignee found for task');
                return;
            }
            
            const assignedTo = taskData.assigned_to;
            console.log(`👤 Task assigned to: ${assignedTo}`);
            
            // Find user in connected users
            const userEntry = this.connectedUsers.get(assignedTo);
            if (!userEntry) {
                console.log(`ℹ️ No active session found for user: ${assignedTo}`);
                console.log('Available users:', Array.from(this.connectedUsers.keys()));
                return;
            }

            const { chatId } = userEntry;
            console.log(`💬 Sending notification to chat: ${chatId}`);
            
            // Format and send notification
            const allocatedBy = taskData.modified_by || taskData.owner || 'System';
            const status = taskData.status || 'Open';
            const priority = taskData.priority || 'Medium';
            const dueDate = taskData.exp_end_date ? new Date(taskData.exp_end_date).toLocaleDateString() : 'Not set';
            const modifiedDate = taskData.modified ? new Date(taskData.modified).toLocaleString() : 'Unknown';
            
            const taskMessage = `*Task Update* 🔔\n\n` +
                `*${taskData.subject || 'Untitled Task'}*\n` +
                `• Status: ${status} ${this.getStatusIcon(status)}\n` +
                `• Priority: ${priority}\n` +
                `• Due: ${dueDate}\n` +
                `• Assigned by: ${allocatedBy}\n` +
                `• Last updated: ${modifiedDate}\n\n` +
                `_${taskData.description || 'No description'}_\n\n` +
                `[View in ERPNext](${ERP_URL}/app/task/${taskData.name})`;

            console.log('📤 Sending task update to Telegram...');
            
            await this.bot.sendMessage(chatId, taskMessage, {
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            });
            
            console.log('✅ Task update notification sent successfully');
            
        } catch (error) {
            console.error('❌ Error in processTaskUpdate:', error);
            if (error.response) {
                console.error('Error response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            throw error; // Re-throw to be handled by the caller
        }
    }

    // Get status icon based on task status
    getStatusIcon(status) {
        const icons = {
            'Open': '🔵',
            'Working': '🟡',
            'Pending Review': '🟠',
            'Overdue': '🔴',
            'Completed': '✅',
            'Cancelled': '❌'
        };
        return icons[status] || '📌';
    }

    // Disconnect WebSocket
    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            try {
                this.ws.close(1000, 'Shutting down');
            } catch (error) {
                console.error('Error closing WebSocket:', error);
            } finally {
                this.ws = null;
            }
        }
        
        this.isConnecting = false;
        console.log('🔌 WebSocket disconnected');
    }

    // Cleanup resources
    cleanup() {
        this.disconnect();
        this.connectedUsers.clear();
    }
}

module.exports = WebSocketHandler;
