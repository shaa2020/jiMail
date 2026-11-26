import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { loadConfig } from '../../config/config';
import { AllowMfaPending, CurrentPrincipal, Public } from '../../common/decorators';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../common/guards/auth.guard';
import { JiRequest, UserPrincipal } from '../../common/principal';
import { PrismaService } from '../../common/prisma.service';
import { ApiZodBody, zEmail, ZodPipe, zPassword } from '../../common/zod';
import { AuthService, IssuedSession } from './auth.service';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: zEmail,
  password: zPassword,
  organizationName: z.string().trim().min(2).max(100),
});
const loginSchema = z.object({ email: zEmail, password: z.string().min(1).max(256) });
const tokenSchema = z.object({ token: z.string().min(10).max(200) });
const emailSchema = z.object({ email: zEmail });
const resetSchema = z.object({ token: z.string().min(10).max(200), password: zPassword });
const mfaSchema = z.object({ code: z.string().trim().min(6).max(20) });
const changePwSchema = z.object({ currentPassword: z.string().min(1), newPassword: zPassword });
const disable2faSchema = z.object({ password: z.string().min(1), code: z.string().trim().min(6).max(20) });

export function clientOf(req: JiRequest) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

export function setSessionCookies(res: Response, s: IssuedSession) {
  const cfg = loadConfig();
  const base = { secure: cfg.COOKIE_SECURE, sameSite: 'lax' as const, path: '/', domain: cfg.COOKIE_DOMAIN || undefined, expires: s.expiresAt };
  res.cookie(SESSION_COOKIE, s.token, { ...base, httpOnly: true });
  // Readable by the SPA so it can echo it in X-CSRF-Token (double-submit pattern).
  res.cookie(CSRF_COOKIE, s.csrfToken, { ...base, httpOnly: false });
}

export function clearSessionCookies(res: Response) {
  const cfg = loadConfig();
  const base = { path: '/', domain: cfg.COOKIE_DOMAIN || undefined };
  res.clearCookie(SESSION_COOKIE, base);
  res.clearCookie(CSRF_COOKIE, base);
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Public authentication settings' })
  config() {
    const c = loadConfig();
    return { appName: c.APP_NAME, allowSignup: c.ALLOW_SIGNUP };
  }

  @Public()
  @Post('register')
  @HttpCode(202)
  @ApiZodBody(registerSchema)
  @ApiOperation({ summary: 'Register a customer account and organisation' })
  register(@Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>, @Req() req: JiRequest) {
    return this.auth.register(body, clientOf(req));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @ApiZodBody(tokenSchema)
  verify(@Body(new ZodPipe(tokenSchema)) body: z.infer<typeof tokenSchema>) {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(202)
  @ApiZodBody(emailSchema)
  resend(@Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>, @Req() req: JiRequest) {
    return this.auth.resendVerification(body.email, clientOf(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  @ApiOperation({ summary: 'Sign in. Returns mfaRequired=true when a second factor is needed.' })
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: JiRequest, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.login(body, clientOf(req));
    setSessionCookies(res, s);
    return { mfaRequired: s.mfaPending };
  }

  @AllowMfaPending()
  @Post('mfa')
  @HttpCode(200)
  @ApiZodBody(mfaSchema)
  @ApiOperation({ summary: 'Complete sign-in with a TOTP or recovery code' })
  async mfa(@Body(new ZodPipe(mfaSchema)) body: z.infer<typeof mfaSchema>, @CurrentPrincipal() p: UserPrincipal, @Req() req: JiRequest, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.completeMfa(p.sessionId, body.code, clientOf(req));
    setSessionCookies(res, s);
    return { ok: true };
  }

  @AllowMfaPending()
  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentPrincipal() p: UserPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(p.sessionId);
    clearSessionCookies(res);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @ApiZodBody(emailSchema)
  forgot(@Body(new ZodPipe(emailSchema)) body: z.infer<typeof emailSchema>, @Req() req: JiRequest) {
    return this.auth.forgotPassword(body.email, clientOf(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @ApiZodBody(resetSchema)
  reset(@Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>, @Req() req: JiRequest) {
    return this.auth.resetPassword(body.token, body.password, clientOf(req));
  }

  // ─────────── Authenticated account security ───────────

  @Post('change-password')
  @HttpCode(200)
  @ApiZodBody(changePwSchema)
  async changePassword(@Body(new ZodPipe(changePwSchema)) body: z.infer<typeof changePwSchema>, @CurrentPrincipal() p: UserPrincipal, @Req() req: JiRequest, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.changePassword(p.userId, p.sessionId, body.currentPassword, body.newPassword, clientOf(req));
    setSessionCookies(res, s);
    return { ok: true };
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setup2fa(@CurrentPrincipal() p: UserPrincipal) {
    return this.auth.begin2fa(p.userId);
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  @ApiZodBody(mfaSchema)
  confirm2fa(@Body(new ZodPipe(mfaSchema)) body: z.infer<typeof mfaSchema>, @CurrentPrincipal() p: UserPrincipal) {
    return this.auth.confirm2fa(p.userId, body.code);
  }

  @Post('2fa/recovery-codes')
  @HttpCode(200)
  @ApiZodBody(mfaSchema)
  regen(@Body(new ZodPipe(mfaSchema)) body: z.infer<typeof mfaSchema>, @CurrentPrincipal() p: UserPrincipal) {
    return this.auth.regenerateRecoveryCodes(p.userId, body.code);
  }

  @Post('2fa/disable')
  @HttpCode(200)
  @ApiZodBody(disable2faSchema)
  disable2fa(@Body(new ZodPipe(disable2faSchema)) body: z.infer<typeof disable2faSchema>, @CurrentPrincipal() p: UserPrincipal) {
    return this.auth.disable2fa(p.userId, body.password, body.code);
  }

  @Get('sessions')
  async sessions(@CurrentPrincipal() p: UserPrincipal) {
    const rows = await this.prisma.session.findMany({
      where: { userId: p.userId, revokedAt: null, expiresAt: { gt: new Date() }, mfaPending: false },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === p.sessionId }));
  }

  @Delete('sessions/:id')
  async revokeSession(@Param('id') id: string, @CurrentPrincipal() p: UserPrincipal) {
    await this.prisma.session.updateMany({ where: { id, userId: p.userId }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentPrincipal() p: UserPrincipal) {
    const r = await this.prisma.session.updateMany({ where: { userId: p.userId, revokedAt: null, id: { not: p.sessionId } }, data: { revokedAt: new Date() } });
    return { revoked: r.count };
  }

  @Get('login-history')
  loginHistory(@CurrentPrincipal() p: UserPrincipal, @Query('limit') limit?: string) {
    return this.prisma.loginEvent.findMany({
      where: { userId: p.userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 50, 200),
      select: { id: true, success: true, reason: true, ip: true, userAgent: true, suspicious: true, createdAt: true },
    });
  }
}
