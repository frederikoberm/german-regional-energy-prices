/**
 * Data Quality Cleanup Service
 * Identifies and fixes problematic entries in the electricity price database
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const SupabaseClient = require('../database/supabase-client');

class DataQualityCleanup {
    constructor() {
        this.db = new SupabaseClient();
        this.results = {
            total_checked: 0,
            outliers_found: 0,
            missing_prices: 0,
            invalid_relationships: 0,
            successfully_fixed: 0,
            still_problematic: 0,
            errors: []
        };
        this.delay = 2000; // 2 seconds between requests
        this.validationThresholds = {
            min_price: 0.05,
            max_reasonable_price: 0.80, // Most prices should be under 80 cents
            outlier_threshold: 1.0,      // Prices over €1 are likely wrong
            extreme_threshold: 1.50      // Prices over €1.50 are almost certainly wrong
        };
    }

    /**
     * Find all problematic entries in the database
     */
    async findProblematicEntries(month = null) {
        console.log('🔍 Scanning database for quality issues...');
        
        try {
            // Get ALL entries using pagination (Supabase default limit is 1000)
            const allData = [];
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;

            console.log('📊 Fetching all entries from database...');

            while (hasMore) {
                let query = this.db.supabase
                    .from('monthly_electricity_prices')
                    .select('*')
                    .range(offset, offset + batchSize - 1);
                
                if (month) {
                    query = query.eq('data_month', month);
                }
                
                const { data, error } = await query;
                if (error) throw error;

                allData.push(...data);
                
                console.log(`   Fetched batch: ${data.length} entries (total so far: ${allData.length})`);

                // Check if we got a full batch (meaning there might be more)
                hasMore = data.length === batchSize;
                offset += batchSize;
            }

            console.log(`📊 Analyzing ${allData.length} entries...`);

            const problematicEntries = [];

            for (const entry of allData) {
                const issues = this.analyzeEntryQuality(entry);
                if (issues.length > 0) {
                    problematicEntries.push({
                        ...entry,
                        quality_issues: issues
                    });
                }
            }

            // Categorize by issue type
            const categorized = {
                outliers: problematicEntries.filter(e => 
                    e.quality_issues.some(i => i.type === 'outlier')),
                missing_prices: problematicEntries.filter(e => 
                    e.quality_issues.some(i => i.type === 'missing_price')),
                invalid_relationships: problematicEntries.filter(e => 
                    e.quality_issues.some(i => i.type === 'invalid_relationship')),
                extreme_outliers: problematicEntries.filter(e => 
                    e.quality_issues.some(i => i.type === 'extreme_outlier'))
            };

            console.log(`\n📋 Quality Issues Found:`);
            console.log(`   🚨 Outliers (${this.validationThresholds.outlier_threshold}€+): ${categorized.outliers.length}`);
            console.log(`   💥 Extreme outliers (${this.validationThresholds.extreme_threshold}€+): ${categorized.extreme_outliers.length}`);
            console.log(`   ❓ Missing prices: ${categorized.missing_prices.length}`);
            console.log(`   ⚠️  Invalid relationships: ${categorized.invalid_relationships.length}`);
            console.log(`   📊 Total problematic entries: ${problematicEntries.length}`);

            return {
                all: problematicEntries,
                categorized,
                summary: {
                    total_entries: allData.length,
                    problematic_entries: problematicEntries.length,
                    outliers: categorized.outliers.length,
                    extreme_outliers: categorized.extreme_outliers.length,
                    missing_prices: categorized.missing_prices.length,
                    invalid_relationships: categorized.invalid_relationships.length
                }
            };

        } catch (error) {
            console.error('❌ Error finding problematic entries:', error.message);
            throw error;
        }
    }

    /**
     * Analyze a single entry for quality issues
     */
    analyzeEntryQuality(entry) {
        const issues = [];
        const lokaler = parseFloat(entry.lokaler_versorger_price);
        const oeko = parseFloat(entry.oekostrom_price);

        // Check for outliers
        if (lokaler && lokaler >= this.validationThresholds.extreme_threshold) {
            issues.push({
                type: 'extreme_outlier',
                field: 'lokaler_versorger_price',
                value: lokaler,
                message: `Lokaler price €${lokaler.toFixed(4)} is extremely high (≥€${this.validationThresholds.extreme_threshold})`
            });
        } else if (lokaler && lokaler >= this.validationThresholds.outlier_threshold) {
            issues.push({
                type: 'outlier',
                field: 'lokaler_versorger_price',
                value: lokaler,
                message: `Lokaler price €${lokaler.toFixed(4)} is high (≥€${this.validationThresholds.outlier_threshold})`
            });
        }

        if (oeko && oeko >= this.validationThresholds.extreme_threshold) {
            issues.push({
                type: 'extreme_outlier',
                field: 'oekostrom_price',
                value: oeko,
                message: `Öko price €${oeko.toFixed(4)} is extremely high (≥€${this.validationThresholds.extreme_threshold})`
            });
        } else if (oeko && oeko >= this.validationThresholds.outlier_threshold) {
            issues.push({
                type: 'outlier',
                field: 'oekostrom_price',
                value: oeko,
                message: `Öko price €${oeko.toFixed(4)} is high (≥€${this.validationThresholds.outlier_threshold})`
            });
        }

        // Check for missing prices
        if (!lokaler && !oeko) {
            issues.push({
                type: 'missing_price',
                field: 'both',
                message: 'Both prices are missing'
            });
        } else if (!lokaler) {
            issues.push({
                type: 'missing_price',
                field: 'lokaler_versorger_price',
                message: 'Lokaler Versorger price is missing'
            });
        } else if (!oeko) {
            issues.push({
                type: 'missing_price',
                field: 'oekostrom_price',
                message: 'Ökostrom price is missing'
            });
        }

        // Check for invalid price relationships (lokaler should generally be higher than öko)
        if (lokaler && oeko && lokaler < oeko) {
            // Allow small differences (within 2 cents) as this can happen
            const difference = oeko - lokaler;
            if (difference > 0.02) {
                issues.push({
                    type: 'invalid_relationship',
                    field: 'price_relationship',
                    message: `Lokaler (€${lokaler.toFixed(4)}) is significantly cheaper than Öko (€${oeko.toFixed(4)}) by €${difference.toFixed(4)}`
                });
            }
        }

        return issues;
    }

    /**
     * Enhanced price extraction with improved patterns and validation
     */
    async extractPricesFromPage(html, url, cityName, plz) {
        const $ = cheerio.load(html);
        const pageText = $.text();
        
        console.log(`    🔍 Extracting prices for ${cityName} (${plz})...`);
        
        let lokalerPrice = null;
        let oekoPrice = null;
        const extractionDetails = [];

        // Strategy 1: Enhanced table-based extraction
        console.log(`    📋 Strategy 1: Table-based extraction...`);
        const tableResult = this.extractFromTablesEnhanced($, pageText);
        if (tableResult.lokaler && !lokalerPrice) {
            lokalerPrice = tableResult.lokaler;
            extractionDetails.push(`Table extraction: lokaler = €${lokalerPrice}`);
        }
        if (tableResult.oeko && !oekoPrice) {
            oekoPrice = tableResult.oeko;
            extractionDetails.push(`Table extraction: öko = €${oekoPrice}`);
        }

        // Strategy 2: Enhanced regex patterns
        if (!lokalerPrice || !oekoPrice) {
            console.log(`    🔤 Strategy 2: Enhanced regex patterns...`);
            const regexResult = this.extractWithEnhancedRegex(pageText);
            if (regexResult.lokaler && !lokalerPrice) {
                lokalerPrice = regexResult.lokaler;
                extractionDetails.push(`Regex extraction: lokaler = €${lokalerPrice}`);
            }
            if (regexResult.oeko && !oekoPrice) {
                oekoPrice = regexResult.oeko;
                extractionDetails.push(`Regex extraction: öko = €${oekoPrice}`);
            }
        }

        // Strategy 3: Context-aware extraction (for complex pages)
        if (!lokalerPrice || !oekoPrice) {
            console.log(`    🧠 Strategy 3: Context-aware extraction...`);
            const contextResult = this.extractWithContext($, pageText, cityName);
            if (contextResult.lokaler && !lokalerPrice) {
                lokalerPrice = contextResult.lokaler;
                extractionDetails.push(`Context extraction: lokaler = €${lokalerPrice}`);
            }
            if (contextResult.oeko && !oekoPrice) {
                oekoPrice = contextResult.oeko;
                extractionDetails.push(`Context extraction: öko = €${oekoPrice}`);
            }
        }

        // Validate extracted prices
        const validatedLokalerPrice = this.validatePrice(lokalerPrice, 'lokaler');
        const validatedOekoPrice = this.validatePrice(oekoPrice, 'öko');

        console.log(`    ✅ Final result: Lokaler = €${validatedLokalerPrice || 'null'}, Öko = €${validatedOekoPrice || 'null'}`);

        return {
            lokaler_versorger_price: validatedLokalerPrice,
            oekostrom_price: validatedOekoPrice,
            extraction_details: extractionDetails,
            url: url
        };
    }

    /**
     * Enhanced table extraction with better filtering
     */
    extractFromTablesEnhanced($, pageText) {
        let lokalerPrice = null;
        let oekoPrice = null;

        $('table').each((tableIndex, table) => {
            const tableText = $(table).text();
            
            // Skip tables that look like comparison tables or advertisements
            if (this.isComparisonTable(tableText)) {
                return; // Skip this table
            }

            $(table).find('tr').each((rowIndex, row) => {
                const cells = $(row).find('td, th');
                if (cells.length < 2) return;

                const firstCell = $(cells[0]).text().trim().toLowerCase();
                const secondCell = $(cells[1]).text().trim();
                const rowText = $(row).text().trim();

                // Skip rows that are too complex or contain provider names
                if (this.isComplexRow(rowText)) {
                    return;
                }

                // Look for lokaler versorger
                if (this.isLokalerVersorgerRow(firstCell) && this.containsPrice(secondCell)) {
                    const price = this.parsePrice(secondCell);
                    if (price && this.isReasonablePrice(price) && !lokalerPrice) {
                        lokalerPrice = price;
                    }
                }

                // Look for ökostrom
                if (this.isOekostromRow(firstCell) && this.containsPrice(secondCell)) {
                    const price = this.parsePrice(secondCell);
                    if (price && this.isReasonablePrice(price) && !oekoPrice) {
                        oekoPrice = price;
                    }
                }
            });
        });

        return { lokaler: lokalerPrice, oeko: oekoPrice };
    }

    /**
     * Enhanced regex extraction with more patterns
     */
    extractWithEnhancedRegex(pageText) {
        let lokalerPrice = null;
        let oekoPrice = null;

        const patterns = [
            // Lokaler Versorger patterns
            {
                type: 'lokaler',
                regex: /(?:lokaler?\s+versorger|grundversorger|grundversorgung)[:\s]*.*?(\d+[,.]?\d*)\s*(?:euro|eur|€|cent|ct)?\s*(?:pro\s*)?(?:pro\s+)?kWh/gi
            },
            {
                type: 'lokaler',
                regex: /(?:lokaler?\s+anbieter)[:\s]*.*?(\d+[,.]?\d*)\s*(?:euro|eur|€|cent|ct)?\s*(?:pro\s*)?(?:pro\s+)?kWh/gi
            },
            // Ökostrom patterns
            {
                type: 'oeko',
                regex: /(?:günstigst.*?ökostrom|ökostrom.*?günstigst)[:\s]*.*?(\d+[,.]?\d*)\s*(?:euro|eur|€|cent|ct)?\s*(?:pro\s*)?(?:pro\s+)?kWh/gi
            },
            {
                type: 'oeko',
                regex: /(?:ökostrom)[:\s]*.*?(\d+[,.]?\d*)\s*(?:euro|eur|€|cent|ct)?\s*(?:pro\s*)?(?:pro\s+)?kWh/gi
            }
        ];

        for (const pattern of patterns) {
            const matches = [...pageText.matchAll(pattern.regex)];
            for (const match of matches) {
                const price = this.parsePrice(match[1]);
                if (price && this.isReasonablePrice(price)) {
                    if (pattern.type === 'lokaler' && !lokalerPrice) {
                        lokalerPrice = price;
                    } else if (pattern.type === 'oeko' && !oekoPrice) {
                        oekoPrice = price;
                    }
                }
            }
        }

        return { lokaler: lokalerPrice, oeko: oekoPrice };
    }

    /**
     * Context-aware extraction for complex pages
     */
    extractWithContext($, pageText, cityName) {
        let lokalerPrice = null;
        let oekoPrice = null;

        // Look for section headers and extract nearby prices
        $('h1, h2, h3, h4, div.title, div.header').each((i, header) => {
            const headerText = $(header).text().toLowerCase();
            
            if (headerText.includes('strompreis') || headerText.includes('tarif')) {
                // Look for prices in the next few siblings
                const nextElements = $(header).nextAll().slice(0, 5);
                nextElements.each((j, element) => {
                    const elementText = $(element).text();
                    
                    if (elementText.includes('lokaler') || elementText.includes('grundversorger')) {
                        const price = this.parsePrice(elementText);
                        if (price && this.isReasonablePrice(price) && !lokalerPrice) {
                            lokalerPrice = price;
                        }
                    }
                    
                    if (elementText.includes('ökostrom')) {
                        const price = this.parsePrice(elementText);
                        if (price && this.isReasonablePrice(price) && !oekoPrice) {
                            oekoPrice = price;
                        }
                    }
                });
            }
        });

        return { lokaler: lokalerPrice, oeko: oekoPrice };
    }

    /**
     * Helper methods for price extraction
     */
    isComparisonTable(tableText) {
        const comparisonIndicators = [
            'lichtblick', 'e.on', 'vattenfall', 'enbw', 'rwe', 'eprimo',
            'anbieter', 'tarife', 'vergleich', 'ranking'
        ];
        const lowerText = tableText.toLowerCase();
        return comparisonIndicators.some(indicator => lowerText.includes(indicator));
    }

    isComplexRow(rowText) {
        return rowText.length > 150 || 
               rowText.includes('Anbieter') || 
               rowText.includes('Tarif') ||
               rowText.includes('Vertragslaufzeit');
    }

    isLokalerVersorgerRow(cellText) {
        return cellText.includes('lokaler versorger') ||
               cellText.includes('grundversorger') ||
               cellText.includes('grundversorgung') ||
               cellText.includes('lokaler anbieter');
    }

    isOekostromRow(cellText) {
        return cellText.includes('ökostrom') ||
               cellText.includes('günstigster ökostrom') ||
               cellText.includes('ökostromtarif');
    }

    containsPrice(text) {
        return text.includes('pro kWh') || 
               text.includes('kWh') ||
               text.includes('€') ||
               text.includes('euro') ||
               text.includes('cent');
    }

    isReasonablePrice(price) {
        return price >= this.validationThresholds.min_price && 
               price <= this.validationThresholds.max_reasonable_price;
    }

    /**
     * Enhanced price parsing
     */
    parsePrice(text) {
        if (!text) return null;
        
        const patterns = [
            // Euro per kWh formats
            /(\d+[,.]?\d*)\s*(?:euro|eur|€)\s*(?:pro\s*)?(?:pro\s+)?kWh/i,
            // Cent per kWh formats
            /(\d+[,.]?\d*)\s*(?:cent|ct)\s*(?:pro\s*)?(?:pro\s+)?kWh/i,
            // Just numbers with currency indicators
            /(\d+[,.]?\d*)\s*(?:euro|eur|€)/i,
            /(\d+[,.]?\d*)\s*(?:cent|ct)/i,
            // Numbers followed by kWh (assume euros)
            /(\d+[,.]?\d*)\s*(?:pro\s*)?(?:pro\s+)?kWh/i
        ];

        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = text.match(pattern);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cents to euros for cent patterns
                if (i === 1 || i === 3) { // cent patterns
                    price = price / 100;
                } else if (i === 4 && price > 10) { // assume cents if number is large
                    price = price / 100;
                }
                
                if (price >= this.validationThresholds.min_price && price <= 5.0) {
                    return price;
                }
            }
        }
        return null;
    }

    /**
     * Validate extracted price
     */
    validatePrice(price, type) {
        if (!price) return null;
        
        if (price < this.validationThresholds.min_price || price > 5.0) {
            console.log(`    ⚠️  ${type} price €${price} is outside valid range, discarding`);
            return null;
        }
        
        return price;
    }

    /**
     * Clean up a single problematic entry
     */
    async cleanupEntry(entry) {
        console.log(`\n🔧 Cleaning up: ${entry.city_name} (PLZ: ${entry.plz})`);
        console.log(`   Issues: ${entry.quality_issues.map(i => i.message).join(', ')}`);
        
        try {
            // Re-scrape the original URL
            if (!entry.source_url) {
                console.log(`   ❌ No source URL available, skipping`);
                return { success: false, error: 'No source URL' };
            }

            console.log(`   🌐 Re-scraping: ${entry.source_url}`);
            
            const response = await axios.get(entry.source_url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const extractedPrices = await this.extractPricesFromPage(
                response.data, 
                entry.source_url, 
                entry.city_name, 
                entry.plz
            );

            // Validate the new prices
            const isImprovement = this.validateImprovement(entry, extractedPrices);
            
            if (isImprovement.isValid) {
                console.log(`   ✅ Found valid prices: Lokaler = €${extractedPrices.lokaler_versorger_price}, Öko = €${extractedPrices.oekostrom_price}`);
                
                // Update database
                await this.updateDatabaseEntry(entry.id, extractedPrices);
                
                return { 
                    success: true, 
                    oldPrices: {
                        lokaler: entry.lokaler_versorger_price,
                        oeko: entry.oekostrom_price
                    },
                    newPrices: extractedPrices,
                    improvement: isImprovement
                };
            } else {
                console.log(`   ❌ Could not find better prices: ${isImprovement.reason}`);
                return { success: false, error: isImprovement.reason };
            }

        } catch (error) {
            console.log(`   ❌ Error during cleanup: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate if new prices are an improvement
     */
    validateImprovement(originalEntry, newPrices) {
        const oldLokaler = parseFloat(originalEntry.lokaler_versorger_price) || null;
        const oldOeko = parseFloat(originalEntry.oekostrom_price) || null;
        const newLokaler = newPrices.lokaler_versorger_price;
        const newOeko = newPrices.oekostrom_price;

        // Check if we found any prices
        if (!newLokaler && !newOeko) {
            return { isValid: false, reason: 'No prices found in re-scrape' };
        }

        // Check if new prices are reasonable
        if (newLokaler && newLokaler >= this.validationThresholds.outlier_threshold) {
            return { isValid: false, reason: `New lokaler price €${newLokaler} is still an outlier` };
        }
        
        if (newOeko && newOeko >= this.validationThresholds.outlier_threshold) {
            return { isValid: false, reason: `New öko price €${newOeko} is still an outlier` };
        }

        // Check price relationship
        if (newLokaler && newOeko && newLokaler < newOeko && (newOeko - newLokaler) > 0.02) {
            return { isValid: false, reason: `New prices have invalid relationship (lokaler < öko by €${(newOeko - newLokaler).toFixed(4)})` };
        }

        // If we have outliers in original data, new prices should be lower
        if (oldLokaler && oldLokaler >= this.validationThresholds.outlier_threshold) {
            if (!newLokaler || newLokaler >= oldLokaler) {
                return { isValid: false, reason: 'New lokaler price is not better than outlier original' };
            }
        }

        if (oldOeko && oldOeko >= this.validationThresholds.outlier_threshold) {
            if (!newOeko || newOeko >= oldOeko) {
                return { isValid: false, reason: 'New öko price is not better than outlier original' };
            }
        }

        // If we had missing prices, check if we filled them
        if (!oldLokaler && newLokaler) {
            return { isValid: true, reason: 'Found missing lokaler price' };
        }
        
        if (!oldOeko && newOeko) {
            return { isValid: true, reason: 'Found missing öko price' };
        }

        // If we had both prices but they were outliers, new ones should be reasonable
        if (newLokaler && newOeko && 
            newLokaler <= this.validationThresholds.max_reasonable_price && 
            newOeko <= this.validationThresholds.max_reasonable_price) {
            return { isValid: true, reason: 'Replaced outliers with reasonable prices' };
        }

        return { isValid: true, reason: 'General improvement detected' };
    }

    /**
     * Update database entry with new prices
     */
    async updateDatabaseEntry(entryId, newPrices) {
        try {
            const updateData = {
                lokaler_versorger_price: newPrices.lokaler_versorger_price,
                oekostrom_price: newPrices.oekostrom_price,
                average_price: this.calculateAveragePrice(newPrices.lokaler_versorger_price, newPrices.oekostrom_price),
                updated_at: new Date().toISOString(),
                is_outlier: false, // Reset outlier status since we've validated the new prices
                outlier_severity: 'normal'
            };

            const { data, error } = await this.db.supabase
                .from('monthly_electricity_prices')
                .update(updateData)
                .eq('id', entryId)
                .select();

            if (error) throw error;

            console.log(`   💾 Database updated successfully`);
            return data[0];

        } catch (error) {
            console.error(`   ❌ Database update failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Calculate average price
     */
    calculateAveragePrice(lokaler, oeko) {
        if (lokaler && oeko) {
            return (lokaler + oeko) / 2;
        } else if (lokaler) {
            return lokaler;
        } else if (oeko) {
            return oeko;
        }
        return null;
    }

    /**
     * Run cleanup process on all problematic entries
     */
    async runCleanup(month = null, maxEntries = null) {
        console.log('🧹 STARTING DATA QUALITY CLEANUP');
        console.log('='.repeat(50));
        
        try {
            // Find problematic entries
            const problematicData = await this.findProblematicEntries(month);
            const { all: allProblematic } = problematicData;

            if (allProblematic.length === 0) {
                console.log('✅ No problematic entries found!');
                return;
            }

            // Limit entries if specified
            const entriesToProcess = maxEntries ? allProblematic.slice(0, maxEntries) : allProblematic;
            
            console.log(`\n🚀 Processing ${entriesToProcess.length} problematic entries...`);
            console.log(`⏱️  Estimated time: ${Math.ceil(entriesToProcess.length * this.delay / 1000 / 60)} minutes\n`);

            let successCount = 0;
            let errorCount = 0;

            // Process each entry
            for (let i = 0; i < entriesToProcess.length; i++) {
                const entry = entriesToProcess[i];
                
                try {
                    const result = await this.cleanupEntry(entry);
                    
                    if (result.success) {
                        successCount++;
                        this.results.successfully_fixed++;
                    } else {
                        errorCount++;
                        this.results.still_problematic++;
                        this.results.errors.push({
                            plz: entry.plz,
                            city: entry.city_name,
                            error: result.error
                        });
                    }

                } catch (error) {
                    errorCount++;
                    this.results.errors.push({
                        plz: entry.plz,
                        city: entry.city_name,
                        error: error.message
                    });
                }

                // Progress update
                if ((i + 1) % 10 === 0) {
                    console.log(`\n📈 Progress: ${i + 1}/${entriesToProcess.length} entries processed`);
                    console.log(`   ✅ Successfully fixed: ${successCount}`);
                    console.log(`   ❌ Still problematic: ${errorCount}`);
                }

                // Delay between requests
                if (i < entriesToProcess.length - 1) {
                    await this.sleep(this.delay);
                }
            }

            // Final summary
            console.log('\n' + '='.repeat(50));
            console.log('🎯 CLEANUP COMPLETED!');
            console.log(`📊 Results:`);
            console.log(`   Total processed: ${entriesToProcess.length}`);
            console.log(`   Successfully fixed: ${successCount}`);
            console.log(`   Still problematic: ${errorCount}`);
            console.log(`   Success rate: ${((successCount / entriesToProcess.length) * 100).toFixed(1)}%`);

            if (this.results.errors.length > 0) {
                console.log(`\n❌ Errors encountered:`);
                this.results.errors.slice(0, 5).forEach(err => {
                    console.log(`   ${err.city} (${err.plz}): ${err.error}`);
                });
                if (this.results.errors.length > 5) {
                    console.log(`   ... and ${this.results.errors.length - 5} more errors`);
                }
            }

        } catch (error) {
            console.error('❌ Cleanup process failed:', error.message);
            throw error;
        }
    }

    /**
     * Utility function to add delay
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = DataQualityCleanup; 