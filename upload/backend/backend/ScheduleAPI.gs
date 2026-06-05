/**
 * ScheduleAPI.gs — Schedule Management API
 * ==========================================
 * Handles CRUD operations for device schedules.
 *
 * SECURITY v1.1.0:
 *   - User-controlled strings are sanitized before writing to sheets
 *   - Fixed indentation in lock blocks
 *
 * Endpoints:
 *   GET  /api/schedules/get    — Get all schedules (ESP32 or Frontend)
 *   POST /api/schedules/update — Create or update a schedule (Frontend)
 *   POST /api/schedules/delete — Delete a schedule (Frontend)
 */

// ============================================================
// GET /api/schedules/get — Get All Schedules
// ============================================================

/**
 * Return all device schedules.
 * Accepts both device token and user token authentication.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { success, schedules: Array }
 */
function handleSchedulesGet_(reqHeaders) {
  try {
    // Accept both auth methods (avoid double validateUserToken_ call)
    var deviceAuth = validateDeviceToken_(reqHeaders);
    var userPerm = requirePermission_(reqHeaders, 'read');

    if (!deviceAuth.authenticated && !userPerm.authorized) {
      return { success: false, error: 'Authentication required.', code: 401 };
    }

    if (!userPerm.authorized && userPerm.user) {
      return { success: false, error: userPerm.error, code: 403 };
    }

    // Try cache first
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CACHE.SCHEDULES_CACHE_KEY);

    if (cached) {
      var schedules = safeParse_(cached);
      if (schedules) {
        return { success: true, count: schedules.length, schedules: schedules, source: 'cache' };
      }
    }

    // Read from sheet
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.SCHEDULES);

    if (!sheet) {
      return { success: false, error: 'schedules sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];
    var schedules = sheetToScheduleObjects_(data, headers_row);

    cache.put(CACHE.SCHEDULES_CACHE_KEY, safeStringify_(schedules), CACHE.SCHEDULES_CACHE_TTL);

    return {
      success: true,
      count: schedules.length,
      schedules: schedules,
      source: 'spreadsheet'
    };

  } catch (e) {
    console.error('Schedules GET error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/schedules/update — Create or Update a Schedule
// ============================================================

/**
 * Create a new schedule or update an existing one.
 *
 * Expected payload:
 * {
 *   id?: string,
 *   enabled: boolean,
 *   target: string (device ID),
 *   action: "ON" | "OFF",
 *   time: string (HH:MM),
 *   days: Array<number> (0=Sun ... 6=Sat),
 *   type: "recurring" | "once",
 *   date?: string (YYYY-MM-DD, required for type="once")
 * }
 *
 * @param {Object} payload - Schedule data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, schedule }
 */
function handleSchedulesUpdate_(payload, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'write');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    // Validate required fields
    if (!payload || !payload.target || !payload.action || !payload.time || !payload.type) {
      return {
        success: false,
        error: 'Missing required fields: target, action, time, type',
        code: 400
      };
    }

    // Validate action
    if (payload.action !== 'ON' && payload.action !== 'OFF') {
      return { success: false, error: 'action must be "ON" or "OFF"', code: 400 };
    }

    // Validate time format (HH:MM)
    if (!/^\d{2}:\d{2}$/.test(payload.time)) {
      return { success: false, error: 'time must be in HH:MM format', code: 400 };
    }
    // Validate time range (hours 0-23, minutes 0-59)
    var timeParts = payload.time.split(':');
    var hours = parseInt(timeParts[0]);
    var mins = parseInt(timeParts[1]);
    if (hours > 23 || mins > 59) {
      return { success: false, error: 'Invalid time (use HH:MM format)', code: 400 };
    }

    // Validate type
    if (payload.type !== 'recurring' && payload.type !== 'once') {
      return { success: false, error: 'type must be "recurring" or "once"', code: 400 };
    }

    // For "once" type, date is required
    if (payload.type === 'once' && !payload.date) {
      return { success: false, error: 'date is required for one-time schedules (YYYY-MM-DD)', code: 400 };
    }

    // Validate days array (for recurring)
    var days = payload.days;
    if (typeof days === 'string') {
      days = safeParse_(days);
    }
    if (!Array.isArray(days)) {
      days = [];
    }
    // Validate day values (0-6)
    days = days.filter(function(d) { return d >= 0 && d <= 6; });

    // Validate target device exists
    if (!validateDeviceTarget_(payload.target)) {
      return { success: false, error: 'Target device not found: ' + payload.target, code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.SCHEDULES);

      if (!sheet) {
        return { success: false, error: 'schedules sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colId        = headers_row.indexOf('id');
      var colEnabled   = headers_row.indexOf('enabled');
      var colTarget    = headers_row.indexOf('target');
      var colAction    = headers_row.indexOf('action');
      var colTime      = headers_row.indexOf('time');
      var colDays      = headers_row.indexOf('days');
      var colType      = headers_row.indexOf('type');
      var colDate      = headers_row.indexOf('date');
      var colCreatedAt = headers_row.indexOf('created_at');

      var now = getTimestamp_();
      var isUpdate = !!payload.id;
      var scheduleId = isUpdate ? payload.id : generateId_('sch');

      // SECURITY: Sanitize user-controlled strings to prevent formula injection
      var scheduleRow = [
        sanitizeCellValue_(scheduleId),
        payload.enabled !== undefined ? payload.enabled : true,
        sanitizeCellValue_(payload.target),
        payload.action,
        sanitizeCellValue_(payload.time),
        sanitizeCellValue_(safeStringify_(days)),
        payload.type,
        sanitizeCellValue_(payload.date || ''),
        now
      ];

      if (isUpdate) {
        var found = false;
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][colId]) === String(payload.id)) {
            var row = i + 1;
            // Use batch setValues for efficiency
            var updateValues = [[scheduleRow[1], scheduleRow[2], scheduleRow[3], scheduleRow[4], scheduleRow[5], scheduleRow[6], scheduleRow[7]]];
            sheet.getRange(row, colEnabled + 1, 1, 7).setValues(updateValues);
            found = true;
            break;
          }
        }

        if (!found) {
          return { success: false, error: 'Schedule not found: ' + payload.id, code: 404 };
        }
      } else {
        sheet.appendRow(scheduleRow);
      }

      // Invalidate cache
      CacheService.getScriptCache().remove(CACHE.SCHEDULES_CACHE_KEY);

      var schedule = {
        id: scheduleId,
        enabled: scheduleRow[1],
        target: scheduleRow[2],
        action: scheduleRow[3],
        time: scheduleRow[4],
        days: days,
        type: scheduleRow[6],
        date: scheduleRow[7],
        created_at: scheduleRow[8]
      };

      console.log('Schedules: User "' + auth.user.username + '" ' +
                  (isUpdate ? 'updated' : 'created') + ' schedule "' + scheduleId + '"');

      return {
        success: true,
        message: isUpdate ? 'Schedule updated' : 'Schedule created',
        schedule: schedule
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Schedules update error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/schedules/delete — Delete a Schedule
// ============================================================

/**
 * Delete a schedule by ID.
 *
 * @param {Object} payload - { id: string }
 * @param {Object} headers - Request headers
 * @returns {Object} { success, message }
 */
function handleSchedulesDelete_(payload, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'write');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    if (!payload || !payload.id) {
      return { success: false, error: 'Missing schedule ID', code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.SCHEDULES);

      if (!sheet) {
        return { success: false, error: 'schedules sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];
      var colId = headers_row.indexOf('id');

      var found = false;
      for (var i = data.length - 1; i >= 1; i--) {
        if (String(data[i][colId]) === String(payload.id)) {
          sheet.deleteRow(i + 1);
          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, error: 'Schedule not found: ' + payload.id, code: 404 };
      }

      CacheService.getScriptCache().remove(CACHE.SCHEDULES_CACHE_KEY);

      console.log('Schedules: User "' + auth.user.username + '" deleted schedule "' + payload.id + '"');

      return {
        success: true,
        message: 'Schedule deleted: ' + payload.id
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Schedules delete error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert sheet data to schedule objects with parsed JSON fields.
 */
function sheetToScheduleObjects_(data, headers_row) {
  var schedules = [];
  var colDays = headers_row.indexOf('days');

  for (var i = 1; i < data.length; i++) {
    var schedule = {};
    for (var j = 0; j < headers_row.length; j++) {
      var val = data[i][j];
      // Parse JSON fields
      if (j === colDays && typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) { val = []; }
      }
      schedule[headers_row[j]] = val;
    }
    schedule.enabled = schedule.enabled === true || schedule.enabled === 'true';
    schedules.push(schedule);
  }

  return schedules;
}
