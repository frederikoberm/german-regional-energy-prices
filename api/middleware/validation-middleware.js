/**
 * Validation Middleware for API Routes
 * Validates PLZ, year, month, and other common parameters
 */

const { formatError } = require('../utils/response-formatter');

/**
 * Validate German PLZ (postal code)
 * Must be 5 digits
 */
function validatePLZ(req, res, next) {
    const { plz } = req.params;
    
    // Check if PLZ is provided
    if (!plz) {
        return res.status(400).json(formatError(
            'PLZ (postal code) is required',
            'VALIDATION_ERROR',
            { field: 'plz', value: plz }
        ));
    }
    
    // Validate PLZ format (5 digits)
    const plzRegex = /^\d{5}$/;
    if (!plzRegex.test(plz)) {
        return res.status(400).json(formatError(
            'PLZ must be exactly 5 digits',
            'VALIDATION_ERROR',
            { field: 'plz', value: plz, expected_format: '12345' }
        ));
    }
    
    // Add to request for downstream use
    req.validatedPLZ = plz;
    next();
}

/**
 * Validate year and month parameters
 */
function validateYearMonth(req, res, next) {
    const { year, month } = req.params;
    
    // Validate year
    const yearNum = parseInt(year);
    const currentYear = new Date().getFullYear();
    
    if (!year || isNaN(yearNum)) {
        return res.status(400).json(formatError(
            'Year must be a valid number',
            'VALIDATION_ERROR',
            { field: 'year', value: year }
        ));
    }
    
    if (yearNum < 2020 || yearNum > currentYear + 1) {
        return res.status(400).json(formatError(
            `Year must be between 2020 and ${currentYear + 1}`,
            'VALIDATION_ERROR',
            { field: 'year', value: year, min: 2020, max: currentYear + 1 }
        ));
    }
    
    // Validate month
    const monthNum = parseInt(month);
    
    if (!month || isNaN(monthNum)) {
        return res.status(400).json(formatError(
            'Month must be a valid number',
            'VALIDATION_ERROR',
            { field: 'month', value: month }
        ));
    }
    
    if (monthNum < 1 || monthNum > 12) {
        return res.status(400).json(formatError(
            'Month must be between 1 and 12',
            'VALIDATION_ERROR',
            { field: 'month', value: month, min: 1, max: 12 }
        ));
    }
    
    // Check if the date is not in the future
    const requestDate = new Date(yearNum, monthNum - 1, 1);
    const currentDate = new Date();
    currentDate.setDate(1); // Set to first of current month for comparison
    
    if (requestDate > currentDate) {
        return res.status(400).json(formatError(
            'Cannot request data for future months',
            'VALIDATION_ERROR',
            { 
                requested_date: `${year}-${month}`,
                current_date: `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`
            }
        ));
    }
    
    // Add validated values to request
    req.validatedYear = yearNum;
    req.validatedMonth = monthNum;
    next();
}

/**
 * Validate month in request body (for POST requests)
 */
function validateMonth(req, res, next) {
    const { year, month } = req.body;
    
    // Check if year and month are provided
    if (!year || !month) {
        return res.status(400).json(formatError(
            'Year and month are required in request body',
            'VALIDATION_ERROR',
            { provided: { year, month } }
        ));
    }
    
    // Validate year
    const yearNum = parseInt(year);
    const currentYear = new Date().getFullYear();
    
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > currentYear + 1) {
        return res.status(400).json(formatError(
            `Year must be between 2020 and ${currentYear + 1}`,
            'VALIDATION_ERROR',
            { field: 'year', value: year, min: 2020, max: currentYear + 1 }
        ));
    }
    
    // Validate month
    const monthNum = parseInt(month);
    
    if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        return res.status(400).json(formatError(
            'Month must be between 1 and 12',
            'VALIDATION_ERROR',
            { field: 'month', value: month, min: 1, max: 12 }
        ));
    }
    
    // Check if the date is not in the future
    const requestDate = new Date(yearNum, monthNum - 1, 1);
    const currentDate = new Date();
    currentDate.setDate(1);
    
    if (requestDate > currentDate) {
        return res.status(400).json(formatError(
            'Cannot request data for future months',
            'VALIDATION_ERROR',
            { 
                requested_date: `${year}-${month}`,
                current_date: `${currentDate.getFullYear()}-${currentDate.getMonth() + 1}`
            }
        ));
    }
    
    // Add validated values to request
    req.validatedYear = yearNum;
    req.validatedMonth = monthNum;
    next();
}

/**
 * Validate API key format (for future authentication)
 */
function validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    
    if (!apiKey) {
        return res.status(401).json(formatError(
            'API key is required',
            'AUTHENTICATION_ERROR',
            { hint: 'Provide API key in X-API-Key header or apiKey query parameter' }
        ));
    }
    
    // Basic format validation (adjust as needed)
    if (apiKey.length < 32 || !/^[a-zA-Z0-9-_]+$/.test(apiKey)) {
        return res.status(401).json(formatError(
            'Invalid API key format',
            'AUTHENTICATION_ERROR'
        ));
    }
    
    req.apiKey = apiKey;
    next();
}

/**
 * Validate pagination parameters
 */
function validatePagination(req, res, next) {
    const { page = 1, limit = 50 } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json(formatError(
            'Page must be a positive integer',
            'VALIDATION_ERROR',
            { field: 'page', value: page }
        ));
    }
    
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
        return res.status(400).json(formatError(
            'Limit must be between 1 and 1000',
            'VALIDATION_ERROR',
            { field: 'limit', value: limit, min: 1, max: 1000 }
        ));
    }
    
    req.pagination = {
        page: pageNum,
        limit: limitNum,
        offset: (pageNum - 1) * limitNum
    };
    
    next();
}

/**
 * Validate coordinates (latitude, longitude)
 */
function validateCoordinates(req, res, next) {
    const { latitude, longitude } = req.query;
    
    if (latitude !== undefined) {
        const lat = parseFloat(latitude);
        if (isNaN(lat) || lat < -90 || lat > 90) {
            return res.status(400).json(formatError(
                'Latitude must be between -90 and 90',
                'VALIDATION_ERROR',
                { field: 'latitude', value: latitude, min: -90, max: 90 }
            ));
        }
        req.latitude = lat;
    }
    
    if (longitude !== undefined) {
        const lng = parseFloat(longitude);
        if (isNaN(lng) || lng < -180 || lng > 180) {
            return res.status(400).json(formatError(
                'Longitude must be between -180 and 180',
                'VALIDATION_ERROR',
                { field: 'longitude', value: longitude, min: -180, max: 180 }
            ));
        }
        req.longitude = lng;
    }
    
    next();
}

module.exports = {
    validatePLZ,
    validateYearMonth,
    validateMonth,
    validateApiKey,
    validatePagination,
    validateCoordinates
}; 