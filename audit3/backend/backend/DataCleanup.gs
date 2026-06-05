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
  var lock = LockService.getScriptLock();
  var stats = {
    telemetry_removed: 0,
    alarms_removed: 0,
    duration_ms: 0
  };

  try {
    if (!skipLock) {
      // Try to acquire lock with a short timeout
      // If another instance is already cleaning up, skip
      var acquired = lock.tryLock(CLEANUP.LOCK_TIMEOUT_MS);
      if (!acquired) {
        console.log('Cleanup: Lock not acquired, skipping cleanup (another instance running)');
        return stats;
      }
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
        lock.releaseLock();
      } catch (e2) {
        // Lock may have already expired
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

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 0; // Only headers

  // Get retention days from config or use default
  var retentionDays = parseInt(getConfigValue_(configKey)) || defaultRetentionDays;

  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  var cutoffTime = cutoffDate.getTime();

  var headers = data[0];
  var colTimestamp = headers.indexOf('timestamp');
  if (colTimestamp === -1) return 0;

  // Find all rows to delete (work backwards)
  var rowsToDelete = [];
  for (var i = data.length - 1; i >= 1; i--) {
    var cellValue = data[i][colTimestamp];

    var rowTime;
    if (cellValue instanceof Date) {
      rowTime = cellValue.getTime();
    } else {
      var parsed = new Date(String(cellValue));
      rowTime = isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    }

    if (rowTime > 0 && rowTime < cutoffTime) {
      rowsToDelete.push(i + 1); // +1 for 1-based row indexing
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
        ranges.push({ start: rangeStart, count: rangeCount });
        rangeStart = rowsToDelete[j];
        rangeCount = 1;
      }
    }
    ranges.push({ start: rangeStart, count: rangeCount });
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
