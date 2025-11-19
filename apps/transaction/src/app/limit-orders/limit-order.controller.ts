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
import { LimitOrderService } from './limit-order.service';
import { CreateLimitOrderDto } from './dto/create-limit-order.dto';
import { LimitOrder } from '../../typeorm/models/limit-order.model';
import {
  AuthServiceGuard,
  RequestWithUser,
} from '@square-me/microservice-client';
import Decimal from 'decimal.js';

/**
 * Limit Order Controller
 *
 * Endpoints:
 * POST   /api/v1/limit-orders          - Create a new limit order
 * GET    /api/v1/limit-orders          - Get all user's limit orders
 * GET    /api/v1/limit-orders/stats    - Get limit order statistics
 * GET    /api/v1/limit-orders/:id      - Get specific limit order
 * DELETE /api/v1/limit-orders/:id      - Cancel a pending limit order
 */
@Controller('limit-orders')
@UseGuards(AuthServiceGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Post()
  async createLimitOrder(
    @Req() req: RequestWithUser,
    @Body() dto: CreateLimitOrderDto
  ): Promise<LimitOrder> {
    const limitOrder = await this.limitOrderService.createLimitOrder(
      req.user.id,
      req.user.email,
      dto.type,
      dto.baseCurrency,
      dto.targetCurrency,
      new Decimal(dto.amount),
      new Decimal(dto.targetRate),
      dto.condition,
      {
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        notes: dto.notes,
      }
    );

    return limitOrder;
  }

  @Get()
  async getUserLimitOrders(
    @Req() req: RequestWithUser
  ): Promise<LimitOrder[]> {
    return this.limitOrderService.getUserLimitOrders(req.user.id);
  }

  @Get('stats')
  async getLimitOrderStats(@Req() req: RequestWithUser): Promise<{
    pending: number;
    completed: number;
    cancelled: number;
    expired: number;
    failed: number;
  }> {
    return this.limitOrderService.getLimitOrderStats(req.user.id);
  }

  @Get(':id')
  async getLimitOrder(
    @Req() req: RequestWithUser,
    @Param('id') orderId: string
  ): Promise<LimitOrder | null> {
    return this.limitOrderService.getLimitOrderById(orderId, req.user.id);
  }

  @Delete(':id')
  async cancelLimitOrder(
    @Req() req: RequestWithUser,
    @Param('id') orderId: string
  ): Promise<LimitOrder> {
    return this.limitOrderService.cancelLimitOrder(orderId, req.user.id);
  }
}
