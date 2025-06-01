import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import axios from 'axios';
import { AppError } from './middleware/errorHandler';
import { verifyToken } from './middleware/auth';
import { processingStates, ProcessingState } from './types';
import { SessionManager } from './services/sessionManager';
import { redisService } from './services/redisService';
import crypto from 'crypto';

// Delay constants (in milliseconds)
const PAGE_INCREMENT_DELAY = 4000;  // 4 seconds delay between page requests
const MESSAGE_DELAY = 8000;         // 8 seconds delay between sending messages
const CYCLE_DELAY = 45000;          // 45 seconds delay between cycles
const ERROR_RETRY_DELAY = 50000;     // 50 seconds delay for error retries

// API Configuration
const API_CONFIG = {
  endpoints: {
    chatListByUserID: 'https://alpha.date/api/chatList/chatListByUserID',
    chatHistory: 'https://alpha.date/api/chatList/chatHistory',
    sendMessage: 'https://alpha.date/api/chat/message',
    sendMail: 'https://alpha.date/api/mailbox/mail',
    senderList: 'https://alpha.date/api/v3/search/senderList',
    setProfileOnline: 'https://alpha.date/api/operator/setProfileOnline',
    checkClick: 'https://alpha.date/api/operator/checkClick'
  },
  statusCodes: {
    OK: 200,
    NOT_MODIFIED: 304,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    RATE_LIMITED: 429
  },
  errors: {
    RESTRICTION_ERROR_MESSAGE: "Restriction of sending a personal message. Try when the list becomes active",
    RESTRICTION_ERROR_MAIL: "Restriction of sending a personal letter. Try when the list becomes active",
    RATE_LIMIT_MESSAGE: "⏳ Rate limited, waiting 50 seconds...",
    CRITICAL_ERROR_PREFIX: "❌ Critical error",
    NOT_YOUR_PROFILE: "Not your profile"
  },
  delays: {
    PAGE_INCREMENT: PAGE_INCREMENT_DELAY,
    MESSAGE: MESSAGE_DELAY,
    CYCLE: CYCLE_DELAY,
    ERROR_RETRY: ERROR_RETRY_DELAY,
    RATE_LIMIT: 50000  // 50 seconds for rate limit retry
  }
};

interface ChatMessage {
  chat_uid: string;
  recipient_external_id: string;
  message_content: string;
}

interface ChatResponse {
  status: boolean;
  message: string;
}

interface OnlineStatusTimer {
  timer: NodeJS.Timeout;
  operatorId: string;
}

const onlineStatusTimers = new Map<string, OnlineStatusTimer>();
let sessionManager: SessionManager;

async function updateProfileOnlineStatus(socket: Socket, profileId: string) {
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

    const response = await axios.post(
      API_CONFIG.endpoints.setProfileOnline,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${user.alphaDateToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Online status update response:', {
      status: response.status,
      data: response.data
    });

    if (response.status !== API_CONFIG.statusCodes.OK) {
      throw new Error(`Failed to update online status: ${response.status} ${response.statusText}`);
    }

    // Send checkClick request
    const checkClickPayload = {
      status: true,
      update: true
    };

    console.log('Sending checkClick request:', checkClickPayload);

    const checkClickResponse = await axios.post(
      API_CONFIG.endpoints.checkClick,
      checkClickPayload,
      {
        headers: {
          'Authorization': `Bearer ${user.alphaDateToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('CheckClick response:', {
      status: checkClickResponse.status,
      data: checkClickResponse.data
    });

    if (checkClickResponse.status !== API_CONFIG.statusCodes.OK && 
        checkClickResponse.status !== API_CONFIG.statusCodes.NOT_MODIFIED) {
      throw new Error(`Failed to send checkClick: ${checkClickResponse.status} ${checkClickResponse.statusText}`);
    }
  } catch (error) {
    console.error('Error in status update:', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

function startOnlineStatusTimer(socket: Socket, profileId: string, operatorId: string) {
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

export const setupSocketHandlers = (io: Server) => {
  // Initialize session manager
  sessionManager = new SessionManager(io);
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

      const decoded = await verifyToken(token);
      console.log('Socket auth successful:', {
        id: socket.id,
        operatorId: decoded.operatorId
      });
      socket.data.user = decoded;
      next();
    } catch (error) {
      console.error('Socket auth error:', error);
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user;
    console.log('Client connected:', {
      id: socket.id,
      operatorId: user?.operatorId
    });

    // Register device with session manager
    let deviceId: string | null = null;
    if (user?.operatorId) {
      try {
        deviceId = await sessionManager.registerDevice(socket, user.operatorId);
        socket.emit('deviceRegistered', { deviceId });
      } catch (error) {
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

        const response = await axios.post(
          API_CONFIG.endpoints.senderList,
          payload,
          {
            headers: {
              'Authorization': `Bearer ${user.alphaDateToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('Sender list initialization response:', {
          status: response.status,
          data: response.data
        });

        if (response.status !== API_CONFIG.statusCodes.OK) {
          console.error('Failed to initialize sender list:', response.statusText);
        }
      } catch (error) {
        console.error('Error initializing sender list:', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    socket.on('startProcessing', async ({ profileId, type, message, operatorId, attachments }) => {
      console.log('Received startProcessing event:', {
        socketId: socket.id,
        profileId,
        type,
        messageLength: message.length,
        hasAttachments: !!attachments,
        attachmentsPreview: Array.isArray(attachments) ? attachments.slice(0, 3) : attachments
      });

      // Store attachments in socket data
      socket.data.attachments = attachments || [];
      console.log('Stored attachments in socket.data.attachments:', Array.isArray(socket.data.attachments) ? socket.data.attachments.slice(0, 3) : socket.data.attachments);

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
        } else {
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
      } catch (error) {
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

    socket.on('stopProcessing', async (data: { type: 'chat' | 'mail', profileId: string }) => {
      console.log('Stop processing request received:', {
        ...data,
        operatorId: user?.operatorId,
        socketId: socket.id
      });

      if (!user?.operatorId) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      try {
        const result = await sessionManager.stopProcessing(socket, user.operatorId, data.profileId, data.type);
      
        if (!result.success) {
          console.error('Failed to stop processing:', result.reason);
          socket.emit('error', { message: result.reason });
          return;
        }

        // Get device ID from session
        const deviceId = sessionManager.getDeviceIdForSocket(socket.id);
        if (!deviceId) {
          console.error('No device ID found in session');
          socket.emit('error', { message: 'Device not registered' });
          return;
        }

        // Emit success event with device information
        socket.emit('processingStopped', {
          profileId: data.profileId,
          type: data.type,
          deviceId,
          stoppedBy: deviceId,
          message: 'Processing stopped successfully',
          stoppedAt: Date.now()
        });

        console.log('Processing stopped successfully:', { 
          profileId: data.profileId, 
          type: data.type,
          operatorId: user.operatorId,
          deviceId
        });
      } catch (error) {
        console.error('Error in stopProcessing handler:', error);
        socket.emit('error', { 
          message: 'Failed to stop processing: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
      }
    });

    socket.on('stopAllProcessing', async () => {
      console.log('Stop all processing request received:', {
        operatorId: user?.operatorId,
        socketId: socket.id
      });

      if (!user?.operatorId) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      try {
        // Get device ID from session
        const deviceId = sessionManager.getDeviceIdForSocket(socket.id);
        if (!deviceId) {
          console.error('No device ID found in session');
          socket.emit('error', { message: 'Device not registered' });
          return;
        }

        // Stop all processing through session manager
        const result = await sessionManager.stopAllProcessing(socket, user.operatorId);
        
        if (!result.success) {
          console.error('Failed to stop all processing:', result.reason);
          socket.emit('error', { message: result.reason });
          return;
        }

        // Emit success event
        socket.emit('allProcessingStopped', {
          deviceId,
          stoppedBy: deviceId,
          message: 'All processing stopped successfully',
          stoppedAt: Date.now(),
          stoppedProfiles: result.stoppedProfiles
        });

        console.log('All processing stopped successfully:', { 
          operatorId: user.operatorId,
          deviceId,
          stoppedProfiles: result.stoppedProfiles
        });
      } catch (error) {
        console.error('Error in stopAllProcessing handler:', error);
        socket.emit('error', { 
          message: 'Failed to stop all processing: ' + (error instanceof Error ? error.message : 'Unknown error')
        });
      }
    });

    // Message synchronization events
    socket.on('updateMessage', async (data: { profileId: string, type: 'chat' | 'mail', message: string }) => {
      console.log('Message update received:', data);
      const { profileId, type, message } = data;

      if (!user?.operatorId) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      await sessionManager.updateMessage(socket, user.operatorId, profileId, type, message);
    });

    socket.on('clearMessage', async (data: { profileId: string, type: 'chat' | 'mail' }) => {
      console.log('Message clear received:', data);
      const { profileId, type } = data;

      if (!user?.operatorId) {
        socket.emit('error', { message: 'User not authenticated' });
        return;
      }

      await sessionManager.clearMessage(socket, user.operatorId, profileId, type);
    });

    socket.on('clearBlocklist', async (data: { profileId: string, type: 'chat' | 'mail' }) => {
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
      } else {
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
        } catch (error) {
          console.error('Failed to unregister device:', error);
        }
      }
    });
  });
};

// Helper function to find the recipient ID from the last message
function findRecipientId(messages: any[], profileId: string): string | number {
  if (messages.length === 0) {
    console.log('findRecipientId: No messages provided');
    return '';
  }
  
  const lastMessage = messages[messages.length - 1];
  console.log('findRecipientId: Last message structure:', {
    hasRecipientExternalId: !!lastMessage.recipient_external_id,
    hasSenderExternalId: !!lastMessage.sender_external_id,
    recipientExternalId: lastMessage.recipient_external_id,
    senderExternalId: lastMessage.sender_external_id,
    profileId: profileId,
    profileIdType: typeof profileId
  });
  
  // Convert profileId to string for consistent comparison
  const profileIdStr = profileId.toString();
  
  // Determine recipient ID based on who is NOT the current profile
  const recipientID = lastMessage.recipient_external_id?.toString() === profileIdStr 
    ? lastMessage.sender_external_id 
    : lastMessage.recipient_external_id;
  
  console.log(`findRecipientId: Determined recipient ID: ${recipientID}`);
  
  return recipientID || '';
}

// Common utility functions
async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAllPages(
  endpoint: string,
  payload: any,
  token: string,
  operatorId: string,
  profileId: string,
  type: 'chat' | 'mail'
): Promise<any[]> {
  const allItems: any[] = [];
  let currentPage = 1;
  let hasMorePages = true;
  let statusMessage = '';

  while (hasMorePages) {
    let retryCount = 0;
    let pageSuccess = false;
    
    while (!pageSuccess) {
      try {
        await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
          current: 0,
          total: 0,
          message: `🔄 Fetching page ${currentPage}...`
        });

        const response = await axios.post(endpoint, { ...payload, page: currentPage }, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        // Handle rate limiting with retry
        if (response.status === API_CONFIG.statusCodes.RATE_LIMITED) {
          console.log(API_CONFIG.errors.RATE_LIMIT_MESSAGE);
          await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
            current: 0,
            total: 0,
            message: API_CONFIG.errors.RATE_LIMIT_MESSAGE,
            error: false
          });
          await wait(API_CONFIG.delays.RATE_LIMIT);
          continue; // Retry the same page
        }

        // Handle authentication and validation errors
        if (response.status === API_CONFIG.statusCodes.UNAUTHORIZED || 
            response.status === API_CONFIG.statusCodes.BAD_REQUEST ||
            response.data?.error === API_CONFIG.errors.NOT_YOUR_PROFILE) {
          console.error(`${API_CONFIG.errors.CRITICAL_ERROR_PREFIX} ${response.status}: ${response.statusText}`);
          await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
            current: 0,
            total: 0,
            message: `❌ Stopped: ${response.data?.error || response.statusText}`,
            error: true
          });
          throw new Error(`Critical error: ${response.status} ${response.statusText}`);
        }

        if (!response.data || !Array.isArray(response.data.response)) {
          console.error('Invalid response format:', response.data);
          retryCount++;
          if (retryCount > 3) {
            throw new Error('Max retries exceeded for invalid response format');
          }
          await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
            current: 0,
            total: 0,
            message: `⚠️ Invalid response, retry ${retryCount}/3...`,
            error: false
          });
          await wait(5000); // Shorter retry for non-rate-limit errors
          continue;
        }

        const pageItems = response.data.response;
        console.log(`📋 Page ${currentPage} returned ${pageItems.length} items`);
        statusMessage += `📋 Page ${currentPage} returned ${pageItems.length} items\n`;

        if (pageItems.length === 0) {
          console.log(`📋 No more items found, stopping pagination`);
          statusMessage += `📋 No more items found, stopping pagination\n`;
          hasMorePages = false;
        } else {
          allItems.push(...pageItems);
          currentPage++;
          await wait(API_CONFIG.delays.PAGE_INCREMENT);
        }
        
        pageSuccess = true; // Successfully processed this page

      } catch (error) {
        // For critical errors, throw immediately
        if (error instanceof Error && error.message.includes('Critical error')) {
          throw error;
        }
        
        // For other errors, retry a few times
        retryCount++;
        if (retryCount > 3) {
          console.error('Max retries exceeded for page fetch:', error);
          throw error;
        }
        
        console.error(`Error fetching page ${currentPage}, retry ${retryCount}/3:`, error);
        await wait(5000);
      }
    }
  }

  // Send final pagination status
  await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
    current: 0,
    total: 0,
    message: statusMessage.trim()
  });

  return allItems;
}

async function filterAvailableItems(
  items: any[],
  operatorId: string,
  profileId: string,
  type: 'chat' | 'mail',
  blockedRecipients: Set<string>,
  user: any
): Promise<any[]> {
  // First filter Alpha Date blocks
  const alphaDateFiltered = items.filter(item => 
    item.female_block === 0 && item.male_block === 0
  );
  console.log(`📋 Found ${alphaDateFiltered.length} items after Alpha Date block filtering`);
  console.log(`🚫 Loaded blocklist with ${blockedRecipients.size} blocked recipients`);

  // Get chat history for each item to determine recipient
  const availableItems: any[] = [];
  const processedRecipients = new Set<string>();

  for (const item of alphaDateFiltered) {
    try {
      const chatHistoryPayload = { chat_id: item.chat_uid, page: 1 };
      const chatHistoryResponse = await axios.post(
        API_CONFIG.endpoints.chatHistory,
        chatHistoryPayload,
        {
          headers: {
            'Authorization': `Bearer ${user.alphaDateToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!chatHistoryResponse.data || !Array.isArray(chatHistoryResponse.data.response) || chatHistoryResponse.data.response.length === 0) {
        console.log(`⚠️ No messages in ${type} ${item.chat_uid}, skipping...`);
        continue;
      }

      const chatMessages = chatHistoryResponse.data.response;
      const recipientId = findRecipientId(chatMessages, profileId);
      
      if (!recipientId) {
        console.log(`⚠️ Could not find valid recipient in ${type} ${item.chat_uid}, skipping...`);
        continue;
      }

      const recipientIdStr = recipientId.toString();

      // Skip if we've already processed this recipient
      if (processedRecipients.has(recipientIdStr)) {
        console.log(`⏭️ Skipping duplicate recipient ${recipientIdStr} in ${type} ${item.chat_uid}`);
        continue;
      }

      // Skip if recipient is blocked
      if (blockedRecipients.has(recipientIdStr)) {
        console.log(`⏭️ Skipping blocked recipient ${recipientIdStr} in ${type} ${item.chat_uid}`);
        continue;
      }

      // Add to processed recipients set
      processedRecipients.add(recipientIdStr);

      // Add to available items with recipient ID
      availableItems.push({
        ...item,
        recipientId: recipientIdStr
      });

    } catch (error) {
      console.error(`Error getting chat history for ${type} ${item.chat_uid}:`, error);
      continue;
    }
  }

  const statusMessage = `🚫 Loaded blocklist with ${blockedRecipients.size} blocked recipients\n📋 Found ${availableItems.length} items after Alpha Date block filtering`;
  console.log(statusMessage);
  
  // Update processing status with filtering results
  await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
    current: 0,
    total: 0,
    message: statusMessage
  });
  
  return availableItems;
}

async function sendMessage(
  endpoint: string,
  payload: any,
  token: string,
  type: 'chat' | 'mail',
  operatorId: string,
  profileId: string,
  messageHash: string,
  recipientId: string
): Promise<boolean> {
  let retryCount = 0;
  
  while (true) {
    try {
      const response = await axios.post(endpoint, payload, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      // Handle rate limiting with retry
      if (response.status === API_CONFIG.statusCodes.RATE_LIMITED) {
        console.log(API_CONFIG.errors.RATE_LIMIT_MESSAGE);
        await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
              current: 0,
              total: 0,
          message: API_CONFIG.errors.RATE_LIMIT_MESSAGE,
              error: false
            });
        await wait(API_CONFIG.delays.RATE_LIMIT);
        continue; // Retry the same message
      }

      // Handle authentication and validation errors
      if (response.status === API_CONFIG.statusCodes.UNAUTHORIZED || 
          response.status === API_CONFIG.statusCodes.BAD_REQUEST ||
          response.data?.error === API_CONFIG.errors.NOT_YOUR_PROFILE) {
        console.error(`${API_CONFIG.errors.CRITICAL_ERROR_PREFIX} ${response.status}: ${response.statusText}`);
        await sessionManager.updateProcessingProgress(operatorId, profileId, type, {
              current: 0,
              total: 0,
          message: `❌ Stopped: ${response.data?.error || response.statusText}`,
          error: true
        });
        throw new Error(`Critical error: ${response.status} ${response.statusText}`);
      }

      // For chat messages, check restriction error
      if (type === 'chat') {
        const hasRestrictionError = response.data.error === API_CONFIG.errors.RESTRICTION_ERROR_MESSAGE;
        return response.status >= API_CONFIG.statusCodes.OK && 
               response.status < 300 && 
               !hasRestrictionError;
      }

      // For mail, check status and restriction error
      if (type === 'mail') {
        const hasRestrictionError = response.data.error === API_CONFIG.errors.RESTRICTION_ERROR_MAIL;
        return response.status >= API_CONFIG.statusCodes.OK && 
               response.status < 300 && 
               !hasRestrictionError;
      }

      // Default case (should not happen)
      return response.status >= API_CONFIG.statusCodes.OK && response.status < 300;
      
    } catch (error) {
      // For critical errors, throw immediately
      if (error instanceof Error && error.message.includes('Critical error')) {
        throw error;
      }
      
      // For other errors, retry a few times
      retryCount++;
      if (retryCount > 3) {
        console.error('Max retries exceeded for message send:', error);
        return false;
      }
      
      console.error(`Error sending message, retry ${retryCount}/3:`, error);
      await wait(5000);
    }
  }
}

async function processChatMessages(socket: Socket, profileId: string, message: string, operatorId: string) {
  console.log('Starting infinite chat message processing with profileId:', profileId);

  let cycleCount = 0;
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    const user = socket.data.user;
    if (!user || !user.alphaDateToken) {
      throw new Error('User not authenticated with Alpha Date');
    }

    // Create message hash for blocklist tracking
    const messageHash = crypto.createHash('md5').update(message).digest('hex');

    // Infinite processing loop
    while (true) {
      // Check if processing was stopped before starting a new cycle
      const currentState = await sessionManager.getProcessingStatus(operatorId, profileId, 'chat');
      if (!currentState || !currentState.isProcessing) {
        console.log(`⏹️ Processing stopped by user for profile ${profileId}`);
        break;
      }

      cycleCount++;
      console.log(`🔄 Starting chat processing cycle ${cycleCount} for profile ${profileId}`);

      try {
        // 1. Fetch all pages
        const allChats = await fetchAllPages(
          API_CONFIG.endpoints.chatListByUserID,
          {
            user_id: profileId,
            chat_uid: false,
            freeze: true,
            limits: 1,
            ONLINE_STATUS: 1,
            SEARCH: "",
            CHAT_TYPE: "CHANCE"
          },
          user.alphaDateToken,
          operatorId,
          profileId,
          'chat'
        );

        // 2. Load blocklist once for this cycle
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
          current: 0,
          total: 0,
          message: `🔄 Cycle ${cycleCount}: Loading blocklist...`
        });

        const blockedRecipients = await redisService.getBlockedRecipientsSet(operatorId, profileId, 'chat');
        console.log(`🚫 Loaded blocklist with ${blockedRecipients.size} blocked recipients`);

        // 3. Filter available chats
        const availableChats = await filterAvailableItems(
          allChats,
          operatorId,
          profileId,
          'chat',
          blockedRecipients,
          user
        );

        if (availableChats.length === 0) {
          console.log(`⚠️ No available chats found in cycle ${cycleCount}, waiting 50 seconds.`);
          await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
            current: 0,
            total: 0,
            message: `🚫 Filtered out ${allChats.length} unavailable recipients\n📋 Found 0 available recipients to process\n⚠️ No available chats found in cycle ${cycleCount}, waiting 50 seconds...`,
            error: false
          });
          await wait(API_CONFIG.delays.ERROR_RETRY);
          continue;
        }

        // Update status with filtering results
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
          current: 0,
          total: 0,
          message: `🚫 Filtered out ${allChats.length - availableChats.length} unavailable recipients\n📋 Found ${availableChats.length} available recipients to process`
        });

        // 4. Process each chat
        let processedCount = 0;
        let sentCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const chat of availableChats) {
          // Check if processing was stopped before processing each chat
          const currentState = await sessionManager.getProcessingStatus(operatorId, profileId, 'chat');
          if (!currentState || !currentState.isProcessing) {
            console.log(`⏹️ Processing stopped by user during cycle ${cycleCount}`);
            break;
          }

          // Check if recipient is blocked
          if (blockedRecipients.has(chat.recipientId.toString())) {
            console.log(`⏭️ Skipping chat to ${chat.recipientId} - already contacted`);
            skippedCount++;
            totalSkipped++;
            continue;
          }

          let retryCount = 0;
          let messageProcessed = false;
          
          while (!messageProcessed && retryCount < 3) {
            try {
              processedCount++;
              await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
                current: processedCount,
                total: availableChats.length,
                message: `🔄 Cycle ${cycleCount}: Processing chat ${processedCount}/${availableChats.length}`
              });

              // Send message
              const messagePayload = {
                sender_id: profileId.toString(),
                recipient_id: chat.recipientId,
                message_content: message,
                message_type: "SENT_TEXT",
                filename: "",
                chance: true
              };

              const response = await axios.post(
                API_CONFIG.endpoints.sendMessage,
                messagePayload,
                {
                  headers: {
                    'Authorization': `Bearer ${user.alphaDateToken}`,
                    'Content-Type': 'application/json'
                  }
                }
              );

              // Check for successful response and no restriction error
              if (response.status === 200 && response.data?.error !== API_CONFIG.errors.RESTRICTION_ERROR_MESSAGE) {
                // Add recipient to blocklist after successful send
                await redisService.markMessageSent(operatorId, profileId, chat.recipientId, 'chat', messageHash);
                sentCount++;
                totalSent++;
                console.log(`✅ Sent message to chat ${chat.chat_uid} (recipient: ${chat.recipientId})`);
              } else {
                failedCount++;
                totalFailed++;
                console.log(`❌ Failed to send message to chat ${chat.chat_uid}:`, {
                  status: response.status,
                  data: response.data,
                  error: response.data?.error || 'Unknown error'
                });
              }

              messageProcessed = true;

              // Small delay between messages
              await wait(API_CONFIG.delays.MESSAGE);

            } catch (error) {
              retryCount++;
              console.error(`Error processing chat (attempt ${retryCount}/3):`, {
                chatUid: chat.chat_uid,
                error: error instanceof Error ? error.message : 'Unknown error'
              });

              if (error instanceof Error && error.message.includes('Critical error')) {
                throw error;
              }

              if (retryCount >= 3) {
                failedCount++;
                totalFailed++;
                messageProcessed = true; // Give up on this chat
              } else {
                await wait(5000); // Wait before retry
                processedCount--; // Decrement to retry this chat
              }
            }
          }
        }

        // Update cycle completion stats
        totalSkipped += skippedCount;
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
          current: availableChats.length,
          total: availableChats.length,
          message: `🏁 Cycle ${cycleCount} completed. Automatic retry in 50 seconds...`
        });

        console.log(`🏁 Cycle ${cycleCount} completed:`, {
          cycleStats: { sent: sentCount, skipped: skippedCount, failed: failedCount },
          totalStats: { sent: totalSent, skipped: totalSkipped, failed: totalFailed },
          profileId
        });

        // Check if processing was stopped before starting the next cycle
        const finalState = await sessionManager.getProcessingStatus(operatorId, profileId, 'chat');
        if (!finalState || !finalState.isProcessing) {
          console.log(`⏹️ Processing stopped by user after cycle ${cycleCount}`);
          break;
        }

        // Wait before next cycle
        await wait(API_CONFIG.delays.CYCLE);

      } catch (cycleError) {
        console.error(`❌ Error in cycle ${cycleCount}:`, {
          error: cycleError instanceof Error ? cycleError.message : 'Unknown error',
          profileId
        });

        if (cycleError instanceof Error && cycleError.message.includes('Critical error')) {
          await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
            current: 0,
            total: 0,
            message: `❌ Stopped: ${cycleError.message}`,
            error: true
          });
          break;
        }

        await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
          current: 0,
          total: 0,
          message: `⚠️ Cycle ${cycleCount} error, retrying in ${API_CONFIG.delays.ERROR_RETRY / 1000}s...`,
          error: false
        });
        await wait(API_CONFIG.delays.ERROR_RETRY);
      }
    }

    // Final completion message
    await sessionManager.updateProcessingProgress(operatorId, profileId, 'chat', {
      current: totalSent,
      total: totalSent + totalSkipped + totalFailed,
      message: `🏁 Processing completed after ${cycleCount} cycles: ${totalSent} sent, ${totalSkipped} skipped, ${totalFailed} failed`,
      error: false
    });

  } catch (error) {
    console.error('Error in infinite chat processing:', {
      socketId: socket.id,
      profileId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

async function processMailMessages(socket: Socket, profileId: string, message: string, operatorId: string) {
  console.log('Starting infinite mail message processing with profileId:', profileId);

  let cycleCount = 0;
  let totalSent = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  try {
    const user = socket.data.user;
    if (!user || !user.alphaDateToken) {
      throw new Error('User not authenticated with Alpha Date');
    }

    // Create message hash for blocklist tracking
    const messageHash = crypto.createHash('md5').update(message).digest('hex');

    // Get attachments from the client's request
    const attachments = socket.data.attachments || [];
    console.log('processMailMessages: attachments from socket.data.attachments:', Array.isArray(attachments) ? attachments.slice(0, 3) : attachments);

    // Infinite processing loop
    while (true) {
      // Check if processing was stopped before starting a new cycle
      const currentState = await sessionManager.getProcessingStatus(operatorId, profileId, 'mail');
      if (!currentState || !currentState.isProcessing) {
        console.log(`⏹️ Processing stopped by user for profile ${profileId}`);
        break;
      }

      cycleCount++;
      console.log(`🔄 Starting mail processing cycle ${cycleCount} for profile ${profileId}`);

      try {
        // 1. Fetch all pages
        const allMailItems = await fetchAllPages(
          API_CONFIG.endpoints.chatListByUserID,
          {
            user_id: profileId,
            chat_uid: false,
            freeze: true,
            limits: 2,
            ONLINE_STATUS: 1,
            SEARCH: "",
            CHAT_TYPE: "CHANCE"
          },
          user.alphaDateToken,
          operatorId,
          profileId,
          'mail'
        );

        // 2. Load blocklist once for this cycle
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
          current: 0,
          total: 0,
          message: `🔄 Cycle ${cycleCount}: Loading blocklist...`
        });
        
        const blockedRecipients = await redisService.getBlockedRecipientsSet(operatorId, profileId, 'mail');
        console.log(`🚫 Loaded blocklist with ${blockedRecipients.size} blocked recipients`);

        // 3. Filter available mail items
        const availableMailItems = await filterAvailableItems(
          allMailItems,
          operatorId,
          profileId,
          'mail',
          blockedRecipients,
          user
        );

        if (availableMailItems.length === 0) {
          console.log(`⚠️ No available mail items found in cycle ${cycleCount}, waiting 50 seconds.`);
          await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
            current: 0,
            total: 0,
            message: `🚫 Filtered out ${allMailItems.length} unavailable recipients\n📋 Found 0 available recipients to process\n⚠️ No available mail items found in cycle ${cycleCount}, waiting 50 seconds...`,
            error: false
          });
          await wait(API_CONFIG.delays.ERROR_RETRY);
          continue;
        }

        // Update status with filtering results
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
          current: 0,
          total: 0,
          message: `🚫 Filtered out ${allMailItems.length - availableMailItems.length} unavailable recipients\n📋 Found ${availableMailItems.length} available recipients to process`
        });

        // 4. Process each mail
        let processedCount = 0;
        let sentCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const mail of availableMailItems) {
          // Check if processing was stopped before processing each mail
          const currentState = await sessionManager.getProcessingStatus(operatorId, profileId, 'mail');
          if (!currentState || !currentState.isProcessing) {
            console.log(`⏹️ Processing stopped by user during cycle ${cycleCount}`);
            break;
          }

          // Check if recipient is blocked
          if (blockedRecipients.has(mail.recipientId.toString())) {
            console.log(`⏭️ Skipping mail to ${mail.recipientId} - already contacted`);
            skippedCount++;
            totalSkipped++;
            continue;
          }

          let retryCount = 0;
          let messageProcessed = false;
          
          while (!messageProcessed && retryCount < 3) {
            try {
              processedCount++;
              await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
                current: processedCount,
                total: availableMailItems.length,
                message: `🔄 Cycle ${cycleCount}: Processing mail ${processedCount}/${availableMailItems.length}`
              });

              // Send mail directly
              const mailSendPayload = {
                user_id: profileId,
                recipients: [mail.recipientId],
                message_content: message,
                message_type: "SENT_TEXT",
                attachments: attachments,
                parent_mail_id: null,
                is_send_email: false
              };
              console.log('Mail send payload:', JSON.stringify(mailSendPayload, null, 2));

              const mailSendResponse = await axios.post(
                API_CONFIG.endpoints.sendMail,
                mailSendPayload,
                {
                  headers: {
                    'Authorization': `Bearer ${user.alphaDateToken}`,
                    'Content-Type': 'application/json'
                  }
                }
              );

              console.log('Mail send response:', {
                status: mailSendResponse.status,
                statusText: mailSendResponse.statusText,
                data: mailSendResponse.data,
                headers: mailSendResponse.headers
              });

              if (mailSendResponse.status === 200 && mailSendResponse.data?.error !== API_CONFIG.errors.RESTRICTION_ERROR_MAIL) {
                // Add recipient to blocklist after successful send
                await redisService.markMessageSent(operatorId, profileId, mail.recipientId, 'mail', messageHash);
                sentCount++;
                totalSent++;
                console.log(`✅ Sent mail to ${mail.recipientId}`);
              } else {
                failedCount++;
                totalFailed++;
                console.log(`❌ Failed to send mail to ${mail.recipientId}:`, {
                  status: mailSendResponse.status,
                  data: mailSendResponse.data,
                  error: mailSendResponse.data?.error || 'Unknown error'
                });
              }

              messageProcessed = true;

              // Small delay between messages
              await wait(API_CONFIG.delays.MESSAGE);

            } catch (error) {
              retryCount++;
              console.error(`Error processing mail (attempt ${retryCount}/3):`, {
                mailUid: mail.chat_uid,
                error: error instanceof Error ? error.message : 'Unknown error'
              });

              if (error instanceof Error && error.message.includes('Critical error')) {
                throw error;
              }

              if (retryCount >= 3) {
                failedCount++;
                totalFailed++;
                messageProcessed = true; // Give up on this mail
              } else {
                await wait(5000); // Wait before retry
                processedCount--; // Decrement to retry this mail
              }
            }
          }
        }

        // Update cycle completion stats
        totalSkipped += skippedCount;
        await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
          current: availableMailItems.length,
          total: availableMailItems.length,
          message: `🏁 Cycle ${cycleCount} completed. Automatic retry in 50 seconds...`
        });

        console.log(`🏁 Cycle ${cycleCount} completed:`, {
          cycleStats: { sent: sentCount, skipped: skippedCount, failed: failedCount },
          totalStats: { sent: totalSent, skipped: totalSkipped, failed: totalFailed },
          profileId
        });

        // Check if processing was stopped before starting the next cycle
        const finalState = await sessionManager.getProcessingStatus(operatorId, profileId, 'mail');
        if (!finalState || !finalState.isProcessing) {
          console.log(`⏹️ Processing stopped by user after cycle ${cycleCount}`);
          break;
        }

        // Wait before next cycle
        await wait(API_CONFIG.delays.CYCLE);

      } catch (cycleError) {
        console.error(`❌ Error in cycle ${cycleCount}:`, {
          error: cycleError instanceof Error ? cycleError.message : 'Unknown error',
          profileId
        });

        if (cycleError instanceof Error && cycleError.message.includes('Critical error')) {
          await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
            current: 0,
            total: 0,
            message: `❌ Stopped: ${cycleError.message}`,
            error: true
          });
          break;
        }

        await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
          current: 0,
          total: 0,
          message: `⚠️ Cycle ${cycleCount} error, retrying in ${API_CONFIG.delays.ERROR_RETRY / 1000}s...`,
          error: false
        });
        await wait(API_CONFIG.delays.ERROR_RETRY);
      }
    }

    // Final completion message
    await sessionManager.updateProcessingProgress(operatorId, profileId, 'mail', {
      current: totalSent,
      total: totalSent + totalSkipped + totalFailed,
      message: `🏁 Processing completed after ${cycleCount} cycles: ${totalSent} sent, ${totalSkipped} skipped, ${totalFailed} failed`,
      error: false
    });

  } catch (error) {
    console.error('Error in infinite mail processing:', {
      socketId: socket.id,
      profileId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

// Helper function to get attachments
async function getAttachments(profileId: string, token: string): Promise<any[]> {
  try {
    const types = ['images', 'videos', 'audios'];
    const allAttachments: any[] = [];

    for (const type of types) {
      const response = await axios.get(
        `${process.env.ALPHA_DATE_API_URL}/files/${type}?external_id=${profileId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.data.folders && typeof response.data.folders === 'object') {
        const sendFolder = Object.values(response.data.folders).find((folder: unknown) => 
          (folder as { name: string }).name?.toLowerCase() === "send"
        ) as { list: any[] } | undefined;

        if (sendFolder && Array.isArray(sendFolder.list)) {
          allAttachments.push(...sendFolder.list);
        }
      } else if (response.data[type] && Array.isArray(response.data[type])) {
        allAttachments.push(...response.data[type]);
      } else if (response.data.response && Array.isArray(response.data.response)) {
        allAttachments.push(...response.data.response);
      }
    }

    return allAttachments;
  } catch (error) {
    console.error('Error fetching attachments:', error);
    return [];
  }
}

async function updateProcessingProgress(
  operatorId: string,
  profileId: string,
  type: 'chat' | 'mail',
  progress: { current: number; total: number; message: string; error?: boolean }
): Promise<void> {
  await sessionManager.updateProcessingProgress(operatorId, profileId, type, progress);
}