'use client';

import { DeliveryView } from '@/components/delivery-view';
import { useOrg } from '@/lib/org';

export default function DeliveryPage() {
  const { orgId } = useOrg();
  return <DeliveryView path={`/orgs/${orgId}/delivery`} title="Mail activity" description="Sending, delivery and receiving events reported by the mail server for this organisation's mailboxes." />;
}
