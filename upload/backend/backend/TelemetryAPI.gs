/**
 * TelemetryAPI.gs — Telemetry Data API
 * =====================================
 * Handles telemetry data ingestion from ESP32 and retrieval by frontend.
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

    // --- Normalize firmware payload ---
    // ESP32 sends arrays (cell_voltages, pir_states) but spreadsheet has individual columns.
    // Normalize so cache and spreadsheet both use the same field names.
    payload = normalizeTelemetryPayload_(payload);

    // --- Acquire lock for telemetry write ---
    var lock = LockService.getScriptLock();
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

      // Dedup: skip history write if data hasn't changed
      var telemetryCache = CacheService.getScriptCache();
      var lastHash = telemetryCache.get(CACHE.TELEMETRY_DEDUP_KEY);
      var currentHash = safeStringify_(payload);
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

      // ---- Evaluate alarm conditions & send email ----
      var notification = evaluateAndNotify_(payload);

      // ---- Run data cleanup (async-like, with lock already held) ----
      // NOTE: Moved outside lock in finally block to avoid holding lock during cleanup
      var cleanupNeeded = true;

      console.log('Telemetry: Received from ESP32, SOC=' + (payload.soc_percent || 'N/A') +
                  '%, V=' + (payload.battery_voltage || 'N/A') + 'V');

      return {
        success: true,
        message: 'Telemetry recorded successfully',
        timestamp: payload.timestamp,
        stats: stats,
        notification: notification
      };

    } catch (lockError) {
      return {
        success: false,
        error: 'Server busy. Could not acquire lock for telemetry write.',
        code: 503
      };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
      // Run data cleanup AFTER releasing lock to avoid holding it during cleanup
      if (cleanupNeeded) {
        try { runDataCleanup_(true); } catch (cleanupErr) {
          console.error('Cleanup after telemetry error: ' + cleanupErr.message);
        }
      }
    }

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

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    if (data.length <= 1) {
      return { success: true, data: [], count: 0, message: 'No history data available' };
    }

    // Parse date range filters (support both start/end and from/to param names)
    var startDate = (params.start || params.from) ? new Date(params.start || params.from) : null;
    var endDate   = (params.end   || params.to)   ? new Date(params.end || params.to) : null;

    // Limit & offset for pagination
    var limit  = Math.min(parseInt(params.limit) || 1000, TELEMETRY.MAX_HISTORY_ROWS);
    var offset = Math.max(parseInt(params.offset) || 0, 0);

    var colTimestamp = headers_row.indexOf('timestamp');
    if (colTimestamp === -1) {
      return { success: false, error: 'Invalid sheet structure: missing timestamp column', code: 500 };
    }

    // Filter rows
    var results = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
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
 *
 * @param {Object} payload - Telemetry data from ESP32
 * @returns {Array} Row array for spreadsheet insertion
 */
function buildTelemetryRow_(payload) {
  return TELEMETRY_HEADERS.map(function(header) {
    if (payload.hasOwnProperty(header)) {
      return payload[header];
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
