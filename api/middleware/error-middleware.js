/**
 * Error Handling Middleware
 * Centralized error handling for the API
 */

const { formatError } = require('../utils/response-formatter');

/**
 * Handle 404 Not Found errors
 */
function notFoundHandler(req, res, next) {
    res.status(404).json(formatError(
        `Endpoint ${req.method} ${req.path} not found`,
        'NOT_FOUND',
        {
            method: req.method,
            path: req.path,
            available_endpoints: [
                'GET /health',
                'GET /api/v1/price/{plz}/{year}/{month}',
                'GET /api/v1/price/{plz}/latest',
                'GET /api/v1/average/{year}/{month}',
                'GET /api/v1/coverage/{year}/{month}',
                'GET /api/v1/months',
                'POST /api/v1/price/bulk'
            ]
        }
    ));
}

/**
 * Global error handler
 * Handles all uncaught errors in the application
 */
function errorHandler(error, req, res, next) {
    // Log the error for debugging
    console.error('🚨 API Error:', {
        message: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        body: req.body,
        params: req.params,
        query: req.query,
        timestamp: new Date().toISOString()
    });

    // Supabase/PostgreSQL errors
    if (error.code && error.code.startsWith('PG')) {
        return handleDatabaseError(error, req, res);
    }

    // Validation errors
    if (error.name === 'ValidationError') {
        return res.status(400).json(formatError(
            'Validation failed',
            'VALIDATION_ERROR',
            { details: error.details }
        ));
    }

    // Syntax errors (malformed JSON, etc.)
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        return res.status(400).json(formatError(
            'Invalid JSON in request body',
            'SYNTAX_ERROR'
        ));
    }

    // Authentication/Authorization errors
    if (error.name === 'UnauthorizedError' || error.status === 401) {
        return res.status(401).json(formatError(
            'Authentication required',
            'AUTHENTICATION_ERROR'
        ));
    }

    if (error.name === 'ForbiddenError' || error.status === 403) {
        return res.status(403).json(formatError(
            'Access denied',
            'AUTHORIZATION_ERROR'
        ));
    }

    // Rate limiting errors
    if (error.status === 429) {
        return res.status(429).json(formatError(
            'Too many requests',
            'RATE_LIMIT_ERROR',
            { retryAfter: error.retryAfter }
        ));
    }

    // Default to 500 Internal Server Error
    const statusCode = error.status || error.statusCode || 500;
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(statusCode).json(formatError(
        isDevelopment ? error.message : 'Internal server error',
        'INTERNAL_ERROR',
        isDevelopment ? { 
            stack: error.stack,
            originalError: error.name 
        } : undefined
    ));
}

/**
 * Handle database-specific errors
 */
function handleDatabaseError(error, req, res) {
    console.error('💾 Database Error:', error);

    // Connection errors
    if (error.code === 'PGRST301' || error.message.includes('connection')) {
        return res.status(503).json(formatError(
            'Database connection failed',
            'DATABASE_CONNECTION_ERROR',
            { hint: 'Please try again later' }
        ));
    }

    // No rows found (handled specifically in routes, but as fallback)
    if (error.code === 'PGRST116') {
        return res.status(404).json(formatError(
            'No data found',
            'NOT_FOUND'
        ));
    }

    // Invalid query
    if (error.code === 'PGRST102' || error.code === 'PGRST103') {
        return res.status(400).json(formatError(
            'Invalid query parameters',
            'INVALID_QUERY',
            { hint: 'Check your request parameters' }
        ));
    }

    // Permission denied
    if (error.code === 'PGRST301' || error.message.includes('permission')) {
        return res.status(403).json(formatError(
            'Database access denied',
            'DATABASE_PERMISSION_ERROR'
        ));
    }

    // Generic database error
    return res.status(500).json(formatError(
        'Database operation failed',
        'DATABASE_ERROR',
        process.env.NODE_ENV === 'development' ? { 
            originalError: error.message,
            code: error.code 
        } : undefined
    ));
}

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors automatically
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Request timeout middleware
 */
function timeoutHandler(timeoutMs = 30000) {
    return (req, res, next) => {
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                res.status(408).json(formatError(
                    'Request timeout',
                    'TIMEOUT_ERROR',
                    { timeout: `${timeoutMs}ms` }
                ));
            }
        }, timeoutMs);

        res.on('finish', () => {
            clearTimeout(timeout);
        });

        res.on('close', () => {
            clearTimeout(timeout);
        });

        next();
    };
}

/**
 * CORS error handler
 */
function corsErrorHandler(req, res, next) {
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, X-API-Key');
        res.status(200).end();
    } else {
        next();
    }
}

module.exports = {
    notFoundHandler,
    errorHandler,
    handleDatabaseError,
    asyncHandler,
    timeoutHandler,
    corsErrorHandler
}; 