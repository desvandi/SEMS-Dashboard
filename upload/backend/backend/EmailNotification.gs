/**
 * EmailNotification.gs — Email Alarm Notifications
 * ================================================
 * Sends alarm notifications via MailApp.sendEmail() when critical conditions
 * are detected. Implements rate limiting to prevent email spam.
 *
 * Supported alarm triggers:
 *   - low_battery:    Battery voltage < 21V
 *   - overload:       Inverter current > 80A
 *   - sensor_failure: Missing or invalid sensor readings
 *   - overvoltage:    Battery voltage > 29.2V
 *
 * Rate limiting:
 *   - Max 1 email per alarm type per 30 minutes
 *   - Max 20 emails per day total
 *
 * Bilingual format: Indonesian + English
 */

// ============================================================
// HTML ESCAPE HELPER
// ============================================================

/**
 * Escape a string for safe insertion into HTML.
 * Prevents XSS / HTML injection in email bodies.
 *
 * @param {*} str - Value to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml_(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
// MAIN ENTRY: EVALUATE & SEND ALARM EMAIL
// ============================================================

/**
 * Evaluate telemetry data and trigger alarm emails if thresholds are breached.
 * Call this from TelemetryAPI.handlePost after writing telemetry data.
 *
 * @param {Object} telemetry - The telemetry data object just received
 * @returns {Object} { sent: boolean, type: string|null, message: string }
 */
function evaluateAndNotify_(telemetry) {
  var result = { sent: false, types: [], message: 'No alarm triggered' };

  try {
    // Check daily email limit
    if (!checkDailyEmailLimit_()) {
      result.message = 'Daily email limit reached (' + EMAIL_CONFIG.MAX_EMAILS_PER_DAY + '/day)';
      console.log('Email: ' + result.message);
      return result;
    }

    // Get notification email from config
    var recipientEmail = getConfigValue_('notification_email');
    if (!recipientEmail) {
      result.message = 'No notification email configured';
      return result;
    }

    // Evaluate all alarm conditions (returns array of triggered alarms)
    var triggeredAlarms = evaluateAlarmConditions_(telemetry);
    if (!triggeredAlarms || triggeredAlarms.length === 0) {
      return result;
    }

    // Check quiet hours — skip notification if quiet hours are active
    if (isQuietHours_()) {
      result.message = 'Quiet hours active, notifications deferred';
      console.log('Email: ' + result.message);
      return result;
    }

    // Send email for each triggered alarm (respecting rate limits per type)
    var sentCount = 0;
    for (var a = 0; a < triggeredAlarms.length; a++) {
      var alarm = triggeredAlarms[a];

      // Check rate limit for this alarm type
      if (!checkAlarmTypeRateLimit_(alarm.type)) {
        console.log('Email: Rate limited for ' + alarm.type + ' (max 1 per 30 min)');
        continue;
      }

      // Check daily limit before each send
      if (!checkDailyEmailLimit_()) {
        result.message = 'Daily email limit reached (' + EMAIL_CONFIG.MAX_EMAILS_PER_DAY + '/day)';
        break;
      }

      // Send the email
      var sent = sendAlarmEmail_(recipientEmail, alarm);
      if (sent) {
        sentCount++;
        result.types.push(alarm.type);

        // Update rate limit counters
        setAlarmTypeRateLimit_(alarm.type);
        var newCount = incrementDailyEmailCount_();

        // Post-send validation: break if daily limit exceeded
        if (newCount >= EMAIL_CONFIG.MAX_EMAILS_PER_DAY) {
          result.message = 'Daily email limit reached (' + EMAIL_CONFIG.MAX_EMAILS_PER_DAY + '/day)';
          console.log('Email: Alarm email sent: ' + alarm.type + ' to ' + recipientEmail + ' (daily limit reached after send)');
          break;
        }

        console.log('Email: Alarm email sent: ' + alarm.type + ' to ' + recipientEmail);
      }
    }

    if (sentCount > 0) {
      result.sent = true;
      result.message = sentCount + ' alarm email(s) sent';
    } else {
      result.message = 'All triggered alarms were rate limited';
    }

  } catch (e) {
    console.error('Email notification error: ' + e.message);
    result.message = 'Error: ' + e.message;
  }

  return result;
}

// ============================================================
// ALARM CONDITION EVALUATION
// ============================================================

/**
 * Evaluate telemetry against all alarm thresholds.
 * Returns ALL triggered alarms sorted by severity (critical first),
 * or an empty array if no alarms.
 *
 * @param {Object} t - Telemetry data
 * @returns {Array} Array of alarm objects [{ type, severity, message_id, value, threshold }]
 */
function evaluateAlarmConditions_(t) {
  var alarms = [];

  // --- Low Battery Check ---
  var batteryV = parseFloat(t.battery_voltage);
  if (!isNaN(batteryV) && batteryV > 0 && batteryV < THRESHOLDS.LOW_BATTERY_VOLTAGE) {
    alarms.push({
      type: ALARM_TYPE.LOW_BATTERY,
      severity: batteryV < THRESHOLDS.LOW_BATTERY_VOLTAGE * 0.9
        ? ALARM_SEVERITY.CRITICAL
        : ALARM_SEVERITY.WARNING,
      message_id: batteryV < THRESHOLDS.LOW_BATTERY_VOLTAGE * 0.9
        ? 'low_battery_critical' : 'low_battery_warning',
      value: batteryV.toFixed(2) + 'V',
      threshold: THRESHOLDS.LOW_BATTERY_VOLTAGE + 'V'
    });
  }

  // --- Overvoltage Check ---
  if (!isNaN(batteryV) && batteryV > THRESHOLDS.OVERVOLTAGE) {
    alarms.push({
      type: ALARM_TYPE.OVERVOLTAGE,
      severity: batteryV > THRESHOLDS.OVERVOLTAGE * 1.05
        ? ALARM_SEVERITY.CRITICAL
        : ALARM_SEVERITY.WARNING,
      message_id: 'overvoltage',
      value: batteryV.toFixed(2) + 'V',
      threshold: THRESHOLDS.OVERVOLTAGE + 'V'
    });
  }

  // --- Overload Check ---
  var invCurrent = parseFloat(t.inverter_current);
  if (!isNaN(invCurrent) && invCurrent > THRESHOLDS.OVERLOAD_CURRENT) {
    alarms.push({
      type: ALARM_TYPE.OVERLOAD,
      severity: invCurrent > THRESHOLDS.OVERLOAD_CURRENT * 1.2
        ? ALARM_SEVERITY.CRITICAL
        : ALARM_SEVERITY.WARNING,
      message_id: 'overload',
      value: invCurrent.toFixed(2) + 'A',
      threshold: THRESHOLDS.OVERLOAD_CURRENT + 'A'
    });
  }

  // --- Sensor Failure Check ---
  // If voltage is 0 or NaN but uptime > 60s, likely sensor issue
  var uptime = parseInt(t.uptime_seconds) || 0;
  if (uptime > 60 && (isNaN(batteryV) || batteryV === 0)) {
    alarms.push({
      type: ALARM_TYPE.SENSOR_FAILURE,
      severity: ALARM_SEVERITY.CRITICAL,
      message_id: 'sensor_battery',
      value: batteryV,
      threshold: 'N/A'
    });
  }

  // Check for invalid cell voltages (0V on individual cells when battery is charged)
  var soc = parseFloat(t.soc_percent);
  if (!isNaN(soc) && soc > 50) {
    for (var c = 1; c <= 8; c++) {
      var cellV = parseFloat(t['cell' + c + '_v']);
      if (isNaN(cellV) || cellV === 0) {
        alarms.push({
          type: ALARM_TYPE.SENSOR_FAILURE,
          severity: ALARM_SEVERITY.WARNING,
          message_id: 'sensor_cell',
          value: 'cell' + c + '_v=' + cellV,
          threshold: 'N/A'
        });
        break; // Only report one cell sensor failure per evaluation
      }
    }
  }

  // --- Low SoC Check (bonus) ---
  if (!isNaN(soc) && soc < THRESHOLDS.SOC_CRITICAL) {
    alarms.push({
      type: ALARM_TYPE.LOW_BATTERY,
      severity: ALARM_SEVERITY.CRITICAL,
      message_id: 'soc_critical',
      value: soc.toFixed(1) + '%',
      threshold: THRESHOLDS.SOC_CRITICAL + '%'
    });
  } else if (!isNaN(soc) && soc < THRESHOLDS.SOC_LOW) {
    alarms.push({
      type: ALARM_TYPE.LOW_BATTERY,
      severity: ALARM_SEVERITY.WARNING,
      message_id: 'soc_low',
      value: soc.toFixed(1) + '%',
      threshold: THRESHOLDS.SOC_LOW + '%'
    });
  }

  // Sort by severity (critical first), then by order of appearance
  alarms.sort(function(a, b) {
    var order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] || 3) - (order[b.severity] || 3);
  });

  return alarms;
}

// ============================================================
// EMAIL SENDING
// ============================================================

/**
 * Send a formatted alarm email with bilingual content (ID + EN).
 *
 * @param {string} recipient - Email recipient
 * @param {Object} alarm - Alarm object from evaluateAlarmConditions_
 * @returns {boolean} True if email was sent successfully
 */
function sendAlarmEmail_(recipient, alarm) {
  try {
    var subject = getAlarmSubject_(alarm);
    var htmlBody = getAlarmHtmlBody_(alarm);
    var plainBody = getAlarmPlainBody_(alarm);

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      htmlBody: htmlBody,
      plainBody: plainBody,
      name: 'SEMS Alert System'
    });

    return true;
  } catch (e) {
    console.error('Email send failed: ' + e.message);
    return false;
  }
}

// ============================================================
// EMAIL CONTENT GENERATORS
// ============================================================

/**
 * Generate email subject line.
 */
function getAlarmSubject_(alarm) {
  var severityTag = alarm.severity === ALARM_SEVERITY.CRITICAL ? '[CRITICAL]' : '[WARNING]';
  var typeLabels = {
    'low_battery':    'Low Battery / Baterai Rendah',
    'overload':       'Overload Detected / Beban Berlebih',
    'sensor_failure': 'Sensor Failure / Kegagalan Sensor',
    'overvoltage':    'Overvoltage / Tegangan Berlebih'
  };

  return 'SEMS ' + severityTag + ' ' + (typeLabels[alarm.type] || alarm.type);
}

/**
 * Generate HTML email body with bilingual content.
 */
function getAlarmHtmlBody_(alarm) {
  var systemName = getConfigValue_('system_name') || 'SEMS - Smart Energy Management System';
  var timestamp = getTimestamp_();
  var value = escapeHtml_(alarm.value);
  var threshold = escapeHtml_(alarm.threshold);

  // Bilingual messages
  var messages = {
    'low_battery_critical': {
      id: '<b>PERINGATAN KRITIS:</b> Tegangan baterai sangat rendah (' + value + ')! Segera charge atau kurangi beban.',
      en: '<b>CRITICAL WARNING:</b> Battery voltage critically low (' + value + ')! Charge immediately or reduce load.'
    },
    'low_battery_warning': {
      id: '<b>PERINGATAN:</b> Tegangan baterai rendah (' + value + ') dibawah batas (' + threshold + ').',
      en: '<b>WARNING:</b> Battery voltage low (' + value + ') below threshold (' + threshold + ').'
    },
    'soc_critical': {
      id: '<b>PERINGATAN KRITIS:</b> Level baterai sangat kritis (' + value + ')! Sistem mungkin mati.',
      en: '<b>CRITICAL WARNING:</b> Battery level critically low (' + value + ')! System may shut down.'
    },
    'soc_low': {
      id: '<b>PERINGATAN:</b> Level baterai rendah (' + value + '). Pertimbangkan untuk mengurangi beban.',
      en: '<b>WARNING:</b> Battery level low (' + value + '). Consider reducing load.'
    },
    'overvoltage': {
      id: '<b>PERINGATAN:</b> Tegangan berlebih terdeteksi (' + value + ')! Batas: ' + threshold + '. Putuskan charger segera.',
      en: '<b>WARNING:</b> Overvoltage detected (' + value + ')! Limit: ' + threshold + '. Disconnect charger immediately.'
    },
    'overload': {
      id: '<b>PERINGATAN:</b> Beban berlebih terdeteksi (' + value + ')! Batas: ' + threshold + '. Matikan beberapa perangkat.',
      en: '<b>WARNING:</b> Overload detected (' + value + ')! Limit: ' + threshold + '. Turn off some devices.'
    },
    'sensor_battery': {
      id: '<b>KESALAHAN SENSOR:</b> Sensor baterai tidak membaca data dengan benar (' + value + '). Periksa koneksi sensor.',
      en: '<b>SENSOR FAILURE:</b> Battery sensor not reading data correctly (' + value + '). Check sensor connections.'
    },
    'sensor_cell': {
      id: '<b>KESALAHAN SENSOR:</b> Sensor sel baterai bermasalah (' + value + '). Periksa BMS.',
      en: '<b>SENSOR FAILURE:</b> Battery cell sensor issue (' + value + '). Check BMS connection.'
    }
  };

  var msg = messages[alarm.message_id] || messages['sensor_battery'];

  var html = '<!DOCTYPE html><html><head><style>'
    + 'body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;}'
    + '.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
    + '.header{background:' + (alarm.severity === 'critical' ? '#dc2626' : '#f59e0b') + ';color:#fff;padding:20px;text-align:center;}'
    + '.header h1{margin:0;font-size:20px;}'
    + '.header .severity{font-size:14px;opacity:0.9;margin-top:4px;}'
    + '.content{padding:20px;}'
    + '.msg-block{padding:12px 16px;margin:12px 0;border-radius:6px;border-left:4px solid #ccc;}'
    + '.msg-id{background:#fef3c7;border-left-color:#f59e0b;}'
    + '.msg-en{background:#e0f2fe;border-left-color:#0ea5e9;}'
    + '.msg-label{font-size:11px;font-weight:bold;text-transform:uppercase;margin-bottom:4px;color:#666;}'
    + '.msg-text{font-size:14px;line-height:1.5;}'
    + '.details{margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;font-size:13px;}'
    + '.details table{width:100%;border-collapse:collapse;}'
    + '.details td{padding:6px 0;}'
    + '.details .label{color:#666;width:120px;}'
    + '.footer{text-align:center;padding:16px;color:#999;font-size:12px;border-top:1px solid #eee;}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<div class="header">'
    + '<h1>' + (alarm.severity === 'critical' ? '&#9888;' : '&#9888;') + ' SEMS Alarm</h1>'
    + '<div class="severity">' + alarm.severity.toUpperCase() + ' — ' + alarm.type.replace('_', ' ').toUpperCase() + '</div>'
    + '</div>'
    + '<div class="content">'

    // Indonesian message
    + '<div class="msg-block msg-id">'
    + '<div class="msg-label">Bahasa Indonesia</div>'
    + '<div class="msg-text">' + msg.id + '</div>'
    + '</div>'

    // English message
    + '<div class="msg-block msg-en">'
    + '<div class="msg-label">English</div>'
    + '<div class="msg-text">' + msg.en + '</div>'
    + '</div>'

    // Details
    + '<div class="details">'
    + '<table>'
    + '<tr><td class="label">Alarm Type:</td><td><b>' + escapeHtml_(alarm.type) + '</b></td></tr>'
    + '<tr><td class="label">Severity:</td><td><b>' + escapeHtml_(alarm.severity) + '</b></td></tr>'
    + '<tr><td class="label">Current Value:</td><td>' + escapeHtml_(value) + '</td></tr>'
    + '<tr><td class="label">Threshold:</td><td>' + escapeHtml_(threshold) + '</td></tr>'
    + '<tr><td class="label">Time:</td><td>' + timestamp + '</td></tr>'
    + '</table>'
    + '</div>'

    + '</div>'
    + '<div class="footer">Generated by ' + escapeHtml_(systemName) + '<br>Do not reply to this email.</div>'
    + '</div></body></html>';

  return html;
}

/**
 * Generate plain text email body.
 */
function getAlarmPlainBody_(alarm) {
  var messages = {
    'low_battery_critical': 'CRITICAL: Battery voltage critically low! Charge immediately.',
    'low_battery_warning': 'WARNING: Battery voltage low.',
    'soc_critical': 'CRITICAL: Battery level critically low!',
    'soc_low': 'WARNING: Battery level low.',
    'overvoltage': 'WARNING: Overvoltage detected! Disconnect charger.',
    'overload': 'WARNING: Overload detected! Reduce load.',
    'sensor_battery': 'ERROR: Battery sensor failure.',
    'sensor_cell': 'ERROR: Cell sensor failure.'
  };

  var msg = messages[alarm.message_id] || 'Alarm triggered';
  var line = '='.repeat(50);

  return line + '\n'
    + 'SEMS ALARM NOTIFICATION\n'
    + line + '\n\n'
    + 'Severity: ' + alarm.severity.toUpperCase() + '\n'
    + 'Type:     ' + alarm.type + '\n'
    + 'Value:    ' + alarm.value + '\n'
    + 'Limit:    ' + alarm.threshold + '\n'
    + 'Time:     ' + getTimestamp_() + '\n\n'
    + 'Message:\n' + msg + '\n\n'
    + line + '\n'
    + 'Generated by SEMS - Smart Energy Management System\n'
    + 'Do not reply to this email.\n';
}

// ============================================================
// TEST EMAIL
// ============================================================

/**
 * Send a test notification email to verify email delivery works.
 * Bypasses rate limiting — meant for manual testing by admin.
 *
 * @returns {Object} { sent: boolean, message: string }
 */
function sendTestEmail_() {
  try {
    var recipientEmail = getConfigValue_('notification_email');
    if (!recipientEmail) {
      return { sent: false, message: 'No notification email configured. Set notification_email in Settings first.' };
    }

    var systemName = getConfigValue_('system_name') || 'SEMS - Smart Energy Management System';
    var timestamp = getTimestamp_();

    var subject = 'SEMS Test Notification / Notifikasi Test';

    var htmlBody = '<!DOCTYPE html><html><head><style>'
      + 'body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;}'
      + '.container{max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);}'
      + '.header{background:#3b82f6;color:#fff;padding:20px;text-align:center;}'
      + '.header h1{margin:0;font-size:20px;}'
      + '.content{padding:20px;}'
      + '.msg-block{padding:16px;margin:12px 0;border-radius:6px;border-left:4px solid #3b82f6;background:#eff6ff;}'
      + '.msg-text{font-size:14px;line-height:1.6;}'
      + '.details{margin-top:16px;padding:12px;background:#f8fafc;border-radius:6px;font-size:13px;}'
      + '.details table{width:100%;border-collapse:collapse;}'
      + '.details td{padding:6px 0;}'
      + '.details .label{color:#666;width:120px;}'
      + '.footer{text-align:center;padding:16px;color:#999;font-size:12px;border-top:1px solid #eee;}'
      + '</style></head><body>'
      + '<div class="container">'
      + '<div class="header">'
      + '<h1>&#9993; SEMS Test Notification</h1>'
      + '</div>'
      + '<div class="content">'
      + '<div class="msg-block">'
      + '<div class="msg-label" style="font-size:11px;font-weight:bold;text-transform:uppercase;margin-bottom:4px;color:#666;">Bahasa Indonesia</div>'
      + '<div class="msg-text">Ini adalah notifikasi test dari sistem SEMS. Jika Anda menerima email ini, maka konfigurasi notifikasi email sudah berfungsi dengan baik.</div>'
      + '</div>'
      + '<div class="msg-block" style="border-left-color:#0ea5e9;background:#e0f2fe;">'
      + '<div class="msg-label" style="font-size:11px;font-weight:bold;text-transform:uppercase;margin-bottom:4px;color:#666;">English</div>'
      + '<div class="msg-text">This is a test notification from the SEMS system. If you received this email, your email notification configuration is working correctly.</div>'
      + '</div>'
      + '<div class="details">'
      + '<table>'
      + '<tr><td class="label">Recipient:</td><td><b>' + escapeHtml_(recipientEmail) + '</b></td></tr>'
      + '<tr><td class="label">Time:</td><td>' + timestamp + '</td></tr>'
      + '<tr><td class="label">Status:</td><td><b style="color:#22c55e;">Success</b></td></tr>'
      + '</table>'
      + '</div>'
      + '</div>'
      + '<div class="footer">Generated by ' + escapeHtml_(systemName) + '<br>Do not reply to this email.</div>'
      + '</div></body></html>';

    var plainBody = '='.repeat(50) + '\n'
      + 'SEMS TEST NOTIFICATION\n'
      + '='.repeat(50) + '\n\n'
      + 'This is a test notification from the SEMS system.\n'
      + 'If you received this email, your email notification\n'
      + 'configuration is working correctly.\n\n'
      + 'Recipient: ' + recipientEmail + '\n'
      + 'Time: ' + timestamp + '\n'
      + 'Status: Success\n\n'
      + '='.repeat(50) + '\n'
      + 'Generated by ' + systemName + '\n';

    MailApp.sendEmail({
      to: recipientEmail,
      subject: subject,
      htmlBody: htmlBody,
      plainBody: plainBody,
      name: 'SEMS Alert System'
    });

    console.log('Email: Test email sent to ' + recipientEmail);
    return { sent: true, message: 'Test email sent to ' + recipientEmail };

  } catch (e) {
    console.error('Email: Test email failed: ' + e.message);
    return { sent: false, message: 'Failed to send test email: ' + e.message };
  }
}

// ============================================================
// QUIET HOURS
// ============================================================

/**
 * Check if the current time falls within configured quiet hours.
 * Quiet hours suppress email notifications to avoid disturbances.
 * Config keys: quiet_hours_enabled (1=true), quiet_hours_start (0-23), quiet_hours_end (0-23).
 * Handles overnight ranges (e.g., 22:00 to 06:00) where start > end.
 *
 * @returns {boolean} True if currently in quiet hours
 */
function isQuietHours_() {
  try {
    var config = getConfigValue_('quiet_hours_enabled');
    if (config !== '1' && config !== 'true') return false;
    var start = parseInt(getConfigValue_('quiet_hours_start') || '22');
    var end = parseInt(getConfigValue_('quiet_hours_end') || '6');
    var now = new Date();
    var tz = getTimezone_();
    var tzNow = Utilities.formatDate(now, tz, 'HH');
    var hour = parseInt(tzNow);
    if (start > end) {
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  } catch (e) {
    return false;
  }
}

// ============================================================
// RATE LIMITING
// ============================================================

/**
 * Check if the daily email limit has been reached.
 *
 * @returns {boolean} True if under the limit
 */
function checkDailyEmailLimit_() {
  var cache = CacheService.getScriptCache();
  // Use date-stamped key so counter resets at midnight in configured timezone
  var today = Utilities.formatDate(new Date(), getTimezone_(), 'yyyy-MM-dd');
  var dailyKey = EMAIL_CONFIG.DAILY_COUNTER_CACHE_KEY + '_' + today;
  var countStr = cache.get(dailyKey);

  if (!countStr) return true;

  var count = parseInt(countStr) || 0;
  return count < EMAIL_CONFIG.MAX_EMAILS_PER_DAY;
}

/**
 * Increment the daily email counter.
 * Returns the new count for post-send validation.
 *
 * @returns {number} The new daily email count
 */
function incrementDailyEmailCount_() {
  var cache = CacheService.getScriptCache();
  // Use date-stamped key so counter resets at midnight in configured timezone
  var today = Utilities.formatDate(new Date(), getTimezone_(), 'yyyy-MM-dd');
  var dailyKey = EMAIL_CONFIG.DAILY_COUNTER_CACHE_KEY + '_' + today;
  var countStr = cache.get(dailyKey);
  var count = (parseInt(countStr) || 0) + 1;

  // Cache until end of day (auto-resets next day with new key)
  var endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  var ttlSeconds = Math.max(1, Math.round((endOfDay.getTime() - Date.now()) / 1000));
  cache.put(dailyKey, String(count), ttlSeconds);

  return count;
}

/**
 * Check if enough time has passed since the last email for this alarm type.
 *
 * @param {string} alarmType - The alarm type (e.g., "low_battery")
 * @returns {boolean} True if we can send (rate limit not hit)
 */
function checkAlarmTypeRateLimit_(alarmType) {
  var cache = CacheService.getScriptCache();
  var cacheKey = EMAIL_CONFIG.RATE_LIMIT_CACHE_PREFIX + alarmType;
  var lastSent = cache.get(cacheKey);

  if (!lastSent) return true;

  var lastSentTime = parseInt(lastSent) || 0;
  var elapsed = Date.now() - lastSentTime;

  return elapsed >= EMAIL_CONFIG.MAX_PER_TYPE_INTERVAL_MS;
}

/**
 * Record that an email was just sent for this alarm type.
 *
 * @param {string} alarmType - The alarm type
 */
function setAlarmTypeRateLimit_(alarmType) {
  var cache = CacheService.getScriptCache();
  var cacheKey = EMAIL_CONFIG.RATE_LIMIT_CACHE_PREFIX + alarmType;
  var ttlSeconds = Math.round(EMAIL_CONFIG.MAX_PER_TYPE_INTERVAL_MS / 1000);

  cache.put(cacheKey, String(Date.now()), ttlSeconds);
}
