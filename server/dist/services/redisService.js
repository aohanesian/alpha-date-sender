"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisService = void 0;
const redis_1 = require("redis");
class RedisService {
    constructor() {
        this.isConnected = false;
        this.connectionPromise = null;
        this.client = (0, redis_1.createClient)({
            url: process.env.REDIS_URL || 'redis://localhost:6379'
        });
        this.client.on('error', (err) => {
            console.error('Redis Client Error:', err);
            this.isConnected = false;
        });
        this.client.on('connect', () => {
            console.log('Redis Client Connected');
            this.isConnected = true;
        });
        this.client.on('disconnect', () => {
            console.log('Redis Client Disconnected');
            this.isConnected = false;
        });
    }
    async connect() {
        if (this.isConnected) {
            return;
        }
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        this.connectionPromise = this.client.connect()
            .then(() => {
            this.isConnected = true;
        })
            .catch((error) => {
            console.error('Failed to connect to Redis:', error);
            this.isConnected = false;
            throw error;
        })
            .finally(() => {
            this.connectionPromise = null;
        });
        return this.connectionPromise;
    }
    async disconnect() {
        if (!this.isConnected) {
            return;
        }
        try {
            await this.client.disconnect();
            this.isConnected = false;
        }
        catch (error) {
            console.error('Error disconnecting from Redis:', error);
            throw error;
        }
    }
    // Processing State Management
    getProcessingKey(operatorId, profileId, type) {
        return `processing:${operatorId}:${profileId}:${type}`;
    }
    async setProcessingState(state) {
        const key = this.getProcessingKey(state.operatorId, state.profileId, state.type);
        await this.client.setEx(key, 3600, JSON.stringify(state)); // Expire after 1 hour
    }
    async getProcessingState(operatorId, profileId, type) {
        const key = this.getProcessingKey(operatorId, profileId, type);
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }
    async deleteProcessingState(operatorId, profileId, type) {
        const key = this.getProcessingKey(operatorId, profileId, type);
        await this.client.del(key);
    }
    async getAllProcessingStates(operatorId) {
        const pattern = `processing:${operatorId}:*`;
        const keys = await this.client.keys(pattern);
        const states = [];
        for (const key of keys) {
            const data = await this.client.get(key);
            if (data) {
                states.push(JSON.parse(data));
            }
        }
        return states;
    }
    // Device Session Management
    getDeviceKey(operatorId, deviceId) {
        return `device:${operatorId}:${deviceId}`;
    }
    async registerDevice(operatorId, deviceId, socketId) {
        const key = this.getDeviceKey(operatorId, deviceId);
        const deviceInfo = {
            socketId,
            lastSeen: Date.now(),
            operatorId
        };
        await this.client.setEx(key, 7200, JSON.stringify(deviceInfo)); // Expire after 2 hours
    }
    async unregisterDevice(operatorId, deviceId) {
        const key = this.getDeviceKey(operatorId, deviceId);
        await this.client.del(key);
    }
    async getActiveDevices(operatorId) {
        const pattern = `device:${operatorId}:*`;
        const keys = await this.client.keys(pattern);
        const devices = [];
        for (const key of keys) {
            const data = await this.client.get(key);
            if (data) {
                const deviceInfo = JSON.parse(data);
                // Check if device was seen in last 10 minutes
                if (Date.now() - deviceInfo.lastSeen < 600000) {
                    devices.push(deviceInfo.socketId);
                }
            }
        }
        return devices;
    }
    // Message synchronization
    getMessageKey(operatorId, profileId, type) {
        return `message:${operatorId}:${profileId}:${type}`;
    }
    async setMessage(operatorId, profileId, type, message, deviceId) {
        const key = this.getMessageKey(operatorId, profileId, type);
        const messageData = {
            message,
            deviceId,
            timestamp: Date.now()
        };
        await this.client.setEx(key, 7200, JSON.stringify(messageData)); // Expire after 2 hours
    }
    async getMessage(operatorId, profileId, type) {
        const key = this.getMessageKey(operatorId, profileId, type);
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }
    async deleteMessage(operatorId, profileId, type) {
        const key = this.getMessageKey(operatorId, profileId, type);
        await this.client.del(key);
    }
    async getAllMessages(operatorId) {
        const pattern = `message:${operatorId}:*`;
        const keys = await this.client.keys(pattern);
        const messages = [];
        for (const key of keys) {
            const data = await this.client.get(key);
            if (data) {
                const messageData = JSON.parse(data);
                const keyParts = key.split(':');
                const profileId = keyParts[2];
                const type = keyParts[3];
                messages.push({
                    profileId,
                    type,
                    message: messageData.message,
                    deviceId: messageData.deviceId,
                    timestamp: messageData.timestamp
                });
            }
        }
        return messages;
    }
    // Sent messages tracking (blocklist)
    getSentMessageKey(operatorId, profileId, recipientId, type) {
        return `sent:${operatorId}:${profileId}:${recipientId}:${type}`;
    }
    getBlocklistPatternKey(operatorId, profileId, type) {
        return `sent:${operatorId}:${profileId}:*:${type}`;
    }
    async markMessageSent(operatorId, profileId, recipientId, type, messageHash) {
        const key = this.getSentMessageKey(operatorId, profileId, recipientId, type);
        const sentData = {
            messageHash,
            sentAt: Date.now(),
            recipientId,
            type
        };
        // Expire after 30 days (2592000 seconds)
        await this.client.setEx(key, 2592000, JSON.stringify(sentData));
    }
    async wasMessageSent(operatorId, profileId, recipientId, type) {
        const key = this.getSentMessageKey(operatorId, profileId, recipientId, type);
        const exists = await this.client.exists(key);
        return exists === 1;
    }
    async getSentMessageInfo(operatorId, profileId, recipientId, type) {
        const key = this.getSentMessageKey(operatorId, profileId, recipientId, type);
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }
    async clearBlocklist(operatorId, profileId, type) {
        const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
        const keys = await this.client.keys(pattern);
        if (keys.length === 0)
            return 0;
        const deletedCount = await this.client.del(keys);
        return deletedCount;
    }
    async getBlocklistCount(operatorId, profileId, type) {
        const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
        const keys = await this.client.keys(pattern);
        return keys.length;
    }
    async getAllBlockedRecipients(operatorId, profileId, type) {
        const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
        const keys = await this.client.keys(pattern);
        const blockedRecipients = [];
        for (const key of keys) {
            const data = await this.client.get(key);
            if (data) {
                const sentData = JSON.parse(data);
                blockedRecipients.push({
                    recipientId: sentData.recipientId,
                    sentAt: sentData.sentAt,
                    messageHash: sentData.messageHash
                });
            }
        }
        // Sort by most recently sent
        return blockedRecipients.sort((a, b) => b.sentAt - a.sentAt);
    }
    async getBlockedRecipientsSet(operatorId, profileId, type) {
        const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
        const keys = await this.client.keys(pattern);
        const blockedSet = new Set();
        for (const key of keys) {
            const data = await this.client.get(key);
            if (data) {
                const sentData = JSON.parse(data);
                blockedSet.add(sentData.recipientId.toString());
            }
        }
        return blockedSet;
    }
    // Cross-device messaging
    async publishToOperator(operatorId, event, data) {
        const channel = `operator:${operatorId}`;
        await this.client.publish(channel, JSON.stringify({ event, data, timestamp: Date.now() }));
    }
    async subscribeToOperator(operatorId, callback) {
        const subscriber = this.client.duplicate();
        await subscriber.connect();
        const channel = `operator:${operatorId}`;
        await subscriber.subscribe(channel, (message) => {
            try {
                const parsed = JSON.parse(message);
                callback(parsed.event, parsed.data);
            }
            catch (error) {
                console.error('Error parsing Redis message:', error);
            }
        });
    }
    // Conflict prevention
    async acquireProcessingLock(operatorId, profileId, type, deviceId) {
        const lockKey = `lock:${operatorId}:${profileId}:${type}`;
        const lockValue = `${deviceId}:${Date.now()}`;
        // Try to acquire lock with 30 minute expiration
        const result = await this.client.setNX(lockKey, lockValue);
        if (result) {
            await this.client.expire(lockKey, 1800); // 30 minutes
            return true;
        }
        // Check if lock is expired
        const currentLock = await this.client.get(lockKey);
        if (currentLock) {
            const [, timestamp] = currentLock.split(':');
            if (Date.now() - parseInt(timestamp) > 1800000) { // 30 minutes
                // Lock is expired, try to acquire it
                await this.client.del(lockKey);
                const retryResult = await this.client.setNX(lockKey, lockValue);
                if (retryResult) {
                    await this.client.expire(lockKey, 1800);
                    return true;
                }
            }
        }
        return false;
    }
    async releaseProcessingLock(operatorId, profileId, type, deviceId) {
        const lockKey = `lock:${operatorId}:${profileId}:${type}`;
        const currentLock = await this.client.get(lockKey);
        if (currentLock && currentLock.startsWith(deviceId)) {
            await this.client.del(lockKey);
        }
    }
    async getProcessingLockOwner(operatorId, profileId, type) {
        const lockKey = `lock:${operatorId}:${profileId}:${type}`;
        const lock = await this.client.get(lockKey);
        return lock ? lock.split(':')[0] : null;
    }
}
exports.redisService = new RedisService();
