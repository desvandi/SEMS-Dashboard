/**
 * UserAPI.gs — User Management API
 * ==================================
 * Handles user authentication, CRUD operations, and role management.
 *
 * Endpoints:
 *   POST /api/users/auth   — User login (get session token)
 *   GET  /api/users        — Get user list (admin only)
 *   POST /api/users/create — Create new user (admin only)
 *   POST /api/users/update — Update user (admin only)
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
      var retryAfter = Math.round((cache.getTtl(rlKey) || 0) / 60);
      return {
        success: false,
        error: 'Too many login attempts. Try again in ' + retryAfter + ' minute(s).',
        code: 429
      };
    }

    var result = authenticateUser_(payload.username, payload.password);

    if (!result.success) {
      cache.put(rlKey, String(failCount + 1), 900); // 15 minutes TTL
      return {
        success: false,
        error: result.error,
        code: 401
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

    var users = [];

    for (var i = 1; i < data.length; i++) {
      users.push({
        id:         data[i][colId],
        username:   data[i][colUsername],
        role:       data[i][colRole],
        created_at: data[i][colCreatedAt],
        active:     data[i][colActive] === true || data[i][colActive] === 'true'
      });
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

    // Validate password
    if (payload.password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters', code: 400 };
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

    var userRow = [
      userId,
      username,
      passwordHash,
      payload.role,
      now,
      true // active
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
          var newHash = hashPassword_(payload.password);
          sheet.getRange(row, colPassHash + 1).setValue(newHash);
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
          // Invalidate all session caches when role changes (B-M-02)
          var sessionCache = CacheService.getScriptCache();
          sessionCache.removeAll(sessionCache.getAll().keys.filter(function(k) {
            return k.indexOf(AUTH.SESSION_CACHE_PREFIX) === 0;
          }));
        }

        // Update active status if provided
        if (payload.active !== undefined) {
          sheet.getRange(row, colActive + 1).setValue(payload.active === true);
          // Invalidate all session caches when active status changes (B-M-02)
          var sessionCache2 = CacheService.getScriptCache();
          sessionCache2.removeAll(sessionCache2.getAll().keys.filter(function(k) {
            return k.indexOf(AUTH.SESSION_CACHE_PREFIX) === 0;
          }));
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
      return { success: false, error: 'User not found: ' + payload.id, code: 404 };
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
