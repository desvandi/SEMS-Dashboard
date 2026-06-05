/**
 * ConfigAPI.gs — Configuration Management API
 * ==============================================
 * Handles reading and updating system configurations.
 *
 * SECURITY v1.1.0:
 *   - Sensitive keys are masked ("***") in GET responses
 *   - User-controlled values are sanitized before writing to sheets
 *
 * Endpoints:
 *   GET  /api/config/get   — Get all configurations
 *   POST /api/config/update — Update configuration(s)
 */

// ============================================================
// GET /api/config/get — Get All Configurations
// ============================================================

/**
 * Return all system configurations as key-value pairs.
 * Sensitive keys (device_token, admin_password, etc.) are masked as "***".
 * Accepts both device token and user token authentication.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { success, configs: Array }
 */
function handleConfigGet_(reqHeaders) {
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
    var cached = cache.get(CACHE.CONFIG_CACHE_KEY);

    if (cached) {
      var configs = safeParse_(cached);
      if (configs) {
        return { success: true, count: configs.length, configs: configs, source: 'cache' };
      }
    }

    // Read from sheet
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.CONFIGURATIONS);

    if (!sheet) {
      return { success: false, error: 'configurations sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    var colKey   = headers_row.indexOf('key');
    var colValue = headers_row.indexOf('value');
    var colDesc  = headers_row.indexOf('description');
    var colUpdated = headers_row.indexOf('updated_at');

    var configs = [];

    for (var i = 1; i < data.length; i++) {
      var configKey = String(data[i][colKey]);
      var configValue = String(data[i][colValue]);

      // SECURITY: Mask sensitive keys in GET response
      var isSensitive = false;
      for (var s = 0; s < SENSITIVE_KEYS.length; s++) {
        if (configKey === SENSITIVE_KEYS[s]) {
          isSensitive = true;
          break;
        }
      }

      configs.push({
        key:         configKey,
        value:       isSensitive ? '***' : configValue,
        description: data[i][colDesc],
        updated_at:  data[i][colUpdated],
        sensitive:   isSensitive
      });
    }

    // Cache result
    cache.put(CACHE.CONFIG_CACHE_KEY, safeStringify_(configs), CACHE.CONFIG_CACHE_TTL);

    return {
      success: true,
      count: configs.length,
      configs: configs,
      source: 'spreadsheet'
    };

  } catch (e) {
    console.error('Config GET error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/config/update — Update Configuration(s)
// ============================================================

/**
 * Update one or more configuration values. Admin only for sensitive keys.
 *
 * Payload options:
 *   Single update: { key: "key_name", value: "new_value" }
 *   Bulk update:   { updates: [{ key: "k1", value: "v1" }, { key: "k2", value: "v2" }] }
 *
 * Sensitive keys (admin-only): device_token, notification_email
 *
 * @param {Object} payload - Config update data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, updated: Array }
 */
function handleConfigUpdate_(payload, reqHeaders) {
  try {
    // Auth: require user with config permission (admin only)
    var auth = requirePermission_(reqHeaders, 'config');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    if (!payload) {
      return { success: false, error: 'No payload provided', code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.CONFIGURATIONS);

      if (!sheet) {
        return { success: false, error: 'configurations sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colKey      = headers_row.indexOf('key');
      var colValue    = headers_row.indexOf('value');
      var colUpdated  = headers_row.indexOf('updated_at');

      if (colKey === -1 || colValue === -1 || colUpdated === -1) {
        return { success: false, error: 'Invalid configurations sheet structure', code: 500 };
      }

      // Build list of updates to apply
      var updates = [];

      if (payload.updates && Array.isArray(payload.updates)) {
        updates = payload.updates;
      } else if (payload.key && payload.value !== undefined) {
        updates = [{ key: payload.key, value: String(payload.value) }];
      } else if (payload.send_test_email) {
        // Special action: send test email instead of saving a config value
        var testResult = sendTestEmail_();
        return {
          success: testResult.sent,
          message: testResult.message,
          code: testResult.sent ? 200 : 400
        };
      } else {
        return { success: false, error: 'Provide { key, value } or { updates: [...] }', code: 400 };
      }

      // Sensitive keys that require admin
      // Action keys that are handled above and should not be saved
      var actionKeys = ['send_test_email'];
      var sensitiveKeys = ['device_token', 'notification_email'];

      var applied = [];
      var now = getTimestamp_();

      for (var u = 0; u < updates.length; u++) {
        var update = updates[u];
        if (!update.key) continue;

        // Skip action keys (should not be saved to spreadsheet)
        if (actionKeys.indexOf(update.key) !== -1) continue;

        // Check sensitivity
        if (sensitiveKeys.indexOf(update.key) !== -1 && auth.user.role !== USER_ROLE.ADMIN) {
          return {
            success: false,
            error: 'Cannot modify sensitive key "' + update.key + '". Admin role required.',
            code: 403
          };
        }

        // Validate email format for notification_email
        if (update.key === 'notification_email' && update.value) {
          // B-15: Header-injection check — reject if contains \n, \r, or comma
          var emailVal = String(update.value);
          if (emailVal.indexOf('\n') !== -1 || emailVal.indexOf('\r') !== -1 || emailVal.indexOf(',') !== -1) {
            return { success: false, error: 'notification_email contains invalid characters (newlines or commas)', code: 400 };
          }
          var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(emailVal)) {
            return { success: false, error: 'Invalid email format for notification_email', code: 400 };
          }
        }

        // SECURITY: Sanitize user-controlled value to prevent formula injection
        var sanitizedValue = sanitizeCellValue_(String(update.value));

        // Find and update the key
        var found = false;
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][colKey]) === String(update.key)) {
            sheet.getRange(i + 1, colValue + 1).setValue(sanitizedValue);
            sheet.getRange(i + 1, colUpdated + 1).setValue(now);
            found = true;
            applied.push({
              key: update.key,
              value: String(update.value), // Return original value (not sanitized)
              updated_at: now
            });
            break;
          }
        }

        if (!found) {
          // Validate key against whitelist before creating new entry
          var allowedKeys = DEFAULT_CONFIGS.map(function(c) { return c.key; });
          if (allowedKeys.indexOf(update.key) === -1) {
            return { success: false, error: 'Unknown configuration key: ' + update.key, code: 400 };
          }
          // Create new config entry
          sheet.appendRow([sanitizeCellValue_(update.key), sanitizedValue, '', now]);
          applied.push({
            key: update.key,
            value: String(update.value),
            updated_at: now,
            created: true
          });
        }
      }

      // Invalidate relevant caches
      var cache = CacheService.getScriptCache();
      cache.remove(CACHE.CONFIG_CACHE_KEY);
      cache.remove(AUTH.DEVICE_TOKEN_CACHE_KEY);
      // Invalidate config value cache (defined in Auth.gs)
      _configCache_ = null;
      _configCacheTime_ = 0;

      // Also invalidate specific caches if config affects them
      var retentionChanged = false;
      for (var a = 0; a < applied.length; a++) {
        if (applied[a].key.indexOf('retention') !== -1) {
          retentionChanged = true;
        }
      }
      if (retentionChanged) {
        console.log('Config: Retention settings changed, will take effect on next cleanup');
      }

      console.log('Config: User "' + auth.user.username + '" updated ' + applied.length + ' config(s)');

      return {
        success: true,
        message: applied.length + ' configuration(s) updated',
        updated: applied
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Config update error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}
