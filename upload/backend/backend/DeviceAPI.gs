/**
 * DeviceAPI.gs — Device Management API
 * ======================================
 * Handles device configuration, state management, and manual control.
 *
 * Endpoints:
 *   GET  /api/devices          — Get all devices (ESP32 or Frontend)
 *   POST /api/device/update    — Update device state from ESP32
 *   POST /api/devices/control  — Manual relay control from Frontend
 *   POST /api/device/rename    — Rename a device (user, 'control' permission)
 */

// ============================================================
// GET /api/devices — Get All Device Configurations
// ============================================================

/**
 * Return all device configurations with their current states.
 * Works for both ESP32 (device token) and Frontend (user token) auth.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { success, devices: Array }
 */
function handleDevicesGet_(reqHeaders) {
  try {
    // Accept both device token and user token auth
    var deviceAuth = validateDeviceToken_(reqHeaders);
    var userAuth = validateUserToken_(reqHeaders);

    if (!deviceAuth.authenticated && !userAuth) {
      return { success: false, error: 'Authentication required.', code: 401 };
    }

    // Check user permission if authenticated via user token
    if (userAuth) {
      var perm = requirePermission_(reqHeaders, 'read');
      if (!perm.authorized) {
        return { success: false, error: perm.error, code: 403 };
      }
    }

    // Check cache first (5-minute TTL)
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CACHE.DEVICES_CACHE_KEY);
    if (cached) {
      var result = safeParse_(cached);
      if (result) {
        result.source = 'cache';
        return result;
      }
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.DEVICES);

    if (!sheet) {
      return { success: false, error: 'Devices sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];
    var devices = [];

    for (var i = 1; i < data.length; i++) {
      var device = {};
      for (var j = 0; j < headers_row.length; j++) {
        device[headers_row[j]] = data[i][j];
      }
      // Ensure state is a number
      device.state = parseInt(device.state) || 0;
      devices.push(device);
    }

    var result = {
      success: true,
      count: devices.length,
      devices: devices
    };

    // Cache result for 5 minutes
    cache.put(CACHE.DEVICES_CACHE_KEY, safeStringify_(result), CACHE.DEVICES_CACHE_TTL);

    return result;

  } catch (e) {
    console.error('Devices GET error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/device/update — Update Device State (ESP32)
// ============================================================

/**
 * Update a device's state (called by ESP32 to sync actual hardware state).
 * ESP32 reports the actual state after executing a command.
 *
 * @param {Object} payload - { id: string, state: 0|1, [pwm_value: number] }
 * @param {Object} headers - Request headers
 * @returns {Object} { success, device }
 */
function handleDeviceUpdate_(payload, reqHeaders) {
  try {
    // Auth: device token required
    var auth = validateDeviceToken_(reqHeaders);
    if (!auth.authenticated) {
      return { success: false, error: auth.error, code: 401 };
    }

    // Validate payload
    if (!payload || !payload.id) {
      return { success: false, error: 'Missing device ID', code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.DEVICES);

      if (!sheet) {
        return { success: false, error: 'Devices sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colId          = headers_row.indexOf('id');
      var colState       = headers_row.indexOf('state');
      var colLastChanged = headers_row.indexOf('last_changed');

      if (colId === -1 || colState === -1 || colLastChanged === -1) {
        return { success: false, error: 'Invalid devices sheet structure', code: 500 };
      }

      var found = false;
      var updatedDevice = null;
      var updatedRow = -1;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][colId]) === String(payload.id)) {
          // Update state and timestamp
          sheet.getRange(i + 1, colState + 1).setValue(parseInt(payload.state) || 0);
          sheet.getRange(i + 1, colLastChanged + 1).setValue(getTimestamp_());
          updatedRow = i + 1; // 1-based row number

          found = true;
          break;
        }
      }

      // Re-read the updated row to get fresh data instead of using pre-write snapshot
      if (found && updatedRow > 0) {
        var freshRow = sheet.getRange(updatedRow, 1, 1, headers_row.length).getValues()[0];
        updatedDevice = {};
        for (var j = 0; j < headers_row.length; j++) {
          updatedDevice[headers_row[j]] = freshRow[j];
        }
        updatedDevice.state = parseInt(updatedDevice.state) || 0;
      }

      if (!found) {
        return { success: false, error: 'Device not found: ' + payload.id, code: 404 };
      }

      // Invalidate devices cache
      CacheService.getScriptCache().remove(CACHE.DEVICES_CACHE_KEY);

      return {
        success: true,
        message: 'Device state updated',
        device: updatedDevice
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Device update error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/devices/control — Manual Control from Frontend
// ============================================================

/**
 * Manually control a device (toggle relay/MOSFET) from the frontend.
 * Requires user authentication with 'control' permission.
 * The state change is recorded in the devices sheet.
 * (ESP32 will pick up the change on next poll or via push notification.)
 *
 * @param {Object} payload - { id: string, state: 0|1, [pwm_value: number for MOSFET] }
 * @param {Object} headers - Request headers
 * @returns {Object} { success, device, message }
 */
function handleDevicesControl_(payload, reqHeaders) {
  try {
    // Auth: user with control permission
    var auth = requirePermission_(reqHeaders, 'control');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    // Validate payload
    if (!payload || !payload.id) {
      return { success: false, error: 'Missing device ID', code: 400 };
    }

    if (payload.state === undefined && payload.pwm_value === undefined) {
      return { success: false, error: 'Missing state or pwm_value', code: 400 };
    }

    if (payload.state !== undefined) {
      var s = parseInt(payload.state);
      if (isNaN(s) || (s !== 0 && s !== 1)) {
        return { success: false, error: 'State must be 0 (off) or 1 (on)', code: 400 };
      }
    }

    if (payload.pwm_value !== undefined) {
      var pwm = parseInt(payload.pwm_value);
      if (isNaN(pwm) || pwm < 0 || pwm > 255) {
        return { success: false, error: 'pwm_value must be 0-255', code: 400 };
      }
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.DEVICES);

    if (!sheet) {
      return { success: false, error: 'Devices sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    var colId          = headers_row.indexOf('id');
    var colState       = headers_row.indexOf('state');
    var colMode        = headers_row.indexOf('mode');
    var colLastChanged = headers_row.indexOf('last_changed');

    if (colId === -1 || colState === -1) {
      return { success: false, error: 'Invalid devices sheet structure', code: 500 };
    }

    var found = false;
    var updatedDevice = null;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colId]) === String(payload.id)) {
        // Check if device is in manual or hybrid mode
        var deviceMode = colMode !== -1 ? String(data[i][colMode]) : '';
        if (deviceMode === 'automatic' || deviceMode === 'schedule') {
          // Allow control but warn
          console.log('Devices: User ' + auth.user.username + ' controlling automatic device ' + payload.id);
        }

        // Update state
        var newState = payload.state !== undefined ? (parseInt(payload.state) || 0) : data[i][colState];
        sheet.getRange(i + 1, colState + 1).setValue(newState);
        sheet.getRange(i + 1, colLastChanged + 1).setValue(getTimestamp_());

        // Build updated device object
        updatedDevice = {};
        for (var j = 0; j < headers_row.length; j++) {
          updatedDevice[headers_row[j]] = data[i][j];
        }
        updatedDevice.state = newState;
        updatedDevice.last_changed = getTimestamp_();

        found = true;
        break;
      }
    }

    if (!found) {
      return { success: false, error: 'Device not found: ' + payload.id, code: 404 };
    }

    // Invalidate devices cache
    CacheService.getScriptCache().remove(CACHE.DEVICES_CACHE_KEY);

    // Log control action
    console.log('Devices: User "' + auth.user.username + '" (role: ' + auth.user.role +
                ') set device "' + payload.id + '" to state ' + (updatedDevice.state));

    return {
      success: true,
      message: 'Device control command recorded',
      device: updatedDevice
    };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Device control error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/device/rename — Rename a Device
// ============================================================

/**
 * Rename a device by its ID. Requires user authentication with 'control' permission.
 *
 * Expected payload:
 * {
 *   id: string,
 *   name: string (1-50 characters)
 * }
 *
 * @param {Object} payload - Device rename data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, device, message }
 */
function handleDeviceRename_(payload, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'control');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    if (!payload || !payload.id || !payload.name) {
      return { success: false, error: 'Device ID and new name are required.', code: 400 };
    }

    var newName = String(payload.name).trim();
    if (newName.length < 1 || newName.length > 50) {
      return { success: false, error: 'Device name must be 1-50 characters.', code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.DEVICES);

      if (!sheet) {
        return { success: false, error: 'Devices sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colId   = headers_row.indexOf('id');
      var colName = headers_row.indexOf('name');

      if (colId === -1 || colName === -1) {
        return { success: false, error: 'Invalid devices sheet structure', code: 500 };
      }

      var found = false;
      var updatedDevice = null;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][colId]) === String(payload.id)) {
          sheet.getRange(i + 1, colName + 1).setValue(newName);

          updatedDevice = {};
          for (var j = 0; j < headers_row.length; j++) {
            updatedDevice[headers_row[j]] = data[i][j];
          }
          updatedDevice.name = newName;
          updatedDevice.state = parseInt(updatedDevice.state) || 0;

          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, error: 'Device not found: ' + payload.id, code: 404 };
      }

      CacheService.getScriptCache().remove(CACHE.DEVICES_CACHE_KEY);

      console.log('Devices: User "' + auth.user.username + '" renamed device "' + payload.id + '" to "' + newName + '"');

      return {
        success: true,
        message: 'Device renamed',
        device: updatedDevice
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Device rename error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}
