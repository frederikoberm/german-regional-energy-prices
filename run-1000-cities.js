#!/usr/bin/env node

/**
 * Run Scraper for 1000 Cities
 * Uses the modular scraper to process exactly 1000 cities from the German PLZ database
 * with built-in duplicate prevention for future batch runs
 */

require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const ScraperFactory = require('./scrapers/modules/factory/scraper-factory');

class Cities1000Runner {
    constructor() {
        this.factory = new ScraperFactory();
        this.scraper = null;
        this.scraperId = null;
        this.config = null;
        this.targetCityCount = 1000;
    }

    /**
     * Load exactly 1000 cities from the German PLZ CSV
     */
    async load1000Cities() {
        const csvFile = 'utils/Postleitzahlen Deutschland.csv';
        
        return new Promise((resolve, reject) => {
            const cities = [];
            let count = 0;
            
            if (!fs.existsSync(csvFile)) {
                reject(new Error(`PLZ CSV file not found: ${csvFile}`));
                return;
            }

            console.log(`📖 Loading first ${this.targetCityCount} cities from ${csvFile}...`);

            fs.createReadStream(csvFile)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    if (count >= this.targetCityCount) return; // Stop at 1000

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
                        count++;
                    }
                })
                .on('end', () => {
                    console.log(`✅ Loaded ${cities.length} cities (target: ${this.targetCityCount})`);
                    resolve(cities);
                })
                .on('error', reject);
        });
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
            console.log('🏗️  Initializing modular scraper for 1000 cities...');

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
     * Run the scraper for 1000 cities
     */
    async run() {
        try {
            console.log('🚀 Starting 1000 Cities Scraping Session');
            console.log('=========================================\n');

            // 1. Initialize scraper
            await this.initializeScraper();

            // 2. Load 1000 cities
            const cities = await this.load1000Cities();

            if (cities.length === 0) {
                throw new Error('No cities loaded from CSV');
            }

            // 3. Show scraping plan
            const delay = parseInt(process.env.SCRAPER_DELAY) || 2000;
            const estimatedTime = Math.ceil(cities.length * delay / 1000 / 60);
            
            console.log('\n📋 SCRAPING PLAN:');
            console.log(`   • Cities to process: ${cities.length}`);
            console.log(`   • Batches: 5 (${Math.ceil(cities.length/5)} cities each)`);
            console.log(`   • Delay between requests: ${delay}ms`);
            console.log(`   • Estimated total time: ${estimatedTime} minutes`);
            console.log(`   • Duplicate prevention: ENABLED`);
            console.log(`   • Database storage: ENABLED`);
            console.log(`   • Session tracking: ENABLED`);

            console.log('\n🎯 DUPLICATE PREVENTION:');
            console.log('   • All cities are checked against existing database entries');
            console.log('   • Only new cities will be scraped');
            console.log('   • Future runs will automatically skip these 1000 cities');
            console.log('   • State is saved every 10 cities for resumability');

            // 4. Execute scraping
            console.log('\n🚀 Starting scraping workflow...\n');

            const result = await this.scraper.scrapeElectricityPrices(cities, {
                skipExistingData: true,
                targetMonth: null // Use current month
            });

            console.log('\n🎉 1000 Cities Scraping Completed!');
            this.printFinalSummary();

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
    printFinalSummary() {
        console.log('\n📊 === BATCH RUN SUMMARY ===');
        console.log(`   Target cities: ${this.targetCityCount}`);
        console.log(`   Session ID: ${this.scraperId}`);
        console.log(`   Month: ${new Date().toISOString().slice(0, 7)}`);
        console.log('\n✅ Next Steps:');
        console.log('   • Check database for results');
        console.log('   • Run again tomorrow with same command for next 1000 cities');
        console.log('   • System will automatically skip already processed cities');
        console.log('\n📁 Database Tables:');
        console.log('   • monthly_electricity_prices: Main price data');
        console.log('   • scraping_sessions: Session tracking');
        console.log('   • scraping_errors: Error details');
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
    const runner = new Cities1000Runner();
    
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

module.exports = Cities1000Runner; 