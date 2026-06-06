/**
 * AlarmAPI.gs — Alarm Management API
 * ====================================
 * Handles alarm creation, listing, and acknowledgment.
 *
 * SECURITY v1.1.0:
 *   - User-controlled message strings are sanitized before writing to sheets
 *
 * Endpoints:
 *   POST /api/alarm/create       — Create alarm entry (ESP32)
 *   GET  /api/alarms             — Get alarm history (Frontend)
 *   POST /api/alarms/acknowledge — Acknowledge alarm(s) (Frontend)
 */

// ============================================================
// POST /api/alarm/create — Create Alarm Entry
// ============================================================

/**
 * Create a new alarm entry. Called by the system (ESP32 or internally).
 * The alarm is written to the alarms sheet and triggers email notification.
 *
 * Expected payload:
 * {
 *   type: "low_battery" | "overload" | "sensor_failure" | "relay_fault" | "overvoltage" | "system",
 *   severity: "critical" | "warning" | "info",
 *   message: string (description),
 *   timestamp?: string (ISO, auto-generated if missing)
 * }
 *
 * @param {Object} payload - Alarm data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, alarm }
 */
function handleAlarmCreate_(payload, reqHeaders) {
  try {
    // Accept both device token and user token (alarms can be created from either side)
    var deviceAuth = validateDeviceToken_(reqHeaders);
    var userAuth = validateUserToken_(reqHeaders);

    // If called internally (no specific auth), also allow
    if (!deviceAuth.authenticated && !userAuth) {
      return { success: false, error: 'Authentication required.', code: 401 };
    }

    // B-05: For user-authenticated requests, require 'write' permission
    if (userAuth && !deviceAuth.authenticated) {
      var perm = requirePermission_(reqHeaders, 'write');
      if (!perm.authorized) {
        return { success: false, error: perm.error, code: perm.code || 403 };
      }
    }

    // Validate payload
    if (!payload || !payload.type || !payload.severity || !payload.message) {
      return {
        success: false,
        error: 'Missing required fields: type, severity, message',
        code: 400
      };
    }

    // Validate type
    var validTypes = Object.values(ALARM_TYPE);
    if (validTypes.indexOf(payload.type) === -1) {
      return { success: false, error: 'Invalid alarm type: ' + payload.type, code: 400 };
    }

    // Validate severity
    var validSeverities = Object.values(ALARM_SEVERITY);
    if (validSeverities.indexOf(payload.severity) === -1) {
      return { success: false, error: 'Invalid severity: ' + payload.severity, code: 400 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.ALARMS);

    if (!sheet) {
      return { success: false, error: 'alarms sheet not found', code: 500 };
    }

    var alarmId = 'alm_' + Utilities.getUuid().replace(/-/g, '').substring(0, 12);
    var timestamp = payload.timestamp || getTimestamp_();

    // SECURITY: Sanitize user-controlled message to prevent formula injection
    var sanitizedMessage = sanitizeCellValue_(String(payload.message).substring(0, 500));

    var alarmRow = [
      sanitizeCellValue_(alarmId),
      timestamp,
      sanitizeCellValue_(payload.type),
      sanitizeCellValue_(payload.severity),
      sanitizedMessage,
      false // acknowledged = false by default
    ];

    sheet.appendRow(alarmRow);

    var alarm = {
      id: alarmId,
      timestamp: timestamp,
      type: payload.type,
      severity: payload.severity,
      message: payload.message,
      acknowledged: false
    };

    // Trigger email notification for critical/warning alarms
    if (payload.severity !== 'info') {
      // Build a telemetry-like object for email evaluation
      var notification = { sent: false, message: 'No notification' };

      // For alarms from telemetry evaluation, the email was already sent
      // For manually created alarms, send email
      if (payload.send_email !== false) {
        notification = sendManualAlarmEmail_(payload);
      }

      alarm.notification = notification;
    }

    // B-10: Truncate alarm message in console log to 100 chars
    var logMsg = String(payload.message);
    if (logMsg.length > 100) logMsg = logMsg.substring(0, 100) + '...';
    console.log('Alarm: Created "' + payload.type + '" (' + payload.severity + '): ' + logMsg);

    return {
      success: true,
      message: 'Alarm recorded',
      alarm: alarm
    };

  } catch (e) {
    console.error('Alarm create error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// GET /api/alarms — Get Alarm History
// ============================================================

/**
 * Return alarm history with optional filters.
 * Query parameters: type, severity, acknowledged, limit, offset, since
 *
 * @param {Object} params - URL query parameters
 * @param {Object} headers - Request headers
 * @returns {Object} { success, alarms, count }
 */
function handleAlarmsGet_(params, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'read');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.code || 401 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.ALARMS);

    if (!sheet) {
      return { success: false, error: 'alarms sheet not found', code: 500 };
    }

    // T3-BE-001: Use chunked reading to avoid OOM on large sheets
    var lastRow = sheet.getLastRow();
    var numCols = sheet.getLastColumn();
    if (lastRow <= 1 || numCols < 1) {
      return { success: true, alarms: [], count: 0, message: 'No alarms' };
    }

    var headers_row = sheet.getRange(1, 1, 1, numCols).getValues()[0];

    // Parse filters
    var filterType = params.type || null;
    var filterSeverity = params.severity || null;
    var filterAck = params.acknowledged; // "true", "false", or undefined (all)
    var since = params.since ? new Date(params.since) : null;

    // T3-BE-020: Pagination limit must be at least 1 (reject limit=-1 edge case)
    var limit  = Math.max(1, Math.min(parseInt(params.limit) || 100, 1000));
    var offset = Math.max(parseInt(params.offset) || 0, 0);

    var colId           = headers_row.indexOf('id');
    var colTimestamp    = headers_row.indexOf('timestamp');
    var colType         = headers_row.indexOf('type');
    var colSeverity     = headers_row.indexOf('severity');
    var colMessage      = headers_row.indexOf('message');
    var colAcknowledged = headers_row.indexOf('acknowledged');

    var alarms = [];

    // T3-BE-001: Read in chunks (5000 rows at a time) to avoid OOM
    var CHUNK_SIZE = 5000;
    for (var chunkStart = 2; chunkStart <= lastRow; chunkStart += CHUNK_SIZE) {
      var chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, lastRow);
      var chunkData = sheet.getRange(chunkStart, 1, chunkEnd - chunkStart + 1, numCols).getValues();

      // Read chunk in reverse (newest first within chunk)
      for (var ci = chunkData.length - 1; ci >= 0; ci--) {
        var row = chunkData[ci];
        var alarm = {
          id: String(row[colId]),
          timestamp: row[colTimestamp],
          type: row[colType],
          severity: row[colSeverity],
          message: row[colMessage],
          acknowledged: row[colAcknowledged] === true || row[colAcknowledged] === 'true'
        };

        // Apply filters
        if (filterType && alarm.type !== filterType) continue;
        if (filterSeverity && alarm.severity !== filterSeverity) continue;
        if (filterAck !== undefined && String(alarm.acknowledged) !== filterAck) continue;
        if (since) {
          var ts = alarm.timestamp instanceof Date ? alarm.timestamp.getTime() : new Date(String(alarm.timestamp)).getTime();
          if (ts < since.getTime()) continue;
        }

        alarms.push(alarm);
      }
    }

    var total = alarms.length;
    var paginated = alarms.slice(offset, offset + limit);

    // T3-BE-021: Skip unacknowledged count when data is too large (avoids full-sheet scan)
    var unacknowledged = -1;
    if (lastRow <= 5000) {
      unacknowledged = 0;
      var CHUNK_SIZE_5K = 5000;
      for (var uchunkStart = 2; uchunkStart <= lastRow; uchunkStart += CHUNK_SIZE_5K) {
        var uchunkEnd = Math.min(uchunkStart + CHUNK_SIZE_5K - 1, lastRow);
        var uchunkData = sheet.getRange(uchunkStart, 1, uchunkEnd - uchunkStart + 1, numCols).getValues();
        for (var ui = 0; ui < uchunkData.length; ui++) {
          if (uchunkData[ui][colAcknowledged] !== true && uchunkData[ui][colAcknowledged] !== 'true') {
            unacknowledged++;
          }
        }
      }
    }

    return {
      success: true,
      alarms: paginated,
      total: total,
      returned: paginated.length,
      unacknowledged: unacknowledged,
      offset: offset,
      limit: limit
    };

  } catch (e) {
    console.error('Alarms GET error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/alarms/acknowledge — Acknowledge Alarm(s)
// ============================================================

/**
 * Mark one or more alarms as acknowledged.
 * Payload can be:
 *   - { id: "timestamp|type" } for a single alarm
 *   - { ids: ["timestamp1", "timestamp2"] } for multiple alarms
 *   - { acknowledge_all: true } to acknowledge all alarms
 *
 * @param {Object} payload - Acknowledgment data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, acknowledged: number }
 */
function handleAlarmAcknowledge_(payload, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'write');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.ALARMS);

    if (!sheet) {
      return { success: false, error: 'alarms sheet not found', code: 500 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      // BE-006 FIX: Use chunked reading (5000 rows per chunk) to avoid OOM
      // on large alarm sheets instead of loading entire sheet at once.
      var lastRow = sheet.getLastRow();
      var numCols = sheet.getLastColumn();
      if (lastRow <= 1 || numCols < 1) {
        return { success: false, error: 'No alarm data found', code: 404 };
      }

      var headersRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];

      var colId          = headersRow.indexOf('id');
      var colTimestamp    = headersRow.indexOf('timestamp');
      var colAcknowledged = headersRow.indexOf('acknowledged');

      if (colId === -1 || colAcknowledged === -1) {
        return { success: false, error: 'Invalid alarms sheet structure', code: 500 };
      }

      var count = 0;

      if (payload.acknowledge_all) {
        // Require explicit confirmation to prevent accidental bulk acknowledge
        if (payload.confirm !== true) {
          return { success: false, error: 'Send confirm: true to acknowledge all alarms', code: 400 };
        }
        // Acknowledge ALL unacknowledged alarms (with batch limit) — chunked reading
        var BATCH_LIMIT = 500;
        var CHUNK_SIZE = 5000;
        for (var chunkStart = 2; chunkStart <= lastRow && count < BATCH_LIMIT; chunkStart += CHUNK_SIZE) {
          var chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, lastRow);
          var chunkData = sheet.getRange(chunkStart, 1, chunkEnd - chunkStart + 1, numCols).getValues();
          for (var i = 0; i < chunkData.length && count < BATCH_LIMIT; i++) {
            var isAck = chunkData[i][colAcknowledged];
            if (isAck !== true && isAck !== 'true') {
              sheet.getRange(chunkStart + i, colAcknowledged + 1).setValue(true);
              count++;
            }
          }
        }
      } else {
        // Acknowledge specific alarms by ID (match by 'id' column, fallback to timestamp)
        var ids = [];

        if (payload.ids && Array.isArray(payload.ids)) {
          ids = payload.ids;
        } else if (payload.id) {
          ids = [payload.id];
        }

        if (ids.length === 0) {
          return { success: false, error: 'No alarm IDs provided', code: 400 };
        }

        // T3-BE-018: Use hash set for O(1) lookups instead of O(n×m) nested loop
        var idSet = {};
        for (var k = 0; k < ids.length; k++) idSet[String(ids[k])] = true;

        // BE-006 FIX: Chunked reading for specific alarm acknowledgment
        var CHUNK_SIZE2 = 5000;
        for (var chunkStart2 = 2; chunkStart2 <= lastRow; chunkStart2 += CHUNK_SIZE2) {
          var chunkEnd2 = Math.min(chunkStart2 + CHUNK_SIZE2 - 1, lastRow);
          var chunkData2 = sheet.getRange(chunkStart2, 1, chunkEnd2 - chunkStart2 + 1, numCols).getValues();
          for (var j = 0; j < chunkData2.length; j++) {
            var rowId = String(chunkData2[j][colId]);
            var rowTs = String(chunkData2[j][colTimestamp]);
            if (idSet[rowId] || idSet[rowTs]) {
              sheet.getRange(chunkStart2 + j, colAcknowledged + 1).setValue(true);
              count++;
            }
          }
        }
      }

      console.log('Alarms: User "' + auth.user.username + '" acknowledged ' + count + ' alarm(s)');

      return {
        success: true,
        message: count + ' alarm(s) acknowledged',
        acknowledged: count
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Alarm acknowledge error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Send email notification for manually created alarms.
 *
 * @param {Object} alarm - Alarm data
 * @returns {Object} { sent: boolean, message: string }
 */
function sendManualAlarmEmail_(alarm) {
  try {
    var recipientEmail = getConfigValue_('notification_email');
    if (!recipientEmail) {
      return { sent: false, message: 'No notification email configured' };
    }

    if (!checkDailyEmailLimit_()) {
      return { sent: false, message: 'Daily email limit reached' };
    }

    if (!checkAlarmTypeRateLimit_(alarm.type)) {
      return { sent: false, message: 'Rate limited for alarm type: ' + alarm.type };
    }

    var alarmObj = {
      type: alarm.type,
      severity: alarm.severity,
      message_id: alarm.type,
      value: alarm.value || 'N/A',
      threshold: alarm.threshold || 'N/A'
    };

    var sent = sendAlarmEmail_(recipientEmail, alarmObj);

    if (sent) {
      setAlarmTypeRateLimit_(alarm.type);
      incrementDailyEmailCount_();
    }

    return { sent: sent, message: sent ? 'Email sent' : 'Failed to send' };

  } catch (e) {
    return { sent: false, message: 'Email notification failed' };
  }
}
