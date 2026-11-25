'use client';

import { Skeleton } from '@/components/ui/skeleton';
import type { TableRow } from '@/lib/catalog';
import { formatCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, tableKey, type TableState } from './state';
import { Field, inputClass, Notice } from './ui';

const PAGE = 40;

export function SourcePicker({ selected, onToggle }: { selected: TableState[]; onToggle: (t: { database: string; schema: string; table: string; kind: 'table' | 'view'; rows: string | null }, on: boolean) => void }) {
  const [db, setDb] = useState('');
  const [schema, setSchema] = useState('');
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const dbs = useQuery({ queryKey: ['dbs'], queryFn: () => api<{ databases: string[] }>('/api/catalog') });
  const schemas = useQuery({
    queryKey: ['schemas', db],
    enabled: !!db,
    queryFn: () => api<{ schemas: string[] }>(`/api/catalog?db=${encodeURIComponent(db)}`),
  });
  const tables = useQuery({
    queryKey: ['tables', db, schema],
    enabled: !!db && !!schema,
    queryFn: () => api<{ tables: TableRow[] }>(`/api/catalog?db=${encodeURIComponent(db)}&schema=${encodeURIComponent(schema)}`),
  });

  const chosen = useMemo(() => new Set(selected.map(tableKey)), [selected]);
  const visible = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return (tables.data?.tables ?? []).filter((t) => !f || t.name.toUpperCase().includes(f));
  }, [tables.data, filter]);

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Database">
          <select
            className={inputClass}
            value={db}
            disabled={!dbs.data}
            onChange={(e) => {
              setDb(e.target.value);
              setSchema('');
              setLimit(PAGE);
            }}
          >
            <option value="">{dbs.isPending ? 'Loading databases…' : 'Choose a database'}</option>
            {dbs.data?.databases.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Schema">
          <select
            className={inputClass}
            value={schema}
            disabled={!schemas.data}
            onChange={(e) => {
              setSchema(e.target.value);
              setLimit(PAGE);
            }}
          >
            <option value="">{db ? (schemas.isPending ? 'Loading schemas…' : 'Choose a schema') : '—'}</option>
            {schemas.data?.schemas.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>

      {dbs.error && <Notice tone="error">Could not list databases: {dbs.error.message}</Notice>}
      {schemas.error && <Notice tone="error">Could not list schemas: {schemas.error.message}</Notice>}

      {db && schema && (
        <div className="min-w-0 rounded-sm border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              aria-label="Filter tables"
              className="h-10 w-full min-w-0 bg-transparent font-mono text-sm outline-none"
              placeholder="Filter tables and views"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {tables.data && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{visible.length} objects</span>}
          </div>
          {tables.isPending && (
            <div className="grid gap-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7" />
              ))}
            </div>
          )}
          {tables.error && (
            <div className="p-3">
              <Notice tone="error">Could not list tables: {tables.error.message}</Notice>
            </div>
          )}
          {tables.data && visible.length === 0 && <p className="p-4 text-sm text-muted-foreground">No tables or views{filter ? ' match that filter' : ' in this schema'}.</p>}
          <ul className="max-h-80 overflow-y-auto">
            {visible.slice(0, limit).map((t) => {
              const key = tableKey({ database: db, schema, table: t.name });
              const on = chosen.has(key);
              return (
                <li key={key} className="border-b border-border/60 last:border-0">
                  <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent/60', on && 'bg-accent')}>
                    <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={on} onChange={(e) => onToggle({ database: db, schema, table: t.name, kind: t.kind, rows: t.rows }, e.target.checked)} />
                    <span className="min-w-0 flex-1 truncate font-mono">{t.name}</span>
                    {t.kind === 'view' && <span className="text-[11px] tracking-wide text-muted-foreground uppercase">view</span>}
                    <span className="w-20 text-right text-xs text-muted-foreground tabular-nums">{t.rows != null ? `${formatCompact(t.rows)} rows` : '—'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {visible.length > limit && (
            <button type="button" className="w-full border-t border-border py-2 text-sm font-medium hover:bg-accent" onClick={() => setLimit((l) => l + PAGE)}>
              Show {Math.min(PAGE, visible.length - limit)} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
