/**
 * @file ACS712Sensor.h
 * @brief AC/DC current sensor using ACS712-30A with RMS calculation
 *
 * The ACS712 provides analog output proportional to current:
 * - Vcc/2 (512 ADC = ~2.5V) at 0A
 * - 66mV/A sensitivity for ACS712-30A model
 *
 * Features:
 *   - Zero-offset calibration on startup (100 samples with no load)
 *   - RMS current calculation using moving window of 100 samples at ~1kHz
 *   - Moving average filter for stable readings
 *   - Positive values = current flowing in one direction
 *   - Negative values = current flowing in opposite direction
 *
 * NOTE: ACS712 measures DC current bidirectionally.
 * The sign convention depends on physical wiring orientation.
 */

#ifndef SEMS_ACS712_SENSOR_H
#define SEMS_ACS712_SENSOR_H

#include <Arduino.h>
#include "config.h"

/**
 * @struct ACS712Data
 * @brief Contains current measurement data from the ACS712 sensor.
 */
struct ACS712Data {
    float currentA;          // RMS/average current in Amps
    float peakCurrentA;      // Peak current in the window (A)
    float zeroOffset;        // Calibrated zero-current ADC value
    bool dataValid;          // true if reading is valid
    bool calibrated;         // true if zero-offset calibration completed
    unsigned long timestamp; // millis() of last reading
};

/**
 * @class ACS712Sensor
 * @brief ACS712 current sensor with auto-calibration and RMS calculation.
 */
class ACS712Sensor {
public:
    ACS712Sensor();

    /**
     * @brief Initialize the ACS712 sensor and perform zero calibration.
     *
     * IMPORTANT: Ensure no load current flows during calibration!
     * Takes ~100ms (100 samples × 1ms) to complete.
     *
     * @param pin Analog input pin (default GPIO 34).
     * @param model ACS712 model: 5, 20, or 30 (Amps).
     * @return true if calibration completed successfully.
     */
    bool begin(uint8_t pin = ACS712_PIN, uint8_t model = ACS712_MODEL);

    /**
     * @brief Sample the ACS712 (call at ~1kHz rate).
     *
     * Adds one sample to the RMS calculation window.
     * Call this frequently from a tight loop or timer interrupt.
     * After enough samples, call calculateRMS() for the result.
     *
     * @return Instantaneous current in Amps.
     */
    float sample();

    /**
     * @brief Calculate RMS current from the sample window.
     *
     * Call this after collecting enough samples (e.g., every 100ms
     * after 100 samples at 1kHz).
     *
     * @return RMS current in Amps.
     */
    float calculateRMS();

    /**
     * @brief Get the latest ACS712 data.
     * @return Const reference to the latest ACS712Data.
     */
    const ACS712Data& getData() const;

    /**
     * @brief Check if zero calibration has been completed.
     * @return true if calibrated.
     */
    bool isCalibrated() const;

    /**
     * @brief Manually recalibrate the zero offset.
     *
     * Should be called when no load is present.
     *
     * @return true if calibration succeeded.
     */
    bool recalibrate();

    /**
     * @brief Get the calibrated zero offset ADC value.
     * @return Zero offset (ADC counts, ~2048 for mid-rail).
     */
    float getZeroOffset() const;

private:
    uint8_t _pin;                    // Analog input pin
    uint8_t _model;                  // ACS712 model (5, 20, or 30)
    float _sensitivity;              // mV per Amp
    float _adcToMV;                  // ADC count to millivolt conversion
    ACS712Data _data;                // Latest sensor data

    // RMS calculation window
    static const int RMS_WINDOW_SIZE = ACS712_RMS_WINDOW;  // 100 samples
    float _sampleBuffer[RMS_WINDOW_SIZE]; // Circular buffer of squared current values
    int _sampleIndex;                     // Current position in circular buffer
    bool _windowFilled;                   // Buffer has been filled at least once

    /**
     * @brief Perform zero-current calibration.
     *
     * Takes multiple samples and averages them to find the ADC value
     * that corresponds to zero current flow.
     *
     * @return Calibrated zero offset in ADC counts.
     */
    float performCalibration();
};

#endif // SEMS_ACS712_SENSOR_H
