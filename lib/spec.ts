import type { ColumnSel, MaskRule, Method, PrepSpec, ShareMode } from '@/lib/plan';
import { PlanError } from '@/lib/plan';

const METHODS: Method[] = ['clone', 'mask', 'synthetic'];
const MODES: ShareMode[] = ['none', 'share', 'private_listing', 'org_listing'];
const RULES: MaskRule[] = ['keep', 'hash', 'partial', 'email', 'redact', 'null', 'round', 'month', 'year'];

const str = (v: unknown, max = 255): string => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown): boolean => v === true;

/** Coerces an untrusted request body into a PrepSpec. buildPlan does the semantic checks. */
export function parseSpec(body: unknown): PrepSpec {
  if (!body || typeof body !== 'object') throw new PlanError('Invalid request.');
  const b = body as Record<string, unknown>;
  const method = METHODS.find((m) => m === b.method);
  if (!method) throw new PlanError('Pick a preparation method.');
  const tables = Array.isArray(b.tables) ? b.tables.slice(0, 50) : [];
  const target = (b.target ?? {}) as Record<string, unknown>;
  const share = (b.share ?? {}) as Record<string, unknown>;
  return {
    method,
    similarityFilter: bool(b.similarityFilter),
    tables: tables.map((t: Record<string, unknown>) => ({
      database: str(t.database),
      schema: str(t.schema),
      table: str(t.table),
      columns: (Array.isArray(t.columns) ? t.columns.slice(0, 1000) : []).map((c: Record<string, unknown>): ColumnSel => ({
        name: str(c.name),
        rule: RULES.find((r) => r === c.rule) ?? 'keep',
        joinKey: bool(c.joinKey),
      })),
    })),
    target: {
      database: str(target.database),
      schema: str(target.schema),
      createDatabase: bool(target.createDatabase),
      createSchema: bool(target.createSchema),
      suffix: str(target.suffix, 40),
      replace: bool(target.replace),
    },
    share: {
      mode: MODES.find((m) => m === share.mode) ?? 'none',
      shareName: str(share.shareName),
      accounts: (Array.isArray(share.accounts) ? share.accounts.slice(0, 100) : []).map((a) => str(a).trim()).filter(Boolean),
      listingName: str(share.listingName),
      title: str(share.title, 200),
      description: str(share.description, 8000),
      publish: bool(share.publish),
      autoFulfill: bool(share.autoFulfill),
      refreshMinutes: typeof share.refreshMinutes === 'number' ? share.refreshMinutes : 60,
      orgAllAccounts: bool(share.orgAllAccounts),
      supportContact: str(share.supportContact).trim(),
    },
  };
}
