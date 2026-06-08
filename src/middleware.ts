import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// P2-COOKIE-01: Read COOKIE_SECRET from environment.
// If not set, auth verification is skipped (development mode fallback).
const COOKIE_SECRET = process.env.COOKIE_SECRET || '';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verify the signed auth cookie using Web Crypto API (Edge Runtime compatible).
 * Cookie format: base64(username:timestamp:HMAC-SHA256-hex)
 */
async function verifyAuthCookie(cookieValue: string): Promise<boolean> {
  try {
    // If no COOKIE_SECRET configured, skip verification (dev mode)
    if (!COOKIE_SECRET) return true;

    const decoded = atob(cookieValue);
    const parts = decoded.split(':');

    // Expected: username:timestamp:signature
    if (parts.length < 3) {
      return false;
    }

    const username = parts.slice(0, -2).join(':'); // username may contain ':'
    const timestamp = parts[parts.length - 2];
    const signature = parts[parts.length - 1];

    // Check timestamp freshness (24h max age)
    const age = Date.now() - parseInt(timestamp, 10);
    if (isNaN(age) || age > COOKIE_MAX_AGE_MS || age < 0) {
      return false;
    }

    // Verify HMAC signature using Web Crypto API
    const payload = `${username}:${timestamp}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(COOKIE_SECRET);
    const msgData = encoder.encode(payload);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const sigBuffer = await crypto.subtle.sign('HMAC', key, msgData);
    const expectedSig = Array.from(new Uint8Array(sigBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Timing-safe comparison: compare lengths first, then hex strings
    if (signature.length !== expectedSig.length) {
      return false;
    }

    // Constant-time string comparison
    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    return result === 0;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  // P2-MW-01: Normalize pathname to prevent bypass tricks
  const pathname = request.nextUrl.pathname.replace(/\/+/g, '/').replace(/%2f/gi, '/');

  // Protect all dashboard routes from unauthenticated access
  if (pathname.startsWith('/dashboard')) {
    const semsAuth = request.cookies.get('sems-auth');

    if (!semsAuth?.value) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }

    if (!(await verifyAuthCookie(semsAuth.value))) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // P2-MW-01: Also protect API routes with auth cookie check
  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith('/api/debug')) {
      return NextResponse.next();
    }
    if (pathname.startsWith('/api/sems') || pathname.startsWith('/api/auth/set-cookie')) {
      const semsAuth = request.cookies.get('sems-auth');
      // For /api/auth/set-cookie, allow without cookie (it sets it)
      if (pathname === '/api/auth/set-cookie') {
        return NextResponse.next();
      }
      // T3-FE-001: Allow login POST without cookie
      if (pathname === '/api/sems') {
        const pathParam = new URL(request.url).searchParams.get('path');
        if (pathParam === 'api/users/auth') {
          return NextResponse.next();
        }
      }
      // For /api/sems, require auth cookie
      if (!semsAuth?.value) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }
      if (!(await verifyAuthCookie(semsAuth.value))) {
        return NextResponse.json(
          { success: false, error: 'Invalid or expired authentication' },
          { status: 401 }
        );
      }
    }
  }

  return NextResponse.next();
}

// P2-MW-01: Add /api/(.*) to matcher for API route protection
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/(.*)',
  ],
};
