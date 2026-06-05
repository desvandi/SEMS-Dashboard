import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

/**
 * SEMS Authentication Configuration
 * ====================================
 * Login flow:
 *   auth.ts (authorize) → POST to GAS directly with correct path
 *   GAS doPost → routePost_('api/users/auth') → handleUsersAuth_()
 *   → authenticateUser_() → hashPassword_() → compare with stored hash
 *
 * NOTE: Path MUST be 'api/users/auth' (with 'api/' prefix) to match
 * GAS routePost_() switch-case. Without the prefix, GAS returns 404.
 */
const GAS_URL = process.env.GAS_SCRIPT_URL;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'SEMS Login',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        if (!GAS_URL) {
          console.error('[SEMS Auth] GAS_SCRIPT_URL is not configured in environment variables');
          return null;
        }

        try {
          // POST directly to GAS Web App — same pattern used by all other
          // working endpoints (telemetry, device control, rules).
          // Path goes in BOTH query params AND handled by GAS doPost().
          const url = new URL(GAS_URL);
          url.searchParams.set('path', 'api/users/auth');

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 15000);

          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: credentials.username,
              password: credentials.password,
            }),
            signal: controller.signal,
            redirect: 'follow',
          });

          clearTimeout(timeoutId);

          const data = await res.json();

          if (data.success && data.token && data.user) {
            return {
              id: String(data.user.id),
              name: data.user.username,
              email: `${data.user.username}@sems.local`,
              role: data.user.role,
              token: data.token,
            };
          }

          // Server-side logging only — never exposed to client
          console.error('[SEMS Auth] Login failed for', credentials.username,
            '| GAS status:', res.status,
            '| Response:', JSON.stringify(data));
          return null;
        } catch (error) {
          console.error('[SEMS Auth] Exception during login:', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as Record<string, unknown>).role as string;
        token.semsToken = (user as Record<string, unknown>).token as string;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).role = token.role;
        (session.user as Record<string, unknown>).token = token.semsToken;
        (session.user as Record<string, unknown>).id = token.id;
      }
      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: '/login',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
