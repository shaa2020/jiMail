import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AllowMfaPending, CurrentPrincipal } from '../../common/decorators';
import { UserPrincipal } from '../../common/principal';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, ZodPipe } from '../../common/zod';

const profileSchema = z.object({ name: z.string().trim().min(1).max(100) });

@ApiTags('me')
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @AllowMfaPending()
  async me(@CurrentPrincipal() p: UserPrincipal) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: p.userId },
      include: {
        memberships: { include: { organization: { select: { id: true, name: true, slug: true, status: true, require2fa: true } } }, orderBy: { createdAt: 'asc' } },
        mailboxAccess: { include: { mailbox: { select: { id: true, address: true, displayName: true, status: true } } } },
      },
    });
    const session = await this.prisma.session.findUnique({ where: { id: p.sessionId }, select: { mfaPending: true } });
    const unread = await this.prisma.notification.count({ where: { userId: p.userId, readAt: null } });
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      platformRole: u.platformRole,
      authSource: u.authSource,
      emailVerified: !!u.emailVerifiedAt,
      twoFactorEnabled: !!u.totpEnabledAt,
      mfaPending: !!session?.mfaPending,
      mustEnroll2fa: !u.totpEnabledAt && (u.memberships.some((m) => m.organization.require2fa) || u.platformRole === 'SUPER_ADMIN'),
      organizations: u.memberships.map((m) => ({ ...m.organization, role: m.role })),
      mailboxes: u.mailboxAccess.filter((a) => a.mailbox.status !== 'DELETED').map((a) => a.mailbox),
      unreadNotifications: unread,
    };
  }

  @Patch()
  @ApiZodBody(profileSchema)
  async update(@CurrentPrincipal() p: UserPrincipal, @Body(new ZodPipe(profileSchema)) b: z.infer<typeof profileSchema>) {
    await this.prisma.user.update({ where: { id: p.userId }, data: { name: b.name } });
    return { ok: true };
  }

  @Get('notifications')
  notifications(@CurrentPrincipal() p: UserPrincipal) {
    return this.prisma.notification.findMany({ where: { userId: p.userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@CurrentPrincipal() p: UserPrincipal, @Param('id') id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: p.userId }, data: { readAt: new Date() } });
    return { ok: true };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentPrincipal() p: UserPrincipal) {
    await this.prisma.notification.updateMany({ where: { userId: p.userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
