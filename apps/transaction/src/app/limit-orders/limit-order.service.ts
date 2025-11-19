import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  LimitOrder,
  LimitOrderStatus,
  LimitOrderCondition,
} from '../../typeorm/models/limit-order.model';
import { ForexOrder, OrderStatus } from '../../typeorm/models/forex-order.model';
import { OrderType } from '../../typeorm/models/enums';
import Decimal from 'decimal.js';
import { WalletService, NotificationService } from '@square-me/microservice-client';
import { firstValueFrom } from 'rxjs';

/**
 * Limit Order Service
 *
 * Monitors pending limit orders and executes them when rate conditions are met
 * Runs periodic checks every 2 minutes
 */
@Injectable()
export class LimitOrderService {
  private readonly logger = new Logger(LimitOrderService.name);
  private readonly RATE_TOLERANCE = new Decimal('0.0001'); // Tolerance for "exact" condition

  constructor(
    @InjectRepository(LimitOrder)
    private readonly limitOrderRepository: Repository<LimitOrder>,
    @InjectRepository(ForexOrder)
    private readonly forexOrderRepository: Repository<ForexOrder>,
    private readonly walletService: WalletService,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Creates a new limit order
   */
  async createLimitOrder(
    userId: string,
    userEmail: string,
    type: OrderType,
    baseCurrency: string,
    targetCurrency: string,
    amount: Decimal,
    targetRate: Decimal,
    condition: LimitOrderCondition,
    options?: {
      expiresAt?: Date;
      notes?: string;
    }
  ): Promise<LimitOrder> {
    const limitOrder = this.limitOrderRepository.create({
      userId,
      userEmail,
      type,
      baseCurrency,
      targetCurrency,
      amount,
      targetRate,
      condition,
      status: LimitOrderStatus.PENDING,
      expiresAt: options?.expiresAt ?? null,
      notes: options?.notes ?? null,
    });

    const saved = await this.limitOrderRepository.save(limitOrder);

    this.logger.log(
      `Created limit order ${saved.id}: ${type} ${amount} ${baseCurrency}→${targetCurrency} ` +
        `when rate ${condition} ${targetRate}`
    );

    return saved;
  }

  /**
   * Gets all limit orders for a user
   */
  async getUserLimitOrders(userId: string): Promise<LimitOrder[]> {
    return this.limitOrderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Gets a specific limit order by ID
   */
  async getLimitOrderById(
    orderId: string,
    userId: string
  ): Promise<LimitOrder | null> {
    return this.limitOrderRepository.findOne({
      where: { id: orderId, userId },
    });
  }

  /**
   * Cancels a pending limit order
   */
  async cancelLimitOrder(
    orderId: string,
    userId: string
  ): Promise<LimitOrder> {
    const limitOrder = await this.limitOrderRepository.findOneOrFail({
      where: { id: orderId, userId, status: LimitOrderStatus.PENDING },
    });

    limitOrder.status = LimitOrderStatus.CANCELLED;
    const updated = await this.limitOrderRepository.save(limitOrder);

    this.logger.log(`Cancelled limit order ${orderId} for user ${userId}`);

    return updated;
  }

  /**
   * Checks if rate condition is met
   */
  checkRateCondition(
    currentRate: Decimal,
    targetRate: Decimal,
    condition: LimitOrderCondition
  ): boolean {
    switch (condition) {
      case LimitOrderCondition.AT_OR_ABOVE:
        return currentRate.greaterThanOrEqualTo(targetRate);
      case LimitOrderCondition.AT_OR_BELOW:
        return currentRate.lessThanOrEqualTo(targetRate);
      case LimitOrderCondition.EXACT:
        return currentRate.minus(targetRate).abs().lessThan(this.RATE_TOLERANCE);
      default:
        return false;
    }
  }

  /**
   * Executes a limit order
   */
  async executeLimitOrder(
    limitOrder: LimitOrder,
    currentRate: Decimal
  ): Promise<void> {
    this.logger.log(
      `Executing limit order ${limitOrder.id}: ${limitOrder.type} ${limitOrder.amount} ` +
        `${limitOrder.baseCurrency}→${limitOrder.targetCurrency} at rate ${currentRate}`
    );

    // Update status to executing
    limitOrder.status = LimitOrderStatus.EXECUTING;
    await this.limitOrderRepository.save(limitOrder);

    try {
      // Execute forex trade via Wallet service
      const result = await firstValueFrom(
        this.walletService.buyForex({
          userId: limitOrder.userId,
          baseCurrency: limitOrder.baseCurrency,
          targetCurrency: limitOrder.targetCurrency,
          amount: limitOrder.amount.toString(),
        })
      );

      // Create ForexOrder record for audit trail
      const forexOrder = this.forexOrderRepository.create({
        userId: limitOrder.userId,
        userEmail: limitOrder.userEmail,
        type: limitOrder.type,
        baseCurrency: limitOrder.baseCurrency,
        targetCurrency: limitOrder.targetCurrency,
        amount: limitOrder.amount,
        status: OrderStatus.COMPLETED,
        retryAttempts: 0,
        errorStatus: null,
        errorMessage: null,
      });

      const savedForexOrder = await this.forexOrderRepository.save(forexOrder);

      // Update limit order as completed
      limitOrder.status = LimitOrderStatus.COMPLETED;
      limitOrder.executedAt = new Date();
      limitOrder.executedRate = new Decimal(result.exchangeRate);
      limitOrder.executedAmount = new Decimal(result.targetAmount);
      limitOrder.forexOrderId = savedForexOrder.id;
      await this.limitOrderRepository.save(limitOrder);

      this.logger.log(
        `Successfully executed limit order ${limitOrder.id}. ` +
          `Received ${result.targetAmount} ${limitOrder.targetCurrency}`
      );

      // Send notification
      await this.sendExecutionNotification(limitOrder, currentRate);
    } catch (error) {
      this.logger.error(
        `Failed to execute limit order ${limitOrder.id}:`,
        error
      );

      // Mark as failed
      limitOrder.status = LimitOrderStatus.FAILED;
      limitOrder.errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.limitOrderRepository.save(limitOrder);

      // Send failure notification
      await this.sendFailureNotification(limitOrder, error);
    }
  }

  /**
   * Sends email notification for successful execution
   */
  private async sendExecutionNotification(
    limitOrder: LimitOrder,
    executedRate: Decimal
  ): Promise<void> {
    const subject = `Limit Order Executed: ${limitOrder.baseCurrency}→${limitOrder.targetCurrency}`;

    const text = `
Hello,

Your limit order has been successfully executed!

Order ID: ${limitOrder.id}
Type: ${limitOrder.type}
Currency Pair: ${limitOrder.baseCurrency} → ${limitOrder.targetCurrency}
Amount: ${limitOrder.amount} ${limitOrder.baseCurrency}
Target Rate: ${limitOrder.targetRate}
Executed Rate: ${executedRate}
Received: ${limitOrder.executedAmount} ${limitOrder.targetCurrency}
Executed At: ${limitOrder.executedAt?.toISOString()}

${limitOrder.notes ? `Notes: ${limitOrder.notes}` : ''}

Thank you for using Square Me!

Best regards,
Square Me Team
    `.trim();

    try {
      await this.notificationService.notifyUser({
        to: limitOrder.userEmail,
        subject,
        text,
        html: '',
      });

      this.logger.log(
        `Sent execution notification to ${limitOrder.userEmail}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to send execution notification to ${limitOrder.userEmail}:`,
        error
      );
    }
  }

  /**
   * Sends email notification for execution failure
   */
  private async sendFailureNotification(
    limitOrder: LimitOrder,
    error: any
  ): Promise<void> {
    const subject = `Limit Order Failed: ${limitOrder.baseCurrency}→${limitOrder.targetCurrency}`;

    const text = `
Hello,

Your limit order execution failed.

Order ID: ${limitOrder.id}
Type: ${limitOrder.type}
Currency Pair: ${limitOrder.baseCurrency} → ${limitOrder.targetCurrency}
Amount: ${limitOrder.amount} ${limitOrder.baseCurrency}
Target Rate: ${limitOrder.targetRate}
Error: ${limitOrder.errorMessage}

Please review your wallet balance and try creating a new limit order.

Best regards,
Square Me Team
    `.trim();

    try {
      await this.notificationService.notifyUser({
        to: limitOrder.userEmail,
        subject,
        text,
        html: '',
      });

      this.logger.log(`Sent failure notification to ${limitOrder.userEmail}`);
    } catch (error) {
      this.logger.error(
        `Failed to send failure notification to ${limitOrder.userEmail}:`,
        error
      );
    }
  }

  /**
   * Cron job: Check pending limit orders every 2 minutes
   */
  @Cron(CronExpression.EVERY_2_MINUTES, {
    name: 'check-limit-orders',
  })
  async checkPendingLimitOrders(): Promise<void> {
    this.logger.log('Checking pending limit orders...');

    // Get all pending limit orders
    const pendingOrders = await this.limitOrderRepository.find({
      where: { status: LimitOrderStatus.PENDING },
      order: { createdAt: 'ASC' },
    });

    if (pendingOrders.length === 0) {
      this.logger.log('No pending limit orders to check');
      return;
    }

    this.logger.log(`Checking ${pendingOrders.length} pending limit orders`);

    // Group orders by currency pair to minimize rate fetches
    const ordersByCurrencyPair = new Map<string, LimitOrder[]>();

    for (const order of pendingOrders) {
      const key = `${order.baseCurrency}:${order.targetCurrency}`;
      if (!ordersByCurrencyPair.has(key)) {
        ordersByCurrencyPair.set(key, []);
      }
      ordersByCurrencyPair.get(key)!.push(order);
    }

    let executedCount = 0;

    // Check each currency pair
    for (const [currencyPair, orders] of ordersByCurrencyPair.entries()) {
      const [baseCurrency, targetCurrency] = currencyPair.split(':');

      try {
        // Fetch current rate from Integration service via gRPC
        // NOTE: In production, you would fetch actual rates
        // const result = await firstValueFrom(
        //   this.integrationService.convertCurrency({
        //     from: baseCurrency,
        //     to: targetCurrency,
        //     amount: '1',
        //   })
        // );
        // const currentRate = new Decimal(result.exchangeRate);

        // For this example, we'll use a mock rate
        // In production, replace with actual Integration service call
        this.logger.log(
          `Would fetch current rate for ${baseCurrency}→${targetCurrency}`
        );

        // Check each order for this currency pair
        for (const order of orders) {
          // Update check statistics
          order.checkCount += 1;
          order.lastCheckedAt = new Date();
          await this.limitOrderRepository.save(order);

          // In production, check if rate condition is met and execute
          // const isConditionMet = this.checkRateCondition(
          //   currentRate,
          //   order.targetRate,
          //   order.condition
          // );
          //
          // if (isConditionMet) {
          //   await this.executeLimitOrder(order, currentRate);
          //   executedCount++;
          // }
        }
      } catch (error) {
        this.logger.error(
          `Failed to check limit orders for ${baseCurrency}→${targetCurrency}:`,
          error
        );
      }
    }

    this.logger.log(
      `Finished checking limit orders. Executed: ${executedCount}/${pendingOrders.length}`
    );
  }

  /**
   * Cron job: Expire old limit orders
   */
  @Cron(CronExpression.EVERY_HOUR, {
    name: 'expire-limit-orders',
  })
  async expireOldLimitOrders(): Promise<void> {
    const now = new Date();

    const result = await this.limitOrderRepository.update(
      {
        status: LimitOrderStatus.PENDING,
        expiresAt: LessThan(now),
      },
      {
        status: LimitOrderStatus.EXPIRED,
      }
    );

    if (result.affected && result.affected > 0) {
      this.logger.log(`Expired ${result.affected} limit orders`);
    }
  }

  /**
   * Returns statistics for limit orders
   */
  async getLimitOrderStats(userId: string): Promise<{
    pending: number;
    completed: number;
    cancelled: number;
    expired: number;
    failed: number;
  }> {
    const [pending, completed, cancelled, expired, failed] = await Promise.all([
      this.limitOrderRepository.count({
        where: { userId, status: LimitOrderStatus.PENDING },
      }),
      this.limitOrderRepository.count({
        where: { userId, status: LimitOrderStatus.COMPLETED },
      }),
      this.limitOrderRepository.count({
        where: { userId, status: LimitOrderStatus.CANCELLED },
      }),
      this.limitOrderRepository.count({
        where: { userId, status: LimitOrderStatus.EXPIRED },
      }),
      this.limitOrderRepository.count({
        where: { userId, status: LimitOrderStatus.FAILED },
      }),
    ]);

    return { pending, completed, cancelled, expired, failed };
  }
}
