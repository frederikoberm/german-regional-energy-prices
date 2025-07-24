#!/usr/bin/env node

/**
 * Smart Single-File Electricity Price Scraper
 * Combines intelligent extraction with simple architecture
 * 
 * Features:
 * - City classification (small/medium/large)
 * - Multiple extraction strategies per city class
 * - Analysis metadata collection
 * - Database integration with Supabase
 * - Resume functionality with duplicate detection
 */

require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const axios = require('axios');
const cheerio = require('cheerio');
const SupabaseClient = require('../database/supabase-client');

class SmartElectricityScraper {
    constructor() {
        this.db = new SupabaseClient();
        this.baseUrl = 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-';
        this.delay = parseInt(process.env.SCRAPER_DELAY) || 2000;
        this.targetCityCount = 1000;
        this.sessionId = null;
        
        // HTTP Configuration
        this.httpConfig = {
            timeout: 20000,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache'
            }
        };

        // City Classification Thresholds
        this.cityClassification = {
            small: { 
                maxTables: 1, 
                maxRows: 3, 
                strategies: ['regexSimple', 'tableSimple'],
                expected404Rate: 0.83 
            },
            medium: { 
                maxTables: 2, 
                maxRows: 8, 
                strategies: ['tableStandard', 'regexStandard', 'tableFirst'],
                expected404Rate: 0.10 
            },
            large: { 
                maxTables: 4, 
                maxRows: 20, 
                strategies: ['tableComplex', 'regexAdvanced', 'tableStandard'],
                expected404Rate: 0.05 
            }
        };

        // Outlier Detection
        this.outlierThresholds = {
            HIGH_PRICE: 1.0,
            VERY_HIGH_PRICE: 1.5,
            EXTREME_PRICE: 2.0
        };

        // Statistics
        this.stats = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            cityClassStats: {
                small: { attempted: 0, success: 0, fourohfour: 0 },
                medium: { attempted: 0, success: 0, fourohfour: 0 },
                large: { attempted: 0, success: 0, fourohfour: 0 }
            },
            extractionMethods: {}
        };
    }

    // =====================================================
    // MAIN SCRAPING WORKFLOW
    // =====================================================

    async run() {
        try {
            console.log('🚀 Starting Smart Single-File Scraper');
            console.log('=====================================\n');

            // Test database connection
            const connectionOk = await this.db.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection failed');
            }

            // Load and filter cities
            const citiesToProcess = await this.getUnprocessedCities();
            if (citiesToProcess.length === 0) {
                console.log('🎉 All cities have been processed!');
                return;
            }

            // Initialize session
            await this.initializeSession(citiesToProcess.length);

            // Show plan
            this.showScrapingPlan(citiesToProcess.length);

            // Process cities
            await this.processCities(citiesToProcess);

            // Complete session
            await this.completeSession();

            console.log('\n🎉 Smart scraper completed successfully!');
            this.printFinalStats();

        } catch (error) {
            console.error('💥 Fatal error:', error.message);
            if (this.sessionId) {
                await this.failSession(error);
            }
            throw error;
        }
    }

    async getUnprocessedCities() {
        const csvFile = 'utils/Postleitzahlen Deutschland.csv';
        const allCities = await this.loadAllCities(csvFile);
        const existingPLZs = await this.getExistingPLZs();
        
        const unprocessedCities = allCities.filter(city => !existingPLZs.has(city.plz));
        console.log(`🎯 Found ${unprocessedCities.length} unprocessed cities`);
        
        const citiesToProcess = unprocessedCities.slice(0, this.targetCityCount);
        console.log(`📋 Selected ${citiesToProcess.length} cities for processing`);
        
        return citiesToProcess;
    }

    async loadAllCities(csvFile) {
        return new Promise((resolve, reject) => {
            const cities = [];
            
            if (!fs.existsSync(csvFile)) {
                reject(new Error(`PLZ CSV file not found: ${csvFile}`));
                return;
            }

            console.log(`📖 Loading cities from ${csvFile}...`);

            fs.createReadStream(csvFile)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    const cityName = row['PLZ Name (short)'] || row.Name || row.Ort;
                    const plz = row['Postleitzahl / Post code'] || row.PLZ || row.plz;
                    const geoPoint = row['geo_point_2d'];

                    if (cityName && plz) {
                        const city = {
                            originalName: cityName,
                            cityName: cityName,
                            normalizedName: this.extractCityName(cityName),
                            plz: plz.toString()
                        };

                        if (geoPoint) {
                            const coords = geoPoint.split(',');
                            if (coords.length === 2) {
                                city.latitude = parseFloat(coords[0].trim());
                                city.longitude = parseFloat(coords[1].trim());
                            }
                        }

                        cities.push(city);
                    }
                })
                .on('end', () => {
                    console.log(`✅ Loaded ${cities.length} total cities from CSV`);
                    resolve(cities);
                })
                .on('error', reject);
        });
    }

    async getExistingPLZs() {
        try {
            const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
            console.log(`🔍 Checking existing PLZs in database for ${currentMonth}...`);
            
            const existingPLZs = await this.db.getExistingPLZsForMonth(currentMonth);
            console.log(`📊 Found ${existingPLZs.size} cities already processed this month`);
            
            return existingPLZs;
        } catch (error) {
            console.warn('⚠️  Could not check existing PLZs:', error.message);
            return new Set();
        }
    }

    // =====================================================
    // CITY CLASSIFICATION AND EXTRACTION
    // =====================================================

    classifyCityByName(cityName) {
        // Simple heuristic-based classification
        const name = cityName.toLowerCase();
        
        // Large cities (common major cities)
        if (name.includes('berlin') || name.includes('hamburg') || name.includes('münchen') || 
            name.includes('köln') || name.includes('frankfurt') || name.includes('stuttgart') ||
            name.includes('düsseldorf') || name.includes('dortmund') || name.includes('essen') ||
            name.includes('leipzig') || name.includes('bremen') || name.includes('dresden') ||
            name.includes('hannover') || name.includes('nürnberg')) {
            return 'large';
        }
        
        // Small cities (certain indicators)
        if (name.includes('dorf') || name.includes('hausen') || name.includes('heim') ||
            name.includes('bach') || name.includes('feld') || name.includes('burg') ||
            cityName.split(',').length > 2) { // Multiple comma-separated parts often indicate small places
            return 'small';
        }
        
        // Default to medium
        return 'medium';
    }

    classifyCityByDOMStructure($) {
        const tableCount = $('table').length;
        const totalRows = $('table tr').length;
        
        if (tableCount <= 1 && totalRows <= 3) {
            return { type: 'small', tables: tableCount, rows: totalRows };
        } else if (tableCount <= 2 && totalRows <= 8) {
            return { type: 'medium', tables: tableCount, rows: totalRows };
        } else {
            return { type: 'large', tables: tableCount, rows: totalRows };
        }
    }

    async scrapeCityWithClassification(city) {
        const startTime = Date.now();
        this.stats.totalProcessed++;

        try {
            const expectedClass = this.classifyCityByName(city.cityName);
            const url = this.buildUrl(city.normalizedName);
            
            this.stats.cityClassStats[expectedClass].attempted++;
            
            console.log(`[${this.stats.totalProcessed}] Processing: ${city.cityName} -> ${city.normalizedName}`);
            console.log(`🌐 Scraping: ${city.cityName} (PLZ: ${city.plz})`);
            console.log(`🌐 Requesting: ${url} (expected: ${expectedClass} city)`);

            // Make HTTP request
            const response = await this.makeRequest(url);
            
            if (!response) {
                // Handle 404 gracefully
                console.log(`    ⚠️  No response received - likely 404 for ${expectedClass} city`);
                this.stats.cityClassStats[expectedClass].fourohfour++;
                await this.logError(city, 'not_found', '404 or no response received', url);
                return null;
            }

            // Extract prices with smart strategies
            const $ = cheerio.load(response.data);
            const actualClass = this.classifyCityByDOMStructure($);
            const extractionResult = await this.extractPricesWithStrategies($, response.data, expectedClass, actualClass);

            if (!extractionResult.success) {
                console.log(`    ❌ Extraction failed: ${extractionResult.error}`);
                await this.logError(city, 'extraction_failed', extractionResult.error, url);
                return null;
            }

            // Validate and detect outliers
            const outlierAnalysis = this.detectOutliers(
                extractionResult.lokaler_versorger_price, 
                extractionResult.oekostrom_price
            );

            // Calculate average
            const avgPrice = this.calculateAverage(
                extractionResult.lokaler_versorger_price, 
                extractionResult.oekostrom_price
            );

            // Create result with analysis metadata
            const result = {
                data_month: this.getCurrentMonth(),
                plz: city.plz,
                city_name: city.cityName,
                latitude: city.latitude || null,
                longitude: city.longitude || null,
                lokaler_versorger_price: extractionResult.lokaler_versorger_price,
                oekostrom_price: extractionResult.oekostrom_price,
                average_price: avgPrice,
                data_source: 'ORIGINAL',
                source_url: url,
                source_plz: city.plz,
                distance_km: 0,
                is_outlier: outlierAnalysis.hasOutliers,
                outlier_severity: outlierAnalysis.severity,
                
                // Analysis metadata
                expected_city_class: expectedClass,
                actual_city_class: actualClass.type,
                dom_structure: `${actualClass.tables}t/${actualClass.rows}r`,
                extraction_method: extractionResult.method,
                extraction_details: extractionResult.details,
                scraping_duration: Date.now() - startTime,
                classification_match: expectedClass === actualClass.type
            };

            console.log(`    ✅ Success: Lokaler=${extractionResult.lokaler_versorger_price?.toFixed(3)}, Öko=${extractionResult.oekostrom_price?.toFixed(3)} (${extractionResult.method})`);
            
            if (outlierAnalysis.hasOutliers) {
                console.log(`    🚨 ${outlierAnalysis.severity.toUpperCase()} outlier detected: ${outlierAnalysis.warnings.join(', ')}`);
            }

            // Update stats
            this.stats.successful++;
            this.stats.cityClassStats[expectedClass].success++;
            this.stats.extractionMethods[extractionResult.method] = (this.stats.extractionMethods[extractionResult.method] || 0) + 1;

            return result;

        } catch (error) {
            console.log(`❌ Error scraping ${city.normalizedName} (${city.plz}): ${error.code || 'unknown'} - ${error.message}`);
            await this.logError(city, error.code || 'unknown', error.message, this.buildUrl(city.normalizedName));
            this.stats.failed++;
            return null;
        }
    }

    // =====================================================
    // EXTRACTION STRATEGIES
    // =====================================================

    async extractPricesWithStrategies($, pageText, expectedClass, actualClass) {
        const strategies = this.cityClassification[expectedClass].strategies;
        
        let result = {
            lokaler_versorger_price: null,
            oekostrom_price: null,
            success: false,
            method: null,
            details: [],
            error: null
        };

        for (const strategy of strategies) {
            console.log(`    🔍 Trying strategy: ${strategy}`);
            const strategyResult = this.applyExtractionStrategy(strategy, $, pageText);
            
            result.details.push({
                strategy,
                found_lokaler: !!strategyResult.lokaler_versorger_price,
                found_oeko: !!strategyResult.oekostrom_price,
                details: strategyResult.details
            });

            // Update result with found prices
            if (strategyResult.lokaler_versorger_price && !result.lokaler_versorger_price) {
                result.lokaler_versorger_price = strategyResult.lokaler_versorger_price;
                result.method = strategy;
            }
            
            if (strategyResult.oekostrom_price && !result.oekostrom_price) {
                result.oekostrom_price = strategyResult.oekostrom_price;
                if (!result.method) result.method = strategy;
            }

            // Break if we found both prices
            if (result.lokaler_versorger_price && result.oekostrom_price) {
                console.log(`    ✅ Both prices found using ${strategy}`);
                break;
            }
        }

        // Validate we found at least one price
        if (!result.lokaler_versorger_price && !result.oekostrom_price) {
            result.error = 'No valid prices found with any strategy';
            return result;
        }

        result.success = true;
        return result;
    }

    applyExtractionStrategy(strategy, $, pageText) {
        switch (strategy) {
            case 'tableStandard':
                return this.extractFromTableStandard($);
            case 'tableSimple':
                return this.extractFromTableSimple($);
            case 'tableComplex':
                return this.extractFromTableComplex($);
            case 'tableFirst':
                return this.extractFromTableFirst($);
            case 'regexStandard':
                return this.extractWithRegexStandard(pageText);
            case 'regexSimple':
                return this.extractWithRegexSimple(pageText);
            case 'regexAdvanced':
                return this.extractWithRegexAdvanced(pageText);
            default:
                return { lokaler_versorger_price: null, oekostrom_price: null, details: `Unknown strategy: ${strategy}` };
        }
    }

    // Strategy: Standard table extraction (most common)
    extractFromTableStandard($) {
        let lokalerPrice = null;
        let oekoPrice = null;
        const details = [];

        $('table tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 2) {
                const firstCell = $(cells[0]).text().trim();
                const secondCell = $(cells[1]).text().trim();
                const rowText = $(row).text().trim();
                
                // Skip provider comparison rows
                if (this.isProviderComparisonRow(rowText, firstCell)) {
                    return;
                }

                const hasKeyword = this.hasLocalProviderKeyword(firstCell) || this.hasGreenEnergyKeyword(firstCell);
                const hasProKwh = secondCell.includes('pro kWh');

                if (hasKeyword && hasProKwh) {
                    details.push(`Found price row: "${firstCell}" -> "${secondCell}"`);
                    
                    if (this.hasLocalProviderKeyword(firstCell)) {
                        const price = this.parsePrice(secondCell);
                        if (price && this.isValidPrice(price) && (!lokalerPrice || price < 1.0)) {
                            lokalerPrice = price;
                            details.push(`Lokaler Versorger: €${price}`);
                        }
                    }
                    
                    if (this.hasGreenEnergyKeyword(firstCell)) {
                        const price = this.parsePrice(secondCell);
                        if (price && this.isValidPrice(price) && (!oekoPrice || price < 1.0)) {
                            oekoPrice = price;
                            details.push(`Ökostrom: €${price}`);
                        }
                    }
                }
            }
        });

        return {
            lokaler_versorger_price: lokalerPrice,
            oekostrom_price: oekoPrice,
            details: details.join('; ')
        };
    }

    // Strategy: Simple table extraction (for small cities)
    extractFromTableSimple($) {
        let lokalerPrice = null;
        let oekoPrice = null;

        // For small cities, often just look for any price pattern
        $('table tr').each((i, row) => {
            const rowText = $(row).text().trim();
            
            if (rowText.includes('pro kWh') && !this.isProviderComparisonRow(rowText)) {
                const price = this.parsePrice(rowText);
                if (price && this.isValidPrice(price)) {
                    if (!lokalerPrice) {
                        lokalerPrice = price;
                    } else if (!oekoPrice && price !== lokalerPrice) {
                        oekoPrice = price;
                    }
                }
            }
        });

        return {
            lokaler_versorger_price: lokalerPrice,
            oekostrom_price: oekoPrice,
            details: 'Simple table extraction'
        };
    }

    // Strategy: Complex table extraction (for large cities)
    extractFromTableComplex($) {
        // Use the standard method but with more flexible matching
        const standardResult = this.extractFromTableStandard($);
        
        // If standard didn't work, try more flexible patterns
        if (!standardResult.lokaler_versorger_price && !standardResult.oekostrom_price) {
            let lokalerPrice = null;
            let oekoPrice = null;

            $('table').each((tableIndex, table) => {
                $(table).find('tr').each((rowIndex, row) => {
                    const rowText = $(row).text().trim().toLowerCase();
                    
                    if (rowText.includes('grundversorg') || rowText.includes('lokaler')) {
                        const price = this.parsePrice($(row).text());
                        if (price && this.isValidPrice(price) && !lokalerPrice) {
                            lokalerPrice = price;
                        }
                    }
                    
                    if (rowText.includes('ökostrom') || rowText.includes('alternativ')) {
                        const price = this.parsePrice($(row).text());
                        if (price && this.isValidPrice(price) && !oekoPrice) {
                            oekoPrice = price;
                        }
                    }
                });
            });

            return {
                lokaler_versorger_price: lokalerPrice,
                oekostrom_price: oekoPrice,
                details: 'Complex table extraction with flexible matching'
            };
        }

        return standardResult;
    }

    // Strategy: First table extraction
    extractFromTableFirst($) {
        const firstTable = $('table').first();
        let lokalerPrice = null;
        let oekoPrice = null;

        firstTable.find('tr').each((i, row) => {
            const rowText = $(row).text().trim();
            
            if (rowText.includes('pro kWh')) {
                const price = this.parsePrice(rowText);
                if (price && this.isValidPrice(price)) {
                    if (this.hasLocalProviderKeyword(rowText) && !lokalerPrice) {
                        lokalerPrice = price;
                    } else if (this.hasGreenEnergyKeyword(rowText) && !oekoPrice) {
                        oekoPrice = price;
                    }
                }
            }
        });

        return {
            lokaler_versorger_price: lokalerPrice,
            oekostrom_price: oekoPrice,
            details: 'First table only extraction'
        };
    }

    // Strategy: Standard regex extraction
    extractWithRegexStandard(pageText) {
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

        let lokalerPrice = null;
        let oekoPrice = null;
        const details = [];

        for (let patternObj of patterns) {
            const match = pageText.match(patternObj.regex);
            if (match) {
                let price = parseFloat(match[1].replace(',', '.'));
                const unit = match[2] || '';
                
                if (unit.toLowerCase().includes('cent') || unit.toLowerCase().includes('ct')) {
                    price = price / 100;
                }

                if (this.isValidPrice(price)) {
                    if (patternObj.type === 'lokal' && !lokalerPrice) {
                        lokalerPrice = price;
                        details.push(`Regex found Lokaler: €${price}`);
                    } else if (patternObj.type === 'oeko' && !oekoPrice) {
                        oekoPrice = price;
                        details.push(`Regex found Öko: €${price}`);
                    }
                }
            }
        }

        return {
            lokaler_versorger_price: lokalerPrice,
            oekostrom_price: oekoPrice,
            details: details.join('; ')
        };
    }

    // Strategy: Simple regex extraction
    extractWithRegexSimple(pageText) {
        // Simplified patterns for small cities
        const pricePattern = /(\d+[,.]?\d*)\s*(Euro|EUR|€|Cent|ct)?\s*pro\s*kWh/gi;
        const matches = [...pageText.matchAll(pricePattern)];
        
        let prices = [];
        for (let match of matches) {
            let price = parseFloat(match[1].replace(',', '.'));
            const unit = match[2] || '';
            
            if (unit.toLowerCase().includes('cent') || unit.toLowerCase().includes('ct')) {
                price = price / 100;
            }
            
            if (this.isValidPrice(price)) {
                prices.push(price);
            }
        }

        // Take first two valid prices
        return {
            lokaler_versorger_price: prices[0] || null,
            oekostrom_price: prices[1] || null,
            details: `Simple regex found ${prices.length} prices`
        };
    }

    // Strategy: Advanced regex extraction
    extractWithRegexAdvanced(pageText) {
        // Combine standard regex with additional patterns
        const standardResult = this.extractWithRegexStandard(pageText);
        
        if (!standardResult.lokaler_versorger_price && !standardResult.oekostrom_price) {
            // Try more flexible patterns
            const flexiblePatterns = [
                /(\d+[,.]?\d*)\s*(€|Euro|EUR)\s*\/\s*kWh/gi,
                /kWh\s*[:\-]\s*(\d+[,.]?\d*)\s*(€|Euro|EUR|Cent|ct)/gi,
                /Preis.*?(\d+[,.]?\d*)\s*(€|Euro|EUR|Cent|ct)/gi
            ];

            let prices = [];
            for (let pattern of flexiblePatterns) {
                const matches = [...pageText.matchAll(pattern)];
                for (let match of matches) {
                    let price = parseFloat(match[1].replace(',', '.'));
                    if (match[2] && match[2].toLowerCase().includes('cent')) {
                        price = price / 100;
                    }
                    if (this.isValidPrice(price)) {
                        prices.push(price);
                    }
                }
            }

            return {
                lokaler_versorger_price: prices[0] || null,
                oekostrom_price: prices[1] || null,
                details: `Advanced regex found ${prices.length} prices`
            };
        }

        return standardResult;
    }

    // =====================================================
    // HELPER METHODS
    // =====================================================

    isProviderComparisonRow(rowText, firstCell = '') {
        return rowText.length > 100 || 
               firstCell.includes('LichtBlick') || 
               firstCell.includes('E.ON') || 
               firstCell.includes('Vattenfall') ||
               firstCell.includes('EnBW') ||
               firstCell.includes('RWE') ||
               rowText.includes('Tarif') ||
               rowText.includes('Anbieter');
    }

    hasLocalProviderKeyword(text) {
        const lowerText = text.toLowerCase();
        return lowerText.includes('lokaler versorger') || 
               lowerText.includes('grundversorgung') ||
               lowerText.includes('lokaler anbieter');
    }

    hasGreenEnergyKeyword(text) {
        const lowerText = text.toLowerCase();
        return lowerText.includes('günstigster ökostromtarif') || 
               lowerText.includes('günstigster ökostrom') ||
               lowerText.includes('ökostrom');
    }

    parsePrice(text) {
        // Extract numbers that could be prices
        const matches = text.match(/(\d+[,.]?\d*)/g);
        if (!matches) return null;

        for (let match of matches) {
            let price = parseFloat(match.replace(',', '.'));
            
            // Convert cents to euros if the number is too high
            if (price > 10 && price < 100) {
                price = price / 100;
            }
            
            if (this.isValidPrice(price)) {
                return price;
            }
        }
        
        return null;
    }

    isValidPrice(price) {
        return price && price >= 0.05 && price <= 2.0;
    }

    detectOutliers(lokalerPrice, oekoPrice) {
        const outliers = {
            hasOutliers: false,
            severity: 'normal',
            warnings: []
        };

        if (lokalerPrice && lokalerPrice >= this.outlierThresholds.VERY_HIGH_PRICE) {
            outliers.hasOutliers = true;
            outliers.severity = 'very_high';
            outliers.warnings.push(`Lokaler Versorger €${lokalerPrice.toFixed(3)} very high`);
        } else if (lokalerPrice && lokalerPrice >= this.outlierThresholds.HIGH_PRICE) {
            outliers.hasOutliers = true;
            outliers.severity = 'high';
            outliers.warnings.push(`Lokaler Versorger €${lokalerPrice.toFixed(3)} high`);
        }

        if (oekoPrice && oekoPrice >= this.outlierThresholds.VERY_HIGH_PRICE) {
            outliers.hasOutliers = true;
            outliers.severity = 'very_high';
            outliers.warnings.push(`Ökostrom €${oekoPrice.toFixed(3)} very high`);
        } else if (oekoPrice && oekoPrice >= this.outlierThresholds.HIGH_PRICE) {
            outliers.hasOutliers = true;
            outliers.severity = outliers.severity === 'very_high' ? 'very_high' : 'high';
            outliers.warnings.push(`Ökostrom €${oekoPrice.toFixed(3)} high`);
        }

        return outliers;
    }

    calculateAverage(lokalerPrice, oekoPrice) {
        const prices = [lokalerPrice, oekoPrice].filter(p => p !== null);
        if (prices.length === 0) return null;
        return prices.reduce((sum, price) => sum + price, 0) / prices.length;
    }

    buildUrl(normalizedCityName) {
        return `${this.baseUrl}${normalizedCityName}.html`;
    }

    extractCityName(fullName) {
        return fullName.split(',')[0].trim()
            .replace(/ä/g, 'ae').replace(/Ä/g, 'ae')
            .replace(/ö/g, 'oe').replace(/Ö/g, 'oe')
            .replace(/ü/g, 'ue').replace(/Ü/g, 'ue')
            .replace(/ß/g, 'ss')
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9\-]/g, '')
            .toLowerCase();
    }

    getCurrentMonth() {
        return new Date().toISOString().slice(0, 7) + '-01';
    }

    async makeRequest(url) {
        try {
            const response = await axios.get(url, {
                timeout: this.httpConfig.timeout,
                headers: {
                    'User-Agent': this.httpConfig.userAgent,
                    ...this.httpConfig.headers
                },
                maxRedirects: 5,
                validateStatus: (status) => {
                    return status >= 200 && status < 400 || status === 404;
                }
            });

            if (!response || response.status === 404 || !response.data) {
                return null;
            }

            if (response.data.length < 500) {
                throw new Error('Response too short - likely blocked');
            }

            return response;

        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }
            throw error;
        }
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =====================================================
    // SESSION AND DATABASE METHODS
    // =====================================================

    async initializeSession(totalCities) {
        try {
            const config = {
                scraper_type: 'smart-single-file',
                scraper_version: '1.0',
                delay_ms: this.delay,
                target_city_count: totalCities,
                city_classification_enabled: true,
                multiple_strategies_enabled: true,
                analysis_metadata_enabled: true
            };

            const session = await this.db.startScrapingSession(this.getCurrentMonth(), totalCities, config);
            this.sessionId = session.id;
            console.log(`📝 Started scraping session: ${this.sessionId}`);
        } catch (error) {
            console.error('❌ Failed to initialize session:', error.message);
            throw error;
        }
    }

    async completeSession() {
        if (!this.sessionId) return;

        try {
            const completionData = {
                processed_cities: this.stats.totalProcessed,
                successful_cities: this.stats.successful,
                failed_cities: this.stats.failed,
                notes: `Completed: ${this.stats.successful}/${this.stats.totalProcessed} cities successful. ` +
                       `City class stats: ${JSON.stringify(this.stats.cityClassStats)}. ` +
                       `Extraction methods: ${JSON.stringify(this.stats.extractionMethods)}`
            };

            await this.db.completeScrapingSession(this.sessionId, completionData);
            console.log(`✅ Completed scraping session: ${this.sessionId}`);
        } catch (error) {
            console.error('❌ Failed to complete session:', error.message);
        }
    }

    async failSession(error) {
        if (!this.sessionId) return;

        try {
            const failureData = {
                status: 'failed',
                error_summary: error.message,
                processed_cities: this.stats.totalProcessed,
                successful_cities: this.stats.successful,
                failed_cities: this.stats.failed,
                notes: `Session failed: ${error.message}. Processed ${this.stats.totalProcessed} cities.`
            };

            await this.db.updateScrapingSession(this.sessionId, failureData);
            console.log(`❌ Marked session as failed: ${this.sessionId}`);
        } catch (sessionError) {
            console.error('❌ Failed to mark session as failed:', sessionError.message);
        }
    }

    async processCities(cities) {
        console.log('\n🚀 Starting city processing...\n');

        for (let i = 0; i < cities.length; i++) {
            const city = cities[i];
            
            // Process the city
            const result = await this.scrapeCityWithClassification(city);
            
            // Store result if successful
            if (result) {
                try {
                    await this.db.insertPriceData(result);
                } catch (dbError) {
                    console.error(`❌ Database error for ${city.cityName}:`, dbError.message);
                }
            }

            // Progress report every 50 cities
            if ((i + 1) % 50 === 0) {
                console.log(`\n📊 Progress: ${i + 1}/${cities.length} cities processed`);
                console.log(`   Success: ${this.stats.successful}, Failed: ${this.stats.failed}`);
                console.log(`   Success rate: ${(this.stats.successful / this.stats.totalProcessed * 100).toFixed(1)}%\n`);
            }

            // Respectful delay
            if (i < cities.length - 1) {
                console.log(`    ⏳ Waiting ${this.delay/1000}s...`);
                await this.sleep(this.delay);
            }
        }
    }

    async logError(city, errorType, errorMessage, url) {
        const logDir = 'logs';
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        const logFile = `${logDir}/scraper-errors-${new Date().toISOString().slice(0, 10)}.jsonl`;
        const logEntry = JSON.stringify({
            timestamp: new Date().toISOString(),
            sessionId: this.sessionId,
            plz: city.plz,
            city_name: city.cityName,
            normalized_name: city.normalizedName,
            error_type: errorType,
            error_message: errorMessage,
            source_url: url,
            scraper_version: 'smart-single-file',
        }) + '\n';

        fs.appendFileSync(logFile, logEntry);
    }

    showScrapingPlan(cityCount) {
        console.log('\n📋 SMART SCRAPER PLAN:');
        console.log(`   • Cities to process: ${cityCount}`);
        console.log(`   • Delay: ${this.delay}ms (respectful)`);
        console.log(`   • City classification: ENABLED`);
        console.log(`   • Multiple extraction strategies: ENABLED`);
        console.log(`   • Analysis metadata: ENABLED`);
        console.log(`   • Database storage: Supabase PostgreSQL`);
        console.log(`   • Session tracking: ${this.sessionId}`);
        console.log(`   • Resume capability: ENABLED`);
        console.log(`   • Estimated time: ${Math.ceil(cityCount * this.delay / 1000 / 60)} minutes`);
    }

    printFinalStats() {
        console.log('\n📊 === SMART SCRAPER RESULTS ===');
        console.log(`   Total processed: ${this.stats.totalProcessed}`);
        console.log(`   Successful: ${this.stats.successful}`);
        console.log(`   Failed: ${this.stats.failed}`);
        console.log(`   Success rate: ${(this.stats.successful / this.stats.totalProcessed * 100).toFixed(1)}%`);
        
        console.log('\n🏙️  City Class Performance:');
        Object.entries(this.stats.cityClassStats).forEach(([classType, stats]) => {
            const successRate = stats.attempted > 0 ? (stats.success / stats.attempted * 100).toFixed(1) : '0';
            const fourohfourRate = stats.attempted > 0 ? (stats.fourohfour / stats.attempted * 100).toFixed(1) : '0';
            console.log(`   ${classType}: ${stats.success}/${stats.attempted} (${successRate}% success, ${fourohfourRate}% 404s)`);
        });
        
        console.log('\n🔧 Extraction Methods Used:');
        Object.entries(this.stats.extractionMethods).forEach(([method, count]) => {
            console.log(`   ${method}: ${count} times`);
        });
        
        console.log(`\n📁 Database: monthly_electricity_prices table`);
        console.log(`📝 Session: ${this.sessionId}`);
        console.log(`📂 Error logs: ./logs/ folder`);
    }
}

// Main execution
async function main() {
    const scraper = new SmartElectricityScraper();
    
    try {
        await scraper.run();
        console.log('\n✅ Smart scraper completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Smart scraper failed:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = SmartElectricityScraper; 