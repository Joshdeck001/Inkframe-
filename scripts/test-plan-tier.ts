/**
 * Verifies PLAN_TIER's actual effect on per-invocation throughput without
 * needing a live Supabase connection — every department tick here is a
 * mock that just counts down a fake work queue. Run with:
 *   npm run test:plan-tier
 * (or `PLAN_TIER=pro npm run test:plan-tier` to see getPlanTier() pick it up)
 *
 * This proves the control-flow logic (free = 1 pass, pro = up to 8 passes,
 * early-stop when the queue empties or the time budget runs out). It does
 * NOT prove the real department functions work against a real database —
 * that needs an actual deployment, since this sandbox can't reach
 * Supabase's network at all.
 */
import { getPlanTier, maxPassesForTier } from "../lib/plan-tier";
import { runPlanTierTick, type DepartmentEntry } from "../lib/run-all-departments";

let failures = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    failures++;
    console.error(`  FAIL — ${message}`);
  }
}

// A mock department that "processes" one unit per call until `queue` runs
// out, then reports nothing left to do — same shape every real department
// tick already returns.
function makeMockDepartment(name: string, queue: { count: number }, delayMs = 0): DepartmentEntry {
  return {
    name,
    run: async () => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (queue.count > 0) {
        queue.count -= 1;
        return { processed: true, detail: `mock ${name}: 1 unit processed, ${queue.count} left` };
      }
      return { processed: false, detail: `mock ${name}: nothing to do` };
    },
  };
}

async function main() {
  console.log("1. getPlanTier() / maxPassesForTier() pure logic");
  const prevEnv = process.env.PLAN_TIER;
  process.env.PLAN_TIER = "pro";
  assert(getPlanTier() === "pro", 'PLAN_TIER=pro env var is read as "pro"');
  process.env.PLAN_TIER = "PRO"; // case-insensitivity
  assert(getPlanTier() === "pro", "PLAN_TIER is case-insensitive");
  process.env.PLAN_TIER = "free";
  assert(getPlanTier() === "free", 'PLAN_TIER=free env var is read as "free"');
  process.env.PLAN_TIER = "";
  assert(getPlanTier() === "free", "missing/empty PLAN_TIER defaults to free (Hobby-safe default)");
  process.env.PLAN_TIER = "something-invalid";
  assert(getPlanTier() === "free", "an unrecognized value falls back to free rather than erroring");
  process.env.PLAN_TIER = prevEnv;
  assert(maxPassesForTier("free") === 1, "free tier caps at 1 pass per invocation");
  assert(maxPassesForTier("pro") === 8, "pro tier caps at 8 passes per invocation");

  console.log("\n2. free tier: exactly 1 pass, even with plenty of queued work");
  {
    const queue = { count: 100 };
    const departments = [makeMockDepartment("mock-dept", queue)];
    const { passes } = await runPlanTierTick({} as never, { tier: "free", departments });
    assert(passes.length === 1, `ran exactly 1 pass (ran ${passes.length})`);
    assert(queue.count === 99, `1 unit of work was consumed (${100 - queue.count} consumed)`);
  }

  console.log("\n3. pro tier: runs up to 8 passes when work keeps being available");
  {
    const queue = { count: 100 };
    const departments = [makeMockDepartment("mock-dept", queue)];
    const { passes } = await runPlanTierTick({} as never, { tier: "pro", departments });
    assert(passes.length === 8, `ran the full 8-pass ceiling (ran ${passes.length})`);
    assert(queue.count === 92, `8 units of work were consumed (${100 - queue.count} consumed)`);
  }

  console.log("\n4. pro tier: stops early once the queue actually empties (doesn't force 8 passes)");
  {
    const queue = { count: 3 };
    const departments = [makeMockDepartment("mock-dept", queue)];
    const { passes } = await runPlanTierTick({} as never, { tier: "pro", departments });
    assert(passes.length === 4, `stopped at 4 passes: 3 that did work + 1 that found nothing left (ran ${passes.length})`);
    assert(queue.count === 0, "queue fully drained");
  }

  console.log("\n5. pro tier: respects the overall time budget even under the 8-pass ceiling");
  {
    const queue = { count: 100 };
    const departments = [makeMockDepartment("slow-mock-dept", queue, 30)];
    const { passes } = await runPlanTierTick({} as never, { tier: "pro", departments, overallBudgetMs: 65 });
    assert(passes.length >= 1 && passes.length < 8, `stopped early due to time budget (ran ${passes.length} passes, not the full 8)`);
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
