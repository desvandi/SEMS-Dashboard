/**
 * @file BatterySensor.cpp
 * @brief Battery sensor implementation using INA219 with ADC backup
 */

#include "BatterySensor.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

BatterySensor::BatterySensor()
    : _ina219(INA219_ADDRESS),
      _data({}),
      _ina219Addr(INA219_ADDRESS),
      _shuntMilliohm(INA219_SHUNT_RESISTOR_MILLIOHM),
      _maxExpectedA(INA219_MAX_CURRENT_A),
      _lastRead(0),
      _initialized(false),
      _filterIndex(0),
      _filterFilled(false) {
    memset(&_data, 0, sizeof(_data));
    memset(_voltageBuffer, 0, sizeof(_voltageBuffer));
    memset(_currentBuffer, 0, sizeof(_currentBuffer));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

bool BatterySensor::begin(TwoWire* wire) {
    DBG_SENSOR("BatterySensor: Initializing INA219 at 0x%02X...", _ina219Addr);

    _ina219 = Adafruit_INA219(_ina219Addr);

    // Attempt to initialize the INA219 with the specified I2C bus
    if (!_ina219.begin(wire)) {
        _data.ina219Online = false;
        DBG_SENSOR("BatterySensor: INA219 NOT FOUND at 0x%02X!", _ina219Addr);
        return false;
    }

    // Configure INA219 calibration for our shunt resistor and current range
    setCalibration(_shuntMilliohm, _maxExpectedA);

    // Initialize filter buffers with first reading
    float v = _ina219.getBusVoltage_V();
    float i = _ina219.getCurrent_mA() / 1000.0f;
    for (int idx = 0; idx < FILTER_SIZE; idx++) {
        _voltageBuffer[idx] = v;
        _currentBuffer[idx] = i;
    }
    _filterFilled = false;
    _filterIndex = 0;

    _data.ina219Online = true;
    _initialized = true;

    DBG_SENSOR("BatterySensor: INA219 OK (Shunt=%.1fmΩ, Max=%.1fA)",
               _shuntMilliohm, _maxExpectedA);

    // Read initial values
    read();

    return true;
}

// ============================================================================
// CALIBRATION
// ============================================================================

void BatterySensor::setCalibration(float shuntMilliohm, float maxExpectedA) {
    _shuntMilliohm = shuntMilliohm;
    _maxExpectedA = maxExpectedA;

    // INA219 calibration uses 32V bus range and current divider based on
    // shunt resistor value. The library calculates optimal calibration.
    // For higher current ranges, recalculate
    // current_lsb = maxExpectedA / (2^15) = maxExpectedA / 32768
    // cal = trunc(0.04096 / (current_lsb * shuntR))
    float currentLSB = _maxExpectedA / 32768.0f;
    float shuntR = _shuntMilliohm / 1000.0f;
    uint16_t calValue = (uint16_t)(0.04096f / (currentLSB * shuntR));

    _ina219.setCalValue(calValue);

    DBG_SENSOR("BatterySensor: Calibration updated (LSB=%.4fA, cal=%u)",
               currentLSB, calValue);
}

// ============================================================================
// READING
// ============================================================================

bool BatterySensor::read() {
    bool success = false;

    if (_initialized && _data.ina219Online) {
        // Read from INA219
        _data.shuntVoltage = _ina219.getShuntVoltage_mV();
        _data.voltage = _ina219.getBusVoltage_V();
        _data.current = _ina219.getCurrent_mA() / 1000.0f;

        // Apply moving average filter
        _data.voltage = filterVoltage(_data.voltage);
        _data.current = filterCurrent(_data.current);

        // Calculate power (W)
        _data.power = _data.voltage * _data.current;

        _data.dataValid = true;
        _data.timestamp = millis();
        _lastRead = _data.timestamp;
        success = true;
    } else {
        _data.dataValid = false;
    }

    // Always read backup ADC voltage
    _data.backupVoltage = readBackupADC();

    return success;
}

// ============================================================================
// BACKUP ADC READING
// ============================================================================

float BatterySensor::readBackupADC() {
    // GPIO 4 is ADC2_CH0 - note: ADC2 cannot be used while WiFi is active!
    // This is a backup/fallback measurement only.
    int rawADC = analogRead(BATTERY_DIRECT_PIN);

    if (rawADC < 0 || rawADC > 4095) {
        return -1.0f;
    }

    // Assuming voltage divider on the direct measurement as well
    // Adjust ratio based on actual hardware divider
    // For now, using a simple ratio (adjust to match your divider)
    float voltage = (float)rawADC * (ADC_REFERENCE_MV / 1000.0f) / 4095.0f;

    // Apply voltage divider correction from config.h
    voltage *= BATT_VOLT_DIVIDER;

    return voltage;
}

// ============================================================================
// MOVING AVERAGE FILTER
// ============================================================================

float BatterySensor::filterVoltage(float newReading) {
    _voltageBuffer[_filterIndex] = newReading;
    _filterIndex = (_filterIndex + 1) % FILTER_SIZE;
    if (_filterIndex == 0) _filterFilled = true;

    float sum = 0.0f;
    int count = _filterFilled ? FILTER_SIZE : _filterIndex;
    for (int i = 0; i < count; i++) {
        sum += _voltageBuffer[i];
    }
    return sum / count;
}

float BatterySensor::filterCurrent(float newReading) {
    _currentBuffer[_filterIndex] = newReading;
    int idx = _filterIndex;  // Same index as voltage for synchronization
    // (filterIndex already incremented in filterVoltage)

    float sum = 0.0f;
    int count = _filterFilled ? FILTER_SIZE : (idx + 1);
    for (int i = 0; i < count; i++) {
        sum += _currentBuffer[i];
    }
    return sum / count;
}

// ============================================================================
// GETTERS
// ============================================================================

const BatteryData& BatterySensor::getData() const {
    return _data;
}

bool BatterySensor::isOnline() const {
    return _data.ina219Online;
}

unsigned long BatterySensor::getLastReadTime() const {
    return _lastRead;
}
