/**
 * Response Formatting Utilities
 * Ensures consistent API response format across all endpoints
 */

/**
 * Format successful API response
 * @param {any} data - The response data
 * @param {string} message - Success message
 * @param {Object} metadata - Additional metadata
 * @returns {Object} Formatted response
 */
function formatResponse(data, message = 'Success', metadata = {}) {
    return {
        success: true,
        message: message,
        data: data,
        metadata: {
            timestamp: new Date().toISOString(),
            ...metadata
        }
    };
}

/**
 * Format error response
 * @param {string} message - Error message
 * @param {string} code - Error code for programmatic handling
 * @param {Object} details - Additional error details
 * @returns {Object} Formatted error response
 */
function formatError(message, code = 'UNKNOWN_ERROR', details = null) {
    const errorResponse = {
        success: false,
        error: {
            message: message,
            code: code,
            timestamp: new Date().toISOString()
        }
    };

    if (details) {
        errorResponse.error.details = details;
    }

    return errorResponse;
}

/**
 * Format paginated response
 * @param {Array} data - Array of data items
 * @param {Object} pagination - Pagination info
 * @param {string} message - Success message
 * @returns {Object} Formatted paginated response
 */
function formatPaginatedResponse(data, pagination, message = 'Data retrieved successfully') {
    return {
        success: true,
        message: message,
        data: data,
        pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: pagination.total,
            totalPages: Math.ceil(pagination.total / pagination.limit),
            hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
            hasPrev: pagination.page > 1
        },
        metadata: {
            timestamp: new Date().toISOString(),
            count: data.length
        }
    };
}

/**
 * Format bulk operation response
 * @param {Array} successItems - Successfully processed items
 * @param {Array} failedItems - Failed items with error details
 * @param {string} message - Overall message
 * @returns {Object} Formatted bulk response
 */
function formatBulkResponse(successItems, failedItems = [], message = 'Bulk operation completed') {
    const totalRequested = successItems.length + failedItems.length;
    const successRate = totalRequested > 0 ? (successItems.length / totalRequested * 100).toFixed(2) : 0;

    return {
        success: failedItems.length === 0,
        message: message,
        data: {
            successful: successItems,
            failed: failedItems
        },
        summary: {
            total_requested: totalRequested,
            successful_count: successItems.length,
            failed_count: failedItems.length,
            success_rate: `${successRate}%`
        },
        metadata: {
            timestamp: new Date().toISOString()
        }
    };
}

/**
 * Format statistics response
 * @param {Object} stats - Statistics data
 * @param {string} message - Success message
 * @param {Object} period - Time period info
 * @returns {Object} Formatted statistics response
 */
function formatStatsResponse(stats, message = 'Statistics calculated successfully', period = null) {
    return {
        success: true,
        message: message,
        data: stats,
        metadata: {
            timestamp: new Date().toISOString(),
            calculation_period: period,
            generated_at: new Date().toISOString()
        }
    };
}

/**
 * Format health check response
 * @param {Object} healthData - Health check data
 * @param {boolean} isHealthy - Overall health status
 * @returns {Object} Formatted health response
 */
function formatHealthResponse(healthData, isHealthy = true) {
    return {
        success: isHealthy,
        status: isHealthy ? 'healthy' : 'unhealthy',
        data: healthData,
        metadata: {
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory_usage: process.memoryUsage(),
            node_version: process.version
        }
    };
}

/**
 * Format validation error response
 * @param {Array} validationErrors - Array of validation errors
 * @returns {Object} Formatted validation error response
 */
function formatValidationError(validationErrors) {
    return formatError(
        'Validation failed',
        'VALIDATION_ERROR',
        {
            errors: validationErrors,
            count: validationErrors.length
        }
    );
}

/**
 * Format cache response with cache metadata
 * @param {any} data - The cached or fresh data
 * @param {string} message - Success message
 * @param {Object} cacheInfo - Cache metadata
 * @returns {Object} Formatted response with cache info
 */
function formatCachedResponse(data, message = 'Success', cacheInfo = {}) {
    return {
        success: true,
        message: message,
        data: data,
        cache: {
            hit: cacheInfo.hit || false,
            ttl: cacheInfo.ttl || null,
            key: cacheInfo.key || null
        },
        metadata: {
            timestamp: new Date().toISOString(),
            cached_at: cacheInfo.cachedAt || null
        }
    };
}

/**
 * Sanitize sensitive data from responses
 * @param {Object} data - Data to sanitize
 * @param {Array} sensitiveFields - Fields to remove/mask
 * @returns {Object} Sanitized data
 */
function sanitizeResponse(data, sensitiveFields = ['password', 'token', 'secret', 'key']) {
    if (!data || typeof data !== 'object') {
        return data;
    }

    const sanitized = { ...data };
    
    sensitiveFields.forEach(field => {
        if (field in sanitized) {
            sanitized[field] = '[REDACTED]';
        }
    });

    // Recursively sanitize nested objects
    Object.keys(sanitized).forEach(key => {
        if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeResponse(sanitized[key], sensitiveFields);
        }
    });

    return sanitized;
}

/**
 * Add performance timing to response
 * @param {Object} response - Existing response object
 * @param {number} startTime - Request start time (Date.now())
 * @returns {Object} Response with timing information
 */
function addTimingInfo(response, startTime) {
    const duration = Date.now() - startTime;
    
    if (!response.metadata) {
        response.metadata = {};
    }
    
    response.metadata.processing_time_ms = duration;
    response.metadata.performance = {
        fast: duration < 100,
        medium: duration >= 100 && duration < 500,
        slow: duration >= 500
    };

    return response;
}

/**
 * Format API key response (for authentication endpoints)
 * @param {Object} keyData - API key data
 * @param {boolean} includeSecret - Whether to include the actual key
 * @returns {Object} Formatted API key response
 */
function formatApiKeyResponse(keyData, includeSecret = false) {
    const response = {
        id: keyData.id,
        name: keyData.name,
        created_at: keyData.created_at,
        last_used: keyData.last_used,
        is_active: keyData.is_active,
        usage_count: keyData.usage_count || 0,
        rate_limit: keyData.rate_limit
    };

    if (includeSecret) {
        response.api_key = keyData.key;
        response.warning = 'Store this key securely. It will not be shown again.';
    }

    return formatResponse(response, 'API key information retrieved successfully');
}

module.exports = {
    formatResponse,
    formatError,
    formatPaginatedResponse,
    formatBulkResponse,
    formatStatsResponse,
    formatHealthResponse,
    formatValidationError,
    formatCachedResponse,
    sanitizeResponse,
    addTimingInfo,
    formatApiKeyResponse
}; 