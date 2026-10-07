/** Minimal assertion helpers shared by the fixtures. */

export function createHarness(name) {
  let pass = 0;
  let fail = 0;

  const ok = (condition, label) => {
    if (condition) pass++;
    else {
      fail++;
      console.log(`FAIL  ${label}`);
    }
  };

  const eq = (actual, expected, label) =>
    ok(Object.is(actual, expected), `${label} — expected ${String(expected)}, got ${String(actual)}`);

  /** Asserts that `fn` rejects, optionally with a message matching `match`. */
  const rejects = async (fn, label, match) => {
    try {
      await fn();
    } catch (e) {
      const message = String(e && e.message);
      ok(!match || match.test(message), `${label} — unexpected message: ${message}`);
      return;
    }
    fail++;
    console.log(`FAIL  ${label} — did not throw`);
  };

  const done = () => {
    console.log(`${name}: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };

  return { ok, eq, rejects, done };
}

/** Deterministic UUID-shaped id that sorts by `n`. */
export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
