/** Liveness check for uptime monitors and the daily cron: verifies the OKX relay path upstream still answers. */
export async function GET(): Promise<Response> {
  const started = Date.now();
  let okx = 'unknown';
  try {
    const r = await fetch('https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=1', { headers: { accept: 'application/json' } });
    const body = (await r.json()) as { code?: string };
    okx = r.ok && body.code === '0' ? 'ok' : `bad (${r.status} ${body.code ?? ''})`;
  } catch (e) {
    okx = `error (${e instanceof Error ? e.message : String(e)})`;
  }
  const healthy = okx === 'ok';
  return new Response(JSON.stringify({ status: healthy ? 'ok' : 'degraded', okx, ms: Date.now() - started, at: new Date().toISOString() }), {
    status: healthy ? 200 : 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
