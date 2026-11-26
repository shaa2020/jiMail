'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Checkbox, ErrorState, Field, Input, LoadingRows, PageHeader, Panel } from '@/components/ui/primitives';
import { get, patch } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { useOrg } from '@/lib/org';

export default function OrgSettings() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const q = useQuery<any>({ queryKey: ['org', orgId], queryFn: () => get(`/orgs/${orgId}`) });
  const [name, setName] = useState('');
  useEffect(() => { if (q.data) setName(q.data.name); }, [q.data]);
  const save = useAction((body: any) => patch(`/orgs/${orgId}`, body), { success: 'Settings saved', invalidate: [['org', orgId], ['dash', orgId]], onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }) });
  if (q.isLoading) return <LoadingRows />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div className="max-w-2xl">
      <PageHeader title="Organisation settings" />
      <div className="space-y-5">
        <Panel title="General">
          <Field label="Organisation name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <div className="mt-4 flex justify-end"><Button loading={save.isPending} disabled={!name || name === q.data.name} onClick={() => save.mutate({ name })}>Save</Button></div>
        </Panel>
        <Panel title="Security policy">
          <Checkbox label="Require two-factor authentication for all administrators" hint="Members without 2FA are prompted to enrol at their next sign-in. Only the owner can change this." checked={q.data.require2fa} onChange={(v) => role === 'OWNER' && save.mutate({ require2fa: v })} />
        </Panel>
      </div>
    </div>
  );
}
