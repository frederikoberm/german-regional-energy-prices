/**
 * High Price Fixer Service
 * Fixes cities with lokaler prices > €1.00 by extracting correct per-kWh rates
 */

const axios = require('axios');
const cheerio = require('cheerio');
const SupabaseClient = require('../database/supabase-client');

class HighPriceFixer {
    constructor() {
        this.db = new SupabaseClient();
        this.delay = 2000;
        this.highPriceThreshold = 1.0; // €1.00 per kWh is almost certainly wrong
    }

    /**
     * Get all cities with high lokaler prices (likely extraction errors)
     */
    async getHighPriceCities() {
        console.log('🔍 Finding cities with high lokaler prices...');
        
        try {
            // Get ALL entries using pagination
            const allData = [];
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;

            while (hasMore) {
                const { data, error } = await this.db.supabase
                    .from('monthly_electricity_prices')
                    .select('*')
                    .range(offset, offset + batchSize - 1);

                if (error) throw error;
                allData.push(...data);
                hasMore = data.length === batchSize;
                offset += batchSize;
            }

            // Filter for high prices
            const highPriceEntries = allData.filter(entry => {
                const lokalerPrice = parseFloat(entry.lokaler_versorger_price);
                return lokalerPrice && lokalerPrice >= this.highPriceThreshold;
            });

            console.log(`📊 Found ${highPriceEntries.length} cities with lokaler prices ≥ €${this.highPriceThreshold}`);
            
            return highPriceEntries;

        } catch (error) {
            console.error('❌ Error getting high price cities:', error.message);
            throw error;
        }
    }

    /**
     * Enhanced extraction focused on correct per-kWh prices from table structure
     */
    async extractCorrectPrices(html, cityName, plz) {
        const $ = cheerio.load(html);
        
        console.log(`    🔍 Extracting correct prices for ${cityName} (${plz})...`);

        // Strategy 1: Precise table structure extraction
        const tableResult = this.extractFromPriceTable($);
        if (tableResult.grundversorger) {
            console.log(`    ✅ Table extraction found: Grundversorger €${tableResult.grundversorger}, Öko €${tableResult.oeko || 'null'}`);
            return {
                lokaler_versorger_price: tableResult.grundversorger,
                oekostrom_price: tableResult.oeko,
                extraction_method: 'correct_table_structure'
            };
        }

        // Strategy 2: Fallback pattern matching
        const patternResult = this.extractWithPricePatterns($.text());
        if (patternResult.grundversorger) {
            console.log(`    ✅ Pattern extraction found: Grundversorger €${patternResult.grundversorger}, Öko €${patternResult.oeko || 'null'}`);
            return {
                lokaler_versorger_price: patternResult.grundversorger,
                oekostrom_price: patternResult.oeko,
                extraction_method: 'price_patterns'
            };
        }

        console.log(`    ❌ Could not extract correct prices`);
        return {
            lokaler_versorger_price: null,
            oekostrom_price: null,
            extraction_method: 'failed'
        };
    }

    /**
     * Extract from the specific table structure we know exists
     */
    extractFromPriceTable($) {
        let grundversorgerPrice = null;
        let oekoPrice = null;

        $('table').each((tableIndex, table) => {
            const tableText = $(table).text();
            
            // Look for the main price table
            if (tableText.includes('Stromtarif') && tableText.includes('Strompreis')) {
                console.log(`    📋 Analyzing price table ${tableIndex + 1}...`);
                
                $(table).find('tr').each((rowIndex, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 2) {
                        const firstCell = $(cells[0]).text().trim();
                        const secondCell = $(cells[1]).text().trim();

                        // Look for Grundversorger row
                        if (firstCell.toLowerCase().includes('grundversorger') && 
                            secondCell.includes('Cent pro kWh')) {
                            
                            const price = this.parsePerKwhPrice(secondCell);
                            if (price && this.isReasonablePrice(price)) {
                                grundversorgerPrice = price;
                                console.log(`    ✅ Found Grundversorger: ${firstCell.substring(0, 50)}... -> €${price}`);
                            }
                        }

                        // Look for günstigster Ökostromanbieter row
                        if (firstCell.toLowerCase().includes('günstigster ökostromanbieter') && 
                            secondCell.includes('Cent pro kWh')) {
                            
                            const price = this.parsePerKwhPrice(secondCell);
                            if (price && this.isReasonablePrice(price)) {
                                oekoPrice = price;
                                console.log(`    ✅ Found Ökostromanbieter: ${firstCell.substring(0, 50)}... -> €${price}`);
                            }
                        }
                    }
                });
            }
        });

        return {
            grundversorger: grundversorgerPrice,
            oeko: oekoPrice
        };
    }

    /**
     * Extract using targeted price patterns
     */
    extractWithPricePatterns(pageText) {
        let grundversorgerPrice = null;
        let oekoPrice = null;

        // Pattern for Grundversorger prices
        const grundversorgerPatterns = [
            /Grundversorger[^0-9]*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi,
            /lokaler?\s+Versorger[^0-9]*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi
        ];

        for (const pattern of grundversorgerPatterns) {
            const matches = [...pageText.matchAll(pattern)];
            for (const match of matches) {
                const price = parseFloat(match[1].replace(',', '.')) / 100;
                if (this.isReasonablePrice(price) && !grundversorgerPrice) {
                    grundversorgerPrice = price;
                    break;
                }
            }
            if (grundversorgerPrice) break;
        }

        // Pattern for Ökostromanbieter prices
        const oekoPatterns = [
            /günstigster\s+Ökostromanbieter[^0-9]*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi,
            /günstigster.*?Ökostrom[^0-9]*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi
        ];

        for (const pattern of oekoPatterns) {
            const matches = [...pageText.matchAll(pattern)];
            for (const match of matches) {
                const price = parseFloat(match[1].replace(',', '.')) / 100;
                if (this.isReasonablePrice(price) && !oekoPrice) {
                    oekoPrice = price;
                    break;
                }
            }
            if (oekoPrice) break;
        }

        return {
            grundversorger: grundversorgerPrice,
            oeko: oekoPrice
        };
    }

    /**
     * Parse per-kWh price specifically from price cell text
     */
    parsePerKwhPrice(text) {
        // Look specifically for "X,XX Cent pro kWh" pattern
        const centPattern = /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i;
        const euroPattern = /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/i;

        let match = text.match(centPattern);
        if (match) {
            return parseFloat(match[1].replace(',', '.')) / 100; // Convert cents to euros
        }

        match = text.match(euroPattern);
        if (match) {
            return parseFloat(match[1].replace(',', '.'));
        }

        return null;
    }

    /**
     * Check if price is reasonable (not an annual cost or other error)
     */
    isReasonablePrice(price) {
        return price && price >= 0.05 && price <= 0.80; // Reasonable per-kWh range
    }

    /**
     * Fix a single high-price entry
     */
    async fixHighPriceEntry(entry) {
        console.log(`\n🔧 Fixing: ${entry.city_name} (${entry.plz})`);
        console.log(`   Current stored price: €${entry.lokaler_versorger_price} (likely wrong)`);
        
        try {
            if (!entry.source_url) {
                console.log('   ❌ No source URL available');
                return { success: false, error: 'No source URL' };
            }

            const response = await axios.get(entry.source_url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const extractedPrices = await this.extractCorrectPrices(
                response.data,
                entry.city_name,
                entry.plz
            );

            if (extractedPrices.lokaler_versorger_price) {
                const oldPrice = parseFloat(entry.lokaler_versorger_price);
                const newPrice = extractedPrices.lokaler_versorger_price;
                const improvement = oldPrice - newPrice;

                // Calculate new average
                const currentOeko = parseFloat(entry.oekostrom_price) || extractedPrices.oekostrom_price;
                const newAverage = currentOeko ? (newPrice + currentOeko) / 2 : newPrice;

                // Update database
                const { data: updateData, error: updateError } = await this.db.supabase
                    .from('monthly_electricity_prices')
                    .update({
                        lokaler_versorger_price: newPrice,
                        oekostrom_price: extractedPrices.oekostrom_price || entry.oekostrom_price,
                        average_price: newAverage,
                        updated_at: new Date().toISOString(),
                        is_outlier: false, // Reset outlier status
                        outlier_severity: 'normal'
                    })
                    .eq('id', entry.id)
                    .select();

                if (updateError) throw updateError;

                console.log(`   ✅ Fixed! Old: €${oldPrice.toFixed(4)} -> New: €${newPrice.toFixed(4)} (saved €${improvement.toFixed(4)})`);
                if (extractedPrices.oekostrom_price) {
                    console.log(`   🌱 Also updated Öko price: €${extractedPrices.oekostrom_price.toFixed(4)}`);
                }
                
                return { 
                    success: true, 
                    oldPrice, 
                    newPrice, 
                    improvement,
                    method: extractedPrices.extraction_method
                };
            } else {
                console.log('   ❌ Could not extract correct price');
                return { success: false, error: 'No correct price found' };
            }

        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    /**
     * Fix all high-price entries
     */
    async fixAllHighPrices(maxEntries = null) {
        console.log('🔧 HIGH PRICE FIXER');
        console.log('='.repeat(50));

        try {
            // Get high price cities
            const highPriceCities = await this.getHighPriceCities();
            
            if (highPriceCities.length === 0) {
                console.log('✅ No high price cities found!');
                return;
            }

            const entriesToProcess = maxEntries ? 
                highPriceCities.slice(0, maxEntries) : highPriceCities;

            console.log(`🚀 Processing ${entriesToProcess.length} high-price entries...\n`);

            let successCount = 0;
            let errorCount = 0;
            let totalImprovement = 0;

            for (let i = 0; i < entriesToProcess.length; i++) {
                const entry = entriesToProcess[i];
                
                try {
                    const result = await this.fixHighPriceEntry(entry);
                    
                    if (result.success) {
                        successCount++;
                        totalImprovement += result.improvement;
                    } else {
                        errorCount++;
                    }

                } catch (error) {
                    errorCount++;
                    console.log(`   ❌ Unexpected error: ${error.message}`);
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
            console.log('🎯 HIGH PRICE FIXING COMPLETED!');
            console.log(`📊 Results:`);
            console.log(`   Total processed: ${entriesToProcess.length}`);
            console.log(`   Successfully fixed: ${successCount}`);
            console.log(`   Still problematic: ${errorCount}`);
            console.log(`   Success rate: ${((successCount / entriesToProcess.length) * 100).toFixed(1)}%`);
            
            if (totalImprovement > 0) {
                console.log(`   💰 Total price reduction: €${totalImprovement.toFixed(2)}`);
                console.log(`   📉 Average reduction per city: €${(totalImprovement / successCount).toFixed(4)}`);
            }

        } catch (error) {
            console.error('❌ High price fixing process failed:', error.message);
            throw error;
        }
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = HighPriceFixer; 