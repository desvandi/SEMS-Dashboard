import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// P2-COOKIE-01: Read COOKIE_SECRET from environment (optional in dev)
const COOKIE_SECRET = process.env.COOKIE_SECRET || '';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Verify HMAC-SHA256 signature using Web Crypto API (Edge Runtime compatible).
 * Falls back to allowing all requests if COOKIE_SECRET is not set (dev mode).
 */
async function verifyHmacSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!secret) return true; // Dev mode: skip verification
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const expectedHex = Array.from(new Uint8Array(sigBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    // Timing-safe comparison
    if (expectedHex.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < expectedHex.length; i++) {
      result |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  } catch {
    return false;
  }
}

/**
 * Verify the signed auth cookie. Cookie value is:
 *   base64(username:timestamp:HMAC-SHA256(username:timestamp, secret))
 *
 * Uses Web Crypto API instead of Node.js crypto for Edge Runtime compatibility.
 */
export async function middleware(request: NextRequest) {
  // P2-MW-01: Normalize pathname to prevent bypass tricks
  const pathname = request.nextUrl.pathname.replace(/\/+/g, '/').replace(/%2f/gi, '/');

  // Protect all dashboard routes from unauthenticated access
  if (pathname.startsWith('/dashboard')) {
    const semsAuth = request.cookies.get('sems-auth');

    if (!semsAuth?.value) {
      console.warn(`[SEMS middleware] No sems-auth cookie for ${pathname}`);
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }

    try {
      const decoded = atob(semsAuth.value);
      const parts = decoded.split(':');

      // Expected: username:timestamp:signature
      if (parts.length < 3) {
        throw new Error('Invalid cookie format');
      }

      const username = parts.slice(0, -2).join(':');
      const timestamp = parts[parts.length - 2];
      const signature = parts[parts.length - 1];

      // Check timestamp freshness (24h max age)
      const age = Date.now() - parseInt(timestamp, 10);
      if (isNaN(age) || age > COOKIE_MAX_AGE_MS || age < 0) {
        throw new Error('Cookie expired');
      }

      // Verify HMAC signature using Web Crypto API
      const payload = `${username}:${timestamp}`;
      const valid = await verifyHmacSignature(payload, signature, COOKIE_SECRET);

      if (!valid) {
        throw new Error('Invalid signature');
      }

      // Signature valid — allow access
    } catch {
      console.warn(`[SEMS middleware] Invalid/expired auth cookie for ${pathname}`);
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // P2-MW-01: Also protect API routes with auth cookie check
  if (pathname.startsWith('/api/')) {
    if (pathname.startsWith('/api/sems') || pathname.startsWith('/api/auth/set-cookie')) {
      const semsAuth = request.cookies.get('sems-auth');
      // For /api/auth/set-cookie, allow without cookie (it sets it)
      if (pathname === '/api/auth/set-cookie') {
        return NextResponse.next();
      }
      // For /api/sems, allow public paths (login & change-password) without auth cookie
      // These endpoints handle their own authentication (via password verification)
      const { searchParams } = new URL(request.url);
      const semsPath = searchParams.get('path') || '';
      const publicSemsPaths = ['api/users/auth', 'api/users/change-password'];
      if (publicSemsPaths.includes(semsPath)) {
        return NextResponse.next();
      }
      // For all other /api/sems paths, require auth cookie
      if (!semsAuth?.value) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/(.*)',
  ],
};
