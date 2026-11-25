import { friendlyError, listDatabases, listSchemas, listTables, loadTableMeta } from '@/lib/catalog';
import { withCaller } from '@/lib/run-as';

export const dynamic = 'force-dynamic';

/** GET /api/catalog?db=&schema=&table= — the next level down from whatever is given. */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const db = p.get('db')?.slice(0, 255) ?? '';
  const schema = p.get('schema')?.slice(0, 255) ?? '';
  const table = p.get('table')?.slice(0, 255) ?? '';
  try {
    const data = await withCaller(async (client) => {
      if (db && schema && table) return { columns: (await loadTableMeta(client, db, schema, table))?.columns ?? [] };
      if (db && schema) return { tables: await listTables(client, db, schema) };
      if (db) return { schemas: await listSchemas(client, db) };
      return { databases: await listDatabases(client) };
    });
    return Response.json(data);
  } catch (e) {
    console.error(new Date().toISOString(), '[catalog] failed', { db, schema, table }, e);
    return Response.json(friendlyError(e), { status: 500 });
  }
}
