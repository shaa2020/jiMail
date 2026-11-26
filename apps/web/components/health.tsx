'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import { Meter } from '@/components/ui/primitives';
import { bytes } from '@/lib/format';

const NAMES: Record<string, string> = { api: 'API', database: 'PostgreSQL', redis: 'Redis', 'mail-server': 'Stalwart mail server', worker: 'Background worker' };

export function ComponentList({ components }: { components: { name: string; ok: boolean; latencyMs?: number; detail?: string }[] }) {
  return (
    <ul className="divide-y divide-line">
      {components.map((c) => (
        <li key={c.name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="flex items-center gap-2">{c.ok ? <CheckCircle2 className="size-4 text-ok" aria-label="Healthy" /> : <XCircle className="size-4 text-bad" aria-label="Unhealthy" />}{NAMES[c.name] ?? c.name}</span>
          <span className="truncate text-right text-xs text-ink-3">{c.latencyMs !== undefined ? `${c.latencyMs} ms` : ''}{c.detail && !c.ok ? ` · ${c.detail}` : c.name === 'worker' || c.name === 'api' ? ` ${c.detail ?? ''}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}

export function SystemResources({ system }: { system: any }) {
  return (
    <dl className="space-y-4 text-sm">
      <div><div className="mb-1.5 flex justify-between"><dt>CPU load (1 min)</dt><dd>{system.cpuLoadPercent}% of {system.cpus} cores</dd></div><Meter value={system.cpuLoadPercent} max={100} label="CPU load" /></div>
      <div><div className="mb-1.5 flex justify-between"><dt>Memory</dt><dd>{bytes(system.memory.totalBytes - system.memory.freeBytes)} / {bytes(system.memory.totalBytes)}</dd></div><Meter value={system.memory.usedPercent} max={100} label="Memory" /></div>
      {system.disk && <div><div className="mb-1.5 flex justify-between"><dt>Disk</dt><dd>{bytes(system.disk.totalBytes - system.disk.freeBytes)} / {bytes(system.disk.totalBytes)}</dd></div><Meter value={system.disk.usedPercent} max={100} label="Disk" /></div>}
      <p className="text-xs text-ink-3">Measured on the API host ({system.host}).</p>
    </dl>
  );
}
