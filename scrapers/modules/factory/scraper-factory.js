/**
 * Enhanced Scraper Factory v2.0
 * Assembles improved scraper modules based on 100-city analysis
 */

const ScraperCore = require('../core/scraper-core');
const ScraperConfig = require('../config');

// Storage modules
const SupabaseStorage = require('../storage/supabase-storage');

// Enhanced extractor modules
const StromauskunftExtractor = require('../extractors/stromauskunft-extractor');

// Quality modules
const QualityValidator = require('../quality/quality-validator');

// Enhanced adapter modules
const StromauskunftAdapter = require('../adapters/stromauskunft-adapter');

// Geographic completion
const GeographicCompletion = require('../geographic/geographic-completion');

// State management
const DatabaseStateManager = require('../state/database-state-manager');

class ScraperFactory {
    constructor() {
        this.availableSources = ['stromauskunft', 'stromauskunft-improved'];
        this.availableStorages = ['supabase'];
        this.builtScrapers = new Map();
        this.version = '2.0';
        this.analysisIntegration = true;
    }

    /**
     * Create an enhanced scraper instance with analysis-based improvements
     */
    async createImprovedScraper(options = {}) {
        try {
            console.log('🚀 Assembling ENHANCED modular scraper v2.0...');
            console.log('   Based on comprehensive 100-city analysis');

            // 1. Initialize enhanced configuration
            const config = new ScraperConfig(options.config || {});
            config.validate();
            config.printConfig();

            // 2. Create storage module
            const storage = this.createStorageModule(options.storage || 'supabase', config);
            console.log('   ✅ Storage module created');

            // 3. Create enhanced price extractor
            const extractor = this.createEnhancedExtractorModule(config);
            console.log('   ✅ Enhanced price extractor created (with city classification)');

            // 4. Create quality validator
            const validator = this.createQualityValidator(config);
            console.log('   ✅ Quality validator created');

            // 5. Create enhanced source adapter
            const adapter = this.createEnhancedSourceAdapter(config, extractor);
            console.log('   ✅ Enhanced source adapter created (with error patterns)');

            // 6. Create state manager
            const stateManager = this.createStateManager(config, storage);
            console.log('   ✅ State manager created');

            // 7. Create geographic completion module
            const geographicCompletion = this.createGeographicCompletion(config);
            console.log('   ✅ Geographic completion module created');

            // 8. Test database connection
            const connectionOk = await storage.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection test failed');
            }
            console.log('   ✅ Database connection verified');

            // 9. Assemble the enhanced core scraper
            const scraper = new ScraperCore(options);
            scraper.injectModules({
                sourceAdapter: adapter,
                priceExtractor: extractor,
                qualityValidator: validator,
                databaseStorage: storage,
                stateManager: stateManager,
                geographicCompletion: geographicCompletion
            });

            console.log('✅ ENHANCED modular scraper assembled successfully!');
            console.log('   🎯 Features: City classification, format detection, improved error handling');
            
            // Store reference for cleanup
            const scraperId = `enhanced_scraper_${Date.now()}`;
            this.builtScrapers.set(scraperId, {
                scraper,
                components: { storage, adapter, stateManager, extractor },
                created: new Date(),
                version: this.version,
                enhanced: true
            });

            return { scraper, scraperId, config };

        } catch (error) {
            console.error('❌ Error creating enhanced scraper:', error.message);
            throw new Error(`Enhanced scraper factory failed: ${error.message}`);
        }
    }

    /**
     * Create legacy scraper for comparison
     */
    async createLegacyScraper(options = {}) {
        // This method creates the original scraper for comparison
        // Note: These are now the backup components
        const ScraperConfigOld = require('../../backup_old_components/config');
        const StromauskunftExtractorOld = require('../../backup_old_components/stromauskunft-extractor');
        const StromauskunftAdapterOld = require('../../backup_old_components/stromauskunft-adapter');

        try {
            console.log('🔄 Assembling LEGACY modular scraper (for comparison)...');

            const config = new ScraperConfigOld(options.config || {});
            config.validate();

            const storage = this.createStorageModule(options.storage || 'supabase', config);
            const extractor = new StromauskunftExtractorOld(config);
            const validator = this.createQualityValidator(config);
            const adapter = new StromauskunftAdapterOld(config, extractor);
            const stateManager = this.createStateManager(config, storage);

            const connectionOk = await storage.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection test failed');
            }

            const scraper = new ScraperCore(options);
            scraper.injectModules({
                sourceAdapter: adapter,
                priceExtractor: extractor,
                qualityValidator: validator,
                databaseStorage: storage,
                stateManager: stateManager
            });

            const scraperId = `legacy_scraper_${Date.now()}`;
            this.builtScrapers.set(scraperId, {
                scraper,
                components: { storage, adapter, stateManager, extractor },
                created: new Date(),
                version: '1.0',
                enhanced: false
            });

            console.log('✅ Legacy scraper assembled for comparison');
            return { scraper, scraperId, config };

        } catch (error) {
            console.error('❌ Error creating legacy scraper:', error.message);
            throw error;
        }
    }

    /**
     * Create enhanced price extractor
     */
    createEnhancedExtractorModule(config) {
        return new StromauskunftExtractor(config);
    }

    /**
     * Create enhanced source adapter
     */
    createEnhancedSourceAdapter(config, extractor) {
        return new StromauskunftAdapter(config, extractor);
    }

    /**
     * Create storage module (unchanged)
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
     * Create quality validator (unchanged)
     */
    createQualityValidator(config) {
        return new QualityValidator(config);
    }

    /**
     * Create state manager (unchanged)
     */
    createStateManager(config, storage) {
        return new DatabaseStateManager(config, storage);
    }

    /**
     * Create geographic completion module
     */
    createGeographicCompletion(config) {
        return new GeographicCompletion(config);
    }

    /**
     * Create test scraper with sample cities for validation
     */
    async createTestScraper(options = {}) {
        console.log('🧪 Creating TEST scraper for validation...');
        
        const testOptions = {
            ...options,
            config: {
                ...options.config,
                delays: { betweenRequests: 500, maxRetries: 1 }, // Faster for testing
                logging: { level: 'debug', enableDetailedScraping: true }
            }
        };

        return await this.createImprovedScraper(testOptions);
    }

    /**
     * Compare enhanced vs legacy performance
     */
    async createComparisonScrapers(options = {}) {
        console.log('⚖️  Creating COMPARISON scrapers (enhanced vs legacy)...');

        const enhanced = await this.createImprovedScraper(options);
        const legacy = await this.createLegacyScraper(options);

        return {
            enhanced,
            legacy,
            comparison: {
                enhancedId: enhanced.scraperId,
                legacyId: legacy.scraperId,
                created: new Date(),
                purpose: 'performance_comparison'
            }
        };
    }

    /**
     * Get scraper performance comparison
     */
    getPerformanceComparison(enhancedId, legacyId) {
        const enhanced = this.builtScrapers.get(enhancedId);
        const legacy = this.builtScrapers.get(legacyId);

        if (!enhanced || !legacy) {
            throw new Error('One or both scrapers not found for comparison');
        }

        const enhancedAdapter = enhanced.components.adapter;
        const legacyAdapter = legacy.components.adapter;

        return {
            enhanced: {
                version: enhanced.version,
                performance: enhancedAdapter.getSourceInfo().performance,
                cityClassPerformance: enhancedAdapter.getCityClassPerformance ? 
                    enhancedAdapter.getCityClassPerformance() : null,
                features: enhancedAdapter.getSourceInfo().features
            },
            legacy: {
                version: legacy.version,
                performance: legacyAdapter.getSourceInfo().performance,
                features: legacyAdapter.getSourceInfo().features
            },
            improvements: this.calculateImprovements(enhancedAdapter, legacyAdapter)
        };
    }

    /**
     * Calculate performance improvements
     */
    calculateImprovements(enhancedAdapter, legacyAdapter) {
        const enhancedPerf = enhancedAdapter.getSourceInfo().performance;
        const legacyPerf = legacyAdapter.getSourceInfo().performance;

        const enhancedSuccessRate = parseFloat(enhancedPerf.successRate) || 0;
        const legacySuccessRate = parseFloat(legacyPerf.successRate) || 0;

        return {
            successRateImprovement: enhancedSuccessRate - legacySuccessRate,
            errorReduction: legacyPerf.failedRequests - enhancedPerf.failedRequests,
            newFeatures: [
                'city_size_classification',
                'enhanced_error_handling',
                'format_detection',
                'dom_structure_analysis'
            ]
        };
    }

    /**
     * Clean up scraper instances
     */
    async cleanupScraper(scraperId) {
        return await this.cleanup(scraperId);
    }

    /**
     * Clean up scraper instances
     */
    async cleanup(scraperId) {
        const scraperInfo = this.builtScrapers.get(scraperId);
        if (scraperInfo) {
            // Close database connections, etc.
            if (scraperInfo.components.storage && scraperInfo.components.storage.cleanup) {
                await scraperInfo.components.storage.cleanup();
            }
            this.builtScrapers.delete(scraperId);
            console.log(`🧹 Cleaned up scraper: ${scraperId}`);
        }
    }

    /**
     * Clean up all scrapers
     */
    async cleanupAll() {
        const scraperIds = Array.from(this.builtScrapers.keys());
        for (const scraperId of scraperIds) {
            await this.cleanup(scraperId);
        }
        console.log('🧹 All scrapers cleaned up');
    }

    /**
     * Get factory information
     */
    getFactoryInfo() {
        return {
            version: this.version,
            analysisIntegration: this.analysisIntegration,
            availableSources: this.availableSources,
            availableStorages: this.availableStorages,
            activeSrapers: this.builtScrapers.size,
            improvements: [
                'city_size_classification',
                'euro_cent_format_handling',
                'enhanced_404_handling', 
                'dom_structure_adaptation',
                'extraction_strategy_optimization'
            ]
        };
    }

    /**
     * Validate factory setup
     */
    async validateSetup() {
        console.log('🔍 Validating enhanced factory setup...');
        
        try {
            // Test configuration
            const testConfig = new ScraperConfig();
            testConfig.validate();
            console.log('   ✅ Enhanced configuration valid');

            // Test module creation
            const extractor = this.createEnhancedExtractorModule(testConfig);
            console.log('   ✅ Enhanced extractor creation works');

            const adapter = this.createEnhancedSourceAdapter(testConfig, extractor);
            console.log('   ✅ Enhanced adapter creation works');

            console.log('✅ Factory setup validation passed');
            return true;

        } catch (error) {
            console.error('❌ Factory setup validation failed:', error.message);
            return false;
        }
    }
}

module.exports = ScraperFactory; 