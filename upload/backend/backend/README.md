# SEMS Backend — Google Apps Script

## Smart Energy Management System — REST API Backend

Production-grade Google Apps Script backend that serves as REST API middleware between ESP32 hardware and a Next.js frontend. Database is a Google Spreadsheet with 8 sheets.

---

## Architecture Overview

```
ESP32 ──(X-Device-Token)──▶ GAS Backend ◀──(Bearer Token)── Next.js Frontend
                                  │
                                  ▼
                          Google Spreadsheet
                         ┌────────────────┐
                         │   devices      │
                         │   telemetry_*  │
                         │   automation_* │
                         │   schedules    │
                         │   users        │
                         │   alarms       │
                         │   configurations│
                         └────────────────┘
```

## File Structure

| File | Purpose |
|------|---------|
| `Code.gs` | Main entry point — doGet/doPost routing to all API handlers |
| `Config.gs` | Spreadsheet ID, sheet names, column definitions, thresholds, constants |
| `Auth.gs` | Device token auth, user auth (SHA-256), session tokens via CacheService |
| `TelemetryAPI.gs` | Receive telemetry (ESP32), get latest, get history |
| `DeviceAPI.gs` | Device state management, manual control |
| `RuleAPI.gs` | Automation rule CRUD |
| `ScheduleAPI.gs` | Schedule CRUD |
| `AlarmAPI.gs` | Alarm creation, listing, acknowledgment |
| `UserAPI.gs` | User auth, CRUD, role management |
| `ConfigAPI.gs` | System configuration get/update |
| `EmailNotification.gs` | Bilingual email alerts with rate limiting |
| `DataCleanup.gs` | Auto-cleanup old telemetry (30d) and alarms (90d) |
| `SetupSheets.gs` | Initialize all 8 sheets with headers & default data |

---

## Setup Instructions

### Step 1: Create Google Spreadsheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it "SEMS Database" (or any name you prefer)
3. Copy the **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   ```

### Step 2: Create Google Apps Script Project

1. Open the spreadsheet → **Extensions** → **Apps Script**
2. Delete all existing code in `Code.gs`
3. **Copy each `.gs` file** from this folder into the Apps Script editor
   - Create a new file for each `.gs` file (File → New → Script)
   - **IMPORTANT**: All files must be in the **same Apps Script project**

### Step 3: Configure Spreadsheet ID

1. Open `Config.gs`
2. Replace `REPLACE_WITH_YOUR_SPREADSHEET_ID` with your actual spreadsheet ID:
   ```javascript
   var SPREADSHEET_ID = 'your-actual-spreadsheet-id-here';
   ```

### Step 4: Run Setup

1. In the Apps Script editor, select **setupSheets** from the function dropdown
2. Click **Run**
3. Grant permissions when prompted (you may need to go through "Advanced" → "Go to script")
4. Check the execution log — you should see:
   ```
   === SEMS Setup Started ===
   OK: devices created with 17 default devices
   OK: telemetry_live created (1 data row)
   OK: telemetry_history created (empty, append-only)
   OK: automation_rules created with 3 example rules
   OK: schedules created with 2 example schedules
   OK: users created with 2 default users
   OK: alarms created (empty)
   OK: configurations created with 15 default configs
   === SEMS Setup Complete ===
   ```

### Step 5: Deploy as Web App

1. Click **Deploy** → **New deployment**
2. Click the gear icon next to "Select type" → choose **Web app**
3. Settings:
   - **Description**: `SEMS Backend API`
   - **Execute as**: `Me` (your account)
   - **Who has access**: `Anyone`
4. Click **Deploy**
5. **Copy the Web App URL** — this is your API base URL
6. Click **Authorize** and grant permissions

### Step 6: Configure Device Token

1. Open your Google Spreadsheet, go to the **configurations** sheet
2. Find the row with key `device_token`
3. Change the value to a strong random token:
   ```
   sems_prod_xK9mP2vN8qR4wY7zA3bC6dE0fG1hI5jL
   ```
4. This token must be sent by ESP32 in the `X-Device-Token` header

### Step 7: Configure Notification Email

1. In the **configurations** sheet, find `notification_email`
2. Enter the email address for alarm notifications
3. Must be a Gmail address or an address authorized for your account

### Step 8: Change Default Passwords

⚠️ **IMPORTANT**: Change the default passwords immediately!

Default accounts created:
| Username | Default Password | Role |
|----------|-----------------|------|
| `admin` | `admin123` | Admin (full access) |
| `technician` | `tech123` | Technician (read, write, control) |

To change passwords:
- Use the `POST /api/users/update` endpoint
- Or directly edit the `users` sheet (replace the hash with a new SHA-256 hash)

---

## API Reference

### Authentication Methods

#### Device Token (for ESP32)
```
Header: X-Device-Token: sems_prod_xK9mP2vN8qR4wY7zA3bC6dE0fG1hI5jL
```

#### User Token (for Frontend)
```
Header: Authorization: Bearer <session_token>

// Get token by logging in:
POST {BASE_URL}/api/users/auth
Body: { "username": "admin", "password": "admin123" }
```

### Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| **ESP32 → Cloud** | | | |
| POST | `/api/telemetry` | Device Token | Send telemetry data |
| POST | `/api/device/update` | Device Token | Update device state |
| POST | `/api/alarm/create` | Device Token | Create alarm entry |
| GET | `/api/devices` | Device Token | Get device configs |
| GET | `/api/config/get` | Device Token | Get configurations |
| GET | `/api/rules/get` | Device Token | Get automation rules |
| GET | `/api/schedules/get` | Device Token | Get schedules |
| **Frontend → Cloud** | | | |
| GET | `/api/telemetry/latest` | User Token | Get latest telemetry |
| GET | `/api/telemetry/history` | User Token | Get history (params: start, end, limit) |
| GET | `/api/devices` | User Token | Get device list |
| POST | `/api/devices/control` | User Token (control) | Manual relay control |
| POST | `/api/rules/update` | User Token (write) | Create/update rule |
| POST | `/api/rules/delete` | User Token (write) | Delete rule |
| POST | `/api/schedules/update` | User Token (write) | Create/update schedule |
| POST | `/api/schedules/delete` | User Token (write) | Delete schedule |
| GET | `/api/alarms` | User Token (read) | Get alarm history |
| POST | `/api/alarms/acknowledge` | User Token (write) | Acknowledge alarms |
| POST | `/api/users/auth` | None | User login |
| GET | `/api/users` | User Token (admin) | Get user list |
| POST | `/api/users/create` | User Token (admin) | Create user |
| POST | `/api/users/update` | User Token (admin) | Update user |
| POST | `/api/config/update` | User Token (config) | Update config |
| **System** | | | |
| GET | `/api/health` | None | Health check |

### Request Examples

#### ESP32 — Send Telemetry
```bash
curl -X POST "{BASE_URL}/api/telemetry" \
  -H "X-Device-Token: YOUR_DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "battery_voltage": 24.5,
    "battery_current": 5.2,
    "soc_percent": 65,
    "relay_states": [1,1,1,1,0,0,1,1,1,0,0,0,0],
    "mosfet_states": [0,128,0,0],
    "uptime_seconds": 86400,
    "wifi_rssi": -55
  }'
```

#### Frontend — Login
```bash
curl -X POST "{BASE_URL}/api/users/auth" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
# Response: { "success": true, "token": "...", "user": {...} }
```

#### Frontend — Get Latest Telemetry
```bash
curl "{BASE_URL}/api/telemetry/latest" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

#### Frontend — Control Device
```bash
curl -X POST "{BASE_URL}/api/devices/control" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "relay_10", "state": 1}'
```

---

## User Roles & Permissions

| Permission | Admin | Technician | Viewer |
|------------|-------|------------|--------|
| Read data | ✅ | ✅ | ✅ |
| Write rules/schedules | ✅ | ✅ | ❌ |
| Control devices | ✅ | ✅ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Update config | ✅ | ❌ | ❌ |

---

## Email Notifications

Alarm emails are sent automatically when thresholds are breached:
- **Low Battery**: Voltage < 21V
- **Overvoltage**: Voltage > 29.2V
- **Overload**: Current > 80A
- **Sensor Failure**: Invalid sensor readings

Rate limits:
- Max 1 email per alarm type per 30 minutes
- Max 20 emails per day

Emails are bilingual (Indonesian + English).

---

## Data Retention

| Data | Retention Period | Cleanup Method |
|------|-----------------|----------------|
| Telemetry History | 30 days | Auto-cleanup on every telemetry POST + daily trigger at 3 AM |
| Alarms | 90 days | Auto-cleanup on every telemetry POST + daily trigger at 3 AM |
| Telemetry Live | Single row (overwritten) | N/A |
| Devices, Rules, Schedules, Users, Config | Permanent | Manual deletion |

---

## Troubleshooting

### "Spreadsheet not found"
- Verify `SPREADSHEET_ID` in `Config.gs`
- Ensure the script has access to the spreadsheet

### "Authentication required"
- ESP32: Check `X-Device-Token` header matches the `device_token` config value
- Frontend: Login via `POST /api/users/auth` and use the returned token

### "Permission denied"
- Check user role — viewer role cannot control devices or write rules
- Admin functions require `admin` role

### Telemetry not saving
- Check that `telemetry_live` sheet has a data row (row 2)
- Run `setupSheets()` to reset sheet structure

### Emails not sending
- Ensure `notification_email` is set in configurations
- Check email quota (GAS limit: 100 emails/day)
- Check that the sending email has MailApp permissions

---

## Default Device Mapping

| ID | Name | Type | Channel | Priority |
|----|------|------|---------|----------|
| relay_1 | Lighting - Main | relay | 0 | Critical (0) |
| relay_2 | Lighting - Bedroom | relay | 1 | High (1) |
| relay_3 | Lighting - Kitchen | relay | 2 | High (1) |
| relay_4 | Lighting - Bathroom | relay | 3 | High (1) |
| relay_5 | Lighting - Outdoor | relay | 4 | Medium (2) |
| relay_6 | Fan - Living Room | relay | 5 | High (1) |
| relay_7 | Fan - Bedroom | relay | 6 | High (1) |
| relay_8 | Water Pump | relay | 7 | Critical (0) |
| relay_9 | Router / Modem | relay | 8 | Critical (0) |
| relay_10 | TV / Entertainment | relay | 9 | Medium (2) |
| relay_11 | Phone Charger | relay | 10 | Medium (2) |
| relay_12 | Kitchen Appliance | relay | 11 | Medium (2) |
| relay_13 | Extra Load 1 | relay | 12 | Low (3) |
| mosfet_1 | LED Strip - Room | mosfet | 13 | Medium (2) |
| mosfet_2 | DC Fan Speed Control | mosfet | 14 | High (1) |
| mosfet_3 | Heater Control | mosfet | 15 | Low (3) |
| mosfet_4 | Extra PWM Load | mosfet | 16 | Low (3) |

Priority 0 = never shed, 3 = first to shed during load management.
