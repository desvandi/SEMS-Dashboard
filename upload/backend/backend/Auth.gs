/**
 * Auth.gs — Authentication & Authorization
 * =========================================
 * Handles two authentication methods:
 *   1. Device Token Auth — ESP32 sends X-Device-Token header
 *   2. User Auth — Frontend sends Bearer token via Authorization header
 *
 * Uses CacheService for session storage and Config sheet for token storage.
 */

// ============================================================
// DEVICE TOKEN AUTHENTICATION
// ============================================================

/**
 * Validate the ESP32 device token from request headers.
 * Token is stored in configurations sheet (key: "device_token").
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

  if (providedToken !== storedToken) {
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
 * Password is hashed with SHA-256 and compared to stored hash.
 *
 * @param {string} username - Login username
 * @param {string} password - Login password (plaintext)
 * @returns {Object} { success: Boolean, token: String|null, user: Object|null, error: String|null }
 */
function authenticateUser_(username, password) {
  if (!username || !password) {
    return {
      success: false,
      token: null,
      user: null,
      error: 'Username and password are required.'
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
      error: 'Users sheet not found. Run setup first.'
    };
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // Find column indices
  var colId        = headers.indexOf('id');
  var colUsername  = headers.indexOf('username');
  var colPassHash  = headers.indexOf('password_hash');
  var colRole      = headers.indexOf('role');
  var colActive    = headers.indexOf('active');

  if (colId === -1 || colUsername === -1 || colPassHash === -1 ||
      colRole === -1 || colActive === -1) {
    return {
      success: false,
      token: null,
      user: null,
      error: 'Users sheet has invalid structure.'
    };
  }

  // Verify password using salted hash (with legacy migration support)
  var inputHash = hashPassword_(password);

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
          error: 'Account is disabled. Contact administrator.'
        };
      }

      // Verify using verifyPassword_ (supports both salted and legacy unsalted hashes)
      if (verifyPassword_(password, rowHash)) {

        // Legacy migration: upgrade unsalted hash to salted hash on successful login
        if (rowHash.indexOf(':') === -1) {
          var newHash = hashPassword_(password);
          sheet.getRange(i + 1, colPassHash + 1).setValue(newHash);
          console.log('Auth: Upgraded legacy password hash for user "' + username + '"');
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
        var sessionData = safeStringify_({
          userId:  user.id,
          username: user.username,
          role:    user.role,
          createdAt: Date.now(),
          expiresAt: Date.now() + AUTH.TOKEN_EXPIRY_MS
        });

        CacheService.getScriptCache()
          .put(AUTH.SESSION_CACHE_PREFIX + token, sessionData, Math.round(AUTH.TOKEN_EXPIRY_MS / 1000));

        console.log('Auth: User "' + username + '" logged in successfully');

        return {
          success: true,
          token: token,
          user: user,
          error: null
        };
      } else {
        console.warn('Auth: Failed login attempt for user "' + username + '"');
        return {
          success: false,
          token: null,
          user: null,
          error: 'Invalid username or password.'
        };
      }
    }
  }

  return {
    success: false,
    token: null,
    user: null,
    error: 'Invalid username or password.'
  };
}

// ============================================================
// SESSION VALIDATION
// ============================================================

/**
 * Validate a user session token from the Authorization header.
 * Returns user info if valid, null otherwise.
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

  // Check expiry
  if (Date.now() > session.expiresAt) {
    // Remove expired session
    cache.remove(AUTH.SESSION_CACHE_PREFIX + token);
    return null;
  }

  // Sliding window session refresh: if the session is less than halfway to expiry,
  // re-extend the TTL to the full TOKEN_EXPIRY_MS. This means active users stay
  // logged in indefinitely as long as they make a request at least once per
  // TOKEN_EXPIRY_MS / 2 interval. After that window closes without activity,
  // the session expires naturally.
  var age = Date.now() - session.createdAt;
  if (age < AUTH.TOKEN_EXPIRY_MS / 2) {
    cache.put(AUTH.SESSION_CACHE_PREFIX + token, sessionJson, Math.round(AUTH.TOKEN_EXPIRY_MS / 1000));
  }

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
// PASSWORD HASHING
// ============================================================

/**
 * Hash a password using salted SHA-256.
 * Generates a random 16-char salt if none provided.
 * Returns format: "salt:hash"
 *
 * @param {string} password - Plain text password
 * @param {string} [salt] - Optional salt (auto-generated if omitted)
 * @returns {string} Salt and hex-encoded SHA-256 hash ("salt:hash")
 */
function hashPassword_(password, salt) {
  if (!salt) salt = Utilities.getUuid().substring(0, 16);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
  var hash = '';
  for (var i = 0; i < bytes.length; i++) {
    var hex = bytes[i].toString(16);
    hash += (hex.length === 1 ? '0' : '') + hex;
  }
  return salt + ':' + hash;
}

/**
 * Verify a password against a stored hash.
 * Supports both salted ("salt:hash") and legacy unsalted hashes for migration.
 * Legacy unsalted hashes are verified directly; on success the caller should
 * upgrade them to salted hashes via hashPassword_(password).
 *
 * @param {string} password - Plain text password to verify
 * @param {string} storedHash - Stored hash (either "salt:hash" or plain hex hash)
 * @returns {boolean} True if password matches
 */
function verifyPassword_(password, storedHash) {
  if (!storedHash || storedHash.indexOf(':') === -1) {
    // Legacy unsalted hash - verify directly and upgrade on success
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    return hex === storedHash;
  }
  var parts = storedHash.split(':');
  var salt = parts[0];
  var hash = parts.slice(1).join(':');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password);
  var computed = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    computed += (h.length === 1 ? '0' : '') + h;
  }
  return computed === hash;
}

/**
 * Generate the default admin password hash for initial setup.
 * Uses a default password that should be changed immediately after setup.
 *
 * @returns {string} SHA-256 hash of the default password
 */
function getDefaultAdminPasswordHash_() {
  return hashPassword_(DEFAULT_ADMIN_PASSWORD || 'changeme_immediately');
}

/**
 * Compare two hash strings (basic timing-safe comparison).
 *
 * @param {string} a - First hash
 * @param {string} b - Second hash
 * @returns {boolean} True if equal
 */
function compareHashes_(a, b) {
  if (a.length !== b.length) return false;
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
      _configCache_[String(data[i][colKey])] = String(data[i][colValue]);
    }
    _configCacheTime_ = now;
  }
  return _configCache_.hasOwnProperty(key) ? _configCache_[key] : null;
}
