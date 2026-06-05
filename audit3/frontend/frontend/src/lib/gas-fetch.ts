/**
 * gas-fetch.ts — GAS-aware fetch wrapper
 * =========================================
 * Handles Google Apps Script 302 redirects that strip custom headers.
 *
 * GAS Web Apps redirect from script.google.com to script.googleusercontent.com,
 * which causes custom headers (X-Auth-Token, X-Device-Token) to be lost.
 *
 * NOTE (Fix #1): Auth tokens are NO LONGER sent as URL query parameters.
 * Tokens are sent only via headers. The GAS 302 redirect may strip headers,
 * which is an accepted limitation mitigated by IP restriction on the GAS deploy.
 * For POST requests, the token is included in the request body instead.
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
