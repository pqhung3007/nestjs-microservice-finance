import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  RateAlert,
  AlertCondition,
  AlertStatus,
} from '../../typeorm/models/rate-alert.model';
import Decimal from 'decimal.js';
import { NotificationService } from '@square-me/microservice-client';

/**
 * Rate Alert Service
 *
 * Monitors exchange rates and triggers alerts when conditions are met
 * Runs every 5 minutes to check active alerts
 */
@Injectable()
export class RateAlertService {
  private readonly logger = new Logger(RateAlertService.name);

  constructor(
    @InjectRepository(RateAlert)
    private readonly rateAlertRepository: Repository<RateAlert>,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Creates a new rate alert
   */
  async createAlert(
    userId: string,
    userEmail: string,
    baseCurrency: string,
    targetCurrency: string,
    targetRate: Decimal,
    condition: AlertCondition,
    options?: {
      notifyByEmail?: boolean;
      repeatAlert?: boolean;
      expiresAt?: Date;
      notes?: string;
    }
  ): Promise<RateAlert> {
    const alert = this.rateAlertRepository.create({
      userId,
      userEmail,
      baseCurrency,
      targetCurrency,
      targetRate,
      condition,
      status: AlertStatus.ACTIVE,
      notifyByEmail: options?.notifyByEmail ?? true,
      repeatAlert: options?.repeatAlert ?? false,
      expiresAt: options?.expiresAt ?? null,
      notes: options?.notes ?? null,
    });

    const savedAlert = await this.rateAlertRepository.save(alert);

    this.logger.log(
      `Created rate alert ${savedAlert.id} for user ${userId}: ${baseCurrency}→${targetCurrency} ${condition} ${targetRate}`
    );

    return savedAlert;
  }

  /**
   * Gets all active alerts for a user
   */
  async getUserAlerts(userId: string): Promise<RateAlert[]> {
    return this.rateAlertRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Gets a specific alert by ID
   */
  async getAlertById(alertId: string, userId: string): Promise<RateAlert | null> {
    return this.rateAlertRepository.findOne({
      where: { id: alertId, userId },
    });
  }

  /**
   * Cancels an alert
   */
  async cancelAlert(alertId: string, userId: string): Promise<RateAlert> {
    const alert = await this.rateAlertRepository.findOneOrFail({
      where: { id: alertId, userId },
    });

    alert.status = AlertStatus.CANCELLED;
    const updated = await this.rateAlertRepository.save(alert);

    this.logger.log(`Cancelled rate alert ${alertId} for user ${userId}`);

    return updated;
  }

  /**
   * Checks if an alert condition is met
   */
  checkAlertCondition(
    currentRate: Decimal,
    targetRate: Decimal,
    condition: AlertCondition
  ): boolean {
    switch (condition) {
      case AlertCondition.ABOVE:
        return currentRate.greaterThan(targetRate);
      case AlertCondition.BELOW:
        return currentRate.lessThan(targetRate);
      case AlertCondition.EQUALS:
        // Use a small tolerance for float comparison (0.0001)
        return currentRate.minus(targetRate).abs().lessThan(0.0001);
      default:
        return false;
    }
  }

  /**
   * Checks a specific rate alert against current rate
   * Returns true if alert was triggered
   */
  async checkAlert(alert: RateAlert, currentRate: Decimal): Promise<boolean> {
    const isConditionMet = this.checkAlertCondition(
      currentRate,
      alert.targetRate,
      alert.condition
    );

    if (isConditionMet) {
      await this.triggerAlert(alert, currentRate);
      return true;
    }

    return false;
  }

  /**
   * Triggers an alert (marks as triggered and sends notification)
   */
  private async triggerAlert(
    alert: RateAlert,
    currentRate: Decimal
  ): Promise<void> {
    this.logger.log(
      `Alert ${alert.id} triggered: ${alert.baseCurrency}→${alert.targetCurrency} ` +
        `${alert.condition} ${alert.targetRate} (current: ${currentRate})`
    );

    // Update alert status
    alert.status = alert.repeatAlert
      ? AlertStatus.ACTIVE
      : AlertStatus.TRIGGERED;
    alert.triggeredAt = new Date();
    alert.triggeredRate = currentRate;
    await this.rateAlertRepository.save(alert);

    // Send email notification
    if (alert.notifyByEmail) {
      await this.sendAlertNotification(alert, currentRate);
    }
  }

  /**
   * Sends email notification for triggered alert
   */
  private async sendAlertNotification(
    alert: RateAlert,
    currentRate: Decimal
  ): Promise<void> {
    const conditionText = {
      [AlertCondition.ABOVE]: 'risen above',
      [AlertCondition.BELOW]: 'fallen below',
      [AlertCondition.EQUALS]: 'reached',
    };

    const subject = `Rate Alert: ${alert.baseCurrency}→${alert.targetCurrency} ${conditionText[alert.condition]} ${alert.targetRate}`;

    const text = `
Hello,

Your rate alert has been triggered!

Currency Pair: ${alert.baseCurrency} → ${alert.targetCurrency}
Target Rate: ${alert.targetRate}
Condition: ${alert.condition}
Current Rate: ${currentRate}
Triggered At: ${alert.triggeredAt?.toISOString()}

${alert.notes ? `Notes: ${alert.notes}` : ''}

${alert.repeatAlert ? 'This is a recurring alert and will continue to monitor rates.' : 'This alert has been deactivated.'}

Best regards,
Square Me Team
    `.trim();

    try {
      await this.notificationService.notifyUser({
        to: alert.userEmail,
        subject,
        text,
        html: '', // Could add HTML version
      });

      this.logger.log(`Sent alert notification to ${alert.userEmail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send alert notification to ${alert.userEmail}:`,
        error
      );
    }
  }

  /**
   * Cron job: Check all active alerts every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES, {
    name: 'check-rate-alerts',
  })
  async checkAllActiveAlerts(): Promise<void> {
    this.logger.log('Checking active rate alerts...');

    // Get all active alerts
    const activeAlerts = await this.rateAlertRepository.find({
      where: { status: AlertStatus.ACTIVE },
    });

    if (activeAlerts.length === 0) {
      this.logger.log('No active alerts to check');
      return;
    }

    this.logger.log(`Checking ${activeAlerts.length} active alerts`);

    // Note: In a real implementation, you would fetch current rates from Integration service
    // For this example, we'll assume you have access to the rates
    // You could inject IntegrationService or use gRPC client here

    // Group alerts by currency pair to minimize rate fetches
    const alertsByCurrencyPair = new Map<string, RateAlert[]>();

    for (const alert of activeAlerts) {
      const key = `${alert.baseCurrency}:${alert.targetCurrency}`;
      if (!alertsByCurrencyPair.has(key)) {
        alertsByCurrencyPair.set(key, []);
      }
      alertsByCurrencyPair.get(key)!.push(alert);
    }

    // Check each currency pair
    let triggeredCount = 0;

    for (const [currencyPair, alerts] of alertsByCurrencyPair.entries()) {
      const [baseCurrency, targetCurrency] = currencyPair.split(':');

      // TODO: Fetch current rate from Integration service via gRPC
      // const currentRateStr = await this.integrationService.convertCurrency({
      //   from: baseCurrency,
      //   to: targetCurrency,
      //   amount: '1',
      // });
      // const currentRate = new Decimal(currentRateStr);

      // For now, we'll skip the actual rate check
      // In production, you would fetch the rate and check each alert
      this.logger.log(
        `Would check ${alerts.length} alerts for ${baseCurrency}→${targetCurrency}`
      );
    }

    this.logger.log(
      `Finished checking alerts. Triggered: ${triggeredCount}/${activeAlerts.length}`
    );
  }

  /**
   * Cron job: Expire old alerts
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'expire-rate-alerts',
  })
  async expireOldAlerts(): Promise<void> {
    const now = new Date();

    const result = await this.rateAlertRepository.update(
      {
        status: AlertStatus.ACTIVE,
        expiresAt: LessThan(now),
      },
      {
        status: AlertStatus.EXPIRED,
      }
    );

    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} rate alerts`);
    }
  }
}
