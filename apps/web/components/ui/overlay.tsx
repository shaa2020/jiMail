'use client';

import * as D from '@radix-ui/react-dialog';
import * as M from '@radix-ui/react-dropdown-menu';
import * as T from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Button, cx, Input } from './primitives';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-[#061a1c]/45 backdrop-blur-[1px]" />
        <D.Content
          className={cx(
            'fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface shadow-2xl',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <D.Title className="font-display text-lg font-semibold">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-ink-3">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          {children && <div className="px-5 py-4">{children}</div>}
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation for destructive actions; optionally requires typing a phrase. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger = true,
  typeToConfirm,
  loading,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  typeToConfirm?: string;
  loading?: boolean;
  children?: ReactNode;
}) {
  const [typed, setTyped] = useState('');
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTyped('');
        onOpenChange(v);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} disabled={!!typeToConfirm && typed !== typeToConfirm} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {typeToConfirm && (
        <div className="space-y-1.5">
          <label className="text-[13px] text-ink-2" htmlFor="confirm-type">
            Type <strong className="font-mono">{typeToConfirm}</strong> to confirm
          </label>
          <Input id="confirm-type" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
    </Dialog>
  );
}

export function Menu({ trigger, children, align = 'end' }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Root>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-xl">
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({ onSelect, children, danger, icon, disabled }: { onSelect: () => void; children: ReactNode; danger?: boolean; icon?: ReactNode; disabled?: boolean }) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx('flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2', danger ? 'text-bad' : 'text-ink')}
    >
      {icon}
      {children}
    </M.Item>
  );
}

export const MenuSeparator = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2.5 py-1.5 text-xs text-ink-3">{children}</M.Label>;

export function Tip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Root delayDuration={300}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content sideOffset={6} className="z-50 max-w-xs rounded-md bg-ink px-2.5 py-1.5 text-xs text-paper shadow-lg">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TipProvider = T.Provider;
