// Fix #10: NextAuth has been removed from SEMS. This file is retained as a stub
// to prevent import errors in case any remaining code references it.
// All authentication is now handled via the custom SEMS auth flow
// (localStorage token + signed cookie via /api/auth/set-cookie).

// Fix #4: Validate NEXTAUTH_SECRET at module load (even though NextAuth is removed,
// this serves as a general secret-check pattern for future use).
if (!process.env.NEXTAUTH_SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('CRITICAL: NEXTAUTH_SECRET not set — add it to .env for production security');
}
