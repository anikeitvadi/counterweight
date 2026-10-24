/**
 * Same-origin relay for OKX's statistics endpoints (`/api/v5/rubik/...`), which
 * reject cross-origin browser requests. Reached via the rewrite in vercel.json:
 * /api/okx/<path>?<query>  ->  /api/okx-relay?path=<path>&<query>.
 * Only the rubik/stat prefix is forwarded, so this is not an open proxy.
 */
const UPSTREAM = 'https://www.okx.com/api/v5/';
const ALLOWED_PREFIX = 'rubik/stat/';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') ?? '';
  url.searchParams.delete('path');
  if (!path.startsWith(ALLOWED_PREFIX) || path.includes('..')) {
    return new Response(JSON.stringify({ code: '403', msg: 'path not allowed', data: [] }), { status: 403, headers: { 'content-type': 'application/json' } });
  }
  const qs = url.searchParams.toString();
  const upstream = await fetch(`${UPSTREAM}${path}${qs ? `?${qs}` : ''}`, { headers: { accept: 'application/json' } });
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
