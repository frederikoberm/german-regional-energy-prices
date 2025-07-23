const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

class BatchedStromauskunftScraper {
    constructor() {
        this.baseUrl = 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-';
        this.results = [];
        this.errors = [];
        this.delay = 1000; // 1 second
        this.stateFile = 'scraper_state.json';
        this.progressFile = 'scraper_progress.csv';
        this.batchSize = 0; // Will be calculated as 20% of total
        this.currentBatch = 0;
        this.totalBatches = 5; // 5 batches of 20% each
        this.processedCities = new Set();
        this.allCities = [];
    }

    // Load previous state if exists
    loadState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.currentBatch = state.currentBatch || 0;
                this.processedCities = new Set(state.processedCities || []);
                this.results = state.results || [];
                this.errors = state.errors || [];
                
                console.log(`📁 Loaded previous state: Batch ${this.currentBatch + 1}/${this.totalBatches}`);
                console.log(`📊 Previously processed: ${this.processedCities.size} cities`);
                console.log(`✅ Results so far: ${this.results.length}`);
                console.log(`❌ Errors so far: ${this.errors.length}`);
                return true;
            }
        } catch (error) {
            console.error('⚠️  Error loading state:', error.message);
        }
        return false;
    }

    // Save current state
    saveState() {
        const state = {
            currentBatch: this.currentBatch,
            processedCities: Array.from(this.processedCities),
            results: this.results,
            errors: this.errors,
            timestamp: new Date().toISOString(),
            totalCities: this.allCities.length,
            batchSize: this.batchSize
        };

        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
            console.log(`💾 State saved successfully`);
        } catch (error) {
            console.error('❌ Error saving state:', error.message);
        }
    }

    // Save progress to CSV after each batch
    async saveProgress() {
        try {
            // Save results
            if (this.results.length > 0) {
                const csvWriter = createCsvWriter({
                    path: 'electricity_prices_results_progress.csv',
                    header: [
                        { id: 'city', title: 'City' },
                        { id: 'plz', title: 'PLZ' },
                        { id: 'lokalerVersorgerPrice', title: 'Lokaler_Versorger_Price_EUR_per_kWh' },
                        { id: 'oekostromPrice', title: 'Oekostrom_Price_EUR_per_kWh' },
                        { id: 'averagePrice', title: 'Average_Price_EUR_per_kWh' },
                        { id: 'isOutlier', title: 'Is_Outlier' },
                        { id: 'outlierSeverity', title: 'Outlier_Severity' },
                        { id: 'sourceUrl', title: 'Source_URL' }
                    ]
                });

                const recordsWithUrls = this.results.map(result => ({
                    city: result.city,
                    plz: result.plz,
                    lokalerVersorgerPrice: result.lokalerVersorgerPrice,
                    oekostromPrice: result.oekostromPrice,
                    averagePrice: result.averagePrice,
                    isOutlier: result.isOutlier || false,
                    outlierSeverity: result.outlierSeverity || 'normal',
                    sourceUrl: this.buildUrl(result.city)
                }));

                await csvWriter.writeRecords(recordsWithUrls);
                console.log(`📊 Progress saved: ${this.results.length} results to electricity_prices_results_progress.csv`);
            }

            // Save errors
            if (this.errors.length > 0) {
                const errorCsvWriter = createCsvWriter({
                    path: 'electricity_prices_errors_progress.csv',
                    header: [
                        { id: 'city', title: 'City' },
                        { id: 'plz', title: 'PLZ' },
                        { id: 'error', title: 'Error' },
                        { id: 'url', title: 'URL' }
                    ]
                });

                await errorCsvWriter.writeRecords(this.errors);
                console.log(`⚠️  Errors saved: ${this.errors.length} errors to electricity_prices_errors_progress.csv`);
            }
        } catch (error) {
            console.error('❌ Error saving progress:', error.message);
        }
    }

    // Convert German umlauts and special characters
    normalizeGermanText(text) {
        return text
            .replace(/ä/g, 'ae')
            .replace(/Ä/g, 'Ae')
            .replace(/ö/g, 'oe')
            .replace(/Ö/g, 'Oe')
            .replace(/ü/g, 'ue')
            .replace(/Ü/g, 'Ue')
            .replace(/ß/g, 'ss')
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9\-]/g, '')
            .toLowerCase();
    }

    // Extract city name (first part before comma if exists)
    extractCityName(fullName) {
        const cityName = fullName.split(',')[0].trim();
        return this.normalizeGermanText(cityName);
    }

    // Build URL for city
    buildUrl(cityName) {
        return `${this.baseUrl}${cityName}.html`;
    }

    // Sleep function
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Enhanced price parsing
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
                if (price >= 0.05 && price <= 2.0) {
                    return price;
                }
            }
        }
        return null;
    }

    // Enhanced price extraction with improved strategy to avoid comparison table interference
    extractPricesFromPage($, pageText) {
        let lokalerVersorgerPrice = null;
        let oekostromPrice = null;

        console.log('    🔍 Strategy 1: Looking for clean price table entries...');
        
        // Strategy 1: Clean, direct price table entries (prioritized)
        // Focus on simple, direct price table rows and avoid comparison tables
        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = $(cells[1]).text().trim();
                const rowText = $(row).text().trim();
                
                // Skip rows that are too long (likely comparison tables) or contain provider names
                if (rowText.length > 100 || 
                    firstCell.includes('LichtBlick') || 
                    firstCell.includes('E.ON') || 
                    firstCell.includes('Vattenfall') ||
                    firstCell.includes('EnBW') ||
                    firstCell.includes('RWE') ||
                    rowText.includes('Tarif') ||
                    rowText.includes('Anbieter')) {
                    return; // Skip this row
                }

                // Look for rows with price keywords and "pro kWh" in second cell
                const hasKeyword = firstCell.includes('lokaler Versorger') || 
                                 firstCell.includes('Grundversorgung') ||
                                 firstCell.includes('lokaler Anbieter') ||
                                 firstCell.includes('günstigster Ökostromtarif') || 
                                 firstCell.includes('günstigster Ökostrom') ||
                                 firstCell.includes('Ökostrom');
                                 
                const hasProKwh = secondCell.includes('pro kWh');

                if (hasKeyword && hasProKwh) {
                    console.log(`      Found clean price row: "${firstCell}" -> "${secondCell}"`);
                    
                    // Look for local provider
                    if (firstCell.includes('lokaler Versorger') || 
                        firstCell.includes('Grundversorgung') ||
                        firstCell.includes('lokaler Anbieter')) {
                        const price = this.parsePrice(secondCell);
                        if (price && (!lokalerVersorgerPrice || price < 1.0)) { // Prefer prices under €1
                            lokalerVersorgerPrice = price;
                            console.log(`      ✅ Lokaler Versorger: €${price}`);
                        }
                    }
                    
                    // Look for green energy
                    if (firstCell.includes('günstigster Ökostromtarif') || 
                        firstCell.includes('günstigster Ökostrom') ||
                        firstCell.includes('Ökostrom')) {
                        const price = this.parsePrice(secondCell);
                        if (price && (!oekostromPrice || price < 1.0)) { // Prefer prices under €1
                            oekostromPrice = price;
                            console.log(`      ✅ Ökostrom: €${price}`);
                        }
                    }
                }
            }
        });

        // Strategy 2: Fallback to regex patterns only if Strategy 1 didn't find prices
        if (!lokalerVersorgerPrice || !oekostromPrice) {
            console.log('    🔍 Strategy 2: Using regex fallback for missing prices...');
            
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
                const match = pageText.match(patternObj.regex);
                if (match) {
                    let price = parseFloat(match[1].replace(',', '.'));
                    const unit = match[2] || '';
                    
                    if (unit.toLowerCase().includes('cent') || unit.toLowerCase().includes('ct')) {
                        price = price / 100;
                    }

                    if (price >= 0.05 && price <= 2.0) {
                        if (patternObj.type === 'lokal' && !lokalerVersorgerPrice) {
                            lokalerVersorgerPrice = price;
                            console.log(`      ✅ Regex found Lokaler Versorger: €${price}`);
                        } else if (patternObj.type === 'oeko' && !oekostromPrice) {
                            oekostromPrice = price;
                            console.log(`      ✅ Regex found Ökostrom: €${price}`);
                        }
                    }
                }
            }
        }

        return { lokalerVersorgerPrice, oekostromPrice };
    }

    // Outlier detection thresholds
    static OUTLIER_THRESHOLDS = {
        HIGH_PRICE: 1.0,      // Prices above €1.00 are potential outliers
        VERY_HIGH_PRICE: 1.5, // Prices above €1.50 are very suspicious
        EXTREME_PRICE: 2.0    // Prices above €2.00 are invalid
    };

    // Detect if prices are outliers
    detectOutliers(lokalerPrice, oekostromPrice) {
        const outliers = {
            hasOutliers: false,
            lokalerOutlier: false,
            oekostromOutlier: false,
            severity: 'normal',
            warnings: []
        };

        // Check lokaler versorger price
        if (lokalerPrice) {
            if (lokalerPrice >= BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.VERY_HIGH_PRICE) {
                outliers.lokalerOutlier = true;
                outliers.hasOutliers = true;
                outliers.severity = 'very_high';
                outliers.warnings.push(`Lokaler Versorger price €${lokalerPrice.toFixed(4)} is very high (≥€${BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.VERY_HIGH_PRICE})`);
            } else if (lokalerPrice >= BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.HIGH_PRICE) {
                outliers.lokalerOutlier = true;
                outliers.hasOutliers = true;
                outliers.severity = outliers.severity === 'very_high' ? 'very_high' : 'high';
                outliers.warnings.push(`Lokaler Versorger price €${lokalerPrice.toFixed(4)} is high (≥€${BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.HIGH_PRICE})`);
            }
        }

        // Check ökostrom price
        if (oekostromPrice) {
            if (oekostromPrice >= BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.VERY_HIGH_PRICE) {
                outliers.oekostromOutlier = true;
                outliers.hasOutliers = true;
                outliers.severity = 'very_high';
                outliers.warnings.push(`Ökostrom price €${oekostromPrice.toFixed(4)} is very high (≥€${BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.VERY_HIGH_PRICE})`);
            } else if (oekostromPrice >= BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.HIGH_PRICE) {
                outliers.oekostromOutlier = true;
                outliers.hasOutliers = true;
                outliers.severity = outliers.severity === 'very_high' ? 'very_high' : 'high';
                outliers.warnings.push(`Ökostrom price €${oekostromPrice.toFixed(4)} is high (≥€${BatchedStromauskunftScraper.OUTLIER_THRESHOLDS.HIGH_PRICE})`);
            }
        }

        return outliers;
    }

    // Validate outliers with additional checks
    async validateOutlierPrices(cityName, plz, lokalerPrice, oekostromPrice, $, pageText, url) {
        console.log(`    🚨 OUTLIER DETECTED - Running additional validation...`);
        
        const validation = {
            originalLokalerPrice: lokalerPrice,
            originalOekostromPrice: oekostromPrice,
            validatedLokalerPrice: lokalerPrice,
            validatedOekostromPrice: oekostromPrice,
            validationAttempted: true,
            validationSuccessful: false,
            validationNotes: []
        };

        try {
            // Re-extract prices with stricter criteria
            console.log(`    🔍 Re-extracting prices with stricter validation...`);
            
            // Try alternative extraction focusing on summary tables only
            let alternativeLokalerPrice = null;
            let alternativeOekostromPrice = null;

            // Look specifically for summary/overview tables (not comparison tables)
            $('table').each((tableIndex, table) => {
                const tableText = $(table).text();
                
                // Skip tables that look like comparison tables
                if (tableText.includes('LichtBlick') || 
                    tableText.includes('E.ON') || 
                    tableText.includes('Vattenfall') ||
                    tableText.includes('Tarif') ||
                    tableText.length > 1000) {
                    return; // Skip this table
                }

                $(table).find('tr').each((rowIndex, row) => {
                    const cells = $(row).find('td');
                    if (cells.length >= 2) {
                        const firstCell = $(cells[0]).text().trim();
                        const secondCell = $(cells[1]).text().trim();
                        
                        // Very strict matching for outlier validation
                        if (firstCell === 'lokaler Versorger' && secondCell.includes('pro kWh')) {
                            const price = this.parsePrice(secondCell);
                            if (price && price < 1.0) { // Only accept prices under €1
                                alternativeLokalerPrice = price;
                                validation.validationNotes.push(`Found alternative lokaler price: €${price} in summary table`);
                            }
                        }
                        
                        if (firstCell.includes('günstigster Ökostrom') && secondCell.includes('pro kWh')) {
                            const price = this.parsePrice(secondCell);
                            if (price && price < 1.0) { // Only accept prices under €1
                                alternativeOekostromPrice = price;
                                validation.validationNotes.push(`Found alternative ökostrom price: €${price} in summary table`);
                            }
                        }
                    }
                });
            });

            // Use alternative prices if they seem more reasonable
            if (alternativeLokalerPrice && alternativeLokalerPrice < lokalerPrice) {
                validation.validatedLokalerPrice = alternativeLokalerPrice;
                validation.validationSuccessful = true;
                validation.validationNotes.push(`Updated lokaler price from €${lokalerPrice} to €${alternativeLokalerPrice} (reduction: €${(lokalerPrice - alternativeLokalerPrice).toFixed(4)})`);
                console.log(`    ✅ Validation: Lokaler price corrected €${lokalerPrice} → €${alternativeLokalerPrice}`);
            }

            if (alternativeOekostromPrice && alternativeOekostromPrice < oekostromPrice) {
                validation.validatedOekostromPrice = alternativeOekostromPrice;
                validation.validationSuccessful = true;
                validation.validationNotes.push(`Updated ökostrom price from €${oekostromPrice} to €${alternativeOekostromPrice} (reduction: €${(oekostromPrice - alternativeOekostromPrice).toFixed(4)})`);
                console.log(`    ✅ Validation: Ökostrom price corrected €${oekostromPrice} → €${alternativeOekostromPrice}`);
            }

            if (!validation.validationSuccessful) {
                validation.validationNotes.push('No better alternative prices found during validation');
                console.log(`    ⚠️  Validation: No better prices found, keeping original outliers`);
            }

        } catch (error) {
            validation.validationNotes.push(`Validation failed: ${error.message}`);
            console.log(`    ❌ Validation error: ${error.message}`);
        }

        return validation;
    }

    // Scrape a single city
    async scrapeCityPrices(cityName, plz) {
        const cityKey = `${cityName}_${plz}`;
        
        // Skip if already processed
        if (this.processedCities.has(cityKey)) {
            console.log(`    ⏭️  Skipping already processed: ${cityName}`);
            return null;
        }

        const url = this.buildUrl(cityName);
        
        try {
            console.log(`\n🌐 Scraping: ${cityName} (PLZ: ${plz})`);
            console.log(`    URL: ${url}`);
            
            const response = await axios.get(url, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });

            const $ = cheerio.load(response.data);
            const pageText = $.text();

            const { lokalerVersorgerPrice, oekostromPrice } = this.extractPricesFromPage($, pageText);

            // Mark as processed
            this.processedCities.add(cityKey);

            // Validation
            const isValidPrice = (price) => price && price >= 0.05 && price <= 2.0;
            const validLokalerPrice = isValidPrice(lokalerVersorgerPrice) ? lokalerVersorgerPrice : null;
            const validOekoPrice = isValidPrice(oekostromPrice) ? oekostromPrice : null;

            if (!validLokalerPrice && !validOekoPrice) {
                this.errors.push({
                    city: cityName,
                    plz: plz,
                    error: 'No valid prices found on page',
                    url: url
                });
                console.log('    ❌ No valid prices found');
                return null;
            }

            // Detect outliers
            const outliers = this.detectOutliers(validLokalerPrice, validOekoPrice);
            let validationResult = null;
            
            if (outliers.hasOutliers) {
                console.log(`    ⚠️  Outlier detected for ${cityName}:`);
                outliers.warnings.forEach(warning => console.log(`      • ${warning}`));
                
                // Attempt to validate outliers
                validationResult = await this.validateOutlierPrices(cityName, plz, validLokalerPrice, validOekoPrice, $, pageText, url);
                
                // Update prices if validation was successful
                if (validationResult.validationSuccessful) {
                    validLokalerPrice = validationResult.validatedLokalerPrice;
                    validOekoPrice = validationResult.validatedOekostromPrice;
                    console.log(`    ✅ Outliers validated. Updated prices: Lokaler €${validLokalerPrice.toFixed(4)}, Ökostrom €${validOekoPrice.toFixed(4)}`);
                } else {
                    console.log(`    ⚠️  Outliers could not be validated. Keeping original prices.`);
                }
            }

            // Calculate average
            let averagePrice = null;
            if (validLokalerPrice && validOekoPrice) {
                averagePrice = (validLokalerPrice + validOekoPrice) / 2;
            } else if (validLokalerPrice) {
                averagePrice = validLokalerPrice;
                this.errors.push({
                    city: cityName,
                    plz: plz,
                    error: 'Only lokaler Versorger price found',
                    url: url
                });
            } else if (validOekoPrice) {
                averagePrice = validOekoPrice;
                this.errors.push({
                    city: cityName,
                    plz: plz,
                    error: 'Only Ökostrom price found',
                    url: url
                });
            }

            if (averagePrice) {
                const result = {
                    city: cityName,
                    plz: plz,
                    lokalerVersorgerPrice: validLokalerPrice,
                    oekostromPrice: validOekoPrice,
                    averagePrice: parseFloat(averagePrice.toFixed(4)),
                    isOutlier: outliers.hasOutliers,
                    outlierSeverity: outliers.severity,
                    outlierFlags: outliers.hasOutliers ? {
                        lokalerOutlier: outliers.lokalerOutlier,
                        oekostromOutlier: outliers.oekostromOutlier,
                        warnings: outliers.warnings,
                        validationAttempted: outliers.hasOutliers,
                        validationSuccessful: outliers.hasOutliers && validationResult && validationResult.validationSuccessful,
                        validationNotes: outliers.hasOutliers && validationResult ? validationResult.validationNotes : []
                    } : null
                };
                
                this.results.push(result);
                
                // Enhanced logging based on outlier status
                if (outliers.hasOutliers) {
                    const severity = outliers.severity === 'very_high' ? '🔴' : '🟡';
                    const validationStatus = outliers.hasOutliers && validationResult && validationResult.validationSuccessful ? '(Validated ✅)' : '(Needs Review ⚠️)';
                    console.log(`    ${severity} OUTLIER: ${cityName} - Average: €${averagePrice.toFixed(4)}/kWh ${validationStatus}`);
                } else {
                    console.log(`    ✅ Success: ${cityName} - Average: €${averagePrice.toFixed(4)}/kWh`);
                }
                
                return result;
            }

        } catch (error) {
            this.processedCities.add(cityKey);
            this.errors.push({
                city: cityName,
                plz: plz,
                error: `Scraping failed: ${error.message}`,
                url: url
            });
            console.log(`    ❌ Error scraping ${cityName}: ${error.message}`);
            return null;
        }
    }

    // Read cities from CSV
    async readCitiesFromCSV(inputFile) {
        return new Promise((resolve, reject) => {
            const cities = [];
            
            fs.createReadStream(inputFile)
                .pipe(csv({ separator: ';' })) // German CSV files often use semicolon
                .on('data', (row) => {
                    // Try different possible column names based on actual CSV structure
                    const cityName = row['PLZ Name (short)'] || row.Name || row.Ort || row.Stadt || row.City || row.name || row.ort || row.stadt;
                    const plz = row['Postleitzahl / Post code'] || row.PLZ || row.plz || row.Postleitzahl || row.postleitzahl || row.zipcode;
                    
                    if (cityName && plz) {
                        cities.push({
                            originalName: cityName,
                            normalizedName: this.extractCityName(cityName),
                            plz: plz
                        });
                    }
                })
                .on('end', () => {
                    console.log(`📖 Read ${cities.length} cities from ${inputFile}`);
                    resolve(cities);
                })
                .on('error', reject);
        });
    }

    // Get the current batch of cities to process
    getCurrentBatch() {
        const startIndex = this.currentBatch * this.batchSize;
        const endIndex = Math.min(startIndex + this.batchSize, this.allCities.length);
        return this.allCities.slice(startIndex, endIndex);
    }

    // Run a single batch
    async runBatch() {
        const batch = this.getCurrentBatch();
        
        if (batch.length === 0) {
            console.log('🎉 All batches completed!');
            return false;
        }

        console.log(`\n🚀 Starting Batch ${this.currentBatch + 1}/${this.totalBatches}`);
        console.log(`📊 Processing cities ${this.currentBatch * this.batchSize + 1} to ${Math.min((this.currentBatch + 1) * this.batchSize, this.allCities.length)} of ${this.allCities.length}`);
        console.log(`⏱️  Estimated time: ${Math.ceil(batch.length * this.delay / 1000 / 60)} minutes\n`);

        let batchResults = 0;
        let batchErrors = 0;

        for (let i = 0; i < batch.length; i++) {
            const city = batch[i];
            const cityKey = `${city.normalizedName}_${city.plz}`;
            
            // Skip if already processed
            if (this.processedCities.has(cityKey)) {
                console.log(`⏭️  [${i + 1}/${batch.length}] Skipping ${city.originalName} (already processed)`);
                continue;
            }

            console.log(`[${i + 1}/${batch.length}] Processing: ${city.originalName} -> ${city.normalizedName}`);
            
            const result = await this.scrapeCityPrices(city.normalizedName, city.plz);
            
            if (result) {
                batchResults++;
            } else {
                batchErrors++;
            }

            // Add delay between requests (except for the last one)
            if (i < batch.length - 1) {
                console.log(`    ⏳ Waiting ${this.delay/1000}s...`);
                await this.sleep(this.delay);
            }

            // Save state every 10 cities
            if ((i + 1) % 10 === 0) {
                this.saveState();
            }
        }

        // Update batch counter
        this.currentBatch++;
        
        // Save final state and progress
        this.saveState();
        await this.saveProgress();

        // Calculate batch outlier statistics
        const batchOutliers = this.results.slice(-batchResults).filter(result => result.isOutlier);
        const batchValidatedOutliers = batchOutliers.filter(result => 
            result.outlierFlags && result.outlierFlags.validationSuccessful
        );

        // Print batch summary
        console.log(`\n📊 === BATCH ${this.currentBatch}/${this.totalBatches} SUMMARY ===`);
        console.log(`Cities processed this batch: ${batch.length}`);
        console.log(`Successful extractions: ${batchResults}`);
        console.log(`Errors this batch: ${batchErrors}`);
        console.log(`Batch success rate: ${((batchResults / batch.length) * 100).toFixed(1)}%`);
        
        if (batchOutliers.length > 0) {
            console.log(`🚨 Outliers detected this batch: ${batchOutliers.length}`);
            console.log(`✅ Outliers validated this batch: ${batchValidatedOutliers.length}`);
        }
        
        console.log(`\n📈 Overall progress: ${this.processedCities.size}/${this.allCities.length} cities (${((this.processedCities.size / this.allCities.length) * 100).toFixed(1)}%)`);
        console.log(`✅ Total results: ${this.results.length}`);
        console.log(`❌ Total errors: ${this.errors.length}\n`);

        return this.currentBatch < this.totalBatches;
    }

    // Main scraping function
    async scrapeElectricityPrices(inputFile) {
        console.log('🚀 Starting Batched Stromauskunft.de Scraper...');
        console.log(`⏱️  Using ${this.delay}ms delay between requests`);
        
        try {
            // Load previous state if exists
            const hasState = this.loadState();
            
            // Read all cities if not already loaded
            if (this.allCities.length === 0) {
                this.allCities = await this.readCitiesFromCSV(inputFile);
                this.batchSize = Math.ceil(this.allCities.length / this.totalBatches);
                console.log(`📊 Batch size: ${this.batchSize} cities per batch (${100/this.totalBatches}% each)`);
            }

            // If we have state, validate it's compatible
            if (hasState && this.allCities.length !== 0) {
                const expectedBatchSize = Math.ceil(this.allCities.length / this.totalBatches);
                if (this.batchSize !== expectedBatchSize) {
                    console.log(`⚠️  Batch size changed, recalculating...`);
                    this.batchSize = expectedBatchSize;
                }
            }

            console.log(`\n📋 SCRAPING PLAN:`);
            console.log(`Total cities: ${this.allCities.length}`);
            console.log(`Total batches: ${this.totalBatches}`);
            console.log(`Cities per batch: ${this.batchSize}`);
            console.log(`Current batch: ${this.currentBatch + 1}/${this.totalBatches}`);
            console.log(`Already processed: ${this.processedCities.size} cities`);
            console.log(`Remaining: ${this.allCities.length - this.processedCities.size} cities`);

            // Check if already completed
            if (this.currentBatch >= this.totalBatches) {
                console.log('\n🎉 All batches already completed!');
                console.log('Run with reset option to start over, or check results files.');
                return;
            }

            // Ask for confirmation
            console.log(`\n▶️  Ready to start/continue batch ${this.currentBatch + 1}...`);
            
            // Run the current batch
            const shouldContinue = await this.runBatch();
            
            if (shouldContinue) {
                console.log(`\n⏸️  Batch ${this.currentBatch}/${this.totalBatches} completed!`);
                console.log(`📁 Progress saved to state files`);
                console.log(`📊 Results: electricity_prices_results_progress.csv`);
                console.log(`⚠️  Errors: electricity_prices_errors_progress.csv`);
                console.log(`\n▶️  To continue with next batch, run the script again.`);
            } else {
                console.log(`\n🎊 === ALL BATCHES COMPLETED! ===`);
                this.printFinalSummary();
                this.cleanupState();
            }
            
        } catch (error) {
            console.error('💥 Fatal error:', error);
            this.saveState(); // Save state even on error
        }
    }

    // Print final summary
    printFinalSummary() {
        const successRate = ((this.results.length / this.allCities.length) * 100).toFixed(1);
        
        // Calculate outlier statistics
        const outlierStats = this.results.reduce((stats, result) => {
            if (result.isOutlier) {
                stats.totalOutliers++;
                if (result.outlierSeverity === 'very_high') stats.veryHighOutliers++;
                else if (result.outlierSeverity === 'high') stats.highOutliers++;
                
                if (result.outlierFlags && result.outlierFlags.validationSuccessful) {
                    stats.validatedOutliers++;
                }
            }
            return stats;
        }, { totalOutliers: 0, highOutliers: 0, veryHighOutliers: 0, validatedOutliers: 0 });
        
        console.log(`\n📈 === FINAL SUMMARY ===`);
        console.log(`Total cities processed: ${this.allCities.length}`);
        console.log(`Successful extractions: ${this.results.length}`);
        console.log(`Errors encountered: ${this.errors.length}`);
        console.log(`Overall success rate: ${successRate}%`);
        
        console.log(`\n🚨 === OUTLIER ANALYSIS ===`);
        console.log(`Total outliers detected: ${outlierStats.totalOutliers}`);
        console.log(`High price outliers (≥€1.00): ${outlierStats.highOutliers}`);
        console.log(`Very high price outliers (≥€1.50): ${outlierStats.veryHighOutliers}`);
        console.log(`Outliers successfully validated: ${outlierStats.validatedOutliers}`);
        if (outlierStats.totalOutliers > 0) {
            const outlierRate = ((outlierStats.totalOutliers / this.results.length) * 100).toFixed(1);
            const validationRate = ((outlierStats.validatedOutliers / outlierStats.totalOutliers) * 100).toFixed(1);
            console.log(`Outlier rate: ${outlierRate}% of successful extractions`);
            console.log(`Validation success rate: ${validationRate}% of detected outliers`);
        }
        
        console.log(`\n📁 Final files created:`);
        console.log(`✅ electricity_prices_results_progress.csv (${this.results.length} results)`);
        console.log(`❌ electricity_prices_errors_progress.csv (${this.errors.length} errors)`);
        console.log(`💾 All data saved successfully!`);
        
        if (outlierStats.totalOutliers > 0) {
            console.log(`\n⚠️  Note: Review outliers marked as 'Needs Review' for potential data quality issues.`);
        }
    }

    // Clean up state files after completion
    cleanupState() {
        try {
            if (fs.existsSync(this.stateFile)) {
                // Move to completed state instead of deleting
                const completedStateFile = this.stateFile.replace('.json', '_completed.json');
                fs.renameSync(this.stateFile, completedStateFile);
                console.log(`🗃️  State moved to: ${completedStateFile}`);
            }
        } catch (error) {
            console.error('⚠️  Error cleaning up state:', error.message);
        }
    }

    // Reset all progress (for starting over)
    reset() {
        try {
            // Remove state files
            [this.stateFile, 
             'electricity_prices_results_progress.csv', 
             'electricity_prices_errors_progress.csv'].forEach(file => {
                if (fs.existsSync(file)) {
                    fs.unlinkSync(file);
                    console.log(`🗑️  Deleted: ${file}`);
                }
            });
            
            // Reset internal state
            this.currentBatch = 0;
            this.processedCities.clear();
            this.results = [];
            this.errors = [];
            
            console.log('♻️  All progress reset. Ready to start fresh!');
        } catch (error) {
            console.error('❌ Error resetting:', error.message);
        }
    }
}

module.exports = BatchedStromauskunftScraper;

// If run directly (not imported)
if (require.main === module) {
    const scraper = new BatchedStromauskunftScraper();
    
    // Configuration
    const inputFile = 'Postleitzahlen Deutschland.csv';
    
    // Check for command line arguments
    const args = process.argv.slice(2);
    
    if (args.includes('--reset')) {
        console.log('🔄 Resetting all progress...');
        scraper.reset();
    } else if (args.includes('--status')) {
        console.log('📊 Checking status...');
        if (scraper.loadState()) {
            console.log(`Current batch: ${scraper.currentBatch + 1}/5`);
            console.log(`Processed cities: ${scraper.processedCities.size}`);
            console.log(`Results: ${scraper.results.length}`);
            console.log(`Errors: ${scraper.errors.length}`);
        } else {
            console.log('No previous state found. Ready to start fresh!');
        }
    } else {
        // Default: run the scraper
        scraper.scrapeElectricityPrices(inputFile);
    }
} 