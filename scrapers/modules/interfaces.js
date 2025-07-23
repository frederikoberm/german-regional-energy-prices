/**
 * Core Interfaces for Modular Scraper Architecture
 * Defines contracts that all modules must implement
 */

/**
 * Base Source Adapter Interface
 * All source adapters must implement these methods
 */
class ISourceAdapter {
    constructor(config) {
        if (new.target === ISourceAdapter) {
            throw new Error('ISourceAdapter is an interface and cannot be instantiated directly');
        }
        this.config = config;
    }

    /**
     * Scrape price data for a specific city and PLZ
     * @param {string} cityName - The normalized city name
     * @param {string} plz - The postal code
     * @returns {Promise<Object|null>} Price data object or null if failed
     */
    async scrapeCity(cityName, plz) {
        throw new Error('scrapeCity method must be implemented by source adapter');
    }

    /**
     * Validate response data quality
     * @param {Object} data - The scraped data
     * @returns {Object} Validation result with success flag and issues
     */
    validateResponse(data) {
        throw new Error('validateResponse method must be implemented by source adapter');
    }

    /**
     * Get metadata about this source
     * @returns {Object} Source information
     */
    getSourceInfo() {
        throw new Error('getSourceInfo method must be implemented by source adapter');
    }

    /**
     * Build URL for scraping a specific city
     * @param {string} cityName - The city name
     * @returns {string} Complete URL
     */
    buildUrl(cityName) {
        throw new Error('buildUrl method must be implemented by source adapter');
    }

    /**
     * Parse and normalize city name for this source
     * @param {string} cityName - Raw city name
     * @returns {string} Normalized city name
     */
    normalizeCityName(cityName) {
        throw new Error('normalizeCityName method must be implemented by source adapter');
    }
}

/**
 * Price Extraction Interface
 * Handles HTML parsing and price extraction
 */
class IPriceExtractor {
    constructor(config) {
        if (new.target === IPriceExtractor) {
            throw new Error('IPriceExtractor is an interface and cannot be instantiated directly');
        }
        this.config = config;
    }

    /**
     * Extract prices from HTML content
     * @param {string} html - Raw HTML content
     * @param {string} pageText - Plain text version
     * @param {string} url - Source URL for context
     * @returns {Object} Extracted price data
     */
    extractPrices(html, pageText, url) {
        throw new Error('extractPrices method must be implemented by price extractor');
    }

    /**
     * Parse a price string into a number
     * @param {string} priceText - Price text to parse
     * @returns {number|null} Parsed price or null
     */
    parsePrice(priceText) {
        throw new Error('parsePrice method must be implemented by price extractor');
    }

    /**
     * Get extraction strategies used by this extractor
     * @returns {Array<string>} List of strategy names
     */
    getStrategies() {
        throw new Error('getStrategies method must be implemented by price extractor');
    }
}

/**
 * Quality Validator Interface
 * Handles outlier detection and data quality validation
 */
class IQualityValidator {
    constructor(config) {
        if (new.target === IQualityValidator) {
            throw new Error('IQualityValidator is an interface and cannot be instantiated directly');
        }
        this.config = config;
    }

    /**
     * Detect if prices are outliers
     * @param {number} lokalerPrice - Local provider price
     * @param {number} oekostromPrice - Green energy price
     * @returns {Object} Outlier detection result
     */
    detectOutliers(lokalerPrice, oekostromPrice) {
        throw new Error('detectOutliers method must be implemented by quality validator');
    }

    /**
     * Validate extracted price data
     * @param {Object} priceData - Price data to validate
     * @returns {Object} Validation result
     */
    validatePriceData(priceData) {
        throw new Error('validatePriceData method must be implemented by quality validator');
    }

    /**
     * Attempt to validate/correct outlier prices
     * @param {Object} outlierData - Data with outlier flags
     * @param {string} html - Original HTML for re-extraction
     * @returns {Promise<Object>} Validation attempt result
     */
    async validateOutliers(outlierData, html) {
        throw new Error('validateOutliers method must be implemented by quality validator');
    }

    /**
     * Get quality metrics for a set of results
     * @param {Array} results - Array of price results
     * @returns {Object} Quality metrics summary
     */
    getQualityMetrics(results) {
        throw new Error('getQualityMetrics method must be implemented by quality validator');
    }
}

/**
 * Database Storage Interface
 * Handles all database operations
 */
class IDatabaseStorage {
    constructor(config) {
        if (new.target === IDatabaseStorage) {
            throw new Error('IDatabaseStorage is an interface and cannot be instantiated directly');
        }
        this.config = config;
    }

    /**
     * Store scraped price data
     * @param {Object} priceData - Price data to store
     * @returns {Promise<Object>} Storage result
     */
    async storePriceData(priceData) {
        throw new Error('storePriceData method must be implemented by database storage');
    }

    /**
     * Bulk store multiple price records
     * @param {Array} priceDataArray - Array of price data
     * @returns {Promise<Array>} Storage results
     */
    async bulkStorePriceData(priceDataArray) {
        throw new Error('bulkStorePriceData method must be implemented by database storage');
    }

    /**
     * Check if data exists for a specific month and PLZ
     * @param {string} month - Month in YYYY-MM-DD format
     * @param {string} plz - Postal code
     * @returns {Promise<boolean>} Whether data exists
     */
    async dataExists(month, plz) {
        throw new Error('dataExists method must be implemented by database storage');
    }

    /**
     * Start a new scraping session
     * @param {string} month - Month being scraped
     * @param {number} totalCities - Total cities to scrape
     * @param {Object} config - Session configuration
     * @returns {Promise<Object>} Session object
     */
    async startSession(month, totalCities, config) {
        throw new Error('startSession method must be implemented by database storage');
    }

    /**
     * Update scraping session progress
     * @param {string} sessionId - Session ID
     * @param {Object} updates - Progress updates
     * @returns {Promise<Object>} Updated session
     */
    async updateSession(sessionId, updates) {
        throw new Error('updateSession method must be implemented by database storage');
    }

    /**
     * Log a scraping error
     * @param {string} sessionId - Session ID
     * @param {Object} errorData - Error information
     * @returns {Promise<Object>} Error record
     */
    async logError(sessionId, errorData) {
        throw new Error('logError method must be implemented by database storage');
    }
}

/**
 * State Manager Interface
 * Handles scraping session state and progress
 */
class IStateManager {
    constructor(config) {
        if (new.target === IStateManager) {
            throw new Error('IStateManager is an interface and cannot be instantiated directly');
        }
        this.config = config;
    }

    /**
     * Load previous state if exists
     * @returns {Promise<Object|null>} Previous state or null
     */
    async loadState() {
        throw new Error('loadState method must be implemented by state manager');
    }

    /**
     * Save current state
     * @param {Object} state - Current scraping state
     * @returns {Promise<void>}
     */
    async saveState(state) {
        throw new Error('saveState method must be implemented by state manager');
    }

    /**
     * Get current batch information
     * @param {Array} allCities - All cities to process
     * @param {number} currentBatch - Current batch number
     * @returns {Object} Batch information
     */
    getCurrentBatch(allCities, currentBatch) {
        throw new Error('getCurrentBatch method must be implemented by state manager');
    }

    /**
     * Mark batch as completed
     * @param {number} batchNumber - Batch number
     * @param {Object} batchResults - Batch processing results
     * @returns {Promise<void>}
     */
    async completeBatch(batchNumber, batchResults) {
        throw new Error('completeBatch method must be implemented by state manager');
    }

    /**
     * Reset all state (start fresh)
     * @returns {Promise<void>}
     */
    async resetState() {
        throw new Error('resetState method must be implemented by state manager');
    }
}

/**
 * Geographic Completion Interface
 * Handles fallback data for missing cities
 */
class IGeographicCompletion {
    constructor(config) {
        if (new.target === IGeographicCompletion) {
            throw new Error('IGeographicCompletion is an interface and cannot be instantiated directly');
        }
        this.config = config;
    }

    /**
     * Find fallback data for a city with missing price data
     * @param {Object} cityData - City information (PLZ, name, coordinates)
     * @param {Array} availableData - Available price data from other cities
     * @returns {Promise<Object|null>} Fallback data or null
     */
    async findFallbackData(cityData, availableData) {
        throw new Error('findFallbackData method must be implemented by geographic completion');
    }

    /**
     * Calculate distance between two geographic points
     * @param {number} lat1 - Latitude 1
     * @param {number} lon1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lon2 - Longitude 2
     * @returns {number} Distance in kilometers
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        throw new Error('calculateDistance method must be implemented by geographic completion');
    }

    /**
     * Get completion statistics
     * @param {Array} results - Array of results (original + fallback)
     * @returns {Object} Completion statistics
     */
    getCompletionStats(results) {
        throw new Error('getCompletionStats method must be implemented by geographic completion');
    }
}

/**
 * Data Structure Definitions
 * Standard data formats used across modules
 */

/**
 * Standard price data structure
 */
const PriceDataSchema = {
    plz: 'string',                    // Postal code
    city_name: 'string',              // City name
    latitude: 'number|null',          // Geographic latitude
    longitude: 'number|null',         // Geographic longitude
    lokaler_versorger_price: 'number|null',  // Local provider price (EUR/kWh)
    oekostrom_price: 'number|null',   // Green energy price (EUR/kWh)
    average_price: 'number|null',     // Calculated average price
    data_source: 'string',            // 'ORIGINAL' or 'FALLBACK'
    source_url: 'string|null',        // Original source URL
    source_plz: 'string|null',        // Source PLZ for fallback data
    distance_km: 'number',            // Distance to source (0 for original)
    is_outlier: 'boolean',            // Outlier detection flag
    outlier_severity: 'string',       // 'normal', 'high', 'very_high'
    extraction_method: 'string|null', // How the price was extracted
    validation_attempted: 'boolean',   // Whether outlier validation was attempted
    validation_successful: 'boolean'  // Whether validation corrected the outlier
};

/**
 * Standard scraping result structure
 */
const ScrapingResultSchema = {
    success: 'boolean',               // Whether scraping succeeded
    data: 'Object|null',              // Price data (follows PriceDataSchema)
    error: 'Object|null',             // Error information if failed
    metadata: {
        scraping_duration: 'number',   // Time taken in milliseconds
        extraction_strategy: 'string', // Which strategy was used
        validation_performed: 'boolean',
        retry_count: 'number'
    }
};

/**
 * Standard session state structure
 */
const SessionStateSchema = {
    sessionId: 'string',              // Database session ID
    currentBatch: 'number',           // Current batch number
    totalBatches: 'number',           // Total number of batches
    processedCities: 'Set',           // Set of processed city keys
    results: 'Array',                 // Array of successful results
    errors: 'Array',                  // Array of errors
    startTime: 'Date',                // Session start time
    currentMonth: 'string',           // Month being processed (YYYY-MM-DD)
    configuration: 'Object'           // Configuration used for this session
};

module.exports = {
    // Interfaces
    ISourceAdapter,
    IPriceExtractor,
    IQualityValidator,
    IDatabaseStorage,
    IStateManager,
    IGeographicCompletion,
    
    // Schemas
    PriceDataSchema,
    ScrapingResultSchema,
    SessionStateSchema
}; 