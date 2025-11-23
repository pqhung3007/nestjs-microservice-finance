import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { Logger } from '@nestjs/common';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';

interface RateSubscription {
  from: string;
  to: string;
}

interface ConnectedClient {
  socket: WebSocket;
  subscriptions: Set<string>;
}

/**
 * WebSocket Gateway for Real-time Exchange Rate Streaming
 *
 * Features:
 * - Real-time rate updates pushed to subscribed clients
 * - Selective subscription (users choose currency pairs)
 * - Efficient broadcasting using subscription registry
 * - Automatic cleanup on disconnect
 *
 * Usage:
 * Client connects to ws://integration:4444/rates
 * Client sends: { event: 'subscribe', data: { from: 'USD', to: 'EUR' } }
 * Server broadcasts rate updates whenever rates change
 */
@WebSocketGateway({ path: '/rates' })
export class RateStreamingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RateStreamingGateway.name);
  private clients: Map<string, ConnectedClient> = new Map();

  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  handleConnection(client: WebSocket) {
    const clientId = this.generateClientId();
    this.clients.set(clientId, {
      socket: client,
      subscriptions: new Set(),
    });

    // Store clientId on socket for cleanup
    (client as any).clientId = clientId;

    this.logger.log(`Client connected: ${clientId}`);
    this.logger.log(`Total connected clients: ${this.clients.size}`);

    // Send welcome message
    client.send(
      JSON.stringify({
        event: 'connection',
        data: {
          message: 'Connected to rate streaming service',
          clientId,
        },
      })
    );
  }

  handleDisconnect(client: WebSocket) {
    const clientId = (client as any).clientId;
    if (clientId) {
      this.clients.delete(clientId);
      this.logger.log(`Client disconnected: ${clientId}`);
      this.logger.log(`Total connected clients: ${this.clients.size}`);
    }
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @MessageBody() data: RateSubscription,
    @ConnectedSocket() client: WebSocket
  ) {
    const clientId = (client as any).clientId;
    const connectedClient = this.clients.get(clientId);

    if (!connectedClient) {
      client.send(
        JSON.stringify({
          event: 'error',
          data: { message: 'Client not found' },
        })
      );
      return;
    }

    const { from, to } = data;
    const subscriptionKey = `${from}:${to}`;

    connectedClient.subscriptions.add(subscriptionKey);

    this.logger.log(
      `Client ${clientId} subscribed to ${from} → ${to} rate updates`
    );

    // Send current rate immediately
    this.sendCurrentRate(client, from, to);

    client.send(
      JSON.stringify({
        event: 'subscribed',
        data: {
          from,
          to,
          subscriptionKey,
        },
      })
    );
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(
    @MessageBody() data: RateSubscription,
    @ConnectedSocket() client: WebSocket
  ) {
    const clientId = (client as any).clientId;
    const connectedClient = this.clients.get(clientId);

    if (!connectedClient) {
      return;
    }

    const { from, to } = data;
    const subscriptionKey = `${from}:${to}`;

    connectedClient.subscriptions.delete(subscriptionKey);

    this.logger.log(
      `Client ${clientId} unsubscribed from ${from} → ${to} rate updates`
    );

    client.send(
      JSON.stringify({
        event: 'unsubscribed',
        data: {
          from,
          to,
        },
      })
    );
  }

  @SubscribeMessage('get-rate')
  async handleGetRate(
    @MessageBody() data: RateSubscription,
    @ConnectedSocket() client: WebSocket
  ) {
    const { from, to } = data;
    await this.sendCurrentRate(client, from, to);
  }

  /**
   * Broadcasts rate update to all subscribed clients
   * Called by ExchangeRateService when rates are updated
   */
  async broadcastRateUpdate(from: string, to: string, newRate: string) {
    const subscriptionKey = `${from}:${to}`;
    let broadcastCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (client.subscriptions.has(subscriptionKey)) {
        try {
          client.socket.send(
            JSON.stringify({
              event: 'rate-update',
              data: {
                from,
                to,
                rate: newRate,
                timestamp: new Date().toISOString(),
              },
            })
          );
          broadcastCount++;
        } catch (error) {
          this.logger.error(
            `Failed to send rate update to client ${clientId}:`,
            error
          );
        }
      }
    }

    if (broadcastCount > 0) {
      this.logger.log(
        `Broadcasted ${from} → ${to} rate update to ${broadcastCount} clients`
      );
    }
  }

  /**
   * Sends current rate to a specific client
   */
  private async sendCurrentRate(
    client: WebSocket,
    from: string,
    to: string
  ) {
    try {
      const rate = await this.exchangeRateService.getExchangeRate(from, to);

      client.send(
        JSON.stringify({
          event: 'current-rate',
          data: {
            from,
            to,
            rate,
            timestamp: new Date().toISOString(),
          },
        })
      );
    } catch (error) {
      this.logger.error(`Failed to get exchange rate for ${from} → ${to}:`, error);
      client.send(
        JSON.stringify({
          event: 'error',
          data: {
            message: `Failed to get exchange rate for ${from} → ${to}`,
          },
        })
      );
    }
  }

  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Returns the number of clients subscribed to a specific rate
   */
  getSubscriptionCount(from: string, to: string): number {
    const subscriptionKey = `${from}:${to}`;
    let count = 0;

    for (const client of this.clients.values()) {
      if (client.subscriptions.has(subscriptionKey)) {
        count++;
      }
    }

    return count;
  }

  /**
   * Returns total number of connected clients
   */
  getConnectedClientsCount(): number {
    return this.clients.size;
  }
}
