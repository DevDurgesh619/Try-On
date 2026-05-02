import { RestGeminiClient, handleGenerate, type GenerateDeps } from './generate';
import { KvRateLimitStore } from './ratelimit';

export interface Env {
  GEMINI_API_KEY?: string;
  RATE_LIMIT?: KVNamespace;
}

export async function handle(request: Request, env: Env, depsOverride?: Partial<GenerateDeps>): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json({ ok: true });
  }

  if (request.method === 'POST' && url.pathname === '/generate') {
    if (!env.GEMINI_API_KEY && !depsOverride?.gemini) {
      return Response.json(
        { ok: false, code: 'backend_error', message: 'GEMINI_API_KEY not configured' },
        { status: 500 },
      );
    }
    const deps: GenerateDeps = {
      gemini: depsOverride?.gemini ?? new RestGeminiClient(env.GEMINI_API_KEY ?? ''),
      store:
        depsOverride && 'store' in depsOverride
          ? (depsOverride.store ?? null)
          : env.RATE_LIMIT
            ? new KvRateLimitStore(env.RATE_LIMIT)
            : null,
      ...(depsOverride?.now ? { now: depsOverride.now } : {}),
      ...(depsOverride?.uuid ? { uuid: depsOverride.uuid } : {}),
      ...(depsOverride?.timeoutMs !== undefined ? { timeoutMs: depsOverride.timeoutMs } : {}),
    };
    return handleGenerate(request, env, deps);
  }

  return new Response('Not found', { status: 404 });
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
