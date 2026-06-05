/**
 * @file SOC_Calculator.h
 * @brief State of Charge (SOC) calculator using Coulomb Counting method
 *
 * Implements Coulomb Counting for LiFePO4 battery SOC estimation:
 *   - Tracks charge/discharge current over time
 *   - Integrates current flow to calculate net charge transfer
 *   - Supports voltage-based initial SOC estimation
 *   - Automatic recalibration at full charge (V >= 29.2V, I < 0.5A for 30min)
 *   - Values persisted to EEPROM for power-cycle continuity
 *
 * SOC Range: 0% (20.0V) to 100% (29.2V)
 * Battery: LiFePO4 8S 25.6V 100Ah
 */

#ifndef SEMS_SOC_CALCULATOR_H
#define SEMS_SOC_CALCULATOR_H

#include <Arduino.h>
#include <EEPROM.h>
#include "config.h"

/**
 * @struct SOCData
 * @brief Holds the current SOC state and calibration parameters.
 */
struct SOCData {
    float socPercent;         // Current state of charge (0-100%)
    float lastVoltage;        // Last known battery voltage (V)
    float lastCurrent;        // Last known battery current (A)
    unsigned long lastUpdateMs; // Timestamp of last SOC update
    bool fullChargeDetected;  // Full charge condition met flag
    unsigned long fullChargeStartMs; // When full charge condition started
    bool recalibrated;        // SOC was recalibrated since boot
};

/**
 * @class SOC_Calculator
 * @brief Coulomb counting SOC calculator with EEPROM persistence.
 *
 * The SOC is calculated as:
 *   SOC_new = SOC_old + (I_charge - I_discharge) * dt / Capacity
 *
 * Positive current = charging, negative current = discharging.
 * The 100Ah capacity means:
 *   - 1A discharge for 1 hour = 1% SOC decrease
 *   - Full charge: 100A * 1h or 10A * 10h
 */
class SOC_Calculator {
public:
    /**
     * @brief Construct a new SOC Calculator.
     *
     * Reads persisted SOC from EEPROM on construction.
     * If no valid EEPROM data exists, estimates from voltage.
     */
    SOC_Calculator();

    /**
     * @brief Initialize the SOC calculator.
     *
     * Loads saved values from EEPROM. If invalid, estimates from
     * the provided initial voltage.
     *
     * @param initialVoltage Current battery voltage in volts.
     * @return true if successfully initialized.
     */
    bool begin(float initialVoltage);

    /**
     * @brief Update SOC based on current measurement.
     *
     * Call this periodically (every 1 second recommended).
     * Implements Coulomb counting:
     *   delta_Ah = current_A * dt_seconds / 3600.0
     *   delta_SOC = delta_Ah / capacity_Ah * 100.0
     *
     * @param current Battery current in Amps (positive = charging).
     * @param voltage Battery voltage in Volts.
     */
    void update(float current, float voltage);

    /**
     * @brief Get the current SOC percentage.
     * @return SOC value clamped to [0, 100].
     */
    float getSOC() const;

    /**
     * @brief Get the full SOC data structure.
     * @return Reference to current SOC data.
     */
    const SOCData& getData() const;

    /**
     * @brief Force SOC to a specific value.
     * @param socPercent New SOC value (0-100).
     */
    void setSOC(float socPercent);

    /**
     * @brief Reset SOC based on a voltage measurement.
     *
     * Used for initial calibration or manual correction.
     * Maps voltage linearly from EMPTY to FULL voltage range.
     *
     * @param voltage Current battery voltage.
     */
    void calibrateFromVoltage(float voltage);

    /**
     * @brief Save current SOC and calibration data to EEPROM.
     * @return true if saved successfully.
     */
    bool saveToEEPROM();

    /**
     * @brief Load SOC and calibration data from EEPROM.
     * @return true if valid data was loaded.
     */
    bool loadFromEEPROM();

    /**
     * @brief Check if the battery is in full charge state.
     *
     * Full charge is defined as:
     *   V >= 29.2V AND I < 0.5A for 30 continuous minutes
     *
     * @return true if full charge condition is active.
     */
    bool isFullCharge() const;

    /**
     * @brief Check if SOC was recalibrated at full charge.
     * @return true if recalibration occurred since boot.
     */
    bool wasRecalibrated() const;

    /**
     * @brief Get estimated remaining capacity in Ah.
     * @return Remaining capacity based on current SOC.
     */
    float getRemainingCapacity() const;

    /**
     * @brief Get estimated remaining energy in Wh.
     * @return Remaining energy = remaining_Ah * nominal_voltage.
     */
    float getRemainingEnergy() const;

    /**
     * @brief Set the battery capacity (for different battery sizes).
     * @param capacityAh Battery capacity in Amp-hours.
     */
    void setCapacity(float capacityAh);

private:
    SOCData _data;                  // Current SOC state
    float _capacityAh;              // Battery capacity in Ah
    float _previousCurrent;         // Previous current reading for interpolation
    unsigned long _previousUpdateMs; // Previous update timestamp

    /**
     * @brief Estimate SOC from battery voltage using linear mapping.
     *
     * LiFePO4 has a relatively flat discharge curve, but a linear
     * approximation is adequate for initial SOC estimation.
     *
     * @param voltage Battery voltage in Volts.
     * @return Estimated SOC percentage (0-100).
     */
    float voltageToSOC(float voltage) const;

    /**
     * @brief Clamp SOC to valid range [0, 100].
     * @param soc Input SOC value.
     * @return Clamped value.
     */
    float clampSOC(float soc) const;

    /**
     * @brief Check and handle full charge recalibration.
     * @param voltage Current battery voltage.
     * @param current Current battery current.
     */
    void checkFullCharge(float voltage, float current);
};

#endif // SEMS_SOC_CALCULATOR_H
