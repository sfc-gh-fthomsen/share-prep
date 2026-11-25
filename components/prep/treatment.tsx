'use client';

import { formatCompact } from '@/lib/format';
import { RULE_LABELS, RULES_BY_FAMILY, typeFamily, type MaskRule, type Method } from '@/lib/plan';
import { cn } from '@/lib/utils';
import { ChevronDown, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';
import { METHOD_INFO, tableKey, type ColumnState, type TableState } from './state';
import { Check, Notice, Tile } from './ui';

export function Treatment({
  method,
  onMethod,
  tables,
  onColumn,
  onAll,
  onRemove,
  similarityFilter,
  onSimilarity,
}: {
  method: Method;
  onMethod: (m: Method) => void;
  tables: TableState[];
  onColumn: (key: string, col: string, patch: Partial<ColumnState>) => void;
  onAll: (key: string, include: boolean) => void;
  onRemove: (key: string) => void;
  similarityFilter: boolean;
  onSimilarity: (v: boolean) => void;
}) {
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label="Preparation method">
        {(Object.keys(METHOD_INFO) as Method[]).map((m) => (
          <Tile key={m} name="method" value={m} current={method} onSelect={onMethod} label={METHOD_INFO[m].label} blurb={METHOD_INFO[m].blurb} />
        ))}
      </div>

      {method === 'synthetic' && (
        <div className="grid gap-2">
          <Check checked={similarityFilter} onChange={onSimilarity} label="Privacy filter" hint="Drop generated rows that are too close to a real row. Fails if numeric columns contain NULLs." />
          <Notice>Mark columns you will join on as join keys so they stay consistent across tables. Up to 5 tables run per call; larger selections are batched.</Notice>
        </div>
      )}

      {tables.length === 0 ? (
        <p className="rounded-sm border border-dashed border-input px-4 py-6 text-center text-sm text-muted-foreground">Tick tables above to choose their columns here.</p>
      ) : (
        <ul className="grid gap-2">
          {tables.map((t) => (
            <TableTreatment key={tableKey(t)} t={t} method={method} onColumn={onColumn} onAll={onAll} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TableTreatment({ t, method, onColumn, onAll, onRemove }: { t: TableState; method: Method; onColumn: (key: string, col: string, patch: Partial<ColumnState>) => void; onAll: (key: string, include: boolean) => void; onRemove: (key: string) => void }) {
  const [open, setOpen] = useState(true);
  const key = tableKey(t);
  const cols = t.columns ?? [];
  const included = cols.filter((c) => c.include).length;
  const flagged = cols.filter((c) => c.hint && c.include).length;
  const unprotected = method === 'clone' ? flagged : cols.filter((c) => c.hint && c.include && c.rule === 'keep').length;

  return (
    <li className="min-w-0 rounded-sm border border-border bg-card">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden />
          <span className="min-w-0 truncate font-mono text-sm">
            <span className="text-muted-foreground">
              {t.database}.{t.schema}.
            </span>
            <span className="font-medium">{t.table}</span>
          </span>
        </button>
        <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
          {t.columns ? `${included}/${cols.length} cols` : 'loading…'}
          {t.rows != null && ` · ${formatCompact(t.rows)} rows`}
        </span>
        {unprotected > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-brand" title="Columns whose names suggest personal data are going out unprotected">
            <ShieldAlert className="size-3.5" aria-hidden />
            {unprotected}
          </span>
        )}
        <button type="button" aria-label={`Remove ${t.table}`} className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => onRemove(key)}>
          <X className="size-4" />
        </button>
      </div>

      {open && (
        <div className="border-t border-border">
          {t.error && (
            <div className="p-3">
              <Notice tone="error">{t.error}</Notice>
            </div>
          )}
          {!t.columns && !t.error && <p className="p-3 text-sm text-muted-foreground">Reading columns…</p>}
          {t.columns && (
            <>
              <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-muted-foreground">
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => onAll(key, true)}>
                  Include all
                </button>
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => onAll(key, false)}>
                  Include none
                </button>
                {method === 'clone' && t.kind === 'view' && <span className="ml-auto">Views are copied, not cloned.</span>}
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="w-10 px-3 py-1.5 font-medium">
                        <span className="sr-only">Include</span>
                      </th>
                      <th className="px-1 py-1.5 font-medium">Column</th>
                      <th className="hidden px-2 py-1.5 font-medium sm:table-cell">Type</th>
                      <th className="px-3 py-1.5 font-medium">{method === 'mask' ? 'Treatment' : method === 'synthetic' ? 'Join key' : 'Flag'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cols.map((c) => (
                      <ColumnRow key={c.name} c={c} method={method} onChange={(patch) => onColumn(key, c.name, patch)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function ColumnRow({ c, method, onChange }: { c: ColumnState; method: Method; onChange: (patch: Partial<ColumnState>) => void }) {
  const rules = RULES_BY_FAMILY[typeFamily(c.dataType)];
  const exposed = c.hint && c.include && (method === 'clone' || (method === 'mask' && c.rule === 'keep'));
  return (
    <tr className={cn('border-b border-border/50 last:border-0', !c.include && 'text-muted-foreground')}>
      <td className="px-3 py-1.5">
        <input type="checkbox" aria-label={`Include ${c.name}`} className="size-4 accent-[var(--brand)]" checked={c.include} onChange={(e) => onChange({ include: e.target.checked })} />
      </td>
      <td className="max-w-0 px-1 py-1.5">
        <div className={cn('truncate font-mono', !c.include && 'line-through')}>{c.name}</div>
        {c.hint && <div className={cn('text-[11px]', exposed ? 'font-medium text-brand' : 'text-muted-foreground')}>looks like {c.hint.label}</div>}
      </td>
      <td className="hidden px-2 py-1.5 font-mono text-xs text-muted-foreground sm:table-cell">{c.dataType}</td>
      <td className="px-3 py-1.5">
        {method === 'mask' && (
          <select aria-label={`Treatment for ${c.name}`} disabled={!c.include} className="h-8 w-full min-w-0 rounded-sm border border-input bg-background px-1.5 text-xs disabled:opacity-50" value={c.rule} onChange={(e) => onChange({ rule: e.target.value as MaskRule })}>
            {rules.map((r) => (
              <option key={r} value={r}>
                {RULE_LABELS[r]}
              </option>
            ))}
          </select>
        )}
        {method === 'synthetic' && <input type="checkbox" aria-label={`${c.name} is a join key`} disabled={!c.include} className="size-4 accent-[var(--brand)]" checked={c.joinKey} onChange={(e) => onChange({ joinKey: e.target.checked })} />}
        {method === 'clone' && <span className="text-xs">{exposed ? 'real values' : '—'}</span>}
      </td>
    </tr>
  );
}
