'use client';

import { useQuery } from '@tanstack/react-query';
import { BookUser, Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ConfirmDialog, Dialog } from '@/components/ui/overlay';
import { Avatar, Button, EmptyState, ErrorState, Field, Input, LoadingRows, PageHeader, Panel, Textarea } from '@/components/ui/primitives';
import { SearchInput } from '@/components/ui/table';
import { del, get, post, put } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useMailbox } from '@/lib/mail';

interface Contact { id: string; name: string; email: string | null; phone: string | null; company: string | null; notes: string | null }
const blank = { id: '', name: '', email: '', phone: '', company: '', notes: '' };

export default function Contacts() {
  const { mb } = useMailbox();
  const [q, setQ] = useState('');
  const list = useQuery<Contact[]>({ queryKey: ['contacts', mb, q], queryFn: () => get(`/webmail/${mb}/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const [editing, setEditing] = useState<typeof blank | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const save = useAction(() => {
    const body = { name: editing!.name, email: editing!.email || null, phone: editing!.phone || null, company: editing!.company || null, notes: editing!.notes || null };
    return editing!.id ? put(`/webmail/${mb}/contacts/${editing!.id}`, body) : post(`/webmail/${mb}/contacts`, body);
  }, { success: 'Contact saved', invalidate: [['contacts', mb]], onSuccess: () => setEditing(null) });
  const remove = useAction(() => del(`/webmail/${mb}/contacts/${deleting!.id}`), { success: 'Contact deleted', invalidate: [['contacts', mb]], onSuccess: () => setDeleting(null) });
  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Contacts" description="Stored in your mailbox's address book, so they also sync to CardDAV apps." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing({ ...blank })}>New contact</Button>} />
        <Panel padded={false}>
          <div className="border-b border-line px-5 py-3"><SearchInput value={q} onChange={setQ} placeholder="Search contacts" /></div>
          {list.isLoading ? <LoadingRows /> : list.error ? <ErrorState error={list.error} retry={list.refetch} /> : !list.data!.length ? (
            <EmptyState icon={<BookUser className="size-6" />} title={q ? 'No contacts match' : 'No contacts yet'} action={!q && <Button onClick={() => setEditing({ ...blank })}>Add a contact</Button>}>Contacts help with address suggestions when you write mail.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {list.data!.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={c.name} email={c.email ?? undefined} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name || c.email}</p>
                    <p className="truncate text-xs text-ink-3">{[c.email, c.phone, c.company].filter(Boolean).join(' · ')}</p>
                  </div>
                  {c.email && <Link href={`/mail/${mb}?compose=${encodeURIComponent(c.email)}`} className="rounded-md p-2 text-ink-2 hover:bg-surface-2" aria-label={`Email ${c.name}`}><Mail className="size-4" /></Link>}
                  <button className="rounded-md p-2 text-ink-2 hover:bg-surface-2" onClick={() => setEditing({ id: c.id, name: c.name, email: c.email ?? '', phone: c.phone ?? '', company: c.company ?? '', notes: c.notes ?? '' })} aria-label={`Edit ${c.name}`}><Pencil className="size-4" /></button>
                  <button className="rounded-md p-2 text-ink-2 hover:bg-surface-2" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`}><Trash2 className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {editing && (
        <Dialog open onOpenChange={(v) => !v && setEditing(null)} title={editing.id ? 'Edit contact' : 'New contact'} footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} disabled={!editing.name} onClick={() => save.mutate()}>Save contact</Button></>}>
          <div className="space-y-3">
            <Field label="Name">{(id) => <Input id={id} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />}</Field>
            <Field label="Email">{(id) => <Input id={id} type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />}</Field>
            <Field label="Phone">{(id) => <Input id={id} type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />}</Field>
            <Field label="Company">{(id) => <Input id={id} value={editing.company} onChange={(e) => setEditing({ ...editing, company: e.target.value })} />}</Field>
            <Field label="Notes">{(id) => <Textarea id={id} rows={3} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />}</Field>
          </div>
        </Dialog>
      )}
      <ConfirmDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)} title="Delete contact?" description={deleting?.name ?? ''} confirmLabel="Delete" loading={remove.isPending} onConfirm={() => remove.mutate()} />
    </div>
  );
}
