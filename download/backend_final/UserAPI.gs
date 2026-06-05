/**
 * UserAPI.gs — User Management API
 * ==================================
 * Handles user authentication, CRUD operations, and role management.
 *
 * SECURITY v1.1.0:
 *   - Added /api/users/change-password endpoint for forced password changes
 *   - Targeted session invalidation (only affected user, not all sessions)
 *   - Fixed indentation in lock blocks
 *
 * Endpoints:
 *   POST /api/users/auth           — User login (get session token)
 *   GET  /api/users                 — Get user list (admin only)
 *   POST /api/users/create          — Create new user (admin only)
 *   POST /api/users/update          — Update user (admin only)
 *   POST /api/users/change-password — Change user password (authenticated user)
 */

// ============================================================
// POST /api/users/auth — User Authentication
// ============================================================

/**
 * Authenticate a user and return a session token.
 *
 * Expected payload:
 * {
 *   username: string,
 *   password: string (plaintext)
 * }
 *
 * @param {Object} payload - Login credentials
 * @returns {Object} { success, token, user }
 */
function handleUsersAuth_(payload) {
  try {
    if (!payload || !payload.username || !payload.password) {
      return {
        success: false,
        error: 'Username and password are required.',
        code: 400
      };
    }

    var cache = CacheService.getScriptCache();
    var username = payload.username.trim().toLowerCase();

    // Rate limiting: max 5 failed attempts per 15 minutes per username
    var rlKey = 'login_fail_' + username;
    var failCount = parseInt(cache.get(rlKey) || '0');
    if (failCount >= 5) {
      // T3-BE-005: Fixed — cache.getTtl() is not a valid GAS method.
      // Use fixed retry message instead of attempting to read TTL.
      return {
        success: false,
        error: 'Too many login attempts. Try again in 15 minute(s).',
        code: 429
      };
    }

    var result = authenticateUser_(payload.username, payload.password);

    if (!result.success) {
      // Don't rate-limit against must_change_password attempts
      if (!result.mustChangePassword) {
        cache.put(rlKey, String(failCount + 1), 900); // 15 minutes TTL
      }
      return {
        success: false,
        error: result.error,
        code: result.mustChangePassword ? 403 : 401,
        mustChangePassword: result.mustChangePassword || false
      };
    }

    cache.remove(rlKey); // Clear failed attempts on success

    return {
      success: true,
      message: 'Login successful',
      token: result.token,
      user: result.user
    };

  } catch (e) {
    console.error('Users auth error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/users/change-password — Change User Password
// SECURITY v1.1.0: New endpoint for forced password changes
// ============================================================

/**
 * Allow an authenticated user to change their own password.
 * Also used to satisfy the must_change_password requirement on first login.
 * For users with must_change_password=true, authentication is done via
 * current password verification (not session token) since they cannot
 * obtain a session until the password is changed.
 *
 * Expected payload:
 * {
 *   username: string (required),
 *   current_password: string (current password — required for must_change_password users)
 *   new_password: string (new password, min 8 chars)
 * }
 *
 * @param {Object} payload - Password change data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, message }
 */
function handleUsersChangePassword_(payload, headers) {
  try {
    if (!payload || !payload.username || !payload.new_password) {
      return {
        success: false,
        error: 'Missing required fields: username, new_password',
        code: 400
      };
    }

    var username = payload.username.trim().toLowerCase();
    var newPassword = payload.new_password;

    // T3-BE-007: Rate limiting for password change (brute-force protection)
    var cache = CacheService.getScriptCache();
    var cpRlKey = 'chpass_fail_' + username;
    var cpFailCount = parseInt(cache.get(cpRlKey) || '0');
    if (cpFailCount >= 5) {
      return { success: false, error: 'Too many password change attempts. Try again in 15 minute(s).', code: 429 };
    }

    // Validate new password strength
    if (newPassword.length < 8) {
      return { success: false, error: 'New password must be at least 8 characters', code: 400 };
    }
    // B-08: Validate password complexity
    var pwdComplexity = validatePasswordComplexity_(newPassword);
    if (!pwdComplexity.valid) {
      return { success: false, error: pwdComplexity.error, code: 400 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.USERS);

    if (!sheet) {
      return { success: false, error: 'Users sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    var colId             = headers_row.indexOf('id');
    var colUsername       = headers_row.indexOf('username');
    var colPassHash       = headers_row.indexOf('password_hash');
    var colMustChangePass = headers_row.indexOf('must_change_password');

    if (colId === -1 || colUsername === -1 || colPassHash === -1) {
      return { success: false, error: 'Users sheet has invalid structure', code: 500 };
    }

    // Find the user
    var userFound = false;
    var userRow = -1;

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colUsername]).trim().toLowerCase() === username) {
        userFound = true;
        userRow = i + 1; // 1-based
        break;
      }
    }

    if (!userFound) {
      // T3-BE-010: Generic error message to avoid information leakage
      return { success: false, error: 'Resource not found', code: 404 };
    }

    var storedHash = String(data[userRow - 1][colPassHash]);
    var mustChange = false;
    if (colMustChangePass !== -1) {
      var mcpVal = data[userRow - 1][colMustChangePass];
      mustChange = (mcpVal === true || mcpVal === 'true' || mcpVal === 1);
    }

    // If must_change_password is set, verify using current_password
    // If not set, the user must already have a valid session token
    if (mustChange) {
      // User must provide current_password to change password
      if (!payload.current_password) {
        return {
          success: false,
          error: 'Current password required. Use current_password field.',
          code: 400,
          mustChangePassword: true
        };
      }

      // Verify current password
      if (!verifyPassword_(payload.current_password, storedHash)) {
        // T3-BE-007: Increment change-password rate limit on failed verification
        cache.put(cpRlKey, String(cpFailCount + 1), 900); // 15 minutes TTL
        return {
          success: false,
          error: 'Current password is incorrect.',
          code: 401,
          mustChangePassword: true
        };
      }
    } else {
      // For non-must-change users, require session token authentication
      var user = validateUserToken_(headers);
      if (!user) {
        return { success: false, error: 'Authentication required. Please login first.', code: 401 };
      }

      // B-16: Verify username matches session for non-must_change users
      // Ensures users can only change their own password (admin exempted)
      if (user.role !== USER_ROLE.ADMIN && user.username !== username) {
        return { success: false, error: 'You can only change your own password.', code: 403 };
      }
    }

    // T3-BE-007: Clear rate limit on successful verification (before writing new hash)
    cache.remove(cpRlKey);

    // Generate new password hash and update
    var newHash = hashPassword_(newPassword);

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      sheet.getRange(userRow, colPassHash + 1).setValue(newHash);

      // Clear must_change_password flag
      if (colMustChangePass !== -1) {
        sheet.getRange(userRow, colMustChangePass + 1).setValue(false);
      }

      // Invalidate the user's existing sessions
      var userId = String(data[userRow - 1][colId]);
      invalidateUserSessions_(userId);

      console.log('Users: Password changed for user "' + username + '"');

      return {
        success: true,
        message: 'Password changed successfully. Please login with your new password.'
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Users change-password error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// GET /api/users — Get User List
// ============================================================

/**
 * Return list of all users (without password hashes).
 * Requires admin role.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { success, users: Array }
 */
function handleUsersGet_(reqHeaders) {
  try {
    var auth = requireAdmin_(reqHeaders);
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.USERS);

    if (!sheet) {
      return { success: false, error: 'Users sheet not found', code: 500 };
    }

    var data = sheet.getDataRange().getValues();
    var headers_row = data[0];

    var colId       = headers_row.indexOf('id');
    var colUsername = headers_row.indexOf('username');
    var colRole     = headers_row.indexOf('role');
    var colCreatedAt = headers_row.indexOf('created_at');
    var colActive   = headers_row.indexOf('active');
    var colMustChangePass = headers_row.indexOf('must_change_password');

    var users = [];

    for (var i = 1; i < data.length; i++) {
      var user = {
        id:         data[i][colId],
        username:   data[i][colUsername],
        role:       data[i][colRole],
        created_at: data[i][colCreatedAt],
        active:     data[i][colActive] === true || data[i][colActive] === 'true'
      };
      // Include must_change_password flag if column exists
      if (colMustChangePass !== -1) {
        user.must_change_password = data[i][colMustChangePass] === true ||
                                    data[i][colMustChangePass] === 'true' ||
                                    data[i][colMustChangePass] === 1;
      }
      users.push(user);
    }

    return {
      success: true,
      count: users.length,
      users: users
    };

  } catch (e) {
    console.error('Users GET error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/users/create — Create New User
// ============================================================

/**
 * Create a new user account. Admin only.
 *
 * Expected payload:
 * {
 *   username: string (3-30 chars, alphanumeric + underscore),
 *   password: string (min 8 chars),
 *   role: "admin" | "technician" | "viewer"
 * }
 *
 * @param {Object} payload - User data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, user }
 */
function handleUsersCreate_(payload, reqHeaders) {
  try {
    var auth = requireAdmin_(reqHeaders);
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    // Validate payload
    if (!payload || !payload.username || !payload.password || !payload.role) {
      return {
        success: false,
        error: 'Missing required fields: username, password, role',
        code: 400
      };
    }

    // Validate username
    var username = payload.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      return {
        success: false,
        error: 'Username must be 3-30 characters (lowercase letters, numbers, underscores)',
        code: 400
      };
    }

    // B-08: Validate password complexity
    var pwdComplexity = validatePasswordComplexity_(payload.password);
    if (!pwdComplexity.valid) {
      return { success: false, error: pwdComplexity.error, code: 400 };
    }

    // Validate role
    var validRoles = Object.values(USER_ROLE);
    if (validRoles.indexOf(payload.role) === -1) {
      return { success: false, error: 'Invalid role: ' + payload.role + '. Valid: admin, technician, viewer', code: 400 };
    }

    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.USERS);

    if (!sheet) {
      return { success: false, error: 'Users sheet not found', code: 500 };
    }

    // B-02: Use LockService to prevent duplicate username race condition
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      // Re-read data inside lock to catch concurrent inserts
      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colUsername = headers_row.indexOf('username');

      // Check if username already exists
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][colUsername]).trim().toLowerCase() === username) {
          return { success: false, error: 'Username already exists: ' + username, code: 409 };
        }
      }

      // Create user
      var userId = generateId_('usr');
      var passwordHash = hashPassword_(payload.password);
      var now = getTimestamp_();

      // SECURITY: New users do NOT have must_change_password set (they chose their own password)
      var userRow = [
        userId,
        username,
        passwordHash,
        payload.role,
        now,
        true,   // active
        false   // must_change_password = false (user chose their own password)
      ];

      sheet.appendRow(userRow);

      console.log('Users: Admin "' + auth.user.username + '" created user "' + username + '" (role: ' + payload.role + ')');

      return {
        success: true,
        message: 'User created successfully',
        user: {
          id: userId,
          username: username,
          role: payload.role,
          created_at: now,
          active: true
        }
      };

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Users create error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/users/update — Update User
// ============================================================

/**
 * Update an existing user. Admin only.
 * Can update: username, password, role, active status.
 *
 * Expected payload (all fields optional except id):
 * {
 *   id: string (required),
 *   username?: string,
 *   password?: string,
 *   role?: string,
 *   active?: boolean
 * }
 *
 * @param {Object} payload - Update data
 * @param {Object} headers - Request headers
 * @returns {Object} { success, user }
 */
function handleUsersUpdate_(payload, reqHeaders) {
  try {
    var auth = requireAdmin_(reqHeaders);
    if (!auth.authorized) {
      return { success: false, error: auth.error, code: auth.user ? 403 : 401 };
    }

    if (!payload || !payload.id) {
      return { success: false, error: 'Missing user ID', code: 400 };
    }

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(TELEMETRY.LOCK_WAIT_MS);

      var ss = getSpreadsheet_();
      var sheet = ss.getSheetByName(SHEET.USERS);

      if (!sheet) {
        return { success: false, error: 'Users sheet not found', code: 500 };
      }

      var data = sheet.getDataRange().getValues();
      var headers_row = data[0];

      var colId        = headers_row.indexOf('id');
      var colUsername  = headers_row.indexOf('username');
      var colPassHash  = headers_row.indexOf('password_hash');
      var colRole      = headers_row.indexOf('role');
      var colActive    = headers_row.indexOf('active');
      var colMustChangePass = headers_row.indexOf('must_change_password');

      var found = false;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][colId]) === String(payload.id)) {
          found = true;
          var row = i + 1;

          // Prevent admin from deactivating themselves
          if (auth.user.id === payload.id && payload.active === false) {
            return { success: false, error: 'Cannot deactivate your own account', code: 400 };
          }

          // Update username if provided
          if (payload.username) {
            var newUsername = payload.username.trim().toLowerCase();
            if (!/^[a-z0-9_]{3,30}$/.test(newUsername)) {
              return { success: false, error: 'Invalid username format', code: 400 };
            }
            // Check for duplicates (excluding current user)
            for (var j = 1; j < data.length; j++) {
              if (j !== i && String(data[j][colUsername]).trim().toLowerCase() === newUsername) {
                return { success: false, error: 'Username already taken: ' + newUsername, code: 409 };
              }
            }
            sheet.getRange(row, colUsername + 1).setValue(newUsername);
          }

          // Update password if provided
          if (payload.password) {
            if (payload.password.length < 8) {
              return { success: false, error: 'Password must be at least 8 characters', code: 400 };
            }
            // T3-BE-006: Validate password complexity on user update
            var pwdResult = validatePasswordComplexity_(payload.password);
            if (!pwdResult.valid) {
              return { success: false, error: pwdResult.error, code: 400 };
            }
            var newHash = hashPassword_(payload.password);
            sheet.getRange(row, colPassHash + 1).setValue(newHash);

            // SECURITY: If admin sets a new password, set must_change_password=true
            // so the user is forced to change it on next login
            if (colMustChangePass !== -1) {
              sheet.getRange(row, colMustChangePass + 1).setValue(true);
            }
          }

          // Update role if provided
          if (payload.role) {
            var validRoles = Object.values(USER_ROLE);
            if (validRoles.indexOf(payload.role) === -1) {
              return { success: false, error: 'Invalid role: ' + payload.role, code: 400 };
            }
            // Prevent downgrading the last active admin
            if (payload.role !== USER_ROLE.ADMIN) {
              var currentRole = String(data[i][colRole]);
              if (currentRole === USER_ROLE.ADMIN) {
                var adminCount = 0;
                for (var k = 1; k < data.length; k++) {
                  if (data[k][colRole] === USER_ROLE.ADMIN && (data[k][colActive] === true || data[k][colActive] === 'true')) {
                    adminCount++;
                  }
                }
                if (adminCount <= 1) {
                  return { success: false, error: 'Cannot downgrade the last active admin', code: 400 };
                }
              }
            }
            sheet.getRange(row, colRole + 1).setValue(payload.role);
            // SECURITY: Only invalidate the specific user's sessions (not ALL sessions)
            invalidateUserSessions_(payload.id);
          }

          // Update active status if provided
          if (payload.active !== undefined) {
            sheet.getRange(row, colActive + 1).setValue(payload.active === true);
            // SECURITY: Only invalidate the specific user's sessions (not ALL sessions)
            invalidateUserSessions_(payload.id);
          }

          // Read updated row for response
          var updatedData = sheet.getDataRange().getValues();
          var updatedRow = updatedData[row];

          console.log('Users: Admin "' + auth.user.username + '" updated user "' + payload.id + '"');

          return {
            success: true,
            message: 'User updated',
            user: {
              id: updatedRow[colId],
              username: updatedRow[colUsername],
              role: updatedRow[colRole],
              active: updatedRow[colActive] === true || updatedRow[colActive] === 'true'
            }
          };
        }
      }

      if (!found) {
        // T3-BE-010: Generic error message to avoid information leakage
        return { success: false, error: 'Resource not found', code: 404 };
      }

    } catch (lockError) {
      return { success: false, error: 'Server busy. Could not acquire lock.', code: 503 };
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }

  } catch (e) {
    console.error('Users update error: ' + e.message);
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// POST /api/users/logout — Logout (optional)
// ============================================================

/**
 * Invalidate the current user session.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { success, message }
 */
function handleUsersLogout_(reqHeaders) {
  try {
    var result = logoutUser_(reqHeaders);
    return {
      success: result,
      message: result ? 'Logged out successfully' : 'No active session found'
    };
  } catch (e) {
    return { success: false, error: 'Internal server error', code: 500 };
  }
}

// ============================================================
// B-08: Password Complexity Validation
// ============================================================

/**
 * Validate that a password meets complexity requirements.
 * Requires at least one uppercase, one lowercase, one digit, and one special character.
 *
 * @param {string} password - The password to validate
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validatePasswordComplexity_(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  var hasUpper = /[A-Z]/.test(password);
  var hasLower = /[a-z]/.test(password);
  var hasDigit = /[0-9]/.test(password);
  var hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);

  if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
    var missing = [];
    if (!hasUpper) missing.push('uppercase letter');
    if (!hasLower) missing.push('lowercase letter');
    if (!hasDigit) missing.push('digit');
    if (!hasSpecial) missing.push('special character');
    return {
      valid: false,
      error: 'Password must contain: ' + missing.join(', ')
    };
  }

  return { valid: true, error: null };
}
