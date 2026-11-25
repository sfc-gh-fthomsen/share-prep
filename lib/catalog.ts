import { metaKey, quoteIdent, type PrepSpec, type TableMeta } from '@/lib/plan';
import type { SnowflakeQuery } from '@/lib/run-as';
import { isSarError } from '@snowflake/sar-sdk';

export interface TableRow {
  name: string;
  kind: 'table' | 'view';
  rows: string | null;
  bytes: string | null;
}

export async function listDatabases(client: SnowflakeQuery): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>('SHOW TERSE DATABASES');
  return rows.map((r) => r.name).sort((a, b) => a.localeCompare(b));
}

export async function listSchemas(client: SnowflakeQuery, db: string): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(`SHOW TERSE SCHEMAS IN DATABASE ${quoteIdent(db)}`);
  return rows.map((r) => r.name).filter((n) => n !== 'INFORMATION_SCHEMA').sort((a, b) => a.localeCompare(b));
}

export async function listTables(client: SnowflakeQuery, db: string, schema: string): Promise<TableRow[]> {
  const { rows } = await client.query<{ TABLE_NAME: string; TABLE_TYPE: string; ROW_COUNT: string | null; BYTES: string | null }>(
    `SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT, BYTES
     FROM ${quoteIdent(db)}.INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
     ORDER BY TABLE_NAME
     LIMIT 1000`,
    { binds: [schema] },
  );
  return rows.map((r) => ({
    name: r.TABLE_NAME,
    kind: r.TABLE_TYPE === 'BASE TABLE' ? 'table' : 'view',
    rows: r.ROW_COUNT,
    bytes: r.BYTES,
  }));
}

export async function loadTableMeta(client: SnowflakeQuery, db: string, schema: string, table: string): Promise<TableMeta | null> {
  const { rows } = await client.query<{ COLUMN_NAME: string; DATA_TYPE: string; TABLE_TYPE: string }>(
    `SELECT c.COLUMN_NAME, c.DATA_TYPE, t.TABLE_TYPE
     FROM ${quoteIdent(db)}.INFORMATION_SCHEMA.COLUMNS c
     JOIN ${quoteIdent(db)}.INFORMATION_SCHEMA.TABLES t
       ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
     WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
     ORDER BY c.ORDINAL_POSITION`,
    { binds: [schema, table] },
  );
  if (rows.length === 0) return null;
  return {
    kind: rows[0].TABLE_TYPE === 'BASE TABLE' ? 'table' : 'view',
    columns: rows.map((r) => ({ name: r.COLUMN_NAME, dataType: r.DATA_TYPE })),
  };
}

export async function loadSpecMeta(client: SnowflakeQuery, spec: PrepSpec): Promise<Map<string, TableMeta>> {
  const meta = new Map<string, TableMeta>();
  for (const t of spec.tables) {
    const m = await loadTableMeta(client, t.database, t.schema, t.table);
    if (m) meta.set(metaKey(t), m);
  }
  return meta;
}

/** Plain message for a failed query; Snowflake's own text stays in the server log. */
export function friendlyError(e: unknown): { message: string; code?: string } {
  const code = isSarError(e) ? e.details?.errorCode : undefined;
  const message =
    code === '002003' ? 'An object does not exist, or your role cannot see it.' :
    code === '003001' ? 'Your role does not have the privilege for this step.' :
    code === '002002' ? 'The object already exists. Turn on "Replace existing" to overwrite it.' :
    code === '000606' ? 'No active warehouse. Set a default warehouse for your user.' :
    code === '000904' ? 'A column could not be resolved.' :
    'The statement failed. Check the server log for details.';
  return { message, code };
}
