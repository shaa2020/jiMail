import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const OUTBOX = process.env.E2E_OUTBOX ?? '/tmp/jimail-outbox';
export const DNS_FILE = process.env.FAKE_DNS_FILE ?? '/tmp/fakedns.json';

export function lastMailTo(address: string): { subject: string; text: string } {
  const key = address.replace(/[^a-z0-9@.]/gi, '_');
  const files = readdirSync(OUTBOX).filter((f) => f.includes(key)).sort();
  if (!files.length) throw new Error(`no mail for ${address}`);
  return JSON.parse(readFileSync(join(OUTBOX, files[files.length - 1]), 'utf8'));
}

export function tokenLink(text: string): string {
  return text.match(/https?:\/\/\S+token=\S+/)![0];
}

export function setDns(name: string, type: string, values: unknown[]) {
  const rec = existsSync(DNS_FILE) ? JSON.parse(readFileSync(DNS_FILE, 'utf8')) : {};
  rec[`${name.toLowerCase()}|${type}`] = values;
  writeFileSync(DNS_FILE, JSON.stringify(rec, null, 2));
}
