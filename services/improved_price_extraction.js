const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

class ImprovedPriceExtractor {
    constructor() {
        this.priceValidationRange = { min: 0.05, max: 2.0 };
    }

    // Enhanced price parsing
    parsePrice(text) {
        if (!text) return null;
        
        const patterns = [
            /(\d+[,.]?\d*)\s*Euro\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*EUR\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*€\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*Cent\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*ct?\s*\/?\s*kWh/i,
            /(\d+[,.]?\d*)\s*ct\s*pro\s*kWh/i,
            /(\d+[,.]?\d*)\s*(Euro|EUR|€)/i,
            /(\d+[,.]?\d*)\s*(Cent|ct)/i,
        ];

        for (let pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                const unit = match[2] ? match[2].toLowerCase() : '';
                if (pattern.toString().includes('Cent') || pattern.toString().includes('ct') || 
                    unit.includes('cent') || unit.includes('ct')) {
                    price = price / 100;
                }
                
                if (price >= this.priceValidationRange.min && price <= this.priceValidationRange.max) {
                    return price;
                }
            }
        }
        return null;
    }

    // Improved price extraction with better prioritization
    extractPricesFromPage($, pageText) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;

        console.log('🔍 IMPROVED PRICE EXTRACTION STRATEGY');
        console.log('='.repeat(50));

        // STRATEGY 1: Look for clean, direct price table entries FIRST
        console.log('\n📊 STRATEGY 1: Direct Price Table Analysis');
        console.log('-'.repeat(40));

        const priceTableResults = [];
        
        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = $(cells[1]).text().trim();
                const thirdCell = cells.length > 2 ? $(cells[2]).text().trim() : '';

                // Criteria for a "clean" price table entry:
                // 1. First cell contains our target keywords
                // 2. Second cell contains a direct price pattern (Euro pro kWh)
                // 3. Row is relatively simple (not a complex comparison)
                
                const isLokalerVersorgerRow = firstCell.includes('lokaler Versorger') || 
                                            firstCell.includes('Grundversorgung') ||
                                            firstCell.includes('lokaler Anbieter');
                
                const isOekostromRow = firstCell.includes('günstigster Ökostromtarif') || 
                                     firstCell.includes('günstigster Ökostrom') ||
                                     firstCell.includes('Ökostrom');

                const hasDirectPriceInSecondCell = secondCell.includes('pro kWh');
                const isSimpleRow = firstCell.length < 100; // Avoid complex comparison rows
                
                if ((isLokalerVersorgerRow || isOekostromRow) && hasDirectPriceInSecondCell && isSimpleRow) {
                    const priceFromCell2 = this.parsePrice(secondCell);
                    
                    console.log(`✅ CLEAN PRICE ROW ${i} (${isLokalerVersorgerRow ? 'LOKALER' : 'ÖEKO'}):`);
                    console.log(`   Cell 1: "${firstCell}"`);
                    console.log(`   Cell 2: "${secondCell}"`);
                    console.log(`   Extracted: €${priceFromCell2}`);
                    
                    priceTableResults.push({
                        row: i,
                        type: isLokalerVersorgerRow ? 'lokaler' : 'oeko',
                        price: priceFromCell2,
                        confidence: 'HIGH'
                    });

                    if (isLokalerVersorgerRow && !lokalerVersorgerPrice && priceFromCell2) {
                        lokalerVersorgerPrice = priceFromCell2;
                        console.log(`   🎯 ACCEPTED as lokaler Versorger price`);
                    } else if (isOekostromRow && !oekostromPrice && priceFromCell2) {
                        oekostromPrice = priceFromCell2;
                        console.log(`   🎯 ACCEPTED as Ökostrom price`);
                    }
                }
            }
        });

        // STRATEGY 2: Fallback to regex patterns if no clean table entries found
        if (!lokalerVersorgerPrice || !oekostromPrice) {
            console.log('\n📊 STRATEGY 2: Regex Pattern Fallback');
            console.log('-'.repeat(40));

            const patterns = [
                {
                    type: 'lokal',
                    regex: /lokaler?\s+Versorger.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                },
                {
                    type: 'lokal', 
                    regex: /Grundversorgung.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                },
                {
                    type: 'oeko',
                    regex: /günstigster?\s+Ökostrom.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                },
                {
                    type: 'oeko',
                    regex: /günstigster?\s+Alternativtarif.*?(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/i
                }
            ];

            for (let patternObj of patterns) {
                // Only use regex if we don't already have a price from the table strategy
                if ((patternObj.type === 'lokal' && lokalerVersorgerPrice) ||
                    (patternObj.type === 'oeko' && oekostromPrice)) {
                    continue;
                }

                const match = pageText.match(patternObj.regex);
                if (match) {
                    let price = parseFloat(match[1].replace(',', '.'));
                    const unit = match[2] || '';
                    
                    if (unit.toLowerCase().includes('cent') || unit.toLowerCase().includes('ct')) {
                        price = price / 100;
                    }

                    if (price >= this.priceValidationRange.min && price <= this.priceValidationRange.max) {
                        console.log(`📝 REGEX FALLBACK for ${patternObj.type}: €${price}`);
                        
                        if (patternObj.type === 'lokal' && !lokalerVersorgerPrice) {
                            lokalerVersorgerPrice = price;
                        } else if (patternObj.type === 'oeko' && !oekostromPrice) {
                            oekostromPrice = price;
                        }
                    }
                }
            }
        }

        console.log('\n🎯 FINAL IMPROVED RESULTS:');
        console.log('-'.repeat(30));
        console.log(`Lokaler Versorger Price: €${lokalerVersorgerPrice || 'NOT FOUND'}`);
        console.log(`Ökostrom Price: €${oekostromPrice || 'NOT FOUND'}`);

        return { lokalerVersorgerPrice, oekostromPrice };
    }

    // Test the improved extraction on Hopferau
    async testHopferau() {
        try {
            const url = 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-hopferau.html';
            
            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const pageText = $.text();

            const { lokalerVersorgerPrice, oekostromPrice } = this.extractPricesFromPage($, pageText);

            console.log('\n✅ IMPROVED EXTRACTION TEST RESULTS:');
            console.log('='.repeat(50));
            console.log(`Expected lokaler Versorger: €0.38`);
            console.log(`Improved extraction: €${lokalerVersorgerPrice}`);
            console.log(`✅ Correct: ${lokalerVersorgerPrice === 0.38 ? 'YES' : 'NO'}`);
            console.log(`Expected Ökostrom: €0.29`);
            console.log(`Improved extraction: €${oekostromPrice}`);
            console.log(`✅ Correct: ${oekostromPrice === 0.29 ? 'YES' : 'NO'}`);

        } catch (error) {
            console.error('❌ Test failed:', error.message);
        }
    }
}

// Run the improved extraction test
const extractor = new ImprovedPriceExtractor();
extractor.testHopferau(); 