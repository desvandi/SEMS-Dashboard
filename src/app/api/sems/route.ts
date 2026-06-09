import { NextRequest, NextResponse } from 'next/server';
import { gasFetch } from '@/lib/gas-fetch';
import { cookies } from 'next/headers';
import crypto from 'crypto';

// FE-L-09: GAS_URL is available server-side only; client uses the proxy at /api/sems
const GAS_URL = process.env.GAS_SCRIPT_URL;
// P2-COOKIE-01: Require COOKIE_SECRET from environment
const COOKIE_SECRET = (() => {
  if (!process.env.COOKIE_SECRET) throw new Error('COOKIE_SECRET environment variable is required');
  return process.env.COOKIE_SECRET;
})();

// P2-API-02: Known API path allowlist for proxy validation
const ALLOWED_PATHS: readonly string[] = [
  'api/telemetry/latest',
  'api/devices',
  'api/devices/control',
  'api/devices/rename',
  'api/alarms',
  'api/alarms/acknowledge',
  'api/rules',
  'api/rules/save',
  'api/rules/delete',
  'api/schedules',
  'api/schedules/save',
  'api/schedules/delete',
  'api/users',
  'api/users/create',
  'api/users/update',
  'api/users/auth',
  'api/users/change-password',
  'api/config',
  'api/config/update',
  'api/config/set',
  'api/telemetry/history',
  'api/battery-health',
  'api/load-shedding',
  'api/notifications',
];

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET');
}

export async function POST(request: NextRequest) {
  return handleRequest(request, 'POST');
}

async function handleRequest(request: NextRequest, method: string) {
  if (!GAS_URL) {
    return NextResponse.json(
      { success: false, error: 'GAS_SCRIPT_URL not configured' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  // P2-API-02: Validate path parameter against allowlist
  if (path && !ALLOWED_PATHS.includes(path)) {
    return NextResponse.json(
      { success: false, error: 'Unknown API path' },
      { status: 400 }
    );
  }
  // Block directory traversal
  if (path && (path.includes('..') || path.startsWith('/'))) {
    return NextResponse.json(
      { success: false, error: 'Invalid API path' },
      { status: 400 }
    );
  }

  // CSRF protection for POST requests (Fix #5)
  if (method === 'POST') {
    const csrfHeader = request.headers.get('X-CSRF-Token');
    const csrfCookie = (await cookies()).get('sems-csrf');

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie.value) {
      return NextResponse.json(
        { success: false, error: 'CSRF validation failed' },
        { status: 403 }
      );
    }
  }

  // FE-M-06: Add 15s timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const gasUrl = new URL(GAS_URL);

    let body: string | null = null;
    const headers: Record<string, string> = {};

    const authToken = request.headers.get('X-Auth-Token');

    // GAS 302 redirect workaround: Public POST endpoints that may arrive
    // as GET after GAS redirects script.google.com → script.googleusercontent.com.
    // For these paths, we also put payload fields into URL query params
    // so the GAS doGet handler can read them from e.parameter as a fallback.
    const PUBLIC_POST_PATHS = ['api/users/auth', 'api/users/change-password'];

    if (method === 'POST') {
      const clonedBody = await request.json();
      clonedBody.path = path;
      // FIX #1: Put token in request body instead of URL for POST requests.
      // This prevents the token from appearing in server logs, browser history,
      // and referrer headers.
      if (authToken) {
        clonedBody.token = authToken;
      }
      body = JSON.stringify(clonedBody);
      if (path) gasUrl.searchParams.set('path', path);

      // GAS 302 redirect fallback: embed POST body fields into URL params
      // for public endpoints. If GAS doPost processes the request, these
      // params are ignored (e.parameter is secondary to e.postData.contents).
      // If the 302 converts POST → GET, the params survive in the URL and
      // the GAS doGet handler can read them.
      if (path && PUBLIC_POST_PATHS.includes(path)) {
        for (const [key, value] of Object.entries(clonedBody)) {
          if (value !== undefined && value !== null && key !== 'path') {
            gasUrl.searchParams.set(key, String(value));
          }
        }
      }
    } else {
      if (path) gasUrl.searchParams.set('path', path);
      for (const [key, value] of searchParams.entries()) {
        if (key !== 'path' && key !== 'XTransformPort' && ['page', 'limit', 'offset', 'status'].includes(key)) {
          // P2-API-03: Validate and clamp limit/offset params
          if (key === 'limit') {
            const clamped = Math.min(parseInt(value, 10) || 0, 1000);
            gasUrl.searchParams.set(key, String(clamped));
          } else if (key === 'offset') {
            const clamped = Math.min(parseInt(value, 10) || 0, 10000);
            gasUrl.searchParams.set(key, String(clamped));
          } else {
            gasUrl.searchParams.set(key, value);
          }
        }
      }
    }

    // FIX #1: Auth token is sent ONLY via headers (never in URL query params).
    // For GET requests, the GAS 302 redirect to script.googleusercontent.com
    // strips custom headers. This is an accepted limitation.
    //
    // MITIGATION: Restrict GAS Web App access to server IP(s) via GAS deploy
    // settings or Google Cloud IAP, so the URL without a token header cannot
    // be replayed from arbitrary locations.
    if (authToken) {
      headers['X-Auth-Token'] = authToken;
      // NO: gasUrl.searchParams.set('token', authToken) — removed for security
    }
    headers['Content-Type'] = 'application/json';

    // P2-CSRF-01: Generate and set CSRF token cookie if not present.
    // P2-CSRF-02: After successful CSRF validation, generate new token.
    const cookieStore = await cookies();
    const existingCsrf = cookieStore.get('sems-csrf');
    let newCsrfToken: string | null = null;

    if (method === 'POST' && existingCsrf) {
      // P2-CSRF-02: Rotate CSRF token after successful validation
      newCsrfToken = crypto.randomBytes(32).toString('hex');
      cookieStore.set('sems-csrf', newCsrfToken, {
        path: '/',
        // P2-CSRF-01: NOT httpOnly so client-side JS can read it for Double Submit pattern
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 86400,
      });
    } else if (!existingCsrf) {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      cookieStore.set('sems-csrf', csrfToken, {
        path: '/',
        // P2-CSRF-01: NOT httpOnly so client-side JS can read it for Double Submit pattern
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 86400,
      });
    }

    // Use gasFetch to correctly handle GAS 302 redirects for all requests
    const response = await gasFetch(gasUrl.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    // P2-CSRF-02: Return new CSRF token in header after successful POST
    const responseHeaders: HeadersInit = { status: response.ok ? 200 : response.status };
    if (method === 'POST' && newCsrfToken) {
      (responseHeaders as Record<string, string>)['X-New-CSRF-Token'] = newCsrfToken;
    }
    return NextResponse.json(data, responseHeaders);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: 'Backend request timed out' },
        { status: 504 }
      );
    }
    // FE-L-06: Log error server-side only, don't expose internal details
    console.error('SEMS API proxy error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { success: false, error: 'Failed to connect to backend service' },
      { status: 502 }
    );
  }
}
