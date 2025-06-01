"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocketHandlers = void 0;
const axios_1 = __importDefault(require("axios"));
const auth_1 = require("./middleware/auth");
const types_1 = require("./types");
const sessionManager_1 = require("./services/sessionManager");
const redisService_1 = require("./services/redisService");
const crypto_1 = __importDefault(require("crypto"));
const onlineStatusTimers = new Map();
let sessionManager;
async function updateProfileOnlineStatus(socket, profileId) {
    try {
        const user = socket.data.user;
        if (!user || !user.alphaDateToken) {
            console.error('User not authenticated with Alpha Date:', {
                socketId: socket.id,
                hasUser: !!user,
                hasToken: !!user?.alphaDateToken
            });
            return;
        }
        console.log('User object for online status update:', {
            operatorId: user.operatorId,
            hasOperatorId: !!user.operatorId,
            operatorIdType: typeof user.operatorId,
            email: user.email,
            hasAlphaDateToken: !!user.alphaDateToken
        });
        const payload = {
            external_id: -1,
            operator_id: user.operatorId,
            status: 1
        };
        console.log('Updating profile online status:', payload);
        const response = await axios_1.default.post('https://alpha.date/api/operator/setProfileOnline', payload, {
            headers: {
                'Authorization': `Bearer ${user.alphaDateToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Online status update response:', {
            status: response.status,
            data: response.data
        });
        if (response.status !== 200) {
            throw new Error(`Failed to update online status: ${response.status} ${response.statusText}`);
        }
        // Send checkClick request
        const checkClickPayload = {
            status: true,
            update: true
        };
        console.log('Sending checkClick request:', checkClickPayload);
        const checkClickResponse = await axios_1.default.post('https://alpha.date/api/operator/checkClick', checkClickPayload, {
            headers: {
                'Authorization': `Bearer ${user.alphaDateToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('CheckClick response:', {
            status: checkClickResponse.status,
            data: checkClickResponse.data
        });
        if (checkClickResponse.status !== 200) {
            throw new Error(`Failed to send checkClick: ${checkClickResponse.status} ${checkClickResponse.statusText}`);
        }
    }
    catch (error) {
        console.error('Error in status update:', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
function startOnlineStatusTimer(socket, profileId, operatorId) {
    const user = socket.data.user;
    if (!user || !user.alphaDateToken) {
        console.error('Cannot start online status timer: User not authenticated');
        return;
    }
    // Clear any existing timer for this profile
    const existingTimer = onlineStatusTimers.get(profileId);
    if (existingTimer) {
        clearInterval(existingTimer.timer);
    }
    // Initial update
    updateProfileOnlineStatus(socket, profileId);
    // Set up periodic updates (every 1 minute and 55 seconds)
    const timer = setInterval(() => {
        updateProfileOnlineStatus(socket, profileId);
    }, 115000); // 1 minute and 55 seconds in milliseconds
    // Store the timer reference
    onlineStatusTimers.set(profileId, {
        timer,
        operatorId
    });
    // Clean up timer when socket disconnects
    socket.on('disconnect', () => {
        const timer = onlineStatusTimers.get(profileId);
        if (timer) {
            clearInterval(timer.timer);
            onlineStatusTimers.delete(profileId);
        }
    });
}
const setupSocketHandlers = (io) => {
    // Initialize session manager
    sessionManager = new sessionManager_1.SessionManager(io);
    sessionManager.initialize().catch(console.error);
    // Middleware for authentication
    io.use(async (socket, next) => {
        try {
            console.log('Socket auth attempt:', {
                id: socket.id,
                hasToken: !!socket.handshake.auth.token,
                hasAuthHeader: !!socket.handshake.headers.authorization
            });
            const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
            if (!token) {
                console.log('Socket auth failed: No token provided');
                return next(new Error('Authentication token required'));
            }
            const decoded = await (0, auth_1.verifyToken)(token);
            console.log('Socket auth successful:', {
                id: socket.id,
                operatorId: decoded.operatorId
            });
            socket.data.user = decoded;
            next();
        }
        catch (error) {
            console.error('Socket auth error:', error);
            next(new Error('Invalid authentication token'));
        }
    });
    io.on('connection', async (socket) => {
        const user = socket.data.user;
        console.log('Client connected:', {
            id: socket.id,
            operatorId: user?.operatorId
        });
        // Register device with session manager
        let deviceId = null;
        if (user?.operatorId) {
            try {
                deviceId = await sessionManager.registerDevice(socket, user.operatorId);
                socket.emit('deviceRegistered', { deviceId });
            }
            catch (error) {
                console.error('Failed to register device:', error);
            }
        }
        // Initialize sender list once when socket connects
        if (user?.alphaDateToken && user?.profiles) {
            try {
                const payload = {
                    external_id: user.profiles
                };
                console.log('Initializing sender list:', payload);
                const response = await axios_1.default.post('https://alpha.date/api/v3/search/senderList', payload, {
                    headers: {
                        'Authorization': `Bearer ${user.alphaDateToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                console.log('Sender list initialization response:', {
                    status: response.status,
                    data: response.data
                });
                if (response.status !== 200) {
                    console.error('Failed to initialize sender list:', response.statusText);
                }
            }
            catch (error) {
                console.error('Error initializing sender list:', {
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
        socket.on('startProcessing', async ({ profileId, type, message, operatorId }) => {
            console.log('Received startProcessing event:', {
                socketId: socket.id,
                profileId,
                type,
                messageLength: message?.length,
                operatorId,
                hasUser: !!socket.data.user,
                hasToken: !!socket.data.user?.alphaDateToken
            });
            if (!user?.operatorId) {
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            // Try to start processing through session manager
            const result = await sessionManager.startProcessing(socket, user.operatorId, profileId, type, message);
            if (!result.success) {
                socket.emit('error', {
                    message: result.reason,
                    lockOwner: result.lockOwner
                });
                return;
            }
            // Start online status updates for this profile
            if (operatorId) {
                console.log('Starting online status updates for profile:', profileId);
                startOnlineStatusTimer(socket, profileId, operatorId);
            }
            try {
                console.log(`Starting ${type} processing for profile ${profileId}`);
                if (type === 'chat') {
                    console.log('Starting chat message processing...');
                    await processChatMessages(socket, profileId, message, user.operatorId);
                }
                else {
                    console.log('Starting mail message processing...');
                    await processMailMessages(socket, profileId, message, user.operatorId);
                }
                // Complete processing through session manager
                await sessionManager.completeProcessing(user.operatorId, profileId, type);
                console.log(`Processing complete for ${type}`, {
                    socketId: socket.id,
                    profileId,
                    type
                });
            }
            catch (error) {
                console.error(`Error in ${type} processing:`, {
                    socketId: socket.id,
                    profileId,
                    type,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                // Stop processing through session manager on error
                await sessionManager.stopProcessing(socket, user.operatorId, profileId, type);
                socket.emit('error', {
                    message: `Failed to process ${type}: ${error instanceof Error ? error.message : 'Unknown error'}`
                });
            }
        });
        socket.on('stopProcessing', async (data) => {
            console.log('Stop processing request received:', data);
            const { type, profileId } = data;
            if (!user?.operatorId) {
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            const result = await sessionManager.stopProcessing(socket, user.operatorId, profileId, type);
            if (!result.success) {
                socket.emit('error', { message: result.reason });
                return;
            }
            console.log('Processing stopped successfully:', { profileId, type });
        });
        // Message synchronization events
        socket.on('updateMessage', async (data) => {
            console.log('Message update received:', data);
            const { profileId, type, message } = data;
            if (!user?.operatorId) {
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            await sessionManager.updateMessage(socket, user.operatorId, profileId, type, message);
        });
        socket.on('clearMessage', async (data) => {
            console.log('Message clear received:', data);
            const { profileId, type } = data;
            if (!user?.operatorId) {
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            await sessionManager.clearMessage(socket, user.operatorId, profileId, type);
        });
        socket.on('clearBlocklist', async (data) => {
            console.log('Blocklist clear received:', data);
            const { profileId, type } = data;
            if (!user?.operatorId) {
                socket.emit('error', { message: 'User not authenticated' });
                return;
            }
            const result = await sessionManager.clearBlocklist(socket, user.operatorId, profileId, type);
            if (result.success) {
                socket.emit('blocklistCleared', {
                    profileId,
                    type,
                    deletedCount: result.deletedCount,
                    message: `Cleared ${result.deletedCount} blocked recipients`
                });
            }
            else {
                socket.emit('error', { message: result.reason || 'Failed to clear blocklist' });
            }
        });
        socket.on('disconnect', async () => {
            console.log('Client disconnected:', {
                id: socket.id,
                operatorId: user?.operatorId
            });
            // Unregister device from session manager
            if (user?.operatorId) {
                try {
                    await sessionManager.unregisterDevice(socket, user.operatorId);
                }
                catch (error) {
                    console.error('Failed to unregister device:', error);
                }
            }
        });
    });
};
exports.setupSocketHandlers = setupSocketHandlers;
async function processChatMessages(socket, profileId, message, operatorId) {
    console.log('Starting chat message processing with profileId:', profileId);
    try {
        // Initial progress update
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
            current: 0,
            total: 0,
            message: 'Starting chat processing...'
        });
        const user = socket.data.user;
        if (!user || !user.alphaDateToken) {
            console.error('User not authenticated with Alpha Date:', {
                socketId: socket.id,
                hasUser: !!user,
                hasToken: !!user?.alphaDateToken
            });
            throw new Error('User not authenticated with Alpha Date');
        }
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
            current: 0,
            total: 0,
            message: 'Fetching chats from Alpha Date...'
        });
        const chatListPayload = {
            user_id: profileId.toString(),
            chat_uid: false,
            page: 1,
            freeze: true,
            limits: null,
            ONLINE_STATUS: 1,
            SEARCH: "",
            CHAT_TYPE: "CHANCE"
        };
        console.log('Chat list request payload:', chatListPayload);
        // Fetch chats from Alpha Date
        const chatsResponse = await axios_1.default.post('https://alpha.date/api/chatList/chatListByUserID', chatListPayload, {
            headers: {
                'Authorization': `Bearer ${user.alphaDateToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Chats response:', {
            status: chatsResponse.status,
            headers: chatsResponse.headers,
            data: chatsResponse.data,
            hasResponse: chatsResponse.data && 'response' in chatsResponse.data,
            responseType: chatsResponse.data ? typeof chatsResponse.data.response : 'undefined',
            responseLength: Array.isArray(chatsResponse.data?.response) ? chatsResponse.data.response.length : 'not array'
        });
        if (chatsResponse.status !== 200) {
            throw new Error(`Failed to fetch chats: ${chatsResponse.status} ${chatsResponse.statusText}`);
        }
        if (!chatsResponse.data || !Array.isArray(chatsResponse.data.response)) {
            console.error('Invalid response format:', chatsResponse.data);
            throw new Error('Invalid response format from Alpha Date');
        }
        const chats = chatsResponse.data.response;
        // Create message hash for blocklist tracking
        const messageHash = crypto_1.default.createHash('md5').update(message).digest('hex');
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
            current: 0,
            total: chats.length,
            message: `Found ${chats.length} chats to process`
        });
        console.log(`📋 Found ${chats.length} chats to process for profile ${profileId}`);
        if (chats.length === 0) {
            await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                current: 0,
                total: 0,
                message: `⚠️ No chats found for profile ${profileId}`,
                error: false
            });
            return;
        }
        // Process each chat
        let processedCount = 0;
        let skippedCount = 0;
        let sentCount = 0;
        for (const chat of chats) {
            try {
                processedCount++;
                await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                    current: processedCount,
                    total: chats.length,
                    message: `Processing chat ${chat.chat_uid}... (${processedCount}/${chats.length})`
                });
                // Get chat history to determine sender and recipient
                const chatHistoryPayload = {
                    chat_id: chat.chat_uid,
                    page: 1
                };
                console.log('Fetching chat history with payload:', chatHistoryPayload);
                await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                    current: 0,
                    total: chats.length,
                    message: `Fetching chat history for ${chat.chat_uid}...`
                });
                const chatHistoryResponse = await axios_1.default.post('https://alpha.date/api/chatList/chatHistory', chatHistoryPayload, {
                    headers: {
                        'Authorization': `Bearer ${user.alphaDateToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                console.log('Chat history response:', {
                    status: chatHistoryResponse.status,
                    data: chatHistoryResponse.data,
                    hasResponse: chatHistoryResponse.data && 'response' in chatHistoryResponse.data,
                    responseLength: Array.isArray(chatHistoryResponse.data?.response) ? chatHistoryResponse.data.response.length : 'not array',
                    chatUid: chat.chat_uid
                });
                if (!chatHistoryResponse.data || !Array.isArray(chatHistoryResponse.data.response)) {
                    console.error('Invalid chat history response:', chatHistoryResponse.data);
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: 0,
                        total: chats.length,
                        message: `Failed to get chat history for ${chat.chat_uid}`,
                        error: true
                    });
                    continue;
                }
                const chatMessages = chatHistoryResponse.data.response;
                console.log(`💬 Found ${chatMessages.length} messages in chat ${chat.chat_uid}`);
                // Log the first few messages to understand the structure
                console.log('Sample messages structure:', {
                    chatUid: chat.chat_uid,
                    totalMessages: chatMessages.length,
                    firstMessage: chatMessages[0] ? {
                        sender_external_id: chatMessages[0].sender_external_id,
                        recipient_external_id: chatMessages[0].recipient_external_id,
                        message_content: chatMessages[0].message_content?.substring(0, 30) + '...',
                        allFields: Object.keys(chatMessages[0])
                    } : 'no messages',
                    lastMessage: chatMessages[chatMessages.length - 1] ? {
                        sender_external_id: chatMessages[chatMessages.length - 1].sender_external_id,
                        recipient_external_id: chatMessages[chatMessages.length - 1].recipient_external_id,
                        message_content: chatMessages[chatMessages.length - 1].message_content?.substring(0, 30) + '...'
                    } : 'no messages'
                });
                if (chatMessages.length === 0) {
                    console.log(`⚠️ No messages found in chat ${chat.chat_uid}, skipping...`);
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: 0,
                        total: chats.length,
                        message: `⚠️ No messages in chat ${chat.chat_uid}, skipping...`,
                        error: false
                    });
                    continue;
                }
                // Find the most recent message (last in the array)
                const lastMessage = chatMessages[chatMessages.length - 1];
                console.log('Last message analysis:', {
                    found: !!lastMessage,
                    chatUid: chat.chat_uid,
                    lastMessageSender: lastMessage?.sender_external_id,
                    lastMessageRecipient: lastMessage?.recipient_external_id,
                    lastMessageContent: lastMessage?.message_content?.substring(0, 50) + '...',
                    ourProfileId: profileId,
                    willSendTo: lastMessage?.recipient_external_id,
                    messageIndex: chatMessages.length - 1,
                    totalMessages: chatMessages.length
                });
                if (!lastMessage) {
                    console.error('No messages found in chat history at all');
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: 0,
                        total: chats.length,
                        message: `No messages found in chat ${chat.chat_uid}`,
                        error: true
                    });
                    continue;
                }
                // Use the recipient from the last message as our recipient
                const recipientId = lastMessage.recipient_external_id;
                console.log('Processing chat:', {
                    chatUid: chat.chat_uid,
                    lastMessageSender: lastMessage.sender_external_id,
                    lastMessageRecipient: lastMessage.recipient_external_id,
                    lastMessageContent: lastMessage.message_content?.substring(0, 50) + '...',
                    ourProfileId: profileId,
                    recipientForNewMessage: recipientId
                });
                // Check if we already sent a message to this recipient
                const alreadySent = await redisService_1.redisService.wasMessageSent(operatorId, profileId, recipientId.toString(), 'chat');
                if (alreadySent) {
                    console.log(`⏭️ Skipping chat ${chat.chat_uid} - already sent message to recipient ${recipientId}`);
                    skippedCount++;
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: processedCount,
                        total: chats.length,
                        message: `⏭️ Skipped ${chat.chat_uid} - already contacted (${processedCount}/${chats.length})`
                    });
                    continue;
                }
                await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                    current: processedCount,
                    total: chats.length,
                    message: `Sending message to chat ${chat.chat_uid}...`
                });
                const messagePayload = {
                    sender_id: profileId.toString(), // Use the original profileId
                    recipient_id: recipientId.toString(), // Convert to string for consistency
                    message_content: message,
                    message_type: "SENT_TEXT",
                    filename: "",
                    chance: true
                };
                console.log('Message send request payload:', messagePayload);
                const response = await axios_1.default.post('https://alpha.date/api/chat/message', messagePayload, {
                    headers: {
                        'Authorization': `Bearer ${user.alphaDateToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                console.log('Message send response:', {
                    chatUid: chat.chat_uid,
                    status: response.status,
                    data: response.data,
                    dataType: typeof response.data,
                    hasStatus: 'status' in response.data,
                    statusValue: response.data.status,
                    hasError: 'error' in response.data,
                    hasTitle: 'title' in response.data,
                    fullResponse: JSON.stringify(response.data, null, 2)
                });
                // Mark as sent regardless of success/failure to prevent retries
                await redisService_1.redisService.markMessageSent(operatorId, profileId, recipientId.toString(), 'chat', messageHash);
                if (response.status !== 200) {
                    console.error('Failed to send message to chat:', {
                        chatUid: chat.chat_uid,
                        status: response.status,
                        data: response.data
                    });
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: processedCount,
                        total: chats.length,
                        message: `❌ Failed to send: HTTP ${response.status} (${processedCount}/${chats.length})`,
                        error: true
                    });
                    continue;
                }
                // Check if the API response indicates success
                let messageSuccess = false;
                let errorMessage = '';
                if (response.data && typeof response.data === 'object') {
                    if (response.data.status === true) {
                        messageSuccess = true;
                    }
                    else if (response.data.status === false) {
                        errorMessage = response.data.error || response.data.title || response.data.message || 'Unknown error from API';
                    }
                    else {
                        // Some APIs might return success differently
                        messageSuccess = true; // Assume success if no explicit error
                    }
                }
                else {
                    // If response.data is not an object, assume success
                    messageSuccess = true;
                }
                console.log('Message send result analysis:', {
                    chatUid: chat.chat_uid,
                    messageSuccess,
                    errorMessage,
                    responseData: response.data
                });
                if (messageSuccess) {
                    sentCount++;
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: processedCount,
                        total: chats.length,
                        message: `✅ Sent to ${chat.chat_uid} (${sentCount} sent, ${skippedCount} skipped, ${processedCount}/${chats.length})`,
                        error: false
                    });
                }
                else {
                    console.error(`❌ Failed to send message to chat ${chat.chat_uid}:`, errorMessage);
                    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                        current: processedCount,
                        total: chats.length,
                        message: `❌ Failed: ${errorMessage} (${processedCount}/${chats.length})`,
                        error: true
                    });
                }
                // Add a small delay between messages
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                console.error('Error sending message to chat:', {
                    chatUid: chat.chat_uid,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                // Mark as sent even on error to prevent retries
                await redisService_1.redisService.markMessageSent(operatorId, profileId, recipientId.toString(), 'chat', messageHash);
                await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                    current: processedCount,
                    total: chats.length,
                    message: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'} (${processedCount}/${chats.length})`,
                    error: true
                });
            }
        }
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
            current: chats.length,
            total: chats.length,
            message: `🏁 Completed: ${sentCount} sent, ${skippedCount} skipped, ${chats.length - sentCount - skippedCount} failed`,
            error: false
        });
        console.log(`🏁 Chat processing completed for profile ${profileId}:`, {
            totalChats: chats.length,
            sentCount,
            skippedCount,
            failedCount: chats.length - sentCount - skippedCount,
            successRate: chats.length > 0 ? `${Math.round((sentCount / chats.length) * 100)}%` : '0%',
            profileId
        });
    }
    catch (error) {
        console.error('Error processing chat messages:', {
            socketId: socket.id,
            profileId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}
async function processMailMessages(socket, profileId, message, operatorId) {
    console.log('Starting mail message processing:', {
        socketId: socket.id,
        profileId,
        messageLength: message.length
    });
    const stateKey = `${socket.id}-${profileId}-mail`;
    let state = types_1.processingStates.get(stateKey);
    if (!state) {
        state = { isProcessing: true, current: 0, total: 0 };
        types_1.processingStates.set(stateKey, state);
    }
    try {
        // Fetch mail for the profile
        socket.emit('progress', {
            profileId,
            type: 'mail',
            progress: {
                message: 'Fetching mail...',
                current: 0,
                total: 0
            }
        });
        const user = socket.data.user;
        if (!user || !user.alphaDateToken) {
            console.error('User not authenticated with Alpha Date:', {
                socketId: socket.id,
                hasUser: !!user,
                hasToken: !!user?.alphaDateToken
            });
            throw new Error('User not authenticated with Alpha Date');
        }
        console.log('Fetching mail from Alpha Date...');
        const mailListPayload = {
            user_id: profileId,
            chat_uid: false,
            page: 1,
            freeze: true,
            limits: null,
            ONLINE_STATUS: 1,
            SEARCH: "",
            CHAT_TYPE: "CHANCE"
        };
        console.log('Mail list request payload:', mailListPayload);
        // Fetch mail from Alpha Date
        const mailResponse = await axios_1.default.post('https://alpha.date/api/chatList/chatListByUserID', mailListPayload, {
            headers: {
                'Authorization': `Bearer ${user.alphaDateToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Mail response:', {
            status: mailResponse.status,
            data: mailResponse.data
        });
        if (mailResponse.status !== 200) {
            throw new Error(`Failed to fetch mail: ${mailResponse.status} ${mailResponse.statusText}`);
        }
        if (!mailResponse.data || !Array.isArray(mailResponse.data.response)) {
            console.error('Invalid response format:', mailResponse.data);
            throw new Error('Invalid response format from Alpha Date');
        }
        const mailItems = mailResponse.data.response;
        state.total = mailItems.length;
        // Create message hash for blocklist tracking
        const messageHash = crypto_1.default.createHash('md5').update(message).digest('hex');
        console.log(`Found ${mailItems.length} mail items to process`);
        // Process each mail
        for (const mail of mailItems) {
            if (!state.isProcessing) {
                console.log('Processing stopped by user');
                break;
            }
            try {
                console.log('Processing mail:', {
                    recipientId: mail.recipient_external_id,
                    senderId: mail.sender_external_id
                });
                // Step 1: Create draft
                const draftPayload = {
                    user_id: profileId,
                    recipients: [mail.recipient_external_id],
                    message_content: message,
                    attachments: []
                };
                console.log('Draft creation request payload:', draftPayload);
                const draftResponse = await axios_1.default.post('https://alpha.date/api/mailbox/adddraft', draftPayload, {
                    headers: {
                        'Authorization': `Bearer ${user.alphaDateToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (draftResponse.status !== 200) {
                    socket.emit('progress', {
                        profileId,
                        type: 'mail',
                        progress: {
                            message: 'Failed to create draft',
                            current: state.current,
                            total: state.total,
                            error: true
                        }
                    });
                    throw new Error('Draft creation failed');
                }
                const draftId = draftResponse.data.result[0];
                console.log('Draft created with ID:', draftId);
                // Step 2: Send mail
                const mailSendPayload = {
                    user_id: profileId,
                    recipients: [mail.recipient_external_id],
                    message_content: message,
                    message_type: "SENT_TEXT",
                    attachments: [],
                    parent_mail_id: null,
                    is_send_email: false
                };
                console.log('Mail send request payload:', mailSendPayload);
                const mailSendResponse = await axios_1.default.post('https://alpha.date/api/mailbox/mail', mailSendPayload, {
                    headers: {
                        'Authorization': `Bearer ${user.alphaDateToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                if (mailSendResponse.status !== 200) {
                    socket.emit('progress', {
                        profileId,
                        type: 'mail',
                        progress: {
                            message: 'Failed to send mail',
                            current: state.current,
                            total: state.total,
                            error: true
                        }
                    });
                    throw new Error('Mail sending failed');
                }
                if (mailSendResponse.data.status === true) {
                    state.current++;
                    socket.emit('progress', {
                        profileId,
                        type: 'mail',
                        progress: {
                            message: `Successfully sent mail to ${mail.recipient_external_id}`,
                            current: state.current,
                            total: state.total,
                            error: false
                        }
                    });
                }
                else {
                    socket.emit('progress', {
                        profileId,
                        type: 'mail',
                        progress: {
                            message: mailSendResponse.data.error || mailSendResponse.data.title || 'Failed to send mail',
                            current: state.current,
                            total: state.total,
                            error: true
                        }
                    });
                }
                // Step 3: Delete draft
                const deleteDraftPayload = {
                    user_id: profileId,
                    draft_ids: [draftId]
                };
                console.log('Delete draft request payload:', deleteDraftPayload);
                await axios_1.default.post('https://alpha.date/api/mailbox/deletedraft', deleteDraftPayload, {
                    headers: {
                        'Authorization': `Bearer ${user.alphaDateToken}`,
                        'Content-Type': 'application/json'
                    }
                });
                // Add a small delay between messages
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            catch (error) {
                console.error('Error sending mail to:', {
                    recipientId: mail.recipient_external_id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                socket.emit('progress', {
                    profileId,
                    type: 'mail',
                    progress: {
                        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        current: state.current,
                        total: state.total,
                        error: true
                    }
                });
            }
        }
    }
    catch (error) {
        console.error('Error processing mail messages:', {
            socketId: socket.id,
            profileId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        throw error;
    }
}
