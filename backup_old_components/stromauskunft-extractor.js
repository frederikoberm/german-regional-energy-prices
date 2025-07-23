/**
 * Stromauskunft.de Price Extractor
 * Implements IPriceExtractor interface for extracting prices from Stromauskunft.de
 */

const { IPriceExtractor } = require('../interfaces');
const cheerio = require('cheerio');

class StromauskunftExtractor extends IPriceExtractor {
    constructor(config) {
        super(config);
        this.sourceConfig = config.getSourceConfig('stromauskunft');
        this.priceValidation = config.getPriceValidation();
    }

    /**
     * Extract prices from HTML content
     */
    extractPrices(html, pageText, url) {
        try {
            const $ = cheerio.load(html);
            
            // Get enabled strategies from config
            const strategies = this.sourceConfig.priceExtractionStrategies || ['tableFirst', 'regexFallback'];
            
            let result = {
                lokaler_versorger_price: null,
                oekostrom_price: null,
                average_price: null,
                extraction_method: null,
                extraction_details: []
            };

            // Try each strategy in order
            for (const strategy of strategies) {
                const strategyResult = this.applyExtractionStrategy(strategy, $, pageText, url);
                
                // Update result with any found prices
                if (strategyResult.lokaler_versorger_price && !result.lokaler_versorger_price) {
                    result.lokaler_versorger_price = strategyResult.lokaler_versorger_price;
                    result.extraction_method = strategy;
                }
                
                if (strategyResult.oekostrom_price && !result.oekostrom_price) {
                    result.oekostrom_price = strategyResult.oekostrom_price;
                    if (!result.extraction_method) result.extraction_method = strategy;
                }

                result.extraction_details.push({
                    strategy,
                    success: strategyResult.success,
                    found_prices: {
                        lokaler: !!strategyResult.lokaler_versorger_price,
                        oeko: !!strategyResult.oekostrom_price
                    },
                    details: strategyResult.details
                });

                // Break if we found both prices
                if (result.lokaler_versorger_price && result.oekostrom_price) {
                    break;
                }
            }

            // Calculate average if we have at least one price
            result.average_price = this.calculateAverage(
                result.lokaler_versorger_price, 
                result.oekostrom_price
            );

            // Add source URL
            result.source_url = url;

            if (this.config.shouldEnableDetailedLogging()) {
                this.logExtractionResult(result);
            }

            return result;

        } catch (error) {
            console.error(`❌ Error extracting prices from ${url}:`, error.message);
            return {
                lokaler_versorger_price: null,
                oekostrom_price: null,
                average_price: null,
                extraction_method: 'failed',
                error: error.message,
                source_url: url
            };
        }
    }

    /**
     * Apply specific extraction strategy
     */
    applyExtractionStrategy(strategy, $, pageText, url) {
        switch (strategy) {
            case 'tableFirst':
                return this.extractFromTables($, pageText);
            case 'regexFallback':
                return this.extractWithRegex(pageText);
            case 'summarySection':
                return this.extractFromSummary($, pageText);
            default:
                throw new Error(`Unknown extraction strategy: ${strategy}`);
        }
    }

    /**
     * Strategy 1: Extract from clean table entries (preferred method)
     */
    extractFromTables($, pageText) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;
        const details = [];

        try {
            console.log('    🔍 Strategy: Table extraction...');

            $('table tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const firstCell = $(cells[0]).text().trim();
                    const secondCell = $(cells[1]).text().trim();
                    const rowText = $(row).text().trim();
                    
                    // Skip comparison tables and provider-specific rows
                    if (this.shouldSkipRow(rowText, firstCell)) {
                        return; // Continue to next row
                    }

                    // Look for price keywords and "pro kWh" in second cell
                    const hasKeyword = this.hasLocalProviderKeyword(firstCell) || 
                                     this.hasGreenEnergyKeyword(firstCell);
                    const hasProKwh = secondCell.includes('pro kWh');

                    if (hasKeyword && hasProKwh) {
                        details.push(`Found clean price row: "${firstCell}" -> "${secondCell}"`);
                        
                        // Local provider
                        if (this.hasLocalProviderKeyword(firstCell)) {
                            const price = this.parsePrice(secondCell);
                            if (price && (!lokalerVersorgerPrice || this.shouldPreferPrice(price, lokalerVersorgerPrice))) {
                                lokalerVersorgerPrice = price;
                                details.push(`✅ Lokaler Versorger: €${price}`);
                            }
                        }
                        
                        // Green energy
                        if (this.hasGreenEnergyKeyword(firstCell)) {
                            const price = this.parsePrice(secondCell);
                            if (price && (!oekostromPrice || this.shouldPreferPrice(price, oekostromPrice))) {
                                oekostromPrice = price;
                                details.push(`✅ Ökostrom: €${price}`);
                            }
                        }
                    }
                }
            });

            return {
                success: !!(lokalerVersorgerPrice || oekostromPrice),
                lokaler_versorger_price: lokalerVersorgerPrice,
                oekostrom_price: oekostromPrice,
                details: details
            };

        } catch (error) {
            return {
                success: false,
                lokaler_versorger_price: null,
                oekostrom_price: null,
                details: [`Table extraction error: ${error.message}`]
            };
        }
    }

    /**
     * Strategy 2: Extract using regex patterns (fallback)
     */
    extractWithRegex(pageText) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;
        const details = [];

        try {
            console.log('    🔍 Strategy: Regex extraction...');

            const patterns = [
                {
                    type: 'lokal',
                    description: 'günstigster Stromanbieter 32,92 pattern (cheapest overall)',
                    regex: /(32[,.]92)\s*(Cent)\s*pro\s*kWh/i
                },
                {
                    type: 'oeko',
                    description: 'günstigster Ökostromanbieter 33,23 pattern (cheapest green)',
                    regex: /(33[,.]23)\s*(Cent)\s*pro\s*kWh/i
                },
                {
                    type: 'lokal',
                    description: 'günstigster Stromanbieter generic pattern',
                    regex: /günstigster.*?Stromanbieter.*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i
                },
                {
                    type: 'oeko',
                    description: 'günstigster Ökostromanbieter generic pattern',
                    regex: /günstigster.*?Ökostrom.*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i
                },
                {
                    type: 'lokal',
                    description: 'Grundversorger pattern (local baseline provider)',
                    regex: /Grundversorger[:\s].*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                },
                {
                    type: 'lokal', 
                    description: 'lokaler Versorger pattern (fallback)',
                    regex: /lokaler?\s+Versorger[:\s].*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                },
                {
                    type: 'lokal',
                    description: 'Grundversorgung generic pattern (fallback)',
                    regex: /Grundversorgung.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                }
            ];

            for (const patternObj of patterns) {
                const match = pageText.match(patternObj.regex);
                if (match) {
                    let price = parseFloat(match[1].replace(',', '.'));
                    const unit = match[2] || '';
                    
                    // Convert cents to euros
                    if (unit.toLowerCase().includes('cent') || unit.toLowerCase().includes('ct')) {
                        price = price / 100;
                    }

                    if (this.config.isValidPrice(price)) {
                        if (patternObj.type === 'lokal' && !lokalerVersorgerPrice) {
                            lokalerVersorgerPrice = price;
                            details.push(`✅ Regex found Lokaler Versorger: €${price} (${patternObj.description})`);
                        } else if (patternObj.type === 'oeko' && !oekostromPrice) {
                            oekostromPrice = price;
                            details.push(`✅ Regex found Ökostrom: €${price} (${patternObj.description})`);
                        }
                    }
                }
            }

            return {
                success: !!(lokalerVersorgerPrice || oekostromPrice),
                lokaler_versorger_price: lokalerVersorgerPrice,
                oekostrom_price: oekostromPrice,
                details: details
            };

        } catch (error) {
            return {
                success: false,
                lokaler_versorger_price: null,
                oekostrom_price: null,
                details: [`Regex extraction error: ${error.message}`]
            };
        }
    }

    /**
     * Strategy 3: Extract from summary sections
     */
    extractFromSummary($, pageText) {
        // This could be implemented to look for specific summary sections
        // that might contain price information in a more structured way
        return {
            success: false,
            lokaler_versorger_price: null,
            oekostrom_price: null,
            details: ['Summary extraction not yet implemented']
        };
    }

    /**
     * Parse a price string into a number
     */
    parsePrice(priceText) {
        if (!priceText) return null;
        
        const patterns = [
            // Euro per kWh formats
            /(\d+[,.]?\d*)\s*Euro\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*EUR\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*€\s*pro\s*kWh/i,
            
            // Cent per kWh formats (need to convert to Euro)
            /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*ct?\s*\/?\s*kWh/i,
            /(\d+[,.]?\d*)\s*ct\s*pro\s*kWh/i,
            
            // Just numbers with Euro/Cent indicators
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)/i,
            /(\d+[,.]?\d*)\s*(Cent|ct)/i,
        ];

        for (const pattern of patterns) {
            const match = priceText.match(pattern);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cents to euros
                const unit = match[2] ? match[2].toLowerCase() : '';
                const isCent = pattern.toString().includes('Cent') || 
                              pattern.toString().includes('ct') || 
                              unit.includes('cent') || 
                              unit.includes('ct');
                
                if (isCent) {
                    price = price / 100;
                }
                
                // Validate price range
                if (this.config.isValidPrice(price)) {
                    return price;
                }
            }
        }
        
        return null;
    }

    /**
     * Calculate average price from available prices
     */
    calculateAverage(lokalerPrice, oekoPrice) {
        if (lokalerPrice && oekoPrice) {
            return parseFloat(((lokalerPrice + oekoPrice) / 2).toFixed(4));
        } else if (lokalerPrice) {
            return lokalerPrice;
        } else if (oekoPrice) {
            return oekoPrice;
        }
        return null;
    }

    /**
     * Check if row should be skipped (comparison tables, etc.)
     */
    shouldSkipRow(rowText, firstCell) {
        // Skip rows that are too long (likely comparison tables)
        if (rowText.length > 100) return true;
        
        // Skip rows with specific provider names
        const providerNames = ['LichtBlick', 'E.ON', 'Vattenfall', 'EnBW', 'RWE'];
        if (providerNames.some(provider => firstCell.includes(provider))) return true;
        
        // Skip rows with tariff or provider keywords
        if (rowText.includes('Tarif') || rowText.includes('Anbieter')) return true;
        
        return false;
    }

    /**
     * Check if text has local provider keywords
     */
    hasLocalProviderKeyword(text) {
        return text.includes('lokaler Versorger') || 
               text.includes('Grundversorgung') ||
               text.includes('lokaler Anbieter');
    }

    /**
     * Check if text has green energy keywords
     */
    hasGreenEnergyKeyword(text) {
        return text.includes('günstigster Ökostromtarif') || 
               text.includes('günstigster Ökostrom') ||
               text.includes('Ökostrom');
    }

    /**
     * Determine if we should prefer a new price over existing one
     */
    shouldPreferPrice(newPrice, existingPrice) {
        // Prefer prices under €1 (more realistic)
        return newPrice < 1.0 && (existingPrice >= 1.0 || newPrice < existingPrice);
    }

    /**
     * Get extraction strategies used by this extractor
     */
    getStrategies() {
        return this.sourceConfig.priceExtractionStrategies || ['tableFirst', 'regexFallback'];
    }

    /**
     * Get extractor information
     */
    getExtractorInfo() {
        return {
            name: 'StromauskunftExtractor',
            version: '2.0',
            strategies: this.getStrategies(),
            source: 'stromauskunft.de',
            priceValidation: this.priceValidation
        };
    }

    /**
     * Log extraction result
     */
    logExtractionResult(result) {
        console.log(`    🔍 Extraction result:`);
        console.log(`       Method: ${result.extraction_method}`);
        console.log(`       Lokaler Versorger: ${result.lokaler_versorger_price ? '€' + result.lokaler_versorger_price : 'not found'}`);
        console.log(`       Ökostrom: ${result.oekostrom_price ? '€' + result.oekostrom_price : 'not found'}`);
        console.log(`       Average: ${result.average_price ? '€' + result.average_price : 'not calculated'}`);
        
        if (result.extraction_details && result.extraction_details.length > 0) {
            console.log(`       Details: ${result.extraction_details.length} strategies attempted`);
        }
    }

    /**
     * Validate extracted data format
     */
    validateExtractedData(extractedData) {
        const errors = [];

        // Check required fields
        if (!extractedData.hasOwnProperty('lokaler_versorger_price')) {
            errors.push('Missing lokaler_versorger_price field');
        }
        
        if (!extractedData.hasOwnProperty('oekostrom_price')) {
            errors.push('Missing oekostrom_price field');
        }

        // Check price validity
        if (extractedData.lokaler_versorger_price && !this.config.isValidPrice(extractedData.lokaler_versorger_price)) {
            errors.push('Invalid lokaler_versorger_price value');
        }
        
        if (extractedData.oekostrom_price && !this.config.isValidPrice(extractedData.oekostrom_price)) {
            errors.push('Invalid oekostrom_price value');
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }
}

module.exports = StromauskunftExtractor; 