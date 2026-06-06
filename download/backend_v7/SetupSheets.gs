/**
 * SetupSheets.gs — Spreadsheet Initialization
 * ==============================================
 * Initializes the Google Spreadsheet with all 8 required sheets,
 * including headers and default data.
 *
 * RUN THIS FUNCTION FIRST:
 *   1. Open the GAS script editor
 *   2. Set SPREADSHEET_ID in Config.gs
 *   3. Run setupSheets()
 *   4. Verify all sheets are created
 *
 * This function is idempotent — running it multiple times is safe.
 * Existing data in sheets with valid headers will NOT be overwritten.
 * Only empty sheets or sheets with incorrect headers will be reset.
 */

// ============================================================
// MAIN SETUP FUNCTION
// ============================================================

/**
 * Initialize all 8 sheets in the spreadsheet with proper headers and defaults.
 * Run this function from the Script Editor.
 */
function setupSheets() {
  console.log('=== SEMS Setup Started ===');
  var results = [];

  try {
    var ss = getSpreadsheet_();
    console.log('Using spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')');

    // ---- 1. Create devices sheet ----
    results.push(setupDevicesSheet_(ss));

    // ---- 2. Create telemetry_live sheet ----
    results.push(setupTelemetryLiveSheet_(ss));

    // ---- 3. Create telemetry_history sheet ----
    results.push(setupTelemetryHistorySheet_(ss));

    // ---- 4. Create automation_rules sheet ----
    results.push(setupRulesSheet_(ss));

    // ---- 5. Create schedules sheet ----
    results.push(setupSchedulesSheet_(ss));

    // ---- 6. Create users sheet ----
    results.push(setupUsersSheet_(ss));

    // ---- 7. Create alarms sheet ----
    results.push(setupAlarmsSheet_(ss));

    // ---- 8. Create configurations sheet ----
    results.push(setupConfigurationsSheet_(ss));

    // ---- Final: Set up time-driven trigger for daily cleanup ----
    setupCleanupTrigger_();

    console.log('=== SEMS Setup Complete ===');
    console.log('Results:');
    for (var i = 0; i < results.length; i++) {
      console.log('  ' + results[i]);
    }

  } catch (e) {
    console.error('Setup failed: ' + e.message);
    console.error('Stack: ' + e.stack);
  }
}

// ============================================================
// SHEET SETUP FUNCTIONS
// ============================================================

/**
 * Setup devices sheet with headers and default device data.
 */
function setupDevicesSheet_(ss) {
  var sheetName = SHEET.DEVICES;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  // Check if already set up (has headers)
  var data = sheet.getDataRange().getValues();
  if (data.length > 0 && data[0][0] === 'id') {
    // Check if already has data
    if (data.length > 1) {
      return 'OK: ' + sheetName + ' already exists with ' + (data.length - 1) + ' devices';
    }
  }

  // Clear and set headers
  sheet.clear();
  sheet.appendRow(DEVICES_HEADERS);

  // Format header row
  formatHeaderRow_(sheet, DEVICES_HEADERS.length);

  // Add default devices
  var now = getTimestamp_();
  for (var i = 0; i < DEFAULT_DEVICES.length; i++) {
    var dev = DEFAULT_DEVICES[i];
    sheet.appendRow([
      sanitizeCellValue_(dev.id),
      sanitizeCellValue_(dev.name),
      dev.type,
      dev.channel,
      dev.priority,
      dev.mode,
      0,  // state = OFF
      now  // last_changed
    ]);
  }

  // Set column widths
  sheet.setColumnWidth(1, 120);  // id
  sheet.setColumnWidth(2, 200);  // name
  sheet.setColumnWidth(3, 80);   // type
  sheet.setColumnWidth(4, 80);   // channel
  sheet.setColumnWidth(5, 80);   // priority
  sheet.setColumnWidth(6, 100);  // mode
  sheet.setColumnWidth(7, 60);   // state
  sheet.setColumnWidth(8, 180);  // last_changed

  return 'OK: ' + sheetName + ' created with ' + DEFAULT_DEVICES.length + ' default devices';
}

/**
 * Setup telemetry_live sheet (single-row overwrite area).
 */
function setupTelemetryLiveSheet_(ss) {
  var sheetName = SHEET.TELEMETRY_LIVE;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();
  if (data.length > 0 && data[0][0] === 'timestamp' && data.length > 1) {
    return 'OK: ' + sheetName + ' already exists with data';
  }

  sheet.clear();
  sheet.appendRow(TELEMETRY_HEADERS);
  formatHeaderRow_(sheet, TELEMETRY_HEADERS.length);

  // Add an empty data row (row 2) — this is the overwrite target
  var emptyRow = TELEMETRY_HEADERS.map(function() { return ''; });
  sheet.appendRow(emptyRow);

  return 'OK: ' + sheetName + ' created (1 data row)';
}

/**
 * Setup telemetry_history sheet (append-only area).
 */
function setupTelemetryHistorySheet_(ss) {
  var sheetName = SHEET.TELEMETRY_HISTORY;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();
  if (data.length > 0 && data[0][0] === 'timestamp') {
    return 'OK: ' + sheetName + ' already exists with ' + Math.max(0, data.length - 1) + ' rows';
  }

  sheet.clear();
  sheet.appendRow(TELEMETRY_HEADERS);
  formatHeaderRow_(sheet, TELEMETRY_HEADERS.length);

  return 'OK: ' + sheetName + ' created (empty, append-only)';
}

/**
 * Setup automation_rules sheet.
 */
function setupRulesSheet_(ss) {
  var sheetName = SHEET.AUTOMATION_RULES;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();
  if (data.length > 0 && data[0][0] === 'id') {
    return 'OK: ' + sheetName + ' already exists with ' + Math.max(0, data.length - 1) + ' rules';
  }

  sheet.clear();
  sheet.appendRow(RULES_HEADERS);
  formatHeaderRow_(sheet, RULES_HEADERS.length);

  // Add some example rules
  var now = getTimestamp_();
  var exampleRules = [
    {
      id: 'rule_example_low_soc',
      enabled: false,
      target: 'mosfet_1',
      logic: 'AND',
      conditions: ['soc_percent < 20'],
      action: 'OFF',
      priority: 0
    },
    {
      id: 'rule_example_overload',
      enabled: false,
      target: 'relay_10',
      logic: 'AND',
      conditions: ['inverter_current > 30'],
      action: 'OFF',
      priority: 1
    },
    {
      id: 'rule_example_pir_light',
      enabled: false,
      target: 'relay_5',
      logic: 'OR',
      conditions: ['pir_1 == true', 'pir_2 == true'],
      action: 'ON',
      priority: 2
    }
  ];

  for (var i = 0; i < exampleRules.length; i++) {
    var rule = exampleRules[i];
    sheet.appendRow([
      sanitizeCellValue_(rule.id),
      rule.enabled,
      sanitizeCellValue_(rule.target),
      rule.logic,
      sanitizeCellValue_(safeStringify_(rule.conditions)),
      rule.action,
      rule.priority,
      now,
      now
    ]);
  }

  return 'OK: ' + sheetName + ' created with ' + exampleRules.length + ' example rules';
}

/**
 * Setup schedules sheet.
 */
function setupSchedulesSheet_(ss) {
  var sheetName = SHEET.SCHEDULES;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();
  if (data.length > 0 && data[0][0] === 'id') {
    return 'OK: ' + sheetName + ' already exists with ' + Math.max(0, data.length - 1) + ' schedules';
  }

  sheet.clear();
  sheet.appendRow(SCHEDULES_HEADERS);
  formatHeaderRow_(sheet, SCHEDULES_HEADERS.length);

  // Add example schedules
  var now = getTimestamp_();
  var examples = [
    {
      id: 'sch_example_outdoor_light',
      enabled: false,
      target: 'relay_5',
      action: 'ON',
      time: '18:00',
      days: [1,2,3,4,5], // Mon-Fri
      type: 'recurring',
      date: ''
    },
    {
      id: 'sch_example_water_pump',
      enabled: false,
      target: 'relay_8',
      action: 'ON',
      time: '06:00',
      days: [1,3,5], // Mon, Wed, Fri
      type: 'recurring',
      date: ''
    }
  ];

  for (var i = 0; i < examples.length; i++) {
    var sch = examples[i];
    sheet.appendRow([
      sanitizeCellValue_(sch.id), sch.enabled, sanitizeCellValue_(sch.target),
      sch.action, sch.time,
      sanitizeCellValue_(safeStringify_(sch.days)), sch.type, sanitizeCellValue_(sch.date), now
    ]);
  }

  return 'OK: ' + sheetName + ' created with ' + examples.length + ' example schedules';
}

/**
 * Setup users sheet with default admin user.
 * SECURITY v1.1.0: Sets must_change_password=true for default accounts.
 */
function setupUsersSheet_(ss) {
  var sheetName = SHEET.USERS;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();

  // SECURITY: If sheet exists but doesn't have the must_change_password column, migrate it
  if (data.length > 0 && data[0][0] === 'id') {
    var existingHeaders = data[0];
    if (existingHeaders.indexOf('must_change_password') === -1) {
      // Migration: add the missing column header
      sheet.getRange(1, existingHeaders.length + 1).setValue('must_change_password');
      // Set must_change_password=true for all existing users (force password reset)
      for (var m = 1; m < data.length; m++) {
        sheet.getRange(m + 1, existingHeaders.length + 1).setValue(true);
      }
      console.log('Security: Migrated users sheet — added must_change_password column');
    }
    if (data.length > 1) {
      return 'OK: ' + sheetName + ' already exists with ' + (data.length - 1) + ' user(s)';
    }
  }

  sheet.clear();
  sheet.appendRow(USERS_HEADERS);
  formatHeaderRow_(sheet, USERS_HEADERS.length);

  // Create default admin user
  // SECURITY: must_change_password=true forces password change on first login
  var now = getTimestamp_();
  var adminPasswordHash = getDefaultAdminPasswordHash_();

  sheet.appendRow([
    'usr_admin_001',
    'admin',
    adminPasswordHash,
    USER_ROLE.ADMIN,
    now,
    true,   // active
    true    // SECURITY: must_change_password = true (default credentials)
  ]);

  // Create default technician user
  // SECURITY: must_change_password=true forces password change on first login
  var techPasswordHash = hashPassword_(DEFAULT_ADMIN_PASSWORD || 'changeme_immediately');

  sheet.appendRow([
    'usr_tech_001',
    'technician',
    techPasswordHash,
    USER_ROLE.TECHNICIAN,
    now,
    true,   // active
    true    // SECURITY: must_change_password = true (default credentials)
  ]);

  return 'OK: ' + sheetName + ' created with 2 default users (must_change_password=true)';
}

/**
 * Setup alarms sheet.
 */
function setupAlarmsSheet_(ss) {
  var sheetName = SHEET.ALARMS;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();
  // BE-004 FIX: Check for 'id' (ALARMS_HEADERS[0]) not 'timestamp'
  if (data.length > 0 && data[0][0] === 'id') {
    return 'OK: ' + sheetName + ' already exists with ' + Math.max(0, data.length - 1) + ' alarms';
  }

  sheet.clear();
  sheet.appendRow(ALARMS_HEADERS);
  formatHeaderRow_(sheet, ALARMS_HEADERS.length);

  return 'OK: ' + sheetName + ' created (empty)';
}

/**
 * Setup configurations sheet with default values.
 */
function setupConfigurationsSheet_(ss) {
  var sheetName = SHEET.CONFIGURATIONS;
  var sheet = ensureSheet_(ss, sheetName);

  if (!sheet) return 'FAILED: Could not create ' + sheetName;

  var data = sheet.getDataRange().getValues();
  if (data.length > 0 && data[0][0] === 'key' && data.length > 1) {
    return 'OK: ' + sheetName + ' already exists with ' + (data.length - 1) + ' config(s)';
  }

  sheet.clear();
  sheet.appendRow(CONFIG_HEADERS);
  formatHeaderRow_(sheet, CONFIG_HEADERS.length);

  // Add default configurations
  var now = getTimestamp_();
  for (var i = 0; i < DEFAULT_CONFIGS.length; i++) {
    var cfg = DEFAULT_CONFIGS[i];
    sheet.appendRow([
      sanitizeCellValue_(cfg.key),
      sanitizeCellValue_(cfg.value),
      sanitizeCellValue_(cfg.description),
      now
    ]);
  }

  return 'OK: ' + sheetName + ' created with ' + DEFAULT_CONFIGS.length + ' default configs';
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Ensure a sheet exists in the spreadsheet. Creates if not found.
 *
 * @param {Spreadsheet} ss - Spreadsheet object
 * @param {string} name - Sheet name
 * @returns {Sheet|null} Sheet object or null on failure
 */
function ensureSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    try {
      sheet = ss.insertSheet(name);
      console.log('Created sheet: ' + name);
    } catch (e) {
      console.error('Failed to create sheet "' + name + '": ' + e.message);
      return null;
    }
  }

  return sheet;
}

/**
 * Format the header row with bold text and background color.
 *
 * @param {Sheet} sheet - Sheet object
 * @param {number} numCols - Number of columns
 */
function formatHeaderRow_(sheet, numCols) {
  var headerRange = sheet.getRange(1, 1, 1, numCols);

  // Bold text
  headerRange.setFontWeight('bold');

  // Dark background with white text
  headerRange.setBackground('#2d3748');
  headerRange.setFontColor('#ffffff');

  // Freeze header row
  sheet.setFrozenRows(1);
}

/**
 * Set up a time-driven trigger for daily cleanup.
 * Runs at 3:00 AM in the configured timezone.
 */
function setupCleanupTrigger_() {
  // Delete existing cleanup triggers to avoid duplicates
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runScheduledCleanup') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // T3-BE-013: Set script timezone to match configured timezone
  // before creating time-driven trigger, so "3:00 AM" is in the correct timezone
  try {
    ScriptApp.setTimeZone(getTimezone_());
  } catch (e) {
    console.warn('Setup: Could not set script timezone: ' + e.message);
  }

  // Create daily trigger at 3:00 AM
  ScriptApp.newTrigger('runScheduledCleanup')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .create();

  console.log('Scheduled cleanup trigger set for 3:00 AM daily');
}

/**
 * Remove the cleanup trigger (for debugging).
 */
function removeCleanupTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runScheduledCleanup') {
      ScriptApp.deleteTrigger(triggers[i]);
      console.log('Cleanup trigger removed');
    }
  }
}

/**
 * Reset ALL sheets — WARNING: Deletes all data!
 * Run this only if you want to start completely fresh.
 */
function resetAllSheets() {
  var ss = getSpreadsheet_();
  var sheetNames = [
    SHEET.DEVICES, SHEET.TELEMETRY_LIVE, SHEET.TELEMETRY_HISTORY,
    SHEET.AUTOMATION_RULES, SHEET.SCHEDULES, SHEET.USERS,
    SHEET.ALARMS, SHEET.CONFIGURATIONS
  ];

  for (var i = 0; i < sheetNames.length; i++) {
    var sheet = ss.getSheetByName(sheetNames[i]);
    if (sheet) {
      ss.deleteSheet(sheet);
      console.log('Deleted sheet: ' + sheetNames[i]);
    }
  }

  console.log('All SEMS sheets deleted. Run setupSheets() to recreate.');

  // Re-run setup
  setupSheets();
}
