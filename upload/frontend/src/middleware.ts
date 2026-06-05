import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect all dashboard routes from unauthenticated access
  if (pathname.startsWith('/dashboard')) {
    // Check for custom SEMS auth cookie (set by login page)
    // Also check NextAuth session cookie for backward compatibility during migration
    const semsAuth = request.cookies.get('sems-auth');
    const nextAuthSession = request.cookies.get('next-auth.session-token')
      || request.cookies.get('__Secure-next-auth.session-token');

    if (!semsAuth && !nextAuthSession) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
  ],
};
