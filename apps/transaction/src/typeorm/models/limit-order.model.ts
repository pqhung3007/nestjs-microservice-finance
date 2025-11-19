import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { DecimalToString, DecimalTransformer } from '../decimal-transformer';
import Decimal from 'decimal.js';
import { Transform } from 'class-transformer';
import { IsEmail, IsISO4217CurrencyCode } from 'class-validator';
import { OrderType } from './enums';

export enum LimitOrderStatus {
  PENDING = 'pending',       // Waiting for target rate
  EXECUTING = 'executing',   // Being executed
  COMPLETED = 'completed',   // Successfully executed
  CANCELLED = 'cancelled',   // Cancelled by user
  EXPIRED = 'expired',       // Expired without execution
  FAILED = 'failed',         // Execution failed
}

export enum LimitOrderCondition {
  AT_OR_ABOVE = 'at_or_above',  // Execute when rate >= target
  AT_OR_BELOW = 'at_or_below',  // Execute when rate <= target
  EXACT = 'exact',              // Execute when rate ~= target (within tolerance)
}

/**
 * Limit Order Entity
 *
 * Allows users to create deferred forex orders that execute automatically
 * when exchange rates reach target thresholds
 *
 * Example:
 * "Buy €1000 when USD→EUR rate hits 1.10 or better"
 *
 * Features:
 * - Auto-execution when rate conditions are met
 * - Multiple condition types (at_or_above, at_or_below, exact)
 * - Expiration dates for time-limited orders
 * - Good-til-cancelled (GTC) orders
 * - Email notifications on execution
 * - Full audit trail
 */
@Entity()
@Index(['userId', 'status'])
@Index(['baseCurrency', 'targetCurrency', 'status'])
@Index(['status', 'expiresAt'])
export class LimitOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  @IsEmail()
  userEmail: string;

  @Column({
    type: 'enum',
    enum: OrderType,
  })
  type: OrderType;

  @Column()
  @IsISO4217CurrencyCode()
  baseCurrency: string;

  @Column()
  @IsISO4217CurrencyCode()
  targetCurrency: string;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new DecimalTransformer(),
  })
  @Transform(DecimalToString(8), { toPlainOnly: true })
  amount: Decimal; // Amount in base currency

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new DecimalTransformer(),
  })
  @Transform(DecimalToString(8), { toPlainOnly: true })
  targetRate: Decimal; // Desired exchange rate

  @Column({
    type: 'enum',
    enum: LimitOrderCondition,
  })
  condition: LimitOrderCondition;

  @Column({
    type: 'enum',
    enum: LimitOrderStatus,
    default: LimitOrderStatus.PENDING,
  })
  status: LimitOrderStatus;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null; // null = Good-til-cancelled (GTC)

  @Column({ type: 'timestamp', nullable: true })
  executedAt: Date | null;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new DecimalTransformer(),
    nullable: true,
  })
  @Transform(DecimalToString(8), { toPlainOnly: true })
  executedRate: Decimal | null; // Actual rate at execution

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new DecimalTransformer(),
    nullable: true,
  })
  @Transform(DecimalToString(8), { toPlainOnly: true })
  executedAmount: Decimal | null; // Amount received in target currency

  @Column({ nullable: true })
  forexOrderId: string | null; // Reference to executed ForexOrder

  @Column({ nullable: true })
  errorMessage: string | null;

  @Column({ default: 0 })
  checkCount: number; // Number of times rate was checked

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt: Date | null;

  @Column({ nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
