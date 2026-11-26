'use client';

import { AlertTriangle, Archive, ArrowLeft, Download, FileWarning, Forward, ImageOff, MailOpen, Paperclip, Reply, ReplyAll, ShieldAlert, Star, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Tip } from '@/components/ui/overlay';
import { Avatar, Button, cx } from '@/components/ui/primitives';
import { bytes, dateTime } from '@/lib/format';
import { Addr, fmtAddr } from '@/lib/mail';

export interface FullMessage {
  id: string;
  subject?: string;
  from?: Addr[];
  to?: Addr[];
  cc?: Addr[];
  replyTo?: Addr[];
  receivedAt: string;
  keywords: Record<string, boolean>;
  html: string;
  text: string;
  blockedRemoteImages: number;
  suspiciousLinks: number;
  attachments: { blobId: string; name: string; type: string; size: number; risk: 'safe' | 'dangerous'; previewable: boolean }[];
}

/**
 * Renders sanitised email HTML in a sandboxed iframe: no scripts may run (no allow-scripts), links open in
 * a new tab, and a restrictive CSP inside the frame blocks every network fetch except allowed images.
 */
function MessageFrame({ html, allowRemote }: { html: string; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const dark = typeof window !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const csp = `default-src 'none'; img-src 'self' data: ${allowRemote ? 'https:' : ''}; style-src 'unsafe-inline'; font-src data:`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>
    body{margin:0;padding:2px;font:14px/1.55 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2b2e;word-wrap:break-word;overflow-wrap:anywhere}
    img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap}
    a{color:#0f5257} a[data-jimail-warning]{background:#fdf0dc;outline:1px dashed #a8670b}
    img[data-jimail-blocked]{display:inline-block;min-width:24px;min-height:24px;background:#eef3f3;outline:1px dashed #c4d1d3}
    blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:3px solid #c4d1d3;color:#3d5357}
  </style></head><body>${html}</body></html>`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      try {
        const h = el.contentDocument?.documentElement.scrollHeight;
        if (h) setHeight(Math.min(h + 8, 20000));
      } catch {
        /* cross-origin: keep default */
      }
    };
    el.addEventListener('load', measure);
    const t = setInterval(measure, 500);
    setTimeout(() => clearInterval(t), 5000);
    return () => {
      el.removeEventListener('load', measure);
      clearInterval(t);
    };
  }, [doc]);
  return (
    <div className={cx('rounded-lg', dark && 'bg-white p-3')}>
      <iframe ref={ref} title="Message content" srcDoc={doc} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" className="w-full border-0" style={{ height }} />
    </div>
  );
}

export function Reader({
  mb,
  thread,
  subject,
  onBack,
  onReply,
  onForward,
  onArchive,
  onDelete,
  onStar,
  onUnread,
  allowRemote,
  setAllowRemote,
  inTrash,
}: {
  mb: string;
  thread: FullMessage[];
  subject?: string;
  onBack: () => void;
  onReply: (m: FullMessage, all: boolean) => void;
  onForward: (m: FullMessage) => void;
  onArchive: () => void;
  onDelete: () => void;
  onStar: (flag: boolean) => void;
  onUnread: () => void;
  allowRemote: boolean;
  setAllowRemote: (v: boolean) => void;
  inTrash: boolean;
}) {
  const last = thread[thread.length - 1];
  const [expanded, setExpanded] = useState<Set<string>>(new Set([last.id]));
  useEffect(() => setExpanded(new Set([thread[thread.length - 1].id])), [thread]);
  const starred = thread.some((m) => m.keywords?.$flagged);
  const blocked = thread.reduce((s, m) => s + m.blockedRemoteImages, 0);
  const suspicious = thread.reduce((s, m) => s + m.suspiciousLinks, 0);
  const blobUrl = (a: FullMessage['attachments'][number], inline = false) => `/api/v1/webmail/${mb}/blobs/${encodeURIComponent(a.blobId)}?name=${encodeURIComponent(a.name)}&type=${encodeURIComponent(a.type)}${inline ? '&inline=1' : ''}`;

  const action = (label: string, icon: React.ReactNode, run: () => void) => (
    <Tip content={label}>
      <button onClick={run} aria-label={label} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-ink">{icon}</button>
    </Tip>
  );

  return (
    <article className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 sm:px-4">
        <button onClick={onBack} className="rounded-lg p-2 hover:bg-surface-2 lg:hidden" aria-label="Back to list"><ArrowLeft className="size-[18px]" /></button>
        {action('Archive', <Archive className="size-[18px]" />, onArchive)}
        {action(inTrash ? 'Delete permanently' : 'Move to trash', <Trash2 className="size-[18px]" />, onDelete)}
        {action('Mark as unread', <MailOpen className="size-[18px]" />, onUnread)}
        {action(starred ? 'Remove star' : 'Star', <Star className={cx('size-[18px]', starred && 'fill-saffron text-saffron')} />, () => onStar(!starred))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <h1 className="mb-4 font-display text-xl font-semibold sm:text-2xl">{subject || '(no subject)'}</h1>
        {suspicious > 0 && (
          <div role="alert" className="mb-3 flex gap-2 rounded-lg border border-warn/30 bg-warn-soft p-3 text-sm text-warn">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>This message contains {suspicious} link{suspicious > 1 ? 's' : ''} whose text shows a different website than the one it opens. Highlighted links may be phishing — hover to check the real destination.</span>
          </div>
        )}
        {blocked > 0 && !allowRemote && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2">
            <span className="flex items-center gap-2"><ImageOff className="size-4" /> Remote images were blocked to protect your privacy.</span>
            <Button size="sm" variant="secondary" onClick={() => setAllowRemote(true)}>Show images</Button>
          </div>
        )}
        <div className="space-y-3">
          {thread.map((m) => {
            const open = expanded.has(m.id);
            const from = m.from?.[0];
            return (
              <div key={m.id} className="rounded-xl border border-line bg-surface">
                <button className="flex w-full items-start gap-3 px-4 py-3 text-left" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} aria-expanded={open}>
                  <Avatar name={from?.name} email={from?.email} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="truncate font-medium">{from?.name || from?.email}</span>
                      <time className="shrink-0 text-xs text-ink-3" dateTime={m.receivedAt}>{dateTime(m.receivedAt)}</time>
                    </div>
                    {open ? (
                      <p className="truncate text-xs text-ink-3">{from?.email} → {[...(m.to ?? []), ...(m.cc ?? [])].map(fmtAddr).join(', ')}</p>
                    ) : (
                      <p className="truncate text-sm text-ink-3">{m.text.slice(0, 160)}</p>
                    )}
                  </div>
                </button>
                {open && (
                  <div className="px-4 pb-4">
                    <MessageFrame html={m.html} allowRemote={allowRemote} />
                    {m.attachments.length > 0 && (
                      <div className="mt-4 border-t border-line pt-3">
                        <p className="mb-2 flex items-center gap-1.5 text-xs text-ink-3"><Paperclip className="size-3.5" /> {m.attachments.length} attachment{m.attachments.length > 1 ? 's' : ''}</p>
                        <ul className="flex flex-wrap gap-2">
                          {m.attachments.map((a) => (
                            <li key={a.blobId} className={cx('w-56 overflow-hidden rounded-lg border', a.risk === 'dangerous' ? 'border-bad/40' : 'border-line')}>
                              {a.previewable && a.type.startsWith('image/') && <img src={blobUrl(a, true)} alt={a.name} className="h-28 w-full bg-surface-2 object-cover" loading="lazy" />}
                              <div className="flex items-center gap-2 p-2">
                                {a.risk === 'dangerous' ? <FileWarning className="size-4 shrink-0 text-bad" /> : <Paperclip className="size-4 shrink-0 text-ink-3" />}
                                <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{a.name}</p><p className="text-[11px] text-ink-3">{bytes(a.size)}</p></div>
                                <a
                                  href={blobUrl(a)}
                                  onClick={(e) => { if (a.risk === 'dangerous' && !confirm(`${a.name} is a file type often used to spread malware. Download only if you trust the sender. Continue?`)) e.preventDefault(); }}
                                  className="rounded p-1.5 text-ink-2 hover:bg-surface-2"
                                  aria-label={`Download ${a.name}`}
                                >
                                  <Download className="size-4" />
                                </a>
                              </div>
                              {a.risk === 'dangerous' && <p className="flex items-center gap-1 bg-bad-soft px-2 py-1 text-[11px] text-bad"><AlertTriangle className="size-3" /> Potentially dangerous file type</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" icon={<Reply className="size-4" />} onClick={() => onReply(m, false)}>Reply</Button>
                      <Button size="sm" variant="secondary" icon={<ReplyAll className="size-4" />} onClick={() => onReply(m, true)}>Reply all</Button>
                      <Button size="sm" variant="secondary" icon={<Forward className="size-4" />} onClick={() => onForward(m)}>Forward</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}
