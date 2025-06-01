"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const redisService_1 = require("./redisService");
const uuid_1 = require("uuid");
class SessionManager {
    constructor(io) {
        this.deviceSockets = new Map(); // deviceId -> socket
        this.socketDevices = new Map(); // socketId -> deviceId
        this.operatorSockets = new Map();
        this.initialized = false;
        this.io = io;
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        try {
            await redisService_1.redisService.connect();
            this.initialized = true;
        }
        catch (error) {
            console.error('Failed to initialize SessionManager:', error);
            throw error;
        }
    }
    async registerDevice(socket, operatorId) {
        const deviceId = (0, uuid_1.v4)();
        // Store device mapping
        this.deviceSockets.set(deviceId, socket);
        this.socketDevices.set(socket.id, deviceId);
        // Register in Redis
        await redisService_1.redisService.registerDevice(operatorId, deviceId, socket.id);
        // Subscribe to operator events
        await this.subscribeToOperatorEvents(socket, operatorId);
        // Send current processing states to this device
        await this.syncProcessingStates(socket, operatorId);
        // Send current messages to this device
        await this.syncMessages(socket, operatorId);
        console.log(`Device registered: ${deviceId} for operator ${operatorId}`);
        return deviceId;
    }
    async unregisterDevice(socket, operatorId) {
        const deviceId = this.socketDevices.get(socket.id);
        if (!deviceId)
            return;
        // Clean up mappings
        this.deviceSockets.delete(deviceId);
        this.socketDevices.delete(socket.id);
        // Unregister from Redis
        await redisService_1.redisService.unregisterDevice(operatorId, deviceId);
        // Release any locks held by this device
        await this.releaseAllLocks(operatorId, deviceId);
        console.log(`Device unregistered: ${deviceId} for operator ${operatorId}`);
    }
    async startProcessing(socket, operatorId, profileId, type, message) {
        const deviceId = this.socketDevices.get(socket.id);
        if (!deviceId) {
            return { success: false, reason: 'Device not registered' };
        }
        // Try to acquire processing lock
        const lockAcquired = await redisService_1.redisService.acquireProcessingLock(operatorId, profileId, type, deviceId);
        if (!lockAcquired) {
            const lockOwner = await redisService_1.redisService.getProcessingLockOwner(operatorId, profileId, type);
            return {
                success: false,
                reason: 'Another device is already processing this profile',
                lockOwner: lockOwner || undefined
            };
        }
        // Create global processing state
        const globalState = {
            isProcessing: true,
            current: 0,
            total: 0,
            operatorId,
            profileId,
            type,
            startedAt: Date.now(),
            lastUpdate: Date.now(),
            deviceId,
            socketId: socket.id
        };
        // Store in Redis
        await redisService_1.redisService.setProcessingState(globalState);
        // Notify the requesting device first
        socket.emit('processingStarted', {
            profileId,
            type,
            deviceId,
            startedAt: globalState.startedAt
        });
        // Then broadcast to all other devices
        await this.broadcastToOperator(operatorId, 'processingStarted', {
            profileId,
            type,
            deviceId,
            startedAt: globalState.startedAt
        });
        return { success: true };
    }
    async updateProcessingProgress(operatorId, profileId, type, progress) {
        const currentState = await redisService_1.redisService.getProcessingState(operatorId, profileId, type);
        if (!currentState)
            return;
        // Update state
        currentState.current = progress.current;
        currentState.total = progress.total;
        currentState.lastUpdate = Date.now();
        // Save to Redis
        await redisService_1.redisService.setProcessingState(currentState);
        // Only format the message if it's the initial state
        const formattedMessage = currentState.current === 0 && currentState.total === 0 && !progress.message
            ? '🧐 Analyzing Chance...'
            : progress.message || `📱 Processing in cloud... (${progress.current}/${progress.total})`;
        // Broadcast to all devices
        await this.broadcastToOperator(operatorId, 'processingProgress', {
            profileId,
            type,
            progress: {
                ...progress,
                message: formattedMessage,
                deviceId: currentState.deviceId,
                startedAt: currentState.startedAt
            }
        });
    }
    async stopProcessing(socket, operatorId, profileId, type) {
        const deviceId = this.socketDevices.get(socket.id);
        if (!deviceId) {
            return { success: false, reason: 'Device not registered' };
        }
        // Get current state
        const currentState = await redisService_1.redisService.getProcessingState(operatorId, profileId, type);
        if (!currentState) {
            return { success: false, reason: 'No active processing session found' };
        }
        // Allow any device of the same operator to stop processing
        if (currentState.operatorId !== operatorId) {
            return { success: false, reason: 'Unauthorized to stop this processing session' };
        }
        try {
            // Update state to indicate processing is stopped
            currentState.isProcessing = false;
            await redisService_1.redisService.setProcessingState(currentState);
            // Release lock and clean up state
            await redisService_1.redisService.releaseProcessingLock(operatorId, profileId, type, currentState.deviceId);
            await redisService_1.redisService.deleteProcessingState(operatorId, profileId, type);
            // Notify the requesting device first
            socket.emit('processingStopped', {
                profileId,
                type,
                deviceId,
                stoppedBy: deviceId,
                stoppedAt: Date.now()
            });
            // Then broadcast to all other devices
            await this.broadcastToOperator(operatorId, 'processingStopped', {
                profileId,
                type,
                deviceId,
                stoppedBy: deviceId,
                stoppedAt: Date.now()
            });
            console.log(`Processing stopped successfully for ${type} ${profileId} by device ${deviceId}`);
            return { success: true };
        }
        catch (error) {
            console.error('Error stopping processing:', error);
            return { success: false, reason: 'Failed to stop processing' };
        }
    }
    async completeProcessing(operatorId, profileId, type) {
        const currentState = await redisService_1.redisService.getProcessingState(operatorId, profileId, type);
        if (!currentState)
            return;
        // Release lock and clean up state
        await redisService_1.redisService.releaseProcessingLock(operatorId, profileId, type, currentState.deviceId);
        await redisService_1.redisService.deleteProcessingState(operatorId, profileId, type);
        // Broadcast to all devices
        await this.broadcastToOperator(operatorId, 'processingComplete', {
            profileId,
            type,
            deviceId: currentState.deviceId,
            completedAt: Date.now(),
            stats: {
                current: currentState.current,
                total: currentState.total,
                duration: Date.now() - currentState.startedAt
            }
        });
    }
    async subscribeToOperatorEvents(socket, operatorId) {
        await redisService_1.redisService.subscribeToOperator(operatorId, (event, data) => {
            // Don't send events back to the originating device
            if (data.deviceId && data.deviceId === this.socketDevices.get(socket.id)) {
                return;
            }
            socket.emit(event, data);
        });
    }
    async syncProcessingStates(socket, operatorId) {
        const states = await redisService_1.redisService.getAllProcessingStates(operatorId);
        const deviceId = this.socketDevices.get(socket.id);
        for (const state of states) {
            // Only sync states for this operator
            if (state.operatorId === operatorId) {
                socket.emit('processingStateSync', {
                    profileId: state.profileId,
                    type: state.type,
                    isProcessing: state.isProcessing,
                    current: state.current,
                    total: state.total,
                    deviceId: state.deviceId,
                    startedAt: state.startedAt,
                    isOwnDevice: state.deviceId === deviceId,
                    operatorId: state.operatorId
                });
            }
        }
    }
    async broadcastToOperator(operatorId, event, data) {
        // Add operatorId to all events for better tracking
        const eventData = {
            ...data,
            operatorId,
            timestamp: Date.now()
        };
        await redisService_1.redisService.publishToOperator(operatorId, event, eventData);
    }
    async releaseAllLocks(operatorId, deviceId) {
        const states = await redisService_1.redisService.getAllProcessingStates(operatorId);
        for (const state of states) {
            if (state.deviceId === deviceId) {
                await redisService_1.redisService.releaseProcessingLock(operatorId, state.profileId, state.type, deviceId);
                await redisService_1.redisService.deleteProcessingState(operatorId, state.profileId, state.type);
                // Broadcast that processing was interrupted
                await this.broadcastToOperator(operatorId, 'processingInterrupted', {
                    profileId: state.profileId,
                    type: state.type,
                    deviceId,
                    reason: 'Device disconnected'
                });
            }
        }
    }
    async getProcessingStatus(operatorId, profileId, type) {
        return await redisService_1.redisService.getProcessingState(operatorId, profileId, type);
    }
    async getAllProcessingStates(operatorId) {
        return await redisService_1.redisService.getAllProcessingStates(operatorId);
    }
    // Message synchronization methods
    async updateMessage(socket, operatorId, profileId, type, message) {
        const deviceId = this.socketDevices.get(socket.id);
        if (!deviceId)
            return;
        // Store message in Redis
        await redisService_1.redisService.setMessage(operatorId, profileId, type, message, deviceId);
        // Broadcast to all other devices
        await this.broadcastToOperator(operatorId, 'messageUpdated', {
            profileId,
            type,
            message,
            deviceId,
            timestamp: Date.now()
        });
    }
    async clearMessage(socket, operatorId, profileId, type) {
        const deviceId = this.socketDevices.get(socket.id);
        if (!deviceId)
            return;
        // Delete message from Redis
        await redisService_1.redisService.deleteMessage(operatorId, profileId, type);
        // Broadcast to all other devices
        await this.broadcastToOperator(operatorId, 'messageCleared', {
            profileId,
            type,
            deviceId,
            timestamp: Date.now()
        });
    }
    async syncMessages(socket, operatorId) {
        const messages = await redisService_1.redisService.getAllMessages(operatorId);
        for (const messageData of messages) {
            socket.emit('messageSync', {
                profileId: messageData.profileId,
                type: messageData.type,
                message: messageData.message,
                deviceId: messageData.deviceId,
                timestamp: messageData.timestamp,
                isOwnDevice: messageData.deviceId === this.socketDevices.get(socket.id)
            });
        }
    }
    // Blocklist management methods
    async clearBlocklist(socket, operatorId, profileId, type) {
        const deviceId = this.socketDevices.get(socket.id);
        if (!deviceId) {
            return { success: false, deletedCount: 0, reason: 'Device not registered' };
        }
        try {
            const deletedCount = await redisService_1.redisService.clearBlocklist(operatorId, profileId, type);
            // Broadcast to all devices
            await this.broadcastToOperator(operatorId, 'blocklistCleared', {
                profileId,
                type,
                deletedCount,
                deviceId,
                timestamp: Date.now()
            });
            return { success: true, deletedCount };
        }
        catch (error) {
            console.error('Error clearing blocklist:', error);
            return { success: false, deletedCount: 0, reason: 'Failed to clear blocklist' };
        }
    }
    async getBlocklistCount(operatorId, profileId, type) {
        return await redisService_1.redisService.getBlocklistCount(operatorId, profileId, type);
    }
    // Public method to get device ID for a socket
    getDeviceIdForSocket(socketId) {
        return this.socketDevices.get(socketId);
    }
}
exports.SessionManager = SessionManager;
