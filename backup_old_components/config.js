/**
 * Centralized Configuration Module
 * All scraper settings, thresholds, and configuration in one place
 */

class ScraperConfig {
    constructor(overrides = {}) {
        // Load environment variables
        this.env = process.env.NODE_ENV || 'development';
        
        // Merge default config with environment-specific and override settings
        this.config = {
            ...this.getDefaultConfig(),
            ...this.getEnvironmentConfig(),
            ...overrides
        };
    }

    getDefaultConfig() {
        return {
            // === SCRAPING SETTINGS ===
            delays: {
                betweenRequests: 1000,      // 1 second between requests
                batchPause: 5000,           // 5 seconds between batches
                retryDelay: 2000,           // 2 seconds before retry
                maxRetries: 3               // Maximum retry attempts
            },

            // === BATCHING SETTINGS ===
            batching: {
                enabled: true,
                totalBatches: 5,            // Divide work into 5 batches
                autoProgress: false,        // Wait for manual continuation between batches
                stateSaveInterval: 10       // Save state every N cities
            },

            // === PRICE VALIDATION ===
            priceValidation: {
                minPrice: 0.05,             // Minimum valid price (EUR/kWh)
                maxPrice: 2.0,              // Maximum valid price (EUR/kWh)
                outlierThresholds: {
                    high: 1.0,              // Prices ≥ €1.00 are potential outliers
                    veryHigh: 1.5,          // Prices ≥ €1.50 are very suspicious
                    extreme: 2.0            // Prices ≥ €2.00 are invalid
                }
            },

            // === HTTP SETTINGS ===
            http: {
                timeout: 15000,             // 15 second timeout
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                maxConcurrentRequests: 1,   // Sequential requests only
                respectRobotsTxt: true
            },

            // === DATABASE SETTINGS ===
            database: {
                batchSize: parseInt(process.env.DB_BATCH_SIZE) || 100,
                enableSessionTracking: true,
                autoMonthDetection: true,
                duplicateHandling: 'skip'   // 'skip', 'update', or 'error'
            },

            // === LOGGING SETTINGS ===
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                enableDetailedScraping: process.env.ENABLE_SCRAPING_LOGS === 'true',
                enableOutlierLogging: true,
                enableProgressReports: true
            },

            // === SOURCE-SPECIFIC SETTINGS ===
            sources: {
                stromauskunft: {
                    baseUrl: 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-',
                    urlSuffix: '.html',
                    priceExtractionStrategies: ['tableFirst', 'regexFallback'],
                    enableOutlierValidation: true,
                    maxValidationAttempts: 2
                }
            },

            // === QUALITY SETTINGS ===
            quality: {
                enableOutlierDetection: true,
                enablePriceValidation: true,
                enableGeographicFallback: true,
                requireBothPrices: false,   // Allow single price results
                maxFallbackDistance: 50     // km
            }
        };
    }

    getEnvironmentConfig() {
        const envConfigs = {
            development: {
                delays: {
                    betweenRequests: parseInt(process.env.SCRAPER_DELAY) || 1000
                },
                logging: {
                    level: 'debug',
                    enableDetailedScraping: true
                }
            },
            production: {
                delays: {
                    betweenRequests: 2000,  // More conservative in production
                    batchPause: 10000
                },
                logging: {
                    level: 'info',
                    enableDetailedScraping: false
                },
                http: {
                    timeout: 30000  // Longer timeout in production
                }
            },
            testing: {
                delays: {
                    betweenRequests: 100,   // Faster for tests
                    batchPause: 500
                },
                batching: {
                    totalBatches: 2,        // Smaller batches for tests
                    stateSaveInterval: 5
                },
                logging: {
                    level: 'warn'          // Less verbose in tests
                }
            }
        };

        return envConfigs[this.env] || {};
    }

    // === GETTER METHODS ===

    get(path) {
        return this.getNestedValue(this.config, path);
    }

    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }

    // === SPECIFIC CONFIGURATION GETTERS ===

    getDelays() {
        return this.config.delays;
    }

    getBatchingConfig() {
        return this.config.batching;
    }

    getPriceValidation() {
        return this.config.priceValidation;
    }

    getOutlierThresholds() {
        return this.config.priceValidation.outlierThresholds;
    }

    getHttpConfig() {
        return this.config.http;
    }

    getDatabaseConfig() {
        return this.config.database;
    }

    getLoggingConfig() {
        return this.config.logging;
    }

    getSourceConfig(sourceName) {
        return this.config.sources[sourceName];
    }

    getQualityConfig() {
        return this.config.quality;
    }

    // === VALIDATION HELPERS ===

    isValidPrice(price) {
        const validation = this.getPriceValidation();
        return price && 
               typeof price === 'number' && 
               price >= validation.minPrice && 
               price <= validation.maxPrice;
    }

    isOutlierPrice(price) {
        const thresholds = this.getOutlierThresholds();
        return price >= thresholds.high;
    }

    getOutlierSeverity(price) {
        const thresholds = this.getOutlierThresholds();
        if (price >= thresholds.extreme) return 'extreme';
        if (price >= thresholds.veryHigh) return 'very_high';
        if (price >= thresholds.high) return 'high';
        return 'normal';
    }

    // === UTILITY METHODS ===

    shouldEnableDetailedLogging() {
        return this.config.logging.enableDetailedScraping;
    }

    shouldEnableOutlierDetection() {
        return this.config.quality.enableOutlierDetection;
    }

    shouldEnableSessionTracking() {
        return this.config.database.enableSessionTracking;
    }

    getCurrentMonth() {
        if (!this.config.database.autoMonthDetection) {
            return null; // Manual month specification required
        }
        
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}-01`;
    }

    // === CONFIGURATION OVERRIDE ===

    override(overrides) {
        this.config = { ...this.config, ...overrides };
        return this;
    }

    // === CONFIGURATION VALIDATION ===

    validate() {
        const errors = [];

        // Validate required settings
        if (!this.config.delays.betweenRequests || this.config.delays.betweenRequests < 100) {
            errors.push('Delay between requests must be at least 100ms');
        }

        if (!this.config.priceValidation.minPrice || this.config.priceValidation.minPrice <= 0) {
            errors.push('Minimum price must be greater than 0');
        }

        if (this.config.priceValidation.maxPrice <= this.config.priceValidation.minPrice) {
            errors.push('Maximum price must be greater than minimum price');
        }

        if (!this.config.http.timeout || this.config.http.timeout < 1000) {
            errors.push('HTTP timeout must be at least 1000ms');
        }

        if (this.config.batching.totalBatches < 1) {
            errors.push('Total batches must be at least 1');
        }

        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }

        return true;
    }

    // === DEBUG HELPERS ===

    printConfig() {
        console.log('📋 Scraper Configuration:');
        console.log(`   Environment: ${this.env}`);
        console.log(`   Request delay: ${this.config.delays.betweenRequests}ms`);
        console.log(`   Batch size: ${this.config.batching.totalBatches} batches`);
        console.log(`   Price range: €${this.config.priceValidation.minPrice} - €${this.config.priceValidation.maxPrice}`);
        console.log(`   HTTP timeout: ${this.config.http.timeout}ms`);
        console.log(`   Database batch size: ${this.config.database.batchSize}`);
        console.log(`   Logging level: ${this.config.logging.level}`);
        
        if (this.shouldEnableDetailedLogging()) {
            console.log(`   Detailed logging: ENABLED`);
        }
        
        if (this.shouldEnableOutlierDetection()) {
            console.log(`   Outlier detection: ENABLED (≥€${this.config.priceValidation.outlierThresholds.high})`);
        }
    }

    toJSON() {
        return this.config;
    }
}

module.exports = ScraperConfig; 