// api/login-interface.js - Telegram Bot Login Interface
const TelegramBot = require('node-telegram-bot-api');

class LoginInterface {
    constructor(bot) {
        this.bot = bot;
    }

    // Show login form with proper formatting
    async showLoginForm(chatId, firstName = 'User') {
        try {
            // Create the login interface message
            const loginMessage = `
🔐 *Sign in to your account*

*Your email*  
📧 name@company.com  

*Password*  
🔑 ••••••••

---

Please enter your credentials step by step:
1️⃣ First, enter your email address
2️⃣ Then, enter your password
3️⃣ Finally, confirm to link your account
            `;

            // Send the login interface
            await this.bot.sendMessage(chatId, loginMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Get Started', callback_data: 'start_login' }],
                        [{ text: '❓ Need Help?', callback_data: 'login_help' }]
                    ]
                }
            });

        } catch (error) {
            console.error('❌ Error showing login form:', error);
            throw error;
        }
    }

    // Show email input prompt
    async showEmailPrompt(chatId) {
        await this.bot.sendMessage(chatId, 
            `📧 *Enter Your Email*\n\n` +
            `Please type your ERPNext email address:\n\n` +
            `Example: yourname@company.com`,
            { 
                parse_mode: 'Markdown'
            }
        );
    }

    // Show password input prompt
    async showPasswordPrompt(chatId) {
        await this.bot.sendMessage(chatId, 
            `🔑 *Enter Your Password*\n\n` +
            `Please type your ERPNext password:\n\n` +
            `_Your password is encrypted and secure_`,
            { 
                parse_mode: 'Markdown'
            }
        );
    }

    // Show credentials confirmation
    async showConfirmation(chatId, email) {
        const confirmMessage = `
✅ *Credentials Received*

📧 *Email:* ${email}
🔑 *Password:* ••••••••

*Please confirm to proceed:*
        `;

        await this.bot.sendMessage(chatId, confirmMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Confirm & Login', callback_data: 'confirm_login' },
                        { text: '🔄 Start Over', callback_data: 'start_over' }
                    ]
                ]
            }
        });
    }

    // Show login in progress
    async showLoginProgress(chatId) {
        await this.bot.sendMessage(chatId, 
            `🔄 *Signing you in...*\n\n` +
            `⏳ Connecting to ERPNext...\n` +
            `🔐 Verifying credentials...\n` +
            `🔗 Linking Telegram account...\n\n` +
            `_This may take a few seconds_`,
            { parse_mode: 'Markdown' }
        );
    }

    // Show login success
    async showLoginSuccess(chatId, email, firstName) {
        const successMessage = `
🎉 *Welcome to ERPNext Task Bot, ${firstName}!*

✅ *Account Linked Successfully*

📧 *ERPNext:* ${email}
📱 *Telegram:* Connected
🔔 *Notifications:* Enabled

*You're all set!* Now you can:
• 📋 View your assigned tasks
• 🔄 Update task status
• 📎 Attach files to tasks
• 📊 Track progress

*What would you like to do first?*
        `;

        await this.bot.sendMessage(chatId, successMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [
                    ['📋 View My Tasks', '📊 Task Status'],
                    ['🔄 Check Updates', '❓ Help']
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
    }

    // Show login error
    async showLoginError(chatId, errorMessage = 'Authentication failed') {
        const errorMsg = `
❌ *Login Failed*

${errorMessage}

*Possible reasons:*
• Invalid email or password
• Network connection issue
• ERPNext server unavailable

*What to do next:*
        `;

        await this.bot.sendMessage(chatId, errorMsg, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Try Again', callback_data: 'start_over' }],
                    [{ text: '📞 Contact Support', callback_data: 'contact_support' }]
                ]
            }
        });
    }

    // Show help information
    async showHelp(chatId) {
        const helpMessage = `
❓ *Login Help*

*About ERPNext Task Bot:*
This bot helps you manage your ERPNext tasks directly from Telegram.

*What you need:*
• Your ERPNext email address
• Your ERPNext password
• Active ERPNext account

*Security:*
🔒 Your password is encrypted
🔐 Secure connection to ERPNext
🚫 We never store your password

*Getting Started:*
1. Enter your ERPNext email
2. Enter your password  
3. Confirm to link your account
4. Start managing tasks!

*Need more help?* Contact your system administrator.
        `;

        await this.bot.sendMessage(chatId, helpMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 Start Login', callback_data: 'start_login' }],
                    [{ text: '📋 View Features', callback_data: 'view_features' }]
                ]
            }
        });
    }

    // Show features overview
    async showFeatures(chatId) {
        const featuresMessage = `
✨ *ERPNext Task Bot Features*

📋 *Task Management*
• View all assigned tasks
• See task details and descriptions
• Filter tasks by status

🔄 *Status Updates*
• Update task progress
• Mark tasks as complete
• Change task status

📎 *File Attachments*
• Attach files to tasks
• Upload photos and documents
• View existing attachments

🔔 *Notifications*
• Get task assignment alerts
• Receive deadline reminders
• Status change notifications

📊 *Progress Tracking*
• Monitor task progress
• View project timelines
• Track completion rates

*Ready to get started?*
        `;

        await this.bot.sendMessage(chatId, featuresMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🚀 Start Login Now', callback_data: 'start_login' }]
                ]
            }
        });
    }
}

module.exports = LoginInterface;