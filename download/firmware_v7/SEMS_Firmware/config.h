// ============================================================================
// config.h — SEMS Configuration
// Smart Energy Management System
// Brand: Jambi Solar Panel powered by PT. Jaya Mandiri Smart Energy
// ============================================================================
// SECURITY FIX v1.0.2: Hardcoded credentials removed.
//   - WiFi SSID/password replaced with CHANGE_ME placeholders
//   - API token replaced with CHANGE_ME placeholder
//   - GAS URL replaced with CHANGE_ME placeholder
//   - OTA password replaced with CHANGE_ME placeholder
//
// PROVISIONING: The intended deployment flow is:
//   1. Flash firmware with these placeholder values
//   2. Device enters provisioning/AP mode on first boot (no valid SSID)
//   3. User configures WiFi via web portal or BLE provisioning
//   4. Credentials are stored in NVS (Non-Volatile Storage)
//   5. On subsequent boots, device reads from NVS
//
// For development/testing ONLY, you may set these via build flags in
// platformio.ini: -DWIFI_SSID='"my_ssid"' -DWIFI_PASSWORD='"my_pass"'
// ============================================================================

#ifndef SEMS_CONFIG_H
#define SEMS_CONFIG_H

// ============================================================================
// WIFI CREDENTIALS (CHANGE_ME — use NVS provisioning in production)
// ============================================================================
#ifndef WIFI_SSID
  #define WIFI_SSID             "CHANGE_ME"       // WiFi SSID — set via NVS or build flag
  #warning "WIFI_SSID not set via build flag — device will not connect to WiFi. Use NVS provisioning."
#endif

#ifndef WIFI_PASSWORD
  #define WIFI_PASSWORD         "CHANGE_ME"       // WiFi Password — set via NVS or build flag
  #warning "WIFI_PASSWORD not set via build flag — device will not connect to WiFi. Use NVS provisioning."
#endif

// --- WiFi Timing ---
#define WIFI_CONNECT_TIMEOUT_MS  15000
#define WIFI_RECONNECT_BASE_MS   1000
#define WIFI_RECONNECT_MAX_MS    60000

// ============================================================================
// GAS BACKEND (CHANGE_ME — set via build flag in production)
// ============================================================================
#ifndef GAS_SCRIPT_URL
  #define GAS_SCRIPT_URL          "CHANGE_ME"       // GAS endpoint URL — set via build flag
  #warning "GAS_SCRIPT_URL not set via build flag — telemetry/config sync disabled."
#endif

#ifndef GAS_API_TOKEN
  #define GAS_API_TOKEN          "CHANGE_ME"       // Device auth token — set via NVS or build flag
  #warning "GAS_API_TOKEN not set via build flag — API requests will be rejected."
#endif

#define DEVICE_ID           "SEMS_001"
// T3-FW-020: For multi-unit deployment, use generateDeviceID() from MAC address.
//   The above default is only used before WiFi is initialized.
//   See SEMS_Firmware.ino generateDeviceID() for unique ID generation.

// ============================================================================
// CODING STANDARD
// ============================================================================
//   Constants: UPPER_SNAKE_CASE (e.g., BATT_OVERVOLT)
//   Variables: camelCase (e.g., batteryVoltage)
//   Functions: camelCase (e.g., readACS712)
//   #define: UPPER_SNAKE_CASE
// ============================================================================

/// Firmware Version ---
#define FIRMWARE_VERSION     "7.0.0"   // Comprehensive audit fixes applied
#define BUILD_DATE           __DATE__
#define BUILD_TIME           __TIME__

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
// FW-010 FIX: GPIO 4 (BATT_VOLT_PIN) is an ESP32 strapping pin (strapping pin 4).
//   At boot, this pin's state determines SPI flash voltage (3.3V vs 1.8V).
//   If an external pull-up/down on this pin conflicts with the strapping requirement,
//   the ESP32 may fail to boot or select wrong flash voltage. Ensure no external
//   pull-down is present at boot time. In setup(), we call pinMode(INPUT_PULLDOWN)
//   AFTER boot to stabilize ADC readings. See setup() in SEMS_Firmware.ino.
#define BATT_VOLT_PIN       4    // ADC2_CH0 (backup direct reading) — ESP32 STRAPPING PIN!
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
#define VOLTAGE_MULTIPLIER  DIVIDER_MULTIPLIER  // T3-FW-034: Alias for modular code
#define ADS1115_PGA_GAIN    GAIN_FOUR  // FSR ±1.024V (max input ~0.789V for full pack)
#define ADS1115_MV_PER_LSB  0.03125    // 1.024V / 32768
// T3-FW-027: ADS1115 PGA gain is fixed to GAIN_FOUR (±1.024V FSR).
//   Cell voltage calculation (DIVIDER_MULTIPLIER) depends on this PGA setting.
//   If PGA gain is changed, DIVIDER_MULTIPLIER must be recalculated accordingly.
#define ADS1115_PGA         ADS1115_PGA_GAIN    // T3-FW-034: Alias for modular code
#define ADS1115_LSB_V       ADS1115_MV_PER_LSB  // T3-FW-034: Alias for modular code

// --- T3-FW-034: Modular code constants ---
#define INA219_SHUNT_RESISTOR_MILLIOHM  0.75f    // 0.75mΩ shunt (75mV / 100A)
#define INA219_MAX_CURRENT_A            100.0f   // INA219 max current (A)
#define BATTERY_DIRECT_PIN              BATT_VOLT_PIN  // Direct ADC battery voltage pin
#define ADC_REFERENCE_MV                3300     // ESP32 ADC reference voltage (mV)
#define GAS_TELEMETRY_URL               GAS_SCRIPT_URL  // T3-FW-034: Alias for modular code

// --- T3-FW-034: Automation/rule engine constants ---
#define MAX_RULES            20     // Maximum number of automation rules
#define RULE_CONDITIONS_MAX  8      // Max conditions per rule
#define RULE_ACTIONS_MAX     4      // Max actions per rule

// --- T3-FW-034: Condition operator constants for modular rule engine ---
#define COND_OP_GT           0  // Greater than
#define COND_OP_LT           1  // Less than
#define COND_OP_EQ           2  // Equal to
#define COND_OP_GTE          3  // Greater than or equal
#define COND_OP_LTE          4  // Less than or equal
#define COND_OP_NE           5  // Not equal to

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
// FW-003 FIX: Overtemp uses SHT31 ambient room temp (sensorData.roomTemp), NOT battery temp.
//   Since there is no dedicated battery temperature sensor, we apply a -10°C safety margin
//   to the threshold to account for the ambient-to-battery thermal gradient. Battery internal
//   temperature is typically 5-15°C higher than ambient under charge/discharge load.
//   Original SAFETY_MAX_TEMP_C was 50.0°C; effective threshold is now 40.0°C.
#define SAFETY_MAX_TEMP_C   50.0    // Thermal protection (base — effective threshold reduced by 10°C in code)
#define SAFETY_OVERTEMP_AMBIENT_MARGIN  10.0  // FW-003 FIX: Safety margin subtracted from ambient reading
#define SAFETY_OVERCURRENT_A 31.0   // Overcurrent protection (A)
#define SAFETY_CELL_IMBALANCE_V 0.3  // Cell imbalance threshold (V)

// --- T3-FW-022: Cell-level safety thresholds for LiFePO4 ---
#define SAFETY_CELL_UNDERVOLTAGE_V 2.5f   // Per-cell undervoltage protection (V)
#define SAFETY_CELL_OVERVOLTAGE_V  3.65f  // Per-cell overvoltage protection (V)

// --- Telemetry Queue ---
#define TELEMETRY_QUEUE_SIZE 10     // REDUCED from 50 to 10 to minimize heap fragmentation
#define TELEMETRY_JSON_BUF_SIZE 1024  // Max JSON payload size
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
// T3-FW-028: EEPROM_MAGIC_VALUE (0xAA) is the LEGACY single-byte magic value
//   from the original firmware. It is NOT the same as EEPROM_MAGIC (0x53454D53)
//   which is the 4-byte magic used in the new unified EEPROM format.
//   This alias is kept for backward compatibility when detecting old EEPROM data.
#define EEPROM_MAGIC_VALUE      0xAA  // Legacy single-byte magic value

// --- T3-FW-018: Retry queue size for failed telemetry sends ---
#define RETRY_QUEUE_SIZE        50

// --- T3-FW-019: Event log limits ---
#define EVENT_LOG_MAX           100   // Maximum events in circular buffer
#define EVENT_CLOUD_BATCH       10    // Max events to sync per cloud batch

// --- Serial Debug ---
#define SERIAL_BAUD         115200
#define SERIAL_BAUD_RATE    115200   // T3-FW-034: Alias for modular code
#define DEBUG_ENABLED       true

// --- OTA Configuration ---
// SECURITY FIX v1.0.2: Password must match platformio.ini upload_flags --auth value.
// Set via build flag: -DOTA_PASSWORD='"your_secure_password"'
#ifndef OTA_PASSWORD
  #define OTA_PASSWORD        "CHANGE_ME"
  #warning "OTA_PASSWORD not set via build flag — OTA updates will be unprotected!"
#endif
#define OTA_PORT            3232
#define OTA_HOSTNAME        "sems-esp32"

// --- Watchdog ---
// NOTE: esp_task_wdt_init() and esp_task_wdt_add(NULL) are called in setup()
//       after all hardware initialization is complete. esp_task_wdt_reset() is
//       called at the top of every loop() iteration.
#define WATCHDOG_TIMEOUT_S  30

// FW-015 FIX: Day-of-week convention — RTClib returns 0=Sunday, 1=Monday, ..., 6=Saturday.
//   This is the ISO-like convention used by DS3231/RTClib. When comparing schedule days,
//   backend must use the same convention: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
//   If the backend uses 0=Monday (ISO 8601), a mapping conversion is required.
//   See scheduleEngineLoop() in SEMS_Firmware.ino for day comparison logic.

// --- NTP Time Synchronization ---
// Syncs RTC from NTP when WiFi is available. Called on boot and periodically.
#define NTP_ENABLED             1
#define NTP_SERVER              "pool.ntp.org"
#define NTP_SYNC_INTERVAL_MS    3600000  // Sync every hour

// --- Moving Average ---
#define MA_WINDOW_I2C       5
#define MA_WINDOW_ANALOG    10

// --- Safety Config Validation Ranges ---
// Used to clamp remote config values to safe physical limits
#define SAFETY_VALID_OVERVOLT_MIN   26.0   // Min overvoltage threshold (V)
#define SAFETY_VALID_OVERVOLT_MAX   35.0   // Max overvoltage threshold (V)
#define SAFETY_VALID_UNDERVOLT_MIN  15.0   // Min undervoltage threshold (V)
#define SAFETY_VALID_UNDERVOLT_MAX  24.0   // Max undervoltage threshold (V)
#define SAFETY_VALID_OVERCURRENT_MIN 5.0    // Min overcurrent threshold (A)
#define SAFETY_VALID_OVERCURRENT_MAX 50.0   // Max overcurrent threshold (A)
#define SAFETY_VALID_OVERTEMP_MIN    30.0   // Min overtemp threshold (°C)
#define SAFETY_VALID_OVERTEMP_MAX    80.0   // Max overtemp threshold (°C)
#define SAFETY_VALID_CELL_IMBAL_MIN  0.1    // Min cell imbalance threshold (V)
#define SAFETY_VALID_CELL_IMBAL_MAX  1.0    // Max cell imbalance threshold (V)
#define SAFETY_VALID_TELEM_MIN_MS   5000    // Min telemetry interval (ms)
#define SAFETY_VALID_TELEM_MAX_MS   300000  // Max telemetry interval (ms)

// ============================================================================
// FIX v1.0.2: Modular code compatibility aliases
// The modular code in sensors/, engines/, utils/ uses different constant names.
// These aliases bridge the gap so the modular code can compile.
// TODO: Once modular code is refactored to use the canonical names above,
//       remove these aliases and update the modular files directly.
// ============================================================================
#define SENSOR_POLL_INTERVAL_MS    SENSOR_POLL_MS
#define PIR_CHECK_INTERVAL_MS     PIR_POLL_MS
#define PIR_COUNT                NUM_PIRS
#define ACS712_MODEL              30      // ACS712-30A
#define ACS712_SAMPLE_INTERVAL_US  (ACS712_SAMPLE_INTERVAL_MS * 1000UL)
#define ACS712_RMS_WINDOW         ACS712_SAMPLES

// Modular code battery aliases (matches .ino naming convention)
#define BATTERY_CAPACITY_AH       BATT_CAPACITY_AH
#define BATTERY_NOMINAL_V        BATT_NOMINAL_VOLT
#define BATTERY_FULL_V           BATT_FULL_VOLT
#define BATTERY_EMPTY_V          BATT_EMPTY_VOLT

// SOC aliases for modular code
#define SOC_FULL_V               SOC_RECAL_VOLT
#define SOC_FULL_CURRENT_A        SOC_RECAL_CURRENT
#define SOC_FULL_HOLD_MIN        30      // 30 minutes hold for full charge detection
#define SOC_MAX_PERCENT          100.0
#define SOC_MIN_PERCENT          0.0

// Load shedding aliases for modular code
#define SHED_SOC_CRITICAL        15.0    // SOC% for critical shedding
#define SHED_SOC_LOW             25.0    // SOC% for low shedding
#define SHED_SOC_NORMAL          35.0    // SOC% for normal shedding
#define SHED_RESTORE_HYSTERESIS  3.0     // Hysteresis for recovery

// Safety aliases for modular code
#define SAFETY_OVERVOLTAGE_V     BATT_OVERVOLT
#define SAFETY_OVERTEMP_C        SAFETY_MAX_TEMP_C
#define SAFETY_CELL_DIFF_MAX_V    SAFETY_CELL_IMBALANCE_V

// Gas/config aliases for modular code
#define GAS_CONFIG_URL           GAS_SCRIPT_URL
#define CONFIG_SYNC_INTERVAL_MS  CONFIG_SYNC_MS
#define TELEMETRY_POST_INTERVAL_MS TELEMETRY_UPLOAD_MS

// Shift register bit offsets for modular code
#define RELAY_BIT_OFFSET        0       // Relay bits start at bit 0
#define MOSFET_BIT_OFFSET       NUM_RELAYS  // MOSFET bits start after relays
#define RELAY_DEBOUNCE_MS      100     // Debounce between relay state changes

#endif // SEMS_CONFIG_H
