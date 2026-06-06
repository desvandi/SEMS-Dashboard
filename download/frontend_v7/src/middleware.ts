import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';

// P2-COOKIE-01: Require COOKIE_SECRET from environment
const COOKIE_SECRET = (() => {
  if (!process.env.COOKIE_SECRET) throw new Error('COOKIE_SECRET environment variable is required');
  return process.env.COOKIE_SECRET;
})();
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fix #3: Verify the signed auth cookie instead of checking for the forgeable
 * "sems-auth=1" literal. The cookie now contains:
 *   base64(username:timestamp:HMAC-SHA256(username:timestamp, secret))
 *
 * Also removes the NextAuth session-token check (Fix #10).
 */
// FE-002 FIX: Extract HMAC verification to a reusable function for dashboard and API routes
function verifyAuthCookie(cookieValue: string): boolean {
  try {
    const decoded = Buffer.from(cookieValue, 'base64').toString('utf-8');
    const parts = decoded.split(':');

    // Expected: username:timestamp:signature
    if (parts.length < 3) {
      throw new Error('Invalid cookie format');
    }

    const username = parts.slice(0, -2).join(':'); // username may contain ':'
    const timestamp = parts[parts.length - 2];
    const signature = parts[parts.length - 1];

    // Check timestamp freshness (24h max age)
    const age = Date.now() - parseInt(timestamp, 10);
    if (isNaN(age) || age > COOKIE_MAX_AGE_MS || age < 0) {
      throw new Error('Cookie expired');
    }

    // Verify HMAC signature
    const payload = `${username}:${timestamp}`;
    const expectedSig = crypto
      .createHmac('sha256', COOKIE_SECRET)
      .update(payload)
      .digest('hex');

    // FE-006 FIX: Use timingSafeEqual instead of !== to prevent timing attacks
    const sigBuf = Buffer.from(signature, 'utf-8');
    const expectedBuf = Buffer.from(expectedSig, 'utf-8');
    if (sigBuf.length !== expectedBuf.length) {
      throw new Error('Invalid signature length');
    }
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      throw new Error('Invalid signature');
    }

    return true;
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  // P2-MW-01: Normalize pathname to prevent bypass tricks
  const pathname = request.nextUrl.pathname.replace(/\/+/g, '/').replace(/%2f/gi, '/');

  // Protect all dashboard routes from unauthenticated access
  if (pathname.startsWith('/dashboard')) {
    const semsAuth = request.cookies.get('sems-auth');

    if (!semsAuth?.value) {
      // P2-MW-03: Warn before redirect for debugging
      console.warn(`[SEMS middleware] No sems-auth cookie for ${pathname}`);
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // FE-002 FIX: Use extracted verifyAuthCookie function
    if (!verifyAuthCookie(semsAuth.value)) {
      // P2-MW-03: Warn before error redirect for debugging
      console.warn(`[SEMS middleware] Invalid/expired auth cookie for ${pathname}`);
      // Invalid or expired cookie — redirect to login
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // P2-MW-01: Also protect API routes with auth cookie check
  // The /api/* matcher ensures these routes are processed by middleware
  if (pathname.startsWith('/api/')) {
    // Only check auth on specific protected API routes (not login/auth)
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
          return NextResponse.next(); // Allow login without cookie
        }
      }
      // For /api/sems, require auth cookie
      if (!semsAuth?.value) {
        return NextResponse.json(
          { success: false, error: 'Authentication required' },
          { status: 401 }
        );
      }
      // FE-002 FIX: Also verify HMAC validity for API routes, not just cookie existence
      if (!verifyAuthCookie(semsAuth.value)) {
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
