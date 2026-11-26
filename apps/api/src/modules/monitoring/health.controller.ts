import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { MonitoringService } from './monitoring.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly monitoring: MonitoringService) {}

  /** Liveness: the process is up. */
  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: database and Redis reachable (mail server status reported but not fatal). */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const comps = await this.monitoring.components();
    const critical = comps.filter((c) => ['database', 'redis'].includes(c.name));
    const ok = critical.every((c) => c.ok);
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', components: comps.map((c) => ({ name: c.name, ok: c.ok })) };
  }
}
