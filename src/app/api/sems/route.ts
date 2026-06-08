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
      // Set path in URL for GAS routing
      if (path) gasUrl.searchParams.set('path', path);
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

    console.log(`[SEMS API] ${method} → GAS /${path || '(root)'}`);

    const response = await gasFetch(gasUrl.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    let data;
    try {
      data = await response.json();
    } catch {
      const rawStatus = response.status;
      const statusText = response.statusText;
      data = { success: false, error: `GAS returned non-JSON (HTTP ${rawStatus} ${statusText})` };
    }

    const level = data.success ? 'log' : 'warn';
    console[level](`[SEMS API] ${method} /${path || '(root)'} → ${response.status}`, JSON.stringify(data).substring(0, 300));

    return NextResponse.json(data, {
      status: response.ok ? 200 : 502,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === 'AbortError') {
      console.error('[SEMS API] Request timed out');
      return NextResponse.json({ success: false, error: 'Backend request timed out' }, { status: 504 });
    }
    console.error('[SEMS API] Proxy error:', error instanceof Error ? error.message : 'Unknown');
    return NextResponse.json({ success: false, error: 'Failed to connect to backend service' }, { status: 502 });
  }
}
