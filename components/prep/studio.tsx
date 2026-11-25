'use client';

import { ThemeToggle } from '@/components/theme-toggle';
import type { ColumnMeta, Method, Step, StepResult } from '@/lib/plan';
import { sensitivityHint } from '@/lib/sensitivity';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Manifest } from './manifest';
import { SourcePicker } from './source-picker';
import { api, SUFFIX, tableKey, toSpec, type ColumnState, type StudioState, type TableState } from './state';
import { Destination, Distribution } from './target-share';
import { Treatment } from './treatment';
import { Notice, Section } from './ui';

interface Context {
  user: string;
  role: string;
  warehouse: string | null;
  org: string | null;
  account: string;
  region: string;
}

const INITIAL: StudioState = {
  method: 'mask',
  tables: [],
  similarityFilter: false,
  target: { database: '', schema: 'SHARE_PREP', createDatabase: false, createSchema: true, suffix: SUFFIX.mask, replace: true },
  share: {
    mode: 'share',
    shareName: 'SHARE_PREP_SHARE',
    accounts: [],
    listingName: 'SHARE_PREP_LISTING',
    title: '',
    description: '',
    publish: false,
    autoFulfill: false,
    refreshMinutes: 60,
    orgAllAccounts: false,
    supportContact: '',
  },
};

const METHODS: Method[] = ['clone', 'mask', 'synthetic'];
const MODES = ['none', 'share', 'private_listing', 'org_listing'] as const;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Studio() {
  const [state, setState] = useState<StudioState>(INITIAL);
  const [suffixTouched, setSuffixTouched] = useState(false);
  const [results, setResults] = useState<{ key: string; results: StepResult[] } | null>(null);

  // Method and delivery mode live in the URL so a view can be reloaded or shared.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const m = METHODS.find((x) => x === p.get('method'));
    const d = MODES.find((x) => x === p.get('deliver'));
    if (m || d) setState((s) => ({ ...s, method: m ?? s.method, target: { ...s.target, suffix: SUFFIX[m ?? s.method] }, share: { ...s.share, mode: d ?? s.share.mode } }));
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('method', state.method);
    p.set('deliver', state.share.mode);
    window.history.replaceState(null, '', `?${p}`);
  }, [state.method, state.share.mode]);

  const context = useQuery({ queryKey: ['context'], queryFn: () => api<Context>('/api/context') });
  const dbs = useQuery({ queryKey: ['dbs'], queryFn: () => api<{ databases: string[] }>('/api/catalog') });

  const spec = useMemo(() => toSpec(state), [state]);
  const specKey = useMemo(() => JSON.stringify(spec), [spec]);
  const debouncedKey = useDebounced(specKey, 350);
  const ready = state.tables.length > 0 && state.tables.every((t) => t.columns || t.error);

  const plan = useQuery({
    queryKey: ['plan', debouncedKey],
    enabled: ready,
    retry: false,
    placeholderData: (prev) => prev,
    queryFn: () => api<{ steps: Step[] }>('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: debouncedKey }),
  });

  const run = useMutation({
    mutationFn: (body: string) => api<{ steps: Step[]; results: StepResult[] }>('/api/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body }),
    onSuccess: (data, body) => setResults({ key: body, results: data.results }),
  });

  // Results belong to the spec that produced them; any edit clears them.
  const shownResults = results && results.key === specKey ? results.results : null;

  function patchTable(key: string, fn: (t: TableState) => TableState) {
    setState((s) => ({ ...s, tables: s.tables.map((t) => (tableKey(t) === key ? fn(t) : t)) }));
  }

  async function toggleTable(t: { database: string; schema: string; table: string; kind: 'table' | 'view'; rows: string | null }, on: boolean) {
    const key = tableKey(t);
    if (!on) {
      setState((s) => ({ ...s, tables: s.tables.filter((x) => tableKey(x) !== key) }));
      return;
    }
    setState((s) => ({
      ...s,
      tables: [...s.tables, { ...t, columns: null }],
      target: s.target.database ? s.target : { ...s.target, database: t.database },
    }));
    try {
      const { columns } = await api<{ columns: ColumnMeta[] }>(`/api/catalog?db=${encodeURIComponent(t.database)}&schema=${encodeURIComponent(t.schema)}&table=${encodeURIComponent(t.table)}`);
      patchTable(key, (x) => ({
        ...x,
        columns: columns.map((c): ColumnState => {
          const hint = sensitivityHint(c.name, c.dataType);
          return { name: c.name, dataType: c.dataType, include: true, rule: hint?.rule ?? 'keep', joinKey: false, hint };
        }),
      }));
    } catch (e) {
      patchTable(key, (x) => ({ ...x, error: `Could not read columns: ${(e as Error).message}` }));
    }
  }

  const ctx = context.data;
  const planError = !ready ? null : plan.error ? plan.error.message : null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-8" />
          <span className="font-display text-xl font-extrabold tracking-tight" style={{ fontStretch: '75%' }}>
            Share Prep
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          {ctx && (
            <span className="min-w-0 truncate font-mono">
              {ctx.user} · {ctx.role} · {ctx.warehouse ?? 'no warehouse'}
            </span>
          )}
          {context.isPending && <span>Connecting…</span>}
          <ThemeToggle />
        </div>
      </header>

      <div className="animate-rise max-w-3xl pt-4 pb-8">
        <h1 className="font-display text-4xl leading-[0.95] font-extrabold tracking-tight sm:text-6xl" style={{ fontStretch: '72%' }}>
          Decide what leaves the account, <span className="text-brand">and in what form.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          Pick tables and columns, clone, mask or synthesize them into a separate database, then hand them over as a share or a listing. You review every statement before it runs.
        </p>
      </div>

      {context.error && <Notice tone="error">Could not reach Snowflake: {context.error.message}</Notice>}
      {ctx && !ctx.warehouse && <Notice tone="warning">Your session has no warehouse. Set a default warehouse for your user before running the manifest.</Notice>}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="grid min-w-0 content-start gap-10">
          <Section n="01" title="Pick source data" delay={60} aside={state.tables.length > 0 && <span className="text-sm text-muted-foreground tabular-nums">{state.tables.length} selected</span>}>
            <SourcePicker selected={state.tables} onToggle={toggleTable} />
          </Section>

          <Section n="02" title="Choose a treatment" delay={120}>
            <Treatment
              method={state.method}
              onMethod={(m) => setState((s) => ({ ...s, method: m, target: suffixTouched ? s.target : { ...s.target, suffix: SUFFIX[m] } }))}
              tables={state.tables}
              onColumn={(key, col, patch) => patchTable(key, (t) => ({ ...t, columns: t.columns?.map((c) => (c.name === col ? { ...c, ...patch } : c)) ?? null }))}
              onAll={(key, include) => patchTable(key, (t) => ({ ...t, columns: t.columns?.map((c) => ({ ...c, include })) ?? null }))}
              onRemove={(key) => setState((s) => ({ ...s, tables: s.tables.filter((t) => tableKey(t) !== key) }))}
              similarityFilter={state.similarityFilter}
              onSimilarity={(v) => setState((s) => ({ ...s, similarityFilter: v }))}
            />
          </Section>

          <Section n="03" title="Where to store it" delay={180}>
            <Destination
              target={state.target}
              databases={dbs.data?.databases ?? []}
              onChange={(patch) => {
                if ('suffix' in patch) setSuffixTouched(true);
                setState((s) => ({ ...s, target: { ...s.target, ...patch } }));
              }}
            />
          </Section>

          <Section n="04" title="How to deliver it" delay={240}>
            <Distribution share={state.share} org={ctx?.org ?? null} onChange={(patch) => setState((s) => ({ ...s, share: { ...s.share, ...patch } }))} />
          </Section>
        </div>

        <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="animate-rise" style={{ animationDelay: '160ms' }}>
            <Manifest
              state={state}
              steps={ready ? plan.data?.steps : undefined}
              planError={planError}
              planPending={ready && (plan.isFetching || debouncedKey !== specKey)}
              results={shownResults}
              running={run.isPending}
              runError={run.error ? run.error.message : null}
              onRun={() => run.mutate(specKey)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
