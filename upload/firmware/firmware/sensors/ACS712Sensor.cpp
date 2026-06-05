/**
 * @file ACS712Sensor.cpp
 * @brief ACS712 current sensor implementation with RMS calculation
 */

#include "ACS712Sensor.h"
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

ACS712Sensor::ACS712Sensor()
    : _pin(ACS712_PIN),
      _model(ACS712_MODEL),
      _sensitivity(ACS712_SENSITIVITY),
      _adcToMV(ADC_REFERENCE_MV / 4095.0f),
      _data({}),
      _sampleIndex(0),
      _windowFilled(false) {
    memset(&_data, 0, sizeof(_data));
    memset(_sampleBuffer, 0, sizeof(_sampleBuffer));
}

// ============================================================================
// INITIALIZATION & CALIBRATION
// ============================================================================

bool ACS712Sensor::begin(uint8_t pin, uint8_t model) {
    _pin = pin;
    _model = model;

    // Set ADC characteristics for ESP32
    pinMode(_pin, INPUT);
    analogReadResolution(ADC_RESOLUTION);
    // ESP32 ADC attenuation: 11dB for full 0-3.3V range
    analogSetAttenuation(ADC_11db);

    // Set sensitivity based on ACS712 model
    switch (_model) {
        case 5:  _sensitivity = 185.0f; break;  // ACS712-05B: 185mV/A
        case 20: _sensitivity = 100.0f; break;  // ACS712-20A: 100mV/A
        case 30: _sensitivity = 66.0f;  break;  // ACS712-30A: 66mV/A
        default:
            DBG_SENSOR("ACS712: Unknown model %d, defaulting to 30A", model);
            _sensitivity = 66.0f;
            _model = 30;
            break;
    }

    _adcToMV = ADC_REFERENCE_MV / 4095.0f;

    // Perform zero-current calibration
    DBG_SENSOR("ACS712: Calibrating zero offset (pin=%d, model=%dA)...", _pin, _model);
    _data.zeroOffset = performCalibration();

    if (_data.zeroOffset > 0.0f) {
        _data.calibrated = true;
        DBG_SENSOR("ACS712: Zero offset calibrated to %.1f ADC", _data.zeroOffset);
    } else {
        _data.calibrated = false;
        DBG_SENSOR("ACS712: Calibration FAILED!");
        return false;
    }

    // Reset sample buffer
    memset(_sampleBuffer, 0, sizeof(_sampleBuffer));
    _sampleIndex = 0;
    _windowFilled = false;

    return true;
}

float ACS712Sensor::performCalibration() {
    long sum = 0;
    int validSamples = 0;

    DBG_SENSOR("ACS712: Taking %d zero-current samples...", ACS712_CALIBRATION_SAMPLES);

    for (int i = 0; i < ACS712_CALIBRATION_SAMPLES; i++) {
        int raw = analogRead(_pin);
        if (raw >= 0 && raw <= 4095) {
            sum += raw;
            validSamples++;
        }
        // Small delay between samples to allow ADC to settle
        delayMicroseconds(100);  // Only 100µs acceptable during init
    }

    if (validSamples == 0) {
        DBG_SENSOR("ACS712: No valid calibration samples!");
        return -1.0f;
    }

    float offset = (float)sum / (float)validSamples;
    return offset;
}

// ============================================================================
// SAMPLING
// ============================================================================

float ACS712Sensor::sample() {
    if (!_data.calibrated) return 0.0f;

    // Read raw ADC value
    int raw = analogRead(_pin);
    if (raw < 0 || raw > 4095) return _data.currentA;  // Return last valid

    // Convert to voltage difference from zero offset
    float deltaMV = ((float)raw - _data.zeroOffset) * _adcToMV;

    // Convert to current using sensitivity (mV/A → A)
    float currentA = deltaMV / _sensitivity;

    // Store squared value in RMS window
    _sampleBuffer[_sampleIndex] = currentA * currentA;
    _sampleIndex = (_sampleIndex + 1) % RMS_WINDOW_SIZE;
    if (_sampleIndex == 0) _windowFilled = true;

    return currentA;
}

// ============================================================================
// RMS CALCULATION
// ============================================================================

float ACS712Sensor::calculateRMS() {
    if (!_data.calibrated) return 0.0f;

    float sumSquares = 0.0f;
    float peakAbs = 0.0f;
    int count = _windowFilled ? RMS_WINDOW_SIZE : _sampleIndex;

    if (count == 0) return 0.0f;

    for (int i = 0; i < count; i++) {
        sumSquares += _sampleBuffer[i];
        // For peak detection, we need the unsquared value
        float absVal = sqrtf(_sampleBuffer[i]);
        if (absVal > peakAbs) {
            peakAbs = absVal;
        }
    }

    // RMS = sqrt(mean of squared values)
    float rms = sqrtf(sumSquares / (float)count);

    // Update data structure
    _data.currentA = rms;
    _data.peakCurrentA = peakAbs;
    _data.dataValid = true;
    _data.timestamp = millis();

    return rms;
}

// ============================================================================
// GETTERS
// ============================================================================

const ACS712Data& ACS712Sensor::getData() const {
    return _data;
}

bool ACS712Sensor::isCalibrated() const {
    return _data.calibrated;
}

float ACS712Sensor::getZeroOffset() const {
    return _data.zeroOffset;
}

bool ACS712Sensor::recalibrate() {
    DBG_SENSOR("ACS712: Recalibrating... Ensure no load!");
    float newOffset = performCalibration();
    if (newOffset > 0.0f) {
        _data.zeroOffset = newOffset;
        DBG_SENSOR("ACS712: Recalibrated to %.1f ADC", newOffset);
        return true;
    }
    return false;
}
