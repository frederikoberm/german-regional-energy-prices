/**
 * Enhanced Oekostrom Price Extractor
 * Specialized extraction logic for oekostrom prices that were missed by general extraction
 */

const axios = require('axios');
const cheerio = require('cheerio');
const SupabaseClient = require('../database/supabase-client');

class EnhancedOekoExtractor {
    constructor() {
        this.db = new SupabaseClient();
        this.delay = 2000;
    }

    /**
     * Enhanced oekostrom extraction with multiple specialized strategies
     */
    async extractOekostromPrice(html, pageText, cityName, plz) {
        const $ = cheerio.load(html);
        
        console.log(`    🔍 Enhanced oeko extraction for ${cityName} (${plz})...`);

        // Strategy 1: Look for "günstigster Ökostromanbieter" pattern
        let oekoPrice = this.extractGünstigsterÖkoPattern(pageText);
        if (oekoPrice) {
            console.log(`    ✅ Strategy 1 found: €${oekoPrice} (günstigster Ökostromanbieter)`);
            return oekoPrice;
        }

        // Strategy 2: Look in specific table cells for oeko prices  
        oekoPrice = this.extractFromOekoTableCells($);
        if (oekoPrice) {
            console.log(`    ✅ Strategy 2 found: €${oekoPrice} (table cells)`);
            return oekoPrice;
        }

        // Strategy 3: Look for oeko price in structured data sections
        oekoPrice = this.extractFromStructuredSections($, pageText);
        if (oekoPrice) {
            console.log(`    ✅ Strategy 3 found: €${oekoPrice} (structured sections)`);
            return oekoPrice;
        }

        // Strategy 4: Pattern matching around specific keywords
        oekoPrice = this.extractWithContextPatterns(pageText);
        if (oekoPrice) {
            console.log(`    ✅ Strategy 4 found: €${oekoPrice} (context patterns)`);
            return oekoPrice;
        }

        console.log(`    ❌ No oekostrom price found with enhanced extraction`);
        return null;
    }

    /**
     * Strategy 1: Extract "günstigster Ökostromanbieter" pattern
     */
    extractGünstigsterÖkoPattern(pageText) {
        // Look for the specific pattern we found in the investigation
        const patterns = [
            /günstigster\s+Ökostromanbieter[:\s]*[^0-9]*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi,
            /günstigster\s+Ökostrom[:\s]*[^0-9]*?(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi,
            /günstigster\s+Ökostromanbieter[:\s]*[^0-9]*?(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/gi
        ];

        for (const pattern of patterns) {
            const matches = [...pageText.matchAll(pattern)];
            for (const match of matches) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cents to euros for the first two patterns
                if (pattern.toString().includes('Cent')) {
                    price = price / 100;
                }
                
                if (this.isValidOekoPrice(price)) {
                    return price;
                }
            }
        }

        return null;
    }

    /**
     * Strategy 2: Extract from table cells specifically containing oeko data
     */
    extractFromOekoTableCells($) {
        let oekoPrice = null;

        $('table').each((tableIndex, table) => {
            if (oekoPrice) return; // Already found

            const tableText = $(table).text();
            if (!tableText.toLowerCase().includes('ökostrom')) return;

            $(table).find('tr').each((rowIndex, row) => {
                if (oekoPrice) return; // Already found

                const rowText = $(row).text();
                if (!rowText.toLowerCase().includes('ökostrom')) return;

                // Look for price patterns in this row
                const cells = $(row).find('td, th');
                cells.each((cellIndex, cell) => {
                    const cellText = $(cell).text().trim();
                    
                    // Check if this cell contains a price with oeko context
                    if (cellText.includes('kWh') || cellText.includes('Cent') || cellText.includes('Euro')) {
                        const price = this.parseOekoPrice(cellText, rowText);
                        if (price && this.isValidOekoPrice(price)) {
                            oekoPrice = price;
                            return false; // Break out of cell loop
                        }
                    }
                });
            });
        });

        return oekoPrice;
    }

    /**
     * Strategy 3: Extract from structured data sections
     */
    extractFromStructuredSections($, pageText) {
        // Look for sections that contain oeko data
        const oekoSections = [];

        // Find elements that contain öko keywords
        $('div, section, article, p').each((i, element) => {
            const elementText = $(element).text();
            if (elementText.toLowerCase().includes('ökostrom') && 
                elementText.includes('kWh') && 
                elementText.length < 500) { // Not too long/complex
                oekoSections.push(elementText);
            }
        });

        // Extract prices from these sections
        for (const section of oekoSections) {
            const price = this.parseOekoPrice(section, section);
            if (price && this.isValidOekoPrice(price)) {
                return price;
            }
        }

        return null;
    }

    /**
     * Strategy 4: Context-aware pattern matching
     */
    extractWithContextPatterns(pageText) {
        // Find all mentions of öko-related keywords and look for nearby prices
        const oekoKeywords = ['günstigster ökostrom', 'ökostromanbieter', 'ökostromtarif'];
        
        for (const keyword of oekoKeywords) {
            const keywordIndex = pageText.toLowerCase().indexOf(keyword);
            if (keywordIndex === -1) continue;

            // Get context around the keyword (500 chars after)
            const context = pageText.substring(keywordIndex, keywordIndex + 500);
            
            // Look for price patterns in this context
            const pricePatterns = [
                /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi,
                /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/gi,
                /(\d+[,.]?\d*)\s*ct\s*\/?\s*kWh/gi
            ];

            for (const pattern of pricePatterns) {
                const matches = [...context.matchAll(pattern)];
                for (const match of matches) {
                    let price = parseFloat(match[1].replace(',', '.'));
                    
                    if (pattern.toString().includes('Cent') || pattern.toString().includes('ct')) {
                        price = price / 100;
                    }
                    
                    if (this.isValidOekoPrice(price)) {
                        return price;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Parse oeko price from text with context awareness
     */
    parseOekoPrice(text, context = '') {
        const combinedText = text + ' ' + context;
        
        // Multiple price patterns to try
        const patterns = [
            // Cent patterns (most common)
            /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*ct\s*\/?\s*kWh/i,
            /(\d+[,.]?\d*)\s*ct\s*pro\s*kWh/i,
            
            // Euro patterns
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*\/\s*kWh/i,
            
            // Special formats found in investigation
            /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*(EUR|€)\s*\/\s*kWh/i
        ];

        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = combinedText.match(pattern);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cents to euros for cent patterns (first 3 patterns)
                if (i < 3) {
                    price = price / 100;
                }
                
                return price;
            }
        }

        return null;
    }

    /**
     * Validate if price is reasonable for oekostrom
     */
    isValidOekoPrice(price) {
        return price && price >= 0.05 && price <= 0.80; // Reasonable range for oeko prices
    }

    /**
     * Fix missing oekostrom prices for specific entries
     */
    async fixMissingOekoPrices(entryIds = null, maxEntries = null) {
        console.log('🔧 ENHANCED OEKOSTROM PRICE FIXER');
        console.log('='.repeat(50));

        try {
            // Get entries with missing oeko prices
            let query = this.db.supabase
                .from('monthly_electricity_prices')
                .select('*')
                .not('lokaler_versorger_price', 'is', null) // Has lokaler price
                .is('oekostrom_price', null); // Missing oeko price

            if (entryIds && entryIds.length > 0) {
                query = query.in('id', entryIds);
            }

            const { data, error } = await query;
            if (error) throw error;

            let entriesToProcess = data;
            if (maxEntries) {
                entriesToProcess = data.slice(0, maxEntries);
            }

            console.log(`📊 Found ${data.length} entries missing oekostrom prices`);
            console.log(`🔧 Processing ${entriesToProcess.length} entries...\n`);

            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < entriesToProcess.length; i++) {
                const entry = entriesToProcess[i];
                console.log(`[${i+1}/${entriesToProcess.length}] 🌐 Fixing: ${entry.city_name} (${entry.plz})`);

                try {
                    if (!entry.source_url) {
                        console.log('   ❌ No source URL available');
                        errorCount++;
                        continue;
                    }

                    const response = await axios.get(entry.source_url, {
                        timeout: 15000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });

                    const oekoPrice = await this.extractOekostromPrice(
                        response.data,
                        response.data,
                        entry.city_name,
                        entry.plz
                    );

                    if (oekoPrice) {
                        // Update database
                        const newAverage = (parseFloat(entry.lokaler_versorger_price) + oekoPrice) / 2;
                        
                        const { data: updateData, error: updateError } = await this.db.supabase
                            .from('monthly_electricity_prices')
                            .update({
                                oekostrom_price: oekoPrice,
                                average_price: newAverage,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', entry.id)
                            .select();

                        if (updateError) throw updateError;

                        console.log(`   ✅ Fixed! Oeko price: €${oekoPrice.toFixed(4)}, New average: €${newAverage.toFixed(4)}`);
                        successCount++;
                    } else {
                        console.log('   ❌ Could not extract oekostrom price');
                        errorCount++;
                    }

                } catch (error) {
                    console.log(`   ❌ Error: ${error.message}`);
                    errorCount++;
                }

                // Delay between requests
                if (i < entriesToProcess.length - 1) {
                    await this.sleep(this.delay);
                }
            }

            console.log('\n' + '='.repeat(50));
            console.log('🎯 OEKOSTROM FIXING COMPLETED!');
            console.log(`📊 Results:`);
            console.log(`   Total processed: ${entriesToProcess.length}`);
            console.log(`   Successfully fixed: ${successCount}`);
            console.log(`   Still problematic: ${errorCount}`);
            console.log(`   Success rate: ${((successCount / entriesToProcess.length) * 100).toFixed(1)}%`);

        } catch (error) {
            console.error('❌ Oeko fixing process failed:', error.message);
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

module.exports = EnhancedOekoExtractor; 