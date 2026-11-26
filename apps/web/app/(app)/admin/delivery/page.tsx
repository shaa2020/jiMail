'use client';

import { useQuery } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { DeliveryView } from '@/components/delivery-view';
import { EmptyState, ErrorState, LoadingRows, Panel } from '@/components/ui/primitives';
import { DataTable } from '@/components/ui/table';
import { get } from '@/lib/api';
import { bytes, dateTime, relative } from '@/lib/format';

export default function AdminDelivery() {
  const queue = useQuery<any>({ queryKey: ['admin-queue'], queryFn: () => get('/admin/queue'), refetchInterval: 30_000 });
  return (
    <div>
      <DeliveryView path="/admin/delivery" title="Mail delivery" description="Platform-wide delivery events from the mail server, and the live outbound queue." />
      <Panel title="Outbound queue" description="Messages waiting for delivery or retry, read live from Stalwart." className="mt-5" padded={false}>
        {queue.isLoading ? <LoadingRows /> : queue.error ? <ErrorState error={queue.error} retry={queue.refetch} /> : (
          <DataTable rows={queue.data.messages} empty={<EmptyState icon={<Inbox className="size-5" />} title="The queue is empty" />} columns={[
            { key: 'c', header: 'Queued', cell: (m) => <span className="whitespace-nowrap text-ink-3">{dateTime(m.createdAt)}</span> },
            { key: 'f', header: 'From', cell: (m) => m.returnPath },
            { key: 'r', header: 'Recipients', cell: (m) => <ul className="text-xs">{m.recipients.map((r: any) => <li key={r.address}>{r.address} <span className="text-ink-3">· {r.status}, {r.retryCount} retries</span>{r.lastError && <span className="block text-bad">{r.lastError}</span>}</li>)}</ul> },
            { key: 'n', header: 'Next retry', hideOnMobile: true, cell: (m) => relative(m.nextRetry) },
            { key: 's', header: 'Size', hideOnMobile: true, cell: (m) => bytes(m.size) },
          ]} />
        )}
      </Panel>
    </div>
  );
}
