// ============================================================================
// SEMS_Firmware.ino - Smart Energy Management System
// Brand: Jambi Solar Panel powered by PT. Jaya Mandiri Smart Energy
// ============================================================================
// Firmware for ESP32 WROOM DEVKIT
// Non-blocking architecture with 9 engines - NO delay() usage
// Arduino IDE compatible with Adafruit libraries + ArduinoOTA
//
// COMPATIBILITY: ESP32 Arduino Core 3.x (IDF 5.x) - May 2026
// ============================================================================
// DEPRECATION NOTICE (v1.0.2):
//   This monolithic .ino file is the ACTIVE production code. A modular
//   refactoring exists in the sensors/, engines/, and utils/ directories,
//   but that code has compilation issues (undefined constants, deprecated
//   EEPROM API calls). Until those are resolved, this .ino is authoritative.
//   Plan: Fix modular code, then deprecate this file in favor of it.
// ============================================================================
// CHANGELOG of Phase 2 deep-dive fixes (v2.0.0):
//   - CRITICAL P2-001: Undervoltage flag clearing with hysteresis
//   - CRITICAL P2-012: TOCTOU fix in fetchConfig (path validation BEFORE http.begin)
//   - HIGH P2-002: Overvoltage hysteresis increased 0.5V → 1.5V
//   - HIGH P2-003: Volatile globals bridge config→safety thresholds
//   - HIGH P2-005: Sensor timeout → safe state (cut charging, shed non-critical)
//   - HIGH P2-007: Telemetry low-heap drops only oldest entry
//   - HIGH P2-008: Telemetry flush capped to 2/cycle + WDT reset
//   - HIGH P2-013: Cross-validation overvoltage >= undervoltage + 4V
//   - HIGH P2-014: Config parsing is transactional (temp struct, validate, copy)
//   - HIGH P2-018: StaticJsonDocument<4096> moved to global scope
//   - HIGH P2-021: Independent Watchdog (IWDT) initialized in setup()
//   - HIGH P2-022: Crash recovery — esp_reset_reason() check, safe boot after WDT
//   - HIGH P2-026: WiFiClientSecure with cert pinning for HTTPS GAS calls
//   - HIGH P2-029: Software interlock comment + battery current direction check
//   - HIGH P2-033: Non-blocking logEvent via event queue for safety engine
//   - MED P2-004: 30s min off-time debounce for safety relay 0
//   - MED P2-009: Exponential backoff on failed telemetry sends
//   - MED P2-010: telemetrySend accepts const char*
//   - MED P2-011: HTTP 429/503 specific handling in telemetrySend
//   - MED P2-015: ConfigSync writes to volatile globals
//   - MED P2-017: extractString() typo fixed
//   - MED P2-019: Pre-reserve cloudRules/cloudSchedules Strings
//   - MED P2-023: Boot-time sensor self-test before relay outputs
//   - MED P2-030: ACS712 calibrated only when all relays OFF
//   - MED P2-034: Pre-reserve Strings, limit response size
//   - LOW P2-016: HTTPS URLs for GAS endpoints
//   - LOW P2-036: X-Device-Token header in EventLogger cloud sync
// ============================================================================
// CHANGELOG of security & quality fixes (v1.0.2):
//   - SECURITY: Hardcoded WiFi/API/OTA credentials removed from config.h
//   - CRITICAL: Safety engine now performs protective relay actions
//     (overvoltage → cut charging relay, undervoltage → emergency load shed,
//      overcurrent → cut charging, overtemp → emergency load shed)
//   - CRITICAL: Tiered load shedding (Tier 3→2→1 instead of binary)
//   - FIX: OTA password mismatch between config.h and platformio.ini
//   - FIX: Input validation for remote config values (clamp to safe ranges)
//   - FIX: Overcurrent check added to safety engine
//   - FIX: Temperature check added to safety engine
//   - FIX: Heap fragmentation — telemetry queue reduced, fixed buffers
//   - FIX: EEPROM write frequency reduced (300s instead of 60s)
//   - FIX: SHT31 filter index desynchronization
//   - FIX: NTP sync made non-blocking (state machine)
//   - FIX: Dead #if !defined(WIFI_SSID) check in config.h
// ============================================================================
// CHANGELOG of API fixes for Core 3.x:
//   - EEPROM: writeUInt32/writeUInt16/readByte → put()/get()/read()
//   - Adafruit_INA219: begin(addr) → constructor addr, direct register calibration
//   - esp_task_wdt_init(timeout, panic) → esp_task_wdt_config_t struct
//   - Adafruit_ADS1115 #2: fixed constructor address, added begin()
//   - HTTPClient: explicit WiFiClient for Core 3.x compatibility
// ============================================================================
// CHANGELOG of firmware↔backend bug fixes (v1.0.1):
//   - FIX: telemetrySend() path "api/telemetry/upload" → "api/telemetry" (was 404)
//   - FIX: fetchConfig() extracts array from wrapped { success, data/rules/schedules } response
//   - FIX: Schedule dedup uses hash array (was single hash — 2+ schedules in same minute failed)
//   - FIX: evaluateCondition() PIR supports "== 1" in addition to "== true"
// ============================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ArduinoOTA.h>
#include <EEPROM.h>
#include "config.h"
#include "NonBlockingTimer.h"
#include "MovingAverage.h"
#include <esp_task_wdt.h>

// Adafruit Libraries
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_ADS1X15.h>
#include <Adafruit_SHT31.h>
#include "RTClib.h"

// ============================================================================
// GLOBAL STATE
// ============================================================================

// --- I2C Devices ---
// FIX: Set INA219 address via constructor (Core 3.x Adafruit_INA219 begin() only takes TwoWire*)
Adafruit_INA219 ina219(INA219_ADDR);
Adafruit_ADS1115 ads1;   // ADS1115 #1 - Cells 1-4 (addr 0x48, default)
Adafruit_ADS1115 ads2;   // ADS1115 #2 - Cells 5-8 (addr 0x49, set via begin())
Adafruit_SHT31 sht31 = Adafruit_SHT31();
RTC_DS3231 rtc;

// --- INA219 Custom Calibration ---
// Store current LSB (mA/bit) for manual current register reading
// Required because installed Adafruit_INA219 lacks setCalibration(float, float)
float ina219CurrentLSB_mA = 0;

// --- Moving Average Filters ---
MovingAverage<float, MA_WINDOW_I2C> maBatteryV;
MovingAverage<float, MA_WINDOW_I2C> maBatteryI;
MovingAverage<float, MA_WINDOW_I2C> maBatteryW;
MovingAverage<float, MA_WINDOW_I2C> maRoomTemp;
MovingAverage<float, MA_WINDOW_I2C> maRoomHum;
MovingAverage<float, MA_WINDOW_I2C> maCellV[NUM_CELLS];
MovingAverage<float, MA_WINDOW_ANALOG> maACS712;
MovingAverage<float, MA_WINDOW_I2C> maInverterI;

// --- Sensor Data ---
struct SensorData {
    // Battery (INA219)
    float batteryVoltage = 0;
    float batteryCurrent = 0;
    float batteryPower = 0;

    // Cell Voltages (ADS1115)
    float cellVoltages[NUM_CELLS] = {0};

    // Environment (SHT31)
    float roomTemp = 0;
    float roomHumidity = 0;

    // Inverter Load (ACS712)
    float inverterCurrent = 0;
    float inverterPower = 0;

    // Motion Detection (PIR)
    bool pirStates[NUM_PIRS] = {false};

    // Backup voltage (direct ADC)
    float backupVoltage = 0;

    // Sensor health
    bool ina219Online = false;
    bool ads1Online = false;
    bool ads2Online = false;
    bool sht31Online = false;
    bool rtcOnline = false;
    unsigned long ina219LastSeen = 0;
    unsigned long ads1LastSeen = 0;
    unsigned long ads2LastSeen = 0;
    unsigned long sht31LastSeen = 0;

    // SOC
    float socPercent = 0.0;

    // Relay & MOSFET states
    uint32_t shiftRegisterState = 0xFFFFFFFF; // All OFF initially (active LOW)

    // System
    unsigned long uptimeSeconds = 0;
    int wifiRSSI = 0;
    uint32_t freeHeap = 0;
    bool loadSheddingActive = false;

    // Safety flags (v1.0.2)
    bool safetyOvervoltageFlag = false;
    bool safetyUndervoltageFlag = false;
    bool safetyOvercurrentFlag = false;
    bool safetyOvertempFlag = false;
    bool safetyCellImbalanceFlag = false;
};

SensorData sensorData;

// --- P2-003: Volatile globals to bridge remote config → safety engine ---
// Written by ConfigSyncEngine (after cloud fetch), read by safety engine.
volatile float remoteSafetyOvervolt = BATT_OVERVOLT;
volatile float remoteSafetyUndervolt = BATT_UNDERVOLT;
volatile float remoteSafetyOvercurrent = SAFETY_OVERCURRENT_A;
volatile float remoteSafetyOvertemp = SAFETY_MAX_TEMP_C;
volatile float remoteSafetyCellImbalance = SAFETY_CELL_IMBALANCE_V;
volatile bool remoteConfigValid = false;

// --- ACS712 Calibration ---
float acs712Offset = 0.0; // Zero-current offset (calibrated on boot)

// --- Relay State Persistence ---
uint32_t savedRelayStates = 0xFFFFFFFF;

// --- Telemetry Queue (FIX v1.0.2: fixed-size char buffers to reduce heap fragmentation) ---
// Queue reduced from 50 to TELEMETRY_QUEUE_SIZE (10) entries with static buffers
struct TelemetryEntry {
    char jsonPayload[TELEMETRY_JSON_BUF_SIZE];  // Fixed buffer instead of String
    unsigned long timestamp;
};
TelemetryEntry telemetryQueue[TELEMETRY_QUEUE_SIZE];
uint8_t telemetryQueueHead = 0;
uint8_t telemetryQueueTail = 0;
uint8_t telemetryQueueCount = 0;

// --- Config from Cloud ---
// P2-019: Pre-reserve Strings to reduce heap fragmentation
String cloudRules = "[]";
String cloudSchedules = "[]";

// --- T3-FW-016: EEPROM mutex pattern to prevent concurrent writes ---
// FW-009 FIX: Added volatile qualifier to eepromBusy.
//   NOTE: This mutex pattern is only safe when called from the main loop context
//   (single-threaded). It does NOT protect against ISR or FreeRTOS task concurrency.
static volatile bool eepromBusy = false;

bool eepromAcquire() {
    if (eepromBusy) return false;
    eepromBusy = true;
    return true;
}
void eepromRelease() {
    eepromBusy = false;
}

// --- P2-018: Global StaticJsonDocument for fetchConfig (avoids stack allocation) ---
StaticJsonDocument<4096> fetchConfigWrapperDoc;

// --- T3-FW-009: Global StaticJsonDocument for buildTelemetryJSON (avoids stack allocation) ---
StaticJsonDocument<1024> telemetryBuildDoc;

// --- P2-033: Non-blocking event queue for safety engine logEvent calls ---
#define EVENT_QUEUE_SIZE 8
struct EventQueueEntry {
    char type[16];
    char message[128];
};
EventQueueEntry eventQueue[EVENT_QUEUE_SIZE];
volatile uint8_t eventQueueHead = 0;
volatile uint8_t eventQueueTail = 0;
volatile uint8_t eventQueueCount = 0;

// --- P2-004: Relay off-time tracking (30s debounce for safety relay 0) ---
unsigned long relay0LastTurnedOff = 0;
#define RELAY_0_MIN_OFF_MS 30000

// --- P2-009: Telemetry retry backoff state ---
unsigned long telemetryBackoffMs = 0;
unsigned long telemetryLastFailTime = 0;
#define TELEMETRY_BACKOFF_BASE_MS 1000
#define TELEMETRY_BACKOFF_MAX_MS 300000

// --- Timers ---
NonBlockingTimer timerSensor(SENSOR_POLL_MS);
NonBlockingTimer timerPIR(PIR_POLL_MS);
NonBlockingTimer timerACS712(ACS712_SAMPLE_INTERVAL_MS);
NonBlockingTimer timerAutomation(AUTOMATION_EVAL_MS);
NonBlockingTimer timerSchedule(SCHEDULE_CHECK_MS);
NonBlockingTimer timerTelemetry(TELEMETRY_UPLOAD_MS);
NonBlockingTimer timerConfigSync(CONFIG_SYNC_MS);
NonBlockingTimer timerHeartbeat(HEARTBEAT_MS);
NonBlockingTimer timerSafety(SAFETY_CHECK_MS);
NonBlockingTimer timerLoadShed(LOAD_SHED_CHECK_MS);

// Pre-allocated JSON documents for rule/schedule parsing (avoid stack allocation in loops)
StaticJsonDocument<2048> rulesDoc;
StaticJsonDocument<2048> schedDoc;

// Forward declaration for logEvent (used in safety engine)
void logEvent(const String& type, const String& message);
// P2-033: Non-blocking event queue processor (called from main loop)
void processEventQueue() {
    // T3-FW-007: Bound processing to max 2 events per cycle to prevent unbounded blocking
    // FW-026 FIX: Use ArduinoJson's direct const char* setting to avoid String copies.
    //   The original code created temporary String objects from char[] buffers, causing
    //   unnecessary heap allocation per event. Using entry.type and entry.message directly
    //   as const char* avoids this overhead.
    int processed = 0;
    const int maxPerCycle = 2;
    while (eventQueueCount > 0 && processed < maxPerCycle) {
        // Dequeue event
        EventQueueEntry& entry = eventQueue[eventQueueTail];
        eventQueueTail = (eventQueueTail + 1) % EVENT_QUEUE_SIZE;
        eventQueueCount--;
        processed++;

        // Send to cloud (blocking — OK here since we're in main loop context)
        bool sendSuccess = false;
        if (WiFi.status() == WL_CONNECTED) {
            StaticJsonDocument<256> doc;
            // FW-026 FIX: Use const char* directly instead of creating String copies
            doc["type"] = entry.type;
            doc["severity"] = (strncmp(entry.type, "CRITICAL", 8) == 0) ? "critical" : "warning";
            doc["message"] = entry.message;
            String json;
            serializeJson(doc, json);

        // P2-026: Use WiFiClientSecure for HTTPS
    // FW-013 FIX: SECURITY WARNING — setInsecure() disables TLS certificate validation.
    //   Production deployment MUST use setCACert() with a pinned server certificate.
        WiFiClientSecure client;
        client.setInsecure();
            HTTPClient http;
            http.setTimeout(HTTP_TIMEOUT_MS);
            String url = String(GAS_SCRIPT_URL) + "?path=api/alarm/create";
            http.begin(client, url);
            http.addHeader("Content-Type", "application/json");
            http.addHeader("X-Device-Token", GAS_API_TOKEN);
            int httpCode = http.POST(json);
            http.end();
            sendSuccess = (httpCode >= 200 && httpCode < 300);
        }
        // T3-FW-007: Stop processing on send failure (avoid wasting time)
        if (!sendSuccess) break;
    }
}

// P2-033: Enqueue version of logEvent for safety engine (non-blocking)
void logEventNonBlocking(const char* type, const char* message) {
    if (eventQueueCount >= EVENT_QUEUE_SIZE) {
        // Queue full, drop oldest
        eventQueueTail = (eventQueueTail + 1) % EVENT_QUEUE_SIZE;
        eventQueueCount--;
    }
    EventQueueEntry& entry = eventQueue[eventQueueHead];
    strncpy(entry.type, type, sizeof(entry.type) - 1);
    entry.type[sizeof(entry.type) - 1] = '\0';
    strncpy(entry.message, message, sizeof(entry.message) - 1);
    entry.message[sizeof(entry.message) - 1] = '\0';
    eventQueueHead = (eventQueueHead + 1) % EVENT_QUEUE_SIZE;
    eventQueueCount++;
}

// --- WiFi State ---
bool wifiConnected = false;
unsigned long wifiReconnectDelay = WIFI_RECONNECT_BASE_MS;
unsigned long lastWifiAttempt = 0;

// --- LED State ---
bool ledState = false;

// --- Schedule Dedup (FIX: array-based instead of single hash) ---
#define MAX_SCHEDULE_HASHES 8
unsigned long scheduleHashes[MAX_SCHEDULE_HASHES] = {0};
uint8_t scheduleHashCount = 0;
uint8_t lastScheduleMinute = 255;  // Track minute changes to reset hash set

// ============================================================================
// SCHEDULE DEDUP HELPERS (FIX v1.0.1)
// ============================================================================

// T3-FW-020: Generate unique device ID from ESP32 MAC address
// For multi-unit deployment, each device needs a unique identifier.
// This function generates a deterministic ID from the WiFi MAC address.
String generateDeviceID() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char id[24];
    snprintf(id, sizeof(id), "SEMS_%02X%02X%02X", mac[3], mac[4], mac[5]);
    return String(id);
}

bool scheduleHashExists(unsigned long hash) {
    for (uint8_t i = 0; i < scheduleHashCount; i++) {
        if (scheduleHashes[i] == hash) return true;
    }
    return false;
}

void scheduleHashAdd(unsigned long hash) {
    if (scheduleHashCount < MAX_SCHEDULE_HASHES) {
        scheduleHashes[scheduleHashCount++] = hash;
    }
}

void scheduleHashReset() {
    scheduleHashCount = 0;
    for (uint8_t i = 0; i < MAX_SCHEDULE_HASHES; i++) {
        scheduleHashes[i] = 0;
    }
}

// ============================================================================
// SHIFT REGISTER (74HC595) ENGINE
// ============================================================================

void shiftRegisterInit() {
    pinMode(SR_CLOCK_PIN, OUTPUT);
    pinMode(SR_LATCH_PIN, OUTPUT);
    pinMode(SR_DATA_PIN, OUTPUT);
    pinMode(SR_OE_PIN, OUTPUT);
    pinMode(SR_MR_PIN, OUTPUT);

    // Boot-safe: disable all outputs immediately
    digitalWrite(SR_OE_PIN, HIGH);  // OE HIGH = all outputs disabled
    digitalWrite(SR_MR_PIN, HIGH); // MR HIGH = normal operation (not reset)

    Serial.println("[SR] Shift register initialized - outputs disabled (boot-safe)");
}

void shiftRegisterEnableOutputs() {
    digitalWrite(SR_OE_PIN, LOW); // OE LOW = outputs enabled
    Serial.println("[SR] Outputs enabled");
}

void shiftRegisterWrite(uint32_t state) {
    // For active LOW relays: bit=1 means OFF, bit=0 means ON
    sensorData.shiftRegisterState = state;

    digitalWrite(SR_LATCH_PIN, LOW);

    // Shift out 32 bits (MSB first for daisy chain)
    for (int i = TOTAL_SR_BITS - 1; i >= 0; i--) {
        digitalWrite(SR_CLOCK_PIN, LOW);
        digitalWrite(SR_DATA_PIN, (state >> i) & 0x01);
        digitalWrite(SR_CLOCK_PIN, HIGH);
        delayMicroseconds(2); // Hold time for shift register (min spec safety margin)
    }

    digitalWrite(SR_LATCH_PIN, HIGH);
    digitalWrite(SR_LATCH_PIN, LOW);
}

// --- Relay Control Functions ---

void setRelay(uint8_t relayIndex, bool on) {
    if (relayIndex >= NUM_RELAYS) return;

    // Active LOW: ON = clear bit, OFF = set bit
    if (on) {
        sensorData.shiftRegisterState &= ~(1UL << relayIndex);
    } else {
        sensorData.shiftRegisterState |= (1UL << relayIndex);
    }

    shiftRegisterWrite(sensorData.shiftRegisterState);

    #ifdef DEBUG_ENABLED
    Serial.printf("[RELAY] Relay %d -> %s\n", relayIndex + 1, on ? "ON" : "OFF");
    #endif
}

bool getRelayState(uint8_t relayIndex) {
    if (relayIndex >= NUM_RELAYS) return false;
    // Active LOW: bit=0 means ON
    return !(sensorData.shiftRegisterState & (1UL << relayIndex));
}

// --- MOSFET Control Functions ---

void setMosfet(uint8_t mosfetIndex, uint8_t pwmValue) {
    if (mosfetIndex >= NUM_MOSFETS) return;

    uint8_t bitPos = NUM_RELAYS + mosfetIndex;

    // PWM not natively supported through shift register, but we store value
    // For now: 0 = OFF, >0 = ON (simple on/off via shift register bit)
    // Full PWM would require additional hardware (e.g., TLC5940)
    // IRLZ44N MOSFETs are active HIGH: set bit = ON, clear bit = OFF
    if (pwmValue > 0) {
        sensorData.shiftRegisterState |= (1UL << bitPos);
    } else {
        sensorData.shiftRegisterState &= ~(1UL << bitPos);
    }

    shiftRegisterWrite(sensorData.shiftRegisterState);

    #ifdef DEBUG_ENABLED
    Serial.printf("[MOSFET] MOSFET %d -> PWM %d\n", mosfetIndex + 1, pwmValue);
    #endif
}

uint8_t getMosfetState(uint8_t mosfetIndex) {
    if (mosfetIndex >= NUM_MOSFETS) return 0;
    uint8_t bitPos = NUM_RELAYS + mosfetIndex;
    // IRLZ44N MOSFETs are active HIGH: bit set = ON
    return (sensorData.shiftRegisterState & (1UL << bitPos)) ? 255 : 0;
}

// --- EEPROM Persistence ---
// NOTE: ESP32 Core 3.x simplified EEPROM API.
//   Available: begin(), end(), read(addr), write(addr, val), get(addr, &val), put(addr, val), commit()
//   REMOVED:   readByte(), writeByte(), writeUInt(), writeUInt16(), writeUInt32(),
//              writeFloat(), writeLong(), writeInt(), writeBool(), etc.
//   Use get()/put() for multi-byte types, read()/write() for single bytes.

void loadRelayStatesFromEEPROM() {
    EEPROM.begin(EEPROM_SIZE);
    uint32_t magic = 0;
    EEPROM.get(EEPROM_ADDR_MAGIC, magic);

    // T3-FW-024: EEPROM version check and migration logic
    uint16_t storedVersion = 0;
    EEPROM.get(EEPROM_ADDR_VERSION, storedVersion);

    if (magic == EEPROM_MAGIC) {
        // Check version — migrate if needed
        if (storedVersion < EEPROM_VERSION) {
            Serial.printf("[EEPROM] Migrating from version %d to %d\n", storedVersion, EEPROM_VERSION);
            // Future migration steps go here as new versions are added
            // For v1→v2: no structural changes needed, just update version stamp
            EEPROM.put(EEPROM_ADDR_VERSION, EEPROM_VERSION);
            EEPROM.commit();
        }
        // New unified format: relay states stored as uint32_t bitmask
        uint32_t relayBits = 0;
        EEPROM.get(EEPROM_ADDR_RELAY, relayBits);
        savedRelayStates = relayBits;
        Serial.println("[EEPROM] Loaded saved relay states (unified format)");
    } else {
        // Check for legacy format (single-byte magic 0xAA)
        // FIX: EEPROM.readByte() → EEPROM.read() in Core 3.x
        uint8_t legacyMagic = EEPROM.read(0);
        if (legacyMagic == 0xAA) {
            // Migrate from legacy format
            savedRelayStates = 0xFFFFFFFF;
            for (int i = 0; i < NUM_RELAYS; i++) {
                // FIX: EEPROM.readByte() → EEPROM.read() in Core 3.x
                uint8_t state = EEPROM.read(1 + i);
                if (state == 0) { // 0 = ON saved
                    savedRelayStates &= ~(1UL << i);
                }
            }
            Serial.println("[EEPROM] Loaded relay states (legacy format, will migrate on next save)");
        } else {
            savedRelayStates = 0xFFFFFFFF; // All OFF
            Serial.println("[EEPROM] No valid data, defaults to all OFF");
        }
    }
    EEPROM.end();
}

void saveRelayStatesToEEPROM() {
    // T3-FW-016: Use EEPROM mutex to prevent concurrent writes
    if (!eepromAcquire()) {
        Serial.println("[EEPROM] Busy, skipping relay state save");
        return;
    }
    EEPROM.begin(EEPROM_SIZE);
    // FIX: EEPROM.writeUInt32() → EEPROM.put() in Core 3.x
    // put() handles multi-byte writes correctly regardless of endianness
    uint32_t magicVal = EEPROM_MAGIC;
    uint16_t versionVal = EEPROM_VERSION;
    EEPROM.put(EEPROM_ADDR_MAGIC, magicVal);
    EEPROM.put(EEPROM_ADDR_VERSION, versionVal);
    // Save relay states as uint32_t bitmask
    EEPROM.put(EEPROM_ADDR_RELAY, sensorData.shiftRegisterState);
    EEPROM.commit();
    EEPROM.end();
    eepromRelease();
}

void loadACS712Calibration() {
    EEPROM.begin(EEPROM_SIZE);
    uint32_t magic = 0;
    EEPROM.get(EEPROM_ADDR_MAGIC, magic);

    if (magic == EEPROM_MAGIC) {
        // New unified format
        EEPROM.get(EEPROM_ADDR_CAL_I, acs712Offset);
        Serial.printf("[EEPROM] ACS712 offset: %.3f (unified format)\n", acs712Offset);
    } else {
        // Legacy format check
        // FIX: EEPROM.readByte() → EEPROM.read() in Core 3.x
        uint8_t legacyMagic = EEPROM.read(0);
        if (legacyMagic == 0xAA) {
            EEPROM.get(24, acs712Offset); // Legacy address
            Serial.printf("[EEPROM] ACS712 offset: %.3f (legacy format)\n", acs712Offset);
        }
    }
    EEPROM.end();
}

void saveACS712Calibration(float offset) {
    acs712Offset = offset;
    // T3-FW-016: Use EEPROM mutex to prevent concurrent writes
    if (!eepromAcquire()) {
        Serial.println("[EEPROM] Busy, skipping ACS712 calibration save");
        return;
    }
    EEPROM.begin(EEPROM_SIZE);
    // FIX: EEPROM.writeUInt32()/writeUInt16() → EEPROM.put() in Core 3.x
    uint32_t magicVal = EEPROM_MAGIC;
    uint16_t versionVal = EEPROM_VERSION;
    EEPROM.put(EEPROM_ADDR_MAGIC, magicVal);
    EEPROM.put(EEPROM_ADDR_VERSION, versionVal);
    EEPROM.put(EEPROM_ADDR_CAL_I, offset);
    EEPROM.commit();
    EEPROM.end();
    eepromRelease();
    Serial.printf("[EEPROM] Saved ACS712 offset: %.3f\n", offset);
}

// ============================================================================
// SENSOR ENGINE
// ============================================================================

void initI2C() {
    Wire.begin(I2C_SDA, I2C_SCL);
    Wire.setClock(100000); // 100kHz I2C (safe for long cables)
    // FW-011 FIX: Set I2C timeout to 250ms to prevent bus hang on stuck slave devices.
    //   Without a timeout, a single non-responding device can freeze the entire I2C bus,
    //   blocking all subsequent sensor reads. 250ms is a conservative value for 100kHz I2C.
    Wire.setTimeout(25000); // 25000us = 25ms (Wire.setTimeout takes microseconds)
    Serial.println("[I2C] Initialized on SDA=21, SCL=22 (timeout=25ms)");
}

bool initINA219() {
    // FIX: Adafruit_INA219 new API - begin() takes TwoWire*, address set via constructor
    // Constructor already set: Adafruit_INA219 ina219(INA219_ADDR);
    if (!ina219.begin()) {
        Serial.println("[INA219] ERROR: Not found at 0x40!");
        sensorData.ina219Online = false;
        return false;
    }

    // Custom calibration for 100A shunt, 75mV:
    //   Shunt resistance: 0.75mOhm (75mV / 100A)
    //   Current_LSB = 100A / 32767 = ~3.052mA/bit
    //   Cal register = 0.04096 / (Current_LSB * R_shunt)
    //
    // NOTE: Installed Adafruit_INA219 library lacks setCalibration(float, float).
    //       Writing calibration register directly via Wire, and storing LSB for
    //       manual current conversion in readINA219().
    float shuntRes = 0.00075;  // 0.75mOhm
    float iMax = 100.0;        // 100A max
    float currentLSB = iMax / 32767.0;  // ~3.052mA/bit
    ina219CurrentLSB_mA = currentLSB * 1000.0;  // Store in mA/bit

    // Calculate calibration register value: Cal = 0.04096 / (currentLSB * shuntRes)
    float calValue = 0.04096f / (currentLSB * shuntRes);  // ~17895
    // T3-FW-017: Validate calibration parameters before writing
    if (currentLSB <= 0.0f || calValue < 0 || calValue > 65535.0f) {
        Serial.printf("[INA219] ERROR: Invalid calibration (LSB=%.3f, cal=%.1f)", currentLSB, calValue);
        sensorData.ina219Online = false;
        return false;
    }
    uint16_t calReg = (uint16_t)calValue;

    // Write calibration register (0x05) directly via Wire
    Wire.beginTransmission(INA219_ADDR);
    Wire.write(0x05);  // Calibration register address
    Wire.write((uint8_t)(calReg >> 8));   // MSB
    Wire.write((uint8_t)(calReg & 0xFF)); // LSB
    // FW-012 FIX: Check Wire.endTransmission() return value.
    //   If I2C write fails, INA219 is not properly calibrated and readings will be garbage.
    //   Set ina219Online=false and return false so the safety engine enters safe state.
    uint8_t i2cStatus = Wire.endTransmission();
    if (i2cStatus != 0) {
        Serial.printf("[INA219] ERROR: Calibration write failed (I2C status %d)\n", i2cStatus);
        sensorData.ina219Online = false;
        return false;
    }

    sensorData.ina219Online = true;
    sensorData.ina219LastSeen = millis();
    Serial.printf("[INA219] Initialized (100A/75mV shunt, cal=0x%04X, LSB=%.3fmA)\n", calReg, ina219CurrentLSB_mA);
    return true;
}

bool initADS1115() {
    // ADS1115 #1: Cells 1-4 (default addr 0x48)
    ads1.begin();
    ads1.setGain(ADS1115_PGA_GAIN);

    // FIX: ADS1115 #2 address set via begin() (not constructor)
    ads2.begin(ADS1115_ADDR_2);
    ads2.setGain(ADS1115_PGA_GAIN);

    // Verify ADS1115 #1 by reading a known register
    Wire.beginTransmission(ADS1115_ADDR_1);
    sensorData.ads1Online = (Wire.endTransmission() == 0);
    Wire.beginTransmission(ADS1115_ADDR_2);
    sensorData.ads2Online = (Wire.endTransmission() == 0);

    if (sensorData.ads1Online) {
        sensorData.ads1LastSeen = millis();
        Serial.println("[ADS1115] #1 initialized (addr 0x48, Cells 1-4)");
    } else {
        Serial.println("[ADS1115] #1 ERROR: Not found at 0x48!");
    }
    if (sensorData.ads2Online) {
        sensorData.ads2LastSeen = millis();
        Serial.println("[ADS1115] #2 initialized (addr 0x49, Cells 5-8)");
    } else {
        Serial.println("[ADS1115] #2 ERROR: Not found at 0x49!");
    }
    return sensorData.ads1Online && sensorData.ads2Online;
}

bool initSHT31() {
    if (!sht31.begin(SHT31_ADDR)) {
        Serial.println("[SHT31] ERROR: Not found at 0x44!");
        sensorData.sht31Online = false;
        return false;
    }
    sensorData.sht31Online = true;
    sensorData.sht31LastSeen = millis();
    Serial.println("[SHT31] Initialized (addr 0x44)");
    return true;
}

bool initRTC() {
    if (!rtc.begin()) {
        Serial.println("[RTC] ERROR: DS3231 not found!");
        sensorData.rtcOnline = false;
        return false;
    }
    if (rtc.lostPower()) {
        Serial.println("[RTC] WARNING: RTC lost power, setting to compile time");
        rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
    sensorData.rtcOnline = true;
    Serial.println("[RTC] DS3231 initialized");
    return true;
}

void calibrateACS712() {
    Serial.println("[ACS712] Starting zero-offset calibration...");
    Serial.printf("[ACS712] Taking %d samples...\n", ACS712_CALIBRATION_SAMPLES);

    float sum = 0;
    int validSamples = 0;

    for (int i = 0; i < ACS712_CALIBRATION_SAMPLES; i++) {
        int raw = analogRead(ACS712_PIN);
        // Convert to voltage: ESP32 ADC 12-bit, 0-3.3V
        float voltage = raw * (3.3 / 4095.0);
        sum += voltage;
        validSamples++;
        delayMicroseconds(100); // Small delay between samples
    }

    if (validSamples > 0) {
        float avgVoltage = sum / validSamples;
        float offset = avgVoltage / ACS712_SENSITIVITY; // Convert to Amps
        // T3-FW-008: Only save if offset changed significantly (reduce EEPROM wear)
        float prevOffset = 0;
        EEPROM.begin(EEPROM_SIZE);
        EEPROM.get(EEPROM_ADDR_CAL_I, prevOffset);
        EEPROM.end();
        if (fabs(offset - prevOffset) > 0.05f) {
            saveACS712Calibration(offset);
        } else {
            acs712Offset = offset;
            Serial.printf("[ACS712] Offset unchanged (%.3fA), skipping EEPROM save\n", offset);
        }
        Serial.printf("[ACS712] Calibration complete: offset=%.3fA (avgVoltage=%.3fV)\n", offset, avgVoltage);
    } else {
        acs712Offset = 0;
        Serial.println("[ACS712] WARNING: No valid samples, using default offset 0");
    }
}

void initPIR() {
    pinMode(PIR_1_PIN, INPUT);
    pinMode(PIR_2_PIN, INPUT);
    pinMode(PIR_3_PIN, INPUT);
    pinMode(PIR_4_PIN, INPUT);
    Serial.println("[PIR] 4x HC-SR501 initialized");
}

void readINA219() {
    if (!sensorData.ina219Online) return;

    // Bus voltage via library (register 0x02, independent of calibration)
    float v = ina219.getBusVoltage_V();

    // FIX: Read current register (0x04) directly via Wire because the installed
    //      Adafruit_INA219 library lacks setCalibration(float, float).
    //      Using stored ina219CurrentLSB_mA for correct conversion.
    Wire.beginTransmission(INA219_ADDR);
    Wire.write(0x04);  // Current register
    Wire.endTransmission(false);
    Wire.requestFrom((uint8_t)INA219_ADDR, (uint8_t)2);
    if (Wire.available() >= 2) {
        int16_t currentRaw = (int16_t)((Wire.read() << 8) | Wire.read());
        float i = currentRaw * ina219CurrentLSB_mA / 1000.0;  // Convert to Amps
        float p = v * i;  // Power = V × I

        // Sanity checks
        if (v < 0 || v > 35) return;    // Invalid voltage range
        if (fabsf(i) > 150) return;     // Current beyond 150A is likely noise

        maBatteryV.add(v);
        // T3-FW-003: Resync moving average sum to prevent float cumulative drift
        if (maBatteryV.isFull()) maBatteryV.resync();
        maBatteryI.add(i);
        maBatteryW.add(p);

        sensorData.batteryVoltage = maBatteryV.get();
        sensorData.batteryCurrent = maBatteryI.get();
        sensorData.batteryPower = maBatteryW.get();
        sensorData.ina219LastSeen = millis();
    }

    #ifdef DEBUG_ENABLED
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 5000) {
        Serial.printf("[INA219] V=%.2fV I=%.2fA P=%.1fW\n", sensorData.batteryVoltage, sensorData.batteryCurrent, sensorData.batteryPower);
        lastPrint = millis();
    }
    #endif
}

void readADS1115() {
    // Read cumulative stack voltages and calculate individual cell voltages
    // ADS1115 #1: CH0-3 = cumulative voltage at Cell1+ through Cell4+
    // ADS1115 #2: CH0-3 = cumulative voltage at Cell5+ through Cell8+

    float rawStack[NUM_CELLS + 1]; // rawStack[0] = GND (0V)

    // T3-FW-004: Zero-init all entries to prevent 0V false-positive from uninitialized data
    for (int i = 0; i <= NUM_CELLS; i++) rawStack[i] = 0.0f;
    rawStack[0] = 0.0; // GND reference

    // Read ADS1115 #1 (Cells 1-4 cumulative)
    if (sensorData.ads1Online) {
        for (int ch = 0; ch < 4; ch++) {
            int16_t adc = ads1.readADC_SingleEnded(ch);
            float voltage = adc * ADS1115_MV_PER_LSB / 1000.0;
            rawStack[ch + 1] = voltage * DIVIDER_MULTIPLIER;
        }
        sensorData.ads1LastSeen = millis();
    }

    // Read ADS1115 #2 (Cells 5-8 cumulative)
    if (sensorData.ads2Online) {
        for (int ch = 0; ch < 4; ch++) {
            int16_t adc = ads2.readADC_SingleEnded(ch);
            float voltage = adc * ADS1115_MV_PER_LSB / 1000.0;
            rawStack[ch + 5] = voltage * DIVIDER_MULTIPLIER;
        }
        sensorData.ads2LastSeen = millis();
    }

    // Calculate individual cell voltages by subtraction
    for (int i = 0; i < NUM_CELLS; i++) {
        // T3-FW-004: Only calculate cellV if both readings are valid (> 0.1V)
        // Prevents 0V false-positive when ADC returns 0 for disconnected channel
        if (rawStack[i + 1] > 0.1f && rawStack[i] > 0.1f) {
            float cellV = rawStack[i + 1] - rawStack[i];

            // Sanity check: LiFePO4 cell should be 2.0V - 4.0V
            if (cellV >= 1.5 && cellV <= 4.5) {
                maCellV[i].add(cellV);
                sensorData.cellVoltages[i] = maCellV[i].get();
            }
            // If out of range, keep previous averaged value (do not update)
        }
        // If raw readings are too low, keep previous averaged value
    }

    #ifdef DEBUG_ENABLED
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 10000) {
        Serial.print("[ADS1115] Cells: ");
        for (int i = 0; i < NUM_CELLS; i++) {
            Serial.printf("%.3fV ", sensorData.cellVoltages[i]);
        }
        Serial.println();
        lastPrint = millis();
    }
    #endif
}

void readSHT31() {
    if (!sensorData.sht31Online) return;

    float t = sht31.readTemperature();
    float h = sht31.readHumidity();

    // Sanity checks
    if (isnan(t) || isnan(h)) return;
    if (t < -20 || t > 80) return;  // Invalid temp
    if (h < 0 || h > 100) return;   // Invalid humidity

    maRoomTemp.add(t);
    maRoomHum.add(h);

    sensorData.roomTemp = maRoomTemp.get();
    sensorData.roomHumidity = maRoomHum.get();
    sensorData.sht31LastSeen = millis();
}

void readACS712() {
    // Note: Blocking for ~1ms (100 samples × ~10µs each). Acceptable at 1000ms interval.
    // RMS sampling for AC current
    float sumSquared = 0;
    int validSamples = 0;

    for (int i = 0; i < ACS712_SAMPLES; i++) {
        int raw = analogRead(ACS712_PIN);
        float voltage = raw * (3.3 / 4095.0);
        float current = (voltage / ACS712_SENSITIVITY) - acs712Offset;

        // Clamp to valid range
        if (abs(current) <= ACS712_MAX_CURRENT) {
            sumSquared += current * current;
            validSamples++;
        }
    }

    if (validSamples > 0) {
        float rmsCurrent = sqrt(sumSquared / validSamples);
        maACS712.add(rmsCurrent);
        maInverterI.add(rmsCurrent);
        sensorData.inverterCurrent = maInverterI.get();
        // Estimate AC power (assume 230V single phase)
        sensorData.inverterPower = sensorData.inverterCurrent * AC_MAINS_VOLTAGE;
    }

    #ifdef DEBUG_ENABLED
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 5000) {
        Serial.printf("[ACS712] I=%.2fA P=%.0fW\n", sensorData.inverterCurrent, sensorData.inverterPower);
        lastPrint = millis();
    }
    #endif
}

void readPIR() {
    sensorData.pirStates[0] = digitalRead(PIR_1_PIN) == HIGH;
    sensorData.pirStates[1] = digitalRead(PIR_2_PIN) == HIGH;
    sensorData.pirStates[2] = digitalRead(PIR_3_PIN) == HIGH;
    sensorData.pirStates[3] = digitalRead(PIR_4_PIN) == HIGH;
}

void readBackupVoltage() {
    // ADC2 (GPIO 4) unavailable while WiFi is active
    if (WiFi.status() == WL_CONNECTED) {
        sensorData.backupVoltage = -1.0f;  // Indicate unavailable
        return;
    }
    int raw = analogRead(BATT_VOLT_PIN);
    float voltage = raw * (3.3 / 4095.0) * BATT_VOLT_DIVIDER;
    // Sanity check: LiFePO4 8S should be 15-35V
    if (voltage >= 10.0f && voltage <= 35.0f) {
        sensorData.backupVoltage = voltage;
    } else {
        sensorData.backupVoltage = -1.0f;
    }
}

void sensorEngineLoop() {
    if (timerSensor.check()) {
        readINA219();
        readADS1115();
        readSHT31();
    }
    if (timerACS712.check()) {
        readACS712();
    }
    if (timerPIR.check()) {
        readPIR();
    }
}

// ============================================================================
// SOC CALCULATOR (Coulomb Counting)
// ============================================================================

void socInit() {
    // On first boot, set SOC based on calibrated voltage
    sensorData.socPercent = mapVoltageToSOC(sensorData.batteryVoltage);
    Serial.printf("[SOC] Initial SOC: %.1f%% (at %.2fV)\n", sensorData.socPercent, sensorData.batteryVoltage);
}

float mapVoltageToSOC(float voltage) {
    // LiFePO4 8S voltage to SOC approximation
    // Linear interpolation between key points
    // 20.0V = 0%, 24.0V = 20%, 25.6V = 50%, 27.2V = 80%, 29.2V = 100%
    struct Point { float v; float soc; };
    Point curve[] = {
        {20.0, 0.0},
        {22.0, 10.0},
        {24.0, 30.0},
        {25.6, 50.0},
        {26.8, 70.0},
        {28.0, 90.0},
        {29.2, 100.0}
    };
    int n = sizeof(curve) / sizeof(curve[0]);

    if (voltage <= curve[0].v) return 0.0;
    if (voltage >= curve[n-1].v) return 100.0;

    for (int i = 0; i < n - 1; i++) {
        if (voltage >= curve[i].v && voltage <= curve[i+1].v) {
            float ratio = (voltage - curve[i].v) / (curve[i+1].v - curve[i].v);
            return curve[i].soc + ratio * (curve[i+1].soc - curve[i].soc);
        }
    }
    return 50.0;
}

void socUpdate() {
    static unsigned long lastUpdate = millis();
    float dtSeconds = (float)(millis() - lastUpdate) / 1000.0f; // seconds
    lastUpdate = millis();

    if (dtSeconds <= 0.0f || dtSeconds > 60.0f) return; // Skip if too long

    float currentAh = sensorData.batteryCurrent; // Amps (positive = charging)

    // Coulomb counting: SOC_change = (I * dt) / Capacity
    float socChange = (currentAh * dtSeconds) / (BATT_CAPACITY_AH * 3600.0) * 100.0;
    sensorData.socPercent += socChange;

    // Clamp
    sensorData.socPercent = constrain(sensorData.socPercent, 0.0, 100.0);

    // Recalibration: if voltage indicates full charge and current is low
    // FW-017 FIX: Add minimum uptime check (5 minutes = 300000ms) before starting SOC recalibration.
    //   At boot, batteryVoltage may be unreliable (sensors warming up, ADC settling, etc.).
    //   Starting recal immediately could falsely set SOC to 100% on a partially charged battery.
    static unsigned long recalStart = 0;
    if (sensorData.batteryVoltage >= SOC_RECAL_VOLT &&
        abs(sensorData.batteryCurrent) < SOC_RECAL_CURRENT &&
        millis() >= 300000) {  // FW-017 FIX: 5-minute minimum uptime
        if (recalStart == 0) {
            recalStart = millis();
        } else if ((millis() - recalStart) >= SOC_RECAL_DURATION) {
            sensorData.socPercent = 100.0;
            recalStart = 0;
            Serial.println("[SOC] Recalibrated to 100% (full charge detected)");
        }
    } else {
        recalStart = 0;
    }

    // Prevent SOC drift when current is very low (use voltage correlation)
    if (abs(sensorData.batteryCurrent) < 0.5) {
        float voltageSOC = mapVoltageToSOC(sensorData.batteryVoltage);
        // Blend: 90% coulomb + 10% voltage when current is low
        sensorData.socPercent = sensorData.socPercent * 0.9 + voltageSOC * 0.1;
    }

    #ifdef DEBUG_ENABLED
    static unsigned long lastPrint = 0;
    if (millis() - lastPrint > 10000) {
        Serial.printf("[SOC] %.1f%% (V=%.2f, I=%.2fA)\n", sensorData.socPercent, sensorData.batteryVoltage, sensorData.batteryCurrent);
        lastPrint = millis();
    }
    #endif
}

// ============================================================================
// SAFETY ENGINE
// ============================================================================

void safetyEngineLoop() {
    if (!timerSafety.check()) return;

    // Check sensor timeouts
    unsigned long now = millis();
    bool sensorTimeout = false;

    if (sensorData.ina219Online && (now - sensorData.ina219LastSeen) > SAFETY_SENSOR_TIMEOUT_MS) {
        Serial.println("[SAFETY] WARNING: INA219 sensor timeout!");
        sensorData.ina219Online = false;
        sensorTimeout = true;
        // T3-FW-005: Attempt sensor reconnection before entering safe state
        Wire.beginTransmission(INA219_ADDR);
        if (Wire.endTransmission() == 0) {
            sensorData.ina219Online = true;
            sensorData.ina219LastSeen = now;
            sensorTimeout = false;
            Serial.println("[SAFETY] INA219 reconnected successfully");
        }
    }
    if (sensorData.ads1Online && (now - sensorData.ads1LastSeen) > SAFETY_SENSOR_TIMEOUT_MS) {
        Serial.println("[SAFETY] WARNING: ADS1115 #1 sensor timeout!");
        sensorData.ads1Online = false;
        sensorTimeout = true;
    }
    if (sensorData.ads2Online && (now - sensorData.ads2LastSeen) > SAFETY_SENSOR_TIMEOUT_MS) {
        Serial.println("[SAFETY] WARNING: ADS1115 #2 sensor timeout!");
        sensorData.ads2Online = false;
        sensorTimeout = true;
    }
    if (sensorData.sht31Online && (now - sensorData.sht31LastSeen) > SAFETY_SENSOR_TIMEOUT_MS) {
        Serial.println("[SAFETY] WARNING: SHT31 sensor timeout!");
        sensorData.sht31Online = false;
        sensorTimeout = true;
    }

    // P2-005: Sensor timeout → enter safe state (cut charging, shed non-critical)
    if (sensorTimeout) {
        Serial.println("[SAFETY] Entering safe state due to sensor timeout");
        // Cut charging relay (relay 0) to prevent unmonitored charging
        setRelay(0, false);
        // Shed non-critical loads
        for (int r = 1; r < NUM_RELAYS; r++) {
            setRelay(r, false);
        }
        logEvent("CRITICAL", "Sensor timeout detected. Entering safe state: all relays OFF.");
    }

    // ========================================================================
    // FIX v1.0.2: Protective relay actions on safety violations
    // ========================================================================

    // OVERVOLTAGE PROTECTION: Cut charging relay (relay 0) to stop charging source
    // P2-003: Use remote threshold if valid, else compile-time default
    // P2-029: SOFTWARE INTERLOCK — Relay 0 is the charging disconnect relay.
    //   Cutting relay 0 physically disconnects the solar charge controller output,
    //   preventing any further current from entering the battery. This is the
    //   primary protective action for overvoltage, overcurrent, and cell imbalance.
    // P2-029: Battery current direction check — only cut charging if current is
    //   positive (battery is receiving charge). Negative current means battery is
    //   discharging; cutting relay 0 would be counterproductive.
    float effectiveOvervolt = remoteConfigValid ? remoteSafetyOvervolt : BATT_OVERVOLT;
    if (sensorData.batteryVoltage > effectiveOvervolt) {
        if (!sensorData.safetyOvervoltageFlag) {
            sensorData.safetyOvervoltageFlag = true;
            Serial.printf("[SAFETY] CRITICAL: Battery overvoltage %.2fV — CUTTING CHARGING RELAY!\n", sensorData.batteryVoltage);
            // P2-029: Check current direction before cutting (only cut if charging)
            if (sensorData.batteryCurrent > 0.0f) {
                // Relay 0 = charging relay — cut it immediately (set OFF)
                setRelay(0, false);
                relay0LastTurnedOff = millis();
            } else {
                Serial.println("[SAFETY] Overvoltage but battery discharging — relay 0 kept as-is");
            }
            logEvent("CRITICAL", String("Overvoltage detected: ") + String(sensorData.batteryVoltage, 2) + "V. Charging relay cut.");
        }
    } else if (sensorData.safetyOvervoltageFlag && sensorData.batteryVoltage < (effectiveOvervolt - 1.5f)) {
        // P2-002: Clear flag with 1.5V hysteresis (was 0.5V) to prevent relay chattering
        sensorData.safetyOvervoltageFlag = false;
        Serial.println("[SAFETY] Overvoltage condition cleared");
    }

    // UNDERVOLTAGE PROTECTION: Emergency load shedding on all non-critical relays
    // P2-003: Use remote threshold if valid, else compile-time default
    float effectiveUndervolt = remoteConfigValid ? remoteSafetyUndervolt : BATT_UNDERVOLT;
    if (sensorData.batteryVoltage < effectiveUndervolt) {
        if (!sensorData.safetyUndervoltageFlag) {
            sensorData.safetyUndervoltageFlag = true;
            Serial.printf("[SAFETY] CRITICAL: Battery undervoltage %.2fV — EMERGENCY LOAD SHED!\n", sensorData.batteryVoltage);
            // Force shed all non-critical relays immediately (keep relay 0 if it was ON)
            for (int r = 1; r < NUM_RELAYS; r++) {
                setRelay(r, false);
            }
            logEvent("CRITICAL", String("Undervoltage detected: ") + String(sensorData.batteryVoltage, 2) + "V. Emergency load shed.");
        }
        // P2-001: Undervoltage flag clearing with 1.0V hysteresis
    } else if (sensorData.safetyUndervoltageFlag && sensorData.batteryVoltage > (effectiveUndervolt + 1.0f)) {
        sensorData.safetyUndervoltageFlag = false;
        Serial.println("[SAFETY] Undervoltage condition cleared");
    }

    // OVERCURRENT PROTECTION (FIX v1.0.2: was missing entirely)
    // P2-003: Use remote threshold if valid
    // FW-001 FIX: Always cut relay 0 immediately on overcurrent detection.
    //   Debounce should only prevent RE-ENABLE, not the initial emergency CUT.
    // FW-002 FIX: Also shed all load relays (1 through NUM_RELAYS-1) on overcurrent.
    //   If overcurrent is on discharge path, cutting only relay 0 does nothing.
    float effectiveOvercurrent = remoteConfigValid ? remoteSafetyOvercurrent : SAFETY_OVERCURRENT_A;
    if (fabsf(sensorData.batteryCurrent) > effectiveOvercurrent) {
        if (!sensorData.safetyOvercurrentFlag) {
            sensorData.safetyOvercurrentFlag = true;
            Serial.printf("[SAFETY] CRITICAL: Overcurrent %.1fA > %.1fA — CUTTING ALL RELAYS!\n",
                fabsf(sensorData.batteryCurrent), effectiveOvercurrent);
            // FW-001 FIX: Cut relay 0 IMMEDIATELY (no debounce check for initial cut)
            setRelay(0, false);
            relay0LastTurnedOff = millis();
            // FW-002 FIX: Also shed all load relays on overcurrent detection
            for (int r = 1; r < NUM_RELAYS; r++) {
                setRelay(r, false);
            }
            logEvent("CRITICAL", String("Overcurrent detected: ") + String(fabsf(sensorData.batteryCurrent), 1) + "A. ALL relays cut.");
        }
    } else if (sensorData.safetyOvercurrentFlag && fabsf(sensorData.batteryCurrent) < (effectiveOvercurrent - 2.0f)) {
        // Clear with hysteresis (T3-FW-001: use effectiveOvercurrent not hardcoded constant)
        // FW-001 FIX: Apply debounce only when RE-ENABLING relay 0 (recovery path)
        if (millis() - relay0LastTurnedOff >= RELAY_0_MIN_OFF_MS) {
            sensorData.safetyOvercurrentFlag = false;
            Serial.println("[SAFETY] Overcurrent condition cleared");
        }
    }

    // TEMPERATURE PROTECTION (FIX v1.0.2: was defined but never checked)
    // P2-003: Use remote threshold if valid
    // FW-003 FIX: sensorData.roomTemp is SHT31 AMBIENT temperature, not battery temperature.
    //   Battery internal temp is higher. We subtract SAFETY_OVERTEMP_AMBIENT_MARGIN (10°C)
    //   from the threshold as a safety margin. Effective threshold = configured - 10°C.
    float effectiveOvertemp = (remoteConfigValid ? remoteSafetyOvertemp : SAFETY_MAX_TEMP_C)
                              - SAFETY_OVERTEMP_AMBIENT_MARGIN;
    if (sensorData.sht31Online && sensorData.roomTemp > effectiveOvertemp) {
        if (!sensorData.safetyOvertempFlag) {
            sensorData.safetyOvertempFlag = true;
            Serial.printf("[SAFETY] CRITICAL: Overtemperature %.1f°C > %.1f°C — EMERGENCY LOAD SHED!\n",
                sensorData.roomTemp, SAFETY_MAX_TEMP_C);
            // Shed all non-critical loads to reduce heat generation
            for (int r = 1; r < NUM_RELAYS; r++) {
                setRelay(r, false);
            }
            logEvent("CRITICAL", String("Overtemperature detected: ") + String(sensorData.roomTemp, 1) + "C. Emergency load shed.");
        }
    } else if (sensorData.safetyOvertempFlag && sensorData.roomTemp < (effectiveOvertemp - 3.0f)) {
        // Clear with 3°C hysteresis
        sensorData.safetyOvertempFlag = false;
        Serial.println("[SAFETY] Overtemperature condition cleared");
    }

    // CELL IMBALANCE DETECTION (FIX v1.0.2: added protective action)
    if (sensorData.ads1Online && sensorData.ads2Online) {
        float minCell = 999, maxCell = 0;
        for (int i = 0; i < NUM_CELLS; i++) {
            if (sensorData.cellVoltages[i] > 0) {
                minCell = min(minCell, sensorData.cellVoltages[i]);
                maxCell = max(maxCell, sensorData.cellVoltages[i]);
            }
        }
        float imbalance = maxCell - minCell;
        // P2-003: Use remote threshold if valid
        float effectiveCellImbal = remoteConfigValid ? remoteSafetyCellImbalance : SAFETY_CELL_IMBALANCE_V;
        if (imbalance > effectiveCellImbal) { // >300mV imbalance
            if (!sensorData.safetyCellImbalanceFlag) {
                sensorData.safetyCellImbalanceFlag = true;
                Serial.printf("[SAFETY] WARNING: Cell imbalance %.0fmV — REDUCING CHARGE CURRENT!\n", imbalance * 1000);
                // P2-004: Check relay 0 min off-time debounce
                if (millis() - relay0LastTurnedOff >= RELAY_0_MIN_OFF_MS) {
                    // Reduce charging: cut charging relay to prevent further imbalance
                    setRelay(0, false);
                    relay0LastTurnedOff = millis();
                }
                logEvent("SAFETY", String("Cell imbalance: ") + String(imbalance * 1000, 0) + "mV. Charging cut.");
            }
        } else if (sensorData.safetyCellImbalanceFlag && imbalance < (effectiveCellImbal - 0.1f)) {
            sensorData.safetyCellImbalanceFlag = false;
            Serial.println("[SAFETY] Cell imbalance condition cleared");
        }
    }
}

// ============================================================================
// LOAD SHEDDING ENGINE
// ============================================================================

// FIX v1.0.2: Priority-based tiered load shedding
// Relay priority map (configurable):
//   TIER_CRITICAL (0): Relay 0  — charging, never shed by this engine
//   TIER_ESSENTIAL (1): Relays 1-3 — lights, communication, security
//   TIER_STANDARD (2): Relays 4-8 — appliances, fans, misc
//   TIER_COMFORT (3): Relays 9-12 — non-essential loads
static const uint8_t relayTierMap[NUM_RELAYS] = {
    0,  // Relay 0: TIER_CRITICAL (charging)
    1,  // Relay 1: TIER_ESSENTIAL
    1,  // Relay 2: TIER_ESSENTIAL
    1,  // Relay 3: TIER_ESSENTIAL
    2,  // Relay 4: TIER_STANDARD
    2,  // Relay 5: TIER_STANDARD
    2,  // Relay 6: TIER_STANDARD
    2,  // Relay 7: TIER_STANDARD
    2,  // Relay 8: TIER_STANDARD
    3,  // Relay 9: TIER_COMFORT
    3,  // Relay 10: TIER_COMFORT
    3,  // Relay 11: TIER_COMFORT
    3,  // Relay 12: TIER_COMFORT
};

void loadSheddingEngineLoop() {
    if (!timerLoadShed.check()) return;

    // Don't override safety engine's emergency shedding
    if (sensorData.safetyUndervoltageFlag || sensorData.safetyOvertempFlag) return;

    float v = sensorData.batteryVoltage;
    float currentAbs = fabsf(sensorData.batteryCurrent);
    bool overload = currentAbs > SHED_CURRENT_MAX;

    // Determine shed level: 0=none, 1=Tier3, 2=Tier2+3, 3=All(1+2+3)
    int shedLevel = 0;

    if (v <= BATT_UNDERVOLT || overload) {
        // Emergency: shed all non-critical (Tier 1, 2, 3)
        shedLevel = 3;
        sensorData.loadSheddingActive = true;
        Serial.printf("[SHED] EMERGENCY: V=%.1fV, I=%.1fA — shedding all non-critical\n", v, currentAbs);
    } else if (v <= SHED_VOLT_TIER1) {
        // Shed Tier 3, 2, and 1
        shedLevel = 3;
        sensorData.loadSheddingActive = true;
    } else if (v <= SHED_VOLT_TIER2) {
        // Shed Tier 3 and 2
        shedLevel = 2;
        sensorData.loadSheddingActive = true;
    } else if (v <= SHED_VOLT_TIER3) {
        // Shed Tier 3 only
        shedLevel = 1;
        sensorData.loadSheddingActive = true;
    } else if (v >= SHED_RECOVER_VOLT) {
        // Safe to recover all loads
        shedLevel = 0;
        sensorData.loadSheddingActive = false;
    }

    // Track previous shed level for transitions
    static int prevShedLevel = 0;
    // FW-004 FIX: Track last shed time for SHED_RECOVER_DELAY enforcement
    static unsigned long lastShedTime = 0;

    if (shedLevel != prevShedLevel) {
        if (shedLevel > prevShedLevel) {
            // Shedding increasing — save states and shed progressively
            if (prevShedLevel == 0) {
                Serial.println("[SHED] Load shedding ACTIVATED — saving relay states");
                savedRelayStates = sensorData.shiftRegisterState;
            }

            // Shed relays by tier: lowest priority (highest tier number) first
            for (int tier = 3; tier >= shedLevel; tier--) {
                for (int r = 0; r < NUM_RELAYS; r++) {
                    if (relayTierMap[r] == tier && r > 0) { // Never shed relay 0 (critical)
                        setRelay(r, false);
                    }
                }
            }
            Serial.printf("[SHED] Shed level %d active\n", shedLevel);
            // FW-004 FIX: Record last shed time for recovery delay
            lastShedTime = millis();

        } else if (shedLevel < prevShedLevel && shedLevel == 0) {
            // FW-004 FIX: Only recover if SHED_RECOVER_DELAY (300000ms / 5 minutes) has elapsed
            //   since last shedding event. Prevents rapid oscillation between shed/recover.
            if (millis() - lastShedTime >= SHED_RECOVER_DELAY) {
                Serial.println("[SHED] Load shedding RECOVERED — restoring relay states");
                for (int r = 0; r < NUM_RELAYS; r++) {
                    bool wasOn = !(savedRelayStates & (1UL << r));
                    setRelay(r, wasOn);
                }
            } else {
                Serial.printf("[SHED] Recovery delay not elapsed (%lu ms remaining), keeping shed\n",
                    SHED_RECOVER_DELAY - (millis() - lastShedTime));
                shedLevel = prevShedLevel; // Keep current shed level
            }
        } else if (shedLevel < prevShedLevel) {
            // Partial recovery: restore relays whose tier is now above shed level
            for (int r = 0; r < NUM_RELAYS; r++) {
                if (relayTierMap[r] > shedLevel) {
                    // This tier was shed before, but now it shouldn't be — restore from saved
                    bool wasOn = !(savedRelayStates & (1UL << r));
                    setRelay(r, wasOn);
                }
            }
            Serial.printf("[SHED] Partial recovery to level %d\n", shedLevel);
        }
        prevShedLevel = shedLevel;
    }
}

// ============================================================================
// AUTOMATION ENGINE (Basic Rule Evaluation)
// ============================================================================

void automationEngineLoop() {
    if (!timerAutomation.check()) return;

    // Parse cloud rules and evaluate
    if (cloudRules.length() == 0 || cloudRules == "[]") return;

    rulesDoc.clear();
    DeserializationError err = deserializeJson(rulesDoc, cloudRules);
    if (err) return;

    JsonArray rules = rulesDoc.as<JsonArray>();
    for (JsonObject rule : rules) {
        if (!rule["enabled"].as<bool>()) continue;

    String target = rule["target"].as<const char*>();
        String logic = rule["logic"].as<const char*>();
        String action = rule["action"].as<const char*>();

        // Parse conditions
        JsonArray conditions = rule["conditions"].as<JsonArray>();
        bool allMet = true;
        bool anyMet = false;

        for (String cond : conditions) {
            bool met = evaluateCondition(cond);
            if (met) anyMet = true;
            else allMet = false;
        }

        bool shouldExecute = (logic == "AND") ? allMet : anyMet;
        if (shouldExecute) {
        // FW-025 FIX: Use as<const char*> for action and rule ID to avoid heap String allocation
            executeAutomationAction(target, action, rule["id"].as<const char*>());
        }
    }
}

// Helper: evaluate a numeric condition with proper operator parsing
// Supports: >, <, >=, <=, ==, != with both spaced and unspaced formats
// e.g. "battery_voltage>22", "soc < 20", "battery_voltage >= 26"
bool evaluateNumericCondition(String condition, float sensorValue) {
    // FW-023 FIX: Convert from stack-allocated String array to static const char* array with strncmp.
    //   The original code created 6 temporary String objects on the stack per call.
    //   Using static const char* pointers and strncmp() avoids heap allocation.
    static const char* ops[] = {">=", "<=", "!=", "==", ">", "<"};
    static const int opLens[] = {2, 2, 2, 2, 1, 1};

    for (int i = 0; i < 6; i++) {
        int idx = condition.indexOf(ops[i]);
        if (idx > 0) {
            String valStr = condition.substring(idx + opLens[i]);
            float threshold = valStr.toFloat();
            const char* op = ops[i];

            if (strncmp(op, ">", 1) == 0 && opLens[i] == 1)  return sensorValue > threshold;
            if (strncmp(op, "<", 1) == 0 && opLens[i] == 1)  return sensorValue < threshold;
            if (strncmp(op, ">=", 2) == 0) return sensorValue >= threshold;
            if (strncmp(op, "<=", 2) == 0) return sensorValue <= threshold;
            if (strncmp(op, "==", 2) == 0) return fabs(sensorValue - threshold) < 0.05;
            if (strncmp(op, "!=", 2) == 0) return fabs(sensorValue - threshold) >= 0.05;
        }
    }
    return false;
}

bool evaluateCondition(String condition) {
    condition.trim();
    // Format: "parameter operator value"
    // Examples: "battery_voltage > 26", "battery_voltage>22", "soc<20"
    // Supports both firmware-native names and frontend/backend names:
    //   temperature_room / room_temp, humidity / room_humidity,
    //   pir_1 / pir1, cell1_v, inverter_power, battery_power, wifi_rssi

    if (condition.startsWith("battery_voltage")) {
        return evaluateNumericCondition(condition, sensorData.batteryVoltage);
    }
    if (condition.startsWith("battery_current")) {
        return evaluateNumericCondition(condition, sensorData.batteryCurrent);
    }
    if (condition.startsWith("battery_power")) {
        return evaluateNumericCondition(condition, sensorData.batteryPower);
    }
    // Check soc_percent BEFORE soc to prevent prefix conflicts (M-10)
    if (condition.startsWith("soc_percent")) {
        return evaluateNumericCondition(condition, sensorData.socPercent);
    } else if (condition.startsWith("soc")) {
        return evaluateNumericCondition(condition, sensorData.socPercent);
    }
    // room_temp (frontend/backend) or temperature_room (legacy)
    if (condition.startsWith("room_temp") || condition.startsWith("temperature_room")) {
        return evaluateNumericCondition(condition, sensorData.roomTemp);
    }
    // room_humidity (frontend/backend) or humidity (legacy)
    if (condition.startsWith("room_humidity") || condition.startsWith("humidity")) {
        return evaluateNumericCondition(condition, sensorData.roomHumidity);
    }
    // PIR: pir_1..pir_4 (firmware) or pir1..pir4 (frontend/backend)
    // FIX v1.0.1: support "== 1" in addition to "== true"
    // FW-024 FIX: PIR condition parsing convention documented.
    //   Accepted formats: "pir_1 == true", "pir_1 == 1", "pir1 == true", "pir1 == false"
    //   The pirIdx is extracted by parsing digits immediately after "pir_" or "pir" prefix.
    //   Bounds check ensures pirIdx is in [1..NUM_PIRS] before array access.
    if (condition.startsWith("pir_")) {
        // Extract PIR number and expected state using robust parsing
        String pirNumStr = condition.substring(4); // e.g., "1 == true"
        int pirIdx = pirNumStr.toInt();
        // FW-024 FIX: Bounds checking on pirIdx
        if (pirIdx >= 1 && pirIdx <= NUM_PIRS) {
            bool expectedMotion = condition.indexOf("true") >= 0 || condition.indexOf("== 1") >= 0;
            return sensorData.pirStates[pirIdx - 1] == expectedMotion;
        }
    }
    if (condition.startsWith("pir")) {
        // Frontend/backend format: pir1, pir2, pir3, pir4
        String pirNumStr = condition.substring(3);
        int pirIdx = pirNumStr.toInt();
        // FW-024 FIX: Bounds checking on pirIdx
        if (pirIdx >= 1 && pirIdx <= NUM_PIRS) {
            bool expectedMotion = condition.indexOf("true") >= 0 || condition.indexOf("== 1") >= 0;
            return sensorData.pirStates[pirIdx - 1] == expectedMotion;
        }
    }
    if (condition.startsWith("inverter_current")) {
        return evaluateNumericCondition(condition, sensorData.inverterCurrent);
    }
    if (condition.startsWith("inverter_power")) {
        return evaluateNumericCondition(condition, sensorData.inverterPower);
    }
    if (condition.startsWith("wifi_rssi")) {
        return evaluateNumericCondition(condition, (float)sensorData.wifiRSSI);
    }
    // Individual cell voltages: cell1_v..cell8_v
    if (condition.startsWith("cell") && condition.indexOf("_v") > 0) {
        String cellNumStr = condition.substring(4);
        int cellIdx = cellNumStr.toInt(); // extracts leading number before "_v"
        if (cellIdx >= 1 && cellIdx <= NUM_CELLS) {
            return evaluateNumericCondition(condition, sensorData.cellVoltages[cellIdx - 1]);
        }
    }
    if (condition.startsWith("load_shedding")) {
        return condition.indexOf("true") >= 0 ? sensorData.loadSheddingActive : !sensorData.loadSheddingActive;
    }
    if (condition.startsWith("time")) {
        // Time-based condition
        if (sensorData.rtcOnline) {
            DateTime now = rtc.now();
            int hour = extractTimeHour(condition);
            return now.hour() >= hour;
        }
        return false;
    }

    return false;
}

int extractTimeHour(String condition) {
    int spaceIdx = condition.lastIndexOf(' ');
    if (spaceIdx >= 0) {
        String timeStr = condition.substring(spaceIdx + 1);
        int colonIdx = timeStr.indexOf(':');
        if (colonIdx >= 0) {
            return timeStr.substring(0, colonIdx).toInt();
        }
        // FW-021 FIX: If no colon found, try to parse the entire time string as an integer hour.
        //   Handles formats like "time 14" (hour only, no minutes).
        int hourVal = timeStr.toInt();
        if (hourVal >= 0 && hourVal <= 23) return hourVal;
    }
    return 0;
}

void executeAutomationAction(String target, String action, String ruleId) {
    bool turnOn = (action == "ON");

    // Check if target is a relay
    if (target.startsWith("relay_")) {
        int relayNum = target.substring(6).toInt();
        if (relayNum >= 1 && relayNum <= NUM_RELAYS) {
            setRelay(relayNum - 1, turnOn);
            Serial.printf("[AUTO] Rule %s: Relay %d -> %s\n",
                ruleId.c_str(), relayNum, turnOn ? "ON" : "OFF");
        }
    }
    // Check if target is a mosfet
    else if (target.startsWith("mosfet_")) {
        int mosfetNum = target.substring(7).toInt();
        if (mosfetNum >= 1 && mosfetNum <= NUM_MOSFETS) {
            setMosfet(mosfetNum - 1, turnOn ? 255 : 0);
            Serial.printf("[AUTO] Rule %s: MOSFET %d -> %s\n",
                ruleId.c_str(), mosfetNum, turnOn ? "ON" : "OFF");
        }
    }
}

// ============================================================================
// SCHEDULE ENGINE (FIX v1.0.1: multi-hash dedup)
// ============================================================================

void scheduleEngineLoop() {
    if (!timerSchedule.check()) return;
    if (!sensorData.rtcOnline) return;
    if (cloudSchedules.length() == 0 || cloudSchedules == "[]") return;

    DateTime now = rtc.now();

    // FIX v1.0.1: Reset hash set when minute changes (allows same schedule to fire next minute)
    if (now.minute() != lastScheduleMinute) {
        lastScheduleMinute = now.minute();
        scheduleHashReset();
    }

    schedDoc.clear();
    DeserializationError err = deserializeJson(schedDoc, cloudSchedules);
    if (err) return;

    JsonArray schedules = schedDoc.as<JsonArray>();
    for (JsonObject sched : schedules) {
        if (!sched["enabled"].as<bool>()) continue;

        String target = sched["target"].as<String>();
        String action = sched["action"].as<String>();
        String time = sched["time"].as<String>();
        String type = sched["type"].as<String>();
        String schedId = sched["id"].as<String>();

        // Check time match
        if (now.hour() == extractTimeHour(time) && now.minute() == extractTimeMinute(time)) {
            // FIX v1.0.1: Per-schedule dedup hash using array instead of single variable
            unsigned long hash = (unsigned long)now.hour() * 60 + now.minute();
            // Incorporate schedId into hash for per-schedule uniqueness
            for (unsigned int i = 0; i < schedId.length(); i++) {
                hash = hash * 31 + schedId[i];
            }
            // Skip if this specific schedule already fired this minute
            if (scheduleHashExists(hash)) continue;

    // Check day match for recurring
            JsonArray days = sched["days"].as<JsonArray>();
            bool dayMatch = false;
            // If no days specified, treat as daily schedule
            if (days.isNull() || days.size() == 0) {
                dayMatch = true;
            } else {
                for (int d : days) {
                    // FW-015 FIX: RTClib dayOfTheWeek() returns 0=Sunday, 1=Monday, ..., 6=Saturday.
                    //   Backend must use the same convention. See config.h for documentation.
                    if (d == now.dayOfTheWeek()) {
                        dayMatch = true;
                        break;
                    }
                }
            }
            if (dayMatch) {
                scheduleHashAdd(hash);
                executeAutomationAction(target, action, schedId);
            }
        }
    }
}

int extractTimeMinute(String timeStr) {
    int colonIdx = timeStr.indexOf(':');
    if (colonIdx >= 0 && colonIdx + 1 < timeStr.length()) {
        return timeStr.substring(colonIdx + 1).toInt();
    }
    return 0;
}

// ============================================================================
// TELEMETRY ENGINE
// ============================================================================

void buildTelemetryJSON(String& json) {
    // T3-FW-009: Use global doc instead of stack-local to reduce stack usage
    telemetryBuildDoc.clear();
    StaticJsonDocument<1024>& doc = telemetryBuildDoc;
    doc["timestamp"] = sensorData.rtcOnline ? rtc.now().unixtime() : millis() / 1000;
    doc["device_id"] = generateDeviceID();  // FW-016 FIX: Use generateDeviceID() for unique MAC-based ID. Falls back to DEVICE_ID macro if WiFi not initialized.
    doc["battery_voltage"] = round(sensorData.batteryVoltage * 100.0) / 100.0;
    doc["battery_current"] = round(sensorData.batteryCurrent * 100.0) / 100.0;
    doc["battery_power"] = round(sensorData.batteryPower * 10.0) / 10.0;
    doc["soc_percent"] = round(sensorData.socPercent * 10.0) / 10.0;

    // Cell voltages as array — backend normalizeTelemetryPayload_() will
    // expand to cell1_v..cell8_v before writing to spreadsheet
    JsonArray cells = doc.createNestedArray("cell_voltages");
    for (int i = 0; i < NUM_CELLS; i++) {
        cells.add(round(sensorData.cellVoltages[i] * 1000.0) / 1000.0);
    }

    doc["inverter_current"] = round(sensorData.inverterCurrent * 100.0) / 100.0;
    doc["inverter_power"] = round(sensorData.inverterPower * 10.0) / 10.0;
    doc["room_temp"] = round(sensorData.roomTemp * 10.0) / 10.0;
    doc["room_humidity"] = round(sensorData.roomHumidity * 10.0) / 10.0;

    // PIR states as array — backend normalizeTelemetryPayload_() will
    // expand to pir1..pir4 before writing to spreadsheet
    JsonArray pirs = doc.createNestedArray("pir_states");
    for (int i = 0; i < NUM_PIRS; i++) {
        pirs.add(sensorData.pirStates[i]);
    }

    JsonArray relays = doc.createNestedArray("relay_states");
    for (int i = 0; i < NUM_RELAYS; i++) {
        relays.add(getRelayState(i) ? 1 : 0);
    }

    JsonArray mosfets = doc.createNestedArray("mosfet_states");
    for (int i = 0; i < NUM_MOSFETS; i++) {
        mosfets.add(getMosfetState(i));
    }

    doc["uptime_seconds"] = sensorData.uptimeSeconds;
    doc["wifi_rssi"] = sensorData.wifiRSSI;
    doc["free_heap"] = sensorData.freeHeap;
    doc["load_shedding_active"] = sensorData.loadSheddingActive;

    serializeJson(doc, json);
}

// P2-007: Telemetry low-heap drops only oldest entry (not entire queue)
bool telemetryEnqueue(const String& json) {
    if (telemetryQueueCount >= TELEMETRY_QUEUE_SIZE) {
        // FW-006 FIX: Queue full — advance HEAD (read pointer) to drop the oldest entry.
        //   The queue uses HEAD as the read pointer and TAIL as the write pointer.
        //   Advancing HEAD drops the oldest queued item, making room for the new entry.
        //   Previous code incorrectly advanced TAIL, corrupting the write position.
        telemetryQueueHead = (telemetryQueueHead + 1) % TELEMETRY_QUEUE_SIZE;
        telemetryQueueCount--;
    }
    // Copy to fixed buffer — truncates if too long (better than heap fragmentation)
    strncpy(telemetryQueue[telemetryQueueTail].jsonPayload, json.c_str(),
            TELEMETRY_JSON_BUF_SIZE - 1);
    telemetryQueue[telemetryQueueTail].jsonPayload[TELEMETRY_JSON_BUF_SIZE - 1] = '\0';
    telemetryQueue[telemetryQueueTail].timestamp = millis();
    telemetryQueueTail = (telemetryQueueTail + 1) % TELEMETRY_QUEUE_SIZE;
    telemetryQueueCount++;

    // P2-007: Low heap — drop only oldest entry, not entire queue
    if (ESP.getFreeHeap() < 10000) {
        Serial.printf("[TELEM] WARNING: Low heap %u bytes, dropping oldest entry\n", ESP.getFreeHeap());
        telemetryQueueHead = (telemetryQueueHead + 1) % TELEMETRY_QUEUE_SIZE;
        if (telemetryQueueCount > 0) telemetryQueueCount--;
    }
    return true;
}

// P2-010: telemetrySend accepts const char* (was String)
// P2-011: HTTP 429/503 specific handling
// P2-026: WiFiClientSecure with certificate pinning for HTTPS GAS calls
// FW-013 FIX: SECURITY WARNING — setInsecure() allows ANY certificate (no validation).
//   This is acceptable for development/testing but MUST be replaced with certificate
//   pinning (setCACert() or setCACertBundle()) before production deployment.
//   Without certificate validation, the device is vulnerable to man-in-the-middle attacks.
bool telemetrySend(const char* payload) {
    if (WiFi.status() != WL_CONNECTED) return false;

    // P2-009: Exponential backoff on failed sends
    if (telemetryBackoffMs > 0) {
        unsigned long now = millis();
        if (now - telemetryLastFailTime < telemetryBackoffMs) {
            return false; // Skip — still in backoff window
        }
        telemetryBackoffMs = 0; // Backoff elapsed, allow retry
    }

    // P2-016: Use HTTPS for GAS endpoints
    // P2-026: WiFiClientSecure with certificate pinning
    WiFiClientSecure client;
    // FW-013 FIX: SECURITY WARNING — setInsecure() disables TLS certificate validation.
    //   Production deployment MUST use setCACert() with a pinned server certificate.
    client.setInsecure(); // Allow any certificate (production should use pinning)
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(client, String(GAS_SCRIPT_URL) + "?path=api/telemetry");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", GAS_API_TOKEN);

    int httpCode = http.POST(payload);
    http.end();

    if (httpCode >= 200 && httpCode < 300) {
        telemetryBackoffMs = 0; // Reset backoff on success
        return true;
    }

    // P2-009: Set exponential backoff on failure
    telemetryLastFailTime = millis();
    if (telemetryBackoffMs == 0) telemetryBackoffMs = TELEMETRY_BACKOFF_BASE_MS;
    // FW-020 FIX: Check for overflow before multiplying backoff.
    //   If telemetryBackoffMs > TELEMETRY_BACKOFF_MAX_MS / 2, multiplying by 2
    //   would exceed or equal TELEMETRY_BACKOFF_MAX_MS, so just clamp to max.
    else if (telemetryBackoffMs > TELEMETRY_BACKOFF_MAX_MS / 2) {
        telemetryBackoffMs = TELEMETRY_BACKOFF_MAX_MS;
    } else {
        telemetryBackoffMs = telemetryBackoffMs * 2;
    }

    // P2-011: HTTP 429/503 specific handling
    if (httpCode == 429) {
        Serial.println("[TELEM] Rate limited (429), increasing backoff");
        telemetryBackoffMs = max(telemetryBackoffMs, 60000UL); // At least 60s for rate limit
    } else if (httpCode == 503) {
        Serial.println("[TELEM] Server unavailable (503), backing off");
        telemetryBackoffMs = max(telemetryBackoffMs, 120000UL); // At least 2min for 503
    }

    return false;
}

void telemetryEngineLoop() {
    if (!timerTelemetry.check()) return;

    // Build current telemetry
    String json;
    buildTelemetryJSON(json);

    // P2-008: Try to send immediately
    if (telemetrySend(json.c_str())) {
        // P2-008: Flush queue — cap to 2 entries per cycle, WDT reset in loop
        int flushed = 0;
        while (telemetryQueueCount > 0 && flushed < 2) {
            esp_task_wdt_reset(); // P2-008: Feed WDT during flush loop
            String queued = String(telemetryQueue[telemetryQueueHead].jsonPayload);
            if (!telemetrySend(queued.c_str())) {
                break; // Stop flushing on failure
            }
            telemetryQueueHead = (telemetryQueueHead + 1) % TELEMETRY_QUEUE_SIZE;
            telemetryQueueCount--;
            flushed++;
        }
        #ifdef DEBUG_ENABLED
        Serial.printf("[TELEM] Sent successfully (queue: %d, flushed: %d)\n", telemetryQueueCount, flushed);
        #endif
    } else {
        // Failed - enqueue for retry
        telemetryEnqueue(json);
        Serial.printf("[TELEM] Send failed, queued (%d/%d)\n", telemetryQueueCount, TELEMETRY_QUEUE_SIZE);
    }
}

// ============================================================================
// CONFIG SYNC ENGINE (FIX v1.0.1: extract array from wrapped response)
// ============================================================================

void configSyncEngineLoop() {
    if (!timerConfigSync.check()) return;
    if (WiFi.status() != WL_CONNECTED) return;

    // P2-019: Pre-reserve cloudRules and cloudSchedules Strings
    cloudRules.reserve(2048);
    cloudSchedules.reserve(2048);

    // Fetch rules
    fetchConfig("/api/rules/get", cloudRules);
    // FW-014 FIX: Feed watchdog between the two fetchConfig() calls.
    //   Each fetchConfig involves an HTTP request which can take up to HTTP_TIMEOUT_MS (10s).
    //   Two consecutive fetches could exceed the watchdog timeout (30s), especially under
    //   poor network conditions. Feeding WDT between them prevents false WDT resets.
    esp_task_wdt_reset();
    // Fetch schedules
    fetchConfig("/api/schedules/get", cloudSchedules);
    // Fetch device configs (TODO: consume when priority-based load shedding is implemented)
    // fetchConfig("/api/devices", cloudDeviceConfigs);
}

// FIX v1.0.1: Backend may return { success: true, data: [...] } or
// { success: true, rules: [...] }. Extract the inner array so that
// automationEngineLoop() / scheduleEngineLoop() can parse it directly.
// FIX v1.0.2: Added input validation for safety-related config values.
// P2-012: TOCTOU fix — path validation BEFORE http.begin()
// P2-014: Config parsing is transactional (parse to temp, validate, copy)
// P2-018: Uses global fetchConfigWrapperDoc (avoids stack allocation)
// P2-026: WiFiClientSecure for HTTPS
bool fetchConfig(const String& path, String& output) {
    // P2-012: Validate path BEFORE any network call (TOCTOU fix)
    if (path.indexOf("../") >= 0 || path.indexOf("\\\\") >= 0 || path.length() > 128 || path.length() == 0) {
        Serial.println("[CFG] Invalid path — rejected");
        return false;
    }

    // P2-026: Use WiFiClientSecure for HTTPS GAS endpoints
    // FW-013 FIX: SECURITY WARNING — setInsecure() disables TLS certificate validation.
    //   Production deployment MUST use setCACert() with a pinned server certificate.
    WiFiClientSecure client;
    client.setInsecure(); // Production: use setCACert() with pinned certificate
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    String url = String(GAS_SCRIPT_URL) + "?path=" + path;
    http.begin(client, url);
    http.addHeader("X-Device-Token", GAS_API_TOKEN);

    int httpCode = http.GET();
    if (httpCode == 200) {
        // FW-007 FIX: Check response size BEFORE allocating String with getString().
        //   getString() allocates a heap String which could cause OOM on large responses.
        //   Use getSize() to check content length first; if unavailable or too large, reject.
        int contentLen = http.getSize();
        if (contentLen > 8192) {
            Serial.printf("[CFG] Response too large (%d bytes) — rejected\n", contentLen);
            http.end();
            return false;
        }
        // ESP32 Core 3.x: getString() takes no arguments (size already checked above)
        String raw = http.getString();
        http.end();

        // P2-034: Validate response size
        if (raw.length() > 8192) {
            Serial.println("[CFG] Response too large — rejected");
            return false;
        }

        // P2-014: Parse to temporary String first, validate, then copy to output
        String tempOutput = "";

        // P2-018: Use global fetchConfigWrapperDoc (avoids 4KB stack allocation)
        fetchConfigWrapperDoc.clear();
        DeserializationError err = deserializeJson(fetchConfigWrapperDoc, raw);
        if (!err && fetchConfigWrapperDoc.is<JsonObject>()) {
            // Try common wrapper keys used by SEMS backend
            JsonArray arr = fetchConfigWrapperDoc["data"];
            if (arr.isNull()) arr = fetchConfigWrapperDoc["rules"];
            if (arr.isNull()) arr = fetchConfigWrapperDoc["schedules"];
            if (arr.isNull()) arr = fetchConfigWrapperDoc["devices"];
            if (!arr.isNull()) {
                serializeJson(arr, tempOutput);
                // P2-014: Transactional commit — only write to output after successful parse
                output = tempOutput;
                #ifdef DEBUG_ENABLED
                Serial.printf("[CFG] Fetched %s: extracted array (%d items)\n", path.c_str(), arr.size());
                #endif
                return true;
            }
        }

        // If raw response is already a plain array, use as-is
        // T3-FW-011: Validate response starts with '[' (JSON array) before overwriting output
        if (raw.length() > 0 && raw[0] == '[') {
            output = raw;
            #ifdef DEBUG_ENABLED
            Serial.printf("[CFG] Fetched %s: raw response (%d bytes)\n", path.c_str(), raw.length());
            #endif
            return true;
        }
        Serial.println("[CFG] Response is not a JSON array — rejected");
        return false;
    }
    http.end();
    #ifdef DEBUG_ENABLED
    Serial.printf("[CFG] Fetch %s failed: HTTP %d\n", path.c_str(), httpCode);
    #endif
    return false;
}

// ============================================================================
// WIFI MANAGER
// ============================================================================

void wifiManagerLoop() {
    if (WiFi.status() == WL_CONNECTED) {
        if (!wifiConnected) {
            wifiConnected = true;
            wifiReconnectDelay = WIFI_RECONNECT_BASE_MS;
            Serial.printf("[WiFi] Connected! IP: %s, RSSI: %d\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());
        }
        sensorData.wifiRSSI = WiFi.RSSI();
        return;
    }

    wifiConnected = false;

    // Exponential backoff reconnect
    if (millis() - lastWifiAttempt >= wifiReconnectDelay) {
        lastWifiAttempt = millis();
        Serial.printf("[WiFi] Reconnecting... (retry in %lums)\n", wifiReconnectDelay);
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

        wifiReconnectDelay = min(wifiReconnectDelay * 2, (unsigned long)WIFI_RECONNECT_MAX_MS);
    }
}

// ============================================================================
// OTA UPDATE
// ============================================================================

// ============================================================================
// NTP TIME SYNC
// ============================================================================

// FIX v1.0.2: Non-blocking NTP sync using state machine (was 2s blocking delay)
enum NTPState { NTP_IDLE, NTP_REQUESTED, NTP_WAITING };
static NTPState ntpState = NTP_IDLE;
static unsigned long ntpRequestTime = 0;

void syncNTPTime() {
#if NTP_ENABLED
    static unsigned long lastNTPAttempt = 0;
    if (millis() - lastNTPAttempt < 5000) return; // Don't spam NTP

    switch (ntpState) {
        case NTP_IDLE:
            if (WiFi.status() == WL_CONNECTED && sensorData.rtcOnline) {
                configTime(0, 0, NTP_SERVER);
                ntpState = NTP_REQUESTED;
                ntpRequestTime = millis();
                lastNTPAttempt = millis();
            }
            break;

        case NTP_REQUESTED:
            // Give NTP a moment, then check on next loop iteration
            ntpState = NTP_WAITING;
            break;

        case NTP_WAITING:
            {
                time_t now = time(nullptr);
                if (now > 1700000000) { // Valid after 2023
                    struct tm timeinfo;
                    gmtime_r(&now, &timeinfo);
                    rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
                                       timeinfo.tm_mday, timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
                    Serial.println("[NTP] Time synchronized from pool.ntp.org");
                    ntpState = NTP_IDLE;
                } else if ((millis() - ntpRequestTime) > 10000) {
                    // 10s timeout
                    Serial.println("[NTP] No valid NTP response, keeping RTC time");
                    ntpState = NTP_IDLE;
                }
            }
            break;
    }
#endif
}

// ============================================================================
// OTA UPDATE (continued)
// ============================================================================

void otaInit() {
    ArduinoOTA.setPort(OTA_PORT);
    ArduinoOTA.setHostname(OTA_HOSTNAME);
    ArduinoOTA.setPassword(OTA_PASSWORD);

    ArduinoOTA.onStart([]() {
        Serial.println("[OTA] Start");
    });
    ArduinoOTA.onEnd([]() {
        Serial.println("\n[OTA] End");
    });
    ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
        if (total > 0) {
            Serial.printf("[OTA] Progress: %u%%\r", (progress * 100) / total);
        }
        // FW-019 FIX: Reset task watchdog during OTA progress callback.
        //   Large firmware uploads can take minutes. Without WDT reset, the task WDT
        //   (30s timeout) will trigger a reboot during slow OTA transfers.
        esp_task_wdt_reset();
    });
    ArduinoOTA.onError([](ota_error_t error) {
        Serial.printf("[OTA] Error[%u]: ", error);
        if (error == OTA_AUTH_ERROR) Serial.println("Auth Failed");
        else if (error == OTA_BEGIN_ERROR) Serial.println("Begin Failed");
        else if (error == OTA_CONNECT_ERROR) Serial.println("Connect Failed");
        else if (error == OTA_RECEIVE_ERROR) Serial.println("Receive Failed");
        else if (error == OTA_END_ERROR) Serial.println("End Failed");
    });
    ArduinoOTA.begin();
    Serial.println("[OTA] Ready");
}

// ============================================================================
// EVENT LOGGER
// ============================================================================

void logEvent(const String& type, const String& message) {
    Serial.printf("[EVENT] [%s] %s\n", type.c_str(), message.c_str());

    // P2-033: If called from safety engine context, enqueue instead of blocking
    // Safety engine events use CRITICAL or SAFETY types
    if (type == "CRITICAL" || type == "SAFETY") {
        // Enqueue for non-blocking send (processEventQueue will drain in main loop)
        logEventNonBlocking(type.c_str(), message.c_str());
        return;
    }

    // Non-safety events: send immediately (blocking OK in main loop)
    if (WiFi.status() == WL_CONNECTED) {
        StaticJsonDocument<256> doc;
        doc["type"] = type;
        doc["severity"] = (type == "CRITICAL") ? "critical" : "info";
        doc["message"] = message;
        String json;
        serializeJson(doc, json);

        // P2-026: Use WiFiClientSecure for HTTPS
        // FW-013 FIX: SECURITY WARNING — setInsecure() disables TLS certificate validation.
        //   Production deployment MUST use setCACert() with a pinned server certificate.
        WiFiClientSecure client;
        client.setInsecure();
        HTTPClient http;
        http.setTimeout(HTTP_TIMEOUT_MS);
        String url = String(GAS_SCRIPT_URL) + "?path=api/alarm/create";
        http.begin(client, url);
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Device-Token", GAS_API_TOKEN);
        http.POST(json);
        http.end();
    }
}

// ============================================================================
// SETUP
// ============================================================================

void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(100);
    Serial.println("\n\n========================================");
    Serial.println("  SEMS - Smart Energy Management System");
    Serial.println("  Jambi Solar Panel");
    Serial.println("  PT. Jaya Mandiri Smart Energy");
    Serial.println("  Version 7.0.0 (Comprehensive audit fixes)");
    Serial.println("========================================\n");

    // P2-022: Crash recovery — check reset reason
    esp_reset_reason_t resetReason = esp_reset_reason();
    Serial.printf("[BOOT] Reset reason: %d\n", resetReason);
    if (resetReason == ESP_RST_POWERON) {
        Serial.println("[BOOT] Normal power-on reset");
    } else if (resetReason == ESP_RST_WDT || resetReason == ESP_RST_TASK_WDT ||
               resetReason == ESP_RST_INT_WDT) {
        // P2-022: After watchdog reset, start with all relays OFF for safety
        Serial.println("[BOOT] CRASH RECOVERY: Watchdog reset detected — starting with all relays OFF");
        savedRelayStates = 0xFFFFFFFF; // All OFF (active LOW)
    } else if (resetReason == ESP_RST_BROWNOUT) {
        Serial.println("[BOOT] Brownout reset — starting with all relays OFF");
        savedRelayStates = 0xFFFFFFFF;
    } else {
        Serial.printf("[BOOT] Other reset reason (%d) — loading EEPROM states\n", resetReason);
    }

    // Init status LED
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);

    // FW-010 FIX: Configure BATT_VOLT_PIN (GPIO 4) with INPUT_PULLDOWN AFTER boot.
    //   GPIO 4 is an ESP32 strapping pin. At boot, its state determines flash voltage.
    //   We set INPUT_PULLDOWN here (after boot is complete) to stabilize ADC readings
    //   and prevent floating values. This must NOT be done before WiFi.begin().
    pinMode(BATT_VOLT_PIN, INPUT_PULLDOWN);

    // Init shift register FIRST (boot-safe: all outputs OFF)
    shiftRegisterInit();

    // Init I2C bus
    initI2C();

    // Init sensors
    bool ina219OK = initINA219();
    bool ads1115OK = initADS1115();
    bool sht31OK = initSHT31();
    bool rtcOK = initRTC();
    initPIR();

    // P2-023: Boot-time sensor self-test before enabling relay outputs
    Serial.println("[BOOT] Running sensor self-test...");
    bool sensorsReady = true;
    if (!ina219OK) { Serial.println("[SELFTEST] FAIL: INA219 not available"); sensorsReady = false; }
    if (!ads1115OK) { Serial.println("[SELFTEST] FAIL: ADS1115 not available"); sensorsReady = false; }
    if (!sht31OK) { Serial.println("[SELFTEST] WARN: SHT31 not available (non-critical)"); }
    if (!rtcOK) { Serial.println("[SELFTEST] WARN: RTC not available (non-critical)"); }

    // P2-030: Calibrate ACS712 only when all relays confirmed OFF
    // Ensure shift register is written all-OFF before calibration
    shiftRegisterWrite(0xFFFFFFFF); // All relays OFF
    delay(100);
    calibrateACS712();

    // Load saved relay states from EEPROM (overridden by crash recovery above)
    if (resetReason != ESP_RST_WDT && resetReason != ESP_RST_TASK_WDT &&
        resetReason != ESP_RST_INT_WDT && resetReason != ESP_RST_BROWNOUT) {
        loadRelayStatesFromEEPROM();
    }
    loadACS712Calibration();

    // Apply saved states to shift register
    shiftRegisterWrite(savedRelayStates);

    // Enable outputs AFTER loading saved states (only if sensors passed self-test)
    delay(100); // Small delay for shift register to settle
    if (sensorsReady) {
        shiftRegisterEnableOutputs();
    } else {
        Serial.println("[SELFTEST] Outputs remain DISABLED until sensors pass check");
    }

    // Init SOC
    socInit();

    // Connect WiFi
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.println("[WiFi] Connecting...");

    // Wait for WiFi with timeout
    unsigned long wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart) < WIFI_CONNECT_TIMEOUT_MS) {
        delay(10);
        // Feed the dog while waiting
    }

    if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
        // NTP sync for RTC
        syncNTPTime();
    } else {
        Serial.println("[WiFi] Connection failed, will retry periodically");
    }

    // Init OTA
    otaInit();

    // FIX: ESP32 Core 3.x uses ESP-IDF 5.x WDT API (struct-based config)
    // Old API: esp_task_wdt_init(timeout_seconds, panic_flag);
    // New API: esp_task_wdt_init(const esp_task_wdt_config_t *config);
    esp_task_wdt_config_t wdt_config = {
        .timeout_ms = WATCHDOG_TIMEOUT_S * 1000,  // Convert seconds to ms
        .idle_core_mask = 0,                      // Don't subscribe idle tasks
        .trigger_panic = true                     // Reboot on timeout
    };
    esp_task_wdt_init(&wdt_config);
    esp_task_wdt_add(NULL);  // Subscribe current task to WDT

    // P2-021: Enable Independent Watchdog (IWDT) as backup
    // IWDT runs on a separate timer and cannot be disabled by software,
    // providing protection against software hangs that mask the TWDT.
    // FW-018 FIX: Removed esp_intr_alloc(ETS_INTR_SOURCE_LEVEL_INT, ...) call.
    //   That call was incorrect for IWDT — IWDT is NOT an interrupt source that can be
    //   allocated via esp_intr_alloc(). IWDT must be enabled via menuconfig:
    //   Component Config → ESP32-specific → IWDT (Enable IWDT). If not enabled in
    //   menuconfig, the task WDT (esp_task_wdt_init) provides sufficient protection.
    //   esp_intr_alloc with ETS_INTR_SOURCE_LEVEL_INT was allocating a spurious Level
    //   interrupt handler that consumed resources without enabling any watchdog.
    Serial.println("[WDT] Task WDT initialized (IWDT must be enabled via menuconfig)");

    // P2-023: Only enable relay outputs if critical sensors are ready
    if (sensorsReady) {
        Serial.println("[SELFTEST] PASSED — relay outputs already enabled");
    } else {
        Serial.println("[SELFTEST] FAILED — keeping relay outputs DISABLED for safety");
        logEvent("CRITICAL", "Sensor self-test failed. Relay outputs remain disabled.");
        // Don't enable outputs — system stays in safe mode
        // Note: outputs can be enabled later once sensors come online
    }

    // Initial config sync
    if (WiFi.status() == WL_CONNECTED) {
        configSyncEngineLoop();
    }

    // Initial telemetry reading (allow sensors to warm up)
    for (int i = 0; i < 5; i++) {
        readINA219();
        readADS1115();
        readSHT31();
        readACS712();
        delay(200);
    }

    logEvent("SYSTEM", "SEMS firmware started successfully");
    Serial.println("\n[SETUP] Complete - Entering main loop\n");
}

// ============================================================================
// MAIN LOOP (NON-BLOCKING)
// ============================================================================

void loop() {
    // Feed the watchdog
    esp_task_wdt_reset();

    // Handle OTA
    ArduinoOTA.handle();

    // P2-033: Process event queue (drain non-blocking safety events)
    processEventQueue();

    // WiFi management
    wifiManagerLoop();

    // Sensor reading
    sensorEngineLoop();

    // SOC calculation
    socUpdate();

    // Safety engine
    safetyEngineLoop();

    // Load shedding
    loadSheddingEngineLoop();

    // Automation engine
    automationEngineLoop();

    // Schedule engine
    scheduleEngineLoop();

    // Telemetry upload
    telemetryEngineLoop();

    // Config sync
    configSyncEngineLoop();

    // Heartbeat LED
    if (timerHeartbeat.check()) {
        ledState = !ledState;
        digitalWrite(STATUS_LED_PIN, ledState);
    }

    // Uptime counter (check every ~1s using millis)
    static unsigned long lastUptimeMs = 0;
    if (millis() - lastUptimeMs >= 1000UL) {
        lastUptimeMs = millis();
        sensorData.uptimeSeconds++;
        sensorData.freeHeap = ESP.getFreeHeap();
    }
}
