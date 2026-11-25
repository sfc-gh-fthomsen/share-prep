import { friendlyError, loadSpecMeta } from '@/lib/catalog';
import { buildPlan, PlanError, statementsOf, type StepResult } from '@/lib/plan';
import { withCaller } from '@/lib/run-as';
import { parseSpec } from '@/lib/spec';

export const dynamic = 'force-dynamic';
// Synthetic data generation can take several minutes.
export const maxDuration = 900;

/**
 * POST /api/execute — rebuilds the plan from the spec (never runs client SQL) and
 * runs each step in order as the signed-in user. Stops at the first failure.
 */
export async function POST(request: Request) {
  try {
    const spec = parseSpec(await request.json());
    const data = await withCaller(async (client) => {
      const steps = buildPlan(spec, await loadSpecMeta(client, spec));
      const results: StepResult[] = [];
      let failed = false;
      for (const step of steps) {
        if (failed) {
          results.push({ id: step.id, status: 'skipped' });
          continue;
        }
        const started = Date.now();
        try {
          let last: { rows: Record<string, unknown>[]; queryId?: string } = { rows: [] };
          for (const sql of statementsOf(step)) last = await client.query(sql);
          results.push({
            id: step.id,
            status: 'ok',
            ms: Date.now() - started,
            queryId: last.queryId,
            preview: step.id.startsWith('syn') ? last.rows.slice(0, 6) : undefined,
          });
        } catch (e) {
          console.error(new Date().toISOString(), `[execute] step ${step.id} failed`, e);
          const { message, code } = friendlyError(e);
          results.push({ id: step.id, status: 'failed', ms: Date.now() - started, error: message, code });
          failed = true;
        }
      }
      return { steps, results };
    });
    return Response.json(data);
  } catch (e) {
    if (e instanceof PlanError) return Response.json({ error: e.message }, { status: 400 });
    console.error(new Date().toISOString(), '[execute] failed', e);
    const { message, code } = friendlyError(e);
    return Response.json({ error: message, code }, { status: 500 });
  }
}
