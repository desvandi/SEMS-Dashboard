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
};

SensorData sensorData;

// --- ACS712 Calibration ---
float acs712Offset = 0.0; // Zero-current offset (calibrated on boot)

// --- Relay State Persistence ---
uint32_t savedRelayStates = 0xFFFFFFFF;

// --- Telemetry Queue ---
struct TelemetryEntry {
    String jsonPayload;
    unsigned long timestamp;
};
TelemetryEntry telemetryQueue[TELEMETRY_QUEUE_SIZE];
uint8_t telemetryQueueHead = 0;
uint8_t telemetryQueueTail = 0;
uint8_t telemetryQueueCount = 0;

// --- Config from Cloud ---
String cloudRules = "[]";
String cloudSchedules = "[]";

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

    if (magic == EEPROM_MAGIC) {
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
    EEPROM.begin(EEPROM_SIZE);
    // FIX: EEPROM.writeUInt32()/writeUInt16() → EEPROM.put() in Core 3.x
    uint32_t magicVal = EEPROM_MAGIC;
    uint16_t versionVal = EEPROM_VERSION;
    EEPROM.put(EEPROM_ADDR_MAGIC, magicVal);
    EEPROM.put(EEPROM_ADDR_VERSION, versionVal);
    EEPROM.put(EEPROM_ADDR_CAL_I, offset);
    EEPROM.commit();
    EEPROM.end();
    Serial.printf("[EEPROM] Saved ACS712 offset: %.3f\n", offset);
}

// ============================================================================
// SENSOR ENGINE
// ============================================================================

void initI2C() {
    Wire.begin(I2C_SDA, I2C_SCL);
    Wire.setClock(100000); // 100kHz I2C (safe for long cables)
    Serial.println("[I2C] Initialized on SDA=21, SCL=22");
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
    uint16_t calReg = (uint16_t)calValue;

    // Write calibration register (0x05) directly via Wire
    Wire.beginTransmission(INA219_ADDR);
    Wire.write(0x05);  // Calibration register address
    Wire.write((uint8_t)(calReg >> 8));   // MSB
    Wire.write((uint8_t)(calReg & 0xFF)); // LSB
    Wire.endTransmission();

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
        saveACS712Calibration(offset);
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
        float cellV = rawStack[i + 1] - rawStack[i];

        // Sanity check: LiFePO4 cell should be 2.0V - 4.0V
        if (cellV >= 1.5 && cellV <= 4.5) {
            maCellV[i].add(cellV);
            sensorData.cellVoltages[i] = maCellV[i].get();
        }
        // If out of range, keep previous averaged value (do not update)
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
    static unsigned long recalStart = 0;
    if (sensorData.batteryVoltage >= SOC_RECAL_VOLT &&
        abs(sensorData.batteryCurrent) < SOC_RECAL_CURRENT) {
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

    // Overvoltage protection
    if (sensorData.batteryVoltage > BATT_OVERVOLT) {
        Serial.printf("[SAFETY] CRITICAL: Battery overvoltage %.2fV!\n", sensorData.batteryVoltage);
        // Trigger alarm via telemetry
    }

    // Undervoltage protection
    if (sensorData.batteryVoltage < BATT_UNDERVOLT) {
        Serial.printf("[SAFETY] CRITICAL: Battery undervoltage %.2fV!\n", sensorData.batteryVoltage);
        // Emergency load shedding will be handled by LoadShedEngine
    }

    // Cell imbalance detection
    if (sensorData.ads1Online && sensorData.ads2Online) {
        float minCell = 999, maxCell = 0;
        for (int i = 0; i < NUM_CELLS; i++) {
            if (sensorData.cellVoltages[i] > 0) {
                minCell = min(minCell, sensorData.cellVoltages[i]);
                maxCell = max(maxCell, sensorData.cellVoltages[i]);
            }
        }
        float imbalance = maxCell - minCell;
        if (imbalance > SAFETY_CELL_IMBALANCE_V) { // >300mV imbalance
            Serial.printf("[SAFETY] WARNING: Cell imbalance %.0fmV!\n", imbalance * 1000);
        }
    }
}

// ============================================================================
// LOAD SHEDDING ENGINE
// ============================================================================

void loadSheddingEngineLoop() {
    if (!timerLoadShed.check()) return;

    static bool loadSheddingActive_prev = false;

    float v = sensorData.batteryVoltage;
    float currentAbs = fabsf(sensorData.batteryCurrent);
    bool overload = currentAbs > SHED_CURRENT_MAX;

    // Check if shedding should be active
    bool shouldShed = false;
    bool shouldRecover = false;

    if (v <= BATT_UNDERVOLT || overload) {
        // Emergency: shed Tier 3, 2, and 1
        shouldShed = true;
        sensorData.loadSheddingActive = true;
        Serial.printf("[SHED] EMERGENCY: V=%.1fV, I=%.1fA\n", v, currentAbs);
    } else if (v <= SHED_VOLT_TIER1) {
        // Shed Tier 3 and 2
        shouldShed = true;
        sensorData.loadSheddingActive = true;
    } else if (v <= SHED_VOLT_TIER2) {
        // Shed Tier 3 only
        shouldShed = true;
        sensorData.loadSheddingActive = true;
    } else if (v <= SHED_VOLT_TIER3) {
        // Warning level
        sensorData.loadSheddingActive = false;
    } else if (v >= SHED_RECOVER_VOLT) {
        // Safe to recover all loads
        shouldRecover = true;
        sensorData.loadSheddingActive = false;
    }

    // Execute load shedding: turn off non-critical relays
    // TODO: Implement priority-based load shedding from cloud device config.
    //       Currently, relay 0 is kept alive and all others are shed.
    //       Future: fetch device priority and shed
    //       lowest-priority devices first, then progressively higher priority.
    if (shouldShed && !loadSheddingActive_prev) {
        Serial.println("[SHED] Load shedding ACTIVATED - saving relay states");
        // Save current relay states before shedding
        savedRelayStates = sensorData.shiftRegisterState;
        // Turn off all non-critical relays (relay 0 = critical, keep ON if it was ON)
        for (int r = 1; r < NUM_RELAYS; r++) {
            setRelay(r, false);
        }
    }

    // Execute recovery: restore relay states from before shedding
    if (shouldRecover && loadSheddingActive_prev) {
        Serial.println("[SHED] Load shedding RECOVERED - restoring relay states");
        // Restore all relay states to their saved values
        for (int r = 0; r < NUM_RELAYS; r++) {
            bool wasOn = !(savedRelayStates & (1UL << r));
            setRelay(r, wasOn);
        }
    }

    loadSheddingActive_prev = sensorData.loadSheddingActive;
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

        String target = rule["target"].as<String>();
        String logic = rule["logic"].as<String>();
        String action = rule["action"].as<String>();

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
            executeAutomationAction(target, action, rule["id"].as<String>());
        }
    }
}

// Helper: evaluate a numeric condition with proper operator parsing
// Supports: >, <, >=, <=, ==, != with both spaced and unspaced formats
// e.g. "battery_voltage>22", "soc < 20", "battery_voltage >= 26"
bool evaluateNumericCondition(String condition, float sensorValue) {
    String ops[] = {">=", "<=", "!=", "==", ">", "<"};

    for (int i = 0; i < 6; i++) {
        int idx = condition.indexOf(ops[i]);
        if (idx > 0) {
            String valStr = condition.substring(idx + ops[i].length());
            float threshold = valStr.toFloat();
            String op = ops[i];

            if (op == ">")  return sensorValue > threshold;
            if (op == "<")  return sensorValue < threshold;
            if (op == ">=") return sensorValue >= threshold;
            if (op == "<=") return sensorValue <= threshold;
            if (op == "==") return fabs(sensorValue - threshold) < 0.05;
            if (op == "!=") return fabs(sensorValue - threshold) >= 0.05;
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
    if (condition.startsWith("pir_")) {
        // Extract PIR number and expected state using robust parsing
        String pirNumStr = condition.substring(4); // e.g., "1 == true"
        int pirIdx = pirNumStr.toInt();
        if (pirIdx >= 1 && pirIdx <= NUM_PIRS) {
            bool expectedMotion = condition.indexOf("true") >= 0 || condition.indexOf("== 1") >= 0;
            return sensorData.pirStates[pirIdx - 1] == expectedMotion;
        }
    }
    if (condition.startsWith("pir")) {
        // Frontend/backend format: pir1, pir2, pir3, pir4
        String pirNumStr = condition.substring(3);
        int pirIdx = pirNumStr.toInt();
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
    StaticJsonDocument<1024> doc;
    doc["timestamp"] = sensorData.rtcOnline ? rtc.now().unixtime() : millis() / 1000;
    doc["device_id"] = DEVICE_ID;
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

bool telemetryEnqueue(const String& json) {
    if (telemetryQueueCount >= TELEMETRY_QUEUE_SIZE) {
        // Queue full, overwrite oldest
        telemetryQueueHead = (telemetryQueueHead + 1) % TELEMETRY_QUEUE_SIZE;
        telemetryQueueCount--;
    }
    telemetryQueue[telemetryQueueTail].jsonPayload = json;
    telemetryQueue[telemetryQueueTail].timestamp = millis();
    telemetryQueueTail = (telemetryQueueTail + 1) % TELEMETRY_QUEUE_SIZE;
    telemetryQueueCount++;
    return true;
}

bool telemetrySend(const String& json) {
    if (WiFi.status() != WL_CONNECTED) return false;

    // FIX v1.0.1: Endpoint path must match backend routePost_() case 'api/telemetry'
    // Old (WRONG — caused 404): "?path=api/telemetry/upload"
    // New (CORRECT — matches backend route):
    WiFiClient client;
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    http.begin(client, String(GAS_SCRIPT_URL) + "?path=api/telemetry");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-Device-Token", GAS_API_TOKEN);

    int httpCode = http.POST(json);
    http.end();

    return (httpCode >= 200 && httpCode < 300);
}

void telemetryEngineLoop() {
    if (!timerTelemetry.check()) return;

    // Build current telemetry
    String json;
    buildTelemetryJSON(json);

    // Try to send immediately
    if (telemetrySend(json)) {
        // Success - also try to flush queue
        while (telemetryQueueCount > 0) {
            String queued = telemetryQueue[telemetryQueueHead].jsonPayload;
            if (!telemetrySend(queued)) {
                break; // Stop flushing on failure
            }
            telemetryQueueHead = (telemetryQueueHead + 1) % TELEMETRY_QUEUE_SIZE;
            telemetryQueueCount--;
        }
        #ifdef DEBUG_ENABLED
        Serial.printf("[TELEM] Sent successfully (queue: %d)\n", telemetryQueueCount);
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

    // Fetch rules
    fetchConfig("/api/rules/get", cloudRules);
    // Fetch schedules
    fetchConfig("/api/schedules/get", cloudSchedules);
    // Fetch device configs (TODO: consume when priority-based load shedding is implemented)
    // fetchConfig("/api/devices", cloudDeviceConfigs);
}

// FIX v1.0.1: Backend may return { success: true, data: [...] } or
// { success: true, rules: [...] }. Extract the inner array so that
// automationEngineLoop() / scheduleEngineLoop() can parse it directly.
bool fetchConfig(const String& path, String& output) {
    WiFiClient client;
    HTTPClient http;
    http.setTimeout(HTTP_TIMEOUT_MS);
    String url = String(GAS_SCRIPT_URL) + "?path=" + path;
    http.begin(client, url);
    http.addHeader("X-Device-Token", GAS_API_TOKEN);

    int httpCode = http.GET();
    if (httpCode == 200) {
        String raw = http.getString();
        http.end();

        // Try to extract the array from a wrapped response
        StaticJsonDocument<4096> wrapperDoc;
        DeserializationError err = deserializeJson(wrapperDoc, raw);
        if (!err && wrapperDoc.is<JsonObject>()) {
            // Try common wrapper keys used by SEMS backend
            JsonArray arr = wrapperDoc["data"];
            if (arr.isNull()) arr = wrapperDoc["rules"];
            if (arr.isNull()) arr = wrapperDoc["schedules"];
            if (arr.isNull()) arr = wrapperDoc["devices"];
            if (!arr.isNull()) {
                output = "";
                serializeJson(arr, output);
                #ifdef DEBUG_ENABLED
                Serial.printf("[CFG] Fetched %s: extracted array (%d items)\n", path.c_str(), arr.size());
                #endif
                return true;
            }
        }

        // If raw response is already a plain array, use as-is
        output = raw;
        #ifdef DEBUG_ENABLED
        Serial.printf("[CFG] Fetched %s: raw response (%d bytes)\n", path.c_str(), raw.length());
        #endif
        return true;
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

void syncNTPTime() {
#if NTP_ENABLED
    if (WiFi.status() == WL_CONNECTED && sensorData.rtcOnline) {
        configTime(0, 0, NTP_SERVER);
        time_t now = time(nullptr);
        // Wait up to 2 seconds for NTP response
        unsigned long start = millis();
        while (now < 1700000000 && (millis() - start) < 2000) {
            delay(100);
            now = time(nullptr);
        }
        if (now > 1700000000) { // Valid after 2023
            struct tm timeinfo;
            gmtime_r(&now, &timeinfo);
            rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1,
                               timeinfo.tm_mday, timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
            Serial.println("[NTP] Time synchronized from pool.ntp.org");
        } else {
            Serial.println("[NTP] No valid NTP response, keeping RTC time");
        }
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
    // Event logging to cloud is handled via alarm/create endpoint
    // For critical events, send immediately
    if (type == "CRITICAL" || type == "SAFETY") {
        if (WiFi.status() == WL_CONNECTED) {
            StaticJsonDocument<256> doc;
            doc["type"] = type;
            doc["severity"] = (type == "CRITICAL") ? "critical" : "warning";
            doc["message"] = message;
            String json;
            serializeJson(doc, json);

            // FIX: ESP32 Core 3.x HTTPClient prefers explicit WiFiClient
            WiFiClient client;
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
    Serial.println("========================================\n");

    // Init status LED
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);

    // Init shift register FIRST (boot-safe: all outputs OFF)
    shiftRegisterInit();

    // Init I2C bus
    initI2C();

    // Init sensors
    initINA219();
    initADS1115();
    initSHT31();
    initRTC();
    initPIR();

    // Calibrate ACS712 (zero-offset)
    calibrateACS712();

    // Load saved relay states from EEPROM
    loadRelayStatesFromEEPROM();
    loadACS712Calibration();

    // Apply saved states to shift register
    shiftRegisterWrite(savedRelayStates);

    // Enable outputs AFTER loading saved states
    delay(100); // Small delay for shift register to settle
    shiftRegisterEnableOutputs();

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
