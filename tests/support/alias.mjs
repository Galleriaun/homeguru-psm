/**
 * Lets a Node fixture import the REAL query modules from src/.
 *
 *  - '@/lib/supabase'       → the in-memory fake (the real one needs Vite env),
 *                             or the real supabase-js client against a local
 *                             server when HG_FIXTURE_CLIENT=wire
 *  - '@/lib/queries/trash'  → a stub (it imports browser-only code)
 *  - any other '@/x'        → src/x.ts
 *
 * Import this file BEFORE importing anything from src/. Needs Node 22.15+
 * (module.registerHooks, and TypeScript type stripping).
 */
import { registerHooks } from 'node:module';

if (typeof registerHooks !== 'function') {
  throw new Error('These fixtures need Node 22.15 or newer (module.registerHooks).');
}

const here = (relative) => new URL(relative, import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/lib/supabase') {
      // HG_FIXTURE_CLIENT=wire → the real supabase-js against a local server.
      const client = process.env.HG_FIXTURE_CLIENT === 'wire' ? './wireSupabase.mjs' : './fakeSupabase.mjs';
      return { url: here(client), shortCircuit: true };
    }
    if (specifier === '@/lib/queries/trash') {
      return { url: here('./stubTrash.mjs'), shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      return nextResolve(here(`../../src/${specifier.slice(2)}.ts`), context);
    }
    return nextResolve(specifier, context);
  },
});
