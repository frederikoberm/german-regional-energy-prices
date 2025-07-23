/**
 * Stromauskunft.de Source Adapter
 * Implements ISourceAdapter interface for scraping from Stromauskunft.de
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
        
        // Performance tracking
        this.requestCount = 0;
        this.successCount = 0;
        this.errorCount = 0;
    }

    /**
     * Scrape price data for a specific city and PLZ
     */
    async scrapeCity(cityName, plz) {
        const startTime = Date.now();
        this.requestCount++;

        try {
            const normalizedCityName = this.normalizeCityName(cityName);
            const url = this.buildUrl(normalizedCityName);
            
            console.log(`🌐 Requesting: ${url}`);

            // Make HTTP request
            const response = await this.makeRequest(url);
            
            // Extract prices using the price extractor
            const $ = cheerio.load(response.data);
            const pageText = $.text();
            
            const extractionResult = this.priceExtractor.extractPrices(response.data, pageText, url);
            
            // Validate extraction result
            const validation = this.validateResponse(extractionResult);
            if (!validation.success) {
                throw new Error(`Validation failed: ${validation.issues.join(', ')}`);
            }

            // Prepare final result
            const result = {
                plz: plz,
                city_name: cityName,
                ...extractionResult,
                scraping_duration: Date.now() - startTime,
                adapter: 'stromauskunft',
                data_source: 'ORIGINAL',
                distance_km: 0
            };

            this.successCount++;
            return result;

        } catch (error) {
            this.errorCount++;
            console.error(`❌ Error scraping ${cityName} (${plz}):`, error.message);
            
            // Return null to indicate failure (let caller handle error logging)
            return null;
        }
    }

    /**
     * Make HTTP request with proper headers and error handling
     */
    async makeRequest(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.httpConfig.timeout,
                headers: {
                    'User-Agent': this.httpConfig.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                },
                // Handle redirects
                maxRedirects: 5,
                // Validate status
                validateStatus: (status) => status >= 200 && status < 400
            });

            // Basic response validation
            if (!response.data || response.data.length < 1000) {
                throw new Error('Response too short - likely blocked or invalid page');
            }

            // Check for common blocking indicators (improved detection)
            const responseText = response.data.toLowerCase();
            const realBlockingIndicators = [
                'access denied',
                'forbidden',
                'too many requests',
                'rate limit',
                'security check',
                'cloudflare',
                'please complete',
                'verify you are human',
                'suspicious activity'
            ];
            
            const hasBlockingIndicator = realBlockingIndicators.some(indicator => 
                responseText.includes(indicator)
            );
            
            if (hasBlockingIndicator) {
                throw new Error('Request appears to be blocked');
            }

            return response;

        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw new Error(`Request timeout after ${this.httpConfig.timeout}ms`);
            } else if (error.response) {
                throw new Error(`HTTP ${error.response.status}: ${error.response.statusText}`);
            } else if (error.request) {
                throw new Error('Network error - no response received');
            } else {
                throw error;
            }
        }
    }

    /**
     * Validate response data quality
     */
    validateResponse(extractionData) {
        const validation = {
            success: true,
            issues: []
        };

        // Check if extraction was successful
        if (!extractionData) {
            validation.success = false;
            validation.issues.push('No extraction data provided');
            return validation;
        }

        // Check for extraction errors
        if (extractionData.extraction_method === 'failed') {
            validation.success = false;
            validation.issues.push('Price extraction failed');
            return validation;
        }

        // Check if at least one price was found
        if (!extractionData.lokaler_versorger_price && !extractionData.oekostrom_price) {
            validation.success = false;
            validation.issues.push('No valid prices extracted');
            return validation;
        }

        // Validate price ranges using config
        if (extractionData.lokaler_versorger_price && 
            !this.config.isValidPrice(extractionData.lokaler_versorger_price)) {
            validation.success = false;
            validation.issues.push('Lokaler Versorger price out of valid range');
        }

        if (extractionData.oekostrom_price && 
            !this.config.isValidPrice(extractionData.oekostrom_price)) {
            validation.success = false;
            validation.issues.push('Ökostrom price out of valid range');
        }

        // Check if average was calculated
        if (!extractionData.average_price) {
            validation.issues.push('Average price not calculated');
            // Don't fail validation for this - it's a warning
        }

        return validation;
    }

    /**
     * Get metadata about this source
     */
    getSourceInfo() {
        return {
            name: 'Stromauskunft.de',
            baseUrl: this.sourceConfig.baseUrl,
            version: '2.0',
            adapter: 'StromauskunftAdapter',
            features: [
                'lokaler_versorger_prices',
                'oekostrom_prices',
                'automatic_price_validation',
                'multiple_extraction_strategies'
            ],
            configuration: {
                timeout: this.httpConfig.timeout,
                userAgent: this.httpConfig.userAgent,
                enableOutlierValidation: this.sourceConfig.enableOutlierValidation,
                extractionStrategies: this.sourceConfig.priceExtractionStrategies
            },
            performance: {
                totalRequests: this.requestCount,
                successfulRequests: this.successCount,
                failedRequests: this.errorCount,
                successRate: this.requestCount > 0 ? (this.successCount / this.requestCount * 100).toFixed(1) + '%' : 'N/A'
            }
        };
    }

    /**
     * Build URL for scraping a specific city
     */
    buildUrl(cityName) {
        const normalizedCity = this.normalizeCityNameForUrl(cityName);
        return `${this.sourceConfig.baseUrl}${normalizedCity}${this.sourceConfig.urlSuffix}`;
    }

    /**
     * Parse and normalize city name for this source
     */
    normalizeCityName(cityName) {
        if (!cityName) return '';
        
        // Extract the main city name from compound names
        let normalized = this.extractCityName(cityName);
        
        // Additional Stromauskunft-specific normalizations
        normalized = normalized
            .toLowerCase()
            .trim()
            // Handle special characters
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            // Remove common prefixes/suffixes that might interfere
            .replace(/^(stadt\s+|gemeinde\s+)/i, '')
            .replace(/\s+(stadt|gemeinde)$/i, '');
        
        return normalized;
    }

    /**
     * Normalize city name specifically for URL construction
     */
    normalizeCityNameForUrl(cityName) {
        return this.normalizeCityName(cityName)
            // Remove spaces and special characters for URL
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')
            // Remove multiple consecutive dashes
            .replace(/-+/g, '-')
            // Remove leading/trailing dashes
            .replace(/^-+|-+$/g, '');
    }

    /**
     * Extract main city name from complex city names
     */
    extractCityName(fullName) {
        if (!fullName) return '';
        
        // Remove content in parentheses (like "Hamburg (Hansestadt)")
        let cityName = fullName.replace(/\s*\([^)]*\)/g, '');
        
        // Handle compound names separated by commas - take the first part
        if (cityName.includes(',')) {
            cityName = cityName.split(',')[0];
        }
        
        // Handle names with " bei " or " an der " - take the first part
        const prepositions = [' bei ', ' an der ', ' am ', ' auf ', ' im '];
        for (const prep of prepositions) {
            if (cityName.toLowerCase().includes(prep)) {
                cityName = cityName.split(prep)[0];
                break;
            }
        }
        
        return cityName.trim();
    }

    /**
     * Check if the source is currently accessible
     */
    async testConnection() {
        try {
            console.log('🔍 Testing Stromauskunft.de connection...');
            
            // Test with a well-known city
            const testUrl = this.buildUrl('hamburg');
            const response = await this.makeRequest(testUrl);
            
            // Basic validation
            if (response.data && response.data.length > 1000) {
                console.log('✅ Stromauskunft.de connection test successful');
                return true;
            } else {
                console.log('❌ Stromauskunft.de connection test failed - invalid response');
                return false;
            }
            
        } catch (error) {
            console.log(`❌ Stromauskunft.de connection test failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Get rate limiting information
     */
    getRateLimitInfo() {
        return {
            recommendedDelay: this.config.getDelays().betweenRequests,
            maxConcurrentRequests: this.httpConfig.maxConcurrentRequests,
            respectsRobotsTxt: this.httpConfig.respectRobotsTxt,
            currentRequestCount: this.requestCount,
            averageResponseTime: this.requestCount > 0 ? 'Not tracked' : 'N/A'
        };
    }

    /**
     * Reset performance counters
     */
    resetPerformanceCounters() {
        this.requestCount = 0;
        this.successCount = 0;
        this.errorCount = 0;
        console.log('📊 Performance counters reset');
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats() {
        const successRate = this.requestCount > 0 ? 
            (this.successCount / this.requestCount * 100).toFixed(1) : 0;
        
        return {
            totalRequests: this.requestCount,
            successfulRequests: this.successCount,
            failedRequests: this.errorCount,
            successRate: `${successRate}%`,
            averageSuccessRate: successRate >= 80 ? 'Good' : 
                               successRate >= 60 ? 'Fair' : 'Poor'
        };
    }

    /**
     * Handle adapter-specific configuration updates
     */
    updateConfiguration(newConfig) {
        // Update internal configuration if needed
        if (newConfig.delays) {
            this.config.override({ delays: newConfig.delays });
        }
        
        if (newConfig.http) {
            this.config.override({ http: newConfig.http });
        }
        
        console.log('⚙️  Adapter configuration updated');
    }

    /**
     * Get adapter capabilities and limitations
     */
    getCapabilities() {
        return {
            supportedPriceTypes: ['lokaler_versorger', 'oekostrom'],
            extractionMethods: this.sourceConfig.priceExtractionStrategies,
            maxRetriesSupported: true,
            outlierValidationSupported: this.sourceConfig.enableOutlierValidation,
            batchProcessingSupported: true,
            geographicCoverage: 'Germany',
            dataFreshness: 'Real-time (scraped on demand)',
            limitations: [
                'Rate limited to prevent blocking',
                'Depends on website availability',
                'Price format changes may require updates',
                'Some cities may not have data available'
            ]
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        // Log final performance stats
        const stats = this.getPerformanceStats();
        console.log('📊 Final adapter performance:');
        console.log(`   Total requests: ${stats.totalRequests}`);
        console.log(`   Success rate: ${stats.successRate}`);
        
        console.log('🧹 Stromauskunft adapter cleanup complete');
    }
}

module.exports = StromauskunftAdapter; 