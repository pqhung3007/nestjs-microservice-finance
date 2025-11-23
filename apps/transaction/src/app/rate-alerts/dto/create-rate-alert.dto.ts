import { IsEnum, IsISO4217CurrencyCode, IsNotEmpty, IsOptional, IsBoolean, IsDateString, IsString } from 'class-validator';
import { AlertCondition } from '../../../typeorm/models/rate-alert.model';

export class CreateRateAlertDto {
  @IsNotEmpty()
  @IsISO4217CurrencyCode()
  baseCurrency: string;

  @IsNotEmpty()
  @IsISO4217CurrencyCode()
  targetCurrency: string;

  @IsNotEmpty()
  @IsString()
  targetRate: string; // Decimal as string to avoid precision loss

  @IsNotEmpty()
  @IsEnum(AlertCondition)
  condition: AlertCondition;

  @IsOptional()
  @IsBoolean()
  notifyByEmail?: boolean;

  @IsOptional()
  @IsBoolean()
  repeatAlert?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
