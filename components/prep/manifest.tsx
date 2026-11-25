'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { copyText } from '@/lib/clipboard';
import { formatDuration, formatValue } from '@/lib/format';
import type { Method, Step, StepResult } from '@/lib/plan';
import { cn } from '@/lib/utils';
import { Check, CircleDashed, Copy, Loader2, Play, X } from 'lucide-react';
import { useState } from 'react';
import { METHOD_INFO, MODE_INFO, type StudioState } from './state';

export interface ManifestProps {
  state: StudioState;
  steps: Step[] | undefined;
  planError: string | null;
  planPending: boolean;
  results: StepResult[] | null;
  running: boolean;
  runError: string | null;
  onRun: () => void;
}

export function Manifest({ state, steps, planError, planPending, results, running, runError, onRun }: ManifestProps) {
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const loaded = state.tables.filter((t) => t.columns);
  const colCount = loaded.reduce((n, t) => n + t.columns!.filter((c) => c.include).length, 0);
  const masked = state.method === 'mask' ? loaded.reduce((n, t) => n + t.columns!.filter((c) => c.include && c.rule !== 'keep').length, 0) : 0;
  const byId = new Map(results?.map((r) => [r.id, r]) ?? []);
  const cleared = !!results && results.every((r) => r.status === 'ok');
  const failed = results?.find((r) => r.status === 'failed');
  const dest = state.target.database && state.target.schema ? `${state.target.database}.${state.target.schema}` : '—';
  const recipients =
    state.share.mode === 'none'
      ? 'Nobody yet'
      : state.share.mode === 'org_listing' && state.share.orgAllAccounts
        ? 'All internal accounts'
        : state.share.accounts.length
          ? state.share.accounts.join(', ')
          : 'No accounts yet';
  const canRun = !!steps?.length && !planError && !planPending && !running;

  async function copyAll() {
    if (!steps) return;
    const ok = await copyText(steps.map((s, i) => `-- ${i + 1}. ${s.title}\n${s.sql};`).join('\n\n'));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 1800);
  }

  return (
    <aside aria-label="Manifest" className="relative min-w-0 overflow-hidden rounded-sm border border-foreground/80 bg-card shadow-[6px_6px_0_0_var(--rule)]">
      <div className="ruled px-5 pt-5 pb-4">
        <div className="flex items-center justify-between text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
          <span>Share manifest</span>
          <span className="font-mono tracking-normal normal-case">{new Date().toISOString().slice(0, 10)}</span>
        </div>

        <div className="mt-3 flex items-end justify-between gap-3">
          <p className="font-display leading-[0.9] font-extrabold tabular-nums" style={{ fontStretch: '68%' }}>
            <span className="text-7xl">{state.tables.length}</span>
            <span className="ml-2 text-2xl font-bold">{state.tables.length === 1 ? 'table' : 'tables'}</span>
            <span className="mt-1 block text-lg font-semibold text-muted-foreground" style={{ fontStretch: '85%' }}>
              {colCount} columns{masked ? `, ${masked} masked` : ''}
            </span>
          </p>
          <Stamp key={cleared ? 'cleared' : state.method} text={cleared ? 'CLEARED' : METHOD_INFO[state.method].stamp} tone={cleared ? 'success' : 'brand'} />
        </div>

        <dl className="mt-5 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Store in</dt>
          <dd className="min-w-0 truncate font-mono">{dest}</dd>
          <dt className="text-muted-foreground">Deliver via</dt>
          <dd>{MODE_INFO[state.share.mode].label}</dd>
          <dt className="text-muted-foreground">Recipients</dt>
          <dd className="min-w-0 font-mono break-all">{recipients}</dd>
        </dl>
      </div>

      <div className="border-t border-dashed border-foreground/40 px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Steps {steps && <span className="text-muted-foreground tabular-nums">· {steps.length}</span>}
          </h3>
          <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={!steps?.length} onClick={copyAll}>
            <Copy className="size-3.5" aria-hidden />
            {copied ? 'Copied' : 'Copy SQL'}
          </button>
        </div>

        {state.tables.length === 0 && <p className="py-3 text-sm text-muted-foreground">Select tables to draft the manifest.</p>}
        {planPending && state.tables.length > 0 && !steps && (
          <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Drafting SQL…
          </p>
        )}
        {planError && state.tables.length > 0 && <p className="rounded-sm border-l-2 border-brand bg-brand/8 px-3 py-2 text-sm">{planError}</p>}

        {steps && !planError && (
          <ol className={cn('grid gap-1 transition-opacity', planPending && 'opacity-60')}>
            {steps.map((s, i) => (
              <StepItem key={s.id} n={i + 1} step={s} result={byId.get(s.id)} running={running && !results} />
            ))}
          </ol>
        )}
      </div>

      <div className="border-t border-border bg-muted/60 px-5 py-4">
        {failed && <p className="mb-3 text-sm text-destructive">Stopped at a failed step. Fix it and run again; earlier steps are safe to repeat when “Replace existing tables” is on.</p>}
        {runError && <p className="mb-3 text-sm text-destructive" role="alert">{runError}</p>}
        <Button className="h-11 w-full gap-2 text-base" disabled={!canRun} onClick={() => setConfirm(true)}>
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {running ? 'Running manifest…' : 'Run manifest'}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">Runs as your own role. Nothing runs until you confirm.</p>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run {steps?.length} steps?</DialogTitle>
            <DialogDescription>
              {summary(state.method, state.tables.length, dest)}
              {state.share.mode !== 'none' && ` It will then create ${MODE_INFO[state.share.mode].label.toLowerCase()} ${state.share.mode === 'share' ? state.share.shareName : state.share.listingName} for ${recipients.toLowerCase() === 'no accounts yet' ? 'no accounts yet' : recipients}.`}
              {state.target.replace && ' Existing output tables with the same names are replaced.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => {
                setConfirm(false);
                onRun();
              }}
            >
              Run now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function summary(method: Method, n: number, dest: string): string {
  const what = method === 'clone' ? 'clone' : method === 'mask' ? 'write masked copies of' : 'generate synthetic versions of';
  return `This will ${what} ${n} ${n === 1 ? 'table' : 'tables'} into ${dest}.`;
}

function Stamp({ text, tone }: { text: string; tone: 'brand' | 'success' }) {
  return (
    <span
      aria-label={`Treatment: ${text}`}
      className={cn(
        'animate-stamp shrink-0 rounded-[3px] border-[3px] px-2.5 py-1 font-display text-xl leading-none font-black tracking-wider',
        tone === 'brand' ? 'border-brand text-brand' : 'border-success text-success',
      )}
      style={{ fontStretch: '75%', boxShadow: 'inset 0 0 0 2px var(--card), inset 0 0 0 3px currentColor' }}
    >
      {text}
    </span>
  );
}

function StepItem({ n, step, result, running }: { n: number; step: Step; result?: StepResult; running: boolean }) {
  return (
    <li className="min-w-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2.5 rounded-sm px-1 py-1.5 text-sm hover:bg-accent/60">
          <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">{n}</span>
          <span className="min-w-0 flex-1">
            <span className="block">{step.title}</span>
            {result?.status === 'failed' && <span className="block text-xs text-destructive">{result.error}</span>}
            {result?.status === 'ok' && (
              <span className="block font-mono text-[11px] text-muted-foreground">
                {formatDuration(result.ms ?? 0)} · {result.queryId}
              </span>
            )}
          </span>
          <StatusIcon status={result?.status} running={running} />
        </summary>
        <pre className="mt-1 mb-2 ml-7 overflow-x-auto rounded-sm bg-primary px-3 py-2.5 font-mono text-[12px] leading-relaxed text-primary-foreground">{step.sql}</pre>
        {result?.preview && result.preview.length > 0 && (
          <div className="mb-2 ml-7 overflow-x-auto text-xs">
            <p className="mb-1 text-muted-foreground">Similarity metrics (lower is closer to the source)</p>
            <table className="w-full">
              <tbody>
                {result.preview.map((r, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-0.5 pr-2 font-mono">{String(r.COLUMNS ?? r.columns ?? '')}</td>
                    <td className="py-0.5 text-right tabular-nums">{formatValue(r.METRIC_VALUE ?? r.metric_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </li>
  );
}

function StatusIcon({ status, running }: { status?: StepResult['status']; running: boolean }) {
  if (status === 'ok') return <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="Done" />;
  if (status === 'failed') return <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />;
  if (status === 'skipped') return <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Skipped" />;
  if (running) return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Running" />;
  return null;
}
