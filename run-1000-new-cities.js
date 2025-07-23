#!/usr/bin/env node

/**
 * Run Scraper for 1000 NEW Cities
 * Finds cities that haven't been processed yet and scrapes exactly 1000 of them
 * with built-in duplicate prevention for future batch runs
 */

require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const ScraperFactory = require('./scrapers/modules/factory/scraper-factory');
const SupabaseClient = require('./database/supabase-client');

class Cities1000NewRunner {
    constructor() {
        this.factory = new ScraperFactory();
        this.db = new SupabaseClient();
        this.scraper = null;
        this.scraperId = null;
        this.config = null;
        this.targetCityCount = 1000;
    }

    /**
     * Get all cities from CSV
     */
    async loadAllCities() {
        const csvFile = 'utils/Postleitzahlen Deutschland.csv';
        
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

                        // Add coordinates if available
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

    /**
     * Get existing PLZs from database for current month
     */
    async getExistingPLZs() {
        try {
            const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
            console.log(`🔍 Checking existing PLZs in database for ${currentMonth}...`);
            
            const { data, error } = await this.db.supabase
                .from('monthly_electricity_prices')
                .select('plz')
                .eq('data_month', currentMonth);

            if (error) throw error;

            const existingPLZs = new Set(data.map(row => row.plz));
            console.log(`📊 Found ${existingPLZs.size} cities already processed this month`);
            return existingPLZs;
        } catch (error) {
            console.warn('⚠️  Could not check existing PLZs:', error.message);
            return new Set();
        }
    }

    /**
     * Filter cities to get unprocessed ones
     */
    async getUnprocessedCities() {
        const allCities = await this.loadAllCities();
        const existingPLZs = await this.getExistingPLZs();
        
        const unprocessedCities = allCities.filter(city => !existingPLZs.has(city.plz));
        console.log(`🎯 Found ${unprocessedCities.length} unprocessed cities`);
        
        // Take first 1000 unprocessed cities
        const citiesToProcess = unprocessedCities.slice(0, this.targetCityCount);
        console.log(`📋 Selected ${citiesToProcess.length} cities for processing (target: ${this.targetCityCount})`);
        
        return citiesToProcess;
    }

    /**
     * Extract clean city name from PLZ format
     */
    extractCityName(fullName) {
        // Extract city name (first part before comma if exists)
        return fullName.split(',')[0].trim()
            .replace(/ä/g, 'ae').replace(/Ä/g, 'ae')
            .replace(/ö/g, 'oe').replace(/Ö/g, 'oe')
            .replace(/ü/g, 'ue').replace(/Ü/g, 'ue')
            .replace(/ß/g, 'ss')
            .replace(/\s+/g, '-')
            .replace(/[^a-zA-Z0-9\-]/g, '')
            .toLowerCase();
    }

    /**
     * Initialize the modular scraper with optimized settings
     */
    async initializeScraper() {
        try {
            console.log('🏗️  Initializing modular scraper for NEW cities...');

            const scraperOptions = {
                source: 'stromauskunft',
                storage: 'supabase',
                enableGeographicCompletion: true,
                config: {
                    // Optimize for batch processing
                    delays: {
                        betweenRequests: parseInt(process.env.SCRAPER_DELAY) || 2000, // 2 second delay (respectful)
                        batchPause: 10000,          // 10 seconds between batches
                        maxRetries: 2
                    },
                    batching: {
                        enabled: true,
                        totalBatches: 5,            // 5 batches of ~200 cities each
                        autoProgress: false,        // Pause between batches for safety
                        stateSaveInterval: 10       // Save state every 10 cities
                    },
                    database: {
                        enableSessionTracking: true,
                        autoMonthDetection: true,
                        duplicateHandling: 'skip',  // Skip duplicates automatically
                        batchingOptimizations: {
                            enableBatchStorage: true,
                            batchStorageSize: 50,
                            enableBatchErrorLogging: true,
                            batchErrorSize: 25,
                            enableBulkDuplicateCheck: true // Check all PLZs for duplicates at start
                        }
                    },
                    quality: {
                        enableOutlierDetection: true,
                        enablePriceValidation: true,
                        enableGeographicFallback: false // Disable for first run
                    },
                    logging: {
                        level: 'info',
                        enableDetailedScraping: process.env.ENABLE_SCRAPING_LOGS === 'true',
                        enableProgressReports: true
                    }
                }
            };

            const result = await this.factory.createImprovedScraper(scraperOptions);
            this.scraper = result.scraper;
            this.scraperId = result.scraperId;
            this.config = result.config;

            console.log('✅ Modular scraper initialized with duplicate prevention');
            console.log(`📝 Session ID: ${this.scraperId}`);

        } catch (error) {
            throw new Error(`Failed to initialize scraper: ${error.message}`);
        }
    }

    /**
     * Run the scraper for 1000 NEW cities
     */
    async run() {
        try {
            console.log('🚀 Starting 1000 NEW Cities Scraping Session');
            console.log('==========================================\n');

            // 1. Test database connection
            const connectionOk = await this.db.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection failed');
            }

            // 2. Get unprocessed cities
            const cities = await this.getUnprocessedCities();

            if (cities.length === 0) {
                console.log('🎉 All cities have been processed! No new cities to scrape.');
                console.log('💡 If you want to re-scrape existing cities, use the --force option.');
                return;
            }

            // 3. Initialize scraper
            await this.initializeScraper();

            // 4. Show scraping plan
            const delay = parseInt(process.env.SCRAPER_DELAY) || 2000;
            const estimatedTime = Math.ceil(cities.length * delay / 1000 / 60);
            
            console.log('\n📋 SCRAPING PLAN:');
            console.log(`   • NEW cities to process: ${cities.length}`);
            console.log(`   • Batches: 5 (${Math.ceil(cities.length/5)} cities each)`);
            console.log(`   • Delay between requests: ${delay}ms`);
            console.log(`   • Estimated total time: ${estimatedTime} minutes`);
            console.log(`   • Duplicate prevention: ENABLED`);
            console.log(`   • Database storage: ENABLED`);
            console.log(`   • Session tracking: ENABLED`);

            console.log('\n🎯 DUPLICATE PREVENTION:');
            console.log('   • Only unprocessed cities will be scraped');
            console.log('   • Database checked before processing starts');
            console.log('   • Future runs will automatically skip these cities');
            console.log('   • State is saved every 10 cities for resumability');

            // 5. Execute scraping
            console.log('\n🚀 Starting scraping workflow...\n');

            const result = await this.scraper.scrapeElectricityPrices(cities, {
                skipExistingData: false,    // We've already filtered duplicates
                targetMonth: null           // Use current month
            });

            console.log('\n🎉 1000 NEW Cities Scraping Completed!');
            this.printFinalSummary(cities.length);

            return result;

        } catch (error) {
            console.error('💥 Fatal error:', error.message);
            if (process.env.NODE_ENV === 'development') {
                console.error('Stack trace:', error.stack);
            }
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Print final summary
     */
    printFinalSummary(actualCitiesProcessed) {
        console.log('\n📊 === BATCH RUN SUMMARY ===');
        console.log(`   Target cities: ${this.targetCityCount}`);
        console.log(`   Actual new cities processed: ${actualCitiesProcessed}`);
        console.log(`   Session ID: ${this.scraperId}`);
        console.log(`   Month: ${new Date().toISOString().slice(0, 7)}`);
        console.log('\n✅ Next Steps:');
        console.log('   • Check database for results');
        console.log('   • Run again with same command for next batch of new cities');
        console.log('   • System will automatically skip already processed cities');
        console.log('\n📁 Database Tables:');
        console.log('   • monthly_electricity_prices: Main price data');
        console.log('   • scraping_sessions: Session tracking');
        console.log('   • scraping_errors: Error details');
        console.log('\n🔄 Progress Tracking:');
        console.log('   • Each run processes only NEW cities');
        console.log('   • Perfect for daily/weekly batch processing');
        console.log('   • No risk of duplicate work');
    }

    /**
     * Cleanup resources
     */
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

// Main execution
async function main() {
    const runner = new Cities1000NewRunner();
    
    try {
        await runner.run();
        console.log('\n✅ Script completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Script failed:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = Cities1000NewRunner; 