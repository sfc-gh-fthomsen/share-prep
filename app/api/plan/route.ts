import { friendlyError, loadSpecMeta } from '@/lib/catalog';
import { buildPlan, PlanError } from '@/lib/plan';
import { withCaller } from '@/lib/run-as';
import { parseSpec } from '@/lib/spec';

export const dynamic = 'force-dynamic';

/** POST /api/plan — preview the SQL steps for a spec without running anything. */
export async function POST(request: Request) {
  try {
    const spec = parseSpec(await request.json());
    const data = await withCaller(async (client) => ({ steps: buildPlan(spec, await loadSpecMeta(client, spec)) }));
    return Response.json(data);
  } catch (e) {
    if (e instanceof PlanError) return Response.json({ error: e.message }, { status: 400 });
    console.error(new Date().toISOString(), '[plan] failed', e);
    const { message, code } = friendlyError(e);
    return Response.json({ error: message, code }, { status: 500 });
  }
}
