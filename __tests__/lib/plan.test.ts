import { describe, expect, it } from 'vitest';
import { buildPlan, metaKey, PlanError, type PrepSpec, type TableMeta } from '../../lib/plan';
import { parseSpec } from '../../lib/spec';

const META = new Map<string, TableMeta>([
  [
    metaKey({ database: 'SRC', schema: 'PUBLIC', table: 'CUSTOMERS' }),
    {
      kind: 'table',
      columns: [
        { name: 'ID', dataType: 'NUMBER' },
        { name: 'EMAIL', dataType: 'TEXT' },
        { name: 'BIRTH_DATE', dataType: 'DATE' },
        { name: 'NOTES', dataType: 'TEXT' },
      ],
    },
  ],
]);

function spec(overrides: Partial<PrepSpec> = {}): PrepSpec {
  return {
    method: 'mask',
    similarityFilter: false,
    tables: [
      {
        database: 'SRC',
        schema: 'PUBLIC',
        table: 'CUSTOMERS',
        columns: [
          { name: 'ID', rule: 'keep' },
          { name: 'EMAIL', rule: 'email' },
          { name: 'BIRTH_DATE', rule: 'year', joinKey: false },
        ],
      },
    ],
    target: { database: 'SHARED', schema: 'OUT', createDatabase: false, createSchema: true, suffix: '_M', replace: true },
    share: { mode: 'none', shareName: 'S1', accounts: [], listingName: 'L1', title: 'T', description: '', publish: false, autoFulfill: false, refreshMinutes: 60, orgAllAccounts: false, supportContact: '' },
    ...overrides,
  };
}

describe('buildPlan', () => {
  it('builds a masked CTAS with only included columns', () => {
    const steps = buildPlan(spec(), META);
    expect(steps.map((s) => s.id)).toEqual(['schema', 't0']);
    expect(steps[1].sql).toContain('CREATE OR REPLACE TABLE "SHARED"."OUT"."CUSTOMERS_M" AS');
    expect(steps[1].sql).toContain(`REGEXP_REPLACE("EMAIL", '^[^@]+', '*****') AS "EMAIL"`);
    expect(steps[1].sql).toContain(`DATE_TRUNC('YEAR', "BIRTH_DATE") AS "BIRTH_DATE"`);
    expect(steps[1].sql).not.toContain('NOTES');
  });

  it('clones and drops excluded columns', () => {
    const steps = buildPlan(spec({ method: 'clone' }), META);
    expect(steps[1].sql).toBe('CREATE OR REPLACE TABLE "SHARED"."OUT"."CUSTOMERS_M" CLONE "SRC"."PUBLIC"."CUSTOMERS"');
    expect(steps[2].sql).toBe('ALTER TABLE "SHARED"."OUT"."CUSTOMERS_M" DROP COLUMN "NOTES"');
  });

  it('stages a view for synthetic subsets and cleans it up', () => {
    const s = spec({ method: 'synthetic' });
    s.tables[0].columns[0].joinKey = true;
    const steps = buildPlan(s, META);
    expect(steps.map((x) => x.phase)).toEqual(['target', 'data', 'data', 'cleanup']);
    expect(steps[2].sql).toContain('SNOWFLAKE.DATA_PRIVACY.GENERATE_SYNTHETIC_DATA');
    expect(steps[2].sql).toContain(`'ID': {'join_key': TRUE}`);
    expect(steps[3].sql).toBe('DROP VIEW IF EXISTS "SHARED"."OUT"."CUSTOMERS_M__SYNSRC"');
  });

  it('rejects a rule that does not fit the column type', () => {
    const s = spec();
    s.tables[0].columns[0].rule = 'email';
    expect(() => buildPlan(s, META)).toThrow(PlanError);
  });

  it('rejects unknown columns and invisible tables', () => {
    const s = spec();
    s.tables[0].columns.push({ name: 'NOPE', rule: 'keep' });
    expect(() => buildPlan(s, META)).toThrow(/NOPE/);
    expect(() => buildPlan(spec(), new Map())).toThrow(/not found/);
  });

  it('quotes identifiers so names cannot break out', () => {
    const meta = new Map<string, TableMeta>([[metaKey({ database: 'SRC', schema: 'PUBLIC', table: 'A"B' }), { kind: 'table', columns: [{ name: 'X"; DROP', dataType: 'TEXT' }] }]]);
    const s = spec({ tables: [{ database: 'SRC', schema: 'PUBLIC', table: 'A"B', columns: [{ name: 'X"; DROP', rule: 'hash' }] }] });
    const sql = buildPlan(s, meta)[1].sql;
    expect(sql).toContain('"A""B_M"');
    expect(sql).toContain('SHA2(TO_VARCHAR("X""; DROP"), 256) AS "X""; DROP"');
  });

  it('adds share grants and consumer accounts', () => {
    const s = spec({ share: { ...spec().share, mode: 'share', accounts: ['myorg.acct1'] } });
    const steps = buildPlan(s, META);
    const ids = steps.map((x) => x.id);
    expect(ids).toEqual(['schema', 't0', 'share', 'share-grants', 'share-accounts']);
    expect(steps[3].sql).toContain('GRANT SELECT ON TABLE "SHARED"."OUT"."CUSTOMERS_M" TO SHARE S1');
    expect(steps[4].sql).toBe('ALTER SHARE S1 ADD ACCOUNTS = MYORG.ACCT1');
  });

  it('rejects malformed account identifiers', () => {
    const s = spec({ share: { ...spec().share, mode: 'share', accounts: ['acct; DROP'] } });
    expect(() => buildPlan(s, META)).toThrow(PlanError);
  });

  it('builds a draft private listing manifest', () => {
    const s = spec({ share: { ...spec().share, mode: 'private_listing', accounts: ['O.A'], title: 'Customer "masked"', autoFulfill: true, refreshMinutes: 5 } });
    const sql = buildPlan(s, META).at(-1)!.sql;
    expect(sql).toContain('CREATE EXTERNAL LISTING IF NOT EXISTS L1\nSHARE S1 AS\n$$');
    expect(sql).toContain('title: "Customer \\"masked\\""');
    expect(sql).toContain('accounts: ["O.A"]');
    expect(sql).toContain('refresh_schedule: "10 MINUTE"');
    expect(sql).toContain('PUBLISH = FALSE REVIEW = FALSE');
  });

  it('builds an organization listing for all internal accounts', () => {
    const s = spec({ share: { ...spec().share, mode: 'org_listing', orgAllAccounts: true, publish: true } });
    const sql = buildPlan(s, META).at(-1)!.sql;
    expect(sql).toContain('CREATE ORGANIZATION LISTING IF NOT EXISTS L1');
    expect(sql).toContain('- all_internal_accounts: true');
    expect(sql).toContain('PUBLISH = TRUE');
  });

  it('rejects $$ in listing text', () => {
    const s = spec({ share: { ...spec().share, mode: 'org_listing', orgAllAccounts: true, description: 'x $$ y' } });
    expect(() => buildPlan(s, META)).toThrow(/\$\$/);
  });
});

describe('parseSpec', () => {
  it('drops unknown values to safe defaults', () => {
    const s = parseSpec({ method: 'clone', tables: [{ database: 'D', schema: 'S', table: 'T', columns: [{ name: 'C', rule: 'evil' }] }], share: { mode: 'x' } });
    expect(s.tables[0].columns[0].rule).toBe('keep');
    expect(s.share.mode).toBe('none');
  });

  it('requires a known method', () => {
    expect(() => parseSpec({ method: 'drop' })).toThrow(PlanError);
  });
});
