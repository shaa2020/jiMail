'use client';

import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useQueryClient } from '@tanstack/react-query';
import { Bold, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minimize2, Paperclip, Quote, Send, Trash2, X } from 'lucide-react';
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, cx } from '@/components/ui/primitives';
import { api, errorMessage, get, post, put } from '@/lib/api';
import { bytes } from '@/lib/format';
import { Addr } from '@/lib/mail';

export interface ComposeInit {
  to?: Addr[];
  cc?: Addr[];
  bcc?: Addr[];
  subject?: string;
  html?: string;
  inReplyToId?: string;
  draftId?: string;
  attachments?: Att[];
}
interface Att { blobId: string; name: string; type: string; size: number }

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function parseAddr(raw: string): Addr | null {
  const m = raw.trim().match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  const email = (m ? m[2] : raw).trim().replace(/[,;]$/, '');
  if (!EMAIL_RE.test(email)) return null;
  return { name: m?.[1]?.trim() || null, email: email.toLowerCase() };
}

function RecipientField({ label, value, onChange, mb, autoFocus }: { label: string; value: Addr[]; onChange: (v: Addr[]) => void; mb: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [sugg, setSugg] = useState<Addr[]>([]);
  const [active, setActive] = useState(0);
  const id = `rcpt-${label}`;
  useEffect(() => {
    if (text.trim().length < 2) {
      setSugg([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<Addr[]>(`/webmail/${mb}/suggest?q=${encodeURIComponent(text.trim())}`, { signal: ctrl.signal })
        .then((r) => {
          setSugg(r.filter((s) => !value.some((v) => v.email === s.email.toLowerCase())));
          setActive(0);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [text, mb, value]);
  const commit = (raw?: string | Addr) => {
    const a = typeof raw === 'object' ? raw : parseAddr(raw ?? text);
    if (a && !value.some((v) => v.email === a.email.toLowerCase())) onChange([...value, { ...a, email: a.email.toLowerCase() }]);
    if (a || typeof raw === 'object') setText('');
    setSugg([]);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (sugg.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % sugg.length : (i - 1 + sugg.length) % sugg.length));
    } else if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      if (sugg.length && e.key !== ',') {
        e.preventDefault();
        commit(sugg[active]);
      } else if (text.trim()) {
        e.preventDefault();
        commit();
      }
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="relative flex min-h-11 flex-wrap items-center gap-1.5 border-b border-line px-4 py-1.5">
      <label htmlFor={id} className="w-10 text-[13px] text-ink-3">{label}</label>
      {value.map((a) => (
        <span key={a.email} className={cx('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px]', EMAIL_RE.test(a.email) ? 'bg-petrol-soft text-petrol-ink' : 'bg-bad-soft text-bad')} title={a.email}>
          {a.name || a.email}
          <button type="button" onClick={() => onChange(value.filter((v) => v.email !== a.email))} aria-label={`Remove ${a.email}`}><X className="size-3" /></button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => setTimeout(() => text.trim() && commit(), 150)}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          if (/[,;\n]/.test(t)) {
            e.preventDefault();
            const added = t.split(/[,;\n]+/).map(parseAddr).filter(Boolean) as Addr[];
            onChange([...value, ...added.filter((a) => !value.some((v) => v.email === a.email))]);
          }
        }}
        className="min-w-32 flex-1 bg-transparent py-1 text-sm outline-none"
        role="combobox"
        aria-expanded={sugg.length > 0}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
      />
      {sugg.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute left-14 top-full z-20 mt-1 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          {sugg.map((s, i) => (
            <li key={s.email} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); commit(s); }} className={cx('block w-full px-3 py-2 text-left text-sm', i === active && 'bg-surface-2')}>
                <span className="font-medium">{s.name || s.email}</span>
                {s.name && <span className="block text-xs text-ink-3">{s.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Composer({ mb, init, onClose, signature }: { mb: string; init: ComposeInit; onClose: () => void; signature?: string }) {
  const qc = useQueryClient();
  const [to, setTo] = useState<Addr[]>(init.to ?? []);
  const [cc, setCc] = useState<Addr[]>(init.cc ?? []);
  const [bcc, setBcc] = useState<Addr[]>(init.bcc ?? []);
  const [showCc, setShowCc] = useState(!!(init.cc?.length || init.bcc?.length));
  const [subject, setSubject] = useState(init.subject ?? '');
  const [attachments, setAttachments] = useState<Att[]>(init.attachments ?? []);
  const [uploading, setUploading] = useState(0);
  const [sending, setSending] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(init.draftId);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [max, setMax] = useState(false);
  const dirty = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit.configure({ link: false }), Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }), Placeholder.configure({ placeholder: 'Write your message…' })],
    content: init.html ?? (signature ? `<p></p><p>--<br>${signature}</p>` : ''),
    onUpdate: () => (dirty.current = true),
  });

  const payload = useCallback(
    () => ({ to, cc, bcc, subject, html: editor?.getHTML() ?? '', attachments, inReplyToId: init.inReplyToId, draftId }),
    [to, cc, bcc, subject, editor, attachments, init.inReplyToId, draftId],
  );

  useEffect(() => {
    dirty.current = true;
  }, [to, cc, bcc, subject, attachments]);

  // Autosave the draft every 8 seconds while there are unsaved changes.
  const saving = useRef(false);
  const saveDraft = useCallback(async () => {
    if (!dirty.current || saving.current || sending) return;
    const p = payload();
    if (!p.to.length && !p.subject && (editor?.isEmpty ?? true) && !p.attachments.length) return;
    saving.current = true;
    dirty.current = false;
    try {
      const r = await put<{ draftId: string }>(`/webmail/${mb}/drafts`, p);
      setDraftId(r.draftId);
      setSavedAt(new Date());
      qc.invalidateQueries({ queryKey: ['folders', mb] });
    } catch {
      dirty.current = true;
    } finally {
      saving.current = false;
    }
  }, [payload, mb, sending, editor, qc]);
  useEffect(() => {
    const t = setInterval(saveDraft, 8000);
    return () => clearInterval(t);
  }, [saveDraft]);

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.size > 25 * 1024 * 1024) {
        toast.error(`${f.name} is larger than 25 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const form = new FormData();
        form.append('file', f);
        const r = await api<{ blobId: string; size: number; type: string; name: string }>(`/webmail/${mb}/blobs`, { method: 'POST', form });
        setAttachments((a) => [...a, { blobId: r.blobId, name: f.name, type: f.type || 'application/octet-stream', size: r.size }]);
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const send = async () => {
    if (!to.length && !cc.length && !bcc.length) return toast.error('Add at least one recipient');
    if (!subject && !confirm('Send without a subject?')) return;
    setSending(true);
    try {
      await post(`/webmail/${mb}/send`, payload());
      toast.success('Message sent');
      qc.invalidateQueries({ queryKey: ['messages', mb] });
      qc.invalidateQueries({ queryKey: ['folders', mb] });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
      setSending(false);
    }
  };

  const discard = async () => {
    if (draftId) await post(`/webmail/${mb}/messages/delete`, { ids: [draftId] }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ['messages', mb] });
    onClose();
  };

  const close = async () => {
    await saveDraft();
    onClose();
  };

  const tool = (label: string, icon: React.ReactNode, run: () => void, active?: boolean) => (
    <button type="button" onClick={run} aria-label={label} title={label} aria-pressed={active} className={cx('rounded-md p-1.5 text-ink-2 hover:bg-surface-2', active && 'bg-surface-2 text-ink')}>
      {icon}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-label="Compose message"
      className={cx(
        'fixed z-40 flex flex-col overflow-hidden border border-line bg-surface shadow-2xl',
        max ? 'inset-2 rounded-2xl sm:inset-8' : 'inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[600px] sm:max-h-[calc(100dvh-32px)] sm:w-[620px] sm:rounded-2xl',
      )}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send();
        if (e.key === 'Escape') close();
      }}
    >
      <div className="flex items-center justify-between bg-side px-4 py-2.5 text-white">
        <span className="text-sm font-medium">{subject || 'New message'}</span>
        <div className="flex items-center gap-1">
          <button className="hidden rounded p-1 hover:bg-white/10 sm:block" onClick={() => setMax(!max)} aria-label={max ? 'Restore size' : 'Maximise'}>{max ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
          <button className="rounded p-1 hover:bg-white/10" onClick={close} aria-label="Close and save draft"><X className="size-4" /></button>
        </div>
      </div>
      <RecipientField label="To" value={to} onChange={setTo} mb={mb} autoFocus={!to.length} />
      {!showCc ? (
        <button type="button" className="self-end px-4 py-1 text-xs text-petrol hover:underline" onClick={() => setShowCc(true)}>Add Cc / Bcc</button>
      ) : (
        <>
          <RecipientField label="Cc" value={cc} onChange={setCc} mb={mb} />
          <RecipientField label="Bcc" value={bcc} onChange={setBcc} mb={mb} />
        </>
      )}
      <input aria-label="Subject" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="border-b border-line bg-transparent px-4 py-2.5 text-sm font-medium outline-none" />
      <div className="flex gap-0.5 border-b border-line px-2 py-1">
        {editor && (
          <>
            {tool('Bold', <Bold className="size-4" />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
            {tool('Italic', <Italic className="size-4" />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
            {tool('Bulleted list', <List className="size-4" />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
            {tool('Numbered list', <ListOrdered className="size-4" />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
            {tool('Quote', <Quote className="size-4" />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
            {tool('Link', <Link2 className="size-4" />, () => {
              const url = prompt('Link address (https://…)');
              if (url && /^(https?:|mailto:)/.test(url)) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }, editor.isActive('link'))}
          </>
        )}
      </div>
      <div className="composer min-h-0 flex-1 overflow-y-auto text-sm" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
      {(attachments.length > 0 || uploading > 0) && (
        <ul className="flex max-h-28 flex-wrap gap-2 overflow-y-auto border-t border-line px-4 py-2">
          {attachments.map((a) => (
            <li key={a.blobId} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs">
              <Paperclip className="size-3.5" />
              <span className="max-w-48 truncate">{a.name}</span>
              <span className="text-ink-3">{bytes(a.size)}</span>
              <button onClick={() => setAttachments((x) => x.filter((y) => y.blobId !== a.blobId))} aria-label={`Remove ${a.name}`}><X className="size-3" /></button>
            </li>
          ))}
          {uploading > 0 && <li className="inline-flex items-center gap-1.5 text-xs text-ink-3"><Loader2 className="size-3.5 animate-spin" /> Uploading…</li>}
        </ul>
      )}
      <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
        <Button onClick={send} loading={sending} disabled={uploading > 0} icon={<Send className="size-4" />}>Send</Button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} aria-label="Attach files" icon={<Paperclip className="size-4" />} />
        <span className="ml-auto text-xs text-ink-3" aria-live="polite">{savedAt ? `Draft saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        <Button variant="ghost" onClick={discard} aria-label="Discard draft" icon={<Trash2 className="size-4" />} />
      </div>
    </div>
  );
}

export async function signatureFor(mb: string, address?: string): Promise<string | undefined> {
  try {
    const ids = await get<any[]>(`/webmail/${mb}/identities`);
    const i = ids.find((x) => x.email === address) ?? ids[0];
    return i?.htmlSignature || (i?.textSignature ? i.textSignature.replace(/[&<>]/g, (c: string) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/\n/g, '<br>') : undefined);
  } catch {
    return undefined;
  }
}
