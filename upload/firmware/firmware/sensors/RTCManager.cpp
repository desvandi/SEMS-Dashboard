/**
 * @file RTCManager.cpp
 * @brief DS3231 Real-Time Clock manager implementation
 */

#include "RTCManager.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

RTCManager::RTCManager()
    : _rtc(),
      _data({}),
      _initialized(false),
      _lastRead(0) {
    memset(&_data, 0, sizeof(_data));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

bool RTCManager::begin(TwoWire* wire) {
    DBG_SENSOR("RTC: Initializing DS3231 at 0x%02X...", DS3231_ADDRESS);

    if (!_rtc.begin(wire)) {
        _data.rtcOnline = false;
        DBG_SENSOR("RTC: DS3231 NOT FOUND at 0x%02X!", DS3231_ADDRESS);
        return false;
    }

    _data.rtcOnline = true;
    _initialized = true;

    // Check if RTC lost power (oscillator stopped flag)
    if (_rtc.lostPower()) {
        DBG_SENSOR("RTC: WARNING - Oscillator stop detected! Time may be invalid.");
        DBG_SENSOR("RTC: Set time via NTP sync or manual adjustment.");
        _data.dataValid = false;
    } else {
        _data.dataValid = true;
    }

    // Read initial time
    read();

    if (_data.dataValid) {
        DBG_SENSOR("RTC: OK - %s", getFormattedTime().c_str());
    }

    return true;
}

// ============================================================================
// READING
// ============================================================================

bool RTCManager::read() {
    if (!_initialized || !_data.rtcOnline) {
        return false;
    }

    _data.now = _rtc.now();
    _data.unixTime = _data.now.unixtime();
    _data.year = _data.now.year();
    _data.month = _data.now.month();
    _data.day = _data.now.day();
    _data.hour = _data.now.hour();
    _data.minute = _data.now.minute();
    _data.second = _data.now.second();
    _data.dayOfWeek = _data.now.dayOfTheWeek();  // 0=Sun, 1=Mon, ..., 6=Sat
    _data.isPM = (_data.hour >= 12);

    // Read DS3231 internal temperature sensor
    _data.rtcTemperature = _rtc.getTemperature();

    _data.dataValid = true;
    _data.timestamp = millis();
    _lastRead = _data.timestamp;

    return true;
}

// ============================================================================
// TIME SETTING
// ============================================================================

void RTCManager::setTime(uint32_t unixTime) {
    if (!_initialized) return;
    _rtc.adjust(DateTime(unixTime));
    DBG_SENSOR("RTC: Time set to %s (epoch=%lu)",
               getFormattedTime().c_str(), unixTime);
    read();  // Refresh internal data
}

void RTCManager::setTime(const DateTime& dt) {
    if (!_initialized) return;
    _rtc.adjust(dt);
    DBG_SENSOR("RTC: Time set to %s", getFormattedTime().c_str());
    read();
}

// ============================================================================
// TIME RANGE CHECK
// ============================================================================

bool RTCManager::isTimeInRange(uint8_t startHour, uint8_t startMin,
                                uint8_t endHour, uint8_t endMin) const {
    if (!_data.dataValid) return false;

    // Convert current time to minutes since midnight
    uint16_t currentMin = _data.hour * 60 + _data.minute;
    uint16_t startTotal = startHour * 60 + startMin;
    uint16_t endTotal = endHour * 60 + endMin;

    if (startTotal <= endTotal) {
        // Normal range (e.g., 08:00 to 17:00)
        return (currentMin >= startTotal && currentMin <= endTotal);
    } else {
        // Overnight range (e.g., 22:00 to 06:00)
        return (currentMin >= startTotal || currentMin <= endTotal);
    }
}

// ============================================================================
// FORMATTING
// ============================================================================

String RTCManager::getFormattedTime() const {
    if (!_data.dataValid) return String("N/A");

    char buf[24];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d",
             _data.year, _data.month, _data.day,
             _data.hour, _data.minute, _data.second);
    return String(buf);
}

// ============================================================================
// POWER LOSS
// ============================================================================

bool RTCManager::wasPowerLost() const {
    if (!_initialized) return true;  // Assume lost if not initialized
    return _rtc.lostPower();
}

void RTCManager::clearPowerLostFlag() {
    // The lostPower() flag in RTClib reads the DS3231's oscillator stop flag (OSF).
    // To clear it, we need to write to the status register.
    // RTClib handles this when adjust() is called.
    if (_initialized && _rtc.lostPower()) {
        // Re-adjust with current time to clear the flag
        _rtc.adjust(_rtc.now());
        DBG_SENSOR("RTC: Oscillator stop flag cleared.");
    }
}

// ============================================================================
// GETTERS
// ============================================================================

const RTCData& RTCManager::getData() const {
    return _data;
}

uint32_t RTCManager::getUnixTime() const {
    return _data.unixTime;
}

DateTime RTCManager::getDateTime() const {
    return _data.now;
}

bool RTCManager::isOnline() const {
    return _data.rtcOnline;
}

float RTCManager::getRTCTemperature() const {
    return _data.rtcTemperature;
}

unsigned long RTCManager::getLastReadTime() const {
    return _lastRead;
}
