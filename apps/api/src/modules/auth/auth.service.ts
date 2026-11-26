import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, TokenPurpose, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { loadConfig } from '../../config/config';
import { AuditService } from '../../common/audit.service';
import { decrypt, encrypt, hashToken, randomToken } from '../../common/crypto';
import { logger } from '../../common/logger';
import { MailerService } from '../../common/mailer.service';
import { PrismaService } from '../../common/prisma.service';
import { RateLimitService } from '../../common/rate-limit.service';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../common/totp';
import { StalwartClient } from '../stalwart/stalwart.client';
import { BillingService } from '../billing/billing.service';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } satisfies argon2.HashOptions;
const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  mfaPending: boolean;
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'org'
  );
}

@Injectable()
export class AuthService {
  private readonly cfg = loadConfig();
  // Pre-computed hash used to equalise timing when the user does not exist.
  private dummyHash: Promise<string> = argon2.hash('jimail-timing-equaliser', { ...ARGON_OPTS, raw: false });

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
    private readonly rl: RateLimitService,
    private readonly audit: AuditService,
    private readonly stalwart: StalwartClient,
    private readonly billing: BillingService,
  ) {}

  hashPassword(pw: string): Promise<string> {
    return argon2.hash(pw, { ...ARGON_OPTS, raw: false });
  }

  // ───────────────────────── Registration ─────────────────────────

  async register(input: { name: string; email: string; password: string; organizationName: string }, client: ClientInfo) {
    if (!this.cfg.ALLOW_SIGNUP) throw new ForbiddenException('Public registration is disabled on this JiMail installation');
    await this.rl.enforce(`register:${client.ip}`, 10, 3600, 'Too many registrations from this address. Try again later.');

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Do not reveal account existence; tell the real owner instead.
      await this.mailer.send({
        to: input.email,
        subject: `${this.cfg.APP_NAME}: sign-up attempt`,
        heading: 'Someone tried to sign up with your address',
        paragraphs: ['An account already exists for this email address. If this was you, sign in or reset your password.'],
        action: { label: 'Sign in', url: `${this.cfg.APP_URL}/login` },
      });
      return { ok: true };
    }

    const passwordHash = await this.hashPassword(input.password);
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash } });
      const org = await tx.organization.create({ data: { name: input.organizationName, slug: await this.uniqueSlug(tx, input.organizationName) } });
      await tx.membership.create({ data: { userId: u.id, organizationId: org.id, role: 'OWNER' } });
      await this.billing.startTrial(tx, org.id);
      await this.audit.record(undefined, { action: 'organization.created', organizationId: org.id, targetType: 'organization', targetId: org.id, ip: client.ip, metadata: { via: 'signup' } }, tx);
      return u;
    });
    await this.sendVerification(user);
    return { ok: true };
  }

  async uniqueSlug(tx: Prisma.TransactionClient, name: string) {
    const base = slugify(name);
    for (let i = 0; i < 50; i++) {
      const slug = i === 0 ? base : `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (!(await tx.organization.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${Date.now()}`;
  }

  private async issueUserToken(userId: string, purpose: TokenPurpose, ttlMinutes: number) {
    const token = randomToken(32);
    await this.prisma.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await this.prisma.userToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
    });
    return token;
  }

  private async consumeUserToken(token: string, purpose: TokenPurpose) {
    const row = await this.prisma.userToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) {
      throw new BadRequestException('This link is invalid or has expired');
    }
    await this.prisma.userToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row;
  }

  async sendVerification(user: Pick<User, 'id' | 'email' | 'name'>) {
    const token = await this.issueUserToken(user.id, 'EMAIL_VERIFY', 60 * 24);
    await this.mailer.send({
      to: user.email,
      subject: `Verify your ${this.cfg.APP_NAME} account`,
      heading: `Welcome, ${user.name}`,
      paragraphs: ['Confirm your email address to activate your account. The link is valid for 24 hours.'],
      action: { label: 'Verify email', url: `${this.cfg.APP_URL}/verify-email?token=${encodeURIComponent(token)}` },
      footnote: 'If you did not create this account you can ignore this message.',
    });
  }

  async resendVerification(email: string, client: ClientInfo) {
    await this.rl.enforce(`resend:${client.ip}`, 5, 3600);
    await this.rl.enforce(`resend-email:${email}`, 3, 3600);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt && user.authSource === 'LOCAL') await this.sendVerification(user);
    return { ok: true };
  }

  async verifyEmail(token: string) {
    const row = await this.consumeUserToken(token, 'EMAIL_VERIFY');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
    return { ok: true };
  }

  // ───────────────────────── Login ─────────────────────────

  async login(input: { email: string; password: string }, client: ClientInfo): Promise<IssuedSession> {
    await this.rl.enforce(`login-ip:${client.ip}`, 30, 900, 'Too many sign-in attempts from this address. Try again in a few minutes.');
    await this.rl.enforce(`login-email:${input.email}`, 15, 900, 'Too many sign-in attempts for this account. Try again in a few minutes.');

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const fail = async (reason: string, u?: User | null): Promise<never> => {
      await this.prisma.loginEvent.create({ data: { userId: u?.id, email: input.email, success: false, reason, ip: client.ip, userAgent: client.userAgent } });
      if (u) {
        const failed = u.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: u.id },
          data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : u.lockedUntil },
        });
        if (failed === MAX_FAILED) {
          await this.prisma.securityEvent.create({
            data: { type: 'account.locked', severity: 'WARNING', message: `Account ${u.email} locked after ${MAX_FAILED} failed sign-ins`, metadata: { ip: client.ip } },
          });
        }
      }
      throw new UnauthorizedException('Incorrect email or password');
    };

    if (!user) {
      await argon2.verify(await this.dummyHash, input.password).catch(() => false);
      return fail('unknown_user');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException(`Account temporarily locked after repeated failures. Try again after ${user.lockedUntil.toISOString()}.`);
    }

    let valid = false;
    if (user.authSource === 'MAILBOX') {
      valid = await this.stalwart.verifyCredentials(user.email, input.password);
    } else if (user.passwordHash) {
      valid = await argon2.verify(user.passwordHash, input.password).catch(() => false);
    }
    if (!valid) return fail('bad_password', user);
    if (user.status !== 'ACTIVE') throw new ForbiddenException('This account is suspended. Contact your administrator.');
    if (user.authSource === 'LOCAL' && !user.emailVerifiedAt) {
      throw new ForbiddenException({ message: 'Verify your email address before signing in.', emailNotVerified: true });
    }

    const suspicious = await this.isSuspicious(user.id, client);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } }),
      this.prisma.loginEvent.create({ data: { userId: user.id, email: user.email, success: true, ip: client.ip, userAgent: client.userAgent, suspicious } }),
    ]);
    await this.rl.reset(`login-email:${input.email}`);
    if (suspicious) await this.flagSuspicious(user, client);
    if (user.passwordHash && argon2.needsRehash(user.passwordHash, ARGON_OPTS)) {
      await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.hashPassword(input.password) } });
    }
    return this.createSession(user.id, client, !!user.totpEnabledAt);
  }

  /** New IP never seen in this user's successful sign-ins over the last 90 days. */
  private async isSuspicious(userId: string, client: ClientInfo) {
    if (!client.ip) return false;
    const since = new Date(Date.now() - 90 * 86400_000);
    const [prior, sameIp] = await Promise.all([
      this.prisma.loginEvent.count({ where: { userId, success: true, createdAt: { gte: since } } }),
      this.prisma.loginEvent.count({ where: { userId, success: true, ip: client.ip, createdAt: { gte: since } } }),
    ]);
    return prior > 0 && sameIp === 0;
  }

  private async flagSuspicious(user: User, client: ClientInfo) {
    await this.prisma.notification.create({
      data: { userId: user.id, title: 'New sign-in location', body: `A sign-in from ${client.ip} (${client.userAgent ?? 'unknown device'}) was detected.`, level: 'WARNING' },
    });
    await this.mailer.send({
      to: user.email,
      subject: `${this.cfg.APP_NAME}: new sign-in to your account`,
      heading: 'New sign-in detected',
      paragraphs: [`Your account was accessed from a new address: ${client.ip}.`, `Device: ${client.userAgent ?? 'unknown'}`, 'If this was not you, change your password and review your active sessions immediately.'],
      action: { label: 'Review security', url: `${this.cfg.APP_URL}/settings/security` },
    });
  }

  async createSession(userId: string, client: ClientInfo, mfaPending: boolean): Promise<IssuedSession> {
    const token = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + (mfaPending ? 10 / 60 : this.cfg.SESSION_TTL_HOURS) * 3600_000);
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), csrfToken, ip: client.ip, userAgent: client.userAgent?.slice(0, 400), mfaPending, expiresAt },
    });
    return { token, csrfToken, expiresAt, mfaPending };
  }

  /** Session rotation: revoke the old token and issue a fresh one (after MFA, password change). */
  async rotateSession(sessionId: string, client: ClientInfo): Promise<IssuedSession> {
    const old = await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    return this.createSession(old.userId, client, false);
  }

  async completeMfa(sessionId: string, code: string, client: ClientInfo): Promise<IssuedSession> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || !session.mfaPending) throw new BadRequestException('No pending two-factor challenge');
    await this.rl.enforce(`mfa:${session.userId}`, 8, 900, 'Too many verification attempts. Sign in again later.');
    const ok = await this.checkSecondFactor(session.user, code);
    if (!ok) {
      await this.prisma.loginEvent.create({ data: { userId: session.userId, email: session.user.email, success: false, reason: 'bad_2fa', ip: client.ip, userAgent: client.userAgent } });
      throw new UnauthorizedException('Invalid verification code');
    }
    return this.rotateSession(sessionId, client);
  }

  private async checkSecondFactor(user: User, code: string): Promise<boolean> {
    const clean = code.replace(/[\s-]/g, '');
    if (user.totpSecretEnc && /^\d{6}$/.test(clean)) return verifyTotp(decrypt(user.totpSecretEnc), clean);
    // Recovery code (single use)
    const codes = await this.prisma.recoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
    const h = hashToken(clean.toLowerCase());
    const match = codes.find((c) => c.codeHash === h);
    if (!match) return false;
    await this.prisma.recoveryCode.update({ where: { id: match.id }, data: { usedAt: new Date() } });
    return true;
  }

  async logout(sessionId: string) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  // ───────────────────────── Passwords ─────────────────────────

  async forgotPassword(email: string, client: ClientInfo) {
    await this.rl.enforce(`forgot:${client.ip}`, 10, 3600);
    await this.rl.enforce(`forgot-email:${email}`, 3, 3600);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.status === 'ACTIVE') {
      if (user.authSource === 'MAILBOX') {
        await this.mailer.send({
          to: user.email,
          subject: `${this.cfg.APP_NAME}: password reset`,
          heading: 'Password reset requested',
          paragraphs: ['Your mailbox password is managed by your organisation administrator. Ask them to reset it from the JiMail dashboard.'],
        });
      } else {
        const token = await this.issueUserToken(user.id, 'PASSWORD_RESET', 60);
        await this.mailer.send({
          to: user.email,
          subject: `Reset your ${this.cfg.APP_NAME} password`,
          heading: 'Reset your password',
          paragraphs: ['Use the button below to choose a new password. The link is valid for 60 minutes and can be used once.'],
          action: { label: 'Choose a new password', url: `${this.cfg.APP_URL}/reset-password?token=${encodeURIComponent(token)}` },
          footnote: `Requested from ${client.ip ?? 'unknown address'}. If this was not you, you can ignore this email.`,
        });
      }
    }
    return { ok: true };
  }

  async resetPassword(token: string, password: string, client: ClientInfo) {
    const row = await this.consumeUserToken(token, 'PASSWORD_RESET');
    const passwordHash = await this.hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record(undefined, { action: 'user.password_reset', targetType: 'user', targetId: row.userId, ip: client.ip });
    return { ok: true };
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string, client: ClientInfo) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.rl.enforce(`chpw:${userId}`, 10, 3600);
    if (user.authSource === 'MAILBOX') {
      if (!(await this.stalwart.verifyCredentials(user.email, current))) throw new BadRequestException('Current password is incorrect');
      const mb = await this.prisma.mailbox.findUnique({ where: { address: user.email } });
      if (!mb?.stalwartId) throw new BadRequestException('Mailbox not provisioned');
      await this.stalwart.setPassword(mb.stalwartId, next);
    } else {
      if (!user.passwordHash || !(await argon2.verify(user.passwordHash, current))) throw new BadRequestException('Current password is incorrect');
      await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(next) } });
    }
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, id: { not: sessionId } }, data: { revokedAt: new Date() } });
    await this.audit.record({ kind: 'user', userId, email: user.email, name: user.name, platformRole: user.platformRole, sessionId, memberships: [] }, { action: 'user.password_changed', targetType: 'user', targetId: userId, ip: client.ip });
    return this.rotateSession(sessionId, client);
  }

  // ───────────────────────── Two-factor ─────────────────────────

  async begin2fa(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw new BadRequestException('Two-factor authentication is already enabled');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: encrypt(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email, this.cfg.APP_NAME) };
  }

  async confirm2fa(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpSecretEnc || user.totpEnabledAt) throw new BadRequestException('Start the two-factor setup first');
    if (!verifyTotp(decrypt(user.totpSecretEnc), code)) throw new BadRequestException('Invalid code. Check your authenticator app and device clock.');
    const codes = Array.from({ length: 10 }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8));
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashToken(c) })) }),
    ]);
    logger.info({ userId }, '2FA enabled');
    return { recoveryCodes: codes };
  }

  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt || !user.totpSecretEnc || !verifyTotp(decrypt(user.totpSecretEnc), code)) throw new BadRequestException('Invalid code');
    const codes = Array.from({ length: 10 }, () => randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8));
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashToken(c) })) }),
    ]);
    return { recoveryCodes: codes };
  }

  async disable2fa(userId: string, password: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.totpEnabledAt) throw new BadRequestException('Two-factor authentication is not enabled');
    const pwOk = user.authSource === 'MAILBOX' ? await this.stalwart.verifyCredentials(user.email, password) : !!user.passwordHash && (await argon2.verify(user.passwordHash, password));
    if (!pwOk) throw new BadRequestException('Password is incorrect');
    if (!(await this.checkSecondFactor(user, code))) throw new BadRequestException('Invalid verification code');
    const blocked = await this.prisma.membership.findFirst({ where: { userId, organization: { require2fa: true } }, include: { organization: true } });
    if (blocked) throw new ForbiddenException(`${blocked.organization.name} requires two-factor authentication`);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: null, totpSecretEnc: null } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
    return { ok: true };
  }
}
