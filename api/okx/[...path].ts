/**
 * Same-origin relay for OKX's statistics endpoints (`/api/v5/rubik/...`), which
 * reject cross-origin browser requests. Only that prefix is forwarded, so this
 * is not an open proxy. Deployed by Vercel as a Node function; in `vite dev`
 * the equivalent is the `/api/okx` proxy entry in vite.config.ts.
 */
const UPSTREAM = 'https://www.okx.com/api/v5/';
const ALLOWED_PREFIX = 'rubik/stat/';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/okx\//, '');
  if (!path.startsWith(ALLOWED_PREFIX)) {
    return new Response(JSON.stringify({ code: '403', msg: 'path not allowed', data: [] }), { status: 403, headers: { 'content-type': 'application/json' } });
  }
  const upstream = await fetch(`${UPSTREAM}${path}${url.search}`, { headers: { accept: 'application/json' } });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, s-maxage=30, stale-while-revalidate=60',
      'access-control-allow-origin': '*',
    },
  });
}
