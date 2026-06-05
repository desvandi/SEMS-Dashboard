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
 *   2. Extract the path from the URL (e.g., /api/telemetry)
 *   3. Route to the appropriate handler function
 *   4. Return JSON response with CORS headers
 */

// ============================================================
// GET Request Handler
// ============================================================

/**
 * Handle all GET requests.
 * Parses the path and routes to the appropriate handler.
 *
 * @param {Object} e - Event object with parameters, pathInfo, etc.
 * @returns {TextOutput} JSON response
 */
function doGet(e) {
  return routeGet_(e);
}

// ============================================================
// POST Request Handler
// ============================================================

/**
 * Handle all POST requests.
 * Parses the path and JSON body, then routes to the handler.
 *
 * @param {Object} e - Event object with postData, pathInfo, etc.
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    // Path priority: e.pathInfo > e.parameter.path > payload.path
    var path = (e.pathInfo || e.parameter.path || '').replace(/^\//, '').replace(/\/$/, '');
    var payload = parsePostBody_(e);
    var headers = getHeaders_(e);

    // Final fallback: check payload body for path field
    if (!path && payload && payload.path) {
      path = String(payload.path).replace(/^\//, '').replace(/\/$/, '');
      delete payload.path;
    }

    console.log('POST /' + path);

    var response = routePost_(path, payload, headers);

    return jsonResponse_(response);

  } catch (err) {
    console.error('doPost unhandled error: ' + err.message);
    return jsonResponse_({
      success: false,
      error: 'Internal server error',
      code: 500
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
  // NOTE: GAS ContentService does not support setting custom response headers
  // (e.g., Access-Control-Allow-Origin). CORS is handled at the response level
  // by jsonResponse_() which relies on the deployment being configured for
  // "Anyone" access. Browsers may still work if the server returns 200;
  // if not, consider routing through a proxy that adds CORS headers.
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
 *
 * @param {Object} e - Event object with pathInfo, parameter, headers
 * @returns {TextOutput} JSON response
 */
function routeGet_(e) {
  try {
    var path = (e.pathInfo || (e.parameter && e.parameter.path) || '').replace(/^\//, '').replace(/\/$/, '');
    var params = e.parameter || {};
    var headers = getHeaders_(e);

    console.log('GET /' + path);

    var response;
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

    // ---- Health Check ----
    case 'api/health':
    case '':
      response = {
        success: true,
        status: 'online',
        service: 'SEMS Backend',
        version: SYSTEM_VERSION,
        timestamp: getTimestamp_()
      };
      break;

    default:
      response = {
        success: false,
        error: 'Endpoint not found: GET /' + path,
        code: 404
      };
  }

    return jsonResponse_(response);

  } catch (err) {
    console.error('routeGet_ unhandled error: ' + err.message);
    return jsonResponse_({
      success: false,
      error: 'Internal server error',
      code: 500
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
 * @returns {Object} Handler response
 */
function routePost_(path, payload, headers) {
  // Auth guard: require token for all POST endpoints except login
  var token = headers['X-Auth-Token'] || headers['X-Device-Token'];
  if (!token && path !== 'api/users/auth') {
    return { success: false, error: 'Authentication required', code: 401 };
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

    case 'api/users/logout':
      return handleUsersLogout_(headers);

    // ---- Config ----
    case 'api/config/update':
      return handleConfigUpdate_(payload, headers);

    default:
      return {
        success: false,
        error: 'Endpoint not found: POST /' + path,
        code: 404
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
 * Google Apps Script passes headers differently depending on deployment.
 * Also checks query parameters as a fallback for auth tokens that are
 * stripped during GAS's 302 redirect (script.google.com → script.googleusercontent.com).
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

  // Fallback: if auth headers are missing (stripped by 302 redirect),
  // recover them from query parameters. The proxy sends both header
  // and query param to ensure the token survives the redirect.
  if (e && e.parameter) {
    if (!headers['X-Auth-Token'] && !headers['x-auth-token'] && e.parameter.token) {
      headers['X-Auth-Token'] = e.parameter.token;
    }
    if (!headers['X-Device-Token'] && !headers['x-device-token'] && e.parameter.device_token) {
      headers['X-Device-Token'] = e.parameter.device_token;
    }
  }

  return headers;
}

// ============================================================
// STANDALONE TEST FUNCTIONS
// ============================================================

/**
 * Test function — verify the backend is working.
 * Run from Script Editor: Run > testConnection
 */
function testConnection() {
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
