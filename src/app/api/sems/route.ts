import { NextRequest, NextResponse } from 'next/server';
import { gasFetch } from '@/lib/gas-fetch';
import { cookies } from 'next/headers';
import crypto from 'crypto';

const GAS_URL = process.env.GAS_SCRIPT_URL;
const COOKIE_SECRET = process.env.COOKIE_SECRET || '';

if (GAS_URL) {
  console.log('[SEMS API] GAS configured:', GAS_URL.substring(0, 60) + '...');
} else {
  console.warn('[SEMS API] GAS_SCRIPT_URL not set — all API calls will fail with 500');
}

const ALLOWED_PATHS: readonly string[] = [
  'api/telemetry/latest', 'api/devices', 'api/devices/control', 'api/devices/rename',
  'api/alarms', 'api/alarms/acknowledge', 'api/rules', 'api/rules/save', 'api/rules/delete',
  'api/schedules', 'api/schedules/save', 'api/schedules/delete',
  'api/users', 'api/users/create', 'api/users/update', 'api/users/auth',
  'api/config', 'api/config/update', 'api/config/set',
  'api/telemetry/history', 'api/battery-health', 'api/load-shedding', 'api/notifications',
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
      { success: false, error: 'Backend not configured. Contact administrator.' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const path = searchParams.get('path');

  if (path && !ALLOWED_PATHS.includes(path)) {
    return NextResponse.json({ success: false, error: 'Unknown API path' }, { status: 400 });
  }
  if (path && (path.includes('..') || path.startsWith('/'))) {
    return NextResponse.json({ success: false, error: 'Invalid API path' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const gasUrl = new URL(GAS_URL);
    let body: string | null = null;
    const headers: Record<string, string> = {};

    const authToken = request.headers.get('X-Auth-Token');

    if (method === 'POST') {
      const clonedBody = await request.json();
      if (path) clonedBody.path = path;
      if (authToken) clonedBody.token = authToken;
      body = JSON.stringify(clonedBody);

      // CRITICAL FIX: Also put POST body data into URL query params.
      // GAS Web Apps redirect POST→302→script.googleusercontent.com.
      // Even with manual redirect following, the POST body may be lost.
      // Adding to URL params ensures GAS reads data from e.parameter as fallback.
      if (path) gasUrl.searchParams.set('path', path);
      for (const [key, value] of Object.entries(clonedBody)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          gasUrl.searchParams.set(key, String(value));
        }
      }
      // For nested objects, stringify them
      for (const [key, value] of Object.entries(clonedBody)) {
        if (typeof value === 'object' && value !== null) {
          gasUrl.searchParams.set(key, JSON.stringify(value));
        }
      }
    } else {
      if (path) gasUrl.searchParams.set('path', path);
      for (const [key, value] of searchParams.entries()) {
        if (key !== 'path' && key !== 'XTransformPort' && ['page', 'limit', 'offset', 'status'].includes(key)) {
          if (key === 'limit') {
            gasUrl.searchParams.set(key, String(Math.min(parseInt(value, 10) || 0, 1000)));
          } else if (key === 'offset') {
            gasUrl.searchParams.set(key, String(Math.min(parseInt(value, 10) || 0, 10000)));
          } else {
            gasUrl.searchParams.set(key, value);
          }
        }
      }
    }

    if (authToken) headers['X-Auth-Token'] = authToken;
    headers['Content-Type'] = 'application/json';

    // Ensure CSRF cookie exists for future requests
    const cookieStore = await cookies();
    if (!cookieStore.get('sems-csrf')) {
      cookieStore.set('sems-csrf', crypto.randomBytes(32).toString('hex'), {
        path: '/',
        secure: process.env.COOKIE_SECURE !== 'false',
        sameSite: 'lax',
        maxAge: 86400,
      });
    }

    const fullGasUrl = gasUrl.toString();
    console.log(`[SEMS API] ${method} → GAS /${path || '(root)'} URL=${fullGasUrl.substring(0, 120)}`);

    const response = await gasFetch(fullGasUrl, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Read raw response text first for debugging
    let rawText = '';
    try {
      rawText = await response.text();
    } catch {
      rawText = '';
    }

    console.log(`[SEMS API] ${method} /${path || '(root)'} → GAS HTTP ${response.status} body=${rawText.substring(0, 300)}`);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { success: false, error: `GAS returned non-JSON (HTTP ${response.status}): ${rawText.substring(0, 200)}` };
    }

    return NextResponse.json(data, {
      status: response.ok ? 200 : response.status,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error('[SEMS API] Request timed out');
      return NextResponse.json({ success: false, error: 'Backend request timed out' }, { status: 504 });
    }
    console.error('[SEMS API] Proxy error:', error instanceof Error ? error.message : 'Unknown');
    return NextResponse.json({ success: false, error: 'Failed to connect to backend service: ' + (error instanceof Error ? error.message : 'Unknown') }, { status: 502 });
  }
}
