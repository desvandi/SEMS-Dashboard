/**
 * gas-fetch.ts — GAS-aware fetch wrapper
 * =========================================
 * Handles Google Apps Script 302 redirects that strip custom headers.
 *
 * GAS Web Apps redirect from script.google.com to script.googleusercontent.com,
 * which causes custom headers (X-Auth-Token, X-Device-Token) to be lost.
 *
 * Solution: The proxy (route.ts) passes auth tokens as BOTH a header AND a
 * query parameter. Headers are preferred (no token in URLs/logs) but the query
 * param fallback ensures the token survives the 302 redirect. The backend
 * (Code.gs getHeaders_) reads headers first, then falls back to query params.
 */

export interface GasFetchOptions extends RequestInit {
  timeout?: number;
}

export async function gasFetch(url: string, options: GasFetchOptions = {}): Promise<Response> {
  const { timeout = 15000, headers: customHeaders, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: customHeaders,
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
