/**
 * @file PIRManager.cpp
 * @brief PIR motion sensor manager implementation
 */

#include "PIRManager.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// PIN MAPPING (matches config.h)
// ============================================================================

const uint8_t PIRManager::_pins[PIR_COUNT] = {
    PIR_1_PIN,   // GPIO 32
    PIR_2_PIN,   // GPIO 33
    PIR_3_PIN,   // GPIO 25
    PIR_4_PIN    // GPIO 26
};

// ============================================================================
// CONSTRUCTOR
// ============================================================================

PIRManager::PIRManager()
    : _data({}),
      _initialized(false) {
    memset(&_data, 0, sizeof(_data));
    _data.dataValid = false;
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void PIRManager::begin() {
    DBG_SENSOR("PIR: Initializing %d motion sensors...", PIR_COUNT);

    for (uint8_t i = 0; i < PIR_COUNT; i++) {
        _data.sensors[i].pin = _pins[i];
        _data.sensors[i].currentState = false;
        _data.sensors[i].previousState = false;
        _data.sensors[i].risingEdge = false;
        _data.sensors[i].fallingEdge = false;
        _data.sensors[i].lastChange = millis();
        _data.sensors[i].motionStart = 0;
        _data.sensors[i].lastMotion = 0;
        _data.sensors[i].enabled = true;
        _data.sensors[i].readCount = 0;

        pinMode(_pins[i], INPUT);  // PIR outputs HIGH/LOW, no pull-up needed

        DBG_SENSOR("PIR: Sensor %d on GPIO %d", i + 1, _pins[i]);
    }

    _initialized = true;
    _data.dataValid = true;

    // Initial read to establish baseline
    update();

    DBG_SENSOR("PIR: All %d sensors initialized", PIR_COUNT);
}

// ============================================================================
// MAIN UPDATE
// ============================================================================

bool PIRManager::update() {
    if (!_initialized) return false;

    bool anyChanged = false;
    _data.anyMotion = false;
    _data.motionMask = 0;

    for (uint8_t i = 0; i < PIR_COUNT; i++) {
        if (!_data.sensors[i].enabled) continue;

        // Read digital pin
        bool rawState = (digitalRead(_data.sensors[i].pin) == HIGH);

        // Apply debounce
        if (rawState != _data.sensors[i].currentState) {
            _data.sensors[i].readCount++;
        } else {
            _data.sensors[i].readCount = 0;
        }

        // State change confirmed after debounce period
        // (In practice, PIR sensors already have built-in debounce,
        //  but we add software debounce for extra reliability)
        if (_data.sensors[i].readCount >= 3) {
            _data.sensors[i].currentState = rawState;
            _data.sensors[i].lastChange = millis();
            _data.sensors[i].readCount = 0;
            anyChanged = true;

            // Detect edges
            if (rawState && !_data.sensors[i].previousState) {
                _data.sensors[i].risingEdge = true;
                _data.sensors[i].motionStart = millis();
                _data.sensors[i].lastMotion = millis();
                DBG_SENSOR("PIR %d: MOTION DETECTED", i + 1);
            }
            if (!rawState && _data.sensors[i].previousState) {
                _data.sensors[i].fallingEdge = true;
                DBG_SENSOR("PIR %d: Motion cleared", i + 1);
            }

            _data.sensors[i].previousState = rawState;
        }

        // Update combined state
        if (_data.sensors[i].currentState) {
            _data.anyMotion = true;
            _data.motionMask |= (1 << i);
            _data.sensors[i].lastMotion = millis();
        }
    }

    _data.timestamp = millis();
    return anyChanged;
}

// ============================================================================
// GETTERS
// ============================================================================

const PIRData& PIRManager::getData() const {
    return _data;
}

bool PIRManager::isAnyMotion() const {
    return _data.anyMotion;
}

bool PIRManager::isMotion(uint8_t sensorIndex) const {
    if (sensorIndex >= PIR_COUNT) return false;
    return _data.sensors[sensorIndex].currentState;
}

bool PIRManager::risingEdge(uint8_t sensorIndex) {
    if (sensorIndex >= PIR_COUNT) return false;
    bool edge = _data.sensors[sensorIndex].risingEdge;
    _data.sensors[sensorIndex].risingEdge = false;  // Clear after reading
    return edge;
}

unsigned long PIRManager::motionDuration(uint8_t sensorIndex) const {
    if (sensorIndex >= PIR_COUNT) return 0;
    if (!_data.sensors[sensorIndex].currentState) return 0;
    return millis() - _data.sensors[sensorIndex].motionStart;
}

void PIRManager::setEnabled(uint8_t sensorIndex, bool enabled) {
    if (sensorIndex < PIR_COUNT) {
        _data.sensors[sensorIndex].enabled = enabled;
    }
}

uint8_t PIRManager::getMotionMask() const {
    return _data.motionMask;
}

bool PIRManager::isMotionTimeout(uint8_t sensorIndex, unsigned long timeoutMs) const {
    if (sensorIndex >= PIR_COUNT) return true;
    if (_data.sensors[sensorIndex].currentState) return false;
    return (millis() - _data.sensors[sensorIndex].lastMotion) >= timeoutMs;
}
