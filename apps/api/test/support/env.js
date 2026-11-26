// Loads apps/api/.env (if present) for tests that run against real services.
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.JIMAIL_TEST_ENV ?? path.join(__dirname, '..', '..', '.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV ?? 'test');
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'warn';
