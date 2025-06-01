import { createClient, RedisClientType } from 'redis';

export interface GlobalProcessingState {
  isProcessing: boolean;
  current: number;
  total: number;
  operatorId: string;
  profileId: string;
  type: 'chat' | 'mail';
  startedAt: number;
  lastUpdate: number;
  deviceId: string;
  socketId: string;
}

class RedisService {
  public client: RedisClientType;
  private isConnected: boolean = false;

  constructor() {
    this.client = createClient({
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

  async connect(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  // Processing State Management
  private getProcessingKey(operatorId: string, profileId: string, type: 'chat' | 'mail'): string {
    return `processing:${operatorId}:${profileId}:${type}`;
  }

  async setProcessingState(state: GlobalProcessingState): Promise<void> {
    const key = this.getProcessingKey(state.operatorId, state.profileId, state.type);
    await this.client.setEx(key, 3600, JSON.stringify(state)); // Expire after 1 hour
  }

  async getProcessingState(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<GlobalProcessingState | null> {
    const key = this.getProcessingKey(operatorId, profileId, type);
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteProcessingState(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<void> {
    const key = this.getProcessingKey(operatorId, profileId, type);
    await this.client.del(key);
  }

  async getAllProcessingStates(operatorId: string): Promise<GlobalProcessingState[]> {
    const pattern = `processing:${operatorId}:*`;
    const keys = await this.client.keys(pattern);
    const states: GlobalProcessingState[] = [];
    
    for (const key of keys) {
      const data = await this.client.get(key);
      if (data) {
        states.push(JSON.parse(data));
      }
    }
    
    return states;
  }

  // Device Session Management
  private getDeviceKey(operatorId: string, deviceId: string): string {
    return `device:${operatorId}:${deviceId}`;
  }

  async registerDevice(operatorId: string, deviceId: string, socketId: string): Promise<void> {
    const key = this.getDeviceKey(operatorId, deviceId);
    const deviceInfo = {
      socketId,
      lastSeen: Date.now(),
      operatorId
    };
    await this.client.setEx(key, 7200, JSON.stringify(deviceInfo)); // Expire after 2 hours
  }

  async unregisterDevice(operatorId: string, deviceId: string): Promise<void> {
    const key = this.getDeviceKey(operatorId, deviceId);
    await this.client.del(key);
  }

  async getActiveDevices(operatorId: string): Promise<string[]> {
    const pattern = `device:${operatorId}:*`;
    const keys = await this.client.keys(pattern);
    const devices: string[] = [];
    
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
  private getMessageKey(operatorId: string, profileId: string, type: 'chat' | 'mail'): string {
    return `message:${operatorId}:${profileId}:${type}`;
  }

  async setMessage(operatorId: string, profileId: string, type: 'chat' | 'mail', message: string, deviceId: string): Promise<void> {
    const key = this.getMessageKey(operatorId, profileId, type);
    const messageData = {
      message,
      deviceId,
      timestamp: Date.now()
    };
    await this.client.setEx(key, 7200, JSON.stringify(messageData)); // Expire after 2 hours
  }

  async getMessage(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<{ message: string; deviceId: string; timestamp: number } | null> {
    const key = this.getMessageKey(operatorId, profileId, type);
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteMessage(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<void> {
    const key = this.getMessageKey(operatorId, profileId, type);
    await this.client.del(key);
  }

  async getAllMessages(operatorId: string): Promise<Array<{ profileId: string; type: 'chat' | 'mail'; message: string; deviceId: string; timestamp: number }>> {
    const pattern = `message:${operatorId}:*`;
    const keys = await this.client.keys(pattern);
    const messages: Array<{ profileId: string; type: 'chat' | 'mail'; message: string; deviceId: string; timestamp: number }> = [];
    
    for (const key of keys) {
      const data = await this.client.get(key);
      if (data) {
        const messageData = JSON.parse(data);
        const keyParts = key.split(':');
        const profileId = keyParts[2];
        const type = keyParts[3] as 'chat' | 'mail';
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
  private getSentMessageKey(operatorId: string, profileId: string, recipientId: string, type: 'chat' | 'mail'): string {
    return `sent:${operatorId}:${profileId}:${recipientId}:${type}`;
  }

  private getBlocklistPatternKey(operatorId: string, profileId: string, type: 'chat' | 'mail'): string {
    return `sent:${operatorId}:${profileId}:*:${type}`;
  }

  async markMessageSent(operatorId: string, profileId: string, recipientId: string, type: 'chat' | 'mail', messageHash: string): Promise<void> {
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

  async wasMessageSent(operatorId: string, profileId: string, recipientId: string, type: 'chat' | 'mail'): Promise<boolean> {
    const key = this.getSentMessageKey(operatorId, profileId, recipientId, type);
    const exists = await this.client.exists(key);
    return exists === 1;
  }

  async getSentMessageInfo(operatorId: string, profileId: string, recipientId: string, type: 'chat' | 'mail'): Promise<{ messageHash: string; sentAt: number; recipientId: string; type: string } | null> {
    const key = this.getSentMessageKey(operatorId, profileId, recipientId, type);
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async clearBlocklist(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<number> {
    const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
    const keys = await this.client.keys(pattern);
    if (keys.length === 0) return 0;
    
    const deletedCount = await this.client.del(keys);
    return deletedCount;
  }

  async getBlocklistCount(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<number> {
    const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
    const keys = await this.client.keys(pattern);
    return keys.length;
  }

  async getAllBlockedRecipients(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<Array<{ recipientId: string; sentAt: number; messageHash: string }>> {
    const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
    const keys = await this.client.keys(pattern);
    const blockedRecipients: Array<{ recipientId: string; sentAt: number; messageHash: string }> = [];
    
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

  async getBlockedRecipientsSet(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<Set<string>> {
    const pattern = this.getBlocklistPatternKey(operatorId, profileId, type);
    const keys = await this.client.keys(pattern);
    const blockedSet = new Set<string>();
    
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
  async publishToOperator(operatorId: string, event: string, data: any): Promise<void> {
    const channel = `operator:${operatorId}`;
    await this.client.publish(channel, JSON.stringify({ event, data, timestamp: Date.now() }));
  }

  async subscribeToOperator(operatorId: string, callback: (event: string, data: any) => void): Promise<void> {
    const subscriber = this.client.duplicate();
    await subscriber.connect();
    
    const channel = `operator:${operatorId}`;
    await subscriber.subscribe(channel, (message) => {
      try {
        const parsed = JSON.parse(message);
        callback(parsed.event, parsed.data);
      } catch (error) {
        console.error('Error parsing Redis message:', error);
      }
    });
  }

  // Conflict prevention
  async acquireProcessingLock(operatorId: string, profileId: string, type: 'chat' | 'mail', deviceId: string): Promise<boolean> {
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

  async releaseProcessingLock(operatorId: string, profileId: string, type: 'chat' | 'mail', deviceId: string): Promise<void> {
    const lockKey = `lock:${operatorId}:${profileId}:${type}`;
    const currentLock = await this.client.get(lockKey);
    
    if (currentLock && currentLock.startsWith(deviceId)) {
      await this.client.del(lockKey);
    }
  }

  async getProcessingLockOwner(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<string | null> {
    const lockKey = `lock:${operatorId}:${profileId}:${type}`;
    const lock = await this.client.get(lockKey);
    return lock ? lock.split(':')[0] : null;
  }
}

export const redisService = new RedisService(); 