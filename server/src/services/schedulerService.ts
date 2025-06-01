import { CronJob } from 'cron';
import { redisService } from './redisService';
import { SessionManager } from './sessionManager';

export class SchedulerService {
  private jobs: CronJob[] = [];
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  public startScheduler(): void {
    // Schedule blocklist clearing at 08:00, 14:00, and 23:00 Kiev time
    const times = ['0 8 * * *', '0 14 * * *', '0 23 * * *'];
    
    times.forEach(cronTime => {
      const job = new CronJob(
        cronTime,
        async () => {
          console.log(`🕒 Running scheduled blocklist clear at ${new Date().toISOString()}`);
          await this.clearAllBlocklists();
        },
        null,
        true,
        'Europe/Kiev'
      );
      
      this.jobs.push(job);
      job.start();
    });

    console.log('✅ Scheduler started with blocklist clearing at 08:00, 14:00, and 23:00 Kiev time');
  }

  private async clearAllBlocklists(): Promise<void> {
    try {
      // Get all operator IDs from Redis
      const operatorKeys = await redisService.client.keys('sent:*');
      const operatorIds = new Set(operatorKeys.map(key => key.split(':')[1]));

      for (const operatorId of operatorIds) {
        // Get all profile IDs for this operator
        const profileKeys = await redisService.client.keys(`sent:${operatorId}:*`);
        const profileIds = new Set(profileKeys.map(key => key.split(':')[2]));

        for (const profileId of profileIds) {
          // Clear both chat and mail blocklists
          await redisService.clearBlocklist(operatorId, profileId, 'chat');
          await redisService.clearBlocklist(operatorId, profileId, 'mail');

          // Broadcast to all devices
          await this.sessionManager.broadcastToOperator(operatorId, 'blocklistCleared', {
            profileId,
            type: 'all',
            deletedCount: 0, // We don't track the count for scheduled clears
            message: 'Scheduled blocklist clear completed',
            timestamp: Date.now()
          });
        }
      }

      console.log('✅ Scheduled blocklist clear completed successfully');
    } catch (error) {
      console.error('❌ Error during scheduled blocklist clear:', error);
    }
  }

  public stopScheduler(): void {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    console.log('⏹️ Scheduler stopped');
  }
} 