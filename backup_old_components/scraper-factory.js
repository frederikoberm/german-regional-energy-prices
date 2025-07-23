/**
 * Scraper Factory
 * Assembles and configures all scraper modules for easy instantiation
 */

const ScraperCore = require('../core/scraper-core');
const ScraperConfig = require('../config');

// Storage modules
const SupabaseStorage = require('../storage/supabase-storage');

// Extractor modules
const StromauskunftExtractor = require('../extractors/stromauskunft-extractor');

// Quality modules
const QualityValidator = require('../quality/quality-validator');

// Adapter modules
const StromauskunftAdapter = require('../adapters/stromauskunft-adapter');

// State management
const DatabaseStateManager = require('../state/database-state-manager');

class ScraperFactory {
    constructor() {
        this.availableSources = ['stromauskunft'];
        this.availableStorages = ['supabase'];
        this.builtScrapers = new Map();
    }

    /**
     * Create a complete scraper instance with all modules
     */
    async createScraper(options = {}) {
        try {
            console.log('🏗️  Assembling modular scraper...');

            // 1. Initialize configuration
            const config = new ScraperConfig(options.config || {});
            config.validate();
            console.log('   ✅ Configuration validated');

            // 2. Create storage module
            const storage = this.createStorageModule(options.storage || 'supabase', config);
            console.log('   ✅ Storage module created');

            // 3. Create price extractor
            const extractor = this.createExtractorModule(options.source || 'stromauskunft', config);
            console.log('   ✅ Price extractor created');

            // 4. Create quality validator
            const validator = this.createQualityValidator(config);
            console.log('   ✅ Quality validator created');

            // 5. Create source adapter
            const adapter = this.createSourceAdapter(options.source || 'stromauskunft', config, extractor);
            console.log('   ✅ Source adapter created');

            // 6. Create state manager
            const stateManager = this.createStateManager(config, storage);
            console.log('   ✅ State manager created');

            // 7. Create geographic completion (optional)
            const geographicCompletion = options.enableGeographicCompletion ? 
                this.createGeographicCompletion(config) : null;
            if (geographicCompletion) {
                console.log('   ✅ Geographic completion module created');
            }

            // 8. Test database connection
            const connectionOk = await storage.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection test failed');
            }
            console.log('   ✅ Database connection verified');

            // 9. Assemble the core scraper
            const scraper = new ScraperCore(options);
            scraper.injectModules({
                sourceAdapter: adapter,
                priceExtractor: extractor,
                qualityValidator: validator,
                databaseStorage: storage,
                stateManager: stateManager,
                geographicCompletion: geographicCompletion
            });

            console.log('✅ Modular scraper assembled successfully!');
            
            // Store reference for cleanup
            const scraperId = `scraper_${Date.now()}`;
            this.builtScrapers.set(scraperId, {
                scraper,
                components: { storage, adapter, stateManager },
                created: new Date()
            });

            return { scraper, scraperId, config };

        } catch (error) {
            console.error('❌ Error creating scraper:', error.message);
            throw new Error(`Scraper factory failed: ${error.message}`);
        }
    }

    /**
     * Create storage module based on type
     */
    createStorageModule(storageType, config) {
        switch (storageType.toLowerCase()) {
            case 'supabase':
                return new SupabaseStorage(config);
            default:
                throw new Error(`Unknown storage type: ${storageType}. Available: ${this.availableStorages.join(', ')}`);
        }
    }

    /**
     * Create price extractor based on source
     */
    createExtractorModule(sourceType, config) {
        switch (sourceType.toLowerCase()) {
            case 'stromauskunft':
                return new StromauskunftExtractor(config);
            default:
                throw new Error(`Unknown source type: ${sourceType}. Available: ${this.availableSources.join(', ')}`);
        }
    }

    /**
     * Create quality validator
     */
    createQualityValidator(config) {
        return new QualityValidator(config);
    }

    /**
     * Create source adapter based on type
     */
    createSourceAdapter(sourceType, config, extractor) {
        switch (sourceType.toLowerCase()) {
            case 'stromauskunft':
                return new StromauskunftAdapter(config, extractor);
            default:
                throw new Error(`Unknown source type: ${sourceType}. Available: ${this.availableSources.join(', ')}`);
        }
    }

    /**
     * Create state manager
     */
    createStateManager(config, storage) {
        return new DatabaseStateManager(config, storage);
    }

    /**
     * Create geographic completion module (placeholder)
     */
    createGeographicCompletion(config) {
        // For now, return null - this would be implemented in a separate module
        // based on the existing geographic completion logic
        console.log('⚠️  Geographic completion module not yet implemented');
        return null;
    }

    /**
     * Create a quick-start scraper with default settings
     */
    async createDefaultScraper(overrides = {}) {
        const defaultOptions = {
            source: 'stromauskunft',
            storage: 'supabase',
            enableGeographicCompletion: false,
            config: {
                delays: {
                    betweenRequests: process.env.NODE_ENV === 'production' ? 2000 : 1000
                },
                logging: {
                    enableDetailedScraping: process.env.NODE_ENV !== 'production'
                },
                ...overrides.config
            },
            ...overrides
        };

        return await this.createScraper(defaultOptions);
    }

    /**
     * Create a test scraper with minimal delays for testing
     */
    async createTestScraper(overrides = {}) {
        const testOptions = {
            source: 'stromauskunft',
            storage: 'supabase',
            enableGeographicCompletion: false,
            config: {
                delays: {
                    betweenRequests: 100,
                    batchPause: 500,
                    retryDelay: 100
                },
                batching: {
                    totalBatches: 2,
                    stateSaveInterval: 5
                },
                logging: {
                    level: 'warn',
                    enableDetailedScraping: false
                },
                ...overrides.config
            },
            ...overrides
        };

        return await this.createScraper(testOptions);
    }

    /**
     * Test all components without creating a full scraper
     */
    async testComponents(options = {}) {
        const results = {
            config: false,
            storage: false,
            extractor: false,
            validator: false,
            adapter: false,
            overall: false
        };

        try {
            console.log('🧪 Testing scraper components...');

            // Test configuration
            try {
                const config = new ScraperConfig(options.config || {});
                config.validate();
                results.config = true;
                console.log('   ✅ Configuration test passed');
            } catch (error) {
                console.log(`   ❌ Configuration test failed: ${error.message}`);
            }

            // Test storage
            try {
                const config = new ScraperConfig(options.config || {});
                const storage = this.createStorageModule('supabase', config);
                const connectionOk = await storage.testConnection();
                results.storage = connectionOk;
                console.log(`   ${connectionOk ? '✅' : '❌'} Storage test ${connectionOk ? 'passed' : 'failed'}`);
            } catch (error) {
                console.log(`   ❌ Storage test failed: ${error.message}`);
            }

            // Test extractor
            try {
                const config = new ScraperConfig(options.config || {});
                const extractor = this.createExtractorModule('stromauskunft', config);
                const info = extractor.getExtractorInfo();
                results.extractor = !!info.name;
                console.log('   ✅ Extractor test passed');
            } catch (error) {
                console.log(`   ❌ Extractor test failed: ${error.message}`);
            }

            // Test validator
            try {
                const config = new ScraperConfig(options.config || {});
                const validator = this.createQualityValidator(config);
                const thresholds = validator.getQualityThresholds();
                results.validator = !!thresholds;
                console.log('   ✅ Validator test passed');
            } catch (error) {
                console.log(`   ❌ Validator test failed: ${error.message}`);
            }

            // Test adapter
            try {
                const config = new ScraperConfig(options.config || {});
                const extractor = this.createExtractorModule('stromauskunft', config);
                const adapter = this.createSourceAdapter('stromauskunft', config, extractor);
                const info = adapter.getSourceInfo();
                results.adapter = !!info.name;
                console.log('   ✅ Adapter test passed');
            } catch (error) {
                console.log(`   ❌ Adapter test failed: ${error.message}`);
            }

            // Calculate overall result excluding the 'overall' field itself
            const testFields = ['config', 'storage', 'extractor', 'validator', 'adapter'];
            results.overall = testFields.every(field => results[field] === true);
            
            console.log(`\n🧪 Component tests completed: ${results.overall ? 'ALL PASSED' : 'SOME FAILED'}`);
            return results;

        } catch (error) {
            console.error('❌ Component testing failed:', error.message);
            return results;
        }
    }

    /**
     * Get information about available modules
     */
    getAvailableModules() {
        return {
            sources: this.availableSources,
            storages: this.availableStorages,
            extractors: this.availableSources, // Currently 1:1 mapping
            adapters: this.availableSources,   // Currently 1:1 mapping
            features: {
                qualityValidation: true,
                outlierDetection: true,
                stateManagement: true,
                sessionTracking: true,
                batchProcessing: true,
                geographicCompletion: false // Not yet implemented
            }
        };
    }

    /**
     * Clean up a specific scraper
     */
    async cleanupScraper(scraperId) {
        try {
            const scraperInfo = this.builtScrapers.get(scraperId);
            if (!scraperInfo) {
                console.warn(`⚠️  Scraper ${scraperId} not found for cleanup`);
                return;
            }

            // Cleanup components
            if (scraperInfo.components.storage && scraperInfo.components.storage.close) {
                await scraperInfo.components.storage.close();
            }

            if (scraperInfo.components.adapter && scraperInfo.components.adapter.cleanup) {
                await scraperInfo.components.adapter.cleanup();
            }

            // Remove from tracking
            this.builtScrapers.delete(scraperId);
            
            console.log(`🧹 Scraper ${scraperId} cleaned up successfully`);

        } catch (error) {
            console.error(`❌ Error cleaning up scraper ${scraperId}:`, error.message);
        }
    }

    /**
     * Clean up all created scrapers
     */
    async cleanupAll() {
        console.log('🧹 Cleaning up all scrapers...');
        
        const scraperIds = Array.from(this.builtScrapers.keys());
        for (const scraperId of scraperIds) {
            await this.cleanupScraper(scraperId);
        }
        
        console.log('✅ All scrapers cleaned up');
    }

    /**
     * Get factory statistics
     */
    getFactoryStats() {
        return {
            totalScrapersCreated: this.builtScrapers.size,
            availableModules: this.getAvailableModules(),
            activeScrapers: Array.from(this.builtScrapers.keys()),
            factoryVersion: '2.0'
        };
    }
}

module.exports = ScraperFactory; 