import { NextRequest, NextResponse } from 'next/server';
import { gasFetch } from '@/lib/gas-fetch';

// FE-L-09: GAS_URL is available server-side only; client uses the proxy at /api/sems
const GAS_URL = process.env.GAS_SCRIPT_URL;

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

  // FE-M-06: Add 15s timeout to prevent hanging requests
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');

    const gasUrl = new URL(GAS_URL);

    let body: string | null = null;
    const headers: Record<string, string> = {};

    const authToken = request.headers.get('X-Auth-Token');

    if (method === 'POST') {
      const clonedBody = await request.json();
      clonedBody.path = path;
      body = JSON.stringify(clonedBody);
      if (path) gasUrl.searchParams.set('path', path);
    } else {
      if (path) gasUrl.searchParams.set('path', path);
      for (const [key, value] of searchParams.entries()) {
        if (key !== 'path' && key !== 'XTransformPort' && ['page', 'limit', 'offset', 'status'].includes(key)) {
          gasUrl.searchParams.set(key, value);
        }
      }
    }

    // GAS Web Apps perform a 302 redirect from script.google.com to
    // script.googleusercontent.com, which strips custom headers.
    // To survive the redirect, we pass the token as BOTH a header and a query param.
    // The backend reads headers first, then falls back to the query param.
    if (authToken) {
      headers['X-Auth-Token'] = authToken;
      gasUrl.searchParams.set('token', authToken);
    }
    headers['Content-Type'] = 'application/json';

    // Use gasFetch to correctly handle GAS 302 redirects for all requests
    const response = await gasFetch(gasUrl.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    return NextResponse.json(data, { status: response.ok ? 200 : response.status });
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
