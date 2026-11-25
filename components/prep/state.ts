import type { MaskRule, Method, ShareSpec, Target } from '@/lib/plan';
import type { Hint } from '@/lib/sensitivity';

export interface ColumnState {
  name: string;
  dataType: string;
  include: boolean;
  rule: MaskRule;
  joinKey: boolean;
  hint: Hint | null;
}

export interface TableState {
  database: string;
  schema: string;
  table: string;
  kind: 'table' | 'view';
  rows: string | null;
  /** null while the columns are loading. */
  columns: ColumnState[] | null;
  error?: string;
}

export interface StudioState {
  method: Method;
  tables: TableState[];
  target: Target;
  share: ShareSpec;
  similarityFilter: boolean;
}

export const SUFFIX: Record<Method, string> = { clone: '_CLONE', mask: '_MASKED', synthetic: '_SYNTH' };

export const METHOD_INFO: Record<Method, { label: string; stamp: string; blurb: string }> = {
  clone: { label: 'Zero-copy clone', stamp: 'CLONE', blurb: 'Instant copy with real values. Excluded columns are dropped from the clone.' },
  mask: { label: 'Mask, then copy', stamp: 'MASKED', blurb: 'New tables built from SELECTs that hash, truncate or redact the columns you flag.' },
  synthetic: { label: 'Synthetic data', stamp: 'SYNTHETIC', blurb: 'Statistically similar, artificial rows from GENERATE_SYNTHETIC_DATA. Needs 20+ rows per table.' },
};

export const MODE_INFO: Record<ShareSpec['mode'], { label: string; blurb: string }> = {
  none: { label: 'Keep in account', blurb: 'Only prepare the copies.' },
  share: { label: 'Direct share', blurb: 'A share object, optionally with consumer accounts added.' },
  private_listing: { label: 'Private listing', blurb: 'A listing targeted at named accounts, in any region.' },
  org_listing: { label: 'Organization listing', blurb: 'Publish to your Internal Marketplace.' },
};

export const tableKey = (t: { database: string; schema: string; table: string }) => `${t.database}.${t.schema}.${t.table}`;

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? body.message ?? 'Request failed');
  return body as T;
}

/** The spec sent to the server; it rebuilds and validates the SQL itself. */
export function toSpec(s: StudioState) {
  return {
    method: s.method,
    similarityFilter: s.similarityFilter,
    target: s.target,
    share: s.share,
    tables: s.tables
      .filter((t) => t.columns)
      .map((t) => ({
        database: t.database,
        schema: t.schema,
        table: t.table,
        columns: t.columns!.filter((c) => c.include).map((c) => ({ name: c.name, rule: c.rule, joinKey: c.joinKey })),
      })),
  };
}
