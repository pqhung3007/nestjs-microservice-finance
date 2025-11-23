import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { RateAlertService } from './rate-alert.service';
import { CreateRateAlertDto } from './dto/create-rate-alert.dto';
import { RateAlert } from '../../typeorm/models/rate-alert.model';
import { AuthServiceGuard, RequestWithUser } from '@square-me/microservice-client';
import Decimal from 'decimal.js';

/**
 * Rate Alert Controller
 *
 * Endpoints:
 * POST   /api/v1/rate-alerts          - Create a new rate alert
 * GET    /api/v1/rate-alerts          - Get all user's alerts
 * GET    /api/v1/rate-alerts/:id      - Get specific alert
 * DELETE /api/v1/rate-alerts/:id      - Cancel an alert
 */
@Controller('rate-alerts')
@UseGuards(AuthServiceGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class RateAlertController {
  constructor(private readonly rateAlertService: RateAlertService) {}

  @Post()
  async createAlert(
    @Req() req: RequestWithUser,
    @Body() dto: CreateRateAlertDto
  ): Promise<RateAlert> {
    const alert = await this.rateAlertService.createAlert(
      req.user.id,
      req.user.email,
      dto.baseCurrency,
      dto.targetCurrency,
      new Decimal(dto.targetRate),
      dto.condition,
      {
        notifyByEmail: dto.notifyByEmail,
        repeatAlert: dto.repeatAlert,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        notes: dto.notes,
      }
    );

    return alert;
  }

  @Get()
  async getUserAlerts(@Req() req: RequestWithUser): Promise<RateAlert[]> {
    return this.rateAlertService.getUserAlerts(req.user.id);
  }

  @Get(':id')
  async getAlert(
    @Req() req: RequestWithUser,
    @Param('id') alertId: string
  ): Promise<RateAlert | null> {
    return this.rateAlertService.getAlertById(alertId, req.user.id);
  }

  @Delete(':id')
  async cancelAlert(
    @Req() req: RequestWithUser,
    @Param('id') alertId: string
  ): Promise<RateAlert> {
    return this.rateAlertService.cancelAlert(alertId, req.user.id);
  }
}
