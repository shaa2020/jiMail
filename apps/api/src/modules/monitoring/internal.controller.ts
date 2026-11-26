import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';

const PREFIXES = ['autoconfig.', 'autodiscover.', 'mta-sts.', 'ua-auto-config.'];

/**
 * Internal endpoints for the reverse proxy. Caddy blocks /api/v1/internal/* from the internet.
 * tls-allowed: Caddy's on-demand TLS "ask" hook — a certificate is issued only for autoconfig-style
 * hostnames of domains whose ownership JiMail has verified (prevents certificate abuse).
 */
@ApiExcludeController()
@Controller('internal')
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('tls-allowed')
  async tlsAllowed(@Query('domain') host = '') {
    const h = host.toLowerCase();
    const prefix = PREFIXES.find((p) => h.startsWith(p));
    if (!prefix) throw new NotFoundException();
    const d = await this.prisma.domain.findUnique({ where: { name: h.slice(prefix.length) }, select: { verifiedAt: true, status: true } });
    if (!d?.verifiedAt || d.status === 'SUSPENDED') throw new NotFoundException();
    return { ok: true };
  }
}
