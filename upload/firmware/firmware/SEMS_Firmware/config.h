// ============================================================================
// config.h — TIDAK ADA PERUBAHAN (file ini sama persis dengan versi asli)
// Disalin ke folder download untuk kelengkapan
// ============================================================================
#ifndef SEMS_CONFIG_H
#define SEMS_CONFIG_H

// Coding Standard:
//   Constants: UPPER_SNAKE_CASE (e.g., BATT_OVERVOLT)
//   Variables: camelCase (e.g., batteryVoltage)
//   Functions: camelCase (e.g., readACS712)
//   #define: UPPER_SNAKE_CASE

// ============================================================================
// SEMS Configuration - Smart Energy Management System
// Brand: Jambi Solar Panel powered by PT. Jaya Mandiri Smart Energy
// ===============================================================================

// --- Firmware Version ---
#define FIRMWARE_VERSION     "1.0.1"   // FIX v1.0.1: bumped after firmware<->backend bug fixes
#define BUILD_DATE           __DATE__
#define BUILD_TIME           __TIME__

// --- WiFi Configuration ---
#define WIFI_SSID           "4G-UFI-7248"
#define WIFI_PASSWORD       "1234567890"
#if !defined(WIFI_SSID)
  #warning "WiFi SSID not configured - device will not connect to WiFi"
#endif
#define WIFI_CONNECT_TIMEOUT_MS  15000
#define WIFI_RECONNECT_BASE_MS   1000
#define WIFI_RECONNECT_MAX_MS    60000

// --- GAS Backend Configuration ---
#define GAS_SCRIPT_URL      "https://script.google.com/macros/s/AKfycbxEZObDELJ2mfXMjg5D9KX-kub7mxinc3hkMPh9HtEsYXtyO5-Psgk4F_L3Sbz0Zq33QQ/exec"
#define GAS_API_TOKEN       "sems_device_token_change_me_2024"
#define DEVICE_ID           "SEMS_001"

// --- Timing Intervals (milliseconds) ---
#define SENSOR_POLL_MS          1000   // I2C sensor polling
#define PIR_POLL_MS             200    // PIR motion detection
#define AUTOMATION_EVAL_MS      10000  // Rule evaluation
#define SCHEDULE_CHECK_MS        1000   // Schedule engine check
#define TELEMETRY_UPLOAD_MS      15000  // Telemetry to cloud (15s)
#define CONFIG_SYNC_MS          60000   // Config download from cloud (60s)
#define HEARTBEAT_MS            1000    // Status LED blink
#define SAFETY_CHECK_MS         1000    // Safety engine evaluation
#define ACS712_SAMPLE_INTERVAL_MS 1000  // ACS712 RMS sampling cycle
#define LOAD_SHED_CHECK_MS      5000    // Load shedding evaluation

// --- I2C Pin Definitions ---
#define I2C_SDA             21
#define I2C_SCL             22

// --- 74HC595 Shift Register Pin Definitions ---
#define SR_DATA_PIN         18   // 74HC595 DS (Serial Data)
#define SR_CLOCK_PIN        19   // 74HC595 SH_CP (Shift Register Clock)
#define SR_LATCH_PIN        5    // 74HC595 ST_CP (Storage Register Clock)
#define SR_OE_PIN           23   // 74HC595 OE (Output Enable, active LOW)
#define SR_MR_PIN           16   // Master Reset (active LOW, tie HIGH)
#define NUM_SHIFT_REGISTERS 4
#define TOTAL_SR_BITS       32

// --- Relay Configuration ---
#define NUM_RELAYS          13   // Bits 0-12
#define RELAY_ACTIVE_LOW    true // Relay module is active LOW

// --- MOSFET Configuration ---
#define NUM_MOSFETS         4    // Bits 13-16
#define MOSFET_PWM_RANGE    255

// --- ACS712 Configuration ---
#define ACS712_PIN          34   // ADC1_CH6
#define ACS712_SAMPLES      100  // RMS samples per cycle
#define ACS712_FREQUENCY    1000 // Sampling frequency (Hz)
#define ACS712_SENSITIVITY  0.066 // 30A version: 66mV/A
#define ACS712_MAX_CURRENT  30.0
#define ACS712_CALIBRATION_SAMPLES 200 // Zero-offset calibration samples on boot

#define AC_MAINS_VOLTAGE    230.0  // AC mains voltage for power calculation (V)

// --- Backup Battery Voltage ADC ---
#define BATT_VOLT_PIN       4    // ADC2_CH0 (backup direct reading)
#define BATT_VOLT_DIVIDER   11.0 // Voltage divider ratio for direct measurement

// --- PIR Configuration ---
#define PIR_1_PIN           32   // ADC1_CH4
#define PIR_2_PIN           33   // ADC1_CH5
#define PIR_3_PIN           25   // ADC1_CH8
#define PIR_4_PIN           26   // ADC1_CH9
#define NUM_PIRS            4

// --- Status LED ---
#define STATUS_LED_PIN      2    // Built-in LED

// --- I2C Addresses ---
#define INA219_ADDR         0x40
#define ADS1115_ADDR_1      0x48  // Cells 1-4
#define ADS1115_ADDR_2      0x49  // Cells 5-8
#define SHT31_ADDR          0x44
#define DS3231_ADDR         0x68

// --- Battery Configuration (LiFePO4 8S) ---
#define NUM_CELLS           8
#define BATT_NOMINAL_VOLT   25.6   // 8S * 3.2V
#define BATT_FULL_VOLT      29.2   // 8S * 3.65V
#define BATT_EMPTY_VOLT     20.0   // Minimum safe voltage
#define BATT_CAPACITY_AH    100.0  // 100Ah
#define BATT_WARN_VOLT      22.0   // Warning threshold
#define BATT_OVERVOLT       29.6   // Overvoltage protection
#define BATT_UNDERVOLT      19.0   // Undervoltage protection (immediate shedding)

// --- ADS1115 Voltage Divider ---
// Circuit: Cell_tap → R360k → ADS_input ← R10k → GND
// Divider ratio: 10 / (360 + 10) = 10/370
#define DIVIDER_R1          360000.0  // 360k Ohm
#define DIVIDER_R2          10000.0   // 10k Ohm
#define DIVIDER_RATIO       (DIVIDER_R2 / (DIVIDER_R1 + DIVIDER_R2))  // ~0.02703
#define DIVIDER_MULTIPLIER  ((DIVIDER_R1 + DIVIDER_R2) / DIVIDER_R2)  // ~37.0
#define ADS1115_PGA_GAIN    GAIN_FOUR  // FSR ±1.024V (max input ~0.789V for full pack)
#define ADS1115_MV_PER_LSB  0.03125    // 1.024V / 32768

// --- SOC Coulomb Counting ---
#define SOC_INITIAL_VOLTAGE 29.00   // Calibrated full charge voltage (adjustable)
#define SOC_RECAL_VOLT      29.2    // Recalibration threshold
#define SOC_RECAL_CURRENT   0.5     // Recalibration max current (A)
#define SOC_RECAL_DURATION  1800000 // 30 minutes in ms

// --- Load Shedding Thresholds ---
#define SHED_VOLT_TIER3     21.5    // Start shedding Tier 3
#define SHED_VOLT_TIER2     21.0    // Shed Tier 2
#define SHED_VOLT_TIER1     20.5    // Shed Tier 1
#define SHED_CURRENT_MAX    80.0    // Overload threshold (A)
#define SHED_RECOVER_VOLT   23.0    // Recovery voltage to restore loads
#define SHED_RECOVER_DELAY  300000  // 5 minutes before recovery

// --- Safety Thresholds ---
#define SAFETY_BROWNOUT_V   3.0     // ESP32 brownout voltage
#define SAFETY_SENSOR_TIMEOUT_MS 30000  // Sensor not responding for 30s
#define SAFETY_MAX_TEMP_C   50.0    // Thermal protection
#define SAFETY_OVERCURRENT_A 31.0   // Overcurrent protection (A)
#define SAFETY_CELL_IMBALANCE_V 0.3  // Cell imbalance threshold (V)

// --- Telemetry Queue ---
#define TELEMETRY_QUEUE_SIZE 50
#define HTTP_TIMEOUT_MS     10000

// --- Unified EEPROM Address Map ---
#define EEPROM_ADDR_MAGIC     0    // 4 bytes (uint32) - magic number to validate EEPROM data
#define EEPROM_ADDR_VERSION   4    // 2 bytes (uint16) - EEPROM schema version
#define EEPROM_ADDR_SOC       8    // 4 bytes (float)  - SOC voltage for recalibration
#define EEPROM_ADDR_CAL_V     12   // 4 bytes (float)  - voltage calibration offset
#define EEPROM_ADDR_CAL_I     16   // 4 bytes (float)  - current calibration offset (ACS712)
#define EEPROM_ADDR_RELAY     20   // 4 bytes (uint32) - relay state bitmask
#define EEPROM_ADDR_MOSFET    24   // 4 bytes (uint32) - MOSFET PWM values
#define EEPROM_SIZE           28   // Total bytes needed
#define EEPROM_VERSION        2    // Current EEPROM schema version
#define EEPROM_MAGIC          0x53454D53  // "SEMS" magic bytes (uint32)

// --- Legacy EEPROM Aliases (for migration) ---
#define EEPROM_MAGIC_BYTE       EEPROM_ADDR_MAGIC
#define EEPROM_RELAY_STATES     EEPROM_ADDR_RELAY
#define EEPROM_SOC_VOLT         EEPROM_ADDR_SOC
#define EEPROM_CALIBRATION      EEPROM_ADDR_CAL_I
#define EEPROM_MAGIC_VALUE      0xAA  // Legacy single-byte magic value

// --- Serial Debug ---
#define SERIAL_BAUD         115200
#define DEBUG_ENABLED       true

// --- OTA Configuration ---
#define OTA_PORT            3232
#define OTA_PASSWORD        "sems_ota_2026"
#define OTA_HOSTNAME        "sems-esp32"

// --- Watchdog ---
// NOTE: esp_task_wdt_init() and esp_task_wdt_add(NULL) are called in setup()
//       after all hardware initialization is complete. esp_task_wdt_reset() is
//       called at the top of every loop() iteration.
#define WATCHDOG_TIMEOUT_S  30

// --- NTP Time Synchronization ---
// Syncs RTC from NTP when WiFi is available. Called on boot and periodically.
#define NTP_ENABLED             1
#define NTP_SERVER              "pool.ntp.org"
#define NTP_SYNC_INTERVAL_MS    3600000  // Sync every hour

// --- Moving Average ---
#define MA_WINDOW_I2C       5
#define MA_WINDOW_ANALOG    10

#endif // SEMS_CONFIG_H
