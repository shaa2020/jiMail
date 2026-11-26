'use client';

import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Button, cx } from './primitives';

export interface Column<T = any> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
}

export function DataTable({ columns, rows, onRowClick, empty }: { columns: Column<any>[]; rows: any[]; onRowClick?: (r: any) => void; empty?: ReactNode }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] text-ink-3">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('px-5 py-2.5 font-medium', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2 focus:bg-surface-2')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-5 py-3 align-middle', c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-ink-3">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="size-4" />} />
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="size-4" />} />
      </div>
    </div>
  );
}

/** Debounced search box. */
export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => v !== value && onChange(v), 300);
    return () => clearTimeout(t);
  }, [v, value, onChange]);
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-lg border border-line-strong bg-surface pl-9 pr-3 text-sm placeholder:text-ink-3 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-saffron/40"
      />
    </div>
  );
}
