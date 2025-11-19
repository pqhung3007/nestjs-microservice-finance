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

export enum AlertCondition {
  ABOVE = 'above',
  BELOW = 'below',
  EQUALS = 'equals',
}

export enum AlertStatus {
  ACTIVE = 'active',
  TRIGGERED = 'triggered',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

/**
 * Rate Alert Entity
 *
 * Allows users to create alerts for specific exchange rate thresholds
 * Example: "Alert me when USD → EUR rate goes above 1.10"
 *
 * Features:
 * - Multiple alert conditions (above, below, equals)
 * - Email notifications when triggered
 * - Auto-cancellation after trigger (configurable)
 * - Expiration dates for time-limited alerts
 */
@Entity()
@Index(['userId', 'status'])
@Index(['baseCurrency', 'targetCurrency', 'status'])
export class RateAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  @IsEmail()
  userEmail: string;

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
  targetRate: Decimal;

  @Column({
    type: 'enum',
    enum: AlertCondition,
  })
  condition: AlertCondition;

  @Column({
    type: 'enum',
    enum: AlertStatus,
    default: AlertStatus.ACTIVE,
  })
  status: AlertStatus;

  @Column({ default: true })
  notifyByEmail: boolean;

  @Column({ default: false })
  repeatAlert: boolean; // If true, alert remains active after trigger

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  triggeredAt: Date | null;

  @Column({
    type: 'decimal',
    precision: 20,
    scale: 8,
    transformer: new DecimalTransformer(),
    nullable: true,
  })
  @Transform(DecimalToString(8), { toPlainOnly: true })
  triggeredRate: Decimal | null;

  @Column({ nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
