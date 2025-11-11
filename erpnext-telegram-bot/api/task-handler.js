const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Store task creation state
const taskStates = {};

// Initialize task creation
const startTaskCreation = (userId, chatId) => {
    taskStates[userId] = {
        step: 'awaiting_task_name',
        chatId: chatId,
        data: {}
    };
    
    return {
        text: '📝 *Create New Task*\n\nPlease enter the task name:',
        options: {
            parse_mode: 'Markdown',
            reply_markup: {
                force_reply: true,
                selective: true
            }
        }
    };
};

// Handle task creation steps
const handleTaskStep = async (userId, text, bot) => {
    const state = taskStates[userId];
    if (!state) return null;

    try {
        switch (state.step) {
            case 'awaiting_task_name':
                state.data.name = text;
                state.step = 'awaiting_task_description';
                return {
                    text: '📄 *Task Description*\n\nPlease describe the task:',
                    options: {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            force_reply: true,
                            selective: true
                        }
                    }
                };

            case 'awaiting_task_description':
                state.data.description = text;
                state.step = 'awaiting_attachments';
                return {
                    text: '📎 *Attachments (Optional)*\n\nYou can now send files or photos for this task. When done, click the button below to finish.',
                    options: {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ Finish Task Creation', callback_data: 'finish_task' }],
                                [{ text: '❌ Cancel', callback_data: 'cancel_task' }]
                            ]
                        }
                    }
                };

            default:
                return null;
        }
    } catch (error) {
        console.error('Error in task step handling:', error);
        return null;
    }
};

// Handle file attachments
const handleFileAttachment = (userId, fileId, fileType, bot) => {
    const state = taskStates[userId];
    if (!state || state.step !== 'awaiting_attachments') return null;

    // Initialize files array if it doesn't exist
    if (!state.data.files) {
        state.data.files = [];
    }

    // Store file info (in a real app, you'd want to download and store the file)
    state.data.files.push({
        fileId,
        type: fileType
    });

    return {
        text: `📎 File attached! (${state.data.files.length} files attached so far)\n\nYou can send more files or click 'Finish Task Creation' when done.`,
        options: {
            parse_mode: 'Markdown'
        }
    };
};

// Create task in ERPNext
const createTaskInERPNext = async (taskData, userId, sessionData) => {
    try {
        // Prepare task data for ERPNext API
        const taskPayload = {
            doctype: 'Task',
            subject: taskData.name,
            description: taskData.description,
            status: 'Open',
            priority: 'Medium',
            owner: sessionData.email, // Link to the ERPNext user
            // Add any additional fields as needed
        };

        // Make API call to create task in ERPNext
        const response = await axios.post(
            `${process.env.ERP_URL}/api/resource/Task`,
            JSON.stringify(taskPayload),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `token ${sessionData.api_key}:${sessionData.api_secret}`,
                    'Accept': 'application/json'
                }
            }
        );

        // Handle file attachments if any
        if (taskData.files && taskData.files.length > 0) {
            await handleFileUploads(taskData.files, response.data.data.name, sessionData);
        }

        return {
            success: true,
            taskId: response.data.data.name,
            message: 'Task created successfully!'
        };
    } catch (error) {
        console.error('Error creating task in ERPNext:', error);
        return {
            success: false,
            error: error.response?.data?.message || 'Failed to create task'
        };
    }
};

// Handle file uploads to ERPNext
const handleFileUploads = async (files, taskId, sessionData) => {
    // This is a simplified example. In a real implementation, you would:
    // 1. Download the file from Telegram
    // 2. Upload it to your server or directly to ERPNext
    // 3. Attach it to the task
    
    // For demonstration, we'll just log the files
    console.log(`Files to attach to task ${taskId}:`, files);
};

// Clean up task state
const cleanupTaskState = (userId) => {
    delete taskStates[userId];
};

module.exports = {
    startTaskCreation,
    handleTaskStep,
    handleFileAttachment,
    createTaskInERPNext,
    cleanupTaskState,
    taskStates
};
