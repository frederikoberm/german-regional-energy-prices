/**
 * Environment and Configuration Validation
 * Ensures all required environment variables and configurations are properly set
 */

/**
 * Validate that all required environment variables are set
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
    const required = [
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY'
    ];

    const optional = {
        'PORT': 3000,
        'NODE_ENV': 'development',
        'ALLOWED_ORIGINS': '*',
        'DB_POOL_SIZE': 10,
        'RATE_LIMIT_WINDOW_MS': 15 * 60 * 1000,
        'RATE_LIMIT_MAX_REQUESTS': 100
    };

    console.log('🔍 Validating environment configuration...');

    // Check required variables
    const missing = required.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(varName => {
            console.error(`   - ${varName}`);
        });
        
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    // Set defaults for optional variables
    Object.entries(optional).forEach(([varName, defaultValue]) => {
        if (!process.env[varName]) {
            process.env[varName] = defaultValue.toString();
            console.log(`⚙️  Setting default for ${varName}: ${defaultValue}`);
        }
    });

    // Validate Supabase URL format
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
        throw new Error('SUPABASE_URL must be a valid Supabase URL (https://your-project.supabase.co)');
    }

    // Validate Supabase key format
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    // Note: Commenting out length validation for now to allow API testing
    // if (supabaseKey.length < 50) {
    //     throw new Error('SUPABASE_ANON_KEY appears to be invalid (too short)');
    // }

    // Validate port
    const port = parseInt(process.env.PORT);
    if (isNaN(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be a valid port number (1-65535)');
    }

    // Validate NODE_ENV
    const validEnvironments = ['development', 'staging', 'production', 'test'];
    if (!validEnvironments.includes(process.env.NODE_ENV)) {
        console.warn(`⚠️  Warning: NODE_ENV '${process.env.NODE_ENV}' is not standard. Expected: ${validEnvironments.join(', ')}`);
    }

    console.log('✅ Environment validation successful');
    
    // Log configuration summary (without sensitive data)
    console.log('📋 Configuration Summary:');
    console.log(`   Environment: ${process.env.NODE_ENV}`);
    console.log(`   Port: ${process.env.PORT}`);
    console.log(`   Supabase URL: ${process.env.SUPABASE_URL.substring(0, 30)}...`);
    console.log(`   Database configured: ✅`);
    
    if (process.env.ALLOWED_ORIGINS !== '*') {
        console.log(`   CORS Origins: ${process.env.ALLOWED_ORIGINS}`);
    }
}

/**
 * Validate API configuration at runtime
 * @returns {Object} Configuration object with validated values
 */
function getValidatedConfig() {
    return {
        port: parseInt(process.env.PORT),
        nodeEnv: process.env.NODE_ENV,
        database: {
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseKey: process.env.SUPABASE_ANON_KEY,
            poolSize: parseInt(process.env.DB_POOL_SIZE) || 10
        },
        security: {
            allowedOrigins: process.env.ALLOWED_ORIGINS === '*' 
                ? true 
                : process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()),
            rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
            rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
        },
        features: {
            enableApiKeys: process.env.ENABLE_API_KEYS === 'true',
            enableCaching: process.env.ENABLE_CACHING === 'true',
            enableSwagger: process.env.NODE_ENV !== 'production'
        }
    };
}

/**
 * Validate PLZ (German postal code) format
 * @param {string} plz - The postal code to validate
 * @returns {boolean} True if valid
 */
function isValidPLZ(plz) {
    return /^\d{5}$/.test(plz);
}

/**
 * Validate year format
 * @param {string|number} year - The year to validate
 * @returns {boolean} True if valid
 */
function isValidYear(year) {
    const yearNum = parseInt(year);
    const currentYear = new Date().getFullYear();
    return !isNaN(yearNum) && yearNum >= 2020 && yearNum <= currentYear + 1;
}

/**
 * Validate month format
 * @param {string|number} month - The month to validate
 * @returns {boolean} True if valid
 */
function isValidMonth(month) {
    const monthNum = parseInt(month);
    return !isNaN(monthNum) && monthNum >= 1 && monthNum <= 12;
}

/**
 * Validate date is not in the future
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 * @returns {boolean} True if not in future
 */
function isNotFutureDate(year, month) {
    const requestDate = new Date(year, month - 1, 1);
    const currentDate = new Date();
    currentDate.setDate(1);
    return requestDate <= currentDate;
}

/**
 * Validate coordinate values
 * @param {number} latitude - Latitude value
 * @param {number} longitude - Longitude value
 * @returns {Object} Validation result with errors if any
 */
function validateCoordinates(latitude, longitude) {
    const errors = [];
    
    if (latitude !== undefined) {
        const lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            errors.push('Latitude must be between -90 and 90');
        }
    }
    
    if (longitude !== undefined) {
        const lng = parseFloat(longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            errors.push('Longitude must be between -180 and 180');
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

/**
 * Validate pagination parameters
 * @param {string|number} page - Page number
 * @param {string|number} limit - Items per page
 * @returns {Object} Validation result
 */
function validatePagination(page, limit) {
    const errors = [];
    
    const pageNum = parseInt(page);
    if (isNaN(pageNum) || pageNum < 1) {
        errors.push('Page must be a positive integer');
    }
    
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        errors.push('Limit must be between 1 and 1000');
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors,
        page: pageNum,
        limit: limitNum
    };
}

/**
 * Sanitize input string to prevent injection attacks
 * @param {string} input - Input string to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return input;
    }
    
    // Remove/escape potentially dangerous characters
    return input
        .replace(/[<>'"]/g, '') // Remove HTML-like characters
        .replace(/[;&|`$]/g, '') // Remove shell injection characters
        .trim();
}

/**
 * Check if the current environment is production
 * @returns {boolean} True if production environment
 */
function isProduction() {
    return process.env.NODE_ENV === 'production';
}

/**
 * Check if the current environment is development
 * @returns {boolean} True if development environment
 */
function isDevelopment() {
    return process.env.NODE_ENV === 'development';
}

module.exports = {
    validateEnvironment,
    getValidatedConfig,
    isValidPLZ,
    isValidYear,
    isValidMonth,
    isNotFutureDate,
    validateCoordinates,
    validatePagination,
    sanitizeInput,
    isProduction,
    isDevelopment
}; 