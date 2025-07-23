const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

class PriceOutlierValidator {
    constructor() {
        this.results = [];
        this.validationResults = [];
        this.errors = [];
        this.delay = 2000; // 2 seconds between requests to be respectful
        this.outlierThreshold = 1.0; // EUR per kWh
        this.priceValidationRange = { min: 0.05, max: 2.0 };
        this.validationCounter = 0;
    }

    // Enhanced price parsing (same logic as original scraper)
    parsePrice(text) {
        if (!text) return null;
        
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

        for (let pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                
                // Convert cents to euros
                const unit = match[2] ? match[2].toLowerCase() : '';
                if (pattern.toString().includes('Cent') || pattern.toString().includes('ct') || 
                    unit.includes('cent') || unit.includes('ct')) {
                    price = price / 100;
                }
                
                // Validate reasonable price range
                if (price >= this.priceValidationRange.min && price <= this.priceValidationRange.max) {
                    return price;
                }
            }
        }
        return null;
    }

    // Enhanced price extraction with better prioritization
    extractPricesFromPage($, pageText) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;

        // STRATEGY 1: Look for clean, direct price table entries FIRST
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
                    
                    if (isLokalerVersorgerRow && !lokalerVersorgerPrice && priceFromCell2) {
                        lokalerVersorgerPrice = priceFromCell2;
                    } else if (isOekostromRow && !oekostromPrice && priceFromCell2) {
                        oekostromPrice = priceFromCell2;
                    }
                }
            }
        });

        // STRATEGY 2: Fallback to regex patterns if no clean table entries found
        if (!lokalerVersorgerPrice || !oekostromPrice) {
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
                        if (patternObj.type === 'lokal' && !lokalerVersorgerPrice) {
                            lokalerVersorgerPrice = price;
                        } else if (patternObj.type === 'oeko' && !oekostromPrice) {
                            oekostromPrice = price;
                        }
                    }
                }
            }
        }

        return { lokalerVersorgerPrice, oekostromPrice };
    }

    // Sleep function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Validate a single outlier by re-scraping
    async validateOutlier(outlierData) {
        this.validationCounter++;
        const { PLZ, City, OriginalLokalerPrice, OriginalOekoPrice, OriginalAverage, URL } = outlierData;
        
        try {
            console.log(`\n[${this.validationCounter}] 🔍 Validating: ${City} (PLZ: ${PLZ})`);
            console.log(`    Original Lokaler Price: €${OriginalLokalerPrice}`);
            console.log(`    URL: ${URL}`);
            
            const response = await axios.get(URL, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const pageText = $.text();

            const { lokalerVersorgerPrice, oekostromPrice } = this.extractPricesFromPage($, pageText);

            // Validation logic
            const isValidPrice = (price) => price && price >= this.priceValidationRange.min && price <= this.priceValidationRange.max;
            const validLokalerPrice = isValidPrice(lokalerVersorgerPrice) ? lokalerVersorgerPrice : null;
            const validOekoPrice = isValidPrice(oekostromPrice) ? oekostromPrice : null;

            // Calculate new average
            let newAveragePrice = null;
            if (validLokalerPrice && validOekoPrice) {
                newAveragePrice = (validLokalerPrice + validOekoPrice) / 2;
            } else if (validLokalerPrice) {
                newAveragePrice = validLokalerPrice;
            } else if (validOekoPrice) {
                newAveragePrice = validOekoPrice;
            }

            // Compare with original values
            const lokalerPriceDiff = validLokalerPrice ? (validLokalerPrice - parseFloat(OriginalLokalerPrice)) : null;
            const oekoPriceDiff = validOekoPrice && OriginalOekoPrice ? (validOekoPrice - parseFloat(OriginalOekoPrice)) : null;
            const averagePriceDiff = newAveragePrice ? (newAveragePrice - parseFloat(OriginalAverage)) : null;

            const result = {
                PLZ,
                City,
                OriginalLokalerPrice: parseFloat(OriginalLokalerPrice),
                NewLokalerPrice: validLokalerPrice,
                LokalerPriceDiff: lokalerPriceDiff,
                OriginalOekoPrice: OriginalOekoPrice ? parseFloat(OriginalOekoPrice) : null,
                NewOekoPrice: validOekoPrice,
                OekoPriceDiff: oekoPriceDiff,
                OriginalAverage: parseFloat(OriginalAverage),
                NewAverage: newAveragePrice,
                AveragePriceDiff: averagePriceDiff,
                URL,
                ValidationStatus: 'SUCCESS',
                ValidationDate: new Date().toISOString()
            };

            // Determine if this is a significant change
            const significantChangeThreshold = 0.1; // 10 cents
            const isSignificantChange = lokalerPriceDiff && Math.abs(lokalerPriceDiff) > significantChangeThreshold;
            result.IsSignificantChange = isSignificantChange;

            // Log results
            if (validLokalerPrice) {
                const changeSymbol = lokalerPriceDiff > 0 ? '↗️' : lokalerPriceDiff < 0 ? '↘️' : '→';
                console.log(`    ✅ New Lokaler Price: €${validLokalerPrice.toFixed(4)} ${changeSymbol} (${lokalerPriceDiff > 0 ? '+' : ''}€${lokalerPriceDiff.toFixed(4)})`);
                
                if (isSignificantChange) {
                    console.log(`    ⚠️  SIGNIFICANT CHANGE detected! Difference: €${Math.abs(lokalerPriceDiff).toFixed(4)}`);
                }
            } else {
                console.log(`    ❌ Could not extract new Lokaler price`);
                result.ValidationStatus = 'FAILED_EXTRACTION';
            }

            if (validOekoPrice) {
                console.log(`    ✅ New Ökostrom Price: €${validOekoPrice.toFixed(4)}`);
            } else {
                console.log(`    ⚠️  Could not extract Ökostrom price`);
            }

            this.validationResults.push(result);
            return result;

        } catch (error) {
            const errorResult = {
                PLZ,
                City,
                OriginalLokalerPrice: parseFloat(OriginalLokalerPrice),
                URL,
                ValidationStatus: 'ERROR',
                ErrorMessage: error.message,
                ValidationDate: new Date().toISOString()
            };

            this.errors.push(errorResult);
            console.log(`    ❌ Error validating ${City}: ${error.message}`);
            return errorResult;
        }
    }

    // Load outliers from CSV
    async loadOutliers(csvFile) {
        return new Promise((resolve, reject) => {
            const outliers = [];
            
            fs.createReadStream(csvFile)
                .pipe(csv())
                .on('data', (row) => {
                    const lokalerPrice = parseFloat(row.Lokaler_Versorger_Price_EUR_per_kWh);
                    
                    if (lokalerPrice > this.outlierThreshold) {
                        outliers.push({
                            PLZ: row.PLZ,
                            City: row.City,
                            OriginalLokalerPrice: lokalerPrice,
                            OriginalOekoPrice: row.Oekostrom_Price_EUR_per_kWh,
                            OriginalAverage: row.Average_Price_EUR_per_kWh,
                            URL: row.Source_URL
                        });
                    }
                })
                .on('end', () => {
                    console.log(`📊 Found ${outliers.length} outliers (Lokaler_Versorger_Price > €${this.outlierThreshold})`);
                    resolve(outliers);
                })
                .on('error', reject);
        });
    }

    // Generate reports
    async generateReports() {
        console.log('\n📋 Generating validation reports...');

        // Main validation results
        const validationCsvWriter = createCsvWriter({
            path: 'price_validation_results.csv',
            header: [
                { id: 'PLZ', title: 'PLZ' },
                { id: 'City', title: 'City' },
                { id: 'OriginalLokalerPrice', title: 'Original_Lokaler_Price_EUR' },
                { id: 'NewLokalerPrice', title: 'New_Lokaler_Price_EUR' },
                { id: 'LokalerPriceDiff', title: 'Lokaler_Price_Difference_EUR' },
                { id: 'OriginalOekoPrice', title: 'Original_Oeko_Price_EUR' },
                { id: 'NewOekoPrice', title: 'New_Oeko_Price_EUR' },
                { id: 'OekoPriceDiff', title: 'Oeko_Price_Difference_EUR' },
                { id: 'OriginalAverage', title: 'Original_Average_EUR' },
                { id: 'NewAverage', title: 'New_Average_EUR' },
                { id: 'AveragePriceDiff', title: 'Average_Price_Difference_EUR' },
                { id: 'IsSignificantChange', title: 'Is_Significant_Change' },
                { id: 'ValidationStatus', title: 'Validation_Status' },
                { id: 'URL', title: 'Source_URL' },
                { id: 'ValidationDate', title: 'Validation_Date' }
            ]
        });

        await validationCsvWriter.writeRecords(this.validationResults);
        console.log(`✅ Validation results saved: ${this.validationResults.length} records to price_validation_results.csv`);

        // Error report
        if (this.errors.length > 0) {
            const errorCsvWriter = createCsvWriter({
                path: 'price_validation_errors.csv',
                header: [
                    { id: 'PLZ', title: 'PLZ' },
                    { id: 'City', title: 'City' },
                    { id: 'OriginalLokalerPrice', title: 'Original_Lokaler_Price_EUR' },
                    { id: 'URL', title: 'Source_URL' },
                    { id: 'ValidationStatus', title: 'Validation_Status' },
                    { id: 'ErrorMessage', title: 'Error_Message' },
                    { id: 'ValidationDate', title: 'Validation_Date' }
                ]
            });

            await errorCsvWriter.writeRecords(this.errors);
            console.log(`⚠️  Errors saved: ${this.errors.length} errors to price_validation_errors.csv`);
        }

        // Summary statistics
        const successfulValidations = this.validationResults.filter(r => r.ValidationStatus === 'SUCCESS');
        const significantChanges = successfulValidations.filter(r => r.IsSignificantChange);
        const priceReductions = successfulValidations.filter(r => r.LokalerPriceDiff && r.LokalerPriceDiff < -0.01);
        const priceIncreases = successfulValidations.filter(r => r.LokalerPriceDiff && r.LokalerPriceDiff > 0.01);

        console.log('\n📊 VALIDATION SUMMARY:');
        console.log('='.repeat(50));
        console.log(`Total outliers processed: ${this.validationResults.length + this.errors.length}`);
        console.log(`Successful validations: ${successfulValidations.length}`);
        console.log(`Validation errors: ${this.errors.length}`);
        console.log(`Significant changes (>€0.10): ${significantChanges.length}`);
        console.log(`Price reductions: ${priceReductions.length}`);
        console.log(`Price increases: ${priceIncreases.length}`);

        if (significantChanges.length > 0) {
            console.log('\n🚨 TOP SIGNIFICANT CHANGES:');
            console.log('-'.repeat(70));
            
            significantChanges
                .sort((a, b) => Math.abs(b.LokalerPriceDiff) - Math.abs(a.LokalerPriceDiff))
                .slice(0, 10)
                .forEach(change => {
                    const symbol = change.LokalerPriceDiff > 0 ? '↗️' : '↘️';
                    console.log(`${change.PLZ} ${change.City}: €${change.OriginalLokalerPrice.toFixed(4)} → €${change.NewLokalerPrice.toFixed(4)} ${symbol} (${change.LokalerPriceDiff > 0 ? '+' : ''}€${change.LokalerPriceDiff.toFixed(4)})`);
                });
        }
    }

    // Main validation process
    async validateAllOutliers() {
        try {
            console.log('🔍 PRICE OUTLIER VALIDATION STARTED');
            console.log('='.repeat(50));
            
            // Load outliers
            const outliers = await this.loadOutliers('complete_electricity_prices.csv');
            
            if (outliers.length === 0) {
                console.log('✅ No outliers found to validate!');
                return;
            }

            console.log(`\n🚀 Starting validation of ${outliers.length} outliers...`);
            console.log(`⏱️  Estimated time: ${Math.ceil(outliers.length * this.delay / 1000 / 60)} minutes\n`);

            // Process outliers with delay
            for (let i = 0; i < outliers.length; i++) {
                await this.validateOutlier(outliers[i]);
                
                // Add delay between requests
                if (i < outliers.length - 1) {
                    await this.sleep(this.delay);
                }

                // Progress update every 25 validations
                if ((i + 1) % 25 === 0) {
                    console.log(`\n📈 Progress: ${i + 1}/${outliers.length} validations completed (${((i + 1) / outliers.length * 100).toFixed(1)}%)`);
                    console.log(`⏱️  Estimated remaining time: ${Math.ceil((outliers.length - i - 1) * this.delay / 1000 / 60)} minutes\n`);
                }
            }

            // Generate reports
            await this.generateReports();
            
            console.log('\n✅ PRICE OUTLIER VALIDATION COMPLETED!');

        } catch (error) {
            console.error('❌ Validation process failed:', error.message);
            console.error(error.stack);
        }
    }
}

// Run the validation
const validator = new PriceOutlierValidator();
validator.validateAllOutliers(); 