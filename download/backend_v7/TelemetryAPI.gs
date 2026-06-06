/**
 * TelemetryAPI.gs — Telemetry Data API
 * =====================================
 * Handles telemetry data ingestion from ESP32 and retrieval by frontend.
 *
 * SECURITY v1.1.0:
 *   - Numeric range validation for all sensor values
 *   - Cleanup optimization (runs every Nth POST instead of every POST)
 *   - Formula injection prevention on cell writes
 *
 * Endpoints:
 *   POST /api/telemetry         — Receive telemetry (ESP32 → Cloud)
 *   GET  /api/telemetry/latest  — Get latest telemetry (Frontend → Cloud)
 *   GET  /api/telemetry/history — Get historical data with date range (Frontend → Cloud)
 */

// ============================================================
// POST /api/telemetry — Receive Telemetry from ESP32
// ============================================================

/**
 * Receive and store telemetry data from ESP32.
 * Writes to telemetry_live (overwrite row 2) and telemetry_history (append).
 * Also caches latest data, evaluates alarm conditions, and runs cleanup.
 *
 * @param {Object} payload - Telemetry data object from ESP32
 * @param {Object} reqHeaders - Request headers (for auth)
 * @returns {Object} { success, stats, notification }
 */
function handleTelemetryPost_(payload, reqHeaders) {
  try {
    // --- Auth: Validate device token ---
    var auth = validateDeviceToken_(reqHeaders);
    if (!auth.authenticated) {
      return {
        success: false,
        error: auth.error,
        code: 401
      };
    }

    // --- Validate payload ---
    if (!payload || typeof payload !== 'object') {
      return {
        success: false,
        error: 'Invalid telemetry payload. Expected JSON object.',
      code: 400
      };
    }

    // Ensure timestamp exists
    if (!payload.timestamp) {
      payload.timestamp = getTimestamp_();
    }

    // --- SECURITY: Numeric range validation ---
    var rangeErrors = validateTelemetryRanges_(payload);
    if (rangeErrors.length > 0) {
      return {
        success: false,
        error: 'Telemetry values out of acceptable range: ' + rangeErrors.join('; '),
        code: 400,
        invalidFields: rangeErrors
      };
    }

    // --- Normalize firmware payload ---
    // ESP32 sends arrays (cell_voltages, pir_states) but spreadsheet has individual columns.
    // Normalize so cache and spreadsheet both use the same field names.
    payload = normalizeTelemetryPayload_(payload);

    // --- Acquire lock for telemetry write ---
    var lock = LockService.getScriptLock();
    var notification = null;
    var cleanupNeeded = false;
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS); // Wait up to TELEMETRY.LOCK_WAIT_MS ms

      var ss = getSpreadsheet_();
      var stats = {};

      // ---- Write to telemetry_live (SINGLE ROW — always overwrite) ----
      var liveSheet = ss.getSheetByName(SHEET.TELEMETRY_LIVE);
      if (!liveSheet) {
        return { success: false, error: 'telemetry_live sheet not found', code: 500 };
      }

      // Build row array matching header order
      var liveRow = buildTelemetryRow_(payload);
      var liveRange = liveSheet.getRange(2, 1, 1, liveRow.length);

      liveRange.setValues([liveRow]);
      stats.live_written = true;

      // ---- Write to telemetry_history (APPEND ONLY) ----
      var historySheet = ss.getSheetByName(SHEET.TELEMETRY_HISTORY);
      if (!historySheet) {
        return { success: false, error: 'telemetry_history sheet not found', code: 500 };
      }

      var historyRow = buildTelemetryRow_(payload);

      // T3-BE-019: Dedup hash on sensor values only, exclude timestamp
      var telemetryCache = CacheService.getScriptCache();
      var lastHash = telemetryCache.get(CACHE.TELEMETRY_DEDUP_KEY);
      var hashPayload = Object.keys(payload).filter(function(k) { return k !== 'timestamp' && k !== 'uptime_seconds'; }).reduce(function(obj, k) { obj[k] = payload[k]; return obj; }, {});
      var currentHash = safeStringify_(hashPayload);
      if (currentHash === lastHash) {
        stats.historySkipped = true;
      } else {
        telemetryCache.put(CACHE.TELEMETRY_DEDUP_KEY, currentHash, CACHE.TELEMETRY_DEDUP_TTL);
        historySheet.appendRow(historyRow);
        stats.historyAppended = true;
      }

      // ---- Cache latest telemetry (normalized) ----
      var cache = CacheService.getScriptCache();
      cache.put(CACHE.LATEST_TELEMETRY_KEY, safeStringify_(payload), CACHE.LATEST_TELEMETRY_TTL);
      stats.cached = true;

      // ---- Determine if cleanup should run (optimized) ----
      // SECURITY/OPTIMIZATION: Only run cleanup every Nth telemetry POST
      // to reduce spreadsheet I/O. Uses a CacheService counter.
      cleanupNeeded = shouldRunCleanup_();

      console.log('Telemetry: Received from ESP32, SOC=' + (payload.soc_percent || 'N/A') +
                  '%, V=' + (payload.battery_voltage || 'N/A') + 'V');

      // T3-BE-004: Defer notification result — will be populated after lock release
      stats.notificationDeferred = true;

      // BE-001 FIX: Store result in variable instead of returning here;
      // notification and cleanup must run after lock release (after finally block).
      var result = {
        success: true,
        message: 'Telemetry recorded successfully',
        timestamp: payload.timestamp,
        stats: stats
      };

    } catch (lockError) {
      return {
        success: false,
        error: 'Server busy. Could not acquire lock for telemetry write.',
        code: 503
      };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

    // BE-001 FIX: Email notification OUTSIDE lock block (after finally).
    // These lines were previously unreachable due to return inside inner try.
    // evaluateAndNotify_ may take seconds due to MailApp calls
    notification = evaluateAndNotify_(payload);

    // T3-BE-015: Run data cleanup OUTSIDE lock with cache-based mutex
    if (cleanupNeeded && Math.random() < 0.5) {
      try { runDataCleanup_(true); } catch (cleanupErr) {
        console.error('Cleanup after telemetry error: ' + cleanupErr.message);
      }
    }

    // BE-001 FIX: Return result AFTER notification/cleanup have executed
    return result;

  } catch (e) {
    console.error('Telemetry POST error: ' + e.message);
    return {
      success: false,
      error: 'Internal server error',
      code: 500
    };
  }
}

// ============================================================
// GET /api/telemetry/latest — Get Latest Telemetry
// ============================================================

/**
 * Return the latest telemetry reading (from cache or spreadsheet).
 *
 * @param {Object} headers - Request headers (for user auth)
 * @returns {Object} { success, data, source }
 */
function handleTelemetryLatest_(reqHeaders) {
  try {
    // Auth: require user read permission
    var auth = requirePermission_(reqHeaders, 'read');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.code || 401 };
    }

    // Try cache first (faster)
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CACHE.LATEST_TELEMETRY_KEY);

    if (cached) {
      var data = safeParse_(cached);
      if (data) {
        return {
          success: true,
          data: data,
          source: 'cache',
          cached_at: getTimestamp_()
        };
      }
    }

    // Fallback: read from spreadsheet
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.TELEMETRY_LIVE);

    if (!sheet) {
      return { success: false, error: 'telemetry_live sheet not found', code: 500 };
    }

    var data = sheetToTelemetryObject_(sheet);

    if (!data) {
      return {
        success: true,
        data: null,
        message: 'No telemetry data available yet'
      };
    }

    // Update cache
    cache.put(CACHE.LATEST_TELEMETRY_KEY, safeStringify_(data), CACHE.LATEST_TELEMETRY_TTL);

    return {
      success: true,
      data: data,
      source: 'spreadsheet'
    };

  } catch (e) {
    console.error('Telemetry latest error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// GET /api/telemetry/history — Get Historical Telemetry
// ============================================================

/**
 * Return historical telemetry data with optional date range filter.
 * Query parameters: start, end (ISO strings), limit, offset
 *
 * @param {Object} params - URL query parameters
 * @param {Object} headers - Request headers
 * @returns {Object} { success, data, count, from, to }
 */
function handleTelemetryHistory_(params, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'read');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.code || 401 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.TELEMETRY_HISTORY);

    if (!sheet) {
      return { success: false, error: 'telemetry_history sheet not found', code: 500 };
    }

    // T3-BE-001: Use chunked reading to avoid OOM on large sheets
    var lastRow = sheet.getLastRow();
    var numCols = sheet.getLastColumn();
    if (lastRow <= 1 || numCols < 1) {
      return { success: true, data: [], count: 0, message: 'No history data available' };
    }

    var headers_row = sheet.getRange(1, 1, 1, numCols).getValues()[0];

    // Parse date range filters (support both start/end and from/to param names)
    var startDate = (params.start || params.from) ? new Date(params.start || params.from) : null;
    var endDate   = (params.end || params.to)   ? new Date(params.end || params.to) : null;

    // T3-BE-020: Pagination limit must be at least 1 (reject limit=-1 edge case)
    var limit  = Math.max(1, Math.min(parseInt(params.limit) || 1000, TELEMETRY.MAX_HISTORY_ROWS));
    var offset = Math.max(parseInt(params.offset) || 0, 0);

    var colTimestamp = headers_row.indexOf('timestamp');
    if (colTimestamp === -1) {
      return { success: false, error: 'Invalid sheet structure: missing timestamp column', code: 500 };
    }

    // Filter rows using chunked reading (T3-BE-001)
    var results = [];
    var CHUNK_SIZE = 5000;
    for (var chunkStart = 2; chunkStart <= lastRow; chunkStart += CHUNK_SIZE) {
      var chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, lastRow);
      var chunkData = sheet.getRange(chunkStart, 1, chunkEnd - chunkStart + 1, numCols).getValues();

      for (var ci = 0; ci < chunkData.length; ci++) {
        var row = chunkData[ci];
        var ts = row[colTimestamp];
        var rowTime;

        if (ts instanceof Date) {
          rowTime = ts.getTime();
        } else {
          var parsed = new Date(String(ts));
          rowTime = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        }

        // Apply date filters
        if (startDate && rowTime < startDate.getTime()) continue;
        if (endDate && rowTime > endDate.getTime()) continue;

        // Convert row to object
        var obj = {};
        for (var j = 0; j < headers_row.length; j++) {
          obj[headers_row[j]] = row[j];
        }
        results.push(obj);
      }
    }

    // Apply pagination (history is chronological, newest last)
    var total = results.length;
    var paginated = results.slice(offset, offset + limit);

    // Downsample for large datasets (return every Nth point if > 500 results)
    var downsampled = paginated;
    if (paginated.length > TELEMETRY.DOWNSAMPLE_THRESHOLD && !params.full) {
      var step = Math.ceil(paginated.length / TELEMETRY.DOWNSAMPLE_THRESHOLD);
      downsampled = paginated.filter(function(_, idx) {
        return idx % step === 0 || idx === paginated.length - 1;
      });
    }

    return {
      success: true,
      data: downsampled,
      count: total,
      returned: downsampled.length,
      offset: offset,
      limit: limit,
      downsampled: downsampled.length !== paginated.length
    };

  } catch (e) {
    console.error('Telemetry history error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// SECURITY: Numeric Range Validation
// ============================================================

/**
 * Validate telemetry payload values are within acceptable ranges.
 * Rejects payloads with physically impossible values that could indicate
 * sensor malfunction, firmware bugs, or malicious data injection.
 *
 * Ranges:
 *   - Voltage: 0-60V (covers battery + solar panel scenarios)
 *   - Current: -200 to 200A (bidirectional, covers charging/discharging)
 *   - Temperature: -20 to 80°C (indoor/outdoor range)
 *   - SOC: 0-100% (battery state of charge percentage)
 *
 * @param {Object} payload - Telemetry data
 * @returns {Array} Array of error strings (empty if all valid)
 */
function validateTelemetryRanges_(payload) {
  var errors = [];

  var v = parseFloat(payload.battery_voltage);
  if (!isNaN(v) && (v < 0 || v > 60)) {
    errors.push('battery_voltage=' + v + 'V (valid: 0-60V)');
  }

  var i = parseFloat(payload.battery_current);
  if (!isNaN(i) && (i < -200 || i > 200)) {
    errors.push('battery_current=' + i + 'A (valid: -200 to 200A)');
  }

  var inv = parseFloat(payload.inverter_current);
  if (!isNaN(inv) && (inv < -200 || inv > 200)) {
    errors.push('inverter_current=' + inv + 'A (valid: -200 to 200A)');
  }

  var temp = parseFloat(payload.room_temp);
  if (!isNaN(temp) && (temp < -20 || temp > 80)) {
    errors.push('room_temp=' + temp + '°C (valid: -20 to 80°C)');
  }

  var soc = parseFloat(payload.soc_percent);
  if (!isNaN(soc) && (soc < 0 || soc > 100)) {
    errors.push('soc_percent=' + soc + '% (valid: 0-100%)');
  }

  // Validate individual cell voltages
  for (var c = 1; c <= 8; c++) {
    var cellV = parseFloat(payload['cell' + c + '_v']);
    if (!isNaN(cellV) && (cellV < 0 || cellV > 60)) {
      errors.push('cell' + c + '_v=' + cellV + 'V (valid: 0-60V)');
    }
  }

  // B-14: Validate WiFi RSSI (-100 to 0 dBm typical range, allow -120 to 10 as buffer)
  var wifiRssi = parseFloat(payload.wifi_rssi);
  if (!isNaN(wifiRssi) && (wifiRssi < -120 || wifiRssi > 10)) {
    errors.push('wifi_rssi=' + wifiRssi + 'dBm (valid: -120 to 10dBm)');
  }

  // B-14: Validate free heap (0 to 1MB typical for ESP32)
  var freeHeap = parseFloat(payload.free_heap);
  if (!isNaN(freeHeap) && (freeHeap < 0 || freeHeap > 1048576)) {
    errors.push('free_heap=' + freeHeap + 'B (valid: 0 to 1048576B)');
  }

  // B-14: Validate uptime (0 to 10 years in seconds)
  var uptime = parseFloat(payload.uptime_seconds);
  if (!isNaN(uptime) && (uptime < 0 || uptime > 315360000)) {
    errors.push('uptime_seconds=' + uptime + 's (valid: 0 to 315360000s)');
  }

  return errors;
}

// ============================================================
// OPTIMIZATION: Cleanup Throttle
// ============================================================

/**
 * Determine whether cleanup should run on this telemetry POST.
 * Uses a CacheService counter to run cleanup only every Nth POST,
 * reducing spreadsheet I/O from every 15 seconds to every ~2.5 minutes.
 *
 * @returns {boolean} True if cleanup should run this time
 */
function shouldRunCleanup_() {
  var cache = CacheService.getScriptCache();
  var countStr = cache.get(CACHE.CLEANUP_COUNTER_KEY);
  var count = parseInt(countStr) || 0;

  count++;

  if (count >= CLEANUP.RUN_EVERY_N_POSTS) {
    // Reset counter
    cache.put(CACHE.CLEANUP_COUNTER_KEY, '0', 3600);
    return true;
  }

  // Increment counter with 1-hour TTL (auto-resets if no telemetry for a while)
  cache.put(CACHE.CLEANUP_COUNTER_KEY, String(count), 3600);
  return false;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Normalize ESP32 firmware payload to match TELEMETRY_HEADERS format.
 * ESP32 sends arrays (cell_voltages, pir_states) but our schema uses
 * individual columns (cell1_v..cell8_v, pir1..pir4). This function expands
 * those arrays so both cache and spreadsheet use consistent field names.
 *
 * @param {Object} payload - Raw telemetry from ESP32
 * @returns {Object} Normalized payload with expanded fields
 */
function normalizeTelemetryPayload_(payload) {
  if (!payload) return payload;

  // Expand cell_voltages array → cell1_v .. cell8_v
  if (Array.isArray(payload.cell_voltages)) {
    for (var i = 0; i < payload.cell_voltages.length && i < 8; i++) {
      payload['cell' + (i + 1) + '_v'] = payload.cell_voltages[i];
    }
    delete payload.cell_voltages;
  }

  // Expand pir_states array → pir1 .. pir4
  if (Array.isArray(payload.pir_states)) {
    for (var j = 0; j < payload.pir_states.length && j < 4; j++) {
      payload['pir' + (j + 1)] = payload.pir_states[j] ? 1 : 0;
    }
    delete payload.pir_states;
  }

  // Ensure relay_states and mosfet_states are arrays
  if (!Array.isArray(payload.relay_states)) {
    payload.relay_states = [];
  }
  if (!Array.isArray(payload.mosfet_states)) {
    payload.mosfet_states = [];
  }

  return payload;
}

/**
 * Build a telemetry row array matching the TELEMETRY_HEADERS order.
 * Ensures all columns are populated in the correct sequence.
 * Applies sanitizeCellValue_ to all string fields.
 *
 * @param {Object} payload - Telemetry data from ESP32
 * @returns {Array} Row array for spreadsheet insertion
 */
function buildTelemetryRow_(payload) {
  return TELEMETRY_HEADERS.map(function(header) {
    if (payload.hasOwnProperty(header)) {
      var val = payload[header];
      // SECURITY: Sanitize string values to prevent formula injection
      if (typeof val === 'string') {
        return sanitizeCellValue_(val);
      }
      return val;
    }
    // Provide defaults for missing fields
    switch (header) {
      case 'timestamp': return getTimestamp_();
      case 'relay_states':
      case 'mosfet_states':
        return safeStringify_(payload[header] || []);
      default: return '';
    }
  });
}

/**
 * Convert the telemetry_live sheet (row 2) to a telemetry object.
 *
 * @param {Sheet} sheet - The telemetry_live sheet
 * @returns {Object|null} Telemetry data object or null
 */
function sheetToTelemetryObject_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var headers = data[0];
  var row = data[1];
  var obj = {};

  for (var i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i];
  }

  return obj;
}
