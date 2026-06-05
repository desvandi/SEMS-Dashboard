/**
 * @file SHT31Sensor.cpp
 * @brief SHT31 temperature/humidity sensor implementation
 */

#include "SHT31Sensor.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

SHT31Sensor::SHT31Sensor()
    : _sht31(),
      _data({}),
      _initialized(false),
      _lastRead(0),
      _filterIndex(0),
      _filterFilled(false) {
    memset(&_data, 0, sizeof(_data));
    memset(_tempBuffer, 0, sizeof(_tempBuffer));
    memset(_humBuffer, 0, sizeof(_humBuffer));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

bool SHT31Sensor::begin(TwoWire* wire) {
    DBG_SENSOR("SHT31: Initializing at 0x%02X...", SHT31_ADDRESS);

    _sht31 = Adafruit_SHT31();

    if (!_sht31.begin(SHT31_ADDRESS, wire)) {
        _data.sensorOnline = false;
        DBG_SENSOR("SHT31: NOT FOUND at 0x%02X!", SHT31_ADDRESS);
        return false;
    }

    // Disable heater by default
    _sht31.heater(false);

    _data.sensorOnline = true;
    _initialized = true;

    // Initialize filter buffers with first reading
    float t = _sht31.readTemperature();
    float h = _sht31.readHumidity();
    for (int i = 0; i < FILTER_SIZE; i++) {
        _tempBuffer[i] = isnan(t) ? 25.0f : t;
        _humBuffer[i] = isnan(h) ? 50.0f : h;
    }

    DBG_SENSOR("SHT31: OK (Heater=%s)",
               _sht31.isHeaterEnabled() ? "ON" : "OFF");

    read();
    return true;
}

// ============================================================================
// READING
// ============================================================================

bool SHT31Sensor::read() {
    if (!_initialized || !_data.sensorOnline) {
        return false;
    }

    float t = _sht31.readTemperature();
    float h = _sht31.readHumidity();

    // Check for NaN (communication error)
    if (isnan(t) || isnan(h)) {
        _data.dataValid = false;
        return false;
    }

    // Apply moving average filter
    _data.temperature = filterTemperature(t);
    _data.humidity = filterHumidity(h);

    _data.dataValid = true;
    _data.timestamp = millis();
    _lastRead = _data.timestamp;

    return true;
}

// ============================================================================
// MOVING AVERAGE FILTER
// ============================================================================

float SHT31Sensor::filterTemperature(float newReading) {
    _tempBuffer[_filterIndex] = newReading;
    _filterIndex = (_filterIndex + 1) % FILTER_SIZE;
    if (_filterIndex == 0) _filterFilled = true;

    float sum = 0.0f;
    int count = _filterFilled ? FILTER_SIZE : _filterIndex;
    for (int i = 0; i < count; i++) {
        sum += _tempBuffer[i];
    }
    return sum / count;
}

float SHT31Sensor::filterHumidity(float newReading) {
    // Use a separate index tracking for humidity (shares filter index with temp)
    _humBuffer[(_filterIndex > 0 ? _filterIndex - 1 : FILTER_SIZE - 1)] = newReading;

    float sum = 0.0f;
    int count = _filterFilled ? FILTER_SIZE : _filterIndex;
    for (int i = 0; i < count; i++) {
        sum += _humBuffer[i];
    }
    return sum / count;
}

// ============================================================================
// GETTERS
// ============================================================================

const SHT31Data& SHT31Sensor::getData() const {
    return _data;
}

bool SHT31Sensor::isOnline() const {
    return _data.sensorOnline;
}

unsigned long SHT31Sensor::getLastReadTime() const {
    return _lastRead;
}

void SHT31Sensor::setHeater(bool enabled) {
    if (_initialized) {
        _sht31.heater(enabled);
        DBG_SENSOR("SHT31: Heater %s", enabled ? "ENABLED" : "DISABLED");
    }
}
