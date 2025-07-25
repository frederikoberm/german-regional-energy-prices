#!/usr/bin/env node

/**
 * High Price Investigation
 * Investigate cities with lokaler prices > €1.00 to identify extraction issues
 */

const SupabaseClient = require('../database/supabase-client');
const axios = require('axios');
const cheerio = require('cheerio');

class HighPriceInvestigator {
    constructor() {
        this.db = new SupabaseClient();
    }

    /**
     * Find cities with high lokaler prices (likely extraction errors)
     */
    async findHighPriceCities(threshold = 1.0) {
        console.log(`🔍 INVESTIGATING HIGH PRICE CITIES (>${threshold} EUR)`);
        console.log('='.repeat(60));

        try {
            // Get ALL entries using pagination
            const allData = [];
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;

            console.log('📊 Fetching all entries from database...');

            while (hasMore) {
                const { data, error } = await this.db.supabase
                    .from('monthly_electricity_prices')
                    .select('*')
                    .range(offset, offset + batchSize - 1);

                if (error) throw error;

                allData.push(...data);
                console.log(`   Fetched batch: ${data.length} entries (total so far: ${allData.length})`);

                hasMore = data.length === batchSize;
                offset += batchSize;
            }

            console.log(`📊 Total entries checked: ${allData.length}`);

            // Find high price entries
            const highPriceEntries = allData.filter(entry => {
                const lokalerPrice = parseFloat(entry.lokaler_versorger_price);
                return lokalerPrice && lokalerPrice >= threshold;
            });

            console.log(`\n🚨 Found ${highPriceEntries.length} cities with lokaler prices ≥ €${threshold}`);
            console.log(`📊 That's ${(highPriceEntries.length / allData.length * 100).toFixed(1)}% of all entries`);

            // Categorize by severity
            const analysis = {
                moderate: highPriceEntries.filter(e => parseFloat(e.lokaler_versorger_price) < 1.5),
                high: highPriceEntries.filter(e => parseFloat(e.lokaler_versorger_price) >= 1.5 && parseFloat(e.lokaler_versorger_price) < 2.0),
                extreme: highPriceEntries.filter(e => parseFloat(e.lokaler_versorger_price) >= 2.0)
            };

            console.log('\n📋 HIGH PRICE ANALYSIS:');
            console.log(`   🟡 Moderate (€1.00-€1.50): ${analysis.moderate.length} cities`);
            console.log(`   🟠 High (€1.50-€2.00): ${analysis.high.length} cities`);
            console.log(`   🔴 Extreme (≥€2.00): ${analysis.extreme.length} cities`);

            // Show examples by category
            if (analysis.extreme.length > 0) {
                console.log('\n🔴 Examples of EXTREME prices (≥€2.00):');
                analysis.extreme.slice(0, 5).forEach(entry => {
                    console.log(`   ${entry.city_name} (${entry.plz}): €${entry.lokaler_versorger_price}`);
                    console.log(`      URL: ${entry.source_url}`);
                });
            }

            if (analysis.high.length > 0) {
                console.log('\n🟠 Examples of HIGH prices (€1.50-€2.00):');
                analysis.high.slice(0, 5).forEach(entry => {
                    console.log(`   ${entry.city_name} (${entry.plz}): €${entry.lokaler_versorger_price}`);
                    console.log(`      URL: ${entry.source_url}`);
                });
            }

            if (analysis.moderate.length > 0) {
                console.log('\n🟡 Examples of MODERATE high prices (€1.00-€1.50):');
                analysis.moderate.slice(0, 10).forEach(entry => {
                    console.log(`   ${entry.city_name} (${entry.plz}): €${entry.lokaler_versorger_price}`);
                });
            }

            return {
                total: highPriceEntries.length,
                entries: highPriceEntries,
                analysis,
                allData
            };

        } catch (error) {
            console.error('❌ Error investigating high prices:', error.message);
            throw error;
        }
    }

    /**
     * Investigate specific high-price URLs to understand extraction issues
     */
    async investigateHighPriceURL(entry) {
        console.log(`\n🔍 INVESTIGATING: ${entry.city_name} (${entry.plz})`);
        console.log(`💰 Current stored price: €${entry.lokaler_versorger_price}`);
        console.log(`🌐 URL: ${entry.source_url}`);
        console.log('-'.repeat(70));

        try {
            const response = await axios.get(entry.source_url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const pageText = $.text();

            console.log('📄 Page analysis:');
            console.log(`  - Contains "Grundversorger": ${pageText.includes('Grundversorger')}`);
            console.log(`  - Contains "lokaler Versorger": ${pageText.includes('lokaler Versorger')}`);
            console.log(`  - Contains "Cent pro kWh": ${pageText.includes('Cent pro kWh')}`);

            // Analyze the table structure like the user showed
            this.analyzeTableStructure($);

            // Look for all price patterns
            this.findAllPricePatterns(pageText);

            // Extract using correct patterns
            const correctPrices = this.extractCorrectPrices($, pageText);
            
            console.log('\n💡 CORRECT EXTRACTION RESULTS:');
            console.log(`   🏛️ Grundversorger: €${correctPrices.grundversorger || 'null'}`);
            console.log(`   💰 Günstigster Anbieter: €${correctPrices.guenstigster || 'null'}`);
            console.log(`   🌱 Günstigster Öko: €${correctPrices.oeko || 'null'}`);

            if (correctPrices.grundversorger) {
                const storedPrice = parseFloat(entry.lokaler_versorger_price);
                const correctPrice = correctPrices.grundversorger;
                const difference = storedPrice - correctPrice;
                
                console.log(`\n📊 COMPARISON:`);
                console.log(`   Stored in DB: €${storedPrice.toFixed(4)}`);
                console.log(`   Should be: €${correctPrice.toFixed(4)}`);
                console.log(`   Difference: €${difference.toFixed(4)} (${difference > 0 ? 'DB too high' : 'DB too low'})`);
            }

        } catch (error) {
            console.log(`❌ Error investigating URL: ${error.message}`);
        }
    }

    /**
     * Analyze table structure to understand the correct data format
     */
    analyzeTableStructure($) {
        console.log('\n📋 TABLE STRUCTURE ANALYSIS:');
        
        $('table').each((tableIndex, table) => {
            const tableText = $(table).text();
            
            // Look for tables containing price information
            if (tableText.includes('Strompreis') || tableText.includes('pro kWh')) {
                console.log(`\n  Table ${tableIndex + 1} (Price Table):`);
                
                $(table).find('tr').each((rowIndex, row) => {
                    const cells = $(row).find('td, th');
                    if (cells.length >= 2) {
                        const firstCell = $(cells[0]).text().trim();
                        const secondCell = $(cells[1]).text().trim();
                        
                        if (firstCell && secondCell) {
                            console.log(`    Row ${rowIndex}: "${firstCell}" -> "${secondCell}"`);
                        }
                    }
                });
            }
        });
    }

    /**
     * Find all price patterns to understand what's being extracted
     */
    findAllPricePatterns(pageText) {
        console.log('\n💰 ALL PRICE PATTERNS FOUND:');

        const patterns = [
            /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/gi,
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/gi
        ];

        const allMatches = [];
        
        patterns.forEach((pattern, index) => {
            const matches = [...pageText.matchAll(pattern)];
            matches.forEach(match => {
                let price = parseFloat(match[1].replace(',', '.'));
                const unit = match[2] ? match[2].toLowerCase() : 'cent';
                
                if (pattern.toString().includes('Cent') || unit.includes('cent')) {
                    price = price / 100;
                }
                
                allMatches.push({
                    price,
                    match: match[0],
                    context: this.getContext(pageText, match.index, 150)
                });
            });
        });

        // Sort by price to identify potential issues
        allMatches.sort((a, b) => a.price - b.price);

        console.log(`  Found ${allMatches.length} price patterns:`);
        allMatches.forEach((match, i) => {
            console.log(`    ${i+1}. €${match.price.toFixed(4)} - "${match.match}"`);
            console.log(`       Context: "${match.context.trim().substring(0, 100)}..."`);
        });
    }

    /**
     * Extract prices using the correct patterns for the expected table structure
     */
    extractCorrectPrices($, pageText) {
        const prices = {
            grundversorger: null,
            guenstigster: null,
            oeko: null
        };

        // Strategy 1: Table-based extraction with correct patterns
        $('table').each((tableIndex, table) => {
            $(table).find('tr').each((rowIndex, row) => {
                const cells = $(row).find('td');
                if (cells.length >= 2) {
                    const firstCell = $(cells[0]).text().trim();
                    const secondCell = $(cells[1]).text().trim();

                    // Look for Grundversorger (lokaler versorger)
                    if (firstCell.toLowerCase().includes('grundversorger') && 
                        secondCell.includes('Cent pro kWh')) {
                        const price = this.parsePrice(secondCell);
                        if (price && !prices.grundversorger) {
                            prices.grundversorger = price;
                        }
                    }

                    // Look for günstigster Stromanbieter
                    if (firstCell.toLowerCase().includes('günstigster stromanbieter') && 
                        secondCell.includes('Cent pro kWh')) {
                        const price = this.parsePrice(secondCell);
                        if (price && !prices.guenstigster) {
                            prices.guenstigster = price;
                        }
                    }

                    // Look for günstigster Ökostromanbieter
                    if (firstCell.toLowerCase().includes('günstigster ökostromanbieter') && 
                        secondCell.includes('Cent pro kWh')) {
                        const price = this.parsePrice(secondCell);
                        if (price && !prices.oeko) {
                            prices.oeko = price;
                        }
                    }
                }
            });
        });

        return prices;
    }

    /**
     * Parse price from text
     */
    parsePrice(text) {
        const patterns = [
            /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/i
        ];

        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            const match = text.match(pattern);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cents to euros for cent patterns
                if (i === 0) {
                    price = price / 100;
                }
                
                if (price >= 0.05 && price <= 2.0) {
                    return price;
                }
            }
        }
        return null;
    }

    /**
     * Get context around a text position
     */
    getContext(text, position, length = 150) {
        const start = Math.max(0, position - length / 2);
        const end = Math.min(text.length, position + length / 2);
        return text.substring(start, end);
    }

    /**
     * Run complete investigation with sample URL analysis
     */
    async runCompleteInvestigation(maxUrlsToCheck = 5) {
        try {
            console.log('🔬 HIGH PRICE INVESTIGATION');
            console.log('='.repeat(60));

            // 1. Find all high price cities
            const results = await this.findHighPriceCities(1.0);

            if (results.total === 0) {
                console.log('\n✅ No high price cities found!');
                return;
            }

            // 2. Investigate sample URLs
            console.log('\n🔍 DETAILED URL INVESTIGATIONS');
            console.log('='.repeat(60));

            const samplesToCheck = results.entries.slice(0, maxUrlsToCheck);
            
            for (let i = 0; i < samplesToCheck.length; i++) {
                await this.investigateHighPriceURL(samplesToCheck[i]);
                
                if (i < samplesToCheck.length - 1) {
                    await this.sleep(2000); // Be respectful to the server
                }
            }

            // 3. Provide recommendations
            console.log('\n💡 RECOMMENDATIONS');
            console.log('='.repeat(60));
            console.log(`📊 Found ${results.total} cities with high prices that need fixing`);
            console.log('\n🔧 Next steps:');
            console.log('1. Run enhanced extraction with correct table patterns');
            console.log('2. Focus on Grundversorger vs günstigster Anbieter distinction');
            console.log('3. Validate all prices >€1.00 are likely extraction errors');

        } catch (error) {
            console.error('❌ Investigation failed:', error.message);
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

async function main() {
    const args = process.argv.slice(2);
    const investigator = new HighPriceInvestigator();

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🔍 High Price Investigator

USAGE:
  node scripts/investigate-high-prices.js [OPTIONS]

OPTIONS:
  --threshold N          Price threshold (default: 1.0 EUR)
  --max-urls N          Max URLs to investigate (default: 5)
  --help, -h            Show this help

EXAMPLES:
  # Investigate all cities with prices >€1.00
  node scripts/investigate-high-prices.js

  # Custom threshold and sample size
  node scripts/investigate-high-prices.js --threshold 0.8 --max-urls 10
        `);
        return;
    }

    try {
        const threshold = args.includes('--threshold') ? 
            parseFloat(args[args.indexOf('--threshold') + 1]) : 1.0;
        const maxUrls = args.includes('--max-urls') ? 
            parseInt(args[args.indexOf('--max-urls') + 1]) : 5;

        await investigator.runCompleteInvestigation(maxUrls);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = HighPriceInvestigator; 