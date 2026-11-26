import { Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { JiRequest } from '../../common/principal';
import { RateLimitService } from '../../common/rate-limit.service';
import { DeliveryService } from './delivery.service';

/** Receives Stalwart telemetry webhooks (HMAC-SHA256 signed, base64, X-Signature header). */
@ApiExcludeController()
@Controller('stalwart')
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly rl: RateLimitService,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: JiRequest & { rawBody?: Buffer }, @Headers('x-signature') signature?: string) {
    if (!req.rawBody || !this.delivery.verifySignature(req.rawBody, signature)) {
      await this.rl.enforce(`wh-fail:${req.ip}`, 30, 300);
      throw new UnauthorizedException('Invalid signature');
    }
    const body = JSON.parse(req.rawBody.toString('utf8')) as { events?: any[] };
    return this.delivery.ingest(Array.isArray(body.events) ? body.events : []);
  }
}
