'use client';

import { Inbox } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { EmptyState } from '@/components/ui/primitives';
import { useMe } from '@/lib/hooks';

export default function MailIndex() {
  const { data: me } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me?.mailboxes.length) router.replace(`/mail/${me.mailboxes[0].id}`);
  }, [me, router]);
  if (me && !me.mailboxes.length) {
    return <div className="grid h-full place-items-center"><EmptyState icon={<Inbox className="size-6" />} title="No mailbox assigned">Your account has no mailbox yet. Ask your organisation administrator to grant you access to one.</EmptyState></div>;
  }
  return null;
}
