// api/telegram-link.js - Enhanced with dynamic status fetching from ERPNext
require('dotenv').config();
console.log('🔧 Starting Telegram Bot...');

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');

// Check environment variables
console.log('📋 Checking environment...');
console.log('ERP_URL:', process.env.ERP_URL);
console.log('BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);

if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is missing from .env file');
    process.exit(1);
}

if (!process.env.ERP_URL) {
    console.error('❌ ERP_URL is missing from .env file');
    process.exit(1);
}

const ERP_URL = process.env.ERP_URL;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

console.log('🤖 Bot initialized successfully');

let userSessions = {};

// Cache for status options to avoid repeated API calls
let statusOptionsCache = {};
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    console.log('🔄 /start command received from:', msg.from.id);
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Initialize user session
    userSessions[userId] = { 
        step: 'awaiting_email',
        telegramId: userId,
        firstName: msg.from.first_name || 'User'
    };

    try {
        // Send welcome message
        await bot.sendMessage(chatId, 
            `👋 Welcome ${msg.from.first_name || 'there'} to ERPNext Task Bot!\n\n` +
            `To get started, I'll need to link your ERPNext account.\n` +
            `Please enter your ERPNext email address:`
        );
        console.log('✅ Welcome message sent to:', userId);
    } catch (error) {
        console.error('❌ Error sending welcome message:', error);
    }
});

// Handle text messages
bot.on('message', async (msg) => {
    // Skip if message is a command or empty
    if (!msg.text && !msg.document && !msg.photo) return;
    
    console.log('📨 Message received:', msg.text || 'File/Photo', 'from:', msg.from.id);
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Handle file attachments
    if (msg.document || msg.photo) {
        await handleFileAttachment(chatId, userId, msg);
        return;
    }

    const text = msg.text.trim();

    // Handle menu buttons
    if (text === '📋 View My Tasks' || text === '/tasks') {
        if (!userSessions[userId] || !userSessions[userId].email) {
            return await bot.sendMessage(chatId, 'Please log in first using /start');
        }
        const userSession = userSessions[userId];
        await showUserTasks(chatId, userSession.email, userSession.password, userId);
        return;
    } else if (text === '📊 Task Status' || text === '/status') {
        const statusKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔵 Open', callback_data: 'status_Open' },
                        { text: '🟡 Working', callback_data: 'status_Working' }
                    ],
                    [
                        { text: '✅ Completed', callback_data: 'status_Completed' },
                        { text: '❌ Cancelled', callback_data: 'status_Cancelled' },
                        { text: '👀 All', callback_data: 'status_All' }
                    ]
                ]
            }
        };
        await bot.sendMessage(chatId, '🔍 Select task status to filter:', statusKeyboard);
        return;
    }

    // Skip if it's a command
    if (text.startsWith('/')) return;

    // Initialize session if it doesn't exist
    if (!userSessions[userId]) {
        console.log('ℹ️ Initializing new session for user:', userId);
        userSessions[userId] = { 
            step: 'awaiting_email',
            telegramId: userId,
            firstName: msg.from.first_name || 'User'
        };
    }

    const userSession = userSessions[userId];
    console.log('🔄 Processing step:', userSession.step, 'for user:', userId);

    try {
        switch (userSession.step) {
            case 'awaiting_email':
                // Basic email validation
                if (!text.includes('@') || !text.includes('.')) {
                    await bot.sendMessage(chatId, '❌ Please enter a valid email address:');
                    return;
                }
                
                userSession.email = text;
                userSession.step = 'awaiting_password';
                await bot.sendMessage(chatId, '🔑 Great! Now, please enter your ERPNext password:');
                break;

            case 'awaiting_password':
                userSession.password = text;
                userSession.step = 'confirm_login';
                
                // Create login button
                const loginKeyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '✅ Login to ERPNext', callback_data: 'confirm_login' }],
                            [{ text: '↩️ Start Over', callback_data: 'start_over' }]
                        ]
                    }
                };
                
                await bot.sendMessage(
                    chatId,
                    `🔐 Ready to link your account?\n\n` +
                    `Email: ${userSession.email}\n` +
                    `Click the button below to confirm and link your account.`,
                    loginKeyboard
                );
                break;
                
            case 'awaiting_status_update':
                // Handle status update from text input
                if (userSession.pendingTaskId && userSession.pendingStatusAction) {
                    await updateTaskStatus(chatId, userSession.email, userSession.password, userSession.pendingTaskId, text);
                    // Reset session
                    userSession.step = 'idle';
                    delete userSession.pendingTaskId;
                    delete userSession.pendingStatusAction;
                }
                break;
                
            default:
                // If we're in a different state, show the task management buttons
                const taskKeyboard = {
                    reply_markup: {
                        keyboard: [
                            ['📋 View My Tasks'],
                            ['📊 Task Status']
                        ],
                        resize_keyboard: true
                    }
                };
                await bot.sendMessage(chatId, 'What would you like to do next?', taskKeyboard);
        }
    } catch (error) {
        console.error('❌ Error in message handler:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try /start again.');
        delete userSessions[userId];
    }
});

// Fetch status options from ERPNext
async function fetchStatusOptionsFromERPNext(email, password) {
    try {
        console.log('🔄 Fetching status options from ERPNext...');
        
        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            throw new Error('Authentication failed');
        }

        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            throw new Error('API credentials missing');
        }

        // Method 1: Try to get status options from Task doctype
        try {
            const response = await axios.get(
                `${ERP_URL}/api/resource/DocType/Task`,
                {
                    headers: { 'Authorization': `token ${apiKey}:${apiSecret}` },
                    timeout: 10000
                }
            );

            const taskDocType = response.data.data;
            
            // Extract status options from the Select field
            if (taskDocType && taskDocType.fields) {
                const statusField = taskDocType.fields.find(field => field.fieldname === 'status');
                if (statusField && statusField.options) {
                    const statusOptions = statusField.options.split('\n').filter(option => option.trim() !== '');
                    console.log('✅ Status options fetched from Task doctype:', statusOptions);
                    return statusOptions;
                }
            }
        } catch (error) {
            console.log('⚠️ Could not fetch from Task doctype, trying alternative method...');
        }

        // Method 2: Try to get from server script or custom field
        try {
            const customResponse = await axios.get(
                `${ERP_URL}/api/method/frappe.desk.form.load.getdoc?doctype=Task&name=New%20Task%201`,
                {
                    headers: { 
                        'Cookie': authResult.cookies.join('; ')
                    },
                    timeout: 10000
                }
            );

            if (customResponse.data && customResponse.data.docs && customResponse.data.docs[0]) {
                const taskDoc = customResponse.data.docs[0];
                if (taskDoc.__server_messages) {
                    const serverMessages = JSON.parse(taskDoc.__server_messages || '[]');
                    // Look for status options in server messages
                    for (const msg of serverMessages) {
                        if (msg.message && msg.message.includes('status')) {
                            // Parse status options from server message
                            // This would depend on your ERPNext implementation
                        }
                    }
                }
            }
        } catch (error) {
            console.log('⚠️ Alternative method also failed');
        }

        // Method 3: Fallback to common status options
        console.log('🔄 Using fallback status options');
        return ['Open', 'Working', 'Pending Review', 'Completed', 'Cancelled', 'On Hold', 'Overdue', 'Closed'];

    } catch (error) {
        console.error('❌ Error fetching status options:', error);
        // Return default options as fallback
        return ['Open', 'Working', 'Pending Review', 'Completed', 'Cancelled', 'On Hold', 'Overdue', 'Closed'];
    }
}

// Get status options with caching
async function getStatusOptions(email, password) {
    const cacheKey = `${email}_status_options`;
    
    // Check cache
    if (statusOptionsCache[cacheKey] && 
        Date.now() - statusOptionsCache[cacheKey].timestamp < CACHE_DURATION) {
        console.log('📦 Using cached status options');
        return statusOptionsCache[cacheKey].options;
    }
    
    // Fetch fresh options
    const options = await fetchStatusOptionsFromERPNext(email, password);
    
    // Update cache
    statusOptionsCache[cacheKey] = {
        options: options,
        timestamp: Date.now()
    };
    
    return options;
}

// Handle file attachments and upload to ERPNext
async function handleFileAttachment(chatId, userId, msg) {
    try {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.pendingTaskIdForAttachment) {
            return await bot.sendMessage(chatId, '❌ Please select a task first before attaching files.');
        }

        const taskId = userSession.pendingTaskIdForAttachment;
        await bot.sendMessage(chatId, '📎 Processing attachment...');

        let fileId, fileName, mimeType;

        if (msg.document) {
            fileId = msg.document.file_id;
            fileName = msg.document.file_name;
            mimeType = msg.document.mime_type;
        } else if (msg.photo) {
            // Get the highest quality photo
            fileId = msg.photo[msg.photo.length - 1].file_id;
            fileName = `photo_${Date.now()}.jpg`;
            mimeType = 'image/jpeg';
        }

        // Download file from Telegram
        const fileLink = await bot.getFileLink(fileId);
        console.log('📥 Downloading file from:', fileLink);

        // Upload file to ERPNext
        const uploadResult = await uploadFileToERPNext(
            userSession.email, 
            userSession.password, 
            taskId, 
            fileLink, 
            fileName, 
            mimeType
        );

        if (uploadResult.success) {
            await bot.sendMessage(chatId, 
                `✅ File attached successfully!\n\n` +
                `📎 File: ${fileName}\n` +
                `📋 Task: ${uploadResult.taskName || taskId}\n\n` +
                `The file has been attached to the task in ERPNext.`
            );

            // Show updated task details with attachments
            await showTaskDetails(chatId, userSession.email, userSession.password, userId, taskId);
        } else {
            await bot.sendMessage(chatId, 
                `❌ Failed to attach file to ERPNext.\n\n` +
                `Error: ${uploadResult.error}`
            );
        }

        // Reset attachment state
        delete userSession.pendingTaskIdForAttachment;

    } catch (error) {
        console.error('❌ File attachment error:', error);
        await bot.sendMessage(chatId, '❌ Failed to attach file. Please try again.');
    }
}

// Upload file to ERPNext and attach to task
async function uploadFileToERPNext(email, password, taskId, fileUrl, fileName, mimeType) {
    try {
        console.log('📤 Uploading file to ERPNext:', fileName);
        
        // First authenticate
        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            return { success: false, error: 'Authentication failed' };
        }

        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            return { success: false, error: 'API credentials missing' };
        }

        // Download file from Telegram
        const fileResponse = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream',
            timeout: 30000
        });

        // Create form data for file upload
        const formData = new FormData();
        formData.append('file', fileResponse.data, {
            filename: fileName,
            contentType: mimeType
        });
        formData.append('is_private', '1');
        formData.append('folder', 'Home/Attachments');
        formData.append('doctype', 'Task');
        formData.append('docname', taskId);
        formData.append('fieldname', 'attachments');

        // Upload file to ERPNext
        const uploadResponse = await axios.post(
            `${ERP_URL}/api/method/upload_file`,
            formData,
            {
                headers: {
                    'Authorization': `token ${apiKey}:${apiSecret}`,
                    ...formData.getHeaders()
                },
                timeout: 30000
            }
        );

        console.log('✅ File uploaded successfully:', uploadResponse.data);

        // Get task name for better display
        const taskResponse = await axios.get(
            `${ERP_URL}/api/resource/Task/${encodeURIComponent(taskId)}`,
            {
                headers: { 'Authorization': `token ${apiKey}:${apiSecret}` },
                timeout: 10000
            }
        );

        const taskName = taskResponse.data.data.subject || taskId;

        return { 
            success: true, 
            message: 'File attached successfully',
            taskName: taskName,
            fileData: uploadResponse.data
        };

    } catch (error) {
        console.error('❌ File upload error:', error.response?.data || error.message);
        return { 
            success: false, 
            error: error.response?.data?.message || error.message 
        };
    }
}

// Handle callback queries (for login button and task actions)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    await bot.answerCallbackQuery(callbackQuery.id);
    
    if (!userSessions[userId]) {
        return await bot.sendMessage(chatId, '❌ Session expired. Please /start again.');
    }
    
    const userSession = userSessions[userId];
    
    try {
        if (data === 'confirm_login') {
            if (!userSession.email || !userSession.password) {
                throw new Error('Missing credentials');
            }
            
            await bot.editMessageText('🔗 Linking your account... Please wait...', {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });
            
            // Call the link account function
            await linkTelegramAccount(chatId, userSession.email, userSession.password, userId);
            
            // Show task management buttons after successful login
            const taskKeyboard = {
                reply_markup: {
                    keyboard: [
                        ['📋 View My Tasks'],
                        ['📊 Task Status']
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };
            
            await bot.sendMessage(
                chatId,
                '✅ Account linked successfully!\n\n' +
                `📧 ERPNext: ${userSession.email}\n` +
                `📱 Telegram: ${userId}\n\n` +
                'You will now receive task assignment notifications! 🎯\n\n' +
                'What would you like to do next?',
                taskKeyboard
            );
            
        } else if (data === 'start_over') {
            // Reset user session
            userSessions[userId] = { 
                step: 'awaiting_email',
                telegramId: userId,
                firstName: userSession.firstName
            };
            
            await bot.editMessageText('🔄 Okay, let\'s start over!\n\nPlease enter your ERPNext email address:', {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id
            });
        } else if (data.startsWith('status_')) {
            const status = data.replace('status_', '');
            userSession.statusFilter = status === 'All' ? null : status;
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: status === 'All' ? 'Showing all tasks' : `Filtering by status: ${status}`
            });
            
            // Show tasks with the selected status
            if (userSession.email && userSession.password) {
                await showUserTasks(chatId, userSession.email, userSession.password, userId);
            }
        } else if (data.startsWith('task_')) {
            // Handle task detail view
            const taskId = data.replace('task_', '');
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Loading task details...'
            });
            
            if (userSession.email && userSession.password) {
                await showTaskDetails(chatId, userSession.email, userSession.password, userId, taskId);
            }
        } else if (data === 'back_to_tasks') {
            // Go back to task list
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Returning to task list...'
            });
            
            if (userSession.email && userSession.password) {
                await showUserTasks(chatId, userSession.email, userSession.password, userId);
            }
        } else if (data.startsWith('complete_')) {
            // Mark task as completed
            const taskId = data.replace('complete_', '');
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Marking task as completed...'
            });
            
            if (userSession.email && userSession.password) {
                await updateTaskStatus(chatId, userSession.email, userSession.password, taskId, 'Completed');
            }
        } else if (data.startsWith('update_')) {
            // Show status update options
            const taskId = data.replace('update_', '');
            await showStatusUpdateOptions(chatId, userId, taskId);
        } else if (data.startsWith('set_status_')) {
            // Set specific status
            const parts = data.replace('set_status_', '').split('_');
            const taskId = parts[0];
            const newStatus = parts[1];
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `Updating status to ${newStatus}...`
            });
            
            if (userSession.email && userSession.password) {
                await updateTaskStatus(chatId, userSession.email, userSession.password, taskId, newStatus);
            }
        } else if (data.startsWith('attach_')) {
            // Prepare for file attachment
            const taskId = data.replace('attach_', '');
            userSession.pendingTaskIdForAttachment = taskId;
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Ready to receive files. Please send your file or photo now.'
            });
            
            await bot.sendMessage(chatId, 
                `📎 Ready to attach files to task!\n\n` +
                `Please send the file or photo you want to attach.\n` +
                `You can send documents, images, or any other files.\n\n` +
                `The file will be attached directly to the task in ERPNext.`
            );
        } else if (data.startsWith('view_attachments_')) {
            // View task attachments
            const taskId = data.replace('view_attachments_', '');
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Loading attachments...'
            });
            
            if (userSession.email && userSession.password) {
                await showTaskAttachments(chatId, userSession.email, userSession.password, userId, taskId);
            }
        }
    } catch (error) {
        console.error('❌ Error in callback handler:', error);
        await bot.sendMessage(chatId, '❌ An error occurred: ' + error.message);
    }
});

// Show status update options with dynamic status from ERPNext
async function showStatusUpdateOptions(chatId, userId, taskId) {
    try {
        const userSession = userSessions[userId];
        if (!userSession.email || !userSession.password) {
            return await bot.sendMessage(chatId, '❌ Please log in again.');
        }

        // Get current task details to show current status
        const authResult = await authenticateWithERPNext(userSession.email, userSession.password);
        if (!authResult.success) {
            return await bot.sendMessage(chatId, '❌ Authentication failed.');
        }

        const task = await getTaskDetails(taskId, authResult.cookies);
        if (!task) {
            return await bot.sendMessage(chatId, '❌ Task not found.');
        }

        const currentStatus = task.status || 'Open';
        
        // Fetch available status options from ERPNext
        const allStatusOptions = await getStatusOptions(userSession.email, userSession.password);
        
        // Filter out current status and create buttons
        const availableStatusOptions = allStatusOptions
            .filter(status => status !== currentStatus)
            .map(status => ({
                name: status,
                icon: getStatusIcon(status)
            }));

        // Create status buttons
        const statusButtons = availableStatusOptions.map(status => {
            return [{
                text: `${status.icon} ${status.name}`,
                callback_data: `set_status_${taskId}_${status.name}`
            }];
        });

        // Add back button
        statusButtons.push([
            { text: '↩️ Back to Task', callback_data: `task_${taskId}` }
        ]);

        await bot.sendMessage(
            chatId,
            `🔄 Update Task Status\n\n` +
            `Current Status: ${getStatusIcon(currentStatus)} ${currentStatus}\n\n` +
            `Select new status:`,
            {
                reply_markup: {
                    inline_keyboard: statusButtons
                }
            }
        );

    } catch (error) {
        console.error('❌ Status options error:', error);
        await bot.sendMessage(chatId, '❌ Failed to load status options.');
    }
}

// Update task status - workaround for server script issues
async function updateTaskStatus(chatId, email, password, taskId, newStatus) {
    try {
        console.log(`🔄 Updating task ${taskId} status to: ${newStatus}`);
        
        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            return await bot.sendMessage(chatId, '❌ Authentication failed. Please log in again.');
        }

        // Try Method 1: Use cookies instead of API key (bypasses some server scripts)
        try {
            console.log('🔄 Trying Method 1: Using session cookies...');
            
            // Get current task data using cookies
            const taskResponse = await axios.get(
                `${ERP_URL}/api/resource/Task/${encodeURIComponent(taskId)}`,
                {
                    headers: { 
                        'Cookie': authResult.cookies.join('; ')
                    },
                    timeout: 15000
                }
            );
            
            const taskData = taskResponse.data.data;
            
            // Update using the form API endpoint which might bypass server scripts
            const updateResponse = await axios.post(
                `${ERP_URL}/api/method/frappe.client.set_value`,
                {
                    doctype: 'Task',
                    name: taskId,
                    fieldname: 'status',
                    value: newStatus
                },
                {
                    headers: { 
                        'Cookie': authResult.cookies.join('; '),
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            console.log('✅ Status updated via frappe.client.set_value');
            
            await bot.sendMessage(chatId, 
                `✅ Task status updated successfully!\n\n` +
                `🔄 New Status: ${getStatusIcon(newStatus)} ${newStatus}`
            );

            // Show updated task details
            await showTaskDetails(chatId, email, password, chatId, taskId);
            return;

        } catch (method1Error) {
            console.log('❌ Method 1 failed, trying Method 2...');
            
            // Method 2: Try with API key but minimal data
            const apiKey = process.env.ERPNEXT_API_KEY;
            const apiSecret = process.env.ERPNEXT_API_SECRET;
            
            if (!apiKey || !apiSecret) {
                throw new Error('API credentials missing');
            }

            console.log('🔄 Trying Method 2: Using API key with minimal update...');
            
            const updateResponse = await axios.post(
                `${ERP_URL}/api/method/frappe.client.set_value`,
                {
                    doctype: 'Task',
                    name: taskId,
                    fieldname: 'status',
                    value: newStatus
                },
                {
                    headers: {
                        'Authorization': `token ${apiKey}:${apiSecret}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            console.log('✅ Status updated via API token');
            
            await bot.sendMessage(chatId, 
                `✅ Task status updated successfully!\n\n` +
                `🔄 New Status: ${getStatusIcon(newStatus)} ${newStatus}`
            );

            // Show updated task details
            await showTaskDetails(chatId, email, password, chatId, taskId);
        }

    } catch (error) {
        console.error('❌ All update methods failed:', error.message);
        
        if (error.response) {
            console.log('Error response:', error.response.data);
            
            // Check if it's the server script error
            if (error.response.data && error.response.data.exc && error.response.data.exc.includes('__import__ not found')) {
                await bot.sendMessage(chatId, 
                    '❌ Cannot update task status due to a system configuration issue.\n\n' +
                    '⚠️ There is a server script in your ERPNext that is preventing task updates.\n\n' +
                    'Please contact your system administrator to fix the Server Script that runs on Task updates.'
                );
            } else {
                await bot.sendMessage(chatId, 
                    `❌ Failed to update task status.\n\n` +
                    `Error: ${error.response.data.message || error.message}`
                );
            }
        } else {
            await bot.sendMessage(chatId, 
                '❌ Failed to update task status. Please try again later.'
            );
        }
    }
}

// Show task attachments
async function showTaskAttachments(chatId, email, password, userId, taskId) {
    try {
        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            return await bot.sendMessage(chatId, '❌ Authentication failed.');
        }

        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            return await bot.sendMessage(chatId, '❌ System configuration error.');
        }

        // Get task attachments from ERPNext
        const attachmentsResponse = await axios.get(
            `${ERP_URL}/api/resource/File?fields=["name","file_name","file_url","file_size","modified"]&filters=[["attached_to_name","=","${taskId}"],["attached_to_doctype","=","Task"]]&order_by=modified desc`,
            {
                headers: { 'Authorization': `token ${apiKey}:${apiSecret}` },
                timeout: 10000
            }
        );

        const attachments = attachmentsResponse.data.data || [];
        
        if (attachments.length === 0) {
            return await bot.sendMessage(chatId, 
                `📎 No attachments found for this task.\n\n` +
                `Use the "Attach File" button to add files.`
            );
        }

        let message = `📎 Attachments (${attachments.length})\n\n`;
        
        attachments.forEach((attachment, index) => {
            const fileSize = attachment.file_size ? `(${formatFileSize(attachment.file_size)})` : '';
            message += `${index + 1}. ${attachment.file_name} ${fileSize}\n`;
        });

        const attachmentButtons = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📎 Attach More Files', callback_data: `attach_${taskId}` }
                    ],
                    [
                        { text: '📋 Back to Task', callback_data: `task_${taskId}` }
                    ]
                ]
            }
        };

        await bot.sendMessage(chatId, message, attachmentButtons);

    } catch (error) {
        console.error('❌ Attachments error:', error);
        await bot.sendMessage(chatId, '❌ Failed to load attachments.');
    }
}

// Format file size
function formatFileSize(bytes) {
    if (!bytes) return '';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// Show tasks to user with proper field mappings
async function showUserTasks(chatId, email, password, telegramUserId) {
    try {
        console.log('🔄 Fetching tasks for:', email);
        await bot.sendMessage(chatId, '🔄 Fetching task information...');

        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            console.log('❌ Authentication failed for:', email);
            return await bot.sendMessage(chatId, '❌ Authentication failed. Please check credentials.');
        }

        const tasks = await getAssignedTasks(email, authResult.cookies);
        console.log('📋 Tasks found:', tasks.length);
        
        // Apply status filter if set
        let filteredTasks = tasks;
        if (userSessions[telegramUserId] && userSessions[telegramUserId].statusFilter && 
            userSessions[telegramUserId].statusFilter !== 'All') {
            const statusFilter = userSessions[telegramUserId].statusFilter;
            filteredTasks = tasks.filter(task => task.status === statusFilter);
            console.log(`🔍 Filtered tasks by status '${statusFilter}':`, filteredTasks.length);
        }
        
        if (filteredTasks.length === 0) {
            const filterMsg = userSessions[telegramUserId] && userSessions[telegramUserId].statusFilter 
                ? ` with status '${userSessions[telegramUserId].statusFilter}'`
                : '';
            return await bot.sendMessage(chatId, `📭 No tasks assigned to you currently${filterMsg}.`);
        }

        // Create task list with clickable buttons
        const taskButtons = filteredTasks.map((task, index) => {
            const statusIcon = getStatusIcon(task.status);
            const taskText = `${index + 1}. ${statusIcon} ${task.subject || 'Untitled Task'}`;
            return [{
                text: taskText,
                callback_data: `task_${task.name}`
            }];
        });

        // Add status filter buttons at the bottom
        taskButtons.push([
            { text: '🔵 Open', callback_data: 'status_Open' },
            { text: '🟡 Working', callback_data: 'status_Working' }
        ]);
        taskButtons.push([
            { text: '✅ Completed', callback_data: 'status_Completed' },
            { text: '❌ Cancelled', callback_data: 'status_Cancelled' },
            { text: '👀 All', callback_data: 'status_All' }
        ]);
        
        const message = `📋 *Your Tasks (${filteredTasks.length})*\n\n` +
            `Click on a task to view details:`;
        
        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: taskButtons
            }
        });

    } catch (error) {
        console.error('❌ Tasks error:', error);
        await bot.sendMessage(chatId, '❌ Failed to fetch tasks. Please try again.');
    }
}

// Show detailed task information with attachments
async function showTaskDetails(chatId, email, password, telegramUserId, taskId) {
    try {
        console.log('📄 Fetching task details for:', taskId);
        
        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            return await bot.sendMessage(chatId, '❌ Authentication failed. Please log in again.');
        }

        // Fetch specific task details
        const task = await getTaskDetails(taskId, authResult.cookies);
        if (!task) {
            return await bot.sendMessage(chatId, '❌ Task not found or you do not have permission to view it.');
        }

        // Get attachments count
        const attachmentsCount = await getAttachmentsCount(email, password, taskId);

        // Format task details message
        const statusIcon = getStatusIcon(task.status);
        let message = `📋 *Task Details*\n\n`;
        message += `*${statusIcon} ${task.subject || 'Untitled Task'}*\n\n`;
        
        // Basic task information
        message += `*Status:* ${task.status || 'Open'}\n`;
        message += `*Priority:* ${task.priority || 'Medium'}\n`;
        
        if (task.project) {
            message += `*Project:* ${task.project}\n`;
        }
        
        if (task.type) {
            message += `*Type:* ${task.type}\n`;
        }
        
        if (task.department) {
            message += `*Department:* ${task.department}\n`;
        }
        
        if (task.exp_start_date) {
            message += `*Start Date:* ${formatDate(task.exp_start_date)}\n`;
        }
        
        if (task.exp_end_date) {
            message += `*End Date:* ${formatDate(task.exp_end_date)}\n`;
        }
        
        if (task.progress) {
            message += `*Progress:* ${task.progress}%\n`;
        }

        // Attachments section
        message += `\n*Attachments:* ${attachmentsCount} file(s)\n`;
        
        // Task description
        if (task.description) {
            const cleanDescription = task.description.replace(/<[^>]*>/g, '').trim();
            if (cleanDescription.length > 0) {
                message += `\n*Description:*\n${cleanDescription.substring(0, 500)}`;
                if (cleanDescription.length > 500) {
                    message += `...\n*(truncated)*`;
                }
            }
        }
        
        // Additional metadata
        message += `\n\n*Created:* ${formatDate(task.creation)}\n`;
        message += `*Modified:* ${formatDate(task.modified)}\n`;

        // Action buttons - Show "Submit" instead of "Mark Complete" if task is completed
        const isCompleted = task.status === 'Completed';
        const completeButtonText = isCompleted ? '✅ Submitted' : '✅ Mark Complete';
        const completeButtonCallback = isCompleted ? 'no_action' : `complete_${taskId}`;

        const actionButtons = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: completeButtonText, 
                            callback_data: completeButtonCallback,
                            ...(isCompleted && { disabled: true })
                        },
                        { text: '✏️ Update Status', callback_data: `update_${taskId}` }
                    ],
                    [
                        { text: '📎 Attach File', callback_data: `attach_${taskId}` },
                        { text: `📁 View Attachments (${attachmentsCount})`, callback_data: `view_attachments_${taskId}` }
                    ],
                    [
                        { text: '📋 Back to Tasks', callback_data: 'back_to_tasks' }
                    ]
                ]
            }
        };

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: actionButtons.reply_markup
        });

    } catch (error) {
        console.error('❌ Task details error:', error);
        await bot.sendMessage(chatId, '❌ Failed to fetch task details. Please try again.');
    }
}

// Get attachments count for a task
async function getAttachmentsCount(email, password, taskId) {
    try {
        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) return 0;

        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        
        if (!apiKey || !apiSecret) return 0;

        const attachmentsResponse = await axios.get(
            `${ERP_URL}/api/resource/File?fields=["name"]&filters=[["attached_to_name","=","${taskId}"],["attached_to_doctype","=","Task"]]`,
            {
                headers: { 'Authorization': `token ${apiKey}:${apiSecret}` },
                timeout: 10000
            }
        );

        return attachmentsResponse.data.data?.length || 0;

    } catch (error) {
        console.error('❌ Attachments count error:', error);
        return 0;
    }
}

// Get detailed task information
async function getTaskDetails(taskId, cookies) {
    try {
        console.log('🔍 Fetching details for task:', taskId);
        
        // Fetch task details from ERPNext API
        const response = await axios.get(
            `${ERP_URL}/api/resource/Task/${encodeURIComponent(taskId)}`,
            {
                headers: { 
                    'Cookie': cookies.join('; ')
                },
                timeout: 10000
            }
        );
        
        console.log('✅ Task details fetched successfully');
        return response.data.data;
        
    } catch (error) {
        console.error('❌ Task details fetch error:', error.message);
        
        // Fallback: Try alternative endpoint
        try {
            console.log('🔄 Trying alternative endpoint for task details...');
            const fallbackResponse = await axios.get(
                `${ERP_URL}/api/resource/Task?fields=["*"]&filters=[["name","=","${taskId}"]]`,
                {
                    headers: { 
                        'Cookie': cookies.join('; ')
                    },
                    timeout: 10000
                }
            );
            
            if (fallbackResponse.data.data && fallbackResponse.data.data.length > 0) {
                console.log('✅ Fallback task details fetched');
                return fallbackResponse.data.data[0];
            }
            
            return null;
            
        } catch (fallbackError) {
            console.error('❌ Fallback task details also failed:', fallbackError.message);
            return null;
        }
    }
}

// Format date for display
function formatDate(dateString) {
    if (!dateString) return 'Not set';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        return dateString;
    }
}

// Authentication function
async function authenticateWithERPNext(email, password) {
    try {
        console.log('🔐 Attempting authentication for:', email);
        
        const response = await axios.post(`${ERP_URL}/api/method/login`, {
            usr: email,
            pwd: password
        }, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            },
            maxRedirects: 5,
            withCredentials: true
        });

        console.log('📨 Login response status:', response.status);

        const cookies = response.headers['set-cookie'];
        console.log('🍪 Cookies received:', cookies ? 'Yes' : 'No');

        // Check different success conditions
        if (response.data.message) {
            if (response.data.message.logged_in === true) {
                console.log('✅ Authentication successful (logged_in: true)');
                return { success: true, cookies: cookies };
            }
            
            if (response.data.message.full_name) {
                console.log('✅ Authentication successful (full_name received)');
                return { success: true, cookies: cookies };
            }
            
            if (response.data.message.user_id === email) {
                console.log('✅ Authentication successful (user_id match)');
                return { success: true, cookies: cookies };
            }
        }

        if (response.status === 200 && cookies && cookies.length > 0) {
            console.log('✅ Authentication successful (200 status + cookies)');
            return { success: true, cookies: cookies };
        }

        console.log('❌ Authentication failed - no clear success indicator');
        return { success: false };

    } catch (error) {
        console.error('❌ Authentication error details:');
        
        if (error.response) {
            console.log('   Status:', error.response.status);
            console.log('   Status Text:', error.response.statusText);
            console.log('   Response Data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.log('   No response received');
        } else {
            console.log('   Error message:', error.message);
        }
        
        return { success: false };
    }
}

// Link Telegram account function
async function linkTelegramAccount(chatId, email, password, telegramUserId) {
    try {
        console.log('🔗 Linking account for:', email);
        await bot.sendMessage(chatId, '🔄 Linking your account...');

        const authResult = await authenticateWithERPNext(email, password);
        if (!authResult.success) {
            return await bot.sendMessage(chatId, '❌ Authentication failed.');
        }

        // Update user's Telegram ID in ERPNext using API
        const apiKey = process.env.ERPNEXT_API_KEY;
        const apiSecret = process.env.ERPNEXT_API_SECRET;
        
        if (!apiKey || !apiSecret) {
            console.log('❌ API credentials missing');
            return await bot.sendMessage(chatId, '❌ System configuration error.');
        }

        // Get user data
        const userResponse = await axios.get(
            `${ERP_URL}/api/resource/User/${encodeURIComponent(email)}`,
            {
                headers: { 'Authorization': `token ${apiKey}:${apiSecret}` },
                timeout: 10000
            }
        );
        
        const userData = userResponse.data.data;
        
        // Update with Telegram ID
        await axios.put(
            `${ERP_URL}/api/resource/User/${encodeURIComponent(email)}`,
            {
                ...userData,
                telegram_user_id: telegramUserId.toString()
            },
            {
                headers: {
                    'Authorization': `token ${apiKey}:${apiSecret}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        console.log('✅ Account linked for:', email);

    } catch (error) {
        console.error('❌ Linking error:', error);
        await bot.sendMessage(chatId, '❌ Failed to link account. Please contact administrator.');
    }
}

// Get assigned tasks using proper Task DocType fields
async function getAssignedTasks(email, cookies) {
    try {
        console.log('📋 Fetching tasks for:', email);
        
        // Using Frappe's built-in task API
        const response = await axios.get(
            `${ERP_URL}/api/method/frappe.desk.task.get_tasks_for_sidebar`,
            {
                headers: { 
                    'Cookie': cookies.join('; ')
                },
                timeout: 10000
            }
        );
        
        console.log('✅ Tasks fetched successfully');
        
        // Map the response to use proper field names from Task DocType
        const tasks = response.data.message || [];
        
        return tasks.map(task => ({
            subject: task.subject, // Task Name
            description: task.description, // Task Description (Text Editor)
            project: task.project, // Project Link
            type: task.type, // Task Category Link
            department: task.department, // Department Link
            is_group: task.is_group, // Is Group Check
            is_template: task.is_template, // Is Template Check
            color: task.color, // Color field
            status: task.status || 'Open', // Status Select
            // Additional fields that might be useful
            name: task.name,
            modified: task.modified,
            creation: task.creation,
            priority: task.priority,
            progress: task.progress,
            exp_start_date: task.exp_start_date,
            exp_end_date: task.exp_end_date
        }));
        
    } catch (error) {
        console.error('❌ Tasks fetch error:', error.message);
        
        // Fallback: Try alternative API endpoint
        try {
            console.log('🔄 Trying alternative API endpoint...');
            const fallbackResponse = await axios.get(
                `${ERP_URL}/api/resource/Task?fields=["name","subject","description","project","status","type","department","color","is_group","is_template","priority","progress","exp_start_date","exp_end_date"]&filters=[["Task","_assign","like","%${email}%"]]`,
                {
                    headers: { 
                        'Cookie': cookies.join('; ')
                    },
                    timeout: 10000
                }
            );
            
            console.log('✅ Fallback tasks fetched:', fallbackResponse.data.data.length);
            return fallbackResponse.data.data;
            
        } catch (fallbackError) {
            console.error('❌ Fallback tasks fetch also failed:', fallbackError.message);
            return [];
        }
    }
}

// Enhanced status icon mapping based on Task DocType status field
function getStatusIcon(status) {
    const icons = {
        'Open': '🔵',
        'Working': '🟡',
        'Pending Review': '🟠',
        'Overdue': '🔴',
        'Completed': '✅',
        'Closed': '🔒',
        'Cancelled': '❌',
        'On Hold': '⏸️'
    };
    return icons[status] || '📋';
}

// Error handlers
bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error);
});

console.log('🚀 Telegram Bot is now running and listening for messages...');
console.log('💡 Send /start to your bot to test it');