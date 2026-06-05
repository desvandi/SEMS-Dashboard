/**
 * RuleAPI.gs — Automation Rule Management API
 * =============================================
 * Handles CRUD operations for automation rules.
 *
 * SECURITY v1.1.0:
 *   - User-controlled strings are sanitized before writing to sheets
 *   - Fixed indentation in lock blocks
 *
 * Endpoints:
 *   GET  /api/rules/get    — Get all automation rules (ESP32 or Frontend)
 *   POST /api/rules/update — Create or update an automation rule (Frontend)
 *   POST /api/rules/delete — Delete an automation rule (Frontend)
 */

// ============================================================
// GET /api/rules/get — Get All Automation Rules
// ============================================================

/**
 * Return all automation rules.
 * Accepts both device token and user token authentication.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { success, rules: Array }
 */
function handleRulesGet_(reqHeaders) {
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
    var cached = cache.get(CACHE.RULES_CACHE_KEY);

    if (cached) {
      var rules = safeParse_(cached);
      if (rules) {
        return { success: true, count: rules.length, rules: rules, source: 'cache' };
      }
    }

    // Read from sheet
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.AUTOMATION_RULES);

    if (!sheet) {
      return { success: false, error: 'automation_rules sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];
    var rules = sheetToRuleObjects_(data, headers_row);

    // Cache result
    cache.put(CACHE.RULES_CACHE_KEY, safeStringify_(rules), CACHE.RULES_CACHE_TTL);

    return {
      success: true,
      count: rules.length,
      rules: rules,
      source: 'spreadsheet'
    };

  } catch (e) {
    console.error('Rules GET error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/rules/update — Create or Update a Rule
// ============================================================

/**
 * Create a new automation rule or update an existing one.
 * If payload contains an existing 'id', it updates; otherwise creates new.
 *
 * Expected payload:
 * {
 *   id?: string,
 *   enabled: boolean,
 *   target: string (device ID),
 *   logic: "AND" | "OR",
 *   conditions: Array<string> (JSON condition strings),
 *   action: "ON" | "OFF",
 *   priority: number
 * }
 *
 * @param {Object} payload - Rule data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, rule }
 */
function handleRulesUpdate_(payload, reqHeaders) {
  try {
    // Auth: user with write permission
    var auth = requirePermission_(reqHeaders, 'write');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    // Validate required fields
    if (!payload || !payload.target || !payload.logic || !payload.action) {
      return {
        success: false,
        error: 'Missing required fields: target, logic, action',
        code: 400
      };
    }

    // Validate logic
    if (payload.logic !== 'AND' && payload.logic !== 'OR') {
      return { success: false, error: 'logic must be "AND" or "OR"', code: 400 };
    }

    // Validate action
    if (payload.action !== 'ON' && payload.action !== 'OFF') {
      return { success: false, error: 'action must be "ON" or "OFF"', code: 400 };
    }

    // Validate conditions
    var conditions = payload.conditions;
    if (typeof conditions === 'string') {
      conditions = safeParse_(conditions);
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      return { success: false, error: 'conditions must be a non-empty array', code: 400 };
    }
    // Truncate condition strings to prevent excessively long values
    conditions = conditions.map(function(c) {
      return String(c).substring(0, 200);
    });

    // Validate target device exists
    if (!validateDeviceTarget_(payload.target)) {
      return { success: false, error: 'Target device not found: ' + payload.target, code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.AUTOMATION_RULES);

      if (!sheet) {
        return { success: false, error: 'automation_rules sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colId         = headers_row.indexOf('id');
      var colEnabled    = headers_row.indexOf('enabled');
      var colTarget     = headers_row.indexOf('target');
      var colLogic      = headers_row.indexOf('logic');
      var colConditions = headers_row.indexOf('conditions');
      var colAction     = headers_row.indexOf('action');
      var colPriority   = headers_row.indexOf('priority');
      var colCreatedAt  = headers_row.indexOf('created_at');
      var colUpdatedAt  = headers_row.indexOf('updated_at');

      var now = getTimestamp_();
      var isUpdate = !!payload.id;

      // Build the rule row
      var ruleId = isUpdate ? payload.id : generateId_('rule');

      // SECURITY: Sanitize user-controlled strings to prevent formula injection
      var ruleRow = [
        sanitizeCellValue_(ruleId),
        payload.enabled !== undefined ? payload.enabled : true,
        sanitizeCellValue_(payload.target),
        payload.logic,
        sanitizeCellValue_(safeStringify_(conditions)),
        payload.action,
        payload.priority !== undefined ? parseInt(payload.priority) : 0,
        now,
        now
      ];

      if (isUpdate) {
        // Find and update existing rule
        var found = false;
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][colId]) === String(payload.id)) {
            var row = i + 1;
            // Use batch setValues for efficiency
            var updateValues = [[ruleRow[1], ruleRow[2], ruleRow[3], ruleRow[4], ruleRow[5], ruleRow[6], data[i][colCreatedAt], now]];
            sheet.getRange(row, colEnabled + 1, 1, 8).setValues(updateValues);
            found = true;
            break;
          }
        }

        if (!found) {
          return { success: false, error: 'Rule not found: ' + payload.id, code: 404 };
        }
      } else {
        // SECURITY: Sanitize all values before appending
        sheet.appendRow(ruleRow);
      }

      // Invalidate cache
      CacheService.getScriptCache().remove(CACHE.RULES_CACHE_KEY);

      // Build response object
      var rule = {
        id: ruleId,
        enabled: ruleRow[1],
        target: ruleRow[2],
        logic: ruleRow[3],
        conditions: conditions,
        action: ruleRow[5],
        priority: ruleRow[6],
        created_at: ruleRow[7],
        updated_at: now
      };

      console.log('Rules: User "' + auth.user.username + '" ' +
                  (isUpdate ? 'updated' : 'created') + ' rule "' + ruleId + '"');

      return {
        success: true,
        message: isUpdate ? 'Rule updated' : 'Rule created',
        rule: rule
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Rules update error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/rules/delete — Delete a Rule
// ============================================================

/**
 * Delete an automation rule by ID.
 *
 * @param {Object} payload - { id: string }
 * @param {Object} headers - Request headers
 * @returns {Object} { success, message }
 */
function handleRulesDelete_(payload, reqHeaders) {
  try {
    var auth = requirePermission_(reqHeaders, 'write');
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    if (!payload || !payload.id) {
      return { success: false, error: 'Missing rule ID', code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.AUTOMATION_RULES);

      if (!sheet) {
        return { success: false, error: 'automation_rules sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];
      var colId = headers_row.indexOf('id');

      var found = false;
      // Delete from bottom to preserve row indices
      for (var i = data.length - 1; i >= 1; i--) {
        if (String(data[i][colId]) === String(payload.id)) {
          sheet.deleteRow(i + 1);
          found = true;
          break;
        }
      }

      if (!found) {
        return { success: false, error: 'Rule not found: ' + payload.id, code: 404 };
      }

      CacheService.getScriptCache().remove(CACHE.RULES_CACHE_KEY);

      console.log('Rules: User "' + auth.user.username + '" deleted rule "' + payload.id + '"');

      return {
        success: true,
        message: 'Rule deleted: ' + payload.id
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Rules delete error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert sheet data to rule objects with parsed JSON fields.
 */
function sheetToRuleObjects_(data, headers_row) {
  var rules = [];
  var colConditions = headers_row.indexOf('conditions');

  for (var i = 1; i < data.length; i++) {
    var rule = {};
    for (var j = 0; j < headers_row.length; j++) {
      var val = data[i][j];
      // Parse JSON fields
      if (j === colConditions && typeof val === 'string') {
        try { val = JSON.parse(val); } catch (e) { val = []; }
      }
      rule[headers_row[j]] = val;
    }
    // Ensure boolean for enabled
    rule.enabled = rule.enabled === true || rule.enabled === 'true';
    rules.push(rule);
  }

  return rules;
}
