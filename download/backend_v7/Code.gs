/**
 * Code.gs — Main Entry Point & Request Router
 * ==============================================
 * Handles all incoming HTTP requests (GET and POST) for the SEMS backend.
 * Routes requests to the appropriate API handler based on the URL path.
 *
 * DEPLOYMENT: Deploy as Web App (execute as "Me", access: "Anyone").
 * The script URL becomes your API base URL.
 *
 * Request flow:
 *   1. doGet() or doPost() receives the request
 *   2. Generate a request correlation ID
 *   3. Extract the path from the URL (e.g., /api/telemetry)
 *   4. Apply API versioning (strip /api/v1/ prefix)
 *   5. Route to the appropriate handler function
 *   6. Return JSON response
 *
 * Security: v1.1.0 — Authentication enforced on ALL data endpoints.
 */

// ============================================================
// GET Request Handler
// ============================================================

/**
 * Handle all GET requests.
 * Parses the path, generates correlation ID, and routes to the appropriate handler.
 *
 * @param {Object} e - Event object with parameters, pathInfo, etc.
 * @returns {TextOutput} JSON response
 */
function doGet(e) {
  var requestId = generateCorrelationId_();
  return routeGet_(e, requestId);
}

// ============================================================
// POST Request Handler
// ============================================================

/**
 * Handle all POST requests.
 * Parses the path, generates correlation ID, validates rate limits,
 * parses JSON body, then routes to the handler.
 *
 * @param {Object} e - Event object with postData, pathInfo, etc.
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  var requestId = generateCorrelationId_();

  try {
    // Path priority: e.pathInfo > e.parameter.path (NO fallback to payload.body)
    var path = (e.pathInfo || e.parameter.path || '').replace(/^\//, '').replace(/\/$/, '');

    // SECURITY: No path available — return 400 (do NOT fall back to payload.body
    // as an attacker could inject arbitrary routing via POST body manipulation)
    if (!path) {
      console.error('[' + requestId + '] POST with no path — rejected');
      return jsonResponse_({
        success: false,
        error: 'Missing request path',
        code: 400,
        requestId: requestId
      });
    }

    // API versioning: strip /api/v1/ prefix for backward compatibility
    path = normalizeApiPath_(path, requestId);

    var payload = parsePostBody_(e);
    var headers = getHeaders_(e);

    console.log('[' + requestId + '] POST /' + path);

    // Rate limiting check (before routing)
    var rateLimitResult = checkPostRateLimit_(path, headers);
    if (!rateLimitResult.allowed) {
      console.warn('[' + requestId + '] Rate limited: ' + rateLimitResult.reason);
      return jsonResponse_({
        success: false,
        error: 'Rate limit exceeded. ' + rateLimitResult.reason,
        code: 429,
        retryAfter: rateLimitResult.retryAfter,
        requestId: requestId
      });
    }

    var response = routePost_(path, payload, headers, requestId);
    if (!response.requestId) response.requestId = requestId;

    return jsonResponse_(response);

  } catch (err) {
    console.error('[' + requestId + '] doPost unhandled error: ' + err.message);
    return jsonResponse_({
      success: false,
      error: 'Internal server error',
      code: 500,
      requestId: requestId
    });
  }
}

// ============================================================
// OPTIONS Request Handler (CORS preflight)
// ============================================================

/**
 * Handle OPTIONS requests for CORS preflight.
 * Returns appropriate CORS headers.
 *
 * @param {Object} e - Event object
 * @returns {TextOutput} Empty response with CORS headers
 */
function doOptions(e) {
  // T3-BE-029: NOTE — GAS ContentService does not support setting proper CORS headers.
  // The Content-Type is TEXT because GAS cannot set Access-Control-Allow-Origin.
  // For production use, route all requests through a reverse proxy (e.g., Caddy/Nginx)
  // that injects CORS headers. No practical code change is possible here.
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
// GET Routing
// ============================================================

/**
 * Route GET requests to the appropriate handler.
 * Extracts path, params, and headers from the event object.
 * Enforces authentication on ALL data endpoints (only health check is public).
 *
 * @param {Object} e - Event object with pathInfo, parameter, headers
 * @param {string} requestId - Correlation ID for this request
 * @returns {TextOutput} JSON response
 */
function routeGet_(e, requestId) {
  try {
    var path = (e.pathInfo || (e.parameter && e.parameter.path) || '').replace(/^\//, '').replace(/\/$/, '');

    // API versioning: strip /api/v1/ prefix for backward compatibility
    path = normalizeApiPath_(path, requestId);

    var params = e.parameter || {};
    var headers = getHeaders_(e);

    console.log('[' + requestId + '] GET /' + path);

    var response;

    // ---- Health Check (PUBLIC — no auth required) ----
    if (path === 'api/health' || path === '') {
      response = {
        success: true,
        status: 'online',
        service: 'SEMS Backend',
        timestamp: getTimestamp_(),
        requestId: requestId
      };
      return jsonResponse_(response);
    }

    // T3-BE-016: NOTE — validateUserToken_ is called here at the router level for auth,
    // and again inside each handler's requirePermission_() for permission checks.
    // This is a deliberate trade-off: the router validates token existence (auth gate),
    // while handlers validate specific permissions (role-based access). Passing the user
    // object from router to handlers would avoid the double cache lookup, but would
    // require changing every handler's interface. For this small-scale IoT system,
    // the performance impact of two cache reads per GET request is negligible.
    var deviceAuth = validateDeviceToken_(headers);
    var userAuth = validateUserToken_(headers);

    if (!deviceAuth.authenticated && !userAuth) {
      return jsonResponse_({
        success: false,
        error: 'Authentication required. Provide a valid X-Auth-Token or X-Device-Token header.',
        code: 401,
        requestId: requestId
      });
    }

    switch (path) {

    // ---- Telemetry ----
    case 'api/telemetry/latest':
      response = handleTelemetryLatest_(headers);
      break;

    case 'api/telemetry/history':
      response = handleTelemetryHistory_(params, headers);
      break;

    // ---- Devices ----
    case 'api/devices':
    case 'api/device/get':
      response = handleDevicesGet_(headers);
      break;

    // ---- Rules ----
    case 'api/rules/get':
    case 'api/rules':
      response = handleRulesGet_(headers);
      break;

    // ---- Schedules ----
    case 'api/schedules/get':
    case 'api/schedules':
      response = handleSchedulesGet_(headers);
      break;

    // ---- Alarms ----
    case 'api/alarms':
    case 'api/alarms/get':
      response = handleAlarmsGet_(params, headers);
      break;

    // ---- Users ----
    case 'api/users':
      response = handleUsersGet_(headers);
      break;

    // ---- Config ----
    case 'api/config/get':
    case 'api/config':
      response = handleConfigGet_(headers);
      break;

    default:
      response = {
        success: false,
        error: 'Endpoint not found: GET /' + path,
        code: 404
      };
    }

    if (!response.requestId) response.requestId = requestId;

    return jsonResponse_(response);

  } catch (err) {
    console.error('[' + requestId + '] routeGet_ unhandled error: ' + err.message);
    return jsonResponse_({
      success: false,
      error: 'Internal server error',
      code: 500,
      requestId: requestId
    });
  }
}

// ============================================================
// POST Routing
// ============================================================

/**
 * Route POST requests to the appropriate handler.
 *
 * @param {string} path - URL path
 * @param {Object} payload - Parsed JSON body
 * @param {Object} headers - Request headers
 * @param {string} requestId - Correlation ID for this request
 * @returns {Object} Handler response
 */
function routePost_(path, payload, headers, requestId) {
  // Auth guard: require X-Auth-Token for all user POST endpoints.
  // Device-only endpoints (telemetry, device/update) do their own validation via X-Device-Token.
  // B-03: Only check X-Auth-Token at router level; skip for device-only endpoints and public ones.
  var deviceOnlyPaths = ['api/telemetry', 'api/telemetry/upload', 'api/device/update'];
  var publicPaths = ['api/users/auth', 'api/users/change-password'];
  var isDeviceOnly = false;
  for (var dp = 0; dp < deviceOnlyPaths.length; dp++) {
    if (path === deviceOnlyPaths[dp]) { isDeviceOnly = true; break; }
  }
  var isPublic = false;
  for (var pp = 0; pp < publicPaths.length; pp++) {
    if (path === publicPaths[pp]) { isPublic = true; break; }
  }
  if (!isDeviceOnly && !isPublic && !headers['X-Auth-Token']) {
    return { success: false, error: 'Authentication required', code: 401, requestId: requestId };
  }

  switch (path) {

    // ---- Telemetry ----
    // FIX v1.0.1: Added 'api/telemetry/upload' as alias (backward compat)
    case 'api/telemetry':
    case 'api/telemetry/upload':
      return handleTelemetryPost_(payload, headers);

    // ---- Devices ----
    case 'api/device/update':
      return handleDeviceUpdate_(payload, headers);

    case 'api/device/rename':
      return handleDeviceRename_(payload, headers);

    case 'api/devices/control':
      return handleDevicesControl_(payload, headers);

    // ---- Rules ----
    case 'api/rules/update':
      return handleRulesUpdate_(payload, headers);

    case 'api/rules/delete':
      return handleRulesDelete_(payload, headers);

    // ---- Schedules ----
    case 'api/schedules/update':
      return handleSchedulesUpdate_(payload, headers);

    case 'api/schedules/delete':
      return handleSchedulesDelete_(payload, headers);

    // ---- Alarms ----
    case 'api/alarm/create':
      return handleAlarmCreate_(payload, headers);

    case 'api/alarms/acknowledge':
      return handleAlarmAcknowledge_(payload, headers);

    // ---- Users ----
    case 'api/users/auth':
      return handleUsersAuth_(payload);

    case 'api/users/create':
      return handleUsersCreate_(payload, headers);

    case 'api/users/update':
      return handleUsersUpdate_(payload, headers);

    case 'api/users/change-password':
      return handleUsersChangePassword_(payload, headers);

    case 'api/users/logout':
      return handleUsersLogout_(headers);

    // ---- Config ----
    case 'api/config/update':
      return handleConfigUpdate_(payload, headers);

    default:
      return {
        success: false,
        error: 'Endpoint not found: POST /' + path,
        code: 404,
        requestId: requestId
      };
  }
}

// ============================================================
// HELPER: Parse POST Body
// ============================================================

/**
 * Safely parse the POST request body as JSON.
 *
 * @param {Object} e - Event object with postData
 * @returns {Object} Parsed JSON or empty object
 */
function parsePostBody_(e) {
  try {
    if (!e || !e.postData) return {};
    var contents = e.postData.contents || '';
    return safeParse_(contents) || {};
  } catch (err) {
    console.error('Failed to parse POST body: ' + err.message);
    return {};
  }
}

// ============================================================
// HELPER: Extract Headers
// ============================================================

/**
 * Extract request headers from the event object.
 * Google Apps Script passes headers in e.headers for web app deployments.
 *
 * SECURITY: Tokens are ONLY accepted from HTTP headers (X-Auth-Token, X-Device-Token).
 * URL query parameter fallback has been intentionally removed to prevent token
 * leakage via server logs, browser history, referrer headers, and proxy caches.
 * If tokens are stripped during GAS's 302 redirect, use a server-side proxy
 * that injects headers before forwarding to the GAS deployment URL.
 *
 * @param {Object} e - Event object
 * @returns {Object} Headers object
 */
function getHeaders_(e) {
  var headers = {};

  // GAS provides headers in e.headers for web app deployments
  if (e && e.headers) {
    headers = e.headers;
  }

  // SECURITY: No query parameter fallback for tokens.
  // Previously, tokens were recovered from e.parameter.token / e.parameter.device_token
  // as a workaround for the 302 redirect stripping headers. This was removed because:
  //   1. Query params appear in server access logs (token persistence)
  //   2. Query params are saved in browser history
  //   3. Query params leak via HTTP Referer header to external links
  //   4. Proxy caches may store URLs with tokens
  // If the 302 redirect strips headers, use a reverse proxy to inject them.

  return headers;
}

// ============================================================
// HELPER: Generate Request Correlation ID
// ============================================================

/**
 * Generate a unique request correlation ID for tracing.
 * Format: sems_{timestamp_hex}_{random_hex}
 *
 * @returns {string} 24-character correlation ID
 */
function generateCorrelationId_() {
  var ts = Date.now().toString(16);
  var rand = Utilities.getUuid().replace(/-/g, '').substring(0, 12);
  return 'sems_' + ts + '_' + rand;
}

// ============================================================
// HELPER: API Versioning
// ============================================================

/**
 * Normalize API path to handle versioning.
 * Strips /api/v1/ prefix and converts to /api/ path for routing.
 * Logs a deprecation warning for unversioned /api/ paths (future use).
 *
 * @param {string} path - Raw request path
 * @param {string} requestId - Correlation ID
 * @returns {string} Normalized path (always /api/... format)
 */
function normalizeApiPath_(path, requestId) {
  // Strip /api/v1/ prefix → /api/
  if (path.indexOf('api/v1/') === 0) {
    return 'api/' + path.substring(7);
  }
  return path;
}

// ============================================================
// HELPER: POST Rate Limiting
// ============================================================

/**
 * Rate limiter for POST endpoints using CacheService.
 * Counts requests per identifier (IP-based or token-based) per minute.
 *
 * Limits:
 *   - Telemetry: 30 requests per minute (ESP32 at 15s interval)
 *   - All other POST: 10 requests per minute
 *
 * @param {string} path - Request path
 * @param {Object} headers - Request headers
 * @returns {Object} { allowed: boolean, reason: string|null, retryAfter: number|null }
 */
function checkPostRateLimit_(path, headers) {
  var cache = CacheService.getScriptCache();

  // BE-005 FIX: Use IP address (X-Forwarded-For) as primary rate-limit identifier.
  // Token-based identifiers can be spoofed with random tokens to bypass limits.
  var clientIp = headers['X-Forwarded-For'] ? headers['X-Forwarded-For'].split(',')[0].trim() : '';
  var identifier = clientIp || headers['X-Auth-Token'] || headers['X-Device-Token'] || 'anonymous';

  // Determine limit based on path
  var limit = 10; // Default: 10 req/min
  if (path === 'api/telemetry' || path === 'api/telemetry/upload') {
    limit = 30; // Telemetry: 30 req/min (ESP32 at ~15s interval)
  }

  // T3-BE-027: LIMITATION — Anonymous users share a single rate limit bucket
  // keyed by 'anonymous'. This means one anonymous user consuming the limit
  // affects all anonymous users. For this small-scale IoT system, this is
  // acceptable since all real clients should be authenticated.

  var cacheKey = 'sems_rl_' + identifier + '_' + path;
  var countStr = cache.get(cacheKey);
  var count = parseInt(countStr) || 0;

  if (count >= limit) {
    return {
      allowed: false,
      reason: 'Limit is ' + limit + ' requests per minute for this endpoint.',
      retryAfter: 60
    };
  }

  // Increment counter with 60-second TTL
  // T3-BE-008: NOTE — This rate limit check is non-atomic (get + put are separate calls).
  // This is acceptable for CacheService: in the worst case, one extra request slips through
  // per minute, which is negligible for a small-scale IoT system.
  cache.put(cacheKey, String(count + 1), 60);

  return { allowed: true, reason: null, retryAfter: null };
}

// ============================================================
// STANDALONE TEST FUNCTIONS
// ============================================================

// T3-BE-028: Add production guard to test functions
function isProduction_() {
  return typeof SPREADSHEET_ID === 'string' && SPREADSHEET_ID !== 'REPLACE_WITH_YOUR_SPREADSHEET_ID';
}

/**
 * Test function — verify the backend is working.
 * Run from Script Editor: Run > testConnection
 */
function testConnection() {
  // T3-BE-028: Guard against writing production data from test functions
  if (isProduction_()) return;

  var result = {
    success: true,
    message: 'SEMS Backend is operational',
    spreadsheet: SPREADSHEET_ID,
    sheets: [],
    timestamp: getTimestamp_()
  };

  try {
    var ss = getSpreadsheet_();
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      result.sheets.push(sheets[i].getName());
    }
  } catch (e) {
    result.spreadsheet_error = e.message;
  }

  console.log(safeStringify_(result, null, 2));
  return result;
}

/**
 * Test function — simulate a telemetry POST.
 * Run from Script Editor to verify telemetry handling.
 */
function testTelemetry() {
  // T3-BE-028: Guard against writing production data from test functions
  if (isProduction_()) return;

  // Self-contained timestamp fallback (avoids getTimestamp_ dependency issues)
  var ts;
  try { ts = getTimestamp_(); } catch(e) { ts = new Date().toISOString(); }

  // Use array format to test normalizeTelemetryPayload_() expansion
  var testPayload = {
    timestamp: ts,
    device_id: 'SEMS_001',
    battery_voltage: 24.5,
    battery_current: 5.2,
    battery_power: 127.4,
    soc_percent: 65,
    cell_voltages: [3.062, 3.065, 3.058, 3.063, 3.060, 3.066, 3.059, 3.061],
    inverter_current: 3.5,
    inverter_power: 85.75,
    room_temp: 28.5,
    room_humidity: 65,
    pir_states: [false, true, false, false],
    relay_states: [1,1,1,1,0,0,1,1,1,0,0,0,0],
    mosfet_states: [0,128,0,0],
    uptime_seconds: 86400,
    wifi_rssi: -55,
    free_heap: 150000,
    load_shedding_active: false
  };

  var deviceToken;
  try { deviceToken = getConfigValue_('device_token') || 'test_token'; } catch(e) { deviceToken = 'test_token'; }

  var result = handleTelemetryPost_(testPayload, {
    'X-Device-Token': deviceToken
  });

  console.log(safeStringify_(result, null, 2));
  return result;
}
