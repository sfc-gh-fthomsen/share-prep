'use client';

import { cn } from '@/lib/utils';
import type React from 'react';

/** Numbered form section: a big ordinal in the margin, no card around it. */
export function Section({ n, title, aside, children, delay = 0 }: { n: string; title: string; aside?: React.ReactNode; children: React.ReactNode; delay?: number }) {
  return (
    <section className="animate-rise grid min-w-0 gap-4 border-t border-rule pt-6 sm:grid-cols-[4.5rem_1fr]" style={{ animationDelay: `${delay}ms` }} aria-labelledby={`sec-${n}`}>
      <div className="font-display text-5xl leading-none font-extrabold text-brand tabular-nums" style={{ fontStretch: '70%' }} aria-hidden>
        {n}
      </div>
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`sec-${n}`} className="font-display text-2xl font-bold tracking-tight" style={{ fontStretch: '80%' }}>
            {title}
          </h2>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('grid min-w-0 gap-1.5 text-sm', className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'h-9 w-full min-w-0 rounded-sm border border-input bg-card px-2.5 font-mono text-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50';

export function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex items-start gap-2.5 text-sm', disabled && 'opacity-50')}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--brand)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** Large radio tile used for the method and distribution choices. */
export function Tile<T extends string>({ value, current, onSelect, label, blurb, name }: { value: T; current: T; onSelect: (v: T) => void; label: string; blurb: string; name: string }) {
  const active = value === current;
  return (
    <label
      className={cn(
        'relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-sm border bg-card p-3.5 transition hover:border-foreground/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/40',
        active ? 'border-foreground shadow-[3px_3px_0_0_var(--brand)]' : 'border-border',
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={active} onChange={() => onSelect(value)} />
      <span className="font-display text-base font-bold" style={{ fontStretch: '85%' }}>
        {label}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{blurb}</span>
    </label>
  );
}

export function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'error' | 'warning'; children: React.ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'rounded-sm border-l-2 px-3 py-2 text-sm',
        tone === 'error' && 'border-destructive bg-destructive/8 text-destructive',
        tone === 'warning' && 'border-warning bg-warning/10',
        tone === 'muted' && 'border-rule bg-muted text-muted-foreground',
      )}
    >
      {children}
    </p>
  );
}
