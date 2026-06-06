/**
 * Auth.gs — Authentication & Authorization
 * =========================================
 * Handles two authentication methods:
 *   1. Device Token Auth — ESP32 sends X-Device-Token header
 *   2. User Auth — Frontend sends Bearer token via Authorization header
 *
 * Uses CacheService for session storage and Config sheet for token storage.
 *
 * Security v1.1.0:
 *   - Timing-safe comparison for all token/hash checks
 *   - PBKDF2-like key stretching (1000 rounds SHA-256)
 *   - Session max lifetime (24h hard limit)
 *   - Forced password change on first login with default credentials
 */

// ============================================================
// DEVICE TOKEN AUTHENTICATION
// ============================================================

/**
 * Validate the ESP32 device token from request headers.
 * Token is stored in configurations sheet (key: "device_token").
 * Uses timing-safe comparison to prevent timing attacks.
 *
 * @param {Object} headers - Request headers object
 * @returns {Object} { authenticated: Boolean, error: String|null }
 */
function validateDeviceToken_(headers) {
  var providedToken = headers['X-Device-Token'] ||
                      headers['x-device-token'] ||
                      null;

  if (!providedToken) {
    return {
      authenticated: false,
      error: 'Missing device token. Send X-Device-Token header.'
    };
  }

  // Check cache first to reduce spreadsheet reads
  var cachedToken = CacheService.getScriptCache()
    .get(AUTH.DEVICE_TOKEN_CACHE_KEY);

  var storedToken;
  if (cachedToken !== null) {
    storedToken = cachedToken;
  } else {
    // Read from configurations sheet
    storedToken = getConfigValue_('device_token');
    if (storedToken) {
      // Cache for 5 minutes
      CacheService.getScriptCache()
        .put(AUTH.DEVICE_TOKEN_CACHE_KEY, storedToken, 300);
    }
  }

  if (!storedToken) {
    return {
      authenticated: false,
      error: 'Device token not configured in system.'
    };
  }

  // SECURITY: Use timing-safe comparison to prevent timing side-channel attacks
  if (!compareHashes_(providedToken, storedToken)) {
    console.warn('Auth: Invalid device token attempt from request');
    return {
      authenticated: false,
      error: 'Invalid device token.'
    };
  }

  return { authenticated: true, error: null };
}

// ============================================================
// USER AUTHENTICATION
// ============================================================

/**
 * Authenticate a user by username and password.
 * Password is hashed with PBKDF2-like key stretching and compared to stored hash.
 * Checks must_change_password flag for default credentials.
 *
 * @param {string} username - Login username
 * @param {string} password - Login password (plaintext)
 * @returns {Object} { success: Boolean, token: String|null, user: Object|null, error: String|null, mustChangePassword: Boolean }
 */
function authenticateUser_(username, password) {
  if (!username || !password) {
    return {
      success: false,
      token: null,
      user: null,
      error: 'Username and password are required.',
      mustChangePassword: false
    };
  }

  // Trim inputs
  username = username.trim().toLowerCase();

  // Read user from sheet
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET.USERS);

  if (!sheet) {
    return {
      success: false,
      token: null,
      user: null,
      error: 'Users sheet not found. Run setup first.',
      mustChangePassword: false
    };
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find column indices
  var colId               = headers.indexOf('id');
  var colUsername         = headers.indexOf('username');
  var colPassHash         = headers.indexOf('password_hash');
  var colRole             = headers.indexOf('role');
  var colActive           = headers.indexOf('active');
  var colMustChangePass   = headers.indexOf('must_change_password');

  if (colId === -1 || colUsername === -1 || colPassHash === -1 ||
      colRole === -1 || colActive === -1) {
    return {
      success: false,
      token: null,
      user: null,
      error: 'Users sheet has invalid structure.',
      mustChangePassword: false
    };
  }

  // Verify password using salted hash (with legacy migration support)
  // BE-008 FIX: Removed dead code — `var inputHash = hashPassword_(password)` was
  // computed here but never used (verifyPassword_ handles hashing internally).

  // Search for matching user
  for (var i = 1; i < data.length; i++) {
    var rowUsername = String(data[i][colUsername]).trim().toLowerCase();
    var rowHash     = String(data[i][colPassHash]);
    var rowActive   = data[i][colActive];

    if (rowUsername === username) {
      // Check if account is active
      if (rowActive === false || rowActive === 'false' || rowActive === 0) {
        return {
          success: false,
          token: null,
          user: null,
          error: 'Account is disabled. Contact administrator.',
          mustChangePassword: false
        };
      }

      // Verify using verifyPassword_ (supports both salted and legacy unsalted hashes)
      if (verifyPassword_(password, rowHash)) {

        // SECURITY: Check must_change_password flag
        // If the user still has the default password and must_change_password is set,
        // reject the login and force a password change via /api/users/change-password
        var mustChange = false;
        if (colMustChangePass !== -1) {
          var mcpValue = data[i][colMustChangePass];
          mustChange = (mcpValue === true || mcpValue === 'true' || mcpValue === 1);
        }

        // Legacy migration: upgrade unsalted hash to salted hash on successful login
        if (rowHash.indexOf(':') === -1) {
          // T3-BE-024: Wrap hash upgrade in try-catch to handle write failures
          try {
            var newHash = hashPassword_(password);
            sheet.getRange(i + 1, colPassHash + 1).setValue(newHash);
            console.log('Auth: Upgraded legacy password hash for user "' + username + '"');
          } catch (upgradeErr) {
            console.warn('Auth: Failed to upgrade legacy hash for user "' + username + '": ' + upgradeErr.message);
          }
        }

        // SECURITY: If must_change_password is set, reject login
        // User must use /api/users/change-password endpoint to set a new password first
        if (mustChange) {
          return {
            success: false,
            token: null,
            user: null,
            error: 'Password must be changed before first login. Use the change-password endpoint.',
            code: 403,
            mustChangePassword: true
          };
        }

        // Create session token
        var token = generateSessionToken_();

        // Build user object (without password hash)
        var user = {
          id:        data[i][colId],
          username:  data[i][colUsername],
          role:      data[i][colRole],
          active:    true
        };

        // Store session in cache
        // T3-BE-003: createdAt is immutable for 24h hard limit,
        // lastActivityAt tracks sliding window for TTL refresh
        var sessionData = safeStringify_({
          userId:  user.id,
          username: user.username,
          role:    user.role,
          createdAt: Date.now(),       // immutable - for 24h hard limit
          lastActivityAt: Date.now(),  // sliding window - for TTL refresh
          expiresAt: Date.now() + AUTH.TOKEN_EXPIRY_MS
        });

        // CacheService TTL max is 21600s (6 hours). TOKEN_EXPIRY_MS is now 6h to match.
        var cacheTtlSeconds = Math.round(AUTH.TOKEN_EXPIRY_MS / 1000);
        CacheService.getScriptCache()
          .put(AUTH.SESSION_CACHE_PREFIX + token, sessionData, cacheTtlSeconds);

        // B-04: Register session in per-user index
        registerSessionIndex_(user.id, token);

        console.log('Auth: User "' + username + '" logged in successfully');

        return {
          success: true,
          token: token,
          user: user,
          error: null,
          mustChangePassword: false
        };
      } else {
        console.warn('Auth: Failed login attempt for user "' + username + '"');
        return {
          success: false,
          token: null,
          user: null,
          error: 'Invalid username or password.',
          mustChangePassword: false
        };
      }
    }
  }

  return {
    success: false,
    token: null,
    user: null,
    error: 'Invalid username or password.',
    mustChangePassword: false
  };
}

// ============================================================
// SESSION VALIDATION
// ============================================================

/**
 * Validate a user session token from the Authorization header.
 * Returns user info if valid, null otherwise.
 *
 * SECURITY: Enforces both CacheService TTL and a hard 24-hour max session lifetime.
 * CacheService max TTL is 6 hours, so sessions older than 24h are rejected
 * even if the cache entry somehow persists beyond the TTL.
 *
 * @param {Object} headers - Request headers object
 * @returns {Object|null} User object if authenticated, null otherwise
 */
function validateUserToken_(headers) {
  // Support both "Authorization: Bearer <token>" and "X-Auth-Token: <token>"
  var authHeader = headers['Authorization'] ||
                   headers['authorization'] ||
                   null;
  var token = null;

  if (authHeader) {
    var parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  // Fallback: check X-Auth-Token header (sent by Next.js proxy)
  if (!token) {
    token = headers['X-Auth-Token'] || headers['x-auth-token'] || null;
  }

  if (!token) {
    return null;
  }

  // Look up session in cache
  var cache = CacheService.getScriptCache();
  var sessionJson = cache.get(AUTH.SESSION_CACHE_PREFIX + token);

  if (!sessionJson) {
    return null;
  }

  var session = safeParse_(sessionJson);
  if (!session) {
    return null;
  }

  // SECURITY: Hard max session lifetime check (24 hours)
  // T3-BE-003: Uses immutable createdAt for the 24h hard limit.
  // Reject sessions that have existed for longer than the configured max lifetime,
  // regardless of whether the CacheService TTL has expired or not.
  var sessionAge = Date.now() - session.createdAt;
  if (sessionAge > AUTH.MAX_SESSION_LIFETIME_MS) {
    cache.remove(AUTH.SESSION_CACHE_PREFIX + token);
    console.warn('Auth: Session exceeded max lifetime (' +
      Math.round(sessionAge / 3600000) + 'h > ' +
      Math.round(AUTH.MAX_SESSION_LIFETIME_MS / 3600000) + 'h). Invalidated.');
    return null;
  }

  // Check expiry
  if (Date.now() > session.expiresAt) {
    // Remove expired session
    cache.remove(AUTH.SESSION_CACHE_PREFIX + token);
    return null;
  }

  // T3-BE-003: Sliding window session refresh.
  // Only update lastActivityAt and expiresAt; createdAt remains immutable.
  // This preserves the 24h hard limit while refreshing the sliding TTL window.
  session.lastActivityAt = Date.now();
  session.expiresAt = Date.now() + AUTH.TOKEN_EXPIRY_MS;
  var refreshedJson = safeStringify_(session);
  var cacheTtlSeconds = Math.min(Math.round(AUTH.TOKEN_EXPIRY_MS / 1000), 21600);
  cache.put(AUTH.SESSION_CACHE_PREFIX + token, refreshedJson, cacheTtlSeconds);
  // Update per-user session index (B-04)
  registerSessionIndex_(session.userId, token);

  // Return user info
  return {
    id:       session.userId,
    username: session.username,
    role:     session.role
  };
}

/**
 * Validate user token and check permission.
 *
 * @param {Object} headers - Request headers
 * @param {string} permission - Required permission ('read', 'write', 'control', 'users', 'config')
 * @returns {Object} { authorized: Boolean, user: Object|null, error: String|null }
 */
function requirePermission_(headers, permission) {
  var user = validateUserToken_(headers);

  if (!user) {
    return {
      authorized: false,
      user: null,
      error: 'Authentication required. Please login first.',
      code: 401
    };
  }

  var permissions = ROLE_PERMISSIONS[user.role] || [];
  if (permissions.indexOf(permission) === -1) {
    return {
      authorized: false,
      user: user,
      error: 'Insufficient permissions. Required: ' + permission + ', Role: ' + user.role,
      code: 403
    };
  }

  return { authorized: true, user: user, error: null };
}

/**
 * Require admin role for sensitive operations.
 *
 * @param {Object} headers - Request headers
 * @returns {Object} { authorized: Boolean, user: Object|null, error: String|null }
 */
function requireAdmin_(headers) {
  return requirePermission_(headers, 'users');
}

// ============================================================
// PASSWORD HASHING (PBKDF2-like key stretching)
// ============================================================

/**
 * Hash a password using salted PBKDF2-like key stretching.
 * Performs 1000 rounds of SHA-256 for brute-force resistance.
 * Generates a random 16-char salt if none provided.
 * Returns format: "salt:hash" (hash is hex-encoded).
 *
 * @param {string} password - Plain text password
 * @param {string} [salt] - Optional salt (auto-generated if omitted)
 * @returns {string} Salt and hex-encoded SHA-256 hash ("salt:hash")
 */
function hashPassword_(password, salt) {
  if (!salt) salt = Utilities.getUuid().substring(0, 16);

  // PBKDF2-like key stretching: iterate SHA-256 for AUTH.HASH_ROUNDS rounds
  var data = salt + password;
  for (var round = 0; round < AUTH.HASH_ROUNDS; round++) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data);
    var hex = '';
    for (var j = 0; j < bytes.length; j++) {
      var h = bytes[j].toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    // Feed the hex digest back as input for the next round
    data = hex;
  }

  return salt + ':' + data;
}

/**
 * Verify a password against a stored hash.
 * Supports both salted ("salt:hash") and legacy unsalted hashes for migration.
 * For salted hashes, applies the same PBKDF2-like stretching as hashPassword_().
 * Legacy unsalted hashes are verified directly; on success the caller should
 * upgrade them to salted hashes via hashPassword_(password).
 *
 * @param {string} password - Plain text password to verify
 * @param {string} storedHash - Stored hash (either "salt:hash" or plain hex hash)
 * @returns {boolean} True if password matches
 */
function verifyPassword_(password, storedHash) {
  if (!storedHash || storedHash.indexOf(':') === -1) {
    // Legacy unsalted hash — verify directly and upgrade on success
    // SECURITY: Use timing-safe comparison for legacy hash verification
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    return compareHashes_(hex, storedHash);
  }

  // Salted hash: extract salt and compute stretched hash
  var parts = storedHash.split(':');
  var salt = parts[0];
  var hash = parts.slice(1).join(':');

  // Compute the same PBKDF2-like stretched hash
  var computed = hashPassword_(password, salt);
  var computedHash = computed.substring(salt.length + 1); // Strip "salt:" prefix

  // SECURITY: Use timing-safe comparison
  return compareHashes_(computedHash, hash);
}

/**
 * Generate the default admin password hash for initial setup.
 * Uses a default password that should be changed immediately after setup.
 *
 * @returns {string} Stretched salted hash of the default password
 */
function getDefaultAdminPasswordHash_() {
  return hashPassword_(DEFAULT_ADMIN_PASSWORD || 'changeme_immediately');
}

/**
 * Compare two strings in constant time to prevent timing attacks.
 * Used for token and hash comparisons where timing could reveal information.
 *
 * If strings have different lengths, comparison still runs in O(min(len_a, len_b))
 * to avoid leaking length information via timing.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function compareHashes_(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) {
    // Still do a comparison to avoid short-circuit timing leak on length
    var fakeResult = 0;
    var minLen = Math.min(a.length, b.length);
    for (var k = 0; k < minLen; k++) {
      fakeResult |= a.charCodeAt(k) ^ b.charCodeAt(k);
    }
    return false; // Different lengths, definitely not equal
  }
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================
// TOKEN GENERATION
// ============================================================

/**
 * Generate a cryptographically random session token.
 *
 * @returns {string} Random 64-character hex token
 */
function generateSessionToken_() {
  var bytes = Utilities.getRandomValues(AUTH.TOKEN_LENGTH / 2);
  return bytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// ============================================================
// LOGOUT (invalidate session)
// ============================================================

/**
 * Invalidate a user session token.
 *
 * @param {Object} headers - Request headers
 * @returns {boolean} True if token was found and removed
 */
function logoutUser_(headers) {
  // Support both Authorization: Bearer and X-Auth-Token
  var authHeader = headers['Authorization'] || headers['authorization'] || null;
  var token = null;

  if (authHeader) {
    var parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    token = headers['X-Auth-Token'] || headers['x-auth-token'] || null;
  }

  if (!token) return false;
  var cache = CacheService.getScriptCache();

  var existing = cache.get(AUTH.SESSION_CACHE_PREFIX + token);
  if (existing) {
    cache.remove(AUTH.SESSION_CACHE_PREFIX + token);
    return true;
  }

  return false;
}

// ============================================================
// INVALIDATE SPECIFIC USER SESSIONS
// ============================================================

/**
 * Register a session token in the per-user session index cache.
 * B-04: Tracks session keys per userId for efficient invalidation.
 *
 * T3-BE-023: If the token list exceeds 10 entries, the oldest tokens are
 * silently trimmed from the front of the array. This means old sessions
 * may remain in CacheService until their natural TTL expires, but they
 * cannot be efficiently invalidated by userId. This is an acceptable
 * trade-off for keeping the per-user index cache entry small.
 *
 * @param {string} userId - The user ID
 * @param {string} token - The session token
 */
function registerSessionIndex_(userId, token) {
  if (!userId || !token) return;
  var cache = CacheService.getScriptCache();
  var indexKey = AUTH.SESSION_INDEX_PREFIX + userId;
  var existing = cache.get(indexKey);
  var tokens = [];
  if (existing) {
    try { tokens = JSON.parse(existing); } catch (e) { tokens = []; }
  }
  // Add token if not already tracked (max 10 sessions per user)
  if (tokens.indexOf(token) === -1) {
    tokens.push(token);
    if (tokens.length > 10) tokens = tokens.slice(tokens.length - 10);
  }
  cache.put(indexKey, JSON.stringify(tokens), Math.round(AUTH.TOKEN_EXPIRY_MS / 1000));
}

/**
 * Invalidate all sessions belonging to a specific user (by userId).
 * B-04: Uses a dedicated cache key per userId for O(1) lookup
 * instead of scanning all cache keys.
 *
 * @param {string} userId - The user ID whose sessions should be invalidated
 */
function invalidateUserSessions_(userId) {
  if (!userId) return;

  var cache = CacheService.getScriptCache();
  var indexKey = AUTH.SESSION_INDEX_PREFIX + userId;
  var existing = cache.get(indexKey);
  var tokens = [];
  if (existing) {
    try { tokens = JSON.parse(existing); } catch (e) { tokens = []; }
  }

  // Build keys to remove from the tracked tokens
  var keysToRemove = [];
  for (var i = 0; i < tokens.length; i++) {
    keysToRemove.push(AUTH.SESSION_CACHE_PREFIX + tokens[i]);
  }

  if (keysToRemove.length > 0) {
    cache.removeAll(keysToRemove);
    console.log('Auth: Invalidated ' + keysToRemove.length + ' session(s) for user "' + userId + '"');
  }

  // Remove the index entry itself
  cache.remove(indexKey);
}

// ============================================================
// CONFIG HELPER (used internally)
// ============================================================

/**
 * Read a configuration value by key from the configurations sheet.
 *
 * @param {string} key - Configuration key
 * @returns {string|null} Configuration value or null if not found
 */
var _configCache_ = null;
var _configCacheTime_ = 0;

function getConfigValue_(key) {
  var now = Date.now();
  if (!_configCache_ || now - _configCacheTime_ > 60000) {
    _configCache_ = {};
    var ss = getSpreadsheet_();
    var sheet = ss.getSheetByName(SHEET.CONFIGURATIONS);
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var colKey = headers.indexOf('key');
    var colValue = headers.indexOf('value');
    if (colKey === -1 || colValue === -1) return null;
    for (var i = 1; i < data.length; i++) {
      var configKey = String(data[i][colKey]);
      // T3-BE-026: Skip reserved keys to prevent prototype pollution
      var RESERVED = ['__proto__', 'constructor', 'hasOwnProperty'];
      if (RESERVED.indexOf(configKey) !== -1) continue;
      _configCache_[configKey] = String(data[i][colValue]);
    }
    _configCacheTime_ = now;
  }
  return _configCache_.hasOwnProperty(key) ? _configCache_[key] : null;
}
