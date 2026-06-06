/**
 * DataCleanup.gs — Automatic Data Cleanup
 * =========================================
 * Removes old records from telemetry_history and alarms sheets.
 * Runs on every telemetry POST to keep data within retention limits.
 * Uses LockService to prevent concurrent cleanup conflicts.
 */

// ============================================================
// MAIN CLEANUP ENTRY POINT
// ============================================================

/**
 * Run all cleanup tasks. Called after every telemetry data insert.
 * Uses LockService to ensure only one cleanup runs at a time.
 *
 * @returns {Object} Cleanup statistics
 */
function runDataCleanup_(skipLock) {
  // T3-BE-002/T3-BE-015: Use cache-based flag instead of global script lock
  // to prevent starvation on other lock consumers (telemetry POST, etc.)
  var stats = {
    telemetry_removed: 0,
    alarms_removed: 0,
    duration_ms: 0
  };

  try {
    if (!skipLock) {
      var cache = CacheService.getScriptCache();
      var runningFlag = cache.get('sems_cleanup_running');
      if (runningFlag === 'true') {
        console.log('Cleanup: Already running (cache flag set), skipping');
        return stats;
      }
      cache.put('sems_cleanup_running', 'true', 300);
    }

    var startTime = Date.now();

    // Cleanup telemetry history (older than configured retention)
    stats.telemetry_removed = cleanupTelemetryHistory_();

    // Cleanup alarms (older than configured retention)
    stats.alarms_removed = cleanupAlarms_();

    stats.duration_ms = Date.now() - startTime;

    if (stats.telemetry_removed > 0 || stats.alarms_removed > 0) {
      console.log('Cleanup: Removed ' + stats.telemetry_removed +
                  ' telemetry rows and ' + stats.alarms_removed +
                  ' alarm rows in ' + stats.duration_ms + 'ms');
    }

  } catch (e) {
    console.error('Cleanup error: ' + e.message);
  } finally {
    if (!skipLock) {
      try {
        CacheService.getScriptCache().remove('sems_cleanup_running');
      } catch (e2) {
        // Cache remove may fail silently
      }
    }
  }

  return stats;
}

// ============================================================
// GENERIC CLEANUP HELPER (B-L-07)
// ============================================================

/**
 * Generic helper to delete old rows from a sheet based on a timestamp column.
 * Refactored from duplicated cleanupTelemetryHistory_ and cleanupAlarms_.
 *
 * @param {string} sheetName - Sheet name constant
 * @param {number} defaultRetentionDays - Default retention if config not set
 * @param {string} configKey - Config key to read retention days from
 * @returns {number} Number of rows removed
 */
function cleanupOldRows_(sheetName, defaultRetentionDays, configKey) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) return 0;

  // T3-BE-001: Use chunked reading to avoid OOM on large sheets
  var lastRow = sheet.getLastRow();
  var numCols = sheet.getLastColumn();
  if (lastRow <= 1 || numCols < 1) return 0;

  // Get retention days from config or use default
  // BE-013 FIX: Use explicit NaN/invalid check instead of || (which treats 0 as falsy)
  var retentionDays = parseInt(getConfigValue_(configKey));
  retentionDays = (isNaN(retentionDays) || retentionDays < 1) ? defaultRetentionDays : retentionDays;

  // BE-007 FIX: Use configured timezone for cutoff date calculation
  // instead of server timezone which may differ from user expectations
  var tz = getTimezone_();
  var nowDate = new Date();
  var cutoffStr = Utilities.formatDate(nowDate, tz, 'yyyy-MM-dd HH:mm:ss');
  var cutoffDate = new Date(cutoffStr);
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  var cutoffTime = cutoffDate.getTime();

  // Read headers first
  var headersRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var colTimestamp = headersRow.indexOf('timestamp');
  if (colTimestamp === -1) return 0;

  // Find all rows to delete using chunked reading (5000 rows at a time)
  var CHUNK_SIZE = 5000;
  var rowsToDelete = [];
  for (var chunkStart = 2; chunkStart <= lastRow; chunkStart += CHUNK_SIZE) {
    var chunkEnd = Math.min(chunkStart + CHUNK_SIZE - 1, lastRow);
    var chunkData = sheet.getRange(chunkStart, 1, chunkEnd - chunkStart + 1, numCols).getValues();

    for (var i = chunkData.length - 1; i >= 0; i--) {
      var cellValue = chunkData[i][colTimestamp];

      var rowTime;
      if (cellValue instanceof Date) {
        rowTime = cellValue.getTime();
      } else {
        var parsed = new Date(String(cellValue));
        rowTime = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
      }

      if (rowTime > 0 && rowTime < cutoffTime) {
        // chunkStart is 1-based, i is 0-based within chunk
        rowsToDelete.push(chunkStart + i); // 1-based row number
      }
    }
  }

  if (rowsToDelete.length === 0) return 0;

  // B-09: Limit batch size to CLEANUP.MAX_BATCH_ROWS to reduce lock hold time
  if (rowsToDelete.length > CLEANUP.MAX_BATCH_ROWS) {
    rowsToDelete = rowsToDelete.slice(0, CLEANUP.MAX_BATCH_ROWS);
    console.log('Cleanup: Batch limited to ' + CLEANUP.MAX_BATCH_ROWS + ' rows (more pending)');
  }

  // Batch delete rows: group consecutive row numbers for efficient deleteRows()
  rowsToDelete.sort(function(a, b) { return b - a; }); // Sort descending

  var deletedCount = 0;
  var ranges = [];
  if (rowsToDelete.length > 0) {
    var rangeStart = rowsToDelete[0];
    var rangeCount = 1;
    for (var j = 1; j < rowsToDelete.length; j++) {
      if (rowsToDelete[j] === rowsToDelete[j - 1] - 1) {
        rangeCount++;
      } else {
        // BE-003 FIX: rangeStart is the highest row number (descending sort),
        // so actual start = rangeStart - rangeCount + 1.
        // e.g., rows [100,99] → rangeStart=100, count=2 → deleteRows(99, 2)
        ranges.push({ start: rangeStart - rangeCount + 1, count: rangeCount });
        rangeStart = rowsToDelete[j];
        rangeCount = 1;
      }
    }
    // BE-003 FIX: Same correction for the final range after the loop
    ranges.push({ start: rangeStart - rangeCount + 1, count: rangeCount });
  }

  for (var r = 0; r < ranges.length; r++) {
    try {
      sheet.deleteRows(ranges[r].start, ranges[r].count);
      deletedCount += ranges[r].count;
    } catch (e) {
      console.warn('Cleanup: Failed to delete range starting at row ' + ranges[r].start + ': ' + e.message);
    }
  }

  return deletedCount;
}

// ============================================================
// TELEMETRY HISTORY CLEANUP (delegates to generic helper)
// ============================================================

/**
 * Remove telemetry_history rows older than the configured retention period.
 *
 * @returns {number} Number of rows removed
 */
function cleanupTelemetryHistory_() {
  return cleanupOldRows_(SHEET.TELEMETRY_HISTORY, CLEANUP.TELEMETRY_HISTORY_MAX_AGE_DAYS, 'data_retention_days');
}

// ============================================================
// ALARMS CLEANUP (delegates to generic helper)
// ============================================================

/**
 * Remove alarm rows older than the configured retention period.
 *
 * @returns {number} Number of rows removed
 */
function cleanupAlarms_() {
  return cleanupOldRows_(SHEET.ALARMS, CLEANUP.ALARMS_MAX_AGE_DAYS, 'alarm_retention_days');
}

// ============================================================
// MANUAL CLEANUP TRIGGER (for testing / scheduled runs)
// ============================================================

/**
 * Standalone function that can be triggered manually or via time-driven trigger.
 * Run this from the GAS script editor or set up a daily trigger.
 *
 * @returns {Object} Cleanup statistics
 */
function runScheduledCleanup() {
  return runDataCleanup_();
}
