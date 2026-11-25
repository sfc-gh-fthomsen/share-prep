import { friendlyError } from '@/lib/catalog';
import { withCaller } from '@/lib/run-as';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await withCaller(async (client) => {
      const { rows } = await client.query<Record<string, string | null>>(
        `SELECT CURRENT_USER() AS "USER", CURRENT_ROLE() AS ROLE, CURRENT_WAREHOUSE() AS WAREHOUSE,
                CURRENT_ORGANIZATION_NAME() AS ORG, CURRENT_ACCOUNT_NAME() AS ACCOUNT, CURRENT_REGION() AS REGION`,
      );
      const r = rows[0] ?? {};
      return { user: r.USER, role: r.ROLE, warehouse: r.WAREHOUSE, org: r.ORG, account: r.ACCOUNT, region: r.REGION };
    });
    return Response.json(data);
  } catch (e) {
    console.error(new Date().toISOString(), '[context] failed', e);
    return Response.json(friendlyError(e), { status: 500 });
  }
}
