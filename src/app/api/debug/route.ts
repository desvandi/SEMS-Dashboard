import { NextResponse } from 'next/server';
import { gasFetch } from '@/lib/gas-fetch';

const BUILD_VERSION = 'v4.0-' + new Date().toISOString().slice(0, 10);

/**
 * GET /api/debug — Diagnostic endpoint to test GAS backend connectivity.
 * Returns build version, env status, and a live GAS ping result.
 */
export async function GET() {
  const gasUrl = process.env.GAS_SCRIPT_URL;
  const hasSecret = !!process.env.COOKIE_SECRET;
  const cookieSecure = process.env.COOKIE_SECURE;

  const info: Record<string, string | boolean | number | object> = {
    build: BUILD_VERSION,
    node: process.version,
    gas_configured: !!gasUrl,
    gas_url_prefix: gasUrl ? gasUrl.substring(0, 50) + '...' : '(not set)',
    cookie_secret_set: hasSecret,
    cookie_secure: cookieSecure || '(not set)',
  };

  // Live test: ping GAS with a simple GET
  if (gasUrl) {
    try {
      const testUrl = new URL(gasUrl);
      testUrl.searchParams.set('path', 'api/config');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const start = Date.now();
      const response = await gasFetch(testUrl.toString(), {
        method: 'GET',
        signal: controller.signal,
      });
      const elapsed = Date.now() - start;
      clearTimeout(timeoutId);

      let body = '';
      try {
        body = await response.text();
      } catch {
        body = '(empty)';
      }

      info['gas_ping_status'] = response.status;
      info['gas_ping_time_ms'] = elapsed;
      info['gas_ping_body'] = body.substring(0, 500);
      info['gas_ok'] = response.ok;
    } catch (err) {
      info['gas_ping_error'] = err instanceof Error ? err.message : String(err);
      info['gas_ok'] = false;
    }
  }

  return NextResponse.json(info);
}
