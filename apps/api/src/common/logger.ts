import pino from 'pino';
import { loadConfig } from '../config/config';

/**
 * Structured JSON logger. Redaction paths make sure credentials never reach logs,
 * even if an object containing them is logged by mistake.
 */
export const logger = pino({
  level: loadConfig().LOG_LEVEL,
  base: { service: 'jimail-api' },
  redact: {
    paths: [
      'password', '*.password', 'newPassword', '*.newPassword', 'currentPassword', '*.currentPassword',
      'secret', '*.secret', 'token', '*.token', 'code', '*.code', 'apiKey', '*.apiKey',
      'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
      'headers.authorization', 'headers.cookie', '*.serviceKeyEnc', '*.passwordHash', '*.totpSecretEnc',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
