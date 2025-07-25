#!/usr/bin/env node

/**
 * Missing Oekostrom Price Investigation
 * Specifically investigate why oekostrom prices are missing
 */

const SupabaseClient = require('../database/supabase-client');
const axios = require('axios');
const cheerio = require('cheerio');

class MissingOekoInvestigator {
    constructor() {
        this.db = new SupabaseClient();
    }

    /**
     * Find entries with missing oekostrom prices
     */
    async findMissingOekoPrices(month = null) {
        console.log('🔍 INVESTIGATING MISSING OEKOSTROM PRICES');
        console.log('='.repeat(50));

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

            console.log(`📊 Total entries checked: ${allData.length}`);

            // Analyze missing oekostrom patterns
            const analysis = {
                total_entries: allData.length,
                missing_oeko_only: [],
                missing_lokaler_only: [],
                missing_both: [],
                has_both: [],
                oeko_null_explicitly: [],
                oeko_zero_or_invalid: []
            };

            console.log('🔍 Analyzing price data quality...');
            for (const entry of allData) {
                const hasLokaler = entry.lokaler_versorger_price && parseFloat(entry.lokaler_versorger_price) > 0;
                const hasOeko = entry.oekostrom_price && parseFloat(entry.oekostrom_price) > 0;

                if (!hasLokaler && !hasOeko) {
                    analysis.missing_both.push(entry);
                } else if (hasLokaler && !hasOeko) {
                    analysis.missing_oeko_only.push(entry);
                    
                    // Further categorize the oeko missing cases
                    if (entry.oekostrom_price === null || entry.oekostrom_price === undefined) {
                        analysis.oeko_null_explicitly.push(entry);
                    } else if (parseFloat(entry.oekostrom_price) <= 0) {
                        analysis.oeko_zero_or_invalid.push(entry);
                    }
                } else if (!hasLokaler && hasOeko) {
                    analysis.missing_lokaler_only.push(entry);
                } else {
                    analysis.has_both.push(entry);
                }
            }

            console.log('\n📋 MISSING PRICE ANALYSIS:');
            console.log(`   ✅ Has both prices: ${analysis.has_both.length} (${(analysis.has_both.length/analysis.total_entries*100).toFixed(1)}%)`);
            console.log(`   ❌ Missing OEKO only: ${analysis.missing_oeko_only.length} (${(analysis.missing_oeko_only.length/analysis.total_entries*100).toFixed(1)}%)`);
            console.log(`   ❌ Missing LOKALER only: ${analysis.missing_lokaler_only.length} (${(analysis.missing_lokaler_only.length/analysis.total_entries*100).toFixed(1)}%)`);
            console.log(`   ❌ Missing BOTH: ${analysis.missing_both.length} (${(analysis.missing_both.length/analysis.total_entries*100).toFixed(1)}%)`);

            if (analysis.missing_oeko_only.length > 0) {
                console.log('\n🎯 FOCUSING ON MISSING OEKOSTROM CASES:');
                console.log(`   📊 Total missing oeko: ${analysis.missing_oeko_only.length}`);
                console.log(`   🔢 Explicitly null: ${analysis.oeko_null_explicitly.length}`);
                console.log(`   0️⃣ Zero/invalid values: ${analysis.oeko_zero_or_invalid.length}`);

                // Show examples
                console.log('\n📝 Examples of cities missing oekostrom prices:');
                analysis.missing_oeko_only.slice(0, 10).forEach((entry, i) => {
                    console.log(`   ${i+1}. ${entry.city_name} (${entry.plz}): Lokaler €${entry.lokaler_versorger_price}, Oeko ${entry.oekostrom_price}`);
                    console.log(`      URL: ${entry.source_url}`);
                });

                // Analyze patterns by city size/type
                console.log('\n🏙️ CITY PATTERN ANALYSIS:');
                this.analyzeCityPatterns(analysis.missing_oeko_only);
            }

            return analysis;

        } catch (error) {
            console.error('❌ Error investigating missing oeko prices:', error.message);
            throw error;
        }
    }

    /**
     * Analyze patterns in cities with missing oeko prices
     */
    analyzeCityPatterns(missingOekoEntries) {
        const bigCities = [
            'Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt am Main',
            'Stuttgart', 'Düsseldorf', 'Dortmund', 'Essen', 'Leipzig',
            'Bremen', 'Dresden', 'Hannover', 'Nürnberg', 'Duisburg',
            'Bochum', 'Wuppertal', 'Bielefeld', 'Bonn', 'Münster'
        ];

        const bigCitiesMissing = missingOekoEntries.filter(entry => 
            bigCities.includes(entry.city_name)
        );

        const smallCitiesMissing = missingOekoEntries.filter(entry => 
            !bigCities.includes(entry.city_name)
        );

        console.log(`   🏙️ Big cities missing oeko: ${bigCitiesMissing.length}`);
        console.log(`   🏘️ Small cities missing oeko: ${smallCitiesMissing.length}`);

        if (bigCitiesMissing.length > 0) {
            console.log('\n   Big cities with missing oekostrom:');
            bigCitiesMissing.slice(0, 5).forEach(entry => {
                console.log(`     - ${entry.city_name} (${entry.plz}): Lokaler €${entry.lokaler_versorger_price}`);
            });
        }

        // Analyze PLZ patterns
        const plzPatterns = {};
        missingOekoEntries.forEach(entry => {
            const firstTwo = entry.plz.substring(0, 2);
            plzPatterns[firstTwo] = (plzPatterns[firstTwo] || 0) + 1;
        });

        console.log('\n   📮 Regional patterns (by PLZ prefix):');
        Object.entries(plzPatterns)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .forEach(([prefix, count]) => {
                console.log(`     ${prefix}xxx: ${count} cities missing oeko`);
            });
    }

    /**
     * Investigate specific URLs to understand why oeko extraction fails
     */
    async investigateOekoExtraction(entries, maxToCheck = 5) {
        console.log('\n🔍 DETAILED OEKO EXTRACTION INVESTIGATION');
        console.log('='.repeat(50));

        const samplesToCheck = entries.slice(0, maxToCheck);

        for (let i = 0; i < samplesToCheck.length; i++) {
            const entry = samplesToCheck[i];
            console.log(`\n[${i+1}/${samplesToCheck.length}] 🌐 Investigating: ${entry.city_name} (${entry.plz})`);
            console.log(`URL: ${entry.source_url}`);
            console.log(`Current data: Lokaler €${entry.lokaler_versorger_price}, Oeko ${entry.oekostrom_price}`);

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
                console.log(`  - Contains "Ökostrom": ${pageText.includes('Ökostrom')}`);
                console.log(`  - Contains "günstigster Ökostrom": ${pageText.includes('günstigster Ökostrom')}`);
                console.log(`  - Contains "Ökostromanbieter": ${pageText.includes('Ökostromanbieter')}`);
                console.log(`  - Contains "grüner Strom": ${pageText.includes('grüner Strom')}`);

                // Look for all potential oekostrom patterns
                this.findOekostromPatterns($, pageText);

                // Check table structure for oekostrom
                this.analyzeOekostromInTables($);

                await this.sleep(2000); // Be respectful

            } catch (error) {
                console.log(`  ❌ Error fetching page: ${error.message}`);
            }
        }
    }

    /**
     * Find all potential oekostrom patterns in the page
     */
    findOekostromPatterns($, pageText) {
        console.log('\n💚 OEKOSTROM PATTERN SEARCH:');

        // Common oekostrom keywords
        const oekoKeywords = [
            'günstigster Ökostrom',
            'günstigster Ökostromtarif',
            'günstigster Ökostromanbieter',
            'Ökostrom',
            'Ökostromanbieter',
            'grüner Strom',
            'Naturstrom',
            'erneuerbarer Strom'
        ];

        const foundPatterns = [];

        oekoKeywords.forEach(keyword => {
            const regex = new RegExp(`${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(\\d+[,.]?\\d*)\\s*(Euro|EUR|€|Cent|ct)\\s*pro\\s*kWh`, 'gi');
            const matches = [...pageText.matchAll(regex)];
            
            matches.forEach(match => {
                let price = parseFloat(match[1].replace(',', '.'));
                const unit = match[2].toLowerCase();
                
                if (unit.includes('cent') || unit.includes('ct')) {
                    price = price / 100;
                }
                
                foundPatterns.push({
                    keyword,
                    price,
                    match: match[0].substring(0, 100) + '...',
                    context: this.getContext(pageText, match.index, 200)
                });
            });
        });

        if (foundPatterns.length > 0) {
            console.log(`  ✅ Found ${foundPatterns.length} potential oekostrom patterns:`);
            foundPatterns.forEach((pattern, i) => {
                console.log(`    ${i+1}. "${pattern.keyword}" -> €${pattern.price.toFixed(4)}`);
                console.log(`       Match: "${pattern.match}"`);
                console.log(`       Context: "${pattern.context.trim()}"\n`);
            });
        } else {
            console.log('  ❌ No oekostrom price patterns found');
        }

        return foundPatterns;
    }

    /**
     * Analyze table structure for oekostrom
     */
    analyzeOekostromInTables($) {
        console.log('\n📋 TABLE ANALYSIS FOR OEKOSTROM:');

        const tables = $('table');
        console.log(`  Found ${tables.length} tables`);

        let oekoTableCount = 0;
        tables.each((i, table) => {
            const tableText = $(table).text();
            const hasOeko = tableText.toLowerCase().includes('ökostrom');
            
            if (hasOeko) {
                oekoTableCount++;
                console.log(`\n  Table ${i+1} contains "Ökostrom":`);
                console.log(`    Text length: ${tableText.length} chars`);
                
                // Look for rows that might contain oekostrom prices
                $(table).find('tr').each((rowIndex, row) => {
                    const rowText = $(row).text();
                    if (rowText.toLowerCase().includes('ökostrom') && rowText.includes('kWh')) {
                        console.log(`    Row ${rowIndex}: "${rowText.trim()}"`);
                    }
                });
                
                if (tableText.length < 300) {
                    console.log(`    Full content: "${tableText}"`);
                }
            }
        });

        console.log(`  Tables containing "Ökostrom": ${oekoTableCount}`);
    }

    /**
     * Get context around a position
     */
    getContext(text, position, length = 150) {
        const start = Math.max(0, position - length / 2);
        const end = Math.min(text.length, position + length / 2);
        return text.substring(start, end);
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Run complete investigation
     */
    async runCompleteInvestigation(month = null) {
        try {
            console.log('🔬 MISSING OEKOSTROM PRICE INVESTIGATION');
            console.log('='.repeat(60));

            // 1. Find all missing oeko entries
            const analysis = await this.findMissingOekoPrices(month);

            // 2. If we found missing oeko entries, investigate some URLs
            if (analysis.missing_oeko_only.length > 0) {
                await this.investigateOekoExtraction(analysis.missing_oeko_only, 3);
                
                // 3. Provide recommendations
                console.log('\n💡 RECOMMENDATIONS:');
                this.provideRecommendations(analysis);
            } else {
                console.log('\n✅ No missing oekostrom prices found!');
            }

        } catch (error) {
            console.error('❌ Investigation failed:', error.message);
            throw error;
        }
    }

    /**
     * Provide recommendations based on findings
     */
    provideRecommendations(analysis) {
        console.log('='.repeat(50));
        
        if (analysis.missing_oeko_only.length > 0) {
            console.log(`📊 ${analysis.missing_oeko_only.length} cities missing oekostrom prices (${(analysis.missing_oeko_only.length/analysis.total_entries*100).toFixed(1)}%)`);
            
            console.log('\n🔧 Recommended actions:');
            console.log('1. Run enhanced cleanup to re-extract oekostrom prices:');
            console.log('   npm run cleanup:test');
            
            console.log('\n2. Focus on specific regions with high missing rates');
            
            console.log('\n3. Update extraction patterns if pages have changed structure');
            
            console.log('\n4. Consider different extraction strategies for different city types');
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    const investigator = new MissingOekoInvestigator();

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🔍 Missing Oekostrom Price Investigator

USAGE:
  node scripts/investigate-missing-oeko.js [OPTIONS]

OPTIONS:
  --month YYYY-MM-DD     Investigate specific month
  --help, -h             Show this help

EXAMPLES:
  # Investigate all data
  node scripts/investigate-missing-oeko.js

  # Investigate specific month
  node scripts/investigate-missing-oeko.js --month 2025-01-01
        `);
        return;
    }

    try {
        const month = args.includes('--month') ? args[args.indexOf('--month') + 1] : null;
        await investigator.runCompleteInvestigation(month);
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

module.exports = MissingOekoInvestigator; 