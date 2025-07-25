#!/usr/bin/env node

/**
 * Price Issues Analysis Tool
 * Deep dive analysis into specific data quality problems
 */

const SupabaseClient = require('../database/supabase-client');
const axios = require('axios');
const cheerio = require('cheerio');

class PriceIssuesAnalyzer {
    constructor() {
        this.db = new SupabaseClient();
    }

    /**
     * Analyze big cities with high prices
     */
    async analyzeBigCityPrices(month = null) {
        console.log('🏙️  ANALYZING BIG CITY PRICE ISSUES');
        console.log('=' .repeat(50));

        try {
            // Get cities with populations > 100k (major German cities)
            const bigCities = [
                'Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt am Main',
                'Stuttgart', 'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig',
                'Bremen', 'Dresden', 'Hannover', 'Nürnberg', 'Duisburg',
                'Bochum', 'Wuppertal', 'Bielefeld', 'Bonn', 'Münster'
            ];

            let query = this.db.supabase
                .from('monthly_electricity_prices')
                .select('*')
                .in('city_name', bigCities);

            if (month) {
                query = query.eq('data_month', month);
            }

            const { data, error } = await query;
            if (error) throw error;

            console.log(`📊 Found ${data.length} entries for major cities`);

            // Analyze price issues
            const issues = {
                high_prices: [],
                extreme_prices: [],
                missing_prices: [],
                invalid_relationships: []
            };

            for (const entry of data) {
                const lokaler = parseFloat(entry.lokaler_versorger_price) || 0;
                const oeko = parseFloat(entry.oekostrom_price) || 0;

                if (lokaler > 1.0 || oeko > 1.0) {
                    if (lokaler > 1.5 || oeko > 1.5) {
                        issues.extreme_prices.push(entry);
                    } else {
                        issues.high_prices.push(entry);
                    }
                }

                if (!entry.lokaler_versorger_price || !entry.oekostrom_price) {
                    issues.missing_prices.push(entry);
                }

                if (lokaler && oeko && lokaler < oeko && (oeko - lokaler) > 0.02) {
                    issues.invalid_relationships.push(entry);
                }
            }

            console.log('\n📋 Issues found in major cities:');
            console.log(`  💥 Extreme prices (>€1.50): ${issues.extreme_prices.length}`);
            console.log(`  🚨 High prices (€1.00-€1.50): ${issues.high_prices.length}`);
            console.log(`  ❓ Missing prices: ${issues.missing_prices.length}`);
            console.log(`  ⚠️  Invalid relationships: ${issues.invalid_relationships.length}`);

            // Show examples of extreme prices
            if (issues.extreme_prices.length > 0) {
                console.log('\n💥 Examples of extreme prices in major cities:');
                issues.extreme_prices.slice(0, 10).forEach(entry => {
                    console.log(`  ${entry.city_name} (${entry.plz}): Lokaler €${entry.lokaler_versorger_price}, Öko €${entry.oekostrom_price}`);
                    console.log(`    URL: ${entry.source_url}`);
                });
            }

            return issues;

        } catch (error) {
            console.error('❌ Error analyzing big city prices:', error.message);
            throw error;
        }
    }

    /**
     * Investigate a specific URL to see what went wrong
     */
    async investigateURL(url, cityName, plz) {
        console.log(`\n🔍 INVESTIGATING: ${cityName} (${plz})`);
        console.log(`🌐 URL: ${url}`);
        console.log('-'.repeat(50));

        try {
            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const pageText = $.text();

            console.log('📄 Page analysis:');
            console.log(`  Page length: ${response.data.length} characters`);
            console.log(`  Contains "kWh": ${pageText.includes('kWh')}`);
            console.log(`  Contains "Euro": ${pageText.includes('Euro')}`);
            console.log(`  Contains "Cent": ${pageText.includes('Cent')}`);
            console.log(`  Contains "lokaler Versorger": ${pageText.includes('lokaler Versorger')}`);
            console.log(`  Contains "Ökostrom": ${pageText.includes('Ökostrom')}`);

            // Extract all potential price patterns
            console.log('\n💰 All potential price patterns found:');
            this.findAllPricePatterns(pageText);

            // Analyze table structure
            console.log('\n📋 Table analysis:');
            this.analyzeTableStructure($);

            // Look for specific price keywords in context
            console.log('\n🔍 Price context analysis:');
            this.analyzePriceContext(pageText);

        } catch (error) {
            console.error(`❌ Error investigating URL: ${error.message}`);
        }
    }

    /**
     * Find all potential price patterns in the page text
     */
    findAllPricePatterns(pageText) {
        const patterns = [
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)\s*pro\s*kWh/gi,
            /(\d+[,.]?\d*)\s*(Cent|ct)\s*pro\s*kWh/gi,
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)\/kWh/gi,
            /(\d+[,.]?\d*)\s*(Cent|ct)\/kWh/gi,
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)/gi,
            /(\d+[,.]?\d*)\s*(Cent|ct)/gi
        ];

        const allMatches = [];
        
        patterns.forEach((pattern, index) => {
            const matches = [...pageText.matchAll(pattern)];
            matches.forEach(match => {
                let price = parseFloat(match[1].replace(',', '.'));
                const unit = match[2].toLowerCase();
                
                if (unit.includes('cent') || unit.includes('ct')) {
                    price = price / 100;
                }
                
                allMatches.push({
                    pattern: `Pattern ${index + 1}`,
                    match: match[0],
                    price: price,
                    context: this.getContext(pageText, match.index, 100)
                });
            });
        });

        // Sort by price to identify potential issues
        allMatches.sort((a, b) => a.price - b.price);

        console.log(`  Found ${allMatches.length} potential price matches:`);
        allMatches.slice(0, 20).forEach(match => {
            console.log(`    €${match.price.toFixed(4)} - "${match.match}" (${match.pattern})`);
            console.log(`      Context: "${match.context.trim()}"`);
        });
    }

    /**
     * Analyze table structure
     */
    analyzeTableStructure($) {
        const tables = $('table');
        console.log(`  Found ${tables.length} tables`);

        tables.each((i, table) => {
            const rows = $(table).find('tr');
            const cells = $(table).find('td, th');
            const tableText = $(table).text();
            
            console.log(`\n  Table ${i + 1}:`);
            console.log(`    Rows: ${rows.length}, Cells: ${cells.length}`);
            console.log(`    Contains lokaler: ${tableText.includes('lokaler')}`);
            console.log(`    Contains Ökostrom: ${tableText.includes('Ökostrom')}`);
            console.log(`    Contains kWh: ${tableText.includes('kWh')}`);
            console.log(`    Text length: ${tableText.length}`);
            
            if (tableText.length < 500) { // Show content of smaller tables
                console.log(`    Content preview: "${tableText.substring(0, 200)}..."`);
            }
        });
    }

    /**
     * Analyze price context
     */
    analyzePriceContext(pageText) {
        const keywords = ['lokaler Versorger', 'Grundversorger', 'günstigster Ökostrom', 'Ökostrom'];
        
        keywords.forEach(keyword => {
            const index = pageText.toLowerCase().indexOf(keyword.toLowerCase());
            if (index !== -1) {
                const context = this.getContext(pageText, index, 150);
                console.log(`\n  "${keyword}" context:`);
                console.log(`    "${context}"`);
                
                // Look for prices in this context
                const prices = this.extractPricesFromText(context);
                if (prices.length > 0) {
                    console.log(`    Prices found: ${prices.map(p => `€${p.toFixed(4)}`).join(', ')}`);
                }
            }
        });
    }

    /**
     * Extract prices from a text snippet
     */
    extractPricesFromText(text) {
        const patterns = [
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)/gi,
            /(\d+[,.]?\d*)\s*(Cent|ct)/gi
        ];

        const prices = [];
        patterns.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            matches.forEach(match => {
                let price = parseFloat(match[1].replace(',', '.'));
                const unit = match[2].toLowerCase();
                
                if (unit.includes('cent') || unit.includes('ct')) {
                    price = price / 100;
                }
                
                if (price > 0.01 && price < 10) { // Reasonable range
                    prices.push(price);
                }
            });
        });

        return prices;
    }

    /**
     * Get context around a text position
     */
    getContext(text, position, length = 100) {
        const start = Math.max(0, position - length / 2);
        const end = Math.min(text.length, position + length / 2);
        return text.substring(start, end);
    }

    /**
     * Run complete analysis
     */
    async runCompleteAnalysis(month = null) {
        console.log('🔬 COMPREHENSIVE PRICE ISSUES ANALYSIS');
        console.log('='.repeat(60));

        try {
            // 1. Analyze big city issues
            const bigCityIssues = await this.analyzeBigCityPrices(month);

            // 2. Investigate a few specific problematic URLs
            console.log('\n🔍 DETAILED URL INVESTIGATIONS');
            console.log('='.repeat(50));

            if (bigCityIssues.extreme_prices.length > 0) {
                const samplesToInvestigate = bigCityIssues.extreme_prices.slice(0, 3);
                
                for (const entry of samplesToInvestigate) {
                    if (entry.source_url) {
                        await this.investigateURL(entry.source_url, entry.city_name, entry.plz);
                        await this.sleep(2000); // Be respectful to the server
                    }
                }
            }

            console.log('\n✅ Analysis complete!');

        } catch (error) {
            console.error('❌ Analysis failed:', error.message);
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

async function main() {
    const args = process.argv.slice(2);
    const analyzer = new PriceIssuesAnalyzer();

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🔬 Price Issues Analysis Tool

USAGE:
  node scripts/analyze-price-issues.js [OPTIONS]

OPTIONS:
  --month YYYY-MM-DD     Analyze specific month
  --big-cities           Analyze big city price issues only
  --url URL              Investigate specific URL
  --help, -h             Show this help

EXAMPLES:
  # Full analysis
  node scripts/analyze-price-issues.js

  # Analyze specific month
  node scripts/analyze-price-issues.js --month 2025-01-01

  # Only big cities analysis
  node scripts/analyze-price-issues.js --big-cities

  # Investigate specific URL
  node scripts/analyze-price-issues.js --url "https://www.stromauskunft.de/strompreise/10115/"
        `);
        return;
    }

    try {
        if (args.includes('--big-cities')) {
            const month = args.includes('--month') ? args[args.indexOf('--month') + 1] : null;
            await analyzer.analyzeBigCityPrices(month);
        } else if (args.includes('--url')) {
            const url = args[args.indexOf('--url') + 1];
            await analyzer.investigateURL(url, 'Test City', '12345');
        } else {
            const month = args.includes('--month') ? args[args.indexOf('--month') + 1] : null;
            await analyzer.runCompleteAnalysis(month);
        }
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

module.exports = PriceIssuesAnalyzer; 