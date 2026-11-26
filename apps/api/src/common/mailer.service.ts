import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodemailer, { Transporter } from 'nodemailer';
import { loadConfig } from '../config/config';
import { logger } from './logger';

export interface SystemMail {
  to: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Renders a branded, table-based HTML email with a plain-text alternative. */
export function renderSystemMail(m: SystemMail, appName: string) {
  const btn = m.action
    ? `<tr><td style="padding:8px 0 24px"><a href="${esc(m.action.url)}" style="display:inline-block;background:#0f6e5c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">${esc(m.action.label)}</a></td></tr>
       <tr><td style="font-size:12px;color:#6b7280;padding-bottom:16px">If the button does not work, copy this link:<br><span style="word-break:break-all">${esc(m.action.url)}</span></td></tr>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb">
<tr><td style="padding:28px 32px 8px;font-size:20px;font-weight:700;letter-spacing:-0.02em"><span style="display:inline-block;width:28px;height:28px;border-radius:8px;background:#0f6e5c;color:#fff;text-align:center;line-height:28px;font-size:15px;margin-right:8px">J</span>${esc(appName)}</td></tr>
<tr><td style="padding:8px 32px 0"><table role="presentation" width="100%">
<tr><td style="font-size:22px;font-weight:700;padding:12px 0">${esc(m.heading)}</td></tr>
${m.paragraphs.map((p) => `<tr><td style="font-size:15px;line-height:1.6;padding-bottom:12px;color:#374151">${esc(p)}</td></tr>`).join('')}
${btn}
${m.footnote ? `<tr><td style="font-size:12px;color:#6b7280;padding-bottom:24px">${esc(m.footnote)}</td></tr>` : ''}
</table></td></tr></table>
<div style="font-size:12px;color:#9ca3af;padding-top:16px">${esc(appName)} · Your email. Your domain. Your control.</div>
</td></tr></table></body></html>`;
  const text = [m.heading, '', ...m.paragraphs, '', m.action ? `${m.action.label}: ${m.action.url}` : '', m.footnote ?? '']
    .join('\n')
    .trim();
  return { html, text };
}

@Injectable()
export class MailerService {
  private transporter: Transporter | null = null;
  private readonly cfg = loadConfig();

  private getTransport(): Transporter | null {
    if (this.cfg.MAIL_TRANSPORT !== 'smtp') return null;
    if (!this.cfg.SMTP_HOST) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.cfg.SMTP_HOST,
        port: this.cfg.SMTP_PORT,
        secure: this.cfg.SMTP_SECURE,
        auth: this.cfg.SMTP_USER ? { user: this.cfg.SMTP_USER, pass: this.cfg.SMTP_PASSWORD } : undefined,
        tls: { rejectUnauthorized: this.cfg.SMTP_TLS_REJECT_UNAUTHORIZED },
      });
    }
    return this.transporter;
  }

  get configured() {
    return this.cfg.MAIL_TRANSPORT === 'file' || !!this.cfg.SMTP_HOST;
  }

  async send(m: SystemMail): Promise<boolean> {
    const { html, text } = renderSystemMail(m, this.cfg.APP_NAME);
    if (this.cfg.MAIL_TRANSPORT === 'file') {
      // Development/test only (refused in production by config validation).
      const dir = this.cfg.MAIL_FILE_DIR;
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${Date.now()}-${m.to.replace(/[^a-z0-9@.]/gi, '_')}.json`);
      await writeFile(file, JSON.stringify({ to: m.to, subject: m.subject, text, html }, null, 2));
      return true;
    }
    const t = this.getTransport();
    if (!t) {
      logger.warn({ to: m.to, subject: m.subject }, 'System mail not sent: SMTP is not configured');
      return false;
    }
    try {
      await t.sendMail({ from: this.cfg.SMTP_FROM, to: m.to, subject: m.subject, text, html });
      return true;
    } catch (err) {
      logger.error({ err: (err as Error).message, subject: m.subject }, 'System mail delivery failed');
      return false;
    }
  }
}
