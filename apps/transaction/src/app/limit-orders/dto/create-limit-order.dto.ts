import {
  IsEnum,
  IsISO4217CurrencyCode,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsString,
} from 'class-validator';
import { OrderType } from '../../../typeorm/models/enums';
import { LimitOrderCondition } from '../../../typeorm/models/limit-order.model';

export class CreateLimitOrderDto {
  @IsNotEmpty()
  @IsEnum(OrderType)
  type: OrderType;

  @IsNotEmpty()
  @IsISO4217CurrencyCode()
  baseCurrency: string;

  @IsNotEmpty()
  @IsISO4217CurrencyCode()
  targetCurrency: string;

  @IsNotEmpty()
  @IsString()
  amount: string; // Decimal as string to avoid precision loss

  @IsNotEmpty()
  @IsString()
  targetRate: string; // Decimal as string to avoid precision loss

  @IsNotEmpty()
  @IsEnum(LimitOrderCondition)
  condition: LimitOrderCondition;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
