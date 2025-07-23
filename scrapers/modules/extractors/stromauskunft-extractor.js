/**
 * Enhanced Stromauskunft.de Price Extractor v2.0
 * Improved based on comprehensive 100-city DOM analysis
 * Handles format variations and different city sizes
 */

const { IPriceExtractor } = require('../interfaces');
const cheerio = require('cheerio');

class StromauskunftExtractor extends IPriceExtractor {
    constructor(config) {
        super(config);
        this.sourceConfig = config.getSourceConfig('stromauskunft');
        this.priceValidation = config.getPriceValidation();
        
        // Analysis-based city classification
        this.cityClassification = {
            small: { maxTables: 1, maxRows: 3, commonFormats: ['cent'] },
            medium: { maxTables: 2, maxRows: 8, commonFormats: ['euro', 'cent'] },
            large: { maxTables: 4, maxRows: 20, commonFormats: ['euro', 'cent'] }
        };
    }

    /**
     * Extract prices with enhanced strategy based on city analysis
     */
    extractPrices(html, pageText, url) {
        try {
            const $ = cheerio.load(html);
            
            // Classify city size based on DOM structure
            const cityClass = this.classifyCitySize($);
            console.log(`    📊 Detected city class: ${cityClass.type} (${cityClass.tables} tables, ${cityClass.rows} rows)`);
            
            let result = {
                lokaler_versorger_price: null,
                oekostrom_price: null,
                average_price: null,
                extraction_method: null,
                extraction_details: [],
                city_classification: cityClass,
                dom_structure: this.analyzeDOMStructure($)
            };

            // Apply size-specific extraction strategies
            const strategies = this.getStrategiesForCityClass(cityClass.type);
            
            for (const strategy of strategies) {
                console.log(`    🔍 Trying strategy: ${strategy} for ${cityClass.type} city`);
                const strategyResult = this.applyExtractionStrategy(strategy, $, pageText, url, cityClass);
                
                // Update result with found prices
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
                    cityClass: cityClass.type,
                    success: strategyResult.success,
                    found_prices: {
                        lokaler: !!strategyResult.lokaler_versorger_price,
                        oeko: !!strategyResult.oekostrom_price
                    },
                    format_detected: strategyResult.format_detected,
                    details: strategyResult.details
                });

                // Break if we found both prices
                if (result.lokaler_versorger_price && result.oekostrom_price) {
                    console.log(`    ✅ Both prices found using ${strategy}`);
                    break;
                }
            }

            // Validate price logic: Grundversorger should be higher than cheapest tariff
            const validation = this.validatePriceLogic(result);
            if (!validation.valid) {
                console.log(`    ⚠️  Price logic validation failed: ${validation.issue}`);
                // Swap prices if logic is backwards
                if (validation.shouldSwap) {
                    const temp = result.lokaler_versorger_price;
                    result.lokaler_versorger_price = result.oekostrom_price;
                    result.oekostrom_price = temp;
                    console.log(`    🔄 Swapped prices: Lokaler=${result.lokaler_versorger_price?.toFixed(3)}, Öko=${result.oekostrom_price?.toFixed(3)}`);
                    result.extraction_details.push({
                        strategy: 'price_logic_correction',
                        action: 'swapped_prices',
                        reason: validation.issue
                    });
                }
            }

            // Calculate average if both prices found
            if (result.lokaler_versorger_price && result.oekostrom_price) {
                result.average_price = ((result.lokaler_versorger_price + result.oekostrom_price) / 2);
            }

            return result;

        } catch (error) {
            console.error('❌ Error in price extraction:', error.message);
            return {
                lokaler_versorger_price: null,
                oekostrom_price: null,
                average_price: null,
                extraction_method: 'failed',
                error: error.message,
                extraction_details: []
            };
        }
    }

    /**
     * Classify city size based on DOM structure analysis
     */
    classifyCitySize($) {
        const tables = $('table').length;
        const rows = $('table tr').length;
        const hasComparisonTables = $('table').filter((i, table) => {
            const tableText = $(table).text();
            return tableText.includes('Vergleich') || tableText.includes('Anbieter');
        }).length;

        let type = 'medium'; // Default
        
        if (tables <= 1 && rows <= 3) {
            type = 'small';
        } else if (tables >= 3 && rows >= 15) {
            type = 'large';
        }

        return {
            type,
            tables,
            rows,
            hasComparisonTables: hasComparisonTables > 0,
            complexity: rows >= 15 ? 'high' : rows >= 6 ? 'medium' : 'low'
        };
    }

    /**
     * Get extraction strategies optimized for city class
     */
    getStrategiesForCityClass(cityClass) {
        switch (cityClass) {
            case 'small':
                return ['regexSimple', 'tableSimple'];
            case 'medium':
                return ['tableStandard', 'regexStandard', 'tableFirst'];
            case 'large':
                return ['tableComplex', 'regexAdvanced', 'tableStandard'];
            default:
                return ['tableStandard', 'regexStandard', 'tableFirst'];
        }
    }

    /**
     * Apply specific extraction strategy with city class context
     */
    applyExtractionStrategy(strategy, $, pageText, url, cityClass) {
        switch (strategy) {
            case 'tableSimple':
                return this.extractFromTablesSimple($, cityClass);
            case 'tableStandard':
                return this.extractFromTablesStandard($, cityClass);
            case 'tableComplex':
                return this.extractFromTablesComplex($, cityClass);
            case 'tableFirst':
                return this.extractFromTablesFirst($);
            case 'regexSimple':
                return this.extractWithRegexSimple(pageText);
            case 'regexStandard':
                return this.extractWithRegexStandard(pageText);
            case 'regexAdvanced':
                return this.extractWithRegexAdvanced(pageText);
            default:
                return { success: false, details: 'Unknown strategy' };
        }
    }

    /**
     * Simple table extraction for small cities
     */
    extractFromTablesSimple($, cityClass) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;
        const details = [];
        let formatDetected = null;

        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = $(cells[1]).text().trim();
                
                // Simple keyword matching for small cities
                if (this.hasLocalProviderKeyword(firstCell) && this.containsPriceInfo(secondCell)) {
                    const priceInfo = this.extractPriceFromText(secondCell);
                    if (priceInfo.price) {
                        lokalerVersorgerPrice = priceInfo.price;
                        formatDetected = priceInfo.format;
                        details.push(`Found lokaler: ${priceInfo.original} -> ${priceInfo.price}`);
                    }
                }
                
                if (this.hasGreenEnergyKeyword(firstCell) && this.containsPriceInfo(secondCell)) {
                    const priceInfo = this.extractPriceFromText(secondCell);
                    if (priceInfo.price) {
                        oekostromPrice = priceInfo.price;
                        formatDetected = priceInfo.format;
                        details.push(`Found oeko: ${priceInfo.original} -> ${priceInfo.price}`);
                    }
                }
            }
        });

        return {
            success: !!(lokalerVersorgerPrice || oekostromPrice),
            lokaler_versorger_price: lokalerVersorgerPrice,
            oekostrom_price: oekostromPrice,
            format_detected: formatDetected,
            details: details
        };
    }

    /**
     * Standard table extraction for medium cities
     */
    extractFromTablesStandard($, cityClass) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;
        const details = [];
        let formatDetected = null;

        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = $(cells[1]).text().trim();
                const rowText = $(row).text().trim();
                
                // Skip comparison tables
                if (this.shouldSkipRow(rowText, firstCell)) {
                    return;
                }

                // Enhanced keyword matching - prioritize baseline provider detection
                if (this.hasLocalProviderKeywordEnhanced(firstCell) && this.containsPriceInfo(secondCell)) {
                    const priceInfo = this.extractPriceFromText(secondCell);
                    if (priceInfo.price && this.isValidPrice(priceInfo.price)) {
                        lokalerVersorgerPrice = priceInfo.price;
                        formatDetected = priceInfo.format;
                        details.push(`Found lokaler (baseline): ${firstCell} -> ${priceInfo.original} -> ${priceInfo.price}`);
                    }
                }
                
                if (this.hasGreenEnergyKeywordEnhanced(firstCell) && this.containsPriceInfo(secondCell)) {
                    const priceInfo = this.extractPriceFromText(secondCell);
                    if (priceInfo.price && this.isValidPrice(priceInfo.price)) {
                        oekostromPrice = priceInfo.price;
                        formatDetected = priceInfo.format;
                        details.push(`Found oeko (green): ${firstCell} -> ${priceInfo.original} -> ${priceInfo.price}`);
                    }
                }

                // Check for cheapest tariff - this should NOT be lokaler price
                if (this.hasCheapestTariffKeyword(firstCell) && this.containsPriceInfo(secondCell)) {
                    const priceInfo = this.extractPriceFromText(secondCell);
                    if (priceInfo.price && this.isValidPrice(priceInfo.price)) {
                        // If we haven't found an Öko price yet, this cheapest might be it
                        if (!oekostromPrice) {
                            oekostromPrice = priceInfo.price;
                            formatDetected = priceInfo.format;
                            details.push(`Found cheapest as oeko: ${firstCell} -> ${priceInfo.original} -> ${priceInfo.price}`);
                        }
                    }
                }
            }
        });

        return {
            success: !!(lokalerVersorgerPrice || oekostromPrice),
            lokaler_versorger_price: lokalerVersorgerPrice,
            oekostrom_price: oekostromPrice,
            format_detected: formatDetected,
            details: details
        };
    }

    /**
     * Complex table extraction for large cities
     */
    extractFromTablesComplex($, cityClass) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;
        const details = [];
        let formatDetected = null;

        // For large cities, check multiple table structures
        $('table').each((tableIndex, table) => {
            const tableText = $(table).text();
            
            // Skip provider comparison tables
            if (tableText.includes('Vergleich') || tableText.includes('Tarif')) {
                return;
            }

            $(table).find('tr').each((i, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const firstCell = $(cells[0]).text().trim();
                    const secondCell = $(cells[1]).text().trim();
                    
                    // More sophisticated matching for complex layouts
                    if (this.hasLocalProviderKeywordComplex(firstCell) && this.containsPriceInfo(secondCell)) {
                        const priceInfo = this.extractPriceFromText(secondCell);
                        if (priceInfo.price && this.isValidPrice(priceInfo.price) && !lokalerVersorgerPrice) {
                            lokalerVersorgerPrice = priceInfo.price;
                            formatDetected = priceInfo.format;
                            details.push(`Found lokaler (table ${tableIndex}): ${firstCell} -> ${priceInfo.price}`);
                        }
                    }
                    
                    if (this.hasGreenEnergyKeywordComplex(firstCell) && this.containsPriceInfo(secondCell)) {
                        const priceInfo = this.extractPriceFromText(secondCell);
                        if (priceInfo.price && this.isValidPrice(priceInfo.price) && !oekostromPrice) {
                            oekostromPrice = priceInfo.price;
                            formatDetected = priceInfo.format;
                            details.push(`Found oeko (table ${tableIndex}): ${firstCell} -> ${priceInfo.price}`);
                        }
                    }
                }
            });
        });

        return {
            success: !!(lokalerVersorgerPrice || oekostromPrice),
            lokaler_versorger_price: lokalerVersorgerPrice,
            oekostrom_price: oekostromPrice,
            format_detected: formatDetected,
            details: details
        };
    }

    /**
     * Enhanced price extraction from text with format detection
     */
    extractPriceFromText(text) {
        // Remove common prefixes/suffixes
        const cleanText = text.replace(/[^\d,.\s€EuroCentprokWh]/gi, ' ').trim();
        
        // Enhanced patterns for both Euro and Cent formats
        const patterns = [
            // Euro patterns
            { regex: /(\d+[,.]?\d*)\s*€?\s*pro\s*kWh/i, format: 'euro' },
            { regex: /(\d+[,.]?\d*)\s*Euro?\s*pro\s*kWh/i, format: 'euro' },
            { regex: /(\d+[,.]?\d*)\s*EUR?\s*pro\s*kWh/i, format: 'euro' },
            
            // Cent patterns
            { regex: /(\d+[,.]?\d*)\s*Cent?\s*pro\s*kWh/i, format: 'cent' },
            { regex: /(\d+[,.]?\d*)\s*ct?\s*pro\s*kWh/i, format: 'cent' },
            
            // Fallback patterns
            { regex: /(\d+[,.]?\d*)\s*pro\s*kWh/i, format: 'unknown' },
            { regex: /(\d+[,.]?\d*)/i, format: 'unknown' }
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern.regex);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cent to euro if needed
                if (pattern.format === 'cent') {
                    price = price / 100;
                } else if (pattern.format === 'unknown' && price > 10) {
                    // Assume it's cents if > 10
                    price = price / 100;
                }

                return {
                    price: price,
                    format: pattern.format,
                    original: match[0],
                    converted: pattern.format === 'cent'
                };
            }
        }

        return { price: null, format: null, original: text };
    }

    /**
     * Enhanced keyword detection methods
     */
    hasLocalProviderKeywordEnhanced(text) {
        const keywords = [
            'grundversorger', 'lokaler versorger', 'lokaler anbieter',
            'ortsversorger', 'stadtwerk', 'basisversorger'
        ];
        return keywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    hasGreenEnergyKeywordEnhanced(text) {
        const keywords = [
            'ökostrom', 'ökostromanbieter', 'günstigster ökostrom',
            'ökostromtarif', 'grünstrom', 'naturstrom'
        ];
        return keywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    hasLocalProviderKeywordComplex(text) {
        const keywords = [
            'grundversorger', 'lokaler versorger', 'basisversorger',
            'ortsversorger', 'stadtwerk', 'kommunaler versorger',
            'lokaler anbieter'
        ];
        return keywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    hasGreenEnergyKeywordComplex(text) {
        const keywords = [
            'ökostrom', 'ökostromanbieter', 'günstigster ökostrom',
            'ökostromtarif', 'grünstrom', 'naturstrom', 'erneuerbarer strom',
            'günstigster ökostromanbieter'
        ];
        return keywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    /**
     * Detect cheapest tariff keywords (should be the lower price)
     */
    hasCheapestTariffKeyword(text) {
        const keywords = [
            'günstigster stromanbieter', 'günstigster tarif', 
            'günstigster anbieter', 'billigster anbieter'
        ];
        return keywords.some(keyword => text.toLowerCase().includes(keyword));
    }

    /**
     * Check if text contains price information
     */
    containsPriceInfo(text) {
        return /\d+[,.]?\d*\s*(€|Euro|EUR|Cent|ct)?\s*pro\s*kWh/i.test(text) ||
               /\d+[,.]?\d*\s*(€|Euro|EUR|Cent|ct)/i.test(text);
    }

    /**
     * Validate price logic: Grundversorger should typically be higher than cheapest tariffs
     */
    validatePriceLogic(result) {
        const lokalerPrice = result.lokaler_versorger_price;
        const oekoPrice = result.oekostrom_price;

        // If we don't have both prices, can't validate
        if (!lokalerPrice || !oekoPrice) {
            return { valid: true, issue: null, shouldSwap: false };
        }

        // Grundversorger (lokaler) should typically be higher than günstigster Ökostrom
        // But there can be exceptions, so we use a reasonable threshold
        const priceDifference = lokalerPrice - oekoPrice;
        const percentageDifference = Math.abs(priceDifference) / Math.max(lokalerPrice, oekoPrice);

        // If lokaler is significantly cheaper (more than 10% cheaper), it's likely wrong
        if (priceDifference < -0.05 && percentageDifference > 0.1) {
            return {
                valid: false,
                issue: `Lokaler price (${lokalerPrice.toFixed(3)}) significantly cheaper than Öko price (${oekoPrice.toFixed(3)})`,
                shouldSwap: true
            };
        }

        // If lokaler is extremely cheaper (more than 30% cheaper), definitely wrong
        if (priceDifference < 0 && percentageDifference > 0.3) {
            return {
                valid: false,
                issue: `Lokaler price (${lokalerPrice.toFixed(3)}) extremely cheaper than Öko price (${oekoPrice.toFixed(3)})`,
                shouldSwap: true
            };
        }

        return { valid: true, issue: null, shouldSwap: false };
    }

    /**
     * Validate price range
     */
    isValidPrice(price) {
        return price && price >= this.priceValidation.minPrice && price <= this.priceValidation.maxPrice;
    }

    /**
     * Analyze DOM structure for debugging
     */
    analyzeDOMStructure($) {
        const tables = $('table');
        const structure = {
            totalTables: tables.length,
            totalRows: $('table tr').length,
            tablesWithPrices: 0,
            textContent: $.text().length
        };

        tables.each((i, table) => {
            const tableText = $(table).text();
            if (/\d+[,.]?\d*\s*(€|Euro|EUR|Cent|ct)?\s*pro\s*kWh/i.test(tableText)) {
                structure.tablesWithPrices++;
            }
        });

        return structure;
    }

    // Legacy methods for backward compatibility
    hasLocalProviderKeyword(text) {
        return this.hasLocalProviderKeywordEnhanced(text);
    }

    hasGreenEnergyKeyword(text) {
        return this.hasGreenEnergyKeywordEnhanced(text);
    }

    shouldSkipRow(rowText, firstCell) {
        const skipKeywords = [
            'vergleich', 'anbieter vergleichen', 'tarif vergleichen',
            'mehr anbieter', 'alle anbieter', 'weitere tarife'
        ];
        
        // Skip rows with annual costs (EUR/Jahr) instead of per-kWh rates
        const annualCostPatterns = [
            'eur / jahr', 'euro / jahr', '€ / jahr',
            'eur/jahr', 'euro/jahr', '€/jahr',
            'eur pro jahr', 'euro pro jahr', '€ pro jahr'
        ];
        
        const rowTextLower = rowText.toLowerCase();
        
        // Check for comparison keywords
        if (skipKeywords.some(keyword => rowTextLower.includes(keyword))) {
            return true;
        }
        
        // Check for annual cost patterns
        if (annualCostPatterns.some(pattern => rowTextLower.includes(pattern))) {
            return true;
        }
        
        return false;
    }

    extractFromTablesFirst($) {
        return this.extractFromTablesStandard($, { type: 'medium' });
    }

    extractWithRegexSimple(pageText) {
        return this.extractWithRegexStandard(pageText);
    }

    extractWithRegexStandard(pageText) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;
        const details = [];

        const patterns = [
            {
                type: 'lokal',
                description: 'Grundversorger pattern (baseline provider)',
                regex: /Grundversorger[:\s].*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
            },
            {
                type: 'lokal',
                description: 'Lokaler Versorger pattern (baseline provider)',
                regex: /lokaler?\s+Versorger[:\s].*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
            },
            {
                type: 'oeko',
                description: 'Günstigster Ökostrom pattern (cheapest green)',
                regex: /günstigster.*?Ökostrom.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
            },
            {
                type: 'oeko',
                description: 'Günstigster Ökostromanbieter pattern (cheapest green provider)',
                regex: /günstigster.*?Ökostromanbieter.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
            }
        ];

        for (const pattern of patterns) {
            const match = pageText.match(pattern.regex);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                const unit = match[2] ? match[2].toLowerCase() : 'unknown';
                
                // Convert cent to euro
                if (unit.includes('cent') || unit.includes('ct')) {
                    price = price / 100;
                } else if (unit === 'unknown' && price > 10) {
                    price = price / 100;
                }

                if (this.isValidPrice(price)) {
                    if (pattern.type === 'lokal' && !lokalerVersorgerPrice) {
                        lokalerVersorgerPrice = price;
                        details.push(`Found lokaler via regex: ${match[0]} -> ${price}`);
                    } else if (pattern.type === 'oeko' && !oekostromPrice) {
                        oekostromPrice = price;
                        details.push(`Found oeko via regex: ${match[0]} -> ${price}`);
                    }
                }
            }
        }

        return {
            success: !!(lokalerVersorgerPrice || oekostromPrice),
            lokaler_versorger_price: lokalerVersorgerPrice,
            oekostrom_price: oekostromPrice,
            format_detected: 'mixed',
            details: details
        };
    }

    extractWithRegexAdvanced(pageText) {
        // Enhanced regex for large cities with more complex structures
        return this.extractWithRegexStandard(pageText);
    }
}

module.exports = StromauskunftExtractor; 