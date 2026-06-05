/**
 * @file RelayEngine.cpp
 * @brief 74HC595 shift register control implementation
 *
 * FIX v1.0.2: EEPROM API updated for ESP32 Core 3.x compatibility.
 *   Replaced: writeUInt32(), writeUInt16(), writeWord(), writeByte(),
 *             readUInt32(), readWord(), readByte()
 *   With: put(addr, val), get(addr, &val), read(addr), write(addr, val)
 */

#include "RelayEngine.h"
#include <EEPROM.h>
#include "../utils/SerialDebugger.h"

// ============================================================================
// CONSTRUCTOR
// ============================================================================

RelayEngine::RelayEngine()
    : _state({}),
      _initialized(false),
      _pendingUpdate(false),
      _lastShift(0) {
    memset(&_state, 0, sizeof(_state));
    _state.outputEnabled = false;  // Boot-safe: outputs disabled
    memset(_state.mosfetPWM, 0, sizeof(_state.mosfetPWM));
}

// ============================================================================
// INITIALIZATION
// ============================================================================

void RelayEngine::begin() {
    DBG_RELAY("RelayEngine: Initializing...");

    EEPROM.begin(EEPROM_SIZE);  // FIX v1.0.2: Call begin() before any read/write

    // -----------------------------------------------------------------------
    // Configure GPIO pins
    // -----------------------------------------------------------------------
    pinMode(SR_CLOCK_PIN, OUTPUT);
    pinMode(SR_LATCH_PIN, OUTPUT);
    pinMode(SR_DATA_PIN, OUTPUT);
    pinMode(SR_OE_PIN, OUTPUT);
    pinMode(SR_MR_PIN, OUTPUT);

    // -----------------------------------------------------------------------
    // BOOT-SAFE SEQUENCE
    // -----------------------------------------------------------------------
    // 1. Disable outputs (OE HIGH = all outputs off)
    digitalWrite(SR_OE_PIN, HIGH);
    _state.outputEnabled = false;

    // 2. Enable shift register (MR HIGH = normal operation)
    digitalWrite(SR_MR_PIN, HIGH);

    // 3. Clear shift register (all bits LOW)
    // For active LOW relays: LOW bit = relay ON, so all LOW = all ON
    // We want all OFF at boot, so set all relay bits HIGH
    _state.rawBits = 0xFFFFFFFF;  // All bits HIGH = all relays OFF
    shiftOut32(_state.rawBits);

    // 4. Load saved states from EEPROM
    if (loadFromEEPROM()) {
        DBG_RELAY("RelayEngine: Restored states from EEPROM");
    } else {
        DBG_RELAY("RelayEngine: No valid EEPROM data, all OFF");
        // Set all relays to OFF (active LOW = bit HIGH)
        for (int i = 0; i < NUM_RELAYS; i++) {
            _state.relays[i] = false;
        }
        memset(_state.mosfetPWM, 0, sizeof(_state.mosfetPWM));
    }

    // Build and shift out the loaded state
    _state.rawBits = buildShiftValue();
    shiftOut32(_state.rawBits);

    // 5. Enable outputs (OE LOW = outputs active)
    delayMicroseconds(100);  // Brief settling time
    digitalWrite(SR_OE_PIN, LOW);
    _state.outputEnabled = true;

    _initialized = true;
    _state.lastUpdate = millis();

    DBG_RELAY("RelayEngine: Ready (%d relays, %d MOSFETs, OE=LOW)",
               NUM_RELAYS, NUM_MOSFETS);

    // Log initial states
    for (int i = 0; i < NUM_RELAYS; i++) {
        DBG_RELAY("  Relay CH%d: %s", i + 1, _state.relays[i] ? "ON" : "OFF");
    }
    for (int i = 0; i < NUM_MOSFETS; i++) {
        DBG_RELAY("  MOSFET %d: PWM=%d", i + 1, _state.mosfetPWM[i]);
    }
}

// ============================================================================
// MAIN LOOP
// ============================================================================

void RelayEngine::loop() {
    if (!_initialized) return;

    // Apply pending state changes with debounce
    if (_pendingUpdate && (millis() - _lastShift >= RELAY_DEBOUNCE_MS)) {
        applyPendingUpdate();
    }
}

// ============================================================================
// RELAY CONTROL
// ============================================================================

bool RelayEngine::setRelay(uint8_t relayIndex, bool state) {
    if (relayIndex >= NUM_RELAYS) {
        DBG_RELAY("RelayEngine: Invalid relay index %d", relayIndex);
        return false;
    }

    if (_state.relays[relayIndex] == state) {
        return true;  // No change needed
    }

    _state.relays[relayIndex] = state;
    _pendingUpdate = true;

    DBG_RELAY("RelayEngine: CH%d -> %s", relayIndex + 1, state ? "ON" : "OFF");
    return true;
}

int RelayEngine::toggleRelay(uint8_t relayIndex) {
    if (relayIndex >= NUM_RELAYS) return -1;
    bool newState = !_state.relays[relayIndex];
    setRelay(relayIndex, newState);
    return newState ? 1 : 0;
}

bool RelayEngine::getRelay(uint8_t relayIndex) const {
    if (relayIndex >= NUM_RELAYS) return false;
    return _state.relays[relayIndex];
}

void RelayEngine::setAllRelays(const bool states[NUM_RELAYS]) {
    for (int i = 0; i < NUM_RELAYS; i++) {
        _state.relays[i] = states[i];
    }
    _pendingUpdate = true;
    DBG_RELAY("RelayEngine: All relays updated");
}

// ============================================================================
// MOSFET CONTROL
// ============================================================================

bool RelayEngine::setMOSFET(uint8_t mosfetIndex, uint8_t pwm) {
    if (mosfetIndex >= NUM_MOSFETS) {
        DBG_RELAY("RelayEngine: Invalid MOSFET index %d", mosfetIndex);
        return false;
    }

    _state.mosfetPWM[mosfetIndex] = pwm;
    _pendingUpdate = true;

    DBG_RELAY("RelayEngine: MOSFET %d -> PWM=%d", mosfetIndex + 1, pwm);
    return true;
}

uint8_t RelayEngine::getMOSFET(uint8_t mosfetIndex) const {
    if (mosfetIndex >= NUM_MOSFETS) return 0;
    return _state.mosfetPWM[mosfetIndex];
}

// ============================================================================
// EMERGENCY CONTROL
// ============================================================================

void RelayEngine::emergencyOff() {
    // Immediately disable all outputs
    digitalWrite(SR_OE_PIN, HIGH);  // OE HIGH = all outputs off
    _state.outputEnabled = false;

    // Clear all relay states
    for (int i = 0; i < NUM_RELAYS; i++) {
        _state.relays[i] = false;
    }
    memset(_state.mosfetPWM, 0, sizeof(_state.mosfetPWM));
    _state.rawBits = buildShiftValue();
    shiftOut32(_state.rawBits);

    DBG_RELAY("RelayEngine: EMERGENCY OFF - All outputs disabled");
}

void RelayEngine::reenableOutputs() {
    // Re-enable outputs after emergency
    _state.outputEnabled = true;
    digitalWrite(SR_OE_PIN, LOW);
    _pendingUpdate = true;

    DBG_RELAY("RelayEngine: Outputs re-enabled");
}

// ============================================================================
// SHIFT REGISTER OPERATIONS
// ============================================================================

void RelayEngine::shiftOut32(uint32_t data) {
    // Latch LOW to prevent output changes during shift
    digitalWrite(SR_LATCH_PIN, LOW);

    // Shift out 32 bits, LSB first
    for (int8_t i = 31; i >= 0; i--) {
        digitalWrite(SR_CLOCK_PIN, LOW);
        digitalWrite(SR_DATA_PIN, (data >> i) & 0x01);
        digitalWrite(SR_CLOCK_PIN, HIGH);  // Rising edge shifts data in
    }

    // Pulse latch to output stored data
    digitalWrite(SR_LATCH_PIN, HIGH);
    digitalWrite(SR_LATCH_PIN, LOW);

    _lastShift = millis();
}

uint32_t RelayEngine::buildShiftValue() const {
    uint32_t value = 0xFFFFFFFF;  // Default: all bits HIGH (all OFF)

    // Relays: bits 0-12, ACTIVE LOW (false=OFF → bit=HIGH, true=ON → bit=LOW)
    for (int i = 0; i < NUM_RELAYS; i++) {
        if (_state.relays[i]) {
            value &= ~(1UL << (i + RELAY_BIT_OFFSET));  // Clear bit = relay ON
        }
    }

    // MOSFETs: bits 13-16, digital on/off
    // For MOSFETs, PWM > 0 means bit should be HIGH (active HIGH)
    for (int i = 0; i < NUM_MOSFETS; i++) {
        uint8_t bitPos = i + MOSFET_BIT_OFFSET;
        if (_state.mosfetPWM[i] > 0) {
            value |= (1UL << bitPos);  // Set bit = MOSFET ON
        } else {
            value &= ~(1UL << bitPos); // Clear bit = MOSFET OFF
        }
    }

    // Bits 17-31: Reserved (keep HIGH = disabled)
    // Already set by default value

    return value;
}

void RelayEngine::applyPendingUpdate() {
    _state.rawBits = buildShiftValue();
    shiftOut32(_state.rawBits);
    _state.lastUpdate = millis();
    _pendingUpdate = false;
}

// ============================================================================
// GETTERS
// ============================================================================

const RelayState& RelayEngine::getState() const {
    return _state;
}

void RelayEngine::getRelayArray(int out[NUM_RELAYS]) const {
    for (int i = 0; i < NUM_RELAYS; i++) {
        out[i] = _state.relays[i] ? 1 : 0;
    }
}

void RelayEngine::getMOSFETArray(int out[NUM_MOSFETS]) const {
    for (int i = 0; i < NUM_MOSFETS; i++) {
        out[i] = _state.mosfetPWM[i];
    }
}

// ============================================================================
// EEPROM PERSISTENCE
// FIX v1.0.2: Replaced deprecated EEPROM API with ESP32 Core 3.x compatible API.
//   Old: writeUInt32(), writeUInt16(), writeWord(), writeByte(),
//        readUInt32(), readWord(), readByte()
//   New: put(addr, val), get(addr, &val), read(addr), write(addr, val)
// ============================================================================

bool RelayEngine::saveToEEPROM() {
    // FIX v1.0.2: Use put() instead of writeUInt32/writeUInt16/writeWord/writeByte
    uint32_t magicVal = EEPROM_MAGIC;
    uint16_t versionVal = EEPROM_VERSION;
    EEPROM.put(EEPROM_ADDR_MAGIC, magicVal);
    EEPROM.put(EEPROM_ADDR_VERSION, versionVal);

    // Pack relay states into 4 bytes (uint32_t bitmask)
    uint32_t relayBits = 0;
    for (int i = 0; i < NUM_RELAYS; i++) {
        if (_state.relays[i]) {
            relayBits |= (1UL << i);
        }
    }
    EEPROM.put(EEPROM_ADDR_RELAY, relayBits);

    // Save MOSFET PWM values (4 bytes as uint32_t)
    uint32_t mosfetBits = 0;
    for (int i = 0; i < NUM_MOSFETS; i++) {
        mosfetBits |= ((uint32_t)_state.mosfetPWM[i] << (i * 8));
    }
    EEPROM.put(EEPROM_ADDR_MOSFET, mosfetBits);

    return EEPROM.commit();
}

bool RelayEngine::loadFromEEPROM() {
    // FIX v1.0.2: Use get() instead of readUInt32/readWord/readByte
    uint32_t magic = 0;
    EEPROM.get(EEPROM_ADDR_MAGIC, magic);
    if (magic != EEPROM_MAGIC) return false;

    // Load relay states
    uint32_t relayBits = 0;
    EEPROM.get(EEPROM_ADDR_RELAY, relayBits);
    for (int i = 0; i < NUM_RELAYS; i++) {
        _state.relays[i] = (relayBits & (1UL << i)) != 0;
    }

    // Load MOSFET PWM values
    uint32_t mosfetBits = 0;
    EEPROM.get(EEPROM_ADDR_MOSFET, mosfetBits);
    for (int i = 0; i < NUM_MOSFETS; i++) {
        _state.mosfetPWM[i] = (mosfetBits >> (i * 8)) & 0xFF;
    }

    return true;
}
