'use client';

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronDown,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  Inbox,
  MailOpen,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ComposeInit, Composer, signatureFor } from '@/components/mail/compose';
import { FullMessage, Reader } from '@/components/mail/reader';
import { ConfirmDialog, Dialog, Menu, MenuItem, MenuLabel } from '@/components/ui/overlay';
import { Button, Checkbox, cx, EmptyState, ErrorState, Field, Input, Skeleton } from '@/components/ui/primitives';
import { del, errorMessage, get, patch, post } from '@/lib/api';
import { mailTime } from '@/lib/format';
import { useMe } from '@/lib/hooks';
import { fmtAddr, Folder, shortAddr, Summary, useMailbox } from '@/lib/mail';

const ROLE_ICON: Record<string, React.ReactNode> = {
  inbox: <Inbox className="size-4" />,
  drafts: <FileText className="size-4" />,
  sent: <Send className="size-4" />,
  archive: <Archive className="size-4" />,
  junk: <ShieldAlert className="size-4" />,
  trash: <Trash2 className="size-4" />,
};
const ROLE_NAME: Record<string, string> = { inbox: 'Inbox', drafts: 'Drafts', sent: 'Sent', archive: 'Archive', junk: 'Spam', trash: 'Trash' };

interface Filters { q: string; from: string; to: string; subject: string; after: string; before: string; hasAttachment: boolean; unread: boolean }
const NO_FILTERS: Filters = { q: '', from: '', to: '', subject: '', after: '', before: '', hasAttachment: false, unread: false };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function quoteHtml(m: FullMessage) {
  const who = fmtAddr(m.from?.[0]);
  return `<p></p><p>On ${new Date(m.receivedAt).toLocaleString()}, ${esc(who)} wrote:</p><blockquote>${m.text ? esc(m.text).replace(/\n/g, '<br>') : ''}</blockquote>`;
}

function MailApp() {
  const { mb, folders } = useMailbox();
  const { data: me } = useMe();
  const myAddress = me?.mailboxes.find((m) => m.id === mb)?.address;
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const folderList = folders.data ?? [];
  const inbox = folderList.find((f) => f.role === 'inbox');
  const folderId = params.get('f') ?? inbox?.id ?? '';
  const openId = params.get('m');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  const [allowRemote, setAllowRemote] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Folder | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<Folder | null>(null);
  const searching = Object.entries(filters).some(([, v]) => v);
  const currentFolder = folderList.find((f) => f.id === folderId);
  const inTrash = currentFolder?.role === 'trash';
  const inDrafts = currentFolder?.role === 'drafts';

  const setParam = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) v === null ? p.delete(k) : p.set(k, v);
    router.push(`/mail/${mb}?${p.toString()}`);
  };

  const listKey = ['messages', mb, searching ? 'search' : folderId, filters];
  const list = useInfiniteQuery({
    queryKey: listKey,
    enabled: !!folderId || searching,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ position: String(pageParam), limit: '50' });
      if (!searching || folderId === 'starred') p.set('folderId', folderId);
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, String(v));
      return get<{ total: number; position: number; items: Summary[] }>(`/webmail/${mb}/messages?${p}`);
    },
    getNextPageParam: (last) => (last.position + last.items.length < last.total ? last.position + last.items.length : undefined),
    refetchInterval: 45_000,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const total = list.data?.pages[0]?.total ?? 0;

  const thread = useQuery<{ messages: FullMessage[] }>({
    queryKey: ['thread', mb, openId, allowRemote],
    queryFn: () => get(`/webmail/${mb}/messages/${openId}${allowRemote ? '?remoteImages=1' : ''}`),
    enabled: !!openId && !inDrafts,
  });
  useEffect(() => {
    if (thread.data) qc.invalidateQueries({ queryKey: ['folders', mb] });
  }, [thread.data, qc, mb]);
  useEffect(() => {
    setSelected(new Set());
    setAllowRemote(false);
  }, [folderId, filters]);
  // Deep link from Contacts: /mail/<mb>?compose=<address>
  const composeTo = params.get('compose');
  useEffect(() => {
    if (composeTo) {
      setCompose({ to: [{ email: composeTo }] });
      const p = new URLSearchParams(params.toString());
      p.delete('compose');
      router.replace(`/mail/${mb}?${p}`);
    }
  }, [composeTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['messages', mb] });
    qc.invalidateQueries({ queryKey: ['folders', mb] });
  };
  const run = async (fn: () => Promise<unknown>, msg: string, closeReader = false) => {
    try {
      await fn();
      toast.success(msg);
      setSelected(new Set());
      if (closeReader) setParam({ m: null });
      refresh();
      qc.invalidateQueries({ queryKey: ['thread', mb] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const ids = (one?: string) => (one ? [one] : [...selected]);
  const act = {
    archive: (one?: string) => run(() => post(`/webmail/${mb}/messages/move`, { ids: ids(one), role: 'archive' }), 'Archived', !!one),
    trash: (one?: string) => run(() => post(`/webmail/${mb}/messages/delete`, { ids: ids(one) }), inTrash ? 'Deleted permanently' : 'Moved to trash', !!one),
    spam: (one?: string) => run(() => post(`/webmail/${mb}/messages/move`, { ids: ids(one), role: currentFolder?.role === 'junk' ? 'inbox' : 'junk' }), currentFolder?.role === 'junk' ? 'Moved to inbox' : 'Marked as spam', !!one),
    move: (to: string, one?: string) => run(() => post(`/webmail/${mb}/messages/move`, { ids: ids(one), folderId: to }), 'Moved', !!one),
    seen: (seen: boolean, one?: string) => run(() => post(`/webmail/${mb}/messages/keywords`, { ids: ids(one), seen }), seen ? 'Marked as read' : 'Marked as unread', !!one && !seen),
    star: (flagged: boolean, one?: string) => run(() => post(`/webmail/${mb}/messages/keywords`, { ids: ids(one), flagged }), flagged ? 'Starred' : 'Star removed'),
  };

  const openCompose = async (init: ComposeInit) => {
    const sig = init.html === undefined ? await signatureFor(mb, myAddress) : undefined;
    setCompose({ ...init, html: init.html ?? (sig ? `<p></p><p>--<br>${sig}</p>` : undefined) });
  };
  const reply = async (m: FullMessage, all: boolean) => {
    const sig = await signatureFor(mb, myAddress);
    const replyTo = m.replyTo?.length ? m.replyTo : (m.from ?? []);
    const to = replyTo.filter((a) => a.email !== myAddress);
    const cc = all ? [...(m.to ?? []), ...(m.cc ?? [])].filter((a) => a.email !== myAddress && !to.some((t) => t.email === a.email)) : [];
    setCompose({
      to: to.length ? to : replyTo,
      cc,
      subject: /^re:/i.test(m.subject ?? '') ? m.subject : `Re: ${m.subject ?? ''}`,
      html: `${sig ? `<p></p><p>--<br>${sig}</p>` : ''}${quoteHtml(m)}`,
      inReplyToId: m.id,
    });
  };
  const forward = async (m: FullMessage) => {
    const header = `<p></p><p>---------- Forwarded message ----------<br>From: ${esc(fmtAddr(m.from?.[0]))}<br>Date: ${new Date(m.receivedAt).toLocaleString()}<br>Subject: ${esc(m.subject ?? '')}<br>To: ${esc((m.to ?? []).map(fmtAddr).join(', '))}</p>`;
    setCompose({ subject: /^fwd?:/i.test(m.subject ?? '') ? m.subject : `Fwd: ${m.subject ?? ''}`, html: header + m.html, attachments: m.attachments.map((a) => ({ blobId: a.blobId, name: a.name, type: a.type, size: a.size })) });
  };
  const openDraft = async (s: Summary) => {
    try {
      const t = await get<{ messages: FullMessage[] }>(`/webmail/${mb}/messages/${s.id}`);
      const d = t.messages.find((x) => x.id === s.id) ?? t.messages[t.messages.length - 1];
      setCompose({ to: d.to ?? [], cc: d.cc ?? [], subject: d.subject, html: d.html, draftId: d.id, attachments: d.attachments.map((a) => ({ blobId: a.blobId, name: a.name, type: a.type, size: a.size })) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const createFolder = async () => {
    try {
      await post(`/webmail/${mb}/folders`, { name: newFolder, parentId: null });
      setNewFolder(null);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const customFolders = folderList.filter((f) => !f.role);
  const systemFolders = folderList.filter((f) => f.role && ROLE_NAME[f.role]);
  const showReader = !!openId && !inDrafts;
  const allChecked = items.length > 0 && items.every((i) => selected.has(i.id));
  const hasSelection = selected.size > 0;

  const folderLink = (f: { id: string; label: string; icon: React.ReactNode; unread?: number; role?: string | null }) => {
    const active = !searching && folderId === f.id;
    return (
      <button
        key={f.id}
        onClick={() => { setFilters(NO_FILTERS); setDraftFilters(NO_FILTERS); setParam({ f: f.id, m: null }); }}
        aria-current={active ? 'page' : undefined}
        className={cx('flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm', active ? 'bg-petrol-soft font-medium text-petrol-ink' : 'text-ink-2 hover:bg-surface-2')}
      >
        {f.icon}
        <span className="min-w-0 flex-1 truncate">{f.label}</span>
        {!!f.unread && f.role !== 'sent' && f.role !== 'trash' && <span className={cx('text-xs', active ? 'text-petrol-ink' : 'text-ink-3')}>{f.unread}</span>}
      </button>
    );
  };

  return (
    <div className="flex h-full">
      {/* Folder column */}
      <aside className={cx('w-60 shrink-0 flex-col border-r border-line bg-surface px-2 py-3', showReader ? 'hidden xl:flex' : 'hidden lg:flex')} aria-label="Folders">
        <Button className="mx-1 mb-3" icon={<Pencil className="size-4" />} onClick={() => openCompose({})}>Compose</Button>
        <nav className="space-y-0.5 overflow-y-auto">
          {systemFolders.filter((f) => f.role === 'inbox').map((f) => folderLink({ id: f.id, label: ROLE_NAME[f.role!], icon: ROLE_ICON[f.role!], unread: f.unreadThreads, role: f.role }))}
          {folderLink({ id: 'starred', label: 'Starred', icon: <Star className="size-4" /> })}
          {systemFolders.filter((f) => f.role !== 'inbox').map((f) => folderLink({ id: f.id, label: ROLE_NAME[f.role!], icon: ROLE_ICON[f.role!], unread: f.role === 'drafts' ? f.totalEmails : f.unreadThreads, role: f.role }))}
          <div className="flex items-center justify-between px-3 pb-1 pt-4 text-xs text-ink-3">
            Folders
            <button onClick={() => setNewFolder('')} aria-label="New folder" className="rounded p-0.5 hover:bg-surface-2 hover:text-ink"><FolderPlus className="size-4" /></button>
          </div>
          {customFolders.map((f) => (
            <div key={f.id} className="group relative">
              {folderLink({ id: f.id, label: f.name, icon: <FolderIcon className="size-4" />, unread: f.unreadThreads })}
              <div className="absolute right-1 top-1 hidden group-hover:block group-focus-within:block">
                <Menu trigger={<button className="rounded p-0.5 text-ink-3 hover:bg-surface hover:text-ink" aria-label={`Folder options for ${f.name}`}><ChevronDown className="size-4" /></button>}>
                  <MenuItem onSelect={() => setRenaming(f)}>Rename</MenuItem>
                  <MenuItem danger onSelect={() => setDeletingFolder(f)}>Delete folder</MenuItem>
                </Menu>
              </div>
            </div>
          ))}
          {!customFolders.length && <p className="px-3 text-xs text-ink-3">No custom folders.</p>}
        </nav>
      </aside>

      {/* Message list */}
      <section className={cx('flex min-w-0 flex-col border-r border-line bg-surface lg:w-[400px] lg:shrink-0 xl:w-[440px]', showReader ? 'hidden lg:flex' : 'flex flex-1 lg:flex-none')} aria-label="Messages">
        <form
          className="border-b border-line p-2.5"
          onSubmit={(e) => { e.preventDefault(); setFilters({ ...draftFilters }); setParam({ m: null }); }}
          role="search"
        >
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input value={draftFilters.q} onChange={(e) => setDraftFilters({ ...draftFilters, q: e.target.value })} placeholder="Search mail" aria-label="Search mail" className="h-9 w-full rounded-lg bg-surface-2 pl-9 pr-8 text-sm outline-none focus:ring-2 focus:ring-saffron/40" />
              {searching && <button type="button" onClick={() => { setFilters(NO_FILTERS); setDraftFilters(NO_FILTERS); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3" aria-label="Clear search"><X className="size-4" /></button>}
            </div>
            <button type="button" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} aria-label="Search filters" className={cx('rounded-lg p-2 hover:bg-surface-2', showFilters ? 'text-petrol' : 'text-ink-2')}><SlidersHorizontal className="size-4" /></button>
          </div>
          {showFilters && (
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <Field label="From">{(id) => <Input id={id} className="h-8" value={draftFilters.from} onChange={(e) => setDraftFilters({ ...draftFilters, from: e.target.value })} />}</Field>
              <Field label="To">{(id) => <Input id={id} className="h-8" value={draftFilters.to} onChange={(e) => setDraftFilters({ ...draftFilters, to: e.target.value })} />}</Field>
              <Field label="Subject" className="col-span-2">{(id) => <Input id={id} className="h-8" value={draftFilters.subject} onChange={(e) => setDraftFilters({ ...draftFilters, subject: e.target.value })} />}</Field>
              <Field label="After">{(id) => <Input id={id} type="date" className="h-8" value={draftFilters.after} onChange={(e) => setDraftFilters({ ...draftFilters, after: e.target.value })} />}</Field>
              <Field label="Before">{(id) => <Input id={id} type="date" className="h-8" value={draftFilters.before} onChange={(e) => setDraftFilters({ ...draftFilters, before: e.target.value })} />}</Field>
              <Checkbox label="Has attachment" checked={draftFilters.hasAttachment} onChange={(v) => setDraftFilters({ ...draftFilters, hasAttachment: v })} />
              <Checkbox label="Unread only" checked={draftFilters.unread} onChange={(v) => setDraftFilters({ ...draftFilters, unread: v })} />
              <div className="col-span-2 flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => { setDraftFilters(NO_FILTERS); setFilters(NO_FILTERS); }}>Reset</Button>
                <Button type="submit" size="sm">Search</Button>
              </div>
            </div>
          )}
        </form>

        <div className="flex h-11 items-center gap-1 border-b border-line px-3">
          <input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(items.map((i) => i.id)))} className="size-4 accent-[var(--petrol)]" />
          {hasSelection ? (
            <>
              <span className="ml-2 mr-auto text-xs text-ink-3">{selected.size} selected</span>
              <button onClick={() => act.archive()} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Archive selected"><Archive className="size-4" /></button>
              <button onClick={() => act.trash()} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Delete selected"><Trash2 className="size-4" /></button>
              <button onClick={() => act.seen(true)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Mark selected as read"><MailOpen className="size-4" /></button>
              <button onClick={() => act.star(true)} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Star selected"><Star className="size-4" /></button>
              <Menu trigger={<button className="rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">More ▾</button>}>
                <MenuItem onSelect={() => act.seen(false)}>Mark as unread</MenuItem>
                <MenuItem onSelect={() => act.spam()}>{currentFolder?.role === 'junk' ? 'Not spam' : 'Report spam'}</MenuItem>
                <MenuLabel>Move to</MenuLabel>
                {folderList.filter((f) => f.id !== folderId && f.role !== 'drafts').map((f) => <MenuItem key={f.id} onSelect={() => act.move(f.id)}>{f.role ? ROLE_NAME[f.role] ?? f.name : f.name}</MenuItem>)}
              </Menu>
            </>
          ) : (
            <>
              <h2 className="ml-2 mr-auto truncate font-sans text-sm font-semibold tracking-normal">{searching ? `Search results (${total})` : folderId === 'starred' ? 'Starred' : currentFolder ? (currentFolder.role ? ROLE_NAME[currentFolder.role] ?? currentFolder.name : currentFolder.name) : ''}</h2>
              <button onClick={refresh} className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Refresh"><RefreshCw className={cx('size-4', list.isFetching && 'animate-spin')} /></button>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading || folders.isLoading ? (
            <div className="space-y-4 p-4" role="status" aria-label="Loading messages">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="space-y-2"><Skeleton className="w-1/3" /><Skeleton className="w-5/6" /></div>)}</div>
          ) : list.error ? (
            <ErrorState error={list.error} retry={() => list.refetch()} />
          ) : !items.length ? (
            <EmptyState icon={searching ? <Search className="size-6" /> : <Inbox className="size-6" />} title={searching ? 'No messages match your search' : inTrash ? 'Trash is empty' : 'Nothing here'}>
              {searching ? 'Try fewer words or remove filters.' : currentFolder?.role === 'inbox' ? 'New mail will appear here.' : undefined}
            </EmptyState>
          ) : (
            <ul>
              {items.map((m) => {
                const unread = !m.keywords?.$seen;
                const isOpen = openId === m.id;
                const who = currentFolder?.role === 'sent' || currentFolder?.role === 'drafts' ? `To: ${(m.to ?? []).map(shortAddr).join(', ') || '(no recipients)'}` : shortAddr(m.from?.[0]) || '(unknown sender)';
                return (
                  <li key={m.id} className={cx('group flex gap-3 border-b border-line px-3 py-2.5', isOpen ? 'bg-petrol-soft' : 'hover:bg-surface-2', selected.has(m.id) && 'bg-saffron-soft/50')}>
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })} aria-label={`Select message from ${who}`} className="mt-1 size-4 shrink-0 accent-[var(--petrol)]" />
                    <button className="min-w-0 flex-1 text-left" onClick={() => (inDrafts ? openDraft(m) : setParam({ m: m.id }))}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cx('truncate text-sm', unread ? 'font-semibold text-ink' : 'text-ink-2')}>
                          {unread && <span className="mr-1.5 inline-block size-2 rounded-full bg-petrol align-middle" aria-label="Unread" />}
                          {who}
                          {m.threadSize > 1 && <span className="ml-1 text-xs font-normal text-ink-3">{m.threadSize}</span>}
                        </span>
                        <time className={cx('shrink-0 text-xs', unread ? 'font-semibold text-ink' : 'text-ink-3')} dateTime={m.receivedAt}>{mailTime(m.receivedAt)}</time>
                      </div>
                      <p className={cx('truncate text-[13px]', unread ? 'font-medium text-ink' : 'text-ink-2')}>{m.subject || '(no subject)'}</p>
                      <p className="truncate text-[13px] text-ink-3">{m.preview}</p>
                    </button>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      <button onClick={() => act.star(!m.keywords?.$flagged, m.id)} aria-label={m.keywords?.$flagged ? 'Remove star' : 'Star'} className="rounded p-0.5">
                        <Star className={cx('size-4', m.keywords?.$flagged ? 'fill-saffron text-saffron' : 'text-ink-3 opacity-0 group-hover:opacity-100 focus:opacity-100')} />
                      </button>
                      {m.hasAttachment && <Paperclip className="size-3.5 text-ink-3" aria-label="Has attachment" />}
                    </div>
                  </li>
                );
              })}
              {list.hasNextPage && (
                <li className="p-3 text-center"><Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></li>
              )}
            </ul>
          )}
        </div>
      </section>

      {/* Reader */}
      <section className={cx('min-w-0 flex-1 bg-paper', showReader ? 'block' : 'hidden lg:block')} aria-label="Message">
        {showReader ? (
          thread.isLoading ? (
            <div className="space-y-3 p-6" role="status" aria-label="Loading message"><Skeleton className="h-7 w-2/3" /><Skeleton className="w-1/3" /><Skeleton className="h-48 w-full" /></div>
          ) : thread.error ? (
            <ErrorState error={thread.error} retry={() => thread.refetch()} />
          ) : thread.data ? (
            <Reader
              mb={mb}
              thread={thread.data.messages}
              subject={thread.data.messages[thread.data.messages.length - 1]?.subject}
              onBack={() => setParam({ m: null })}
              onReply={reply}
              onForward={forward}
              onArchive={() => act.archive(openId!)}
              onDelete={() => act.trash(openId!)}
              onStar={(f) => act.star(f, openId!)}
              onUnread={() => act.seen(false, openId!)}
              allowRemote={allowRemote}
              setAllowRemote={setAllowRemote}
              inTrash={inTrash}
            />
          ) : null
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-petrol-soft text-petrol"><Inbox className="size-7" /></div>
              <p className="text-sm text-ink-3">Select a message to read it.</p>
            </div>
          </div>
        )}
      </section>

      {/* Mobile compose button */}
      {!compose && (
        <button onClick={() => openCompose({})} className="fixed bottom-20 right-4 z-30 grid size-14 place-items-center rounded-2xl bg-petrol text-white shadow-lg lg:hidden" aria-label="Compose">
          <Pencil className="size-5" />
        </button>
      )}

      {compose && <Composer key={compose.draftId ?? compose.inReplyToId ?? 'new'} mb={mb} init={compose} onClose={() => { setCompose(null); refresh(); }} />}

      <Dialog open={newFolder !== null} onOpenChange={(v) => !v && setNewFolder(null)} title="New folder" footer={<><Button variant="secondary" onClick={() => setNewFolder(null)}>Cancel</Button><Button disabled={!newFolder?.trim()} onClick={createFolder}>Create folder</Button></>}>
        <Field label="Folder name">{(id) => <Input id={id} value={newFolder ?? ''} onChange={(e) => setNewFolder(e.target.value)} autoFocus />}</Field>
      </Dialog>
      {renaming && (
        <Dialog open onOpenChange={(v) => !v && setRenaming(null)} title="Rename folder" footer={<><Button variant="secondary" onClick={() => setRenaming(null)}>Cancel</Button><Button onClick={() => run(() => patch(`/webmail/${mb}/folders/${renaming.id}`, { name: renaming.name }), 'Folder renamed').then(() => setRenaming(null))}>Save</Button></>}>
          <Field label="Folder name">{(id) => <Input id={id} value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} autoFocus />}</Field>
        </Dialog>
      )}
      <ConfirmDialog open={!!deletingFolder} onOpenChange={(v) => !v && setDeletingFolder(null)} title={`Delete “${deletingFolder?.name}”?`} description="The folder must be empty. Move its messages elsewhere first." confirmLabel="Delete folder" onConfirm={() => run(() => del(`/webmail/${mb}/folders/${deletingFolder!.id}`), 'Folder deleted').then(() => { setDeletingFolder(null); if (folderId === deletingFolder?.id) setParam({ f: null, m: null }); })} />
    </div>
  );
}

export default function MailPage() {
  return (
    <Suspense>
      <MailApp />
    </Suspense>
  );
}

