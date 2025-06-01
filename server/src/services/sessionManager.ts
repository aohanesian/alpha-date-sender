import { Server, Socket } from 'socket.io';
import { redisService, GlobalProcessingState } from './redisService';
import { v4 as uuidv4 } from 'uuid';

export class SessionManager {
  private io: Server;
  private deviceSockets: Map<string, Socket> = new Map(); // deviceId -> socket
  private socketDevices: Map<string, string> = new Map(); // socketId -> deviceId

  constructor(io: Server) {
    this.io = io;
  }

  async initialize(): Promise<void> {
    await redisService.connect();
  }

  async registerDevice(socket: Socket, operatorId: string): Promise<string> {
    const deviceId = uuidv4();
    
    // Store device mapping
    this.deviceSockets.set(deviceId, socket);
    this.socketDevices.set(socket.id, deviceId);
    
    // Register in Redis
    await redisService.registerDevice(operatorId, deviceId, socket.id);
    
    // Subscribe to operator events
    await this.subscribeToOperatorEvents(socket, operatorId);
    
    // Send current processing states to this device
    await this.syncProcessingStates(socket, operatorId);
    
    // Send current messages to this device
    await this.syncMessages(socket, operatorId);
    
    console.log(`Device registered: ${deviceId} for operator ${operatorId}`);
    return deviceId;
  }

  async unregisterDevice(socket: Socket, operatorId: string): Promise<void> {
    const deviceId = this.socketDevices.get(socket.id);
    if (!deviceId) return;

    // Clean up mappings
    this.deviceSockets.delete(deviceId);
    this.socketDevices.delete(socket.id);
    
    // Unregister from Redis
    await redisService.unregisterDevice(operatorId, deviceId);
    
    // Release any locks held by this device
    await this.releaseAllLocks(operatorId, deviceId);
    
    console.log(`Device unregistered: ${deviceId} for operator ${operatorId}`);
  }

  async startProcessing(
    socket: Socket, 
    operatorId: string, 
    profileId: string, 
    type: 'chat' | 'mail',
    message: string
  ): Promise<{ success: boolean; reason?: string; lockOwner?: string }> {
    const deviceId = this.socketDevices.get(socket.id);
    if (!deviceId) {
      return { success: false, reason: 'Device not registered' };
    }

    // Try to acquire processing lock
    const lockAcquired = await redisService.acquireProcessingLock(operatorId, profileId, type, deviceId);
    if (!lockAcquired) {
      const lockOwner = await redisService.getProcessingLockOwner(operatorId, profileId, type);
      return { 
        success: false, 
        reason: 'Another device is already processing this profile', 
        lockOwner: lockOwner || undefined
      };
    }

    // Create global processing state
    const globalState: GlobalProcessingState = {
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
    await redisService.setProcessingState(globalState);

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

  async updateProcessingProgress(
    operatorId: string,
    profileId: string,
    type: 'chat' | 'mail',
    progress: { current: number; total: number; message: string; error?: boolean }
  ): Promise<void> {
    const currentState = await redisService.getProcessingState(operatorId, profileId, type);
    if (!currentState) return;

    // Update state
    currentState.current = progress.current;
    currentState.total = progress.total;
    currentState.lastUpdate = Date.now();

    // Save to Redis
    await redisService.setProcessingState(currentState);

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

  async stopProcessing(
    socket: Socket,
    operatorId: string,
    profileId: string,
    type: 'chat' | 'mail'
  ): Promise<{ success: boolean; reason?: string }> {
    const deviceId = this.socketDevices.get(socket.id);
    if (!deviceId) {
      return { success: false, reason: 'Device not registered' };
    }

    // Get current state
    const currentState = await redisService.getProcessingState(operatorId, profileId, type);
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
      await redisService.setProcessingState(currentState);

      // Release lock and clean up state
      await redisService.releaseProcessingLock(operatorId, profileId, type, currentState.deviceId);
      await redisService.deleteProcessingState(operatorId, profileId, type);

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
    } catch (error) {
      console.error('Error stopping processing:', error);
      return { success: false, reason: 'Failed to stop processing' };
    }
  }

  async completeProcessing(
    operatorId: string,
    profileId: string,
    type: 'chat' | 'mail'
  ): Promise<void> {
    const currentState = await redisService.getProcessingState(operatorId, profileId, type);
    if (!currentState) return;

    // Release lock and clean up state
    await redisService.releaseProcessingLock(operatorId, profileId, type, currentState.deviceId);
    await redisService.deleteProcessingState(operatorId, profileId, type);

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

  private async subscribeToOperatorEvents(socket: Socket, operatorId: string): Promise<void> {
    await redisService.subscribeToOperator(operatorId, (event: string, data: any) => {
      // Don't send events back to the originating device
      if (data.deviceId && data.deviceId === this.socketDevices.get(socket.id)) {
        return;
      }
      
      socket.emit(event, data);
    });
  }

  private async syncProcessingStates(socket: Socket, operatorId: string): Promise<void> {
    const states = await redisService.getAllProcessingStates(operatorId);
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

  public async broadcastToOperator(operatorId: string, event: string, data: any): Promise<void> {
    // Add operatorId to all events for better tracking
    const eventData = {
      ...data,
      operatorId,
      timestamp: Date.now()
    };
    await redisService.publishToOperator(operatorId, event, eventData);
  }

  private async releaseAllLocks(operatorId: string, deviceId: string): Promise<void> {
    const states = await redisService.getAllProcessingStates(operatorId);
    
    for (const state of states) {
      if (state.deviceId === deviceId) {
        await redisService.releaseProcessingLock(operatorId, state.profileId, state.type, deviceId);
        await redisService.deleteProcessingState(operatorId, state.profileId, state.type);
        
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

  async getProcessingStatus(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<GlobalProcessingState | null> {
    return await redisService.getProcessingState(operatorId, profileId, type);
  }

  async getAllProcessingStates(operatorId: string): Promise<GlobalProcessingState[]> {
    return await redisService.getAllProcessingStates(operatorId);
  }

  // Message synchronization methods
  async updateMessage(
    socket: Socket,
    operatorId: string,
    profileId: string,
    type: 'chat' | 'mail',
    message: string
  ): Promise<void> {
    const deviceId = this.socketDevices.get(socket.id);
    if (!deviceId) return;

    // Store message in Redis
    await redisService.setMessage(operatorId, profileId, type, message, deviceId);

    // Broadcast to all other devices
    await this.broadcastToOperator(operatorId, 'messageUpdated', {
      profileId,
      type,
      message,
      deviceId,
      timestamp: Date.now()
    });
  }

  async clearMessage(
    socket: Socket,
    operatorId: string,
    profileId: string,
    type: 'chat' | 'mail'
  ): Promise<void> {
    const deviceId = this.socketDevices.get(socket.id);
    if (!deviceId) return;

    // Delete message from Redis
    await redisService.deleteMessage(operatorId, profileId, type);

    // Broadcast to all other devices
    await this.broadcastToOperator(operatorId, 'messageCleared', {
      profileId,
      type,
      deviceId,
      timestamp: Date.now()
    });
  }

  private async syncMessages(socket: Socket, operatorId: string): Promise<void> {
    const messages = await redisService.getAllMessages(operatorId);
    
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
  async clearBlocklist(
    socket: Socket,
    operatorId: string,
    profileId: string,
    type: 'chat' | 'mail'
  ): Promise<{ success: boolean; deletedCount: number; reason?: string }> {
    const deviceId = this.socketDevices.get(socket.id);
    if (!deviceId) {
      return { success: false, deletedCount: 0, reason: 'Device not registered' };
    }

    try {
      const deletedCount = await redisService.clearBlocklist(operatorId, profileId, type);
      
      // Broadcast to all devices
      await this.broadcastToOperator(operatorId, 'blocklistCleared', {
        profileId,
        type,
        deletedCount,
        deviceId,
        timestamp: Date.now()
      });

      return { success: true, deletedCount };
    } catch (error) {
      console.error('Error clearing blocklist:', error);
      return { success: false, deletedCount: 0, reason: 'Failed to clear blocklist' };
    }
  }

  async getBlocklistCount(operatorId: string, profileId: string, type: 'chat' | 'mail'): Promise<number> {
    return await redisService.getBlocklistCount(operatorId, profileId, type);
  }

  // Public method to get device ID for a socket
  getDeviceIdForSocket(socketId: string): string | undefined {
    return this.socketDevices.get(socketId);
  }
} 