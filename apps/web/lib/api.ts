'use client';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: any,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|;\s*)jm_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * Same-origin JSON client. Session cookies are HttpOnly; the CSRF cookie is echoed in a header
 * for every mutating request (double-submit pattern enforced by the API).
 */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    credentials: 'same-origin',
    signal: init.signal,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === 'object' && (Array.isArray(data.errors) && data.errors.length ? data.errors.map((e: any) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join(' · ') : data.message)) ||
      `Request failed (${res.status})`;
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/') && path !== '/me') {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = data?.mfaRequired ? `/login?step=mfa&next=${next}` : `/login?next=${next}`;
    }
    throw new ApiError(Array.isArray(msg) ? msg.join(', ') : String(msg), res.status, data);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const patch = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'DELETE', body });

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong';
}
