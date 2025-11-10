require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {polling: true});

// ERPNext API Configuration
const ERP_URL = process.env.ERP_URL || 'https://erp.tibebgroup.com';

// Store user sessions
const userSessions = {};

// Handle /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    userSessions[userId] = {
        step: 'awaiting_email',
        telegramId: userId
    };

    bot.sendMessage(chatId, '👋 Welcome to ERPNext Bot! Please enter your ERPNext email:');
});

// Handle all text messages
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text.trim();

    if (!userSessions[userId]) {
        return bot.sendMessage(chatId, 'Please use /start to begin the authentication process.');
    }

    const userSession = userSessions[userId];

    try {
        switch (userSession.step) {
            case 'awaiting_email':
                userSession.email = text;
                userSession.step = 'awaiting_password';
                bot.sendMessage(chatId, '🔑 Please enter your ERPNext password:');
                break;

            case 'awaiting_password':
                userSession.password = text;
                userSession.step = 'ready_to_login';
                
                // Show login button instead of auto-login
                const loginButton = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🚀 Login & Link Telegram ID', callback_data: 'login_and_link' }]
                        ]
                    }
                };
                
                await bot.sendMessage(
                    chatId, 
                    `✅ Credentials received!\n\n📧 Email: ${userSession.email}\n🔐 Password: ••••••••\n\nClick the button below to login and link your Telegram ID:`,
                    loginButton
                );
                break;
        }
    } catch (error) {
        console.error('Unexpected error:', error);
        await bot.sendMessage(chatId, '❌ An unexpected error occurred. Please try again with /start');
        delete userSessions[userId];
    }
});

// Handle button clicks
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    if (!userSessions[userId]) {
        return bot.answerCallbackQuery(callbackQuery.id, { 
            text: 'Session expired. Please use /start again.' 
        });
    }

    const userSession = userSessions[userId];

    try {
        if (data === 'login_and_link') {
            // Answer the callback query first
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Logging in to ERPNext...' });
            
            // Update the message to show we're processing
            await bot.editMessageText('🔄 Logging into ERPNext...', {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });

            // Step 1: Login to ERPNext
            const authResult = await authenticateWithERPNextDetailed(userSession.email, userSession.password);
            
            if (authResult.success) {
                await bot.editMessageText('✅ Login successful! Linking Telegram ID...', {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id
                });

                // Step 2: Link Telegram ID
                const linkResult = await linkTelegramIdToUser(userSession.email, userId.toString());
                
                if (linkResult.success) {
                    await bot.editMessageText(
                        `✅ **Success!**\n\n📧 ERPNext User: ${userSession.email}\n📱 Telegram ID: ${userId}\n\nYour Telegram account has been successfully linked to your ERPNext account!`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                } else {
                    await bot.editMessageText(
                        `⚠️ **Login successful but linking failed**\n\nReason: ${linkResult.message}\n\nPlease contact your system administrator.`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: 'Markdown'
                        }
                    );
                }
            } else {
                await bot.editMessageText(
                    `❌ **Login Failed**\n\nReason: ${authResult.message}\n\nPlease use /start to try again.`,
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: 'Markdown'
                    }
                );
            }
            
            // Clear sensitive data and session
            delete userSession.password;
            delete userSessions[userId];
        }
    } catch (error) {
        console.error('Callback error:', error);
        await bot.editMessageText(
            '❌ An error occurred during login. Please use /start to try again.',
            {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            }
        );
        delete userSession.password;
        delete userSessions[userId];
    }
});

// Detailed authentication function with comprehensive debugging
async function authenticateWithERPNextDetailed(email, password) {
    console.log(`🔐 Attempting authentication for: ${email}`);
    
    const methods = [
        {
            name: 'Standard Login API',
            url: `${ERP_URL}/api/method/login`,
            data: { usr: email, pwd: password },
            headers: { 'Content-Type': 'application/json' }
        },
        {
            name: 'Form URL Encoded Login',
            url: `${ERP_URL}/api/method/login`,
            data: `usr=${encodeURIComponent(email)}&pwd=${encodeURIComponent(password)}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        },
        {
            name: 'Mobile Login',
            url: `${ERP_URL}/api/method/frappe.auth.get_logged_user`,
            config: {
                auth: { username: email, password: password }
            }
        },
        {
            name: 'Token Login',
            url: `${ERP_URL}/api/method/frappe.auth.get_logged_user`,
            headers: {
                'Authorization': `token ${email}:${password}`
            }
        }
    ];

    for (let method of methods) {
        try {
            console.log(`🔄 Trying method: ${method.name}`);
            
            let response;
            if (method.config) {
                response = await axios.get(method.url, {
                    timeout: 10000,
                    ...method.config
                });
            } else {
                response = await axios.post(method.url, method.data, {
                    timeout: 10000,
                    headers: method.headers
                });
            }

            console.log(`✅ ${method.name} - Status: ${response.status}`);
            console.log(`📨 Response data:`, JSON.stringify(response.data, null, 2));
            
            // Check for successful authentication
            if (response.status === 200) {
                if (response.data.message) {
                    // Different success indicators for different methods
                    if (response.data.message.logged_in === true || 
                        response.data.message.full_name ||
                        response.data.message.user_id ||
                        (typeof response.data.message === 'string' && response.data.message.includes('Logged In')) ||
                        response.data.message === 'Logged In') {
                        return { success: true, message: `Authenticated via ${method.name}` };
                    }
                }
                
                // If we get 200 but no clear message, still consider it success
                return { success: true, message: `Authenticated via ${method.name} (200 status)` };
            }
            
        } catch (error) {
            console.log(`❌ ${method.name} failed:`);
            if (error.response) {
                console.log(`   Status: ${error.response.status}`);
                console.log(`   Data: ${JSON.stringify(error.response.data)}`);
            } else {
                console.log(`   Error: ${error.message}`);
            }
        }
    }

    return { 
        success: false, 
        message: 'All authentication methods failed. Please check your credentials and ERPNext URL.' 
    };
}

// Function to link Telegram ID to ERPNext user
async function linkTelegramIdToUser(email, telegramId) {
    console.log(`🔗 Attempting to link Telegram ID ${telegramId} to user ${email}`);
    
    try {
        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        const fieldName = process.env.FIELD_NAME || 'telegram_user_id';
        
        if (!apiKey || !apiSecret) {
            return { 
                success: false, 
                message: 'API credentials not configured. Please set ERPNEXT_API_KEY and ERPNEXT_API_SECRET in .env' 
            };
        }

        console.log('🔑 Using API key/secret for authentication');
        
        // Get the user document first to ensure it exists and we have permission
        try {
            // First, get the user document
            const userResponse = await axios.get(
                `${ERP_URL}/api/resource/User/${encodeURIComponent(email)}`,
                {
                    headers: {
                        'Authorization': `token ${apiKey}:${apiSecret}`,
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // If we get here, the user exists and we have permission
            const userData = userResponse.data.data;
            
            // Update the user with Telegram ID
            const updateResponse = await axios.put(
                `${ERP_URL}/api/resource/User/${encodeURIComponent(email)}`,
                {
                    ...userData,  // Include all existing fields
                    [fieldName]: telegramId  // Update only the Telegram ID field
                },
                {
                    headers: {
                        'Authorization': `token ${apiKey}:${apiSecret}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            if (updateResponse.status === 200) {
                console.log('✅ Successfully updated user with Telegram ID');
                return { 
                    success: true, 
                    message: 'Telegram ID linked successfully' 
                };
            }
            
            return {
                success: false,
                message: `Unexpected status code: ${updateResponse.status}`
            };
            
        } catch (error) {
            console.error('API Error:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
            
            if (error.response?.status === 404) {
                return { 
                    success: false, 
                    message: 'User not found. Please check the email address.' 
                };
            }
            
            if (error.response?.status === 403) {
                return { 
                    success: false, 
                    message: 'Permission denied. Please check your API credentials.' 
                };
            }
            
            return { 
                success: false, 
                message: `Failed to update user: ${error.message}` 
            };
        }
        
    } catch (error) {
        console.error('Unexpected error:', error);
        return { 
            success: false, 
            message: `An unexpected error occurred: ${error.message}` 
        };
    }
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'OK', 
        bot: 'Running',
        erp_url: ERP_URL,
        users_authenticating: Object.keys(userSessions).length
    });
});

// Debug endpoint to test ERPNext connection
app.get('/test-erp', async (req, res) => {
    try {
        const testResponse = await axios.get(`${ERP_URL}/api/method/version`);
        res.json({ 
            status: 'ERPNext accessible', 
            version: testResponse.data 
        });
    } catch (error) {
        res.json({ 
            status: 'ERPNext not accessible', 
            error: error.message 
        });
    }
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`🤖 Telegram Bot Server running on port ${PORT}`);
    console.log(`🔗 ERPNext URL: ${ERP_URL}`);
    console.log('✅ Bot is running with login button!');
    console.log('');
    console.log('📋 Expected flow:');
    console.log('1. User sends /start');
    console.log('2. Bot asks for email');
    console.log('3. User enters email');
    console.log('4. Bot asks for password');
    console.log('5. User enters password');
    console.log('6. Bot shows login button');
    console.log('7. User clicks button to login and link');
});

// Handle process errors
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});