/**
 * Enhanced Scraper Configuration v2.0
 * Optimized based on comprehensive 100-city analysis
 */

class ScraperConfig {
    constructor(overrides = {}) {
        this.config = this.mergeConfig(this.getDefaultConfig(), overrides);
        this.environment = process.env.NODE_ENV || 'production';
    }

    getDefaultConfig() {
        return {
            // === ANALYSIS-BASED SCRAPING SETTINGS ===
            delays: {
                betweenRequests: 2000,      // Increased to 2s based on analysis success rates
                batchPause: 10000,          // 10 seconds between batches (more respectful)
                retryDelay: 3000,           // 3 seconds before retry
                maxRetries: 2,              // Reduced retries (404s don't need many retries)
                cityClassDelays: {          // Different delays based on city size
                    small: 1500,            // Faster for small cities (many 404s)
                    medium: 2000,           // Standard delay
                    large: 2500             // Longer delay for complex pages
                }
            },

            // === ENHANCED BATCHING SETTINGS ===
            batching: {
                enabled: true,
                totalBatches: 5,            
                autoProgress: false,        
                stateSaveInterval: 5,       // Save more frequently based on analysis
                cityClassAwareBatching: true, // New: Optimize batching by city type
                prioritizeSuccessfulCities: true // Process likely-successful cities first
            },

            // === ANALYSIS-BASED PRICE VALIDATION ===
            priceValidation: {
                minPrice: 0.05,             // Confirmed from analysis
                maxPrice: 2.0,              // Confirmed from analysis  
                outlierThresholds: {
                    normal: 0.45,           // Based on analysis: most prices 0.30-0.45
                    high: 0.60,             // Prices > €0.60 need attention
                    veryHigh: 0.80,         // Prices > €0.80 are suspicious
                    extreme: 1.20           // Prices > €1.20 are likely errors
                },
                // New: Format-specific validation
                formatValidation: {
                    euroFormat: {
                        expected: true,     // Most common format
                        range: [0.20, 0.80]
                    },
                    centFormat: {
                        expected: true,     // Also common, converted to euro
                        range: [20, 80]     // In cents before conversion
                    }
                }
            },

            // === ENHANCED HTTP SETTINGS ===
            http: {
                timeout: 20000,             // Increased timeout for large cities
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                maxConcurrentRequests: 1,   
                respectRobotsTxt: true,
                // New: Enhanced headers based on analysis
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'no-cache',
                    'DNT': '1'
                },
                // New: Error handling patterns from analysis
                errorHandling: {
                    handle404Gracefully: true,
                    expectedSmallCity404Rate: 0.83, // 83% of small cities return 404
                    maxConsecutive404s: 10,
                    blockingDetection: {
                        enabled: true,
                        patterns: ['cloudflare', 'access denied', 'rate limit']
                    }
                }
            },

            // === DATABASE SETTINGS ===
            database: {
                batchSize: parseInt(process.env.DB_BATCH_SIZE) || 50, // Reduced for better error handling
                enableSessionTracking: true,
                autoMonthDetection: true,
                duplicateHandling: 'skip',
                // New: Analysis-based storage optimization
                storageOptimization: {
                    separateErrorTypes: true,    // Store different error types separately
                    includeAnalysisMetadata: true, // Store extraction details
                    enablePerformanceTracking: true
                },
                // NEW: Batching optimizations for reduced DB load
                batchingOptimizations: {
                    enableBatchStorage: true,        // Store results in batches instead of individually
                    batchStorageSize: 100,           // Store every 100 successful cities
                    enableBatchErrorLogging: true,   // Log errors in batches
                    batchErrorSize: 50,              // Log every 50 errors
                    enableBulkDuplicateCheck: true   // Check all PLZs for duplicates at start
                }
            },

            // === GEOGRAPHIC COMPLETION SETTINGS ===
            geographic: {
                enabled: true,
                plzCoordinatesFile: 'utils/Postleitzahlen Deutschland.csv',
                maxFallbackDistance: 50, // Maximum distance in km for fallback data
                enableDetailedStats: true,
                logCompletionSummary: true
            },

            // === ENHANCED LOGGING SETTINGS ===
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                enableDetailedScraping: process.env.ENABLE_SCRAPING_LOGS === 'true',
                enableOutlierLogging: true,
                enableProgressReports: true,
                // New: Analysis-based logging
                cityClassificationLogging: true,
                extractionMethodLogging: true,
                domStructureLogging: true,
                performanceLogging: true
            },

            // === ENHANCED SOURCE-SPECIFIC SETTINGS ===
            sources: {
                stromauskunft: {
                    baseUrl: 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-',
                    urlSuffix: '.html',
                    // Enhanced extraction strategies based on analysis
                    priceExtractionStrategies: {
                        small: ['regexSimple', 'tableSimple'],
                        medium: ['tableStandard', 'regexStandard', 'tableFirst'],
                        large: ['tableComplex', 'regexAdvanced', 'tableStandard']
                    },
                    enableOutlierValidation: true,
                    maxValidationAttempts: 2,
                    // New: Analysis-based settings
                    cityClassification: {
                        enabled: true,
                        useHeuristics: true,
                        fallbackToMedium: true
                    },
                    formatDetection: {
                        enabled: true,
                        autoConvertCentToEuro: true,
                        validateConversion: true
                    },
                    domAnalysis: {
                        enabled: true,
                        trackComplexity: true,
                        adaptStrategies: true
                    }
                }
            },

            // === ENHANCED QUALITY SETTINGS ===
            quality: {
                enableOutlierDetection: true,
                enablePriceValidation: true,
                enableGeographicFallback: true, // Now enabled with integrated module
                requireBothPrices: false,        
                maxFallbackDistance: 50,
                // New: Analysis-based quality controls
                cityClassSpecificValidation: {
                    small: {
                        acceptSinglePrice: true,
                        acceptNoData: true,      // Many small cities have no data
                        skipOutlierDetection: false
                    },
                    medium: {
                        acceptSinglePrice: true,
                        acceptNoData: false,     // Medium cities should have data
                        skipOutlierDetection: false
                    },
                    large: {
                        acceptSinglePrice: false, // Large cities should have both prices
                        acceptNoData: false,
                        skipOutlierDetection: false
                    }
                },
                extractionQuality: {
                    minimumConfidence: 0.7,
                    requireMethodLogging: true,
                    validateDOMStructure: true
                }
            },

            // === NEW: ANALYSIS INTEGRATION SETTINGS ===
            analysis: {
                enabled: true,
                basedOn: '100-city comprehensive analysis',
                version: '2.0',
                improvements: [
                    'city_size_classification',
                    'euro_cent_format_handling', 
                    'enhanced_404_handling',
                    'dom_structure_adaptation',
                    'extraction_strategy_optimization'
                ],
                expectedSuccessRates: {
                    small: 0.17,     // 17% success rate for small cities
                    medium: 1.0,     // 100% success rate for medium cities  
                    large: 1.0       // 100% success rate for large cities
                },
                performanceTargets: {
                    overallSuccessRate: 0.70,  // 70% overall target
                    averageResponseTime: 3000,  // 3 seconds average
                    maxConsecutiveErrors: 5
                }
            }
        };
    }

    // === CONFIGURATION GETTERS ===

    getDelays() {
        return this.config.delays;
    }

    getCityClassDelay(cityClass) {
        return this.config.delays.cityClassDelays[cityClass] || this.config.delays.betweenRequests;
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
        return this.config.sources[sourceName] || {};
    }

    getQualityConfig() {
        return this.config.quality;
    }

    getCityClassQuality(cityClass) {
        return this.config.quality.cityClassSpecificValidation[cityClass] || {};
    }

    getGeographicConfig() {
        return this.config.geographic;
    }

    shouldEnableSessionTracking() {
        return this.config.database.enableSessionTracking;
    }

    shouldEnableDetailedLogging() {
        return this.config.logging.enableDetailedScraping;
    }

    getAnalysisConfig() {
        return this.config.analysis;
    }

    // === NEW: ANALYSIS-SPECIFIC GETTERS ===

    getExtractionStrategies(cityClass) {
        const sourceConfig = this.getSourceConfig('stromauskunft');
        return sourceConfig.priceExtractionStrategies[cityClass] || 
               sourceConfig.priceExtractionStrategies.medium; // Fallback
    }

    getExpectedSuccessRate(cityClass) {
        return this.config.analysis.expectedSuccessRates[cityClass] || 0.5;
    }

    getCityClassificationConfig() {
        const sourceConfig = this.getSourceConfig('stromauskunft');
        return sourceConfig.cityClassification || {};
    }

    getFormatDetectionConfig() {
        const sourceConfig = this.getSourceConfig('stromauskunft');
        return sourceConfig.formatDetection || {};
    }

    getDOMAnalysisConfig() {
        const sourceConfig = this.getSourceConfig('stromauskunft');
        return sourceConfig.domAnalysis || {};
    }

    // === UTILITY METHODS ===

    getCurrentMonth() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    }

    validate() {
        // Enhanced validation based on analysis requirements
        const required = ['delays', 'http', 'sources', 'quality', 'analysis'];
        const missing = required.filter(key => !this.config[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required configuration sections: ${missing.join(', ')}`);
        }

        // Validate analysis-specific settings
        const analysisConfig = this.getAnalysisConfig();
        if (!analysisConfig.enabled) {
            console.warn('⚠️  Analysis features are disabled - some improvements may not be available');
        }

        // Validate city class settings
        const cityClasses = ['small', 'medium', 'large'];
        const sourceConfig = this.getSourceConfig('stromauskunft');
        
        if (sourceConfig.priceExtractionStrategies) {
            const missingStrategies = cityClasses.filter(cls => 
                !sourceConfig.priceExtractionStrategies[cls]
            );
            if (missingStrategies.length > 0) {
                console.warn(`⚠️  Missing extraction strategies for: ${missingStrategies.join(', ')}`);
            }
        }

        return true;
    }

    mergeConfig(defaultConfig, overrides) {
        return this.deepMerge(defaultConfig, overrides);
    }

    deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(target[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }

    /**
     * Validate if a price is within acceptable range
     */
    isValidPrice(price) {
        if (!price || typeof price !== 'number') {
            return false;
        }
        
        // Use price validation config if available, otherwise use sensible defaults
        const validation = this.config.priceValidation || {};
        const minPrice = validation.minValidPrice || 0.05;  // 5 cents minimum
        const maxPrice = validation.maxValidPrice || 2.0;   // 2 euros maximum
        
        return price >= minPrice && price <= maxPrice;
    }

    toJSON() {
        return JSON.parse(JSON.stringify(this.config));
    }

    printConfig() {
        console.log('\n📋 ENHANCED SCRAPER CONFIGURATION v2.0');
        console.log('=======================================');
        console.log(`Environment: ${this.environment}`);
        console.log(`Analysis Integration: ${this.config.analysis.enabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`Based on: ${this.config.analysis.basedOn}`);
        console.log(`\n🚀 Performance Targets:`);
        console.log(`  Overall Success Rate: ${(this.config.analysis.performanceTargets.overallSuccessRate * 100).toFixed(0)}%`);
        console.log(`  Average Response Time: ${this.config.analysis.performanceTargets.averageResponseTime}ms`);
        console.log(`\n🎯 Expected Success Rates by City Class:`);
        console.log(`  Small Cities: ${(this.config.analysis.expectedSuccessRates.small * 100).toFixed(0)}%`);
        console.log(`  Medium Cities: ${(this.config.analysis.expectedSuccessRates.medium * 100).toFixed(0)}%`);
        console.log(`  Large Cities: ${(this.config.analysis.expectedSuccessRates.large * 100).toFixed(0)}%`);
        console.log(`\n⚙️  Key Improvements:`);
        this.config.analysis.improvements.forEach(improvement => {
            console.log(`  ✅ ${improvement.replace(/_/g, ' ')}`);
        });
        console.log('');
    }
}

module.exports = ScraperConfig; 