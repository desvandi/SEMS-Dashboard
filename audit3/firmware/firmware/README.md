# SEMS Firmware - Smart Energy Management System

## Brand: Jambi Solar Panel powered by PT. Jaya Mandiri Smart Energy

## Overview
ESP32 firmware for the Smart Energy Management System (SEMS). Implements 9 non-blocking engines for solar energy monitoring, smart home automation, and load management.

## Hardware Support
| Component | Status | Notes |
|-----------|--------|-------|
| ESP32 WROOM DEVKIT | Supported | Main edge controller |
| INA219 | Supported | Battery voltage/current/power (100A/75mV shunt) |
| ADS1115 x2 | Supported | 8S LiFePO4 individual cell monitoring |
| SHT31 | Supported | Room temperature & humidity |
| DS3231SN | Supported | Real-time clock, schedule automation |
| ACS712 30A | Supported | Inverter AC load current (RMS sampling) |
| PIR HC-SR501 x4 | Supported | Motion detection |
| 74HC595 x4 | Supported | Daisy-chain shift register (32 output bits) |
| IRLZ44N x4 | Supported | DC MOSFET driver |
| 13-CH Relay Module | Supported | Optocoupler-isolated, active LOW |

## ADS1115 Voltage Divider Circuit
```
Cell_tap(+)--[360k]--->ADS_Input<---[10k]---GND
                  |
                  +---> ADS1115 Channel

Divider ratio: R2/(R1+R2) = 10/(360+10) = 10/370 ≈ 0.02703
Multiplier: (R1+R2)/R2 = 370/10 = 37.0
PGA Gain: 4 (FSR ±1.024V) - max input ~0.789V for full 29.2V pack
```

## Setup (Arduino IDE)
1. Install Arduino IDE 2.x
2. Add ESP32 board manager: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. Install libraries via Library Manager:
   - Adafruit INA219
   - Adafruit ADS1X15
   - Adafruit SHT31 Library
   - RTClib
   - ArduinoJson
4. Open `SEMS_Firmware.ino` in Arduino IDE
5. Edit `config.h` with your WiFi credentials and GAS URL
6. Select board: "ESP32 Dev Module"
7. Upload

## Setup (PlatformIO)
1. Install PlatformIO Core
2. `cd firmware && pio run -t upload`
3. Monitor: `pio device monitor -b 115200`

## Configuration (config.h)
Before flashing, you MUST configure:
- `WIFI_SSID` / `WIFI_PASSWORD` - Your WiFi credentials
- `GAS_SCRIPT_URL` - Google Apps Script web app URL
- `GAS_API_TOKEN` - Device authentication token
- `DEVICE_ID` - Unique device identifier

## Architecture
```
Main Loop (non-blocking, no delay()):
├── Watchdog Feed
├── OTA Handler
├── WiFi Manager (auto-reconnect, exponential backoff)
├── Sensor Engine (I2C polling, moving average, ACS712 RMS)
├── SOC Calculator (Coulomb counting)
├── Safety Engine (timeout, overvoltage, undervoltage, imbalance)
├── Load Shedding Engine (4-tier priority)
├── Automation Engine (JSON rules, AND/OR logic)
├── Schedule Engine (RTC-based, recurring)
├── Telemetry Engine (HTTP POST, retry queue)
├── Config Sync Engine (fetch rules/schedules/devices)
├── Heartbeat LED
└── Uptime Counter
```

## Pin Mapping
| Pin | Function |
|-----|----------|
| GPIO 21 | I2C SDA (INA219, ADS1115x2, SHT31, DS3231) |
| GPIO 22 | I2C SCL |
| GPIO 34 | ACS712 analog input |
| GPIO 14 | 74HC595 SH_CP (clock) |
| GPIO 12 | 74HC595 ST_CP (latch) |
| GPIO 13 | 74HC595 DS (data) |
| GPIO 27 | 74HC595 OE (output enable, active LOW) |
| GPIO 26 | 74HC595 MR (master reset, tied HIGH) |
| GPIO 25 | Status LED (heartbeat) |
| GPIO 4 | Backup battery voltage ADC |
| GPIO 5 | PIR_1 |
| GPIO 18 | PIR_2 |
| GPIO 19 | PIR_3 |
| GPIO 23 | PIR_4 |
