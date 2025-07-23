#!/usr/bin/env node

/**
 * Simple 1000 Cities Scraper
 * Simplified version with reliable file-based error logging
 */

require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const ScraperFactory = require('./scrapers/modules/factory/scraper-factory');
const SupabaseClient = require('./database/supabase-client');

class Simple1000Runner {
    constructor() {
        this.factory = new ScraperFactory();
        this.db = new SupabaseClient();
        this.scraper = null;
        this.scraperId = null;
        this.config = null;
        this.targetCityCount = 1000;
    }

    /**
     * Get unprocessed cities
     */
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

            console.log(`📖 Loading all cities from ${csvFile}...`);

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
            
            // Get successful attempts from database
            const { data, error } = await this.db.supabase
                .from('monthly_electricity_prices')
                .select('plz')
                .eq('data_month', currentMonth);

            if (error) throw error;

            const successfulPLZs = new Set(data.map(row => row.plz));
            console.log(`📊 Found ${successfulPLZs.size} cities with successful data this month`);
            
            // Also get failed attempts from error logs to avoid retrying
            const failedPLZs = await this.getFailedPLZsFromLogs();
            
            // Combine both successful and failed (all attempted cities)
            const allAttemptedPLZs = new Set([...successfulPLZs, ...failedPLZs]);
            console.log(`📊 Total attempted cities: ${allAttemptedPLZs.size} (${successfulPLZs.size} successful, ${failedPLZs.size} failed)`);
            
            return allAttemptedPLZs;
        } catch (error) {
            console.warn('⚠️  Could not check existing PLZs:', error.message);
            return new Set();
        }
    }

    async getFailedPLZsFromLogs() {
        try {
            const logFile = `logs/scraper-errors-${new Date().toISOString().slice(0, 10)}.jsonl`;
            
            if (!require('fs').existsSync(logFile)) {
                console.log(`📝 No error log file found: ${logFile}`);
                return new Set();
            }

            const logContent = require('fs').readFileSync(logFile, 'utf8');
            const logLines = logContent.trim().split('\n').filter(line => line.trim());
            
            const failedPLZs = new Set();
            for (const line of logLines) {
                try {
                    const logEntry = JSON.parse(line);
                    if (logEntry.plz) {
                        failedPLZs.add(logEntry.plz);
                    }
                } catch (parseError) {
                    // Skip invalid JSON lines
                }
            }
            
            console.log(`📝 Found ${failedPLZs.size} failed cities in error logs`);
            return failedPLZs;
        } catch (error) {
            console.warn('⚠️  Could not read error logs:', error.message);
            return new Set();
        }
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

    async initializeScraper() {
        try {
            console.log('🏗️  Initializing SIMPLE scraper (file-based error logging)...');

            const scraperOptions = {
                source: 'stromauskunft',
                storage: 'supabase',
                enableGeographicCompletion: false, // Disable to avoid complexity
                config: {
                    delays: {
                        betweenRequests: parseInt(process.env.SCRAPER_DELAY) || 2000,
                        batchPause: 5000,
                        maxRetries: 2
                    },
                    batching: {
                        enabled: true,
                        totalBatches: 5,
                        autoProgress: false,
                        stateSaveInterval: 25 // Save more frequently
                    },
                    database: {
                        enableSessionTracking: true,
                        autoMonthDetection: true,
                        duplicateHandling: 'skip',
                        batchingOptimizations: {
                            enableBatchStorage: true,
                            batchStorageSize: 50,
                            enableBatchErrorLogging: false, // DISABLE to avoid recursion
                            enableBulkDuplicateCheck: true
                        }
                    },
                    quality: {
                        enableOutlierDetection: true,
                        enablePriceValidation: true,
                        enableGeographicFallback: false
                    },
                    logging: {
                        level: 'info',
                        enableDetailedScraping: false, // Reduce logging
                        enableProgressReports: true
                    }
                }
            };

            const result = await this.factory.createImprovedScraper(scraperOptions);
            this.scraper = result.scraper;
            this.scraperId = result.scraperId;
            this.config = result.config;

            console.log('✅ Simple scraper initialized with file-based error logging');

        } catch (error) {
            throw new Error(`Failed to initialize scraper: ${error.message}`);
        }
    }

    async run() {
        try {
            console.log('🚀 Starting SIMPLE 1000 Cities Scraper');
            console.log('===================================\n');

            const connectionOk = await this.db.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection failed');
            }

            const cities = await this.getUnprocessedCities();

            if (cities.length === 0) {
                console.log('🎉 All cities have been processed!');
                return;
            }

            await this.initializeScraper();

            const delay = parseInt(process.env.SCRAPER_DELAY) || 2000;
            const estimatedTime = Math.ceil(cities.length * delay / 1000 / 60);
            
            console.log('\n📋 SIMPLE SCRAPING PLAN:');
            console.log(`   • Cities to process: ${cities.length}`);
            console.log(`   • Batches: 5`);
            console.log(`   • Delay: ${delay}ms`);
            console.log(`   • Estimated time: ${estimatedTime} minutes`);
            console.log(`   • Error logging: FILE-BASED (logs/ folder)`);
            console.log(`   • Batch error logging: DISABLED (no recursion)`);

            console.log('\n🚀 Starting scraping...\n');

            const result = await this.scraper.scrapeElectricityPrices(cities, {
                skipExistingData: false,
                targetMonth: null
            });

            console.log('\n🎉 Simple scraping completed!');
            this.printSummary(cities.length);

            return result;

        } catch (error) {
            console.error('💥 Error:', error.message);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    printSummary(processed) {
        console.log('\n📊 === SIMPLE SCRAPER SUMMARY ===');
        console.log(`   Cities processed: ${processed}`);
        console.log(`   Error logs: ./logs/ folder`);
        console.log(`   Database: Supabase (results only)`);
        console.log('\n✅ Run again for next batch!');
    }

    async cleanup() {
        try {
            if (this.scraper && typeof this.scraper.cleanup === 'function') {
                await this.scraper.cleanup();
            }
        } catch (error) {
            console.warn('⚠️  Cleanup warning:', error.message);
        }
    }
}

async function main() {
    const runner = new Simple1000Runner();
    
    try {
        await runner.run();
        console.log('\n✅ Script completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Script failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = Simple1000Runner; 