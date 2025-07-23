#!/usr/bin/env node

/**
 * Modular Electricity Price Scraper - Main Orchestrator
 * Manages monthly scraping process with database storage and proper month tagging
 */

require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const ScraperFactory = require('./modules/factory/scraper-factory');

class MonthlyScrapingOrchestrator {
    constructor() {
        this.factory = new ScraperFactory();
        this.scraper = null;
        this.scraperId = null;
        this.config = null;
        this.args = this.parseCommandLineArgs();
    }

    /**
     * Parse command line arguments
     */
    parseCommandLineArgs() {
        const args = process.argv.slice(2);
        const options = {
            inputFile: 'utils/Postleitzahlen Deutschland.csv',
            month: null,        // Auto-detect if not specified
            force: false,       // Force re-scrape existing data
            test: false,        // Use test configuration
            batchSize: null,    // Override batch size
            skipExisting: true, // Skip existing data by default
            help: false,
            reset: false,       // Reset state
            status: false,      // Show status
            validate: false     // Validate components only
        };

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            
            switch (arg) {
                case '--help':
                case '-h':
                    options.help = true;
                    break;
                case '--force':
                case '-f':
                    options.force = true;
                    options.skipExisting = false;
                    break;
                case '--test':
                case '-t':
                    options.test = true;
                    break;
                case '--reset':
                case '-r':
                    options.reset = true;
                    break;
                case '--status':
                case '-s':
                    options.status = true;
                    break;
                case '--validate':
                case '-v':
                    options.validate = true;
                    break;
                case '--month':
                case '-m':
                    if (i + 1 < args.length) {
                        options.month = args[++i];
                    }
                    break;
                case '--input':
                case '-i':
                    if (i + 1 < args.length) {
                        options.inputFile = args[++i];
                    }
                    break;
                case '--batch-size':
                case '-b':
                    if (i + 1 < args.length) {
                        options.batchSize = parseInt(args[++i]);
                    }
                    break;
                default:
                    if (!arg.startsWith('--') && !arg.startsWith('-')) {
                        // Assume it's an input file if no other option matched
                        options.inputFile = arg;
                    }
                    break;
            }
        }

        return options;
    }

    /**
     * Show help information
     */
    showHelp() {
        console.log(`
🚀 Modular Electricity Price Scraper v2.0

USAGE:
    node scrapers/modular-scraper.js [OPTIONS] [INPUT_FILE]

OPTIONS:
    -h, --help              Show this help message
    -f, --force             Force re-scrape existing data (overrides duplicate protection)
    -t, --test              Use test configuration (faster, smaller batches)
    -r, --reset             Reset all progress and start fresh
    -s, --status            Show current scraping status and exit
    -v, --validate          Validate components and database connection only
    -m, --month MONTH       Specify month (YYYY-MM format, auto-detected if not provided)
    -i, --input FILE        Input CSV file (default: utils/Postleitzahlen Deutschland.csv)
    -b, --batch-size SIZE   Override batch size configuration

EXAMPLES:
    # Start normal scraping
    node scrapers/modular-scraper.js

    # Test with small batches
    node scrapers/modular-scraper.js --test

    # Force re-scrape existing data
    node scrapers/modular-scraper.js --force

    # Scrape specific month
    node scrapers/modular-scraper.js --month 2025-01

    # Check status
    node scrapers/modular-scraper.js --status

    # Reset and start fresh
    node scrapers/modular-scraper.js --reset

    # Validate setup without scraping
    node scrapers/modular-scraper.js --validate

FEATURES:
    ✅ Monthly data organization
    ✅ Database storage (Supabase)
    ✅ Automatic duplicate prevention
    ✅ Session tracking and resume capability
    ✅ Quality validation and outlier detection
    ✅ Modular, extensible architecture

CONFIGURATION:
    Configure via .env file or environment variables:
    - SUPABASE_URL, SUPABASE_ANON_KEY (required)
    - SCRAPER_DELAY, DB_BATCH_SIZE (optional)
    - LOG_LEVEL, ENABLE_SCRAPING_LOGS (optional)
        `);
    }

    /**
     * Main execution method
     */
    async run() {
        try {
            // Handle help
            if (this.args.help) {
                this.showHelp();
                return;
            }

            console.log('🚀 Modular Electricity Price Scraper v2.0');
            console.log('============================================\n');

            // Initialize scraper
            await this.initializeScraper();

            // Handle different operation modes
            if (this.args.validate) {
                await this.validateComponents();
            } else if (this.args.status) {
                await this.showStatus();
            } else if (this.args.reset) {
                await this.resetProgress();
            } else {
                await this.executeMonthlyScrapingWorkflow();
            }

        } catch (error) {
            console.error('💥 Fatal error:', error.message);
            if (process.env.NODE_ENV === 'development') {
                console.error('Stack trace:', error.stack);
            }
            process.exit(1);
        } finally {
            await this.cleanup();
        }
    }

    /**
     * Initialize the modular scraper
     */
    async initializeScraper() {
        try {
            console.log('🏗️  Initializing modular scraper...');

            const scraperOptions = {
                source: 'stromauskunft',
                storage: 'supabase',
                enableGeographicCompletion: true,
                config: this.buildScraperConfig()
            };

            if (this.args.test) {
                const result = await this.factory.createTestScraper(scraperOptions);
                this.scraper = result.scraper;
                this.scraperId = result.scraperId;
                this.config = result.config;
                console.log('🧪 Test scraper initialized');
            } else {
                const result = await this.factory.createImprovedScraper(scraperOptions);
                this.scraper = result.scraper;
                this.scraperId = result.scraperId;
                this.config = result.config;
                console.log('✅ Enhanced scraper initialized (now default)');
            }

        } catch (error) {
            throw new Error(`Failed to initialize scraper: ${error.message}`);
        }
    }

    /**
     * Build scraper configuration from command line args and environment
     */
    buildScraperConfig() {
        const baseConfig = {
            database: {
                autoMonthDetection: !this.args.month,
                duplicateHandling: this.args.force ? 'update' : 'skip'
            }
        };

        // Override batch size if specified
        if (this.args.batchSize) {
            baseConfig.batching = {
                totalBatches: Math.max(1, Math.min(10, this.args.batchSize))
            };
        }

        // Override month if specified
        if (this.args.month) {
            const monthDate = this.parseMonthString(this.args.month);
            baseConfig.database.autoMonthDetection = false;
            baseConfig.targetMonth = monthDate;
        }

        return baseConfig;
    }

    /**
     * Parse month string to YYYY-MM-DD format
     */
    parseMonthString(monthStr) {
        const monthRegex = /^(\d{4})-(\d{1,2})$/;
        const match = monthStr.match(monthRegex);
        
        if (!match) {
            throw new Error(`Invalid month format: ${monthStr}. Use YYYY-MM format (e.g., 2025-01)`);
        }

        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        
        if (month < 1 || month > 12) {
            throw new Error(`Invalid month: ${month}. Must be 1-12`);
        }

        return `${year}-${String(month).padStart(2, '0')}-01`;
    }

    /**
     * Validate components without running scraper
     */
    async validateComponents() {
        console.log('🧪 Validating scraper components...\n');

        const results = await this.factory.testComponents();
        
        console.log('\n📋 Validation Results:');
        console.log(`   Configuration: ${results.config ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   Database Storage: ${results.storage ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   Price Extractor: ${results.extractor ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   Quality Validator: ${results.validator ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`   Source Adapter: ${results.adapter ? '✅ PASS' : '❌ FAIL'}`);
        
        console.log(`\n🎯 Overall Status: ${results.overall ? '✅ ALL SYSTEMS GO' : '❌ ISSUES DETECTED'}`);
        
        if (!results.overall) {
            console.log('\n⚠️  Please fix the failing components before running the scraper.');
            process.exit(1);
        }
    }

    /**
     * Show current scraping status
     */
    async showStatus() {
        console.log('📊 Scraper Status\n');
        
        // Get current month
        const currentMonth = this.config.getCurrentMonth();
        console.log(`Current month: ${currentMonth}`);
        
        // Check database for existing data
        const storage = this.scraper.databaseStorage;
        const monthExists = await storage.monthDataExists(currentMonth);
        
        console.log(`Data exists for current month: ${monthExists ? 'Yes' : 'No'}`);
        
        if (monthExists) {
            const stats = await storage.getMonthlyStats(currentMonth);
            if (stats && stats.coverage) {
                console.log(`\nCurrent month statistics:`);
                console.log(`   Total entries: ${stats.coverage.total_entries}`);
                console.log(`   Original data: ${stats.coverage.original_count}`);
                console.log(`   Fallback data: ${stats.coverage.fallback_count}`);
                console.log(`   Outliers: ${stats.coverage.outlier_count}`);
            }
        }

        // Get available months
        const availableMonths = await storage.getAvailableMonths();
        console.log(`\nAvailable data months: ${availableMonths.length}`);
        if (availableMonths.length > 0) {
            console.log(`   Latest: ${availableMonths[0]}`);
            console.log(`   Oldest: ${availableMonths[availableMonths.length - 1]}`);
        }

        // Get state information
        const stateManager = this.scraper.stateManager;
        const stateInfo = stateManager.getStateRecoveryInfo();
        
        if (stateInfo.hasRecoverableState) {
            console.log(`\n🔄 Recoverable State Found:`);
            console.log(`   Session ID: ${stateInfo.sessionId}`);
            console.log(`   Current batch: ${stateInfo.currentBatch}/${stateInfo.totalBatches}`);
            console.log(`   Processed cities: ${stateInfo.processedCities}`);
            console.log(`   Results: ${stateInfo.results}`);
            console.log(`   Errors: ${stateInfo.errors}`);
            console.log(`   Can resume: ${stateInfo.canResume ? 'Yes' : 'No'}`);
            if (stateInfo.canResume) {
                console.log(`   Estimated completion: ${stateInfo.estimatedCompletion}`);
            }
        } else {
            console.log(`\n🆕 No recoverable state - ready for fresh start`);
        }
    }

    /**
     * Reset all progress
     */
    async resetProgress() {
        console.log('♻️  Resetting scraper progress...\n');
        
        try {
            const stateManager = this.scraper.stateManager;
            await stateManager.resetState();
            
            console.log('✅ Progress reset successfully');
            console.log('🆕 Ready for fresh start');
            
        } catch (error) {
            console.error('❌ Error resetting progress:', error.message);
            throw error;
        }
    }

    /**
     * Execute the main monthly scraping workflow
     */
    async executeMonthlyScrapingWorkflow() {
        try {
            // 1. Determine target month
            const targetMonth = this.determineTargetMonth();
            console.log(`🎯 Target month: ${targetMonth}`);

            // 2. Check for existing data
            if (!this.args.force && await this.checkExistingData(targetMonth)) {
                console.log('📅 Data already exists for this month.');
                console.log('   Use --force to re-scrape or --month to specify a different month.');
                return;
            }

            // 3. Load cities data
            const citiesData = await this.loadCitiesData();
            console.log(`📖 Loaded ${citiesData.length} cities from ${this.args.inputFile}`);

            // 4. Execute scraping
            console.log('\n🚀 Starting monthly scraping workflow...\n');
            await this.scraper.scrapeElectricityPrices(citiesData, {
                skipExistingData: this.args.skipExisting,
                targetMonth: targetMonth
            });

            console.log('\n🎉 Monthly scraping completed successfully!');
            
            // 5. Generate summary report
            await this.generateSummaryReport(targetMonth);

        } catch (error) {
            console.error('❌ Error in scraping workflow:', error.message);
            throw error;
        }
    }

    /**
     * Determine the target month for scraping
     */
    determineTargetMonth() {
        if (this.args.month) {
            return this.parseMonthString(this.args.month);
        } else {
            return this.config.getCurrentMonth();
        }
    }

    /**
     * Check if data already exists for the target month
     */
    async checkExistingData(targetMonth) {
        try {
            const storage = this.scraper.databaseStorage;
            return await storage.monthDataExists(targetMonth);
        } catch (error) {
            console.warn('⚠️  Could not check existing data:', error.message);
            return false;
        }
    }

    /**
     * Load cities data from CSV file
     */
    async loadCitiesData() {
        return new Promise((resolve, reject) => {
            const cities = [];
            
            if (!fs.existsSync(this.args.inputFile)) {
                reject(new Error(`Input file not found: ${this.args.inputFile}`));
                return;
            }

            fs.createReadStream(this.args.inputFile)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    // Handle different CSV column naming conventions
                    const cityName = row['PLZ Name (short)'] || row.Name || row.Ort || row.Stadt || row.city;
                    const plz = row['Postleitzahl / Post code'] || row.PLZ || row.plz || row.postcode;
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
                    if (cities.length === 0) {
                        reject(new Error(`No valid cities found in ${this.args.inputFile}`));
                    } else {
                        resolve(cities);
                    }
                })
                .on('error', reject);
        });
    }

    /**
     * Extract main city name from complex names with proper German umlaut handling
     */
    extractCityName(fullName) {
        if (!fullName) return '';
        
        // Remove content in parentheses
        let cityName = fullName.replace(/\s*\([^)]*\)/g, '');
        
        // Handle compound names - take first part
        if (cityName.includes(',')) {
            cityName = cityName.split(',')[0];
        }
        
        // Normalize for URL usage with proper umlaut handling
        return cityName
            .trim()
            .toLowerCase()
            // Handle German umlauts properly
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            // Handle uppercase umlauts too
            .replace(/Ä/g, 'ae')
            .replace(/Ö/g, 'oe')
            .replace(/Ü/g, 'ue')
            // Clean up for URL
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    /**
     * Generate summary report after scraping
     */
    async generateSummaryReport(targetMonth) {
        try {
            console.log('\n📊 Generating summary report...');
            
            const storage = this.scraper.databaseStorage;
            const stats = await storage.getMonthlyStats(targetMonth);
            
            if (stats && stats.coverage) {
                console.log('\n📈 === SCRAPING SUMMARY ===');
                console.log(`Month: ${targetMonth}`);
                console.log(`Total entries: ${stats.coverage.total_entries}`);
                console.log(`Original data: ${stats.coverage.original_count}`);
                console.log(`Fallback data: ${stats.coverage.fallback_count || 0}`);
                console.log(`Outliers detected: ${stats.coverage.outlier_count || 0}`);
                
                if (stats.averages) {
                    console.log('\n💰 === PRICE AVERAGES ===');
                    console.log(`Local Provider Avg: €${stats.averages.lokaler_versorger_avg?.toFixed(4) || 'N/A'}/kWh`);
                    console.log(`Green Energy Avg: €${stats.averages.oekostrom_avg?.toFixed(4) || 'N/A'}/kWh`);
                    console.log(`Overall Average: €${stats.averages.overall_avg?.toFixed(4) || 'N/A'}/kWh`);
                    console.log(`Sample Size: ${stats.averages.sample_size || 0} cities`);
                }
                
                console.log('\n🗄️  Data stored in Supabase database');
                console.log(`📅 Month partition: ${targetMonth}`);
            } else {
                console.log('⚠️  Could not generate detailed summary - basic scraping completed');
            }

        } catch (error) {
            console.warn('⚠️  Error generating summary report:', error.message);
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            if (this.scraperId) {
                await this.factory.cleanupScraper(this.scraperId);
            }
        } catch (error) {
            console.warn('⚠️  Error during cleanup:', error.message);
        }
    }
}

// Run the orchestrator if this file is executed directly
if (require.main === module) {
    const orchestrator = new MonthlyScrapingOrchestrator();
    orchestrator.run();
}

module.exports = MonthlyScrapingOrchestrator; 