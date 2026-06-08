/**
 * gas-fetch.ts — GAS-aware fetch wrapper
 * =========================================
 * Handles Google Apps Script Web App requests.
 *
 * GAS Web Apps redirect from script.google.com → script.googleusercontent.com
 * via 302. This is NORMAL behavior — the doPost()/doGet() handler processes
 * the request BEFORE the redirect. The redirect simply delivers the response.
 *
 * Using `redirect: 'follow'` (default) is correct: the POST body is received
 * by GAS doPost(), then the 302 converts to GET on the client side to fetch
 * the response from script.googleusercontent.com.
 */

export interface GasFetchOptions extends RequestInit {
  timeout?: number;
}

export async function gasFetch(url: string, options: GasFetchOptions = {}): Promise<Response> {
  const { timeout = 20000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
