/**
 * AlarmAPI.gs — Alarm Management API
 * ====================================
 * Handles alarm creation, listing, and acknowledgment.
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

    var alarmId = 'alm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    var timestamp = payload.timestamp || getTimestamp_();

    var alarmRow = [
      alarmId,
      timestamp,
      payload.type,
      payload.severity,
      String(payload.message).substring(0, 500), // Truncate long messages
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

    console.log('Alarm: Created "' + payload.type + '" (' + payload.severity + '): ' + payload.message);

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

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    if (data.length <= 1) {
      return { success: true, alarms: [], count: 0, message: 'No alarms' };
    }

    // Parse filters
    var filterType = params.type || null;
    var filterSeverity = params.severity || null;
    var filterAck = params.acknowledged; // "true", "false", or undefined (all)
    var since = params.since ? new Date(params.since) : null;

    var limit  = Math.min(parseInt(params.limit) || 100, 1000);
    var offset = Math.max(parseInt(params.offset) || 0, 0);

    var colId           = headers_row.indexOf('id');
    var colTimestamp    = headers_row.indexOf('timestamp');
    var colType         = headers_row.indexOf('type');
    var colSeverity     = headers_row.indexOf('severity');
    var colMessage      = headers_row.indexOf('message');
    var colAcknowledged = headers_row.indexOf('acknowledged');

    var alarms = [];

    // Read in reverse (newest first)
    for (var i = data.length - 1; i >= 1; i--) {
      var row = data[i];
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

    var total = alarms.length;
    var paginated = alarms.slice(offset, offset + limit);

    // Count unacknowledged
    var unacknowledged = 0;
    for (var j = 1; j < data.length; j++) {
      if (data[j][colAcknowledged] !== true && data[j][colAcknowledged] !== 'true') {
        unacknowledged++;
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

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    var colId          = headers_row.indexOf('id');
    var colTimestamp    = headers_row.indexOf('timestamp');
    var colAcknowledged = headers_row.indexOf('acknowledged');

    if (colId === -1 || colAcknowledged === -1) {
      return { success: false, error: 'Invalid alarms sheet structure', code: 500 };
    }

    var count = 0;

    if (payload.acknowledge_all) {
      // Require explicit confirmation to prevent accidental bulk acknowledge
      if (payload.confirm !== true) {
        return { success: false, error: 'Send confirm: true to acknowledge all alarms', code: 400 };
      }
      // Acknowledge ALL unacknowledged alarms (with batch limit)
      var BATCH_LIMIT = 500;
      for (var i = 1; i < data.length && count < BATCH_LIMIT; i++) {
        var isAck = data[i][colAcknowledged];
        if (isAck !== true && isAck !== 'true') {
          sheet.getRange(i + 1, colAcknowledged + 1).setValue(true);
          count++;
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

      for (var j = 1; j < data.length; j++) {
        var rowId = String(data[j][colId]);
        var rowTs = String(data[j][colTimestamp]);
        for (var k = 0; k < ids.length; k++) {
          if (rowId === String(ids[k]) || rowTs === String(ids[k])) {
            sheet.getRange(j + 1, colAcknowledged + 1).setValue(true);
            count++;
            break;
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
    return { sent: false, message: 'Error: ' + e.message };
  }
}
