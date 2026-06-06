/**
 * @file RelayEngine.h
 * @brief 74HC595 shift register relay and MOSFET control engine
 *
 * Controls 13 relays and 4 MOSFETs via a 4x 74HC595 daisy chain (32 bits).
 *
 * Shift register mapping (32 bits, LSB first):
 *   Bit  0-12: Relay CH1-CH13 (ACTIVE LOW - 0=ON, 1=OFF)
 *   Bit 13-16: MOSFET 1-4 (digital on/off control)
 *   Bit 17-31: Reserved for future expansion
 *
 * Safety features:
 *   - OE (Output Enable) held HIGH on boot → all outputs OFF
 *   - States loaded from EEPROM after validation
 *   - 50ms debounce on state changes
 *   - Atomic 32-bit shift out (no partial states visible)
 *   - MOSFET PWM support via separate duty cycle management
 *
 * The 74HC595 is a serial-in, parallel-out shift register:
 *   - SH_CP (clock): Rising edge shifts data in
 *   - ST_CP (latch): Rising edge outputs stored data
 *   - DS (data): Serial data input
 *   - OE: Output enable (active LOW) - controls all outputs
 *   - MR: Master reset (active LOW) - clears shift register
 */

#ifndef SEMS_RELAY_ENGINE_H
#define SEMS_RELAY_ENGINE_H

#include <Arduino.h>
#include "config.h"

/**
 * @struct RelayState
 * @brief Complete relay and MOSFET state snapshot.
 */
struct RelayState {
    bool relays[NUM_RELAYS];       // Relay states (true = ON)
    uint8_t mosfetPWM[NUM_MOSFETS]; // MOSFET PWM values (0-255)
    uint32_t rawBits;               // Raw 32-bit shift register value
    bool outputEnabled;             // OE pin state (true = outputs active)
    unsigned long lastUpdate;       // millis() of last state change
};

/**
 * @class RelayEngine
 * @brief Manages all relay and MOSFET outputs via 74HC595 shift registers.
 */
class RelayEngine {
public:
    RelayEngine();

    /**
     * @brief Initialize the shift register hardware.
     *
     * Boot sequence:
     *   1. Set OE HIGH (all outputs disabled)
     *   2. Set MR HIGH (enable shift register)
     *   3. Clear shift register (all bits LOW = all relays OFF for active LOW)
     *   4. Load saved states from EEPROM
     *   5. Enable outputs (OE LOW)
     */
    void begin();

    /**
     * @brief Main loop - handles debounce timing.
     * Call from Arduino loop().
     */
    void loop();

    /**
     * @brief Set a relay on or off.
     * @param relayIndex Relay number (0-12 for CH1-CH13).
     * @param state true = ON, false = OFF.
     * @return true if the command was accepted.
     */
    bool setRelay(uint8_t relayIndex, bool state);

    /**
     * @brief Toggle a relay's state.
     * @param relayIndex Relay number (0-12).
     * @return New state after toggle, or -1 on error.
     */
    int toggleRelay(uint8_t relayIndex);

    /**
     * @brief Get a relay's current state.
     * @param relayIndex Relay number (0-12).
     * @return true if relay is ON.
     */
    bool getRelay(uint8_t relayIndex) const;

    /**
     * @brief Set all relays simultaneously.
     * @param states Array of bool (size NUM_RELAYS).
     */
    void setAllRelays(const bool states[NUM_RELAYS]);

    /**
     * @brief Set MOSFET PWM duty cycle.
     * @param mosfetIndex MOSFET number (0-3).
     * @param pwm PWM value (0-255, 0=fully off, 255=fully on).
     * @return true if command was accepted.
     */
    bool setMOSFET(uint8_t mosfetIndex, uint8_t pwm);

    /**
     * @brief Get MOSFET PWM value.
     * @param mosfetIndex MOSFET number (0-3).
     * @return PWM value (0-255).
     */
    uint8_t getMOSFET(uint8_t mosfetIndex) const;

    /**
     * @brief Turn off all outputs immediately (emergency).
     *
     * Sets OE HIGH to disable all outputs, clears shift register.
     */
    void emergencyOff();

    /**
     * @brief Enable outputs after emergency off.
     */
    void reenableOutputs();

    /**
     * @brief Get the current relay state snapshot.
     * @return Const reference to current RelayState.
     */
    const RelayState& getState() const;

    /**
     * @brief Save current relay states to EEPROM.
     * @return true if saved successfully.
     */
    bool saveToEEPROM();

    /**
     * @brief Load relay states from EEPROM.
     * @return true if valid states were loaded.
     */
    bool loadFromEEPROM();

    /**
     * @brief Get relay states as int array for telemetry.
     * @param out Output array (must be size NUM_RELAYS).
     */
    void getRelayArray(int out[NUM_RELAYS]) const;

    /**
     * @brief Get MOSFET states as int array for telemetry.
     * @param out Output array (must be size NUM_MOSFETS).
     */
    void getMOSFETArray(int out[NUM_MOSFETS]) const;

private:
    RelayState _state;        // Current state
    bool _initialized;        // Initialization flag
    bool _pendingUpdate;      // Flag indicating state change pending
    unsigned long _lastShift; // Last shift out timestamp

    /**
     * @brief Shift out 32 bits to the 74HC595 chain.
     *
     * Shifts out all 32 bits LSB first, then latches.
     * This is atomic - all outputs change simultaneously.
     *
     * @param data 32-bit data to shift out.
     */
    void shiftOut32(uint32_t data);

    /**
     * @brief Build the 32-bit shift register value from relay and MOSFET states.
     * @return Compiled 32-bit value.
     */
    uint32_t buildShiftValue() const;

    /**
     * @brief Apply a single state change with debounce.
     */
    void applyPendingUpdate();
};

#endif // SEMS_RELAY_ENGINE_H
