/**
 * Builds the SQL plan ("manifest") that prepares selected tables for sharing.
 * Pure and shared by /api/plan (preview) and /api/execute (run): the server always
 * rebuilds the plan from the spec plus catalog metadata, never trusts client SQL.
 */

export type Method = 'clone' | 'mask' | 'synthetic';

export type MaskRule =
  | 'keep'
  | 'hash'
  | 'partial'
  | 'email'
  | 'redact'
  | 'null'
  | 'round'
  | 'month'
  | 'year';

export type ShareMode = 'none' | 'share' | 'private_listing' | 'org_listing';

export interface ColumnSel {
  name: string;
  rule: MaskRule;
  joinKey?: boolean;
}

export interface TableSel {
  database: string;
  schema: string;
  table: string;
  /** Included columns only, in source order. */
  columns: ColumnSel[];
}

export interface Target {
  database: string;
  schema: string;
  createDatabase: boolean;
  createSchema: boolean;
  suffix: string;
  replace: boolean;
}

export interface ShareSpec {
  mode: ShareMode;
  shareName: string;
  /** org.account for shares and private listings; account name for org listings. */
  accounts: string[];
  listingName: string;
  title: string;
  description: string;
  publish: boolean;
  autoFulfill: boolean;
  refreshMinutes: number;
  orgAllAccounts: boolean;
  supportContact: string;
}

export interface PrepSpec {
  method: Method;
  tables: TableSel[];
  target: Target;
  share: ShareSpec;
  similarityFilter: boolean;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
}

export interface TableMeta {
  kind: 'table' | 'view';
  columns: ColumnMeta[];
}

export interface Step {
  id: string;
  phase: 'target' | 'data' | 'cleanup' | 'share';
  title: string;
  sql: string;
}

export interface StepResult {
  id: string;
  status: 'ok' | 'failed' | 'skipped';
  ms?: number;
  queryId?: string;
  error?: string;
  code?: string;
  /** First rows of output, e.g. similarity metrics from GENERATE_SYNTHETIC_DATA. */
  preview?: Record<string, unknown>[];
}

export class PlanError extends Error {}

export type TypeFamily = 'string' | 'number' | 'temporal' | 'other';

export function typeFamily(dataType: string): TypeFamily {
  const t = dataType.toUpperCase();
  if (/^(TEXT|VARCHAR|CHAR|CHARACTER|STRING)/.test(t)) return 'string';
  if (/^(NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT|TINYINT|BYTEINT|FLOAT|DOUBLE|REAL)/.test(t)) return 'number';
  if (/^(DATE|TIMESTAMP|DATETIME)/.test(t)) return 'temporal';
  return 'other';
}

export const RULES_BY_FAMILY: Record<TypeFamily, MaskRule[]> = {
  string: ['keep', 'hash', 'partial', 'email', 'redact', 'null'],
  number: ['keep', 'hash', 'round', 'null'],
  temporal: ['keep', 'month', 'year', 'null'],
  other: ['keep', 'hash', 'null'],
};

export const RULE_LABELS: Record<MaskRule, string> = {
  keep: 'Keep as is',
  hash: 'Hash (SHA-256)',
  partial: 'Show last 4',
  email: 'Mask email user',
  redact: 'Replace with [REDACTED]',
  null: 'Set to NULL',
  round: 'Round to nearest 10',
  month: 'Truncate to month',
  year: 'Truncate to year',
};

export const MAX_SYNTHETIC_PER_CALL = 5;

const SIMPLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,254}$/;
const ORG_ACCOUNT = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;
const ACCOUNT_NAME = /^[A-Za-z0-9_]+$/;
const EMAIL = /^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/;

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function fqn(database: string, schema: string, name: string): string {
  return `${quoteIdent(database)}.${quoteIdent(schema)}.${quoteIdent(name)}`;
}

/** SQL single-quoted string literal. */
export function sqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

/** YAML double-quoted scalar (JSON strings are valid YAML). */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function metaKey(t: { database: string; schema: string; table: string }): string {
  return `${t.database}\u0000${t.schema}\u0000${t.table}`;
}

export function outputName(table: string, suffix: string): string {
  return `${table}${suffix}`;
}

function checkName(value: string, label: string): void {
  if (!value || value.length > 255) throw new PlanError(`${label} is required.`);
}

function maskExpr(col: string, rule: MaskRule, dataType: string): string {
  const c = quoteIdent(col);
  switch (rule) {
    case 'keep':
      return c;
    case 'hash':
      return `SHA2(TO_VARCHAR(${c}), 256)`;
    case 'partial':
      return `CONCAT(REPEAT('*', GREATEST(LENGTH(${c}) - 4, 0)), RIGHT(${c}, 4))`;
    case 'email':
      return `REGEXP_REPLACE(${c}, '^[^@]+', '*****')`;
    case 'redact':
      return `IFF(${c} IS NULL, NULL, '[REDACTED]')`;
    case 'null': {
      const type = dataType.toUpperCase();
      if (!/^[A-Z_]+(\(\d+(,\d+)?\))?$/.test(type)) throw new PlanError(`Unsupported type for ${col}.`);
      return `CAST(NULL AS ${type})`;
    }
    case 'round':
      return `ROUND(${c}, -1)`;
    case 'month':
      return `DATE_TRUNC('MONTH', ${c})`;
    case 'year':
      return `DATE_TRUNC('YEAR', ${c})`;
  }
}

function checkText(value: string, label: string, max: number): void {
  if (value.includes('$$')) throw new PlanError(`${label} cannot contain "$$".`);
  if (value.length > max) throw new PlanError(`${label} is longer than ${max} characters.`);
}

export function buildPlan(spec: PrepSpec, meta: Map<string, TableMeta>): Step[] {
  const { target, share } = spec;
  if (spec.tables.length === 0) throw new PlanError('Select at least one table.');
  checkName(target.database, 'Target database');
  checkName(target.schema, 'Target schema');
  if (!/^[A-Za-z0-9_]{0,40}$/.test(target.suffix)) throw new PlanError('Suffix may only use letters, digits and _.');

  const steps: Step[] = [];
  const create = target.replace ? 'CREATE OR REPLACE' : 'CREATE';
  const tgtDb = quoteIdent(target.database);
  const tgtSchema = `${tgtDb}.${quoteIdent(target.schema)}`;

  if (target.createDatabase) {
    steps.push({ id: 'db', phase: 'target', title: `Create database ${target.database}`, sql: `CREATE DATABASE IF NOT EXISTS ${tgtDb}` });
  }
  if (target.createSchema || target.createDatabase) {
    steps.push({ id: 'schema', phase: 'target', title: `Create schema ${target.schema}`, sql: `CREATE SCHEMA IF NOT EXISTS ${tgtSchema}` });
  }

  const outputs: string[] = [];
  const seen = new Set<string>();
  const synthetic: { input: string; output: string; joinKeys: string[] }[] = [];
  const tempViews: string[] = [];

  spec.tables.forEach((t, i) => {
    const m = meta.get(metaKey(t));
    if (!m) throw new PlanError(`${t.database}.${t.schema}.${t.table} was not found or is not visible to your role.`);
    if (t.columns.length === 0) throw new PlanError(`Pick at least one column in ${t.table}.`);
    const types = new Map(m.columns.map((c) => [c.name, c.dataType]));
    for (const c of t.columns) {
      if (!types.has(c.name)) throw new PlanError(`Column ${c.name} is not in ${t.table}.`);
    }

    const outName = outputName(t.table, target.suffix);
    const out = fqn(target.database, target.schema, outName);
    if (seen.has(out)) throw new PlanError(`Two tables would both write ${outName}. Add a suffix.`);
    seen.add(out);
    const src = fqn(t.database, t.schema, t.table);
    if (src === out) throw new PlanError(`${t.table} would overwrite its own source. Pick another target or add a suffix.`);
    outputs.push(outName);

    const subset = t.columns.length < m.columns.length;
    const colList = t.columns.map((c) => quoteIdent(c.name)).join(', ');

    if (spec.method === 'clone') {
      if (m.kind === 'view') {
        steps.push({ id: `t${i}`, phase: 'data', title: `Copy view ${t.table} (views cannot be cloned)`, sql: `${create} TABLE ${out} AS\nSELECT ${colList}\nFROM ${src}` });
        return;
      }
      steps.push({ id: `t${i}`, phase: 'data', title: `Zero-copy clone ${t.table}`, sql: `${create} TABLE ${out} CLONE ${src}` });
      if (subset) {
        const included = new Set(t.columns.map((c) => c.name));
        const dropped = m.columns.filter((c) => !included.has(c.name)).map((c) => quoteIdent(c.name));
        steps.push({ id: `t${i}-drop`, phase: 'data', title: `Drop ${dropped.length} excluded column${dropped.length === 1 ? '' : 's'} from the clone`, sql: `ALTER TABLE ${out} DROP COLUMN ${dropped.join(', ')}` });
      }
      return;
    }

    if (spec.method === 'mask') {
      const exprs = t.columns.map((c) => {
        const type = types.get(c.name)!;
        if (!RULES_BY_FAMILY[typeFamily(type)].includes(c.rule)) throw new PlanError(`${RULE_LABELS[c.rule]} does not apply to ${c.name} (${type}).`);
        const e = maskExpr(c.name, c.rule, type);
        return c.rule === 'keep' ? `  ${e}` : `  ${e} AS ${quoteIdent(c.name)}`;
      });
      steps.push({ id: `t${i}`, phase: 'data', title: `Masked copy of ${t.table}`, sql: `${create} TABLE ${out} AS\nSELECT\n${exprs.join(',\n')}\nFROM ${src}` });
      return;
    }

    // synthetic: a subset of columns goes through a temporary view in the target schema.
    let input = `${t.database}.${t.schema}.${t.table}`;
    let inputQuoted = src;
    if (subset) {
      const view = `${outName}__SYNSRC`;
      inputQuoted = fqn(target.database, target.schema, view);
      input = inputQuoted;
      steps.push({ id: `t${i}-view`, phase: 'data', title: `Stage ${t.columns.length} selected columns of ${t.table}`, sql: `CREATE OR REPLACE VIEW ${inputQuoted} AS\nSELECT ${colList}\nFROM ${src}` });
      tempViews.push(inputQuoted);
    } else {
      input = src;
    }
    synthetic.push({ input, output: out, joinKeys: t.columns.filter((c) => c.joinKey).map((c) => c.name) });
  });

  for (let b = 0; b < synthetic.length; b += MAX_SYNTHETIC_PER_CALL) {
    const batch = synthetic.slice(b, b + MAX_SYNTHETIC_PER_CALL);
    const datasets = batch.map((d) => {
      const cols = d.joinKeys.length
        ? `,\n      'columns': {${d.joinKeys.map((k) => `${sqlString(k)}: {'join_key': TRUE}`).join(', ')}}`
        : '';
      return `    {\n      'input_table': ${sqlString(d.input)},\n      'output_table': ${sqlString(d.output)}${cols}\n    }`;
    });
    steps.push({
      id: `syn${b / MAX_SYNTHETIC_PER_CALL}`,
      phase: 'data',
      title: `Generate synthetic data for ${batch.length} table${batch.length === 1 ? '' : 's'}`,
      sql: `CALL SNOWFLAKE.DATA_PRIVACY.GENERATE_SYNTHETIC_DATA({\n  'datasets': [\n${datasets.join(',\n')}\n  ],\n  'similarity_filter': ${spec.similarityFilter ? 'TRUE' : 'FALSE'},\n  'replace_output_tables': ${target.replace ? 'TRUE' : 'FALSE'}\n})`,
    });
  }
  tempViews.forEach((v, i) => steps.push({ id: `drop-view${i}`, phase: 'cleanup', title: 'Remove staging view', sql: `DROP VIEW IF EXISTS ${v}` }));

  if (share.mode !== 'none') steps.push(...shareSteps(spec, outputs));
  return steps;
}

function shareSteps(spec: PrepSpec, outputs: string[]): Step[] {
  const { target, share } = spec;
  if (!SIMPLE_NAME.test(share.shareName)) throw new PlanError('Share name must start with a letter and use only letters, digits and _.');
  const accountPattern = share.mode === 'org_listing' ? ACCOUNT_NAME : ORG_ACCOUNT;
  for (const a of share.accounts) {
    if (!accountPattern.test(a)) {
      throw new PlanError(share.mode === 'org_listing' ? `"${a}" is not an account name.` : `"${a}" must be ORG_NAME.ACCOUNT_NAME.`);
    }
  }
  const s = share.shareName.toUpperCase();
  const tgtDb = quoteIdent(target.database);
  const tgtSchema = `${tgtDb}.${quoteIdent(target.schema)}`;
  const steps: Step[] = [
    { id: 'share', phase: 'share', title: `Create share ${s}`, sql: `CREATE SHARE IF NOT EXISTS ${s}` },
    {
      id: 'share-grants',
      phase: 'share',
      title: `Grant ${outputs.length} table${outputs.length === 1 ? '' : 's'} to the share`,
      sql: [
        `GRANT USAGE ON DATABASE ${tgtDb} TO SHARE ${s}`,
        `GRANT USAGE ON SCHEMA ${tgtSchema} TO SHARE ${s}`,
        ...outputs.map((o) => `GRANT SELECT ON TABLE ${fqn(target.database, target.schema, o)} TO SHARE ${s}`),
      ].join(';\n'),
    },
  ];

  if (share.mode === 'share') {
    if (share.accounts.length) {
      steps.push({ id: 'share-accounts', phase: 'share', title: `Add ${share.accounts.length} consumer account${share.accounts.length === 1 ? '' : 's'}`, sql: `ALTER SHARE ${s} ADD ACCOUNTS = ${share.accounts.map((a) => a.toUpperCase()).join(', ')}` });
    }
    return steps;
  }

  if (!SIMPLE_NAME.test(share.listingName)) throw new PlanError('Listing name must start with a letter and use only letters, digits and _.');
  if (!share.title.trim()) throw new PlanError('Listing title is required.');
  checkText(share.title, 'Listing title', 110);
  checkText(share.description, 'Listing description', 7500);
  const l = share.listingName.toUpperCase();
  const refresh = Math.max(10, Math.min(11520, Math.round(share.refreshMinutes || 10)));
  const autoFulfillment = share.autoFulfill
    ? `\nauto_fulfillment:\n  refresh_type: SUB_DATABASE\n  refresh_schedule: "${refresh} MINUTE"`
    : '';

  if (share.mode === 'private_listing') {
    if (share.accounts.length === 0) throw new PlanError('A private listing needs at least one consumer account.');
    const yaml = [
      `title: ${yamlString(share.title)}`,
      `description: ${yamlString(share.description || share.title)}`,
      'listing_terms:\n  type: "OFFLINE"',
      `targets:\n  accounts: [${share.accounts.map((a) => yamlString(a.toUpperCase())).join(', ')}]`,
    ].join('\n') + autoFulfillment;
    const flags = share.publish ? 'PUBLISH = TRUE REVIEW = TRUE' : 'PUBLISH = FALSE REVIEW = FALSE';
    steps.push({ id: 'listing', phase: 'share', title: `${share.publish ? 'Publish' : 'Draft'} private listing ${l}`, sql: `CREATE EXTERNAL LISTING IF NOT EXISTS ${l}\nSHARE ${s} AS\n$$\n${yaml}\n$$ ${flags}` });
    return steps;
  }

  // org_listing (Internal Marketplace)
  if (!share.orgAllAccounts && share.accounts.length === 0) throw new PlanError('Pick target accounts or allow all internal accounts.');
  if (share.supportContact && !EMAIL.test(share.supportContact)) throw new PlanError('Support contact must be an email address.');
  const access = share.orgAllAccounts
    ? '  access:\n    - all_internal_accounts: true'
    : `  access:\n${share.accounts.map((a) => `    - account: ${yamlString(a.toUpperCase())}`).join('\n')}`;
  const yaml = [
    `title: ${yamlString(share.title)}`,
    `description: ${yamlString(share.description || share.title)}`,
    'organization_profile: "INTERNAL"',
    `organization_targets:\n${access}`,
    ...(share.supportContact ? [`support_contact: ${yamlString(share.supportContact)}`] : []),
  ].join('\n') + autoFulfillment;
  steps.push({ id: 'listing', phase: 'share', title: `${share.publish ? 'Publish' : 'Draft'} organization listing ${l}`, sql: `CREATE ORGANIZATION LISTING IF NOT EXISTS ${l}\nSHARE ${s} AS\n$$\n${yaml}\n$$ PUBLISH = ${share.publish ? 'TRUE' : 'FALSE'}` });
  return steps;
}

/** Splits a step into statements: share grants are several statements in one step. */
export function statementsOf(step: Step): string[] {
  return step.id === 'share-grants' ? step.sql.split(';\n') : [step.sql];
}
