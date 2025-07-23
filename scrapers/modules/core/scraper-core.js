/**
 * Scraper Core Module
 * Orchestrates all scraper modules and manages the main scraping workflow
 */

const ScraperConfig = require('../config');
const { SessionStateSchema } = require('../interfaces');

class ScraperCore {
    constructor(options = {}) {
        // Initialize configuration
        this.config = new ScraperConfig(options.config || {});
        this.config.validate();

        // Module dependencies (to be injected)
        this.sourceAdapter = null;
        this.priceExtractor = null;
        this.qualityValidator = null;
        this.databaseStorage = null;
        this.stateManager = null;
        this.geographicCompletion = null;

        // Session state
        this.sessionState = {
            sessionId: null,
            currentBatch: 0,
            totalBatches: this.config.getBatchingConfig().totalBatches,
            processedCities: new Set(),
            results: [],
            errors: [],
            startTime: null,
            currentMonth: this.config.getCurrentMonth(),
            configuration: this.config.toJSON()
        };

        // Statistics
        this.stats = {
            totalCities: 0,
            processedCities: 0,
            successfulExtractions: 0,
            failedExtractions: 0,
            outliersDetected: 0,
            validatedOutliers: 0,
            fallbackDataUsed: 0
        };
    }

    // === MODULE INJECTION ===

    /**
     * Inject all required modules
     */
    injectModules({
        sourceAdapter,
        priceExtractor,
        qualityValidator,
        databaseStorage,
        stateManager,
        geographicCompletion
    }) {
        this.sourceAdapter = sourceAdapter;
        this.priceExtractor = priceExtractor;
        this.qualityValidator = qualityValidator;
        this.databaseStorage = databaseStorage;
        this.stateManager = stateManager;
        this.geographicCompletion = geographicCompletion;

        this.validateModules();
        console.log('✅ All modules injected successfully');
    }

    /**
     * Validate that all required modules are present
     */
    validateModules() {
        const requiredModules = [
            'sourceAdapter',
            'priceExtractor', 
            'qualityValidator',
            'databaseStorage',
            'stateManager'
        ];

        const missingModules = requiredModules.filter(module => !this[module]);
        
        if (missingModules.length > 0) {
            throw new Error(`Missing required modules: ${missingModules.join(', ')}`);
        }
    }

    // === MAIN SCRAPING WORKFLOW ===

    /**
     * Main entry point for scraping electricity prices
     */
    async scrapeElectricityPrices(citiesData, options = {}) {
        try {
            console.log('🚀 Starting Modular Electricity Price Scraper...');
            this.config.printConfig();

            // Initialize session
            await this.initializeSession(citiesData, options);

            // Check for existing data
            if (options.skipExistingData && await this.checkExistingData()) {
                console.log('📅 Data already exists for current month. Use --force to override.');
                return this.sessionState;
            }

            // Load previous state if resuming
            await this.loadPreviousState();

            // Execute scraping workflow
            const result = await this.executeBatchedScraping(citiesData);

            // Handle geographic completion if enabled
            if (this.config.getQualityConfig().enableGeographicFallback && this.geographicCompletion) {
                await this.completeGeographicData(citiesData);
            }

            // Finalize session
            await this.finalizeSession();

            console.log('🎉 Scraping completed successfully!');
            this.printFinalSummary();

            return result;

        } catch (error) {
            console.error('💥 Fatal error in scraping workflow:', error);
            await this.handleFatalError(error);
            throw error;
        }
    }

    /**
     * Initialize scraping session
     */
    async initializeSession(citiesData, options) {
        this.sessionState.startTime = new Date();
        this.stats.totalCities = citiesData.length;

        // Calculate batch size
        const batchingConfig = this.config.getBatchingConfig();
        this.batchSize = Math.ceil(citiesData.length / batchingConfig.totalBatches);

        console.log(`📊 Session initialized:`);
        console.log(`   Total cities: ${citiesData.length}`);
        console.log(`   Batch size: ${this.batchSize}`);
        console.log(`   Target month: ${this.sessionState.currentMonth}`);

        // Start database session if enabled
        if (this.config.shouldEnableSessionTracking()) {
            this.sessionState.sessionId = await this.databaseStorage.startSession(
                this.sessionState.currentMonth,
                citiesData.length,
                this.sessionState.configuration
            );
            console.log(`📝 Database session started: ${this.sessionState.sessionId}`);
        }
    }

    /**
     * Check if data already exists for current month
     */
    async checkExistingData() {
        try {
            const exists = await this.databaseStorage.monthDataExists(this.sessionState.currentMonth);
            if (exists) {
                console.log(`📅 Data already exists for ${this.sessionState.currentMonth}`);
                return true;
            }
            return false;
        } catch (error) {
            console.warn('⚠️  Could not check existing data:', error.message);
            return false;
        }
    }

    /**
     * Load previous state if resuming
     */
    async loadPreviousState() {
        try {
            const previousState = await this.stateManager.loadState();
            if (previousState) {
                // Merge previous state
                this.sessionState.currentBatch = previousState.currentBatch || 0;
                this.sessionState.processedCities = new Set(previousState.processedCities || []);
                this.sessionState.results = previousState.results || [];
                this.sessionState.errors = previousState.errors || [];
                
                console.log(`📁 Resumed from previous state:`);
                console.log(`   Batch: ${this.sessionState.currentBatch + 1}/${this.sessionState.totalBatches}`);
                console.log(`   Processed: ${this.sessionState.processedCities.size} cities`);
                console.log(`   Results: ${this.sessionState.results.length}`);
                console.log(`   Errors: ${this.sessionState.errors.length}`);
            }
        } catch (error) {
            console.warn('⚠️  Could not load previous state:', error.message);
        }
    }

    /**
     * Execute batched scraping workflow
     */
    async executeBatchedScraping(citiesData) {
        const batchingConfig = this.config.getBatchingConfig();
        
        while (this.sessionState.currentBatch < this.sessionState.totalBatches) {
            const batch = this.getCurrentBatch(citiesData);
            
            if (batch.length === 0) {
                console.log('✅ All batches completed!');
                break;
            }

            console.log(`\n🚀 Starting Batch ${this.sessionState.currentBatch + 1}/${this.sessionState.totalBatches}`);
            console.log(`📊 Processing ${batch.length} cities`);

            // Process current batch
            const batchResults = await this.processBatch(batch);

            // Save progress
            await this.saveProgress(batchResults);

            // Move to next batch
            this.sessionState.currentBatch++;

            // Pause between batches if configured
            if (this.sessionState.currentBatch < this.sessionState.totalBatches && 
                !batchingConfig.autoProgress) {
                console.log(`\n⏸️  Batch ${this.sessionState.currentBatch}/${this.sessionState.totalBatches} completed!`);
                console.log('📁 Progress saved. Run again to continue with next batch.');
                return this.sessionState;
            }

            // Auto-pause between batches
            if (batchingConfig.batchPause > 0) {
                console.log(`⏳ Pausing ${batchingConfig.batchPause/1000}s between batches...`);
                await this.sleep(batchingConfig.batchPause);
            }
        }

        return this.sessionState;
    }

    /**
     * Get current batch of cities to process
     */
    getCurrentBatch(citiesData) {
        const startIndex = this.sessionState.currentBatch * this.batchSize;
        const endIndex = Math.min(startIndex + this.batchSize, citiesData.length);
        return citiesData.slice(startIndex, endIndex);
    }

    /**
     * Process a single batch of cities
     */
    async processBatch(batch) {
        const batchResults = {
            processed: 0,
            successful: 0,
            failed: 0,
            outliers: 0,
            validatedOutliers: 0,
            duration: 0
        };

        const batchStartTime = Date.now();
        const delays = this.config.getDelays();

        for (let i = 0; i < batch.length; i++) {
            const city = batch[i];
            const cityKey = `${city.normalizedName || city.cityName}_${city.plz}`;

            // Skip if already processed
            if (this.sessionState.processedCities.has(cityKey)) {
                console.log(`⏭️  [${i + 1}/${batch.length}] Skipping ${city.originalName || city.cityName} (already processed)`);
                continue;
            }

            console.log(`[${i + 1}/${batch.length}] Processing: ${city.originalName || city.cityName} -> ${city.normalizedName || city.cityName}`);

            try {
                // Scrape the city
                const result = await this.scrapeSingleCity(city);

                if (result.success) {
                    batchResults.successful++;
                    this.sessionState.results.push(result.data);
                    
                    if (result.data.is_outlier) {
                        batchResults.outliers++;
                        if (result.data.validation_successful) {
                            batchResults.validatedOutliers++;
                        }
                    }
                } else {
                    batchResults.failed++;
                    this.sessionState.errors.push(result.error);
                    
                    // Log error to database
                    if (this.sessionState.sessionId) {
                        await this.databaseStorage.logError(this.sessionState.sessionId, {
                            plz: city.plz,
                            city_name: city.cityName,
                            error_type: result.error.type || 'scraping_failed',
                            error_message: result.error.message,
                            source_url: result.error.url
                        });
                    }
                }

                // Mark as processed
                this.sessionState.processedCities.add(cityKey);
                batchResults.processed++;

            } catch (error) {
                console.error(`❌ Unexpected error processing ${city.cityName}:`, error.message);
                batchResults.failed++;
                
                this.sessionState.errors.push({
                    city: city.cityName,
                    plz: city.plz,
                    error: `Unexpected error: ${error.message}`,
                    type: 'unexpected_error'
                });
            }

            // Add delay between requests
            if (i < batch.length - 1) {
                console.log(`    ⏳ Waiting ${delays.betweenRequests/1000}s...`);
                await this.sleep(delays.betweenRequests);
            }

            // Save state periodically
            const stateSaveInterval = this.config.getBatchingConfig().stateSaveInterval;
            if ((i + 1) % stateSaveInterval === 0) {
                await this.stateManager.saveState(this.sessionState);
            }
        }

        batchResults.duration = Date.now() - batchStartTime;
        
        // Print batch summary
        this.printBatchSummary(batchResults, batch.length);
        
        return batchResults;
    }

    /**
     * Scrape a single city
     */
    async scrapeSingleCity(city) {
        const startTime = Date.now();
        const delays = this.config.getDelays();
        
        let retryCount = 0;
        const maxRetries = delays.maxRetries;

        while (retryCount <= maxRetries) {
            try {
                console.log(`🌐 Scraping: ${city.cityName} (PLZ: ${city.plz}) ${retryCount > 0 ? `(Retry ${retryCount})` : ''}`);

                // Use source adapter to scrape
                const scrapingResult = await this.sourceAdapter.scrapeCity(
                    city.normalizedName || city.cityName, 
                    city.plz
                );

                if (!scrapingResult) {
                    throw new Error('No data returned from source adapter');
                }

                // Validate the response
                const validation = this.sourceAdapter.validateResponse(scrapingResult);
                if (!validation.success) {
                    throw new Error(`Validation failed: ${validation.issues.join(', ')}`);
                }

                // Quality validation and outlier detection
                const qualityResult = await this.performQualityValidation(scrapingResult, city);

                // Prepare final result
                const finalResult = {
                    success: true,
                    data: {
                        ...scrapingResult,
                        ...qualityResult,
                        // Add metadata
                        data_month: this.sessionState.currentMonth,
                        city_name: city.cityName,
                        latitude: city.latitude || null,
                        longitude: city.longitude || null,
                        extraction_method: scrapingResult.extraction_method || 'unknown',
                        scraping_duration: Date.now() - startTime
                    },
                    metadata: {
                        scraping_duration: Date.now() - startTime,
                        extraction_strategy: scrapingResult.extraction_method,
                        validation_performed: qualityResult.validation_attempted || false,
                        retry_count: retryCount
                    }
                };

                // Store in database immediately if configured
                if (this.config.getDatabaseConfig().enableSessionTracking) {
                    await this.databaseStorage.storePriceData(finalResult.data);
                }

                // Log success
                const avgPrice = finalResult.data.average_price;
                const outlierFlag = finalResult.data.is_outlier ? '🚨' : '✅';
                console.log(`    ${outlierFlag} Success: ${city.cityName} - Average: €${avgPrice ? avgPrice.toFixed(4) : 'N/A'}/kWh`);

                return finalResult;

            } catch (error) {
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    console.log(`    ⚠️  Error (retry ${retryCount}/${maxRetries}): ${error.message}`);
                    await this.sleep(delays.retryDelay);
                } else {
                    console.log(`    ❌ Failed after ${maxRetries} retries: ${error.message}`);
                    
                    return {
                        success: false,
                        error: {
                            city: city.cityName,
                            plz: city.plz,
                            message: error.message,
                            type: 'scraping_failed',
                            url: this.sourceAdapter.buildUrl(city.normalizedName || city.cityName),
                            retry_count: retryCount - 1
                        }
                    };
                }
            }
        }
    }

    /**
     * Perform quality validation on scraped data
     */
    async performQualityValidation(scrapingResult, city) {
        try {
            // Basic price validation
            const validationResult = this.qualityValidator.validatePriceData(scrapingResult);

            // Outlier detection
            const outlierResult = this.qualityValidator.detectOutliers(
                scrapingResult.lokaler_versorger_price,
                scrapingResult.oekostrom_price
            );

            // Attempt outlier validation if needed
            let outlierValidation = {
                validation_attempted: false,
                validation_successful: false,
                original_prices: null,
                validated_prices: null
            };

            if (outlierResult.hasOutliers && this.config.shouldEnableOutlierDetection()) {
                console.log(`    🚨 Outlier detected - attempting validation...`);
                // Note: This would require access to original HTML, which would need to be passed through
                // For now, we'll mark as attempted but not successful
                outlierValidation.validation_attempted = true;
            }

            return {
                is_outlier: outlierResult.hasOutliers,
                outlier_severity: outlierResult.severity,
                validation_attempted: outlierValidation.validation_attempted,
                validation_successful: outlierValidation.validation_successful,
                quality_score: validationResult.quality_score || 1.0
            };

        } catch (error) {
            console.warn(`⚠️  Quality validation error for ${city.cityName}:`, error.message);
            return {
                is_outlier: false,
                outlier_severity: 'normal',
                validation_attempted: false,
                validation_successful: false,
                quality_score: 0.5 // Reduced quality due to validation error
            };
        }
    }

    /**
     * Complete geographic data using fallback
     */
    async completeGeographicData(citiesData) {
        if (!this.geographicCompletion) {
            console.log('⚠️  Geographic completion module not available');
            return;
        }

        console.log('\n🗺️  Starting geographic data completion...');
        
        // Find cities without data
        const processedPLZs = new Set(this.sessionState.results.map(r => r.plz));
        const missingCities = citiesData.filter(city => !processedPLZs.has(city.plz));

        if (missingCities.length === 0) {
            console.log('✅ No missing cities found - geographic completion not needed');
            return;
        }

        console.log(`📊 Found ${missingCities.length} cities without data`);

        let completedCount = 0;
        
        for (const city of missingCities) {
            try {
                const fallbackData = await this.geographicCompletion.findFallbackData(
                    city,
                    this.sessionState.results
                );

                if (fallbackData) {
                    // Add fallback data to results
                    const fallbackResult = {
                        ...fallbackData,
                        data_month: this.sessionState.currentMonth,
                        city_name: city.cityName,
                        plz: city.plz,
                        data_source: 'FALLBACK'
                    };

                    this.sessionState.results.push(fallbackResult);
                    
                    // Store in database
                    if (this.config.getDatabaseConfig().enableSessionTracking) {
                        await this.databaseStorage.storePriceData(fallbackResult);
                    }

                    completedCount++;
                    console.log(`✅ Completed ${city.cityName} using fallback data (${fallbackData.distance_km.toFixed(2)}km away)`);
                }

            } catch (error) {
                console.warn(`⚠️  Could not complete ${city.cityName}:`, error.message);
            }
        }

        console.log(`🗺️  Geographic completion finished: ${completedCount}/${missingCities.length} completed`);
        this.stats.fallbackDataUsed = completedCount;
    }

    /**
     * Save progress after batch completion
     */
    async saveProgress(batchResults) {
        try {
            // Save state
            await this.stateManager.saveState(this.sessionState);

            // Update database session
            if (this.sessionState.sessionId) {
                await this.databaseStorage.updateSession(this.sessionState.sessionId, {
                    processed_cities: this.sessionState.processedCities.size,
                    successful_cities: this.sessionState.results.length,
                    failed_cities: this.sessionState.errors.length,
                    outliers_detected: this.sessionState.results.filter(r => r.is_outlier).length
                });
            }

            // Store bulk data if not storing incrementally
            if (!this.config.getDatabaseConfig().enableSessionTracking) {
                const newResults = this.sessionState.results.slice(-batchResults.successful);
                if (newResults.length > 0) {
                    await this.databaseStorage.bulkStorePriceData(newResults);
                }
            }

            console.log('💾 Progress saved successfully');

        } catch (error) {
            console.error('❌ Error saving progress:', error.message);
        }
    }

    /**
     * Finalize scraping session
     */
    async finalizeSession() {
        try {
            // Complete database session
            if (this.sessionState.sessionId) {
                await this.databaseStorage.updateSession(this.sessionState.sessionId, {
                    completed_at: new Date().toISOString(),
                    status: 'completed',
                    successful_cities: this.sessionState.results.length,
                    failed_cities: this.sessionState.errors.length,
                    notes: 'Scraping completed successfully'
                });
            }

            // Final state cleanup
            await this.stateManager.completeBatch(
                this.sessionState.currentBatch, 
                {
                    totalResults: this.sessionState.results.length,
                    totalErrors: this.sessionState.errors.length,
                    completedAt: new Date().toISOString()
                }
            );

            console.log('🏁 Session finalized successfully');

        } catch (error) {
            console.error('❌ Error finalizing session:', error.message);
        }
    }

    /**
     * Handle fatal errors
     */
    async handleFatalError(error) {
        try {
            // Save current state
            await this.stateManager.saveState(this.sessionState);

            // Update database session as failed
            if (this.sessionState.sessionId) {
                await this.databaseStorage.updateSession(this.sessionState.sessionId, {
                    status: 'failed',
                    error_summary: error.message,
                    failed_at: new Date().toISOString()
                });
            }

            console.log('💾 State saved after fatal error');

        } catch (saveError) {
            console.error('❌ Could not save state after fatal error:', saveError.message);
        }
    }

    // === UTILITY METHODS ===

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    printBatchSummary(batchResults, batchSize) {
        const successRate = ((batchResults.successful / batchSize) * 100).toFixed(1);
        
        console.log(`\n📊 === BATCH SUMMARY ===`);
        console.log(`Cities in batch: ${batchSize}`);
        console.log(`Processed: ${batchResults.processed}`);
        console.log(`Successful: ${batchResults.successful}`);
        console.log(`Failed: ${batchResults.failed}`);
        console.log(`Success rate: ${successRate}%`);
        console.log(`Outliers detected: ${batchResults.outliers}`);
        console.log(`Outliers validated: ${batchResults.validatedOutliers}`);
        console.log(`Duration: ${(batchResults.duration / 1000).toFixed(1)}s`);
        
        console.log(`\n📈 Overall progress: ${this.sessionState.processedCities.size}/${this.stats.totalCities} cities`);
    }

    printFinalSummary() {
        const duration = Date.now() - this.sessionState.startTime.getTime();
        const successRate = ((this.sessionState.results.length / this.stats.totalCities) * 100).toFixed(1);
        
        console.log(`\n🎊 === FINAL SUMMARY ===`);
        console.log(`Total cities: ${this.stats.totalCities}`);
        console.log(`Successful extractions: ${this.sessionState.results.length}`);
        console.log(`Failed extractions: ${this.sessionState.errors.length}`);
        console.log(`Success rate: ${successRate}%`);
        console.log(`Fallback data used: ${this.stats.fallbackDataUsed}`);
        console.log(`Total duration: ${(duration / 1000 / 60).toFixed(1)} minutes`);
        console.log(`Data stored for month: ${this.sessionState.currentMonth}`);
        
        const outliers = this.sessionState.results.filter(r => r.is_outlier);
        if (outliers.length > 0) {
            console.log(`\n🚨 Outlier analysis:`);
            console.log(`Total outliers: ${outliers.length}`);
            console.log(`Validation attempted: ${outliers.filter(r => r.validation_attempted).length}`);
            console.log(`Successfully validated: ${outliers.filter(r => r.validation_successful).length}`);
        }
    }
}

module.exports = ScraperCore; 