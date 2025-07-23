/**
 * Enhanced Stromauskunft.de Source Adapter v2.0
 * Improved based on comprehensive 100-city analysis
 * Better error handling and city size awareness
 */

const { ISourceAdapter } = require('../interfaces');
const axios = require('axios');
const cheerio = require('cheerio');

class StromauskunftAdapter extends ISourceAdapter {
    constructor(config, priceExtractor) {
        super(config);
        this.sourceConfig = config.getSourceConfig('stromauskunft');
        this.httpConfig = config.getHttpConfig();
        this.priceExtractor = priceExtractor;
        
        // Performance and error tracking from analysis
        this.requestCount = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.cityClassStats = {
            small: { attempted: 0, success: 0, fourohfour: 0 },
            medium: { attempted: 0, success: 0, fourohfour: 0 },
            large: { attempted: 0, success: 0, fourohfour: 0 }
        };
        
        // Error patterns from analysis
        this.knownErrorPatterns = {
            notFound: ['404', 'not found', 'seite nicht gefunden'],
            blocked: ['access denied', 'forbidden', 'rate limit', 'cloudflare'],
            invalid: ['error', 'fehler', 'ungültig']
        };
    }

    /**
     * Enhanced city scraping with error pattern recognition
     */
    async scrapeCity(cityName, plz) {
        const startTime = Date.now();
        this.requestCount++;

        try {
            const normalizedCityName = this.normalizeCityName(cityName);
            const url = this.buildUrl(normalizedCityName);
            
            // Pre-classify expected city size (basic heuristic)
            const expectedCityClass = this.classifyCityByName(cityName);
            this.cityClassStats[expectedCityClass].attempted++;
            
            console.log(`🌐 Requesting: ${url} (expected: ${expectedCityClass} city)`);

            // Make HTTP request with improved error handling
            const response = await this.makeRequestImproved(url);
            
            if (!response) {
                // Handle 404 gracefully (especially for small cities)
                console.log(`    ⚠️  No response received - likely 404 for ${expectedCityClass} city`);
                this.cityClassStats[expectedCityClass].fourohfour++;
                return this.createNotFoundResult(cityName, plz, url, expectedCityClass);
            }

            // Load HTML and extract prices using improved extractor
            const $ = cheerio.load(response.data);
            const pageText = $.text();
            
            // Use improved extractor with enhanced capabilities
            const extractionResult = this.priceExtractor.extractPrices(response.data, pageText, url);
            
            // Enhanced validation based on city class
            const validation = this.validateResponseImproved(extractionResult, expectedCityClass);
            if (!validation.success) {
                console.log(`    ❌ Validation failed: ${validation.issues.join(', ')}`);
                return this.createValidationFailedResult(cityName, plz, url, validation, extractionResult);
            }

            // Success - update stats
            this.successCount++;
            this.cityClassStats[expectedCityClass].success++;

            // Prepare enhanced result with analysis metadata
            const result = {
                plz: plz,
                city_name: cityName,
                normalized_city_name: normalizedCityName,
                expected_city_class: expectedCityClass,
                actual_city_class: extractionResult.city_classification?.type || 'unknown',
                ...extractionResult,
                scraping_duration: Date.now() - startTime,
                adapter: 'stromauskunft-improved',
                adapter_version: '2.0',
                data_source: 'ORIGINAL',
                distance_km: 0,
                source_url: url,
                analysis_metadata: {
                    request_timestamp: new Date().toISOString(),
                    dom_complexity: extractionResult.dom_structure,
                    extraction_success: true,
                    city_classification_match: expectedCityClass === (extractionResult.city_classification?.type || 'unknown')
                }
            };

            console.log(`    ✅ Success: Found ${extractionResult.extraction_method} prices (${extractionResult.city_classification?.type} city structure)`);
            return result;

        } catch (error) {
            this.errorCount++;
            const errorType = this.classifyError(error);
            console.error(`❌ Error scraping ${cityName} (${plz}): ${errorType} - ${error.message}`);
            
            return this.createErrorResult(cityName, plz, error, errorType);
        }
    }

    /**
     * Improved HTTP request handling with better error classification
     */
    async makeRequestImproved(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.httpConfig.timeout,
                headers: {
                    'User-Agent': this.httpConfig.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                    'Cache-Control': 'no-cache'
                },
                maxRedirects: 5,
                validateStatus: (status) => {
                    // Handle 404s gracefully instead of throwing
                    if (status === 404) {
                        return false; // Will be handled as null response
                    }
                    return status >= 200 && status < 400;
                }
            });

            // Check for valid response
            if (!response || !response.data) {
                return null;
            }

            // Enhanced content validation
            if (response.data.length < 500) {
                throw new Error('Response too short - likely blocked or redirected');
            }

            // Check for blocking patterns (refined from analysis)
            if (this.isResponseBlocked(response.data)) {
                throw new Error('Request appears to be blocked or redirected');
            }

            // Check for actual stromauskunft content
            if (!this.isValidStromauskunftPage(response.data)) {
                throw new Error('Page does not appear to be a valid stromauskunft city page');
            }

            return response;

        } catch (error) {
            // Handle 404s as null (not an error for small cities)
            if (error.response && error.response.status === 404) {
                return null;
            }
            
            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Standard validateResponse method (required by interface)
     */
    validateResponse(data) {
        return this.validateResponseImproved(data, data.expected_city_class || 'medium');
    }

    /**
     * Enhanced response validation based on city class
     */
    validateResponseImproved(extractionResult, expectedCityClass) {
        const issues = [];
        
        // Basic extraction validation
        if (!extractionResult) {
            issues.push('No extraction result returned');
            return { success: false, issues };
        }

        // Check if any prices were found
        const hasLocalPrice = extractionResult.lokaler_versorger_price !== null;
        const hasOekoPrice = extractionResult.oekostrom_price !== null;
        
        if (!hasLocalPrice && !hasOekoPrice) {
            issues.push('No valid prices found');
        }

        // City class specific validation
        if (expectedCityClass === 'small' && !hasLocalPrice && !hasOekoPrice) {
            // For small cities, missing data is more acceptable
            issues.push('Small city - no data available (acceptable)');
        } else if (expectedCityClass === 'large' && (!hasLocalPrice || !hasOekoPrice)) {
            // Large cities should have both prices
            issues.push('Large city missing expected price data');
        }

        // Price range validation
        if (hasLocalPrice && !this.isValidPrice(extractionResult.lokaler_versorger_price)) {
            issues.push(`Invalid lokaler price: ${extractionResult.lokaler_versorger_price}`);
        }
        
        if (hasOekoPrice && !this.isValidPrice(extractionResult.oekostrom_price)) {
            issues.push(`Invalid oeko price: ${extractionResult.oekostrom_price}`);
        }

        // DOM structure validation
        if (extractionResult.city_classification) {
            const actualClass = extractionResult.city_classification.type;
            if (expectedCityClass !== actualClass) {
                // Note but don't fail - classification can be imperfect
                console.log(`    ℹ️  City class mismatch: expected ${expectedCityClass}, detected ${actualClass}`);
            }
        }

        return { 
            success: issues.length === 0 || (expectedCityClass === 'small' && issues.length === 1), 
            issues 
        };
    }

    /**
     * Classify expected city size based on name (basic heuristic)
     */
    classifyCityByName(cityName) {
        // Very basic classification - in reality you'd use population data
        const name = cityName.toLowerCase();
        
        // Known large cities
        const largeCities = ['berlin', 'hamburg', 'münchen', 'köln', 'frankfurt', 'stuttgart', 'düsseldorf', 'dortmund', 'essen', 'leipzig', 'bremen', 'dresden', 'hannover', 'nürnberg'];
        if (largeCities.some(city => name.includes(city))) {
            return 'large';
        }
        
        // Small indicators
        if (name.includes('dorf') || name.includes('hausen') || name.includes('feld') || name.includes('berg') || name.length < 6) {
            return 'small';
        }
        
        return 'medium'; // Default
    }

    /**
     * Check if response is blocked or invalid
     */
    isResponseBlocked(responseData) {
        const responseText = responseData.toLowerCase();
        return this.knownErrorPatterns.blocked.some(pattern => 
            responseText.includes(pattern)
        );
    }

    /**
     * Check if page is a valid stromauskunft city page
     */
    isValidStromauskunftPage(responseData) {
        const pageText = responseData.toLowerCase();
        const requiredElements = [
            'stromauskunft',
            'stromanbieter',
            'kwh'
        ];
        
        return requiredElements.some(element => pageText.includes(element));
    }

    /**
     * Classify error type for better handling
     */
    classifyError(error) {
        const message = error.message.toLowerCase();
        
        if (this.knownErrorPatterns.notFound.some(pattern => message.includes(pattern))) {
            return 'not_found';
        }
        
        if (this.knownErrorPatterns.blocked.some(pattern => message.includes(pattern))) {
            return 'blocked';
        }
        
        if (message.includes('timeout')) {
            return 'timeout';
        }
        
        if (message.includes('network') || message.includes('connection')) {
            return 'network';
        }
        
        return 'unknown';
    }

    /**
     * Create structured result for not found cases
     */
    createNotFoundResult(cityName, plz, url, expectedCityClass) {
        return {
            plz: plz,
            city_name: cityName,
            lokaler_versorger_price: null,
            oekostrom_price: null,
            average_price: null,
            data_source: 'NOT_FOUND',
            error_type: 'not_found',
            error_message: `City page not found (common for ${expectedCityClass} cities)`,
            source_url: url,
            extraction_method: 'failed',
            expected_city_class: expectedCityClass,
            scraping_duration: 0,
            adapter: 'stromauskunft-improved',
            analysis_metadata: {
                request_timestamp: new Date().toISOString(),
                error_classification: 'not_found',
                city_classification_attempted: expectedCityClass
            }
        };
    }

    /**
     * Create structured result for validation failures
     */
    createValidationFailedResult(cityName, plz, url, validation, extractionResult) {
        return {
            plz: plz,
            city_name: cityName,
            lokaler_versorger_price: extractionResult.lokaler_versorger_price,
            oekostrom_price: extractionResult.oekostrom_price,
            average_price: extractionResult.average_price,
            data_source: 'VALIDATION_FAILED',
            error_type: 'validation_failed',
            error_message: validation.issues.join('; '),
            source_url: url,
            extraction_method: extractionResult.extraction_method,
            extraction_details: extractionResult.extraction_details,
            scraping_duration: 0,
            adapter: 'stromauskunft-improved',
            analysis_metadata: {
                request_timestamp: new Date().toISOString(),
                validation_issues: validation.issues,
                partial_extraction: true
            }
        };
    }

    /**
     * Create structured result for errors
     */
    createErrorResult(cityName, plz, error, errorType) {
        return {
            plz: plz,
            city_name: cityName,
            lokaler_versorger_price: null,
            oekostrom_price: null,
            average_price: null,
            data_source: 'ERROR',
            error_type: errorType,
            error_message: error.message,
            extraction_method: 'failed',
            scraping_duration: 0,
            adapter: 'stromauskunft-improved',
            analysis_metadata: {
                request_timestamp: new Date().toISOString(),
                error_classification: errorType,
                stack_trace: process.env.NODE_ENV === 'development' ? error.stack : undefined
            }
        };
    }

    /**
     * Enhanced URL building with better normalization
     */
    buildUrl(cityName) {
        const normalized = this.normalizeCityName(cityName);
        return `${this.sourceConfig.baseUrl}${normalized}${this.sourceConfig.urlSuffix || '.html'}`;
    }

    /**
     * Improved city name normalization with proper German umlaut handling
     */
    normalizeCityName(cityName) {
        return cityName
            .toLowerCase()
            // Handle German umlauts properly
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            // Handle uppercase umlauts too
            .replace(/Ä/g, 'ae')
            .replace(/Ö/g, 'oe')
            .replace(/Ü/g, 'ue')
            // Clean up and normalize
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * Validate price is in acceptable range
     */
    isValidPrice(price) {
        if (!price || typeof price !== 'number') return false;
        return price >= 0.05 && price <= 2.0; // Based on analysis thresholds
    }

    /**
     * Enhanced source info with analysis data
     */
    getSourceInfo() {
        const totalRequests = this.requestCount;
        const successRate = totalRequests > 0 ? (this.successCount / totalRequests * 100).toFixed(1) + '%' : 'N/A';
        
        return {
            name: 'Stromauskunft.de Enhanced',
            baseUrl: this.sourceConfig.baseUrl,
            version: '2.0',
            adapter: 'StromauskunftAdapterImproved',
            features: [
                'city_size_classification',
                'enhanced_error_handling',
                'format_detection',
                'dom_structure_analysis',
                'improved_price_validation'
            ],
            configuration: {
                timeout: this.httpConfig.timeout,
                userAgent: this.httpConfig.userAgent,
                extractionStrategies: this.sourceConfig.priceExtractionStrategies
            },
            performance: {
                totalRequests: totalRequests,
                successfulRequests: this.successCount,
                failedRequests: this.errorCount,
                successRate: successRate,
                cityClassificationStats: this.cityClassStats
            },
            analysis_integration: {
                basedOn: '100-city comprehensive analysis',
                improvements: [
                    'Euro/Cent format handling',
                    'City size specific strategies',
                    'Better 404 handling',
                    'Enhanced DOM structure detection'
                ]
            }
        };
    }

    /**
     * Get performance statistics by city class
     */
    getCityClassPerformance() {
        const stats = {};
        for (const [cityClass, data] of Object.entries(this.cityClassStats)) {
            stats[cityClass] = {
                attempted: data.attempted,
                successful: data.success,
                notFound: data.fourohfour,
                successRate: data.attempted > 0 ? (data.success / data.attempted * 100).toFixed(1) + '%' : 'N/A',
                notFoundRate: data.attempted > 0 ? (data.fourohfour / data.attempted * 100).toFixed(1) + '%' : 'N/A'
            };
        }
        return stats;
    }
}

module.exports = StromauskunftAdapter; 