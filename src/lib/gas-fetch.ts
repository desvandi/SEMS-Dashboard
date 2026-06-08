/**
 * gas-fetch.ts — GAS-aware fetch wrapper
 * =========================================
 * Handles Google Apps Script 302 redirects that strip POST bodies.
 *
 * GAS Web Apps redirect POST from script.google.com → script.googleusercontent.com.
 * Using `redirect: 'follow'` causes fetch to change POST to GET on 302, losing the body.
 * This wrapper manually follows redirects while preserving the POST method and body.
 */

export interface GasFetchOptions extends RequestInit {
  timeout?: number;
}

export async function gasFetch(url: string, options: GasFetchOptions = {}): Promise<Response> {
  const { timeout = 20000, headers: customHeaders, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    let currentUrl = url;
    let maxRedirects = 5;
    // Clone headers for each request
    let currentHeaders = customHeaders;
    // Preserve original body reference
    let currentBody = fetchOptions.body;
    // Preserve original method
    let currentMethod = fetchOptions.method;

    while (maxRedirects > 0) {
      const response = await fetch(currentUrl, {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        signal: controller.signal,
        redirect: 'manual',
      });

      // If not a redirect, return the response
      if (response.status !== 301 && response.status !== 302 && response.status !== 303 && response.status !== 307 && response.status !== 308) {
        clearTimeout(timeoutId);
        return response;
      }

      const location = response.headers.get('location');
      if (!location) {
        clearTimeout(timeoutId);
        return response;
      }

      // Consume the redirect response body to free resources
      await response.arrayBuffer().catch(() => {});

      // Resolve relative URLs
      currentUrl = new URL(location, currentUrl).toString();
      maxRedirects--;

      // HTTP spec: 303 always changes to GET
      if (response.status === 303) {
        currentMethod = 'GET';
        currentBody = undefined;
      }
      // 307/308 preserve method (POST stays POST)
      // 301/302 historically change POST to GET — but we preserve POST for GAS compatibility
      // GAS Web Apps need POST body to reach doPost handler
    }

    clearTimeout(timeoutId);
    throw new Error('Too many redirects from GAS');
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
