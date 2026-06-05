/**
 * @file SOC_Calculator.cpp
 * @brief SOC Calculator implementation - Coulomb Counting for LiFePO4
 *
 * FIX v1.0.2: EEPROM API updated for ESP32 Core 3.x compatibility.
 *   Replaced: writeUInt32(), writeUInt16(), writeFloat(), readUInt32(), readUInt16(), readFloat()
 *   With: put(addr, val), get(addr, &val)
 *
 * FIX v1.0.2: EEPROM save interval increased from 60s to 300s (5 minutes)
 *   to reduce EEPROM wear. At 300s intervals, ~500k writes to reach 100k limit.
 */

#include "SOC_Calculator.h"
#include "SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

SOC_Calculator::SOC_Calculator()
    : _data({}),
      _capacityAh(BATTERY_CAPACITY_AH),
      _previousCurrent(0.0f),
      _previousUpdateMs(0) {
    memset(&_data, 0, sizeof(_data));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

bool SOC_Calculator::begin(float initialVoltage) {
    DBG_SENSOR("SOC Calculator initializing...");

    // Attempt to load persisted SOC from EEPROM
    if (loadFromEEPROM()) {
        DBG_SENSOR("SOC loaded from EEPROM: %.1f%%, V=%.2f",
                    _data.socPercent, _data.lastVoltage);
    } else {
        // No valid EEPROM data - estimate from voltage
        calibrateFromVoltage(initialVoltage);
        DBG_SENSOR("SOC estimated from voltage (%.2fV): %.1f%%",
                    initialVoltage, _data.socPercent);
    }

    // Initialize timing
    _data.lastVoltage = initialVoltage;
    _data.lastUpdateMs = millis();
    _previousUpdateMs = _data.lastUpdateMs;
    _previousCurrent = 0.0f;

    return true;
}

// ============================================================================
// MAIN UPDATE (Coulomb Counting)
// ============================================================================

void SOC_Calculator::update(float current, float voltage) {
    unsigned long now = millis();
    float dtSeconds = (float)(now - _data.lastUpdateMs) / 1000.0f;

    // Guard against division by zero or excessive dt (e.g., after sleep)
    if (dtSeconds <= 0.0f || dtSeconds > 3600.0f) {
        _data.lastUpdateMs = now;
        _data.lastVoltage = voltage;
        _data.lastCurrent = current;
        _previousUpdateMs = now;
        _previousCurrent = current;
        return;
    }

    // -------------------------------------------------------------------------
    // Coulomb Counting Integration
    // -------------------------------------------------------------------------
    // Use trapezoidal integration for better accuracy:
    //   avg_current = (current_prev + current_curr) / 2.0
    //   delta_Ah = avg_current * dt_seconds / 3600.0
    //   delta_SOC = delta_Ah / capacity_Ah * 100.0
    //
    // Positive current = charging (SOC increases)
    // Negative current = discharging (SOC decreases)
    // -------------------------------------------------------------------------
    float avgCurrent = (_previousCurrent + current) / 2.0f;
    float deltaAh = avgCurrent * dtSeconds / 3600.0f;
    float deltaSOC = (deltaAh / _capacityAh) * 100.0f;

    _data.socPercent += deltaSOC;

    // Check full charge recalibration before clamping
    _data.lastVoltage = voltage;
    _data.lastCurrent = current;
    checkFullCharge(voltage, current);

    // Clamp SOC to valid range
    _data.socPercent = clampSOC(_data.socPercent);

    // Update timing references
    _previousUpdateMs = _data.lastUpdateMs;
    _previousCurrent = current;
    _data.lastUpdateMs = now;

    // FIX v1.0.2: Save to EEPROM every 300 seconds (was 60 seconds)
    // At 300s intervals: ~500k cycles to reach 100k write limit (safe margin)
    static unsigned long lastSave = 0;
    if (now - lastSave >= 300000UL) {
        lastSave = now;
        saveToEEPROM();
    }
}

// ============================================================================
// FULL CHARGE RECALIBRATION
// ============================================================================

void SOC_Calculator::checkFullCharge(float voltage, float current) {
    float absCurrent = fabsf(current);

    if (voltage >= SOC_FULL_V && absCurrent < SOC_FULL_CURRENT_A) {
        // Full charge condition detected
        if (!_data.fullChargeDetected) {
            // Start tracking the 30-minute hold period
            _data.fullChargeDetected = true;
            _data.fullChargeStartMs = millis();
            DBG_SAFETY("Full charge condition detected (V=%.2fV, I=%.2fA)",
                       voltage, current);
        }

        // Check if condition has held for the required duration
        unsigned long holdDuration = millis() - _data.fullChargeStartMs;
        unsigned long requiredHoldMs = (unsigned long)SOC_FULL_HOLD_MIN * 60UL * 1000UL;

        if (holdDuration >= requiredHoldMs && !_data.recalibrated) {
            // Recalibrate SOC to 100%
            _data.socPercent = SOC_MAX_PERCENT;
            _data.recalibrated = true;
            DBG_SAFETY("SOC recalibrated to 100%% (held for %lu minutes)",
                       holdDuration / 60000UL);
            saveToEEPROM();
        }
    } else {
        // Condition not met - reset tracking
        if (_data.fullChargeDetected) {
            _data.fullChargeDetected = false;
            _data.fullChargeStartMs = 0;
        }
    }
}

// ============================================================================
// GETTERS
// ============================================================================

float SOC_Calculator::getSOC() const {
    return _data.socPercent;
}

const SOCData& SOC_Calculator::getData() const {
    return _data;
}

void SOC_Calculator::setSOC(float socPercent) {
    _data.socPercent = clampSOC(socPercent);
}

bool SOC_Calculator::isFullCharge() const {
    return _data.fullChargeDetected;
}

bool SOC_Calculator::wasRecalibrated() const {
    return _data.recalibrated;
}

float SOC_Calculator::getRemainingCapacity() const {
    return (_data.socPercent / 100.0f) * _capacityAh;
}

float SOC_Calculator::getRemainingEnergy() const {
    return getRemainingCapacity() * BATTERY_NOMINAL_V;
}

void SOC_Calculator::setCapacity(float capacityAh) {
    if (capacityAh > 0.0f) {
        _capacityAh = capacityAh;
    }
}

// ============================================================================
// VOLTAGE-BASED CALIBRATION
// ============================================================================

void SOC_Calculator::calibrateFromVoltage(float voltage) {
    _data.socPercent = voltageToSOC(voltage);
    _data.lastVoltage = voltage;
    _data.recalibrated = false;
    DBG_SENSOR("SOC calibrated from voltage: %.1f%% (V=%.2f)",
                _data.socPercent, voltage);
}

float SOC_Calculator::voltageToSOC(float voltage) const {
    // Linear mapping from voltage to SOC percentage
    // LiFePO4 has a flat curve, but linear works for initial estimate
    // Range: 20.0V (0%) to 29.2V (100%)
    if (voltage >= BATTERY_FULL_V) return SOC_MAX_PERCENT;
    if (voltage <= BATTERY_EMPTY_V) return SOC_MIN_PERCENT;

    float soc = ((voltage - BATTERY_EMPTY_V) / (BATTERY_FULL_V - BATTERY_EMPTY_V))
                * 100.0f;
    return clampSOC(soc);
}

float SOC_Calculator::clampSOC(float soc) const {
    if (soc > SOC_MAX_PERCENT) return SOC_MAX_PERCENT;
    if (soc < SOC_MIN_PERCENT) return SOC_MIN_PERCENT;
    return soc;
}

// ============================================================================
// EEPROM PERSISTENCE
// FIX v1.0.2: Replaced deprecated EEPROM API with ESP32 Core 3.x compatible API.
//   Old: writeUInt32(), writeUInt16(), writeFloat(), readUInt32(), readUInt16(), readFloat()
//   New: put(addr, val), get(addr, &val)
// ============================================================================

bool SOC_Calculator::saveToEEPROM() {
    // FIX v1.0.2: Use put() instead of writeUInt32/writeUInt16/writeFloat
    uint32_t magicVal = EEPROM_MAGIC;
    uint16_t versionVal = EEPROM_VERSION;
    EEPROM.put(EEPROM_ADDR_MAGIC, magicVal);
    EEPROM.put(EEPROM_ADDR_VERSION, versionVal);
    EEPROM.put(EEPROM_ADDR_SOC, _data.socPercent);
    EEPROM.put(EEPROM_ADDR_CAL_V, _data.lastVoltage);

    // Write the last current as calibration reference
    EEPROM.put(EEPROM_ADDR_CAL_I, _data.lastCurrent);

    if (!EEPROM.commit()) {
        DBG_SAFETY("EEPROM commit failed during SOC save!");
        return false;
    }
    return true;
}

bool SOC_Calculator::loadFromEEPROM() {
    // FIX v1.0.2: Use get() instead of readUInt32/readUInt16/readFloat
    uint32_t magic = 0;
    EEPROM.get(EEPROM_ADDR_MAGIC, magic);
    uint16_t version = 0;
    EEPROM.get(EEPROM_ADDR_VERSION, version);

    // Validate magic number and version
    if (magic != EEPROM_MAGIC || version != EEPROM_VERSION) {
        DBG_SENSOR("EEPROM SOC data invalid (magic=0x%04X, ver=%d)", magic, version);
        return false;
    }

    float savedSOC = 0.0f;
    float savedVoltage = 0.0f;
    EEPROM.get(EEPROM_ADDR_SOC, savedSOC);
    EEPROM.get(EEPROM_ADDR_CAL_V, savedVoltage);

    // Sanity check on loaded values
    if (savedSOC >= SOC_MIN_PERCENT && savedSOC <= SOC_MAX_PERCENT &&
        savedVoltage >= BATTERY_EMPTY_V && savedVoltage <= BATTERY_FULL_V + 1.0f) {
        _data.socPercent = savedSOC;
        _data.lastVoltage = savedVoltage;
        EEPROM.get(EEPROM_ADDR_CAL_I, _data.lastCurrent);
        return true;
    }

    DBG_SENSOR("EEPROM SOC data out of range (SOC=%.1f, V=%.2f)", savedSOC, savedVoltage);
    return false;
}
