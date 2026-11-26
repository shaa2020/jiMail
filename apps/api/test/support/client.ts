import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** Cookie-aware HTTP client that echoes the CSRF cookie like the web app does. */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  private csrf = '';
  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer());
  }
  private capture(res: request.Response) {
    const cookies = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
    for (const c of cookies) {
      const m = c.match(/^jm_csrf=([^;]*)/);
      if (m) this.csrf = decodeURIComponent(m[1]);
    }
    return res;
  }
  async get(url: string) {
    return this.capture(await this.agent.get(`/api/v1${url}`));
  }
  async send(method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown, opts: { csrf?: boolean } = {}) {
    let r = this.agent[method](`/api/v1${url}`);
    if (opts.csrf !== false && this.csrf) r = r.set('X-CSRF-Token', this.csrf);
    return this.capture(await r.send(body as object));
  }
  post(url: string, body?: unknown, opts?: { csrf?: boolean }) {
    return this.send('post', url, body, opts);
  }
  put(url: string, body?: unknown) {
    return this.send('put', url, body);
  }
  patch(url: string, body?: unknown) {
    return this.send('patch', url, body);
  }
  del(url: string, body?: unknown) {
    return this.send('delete', url, body);
  }
  async upload(url: string, field: string, data: Buffer, filename: string, type: string) {
    return this.capture(await this.agent.post(`/api/v1${url}`).set('X-CSRF-Token', this.csrf).attach(field, data, { filename, contentType: type }));
  }
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 20000, intervalMs = 500): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out${last ? `: ${(last as Error).message}` : ''}`);
}
