/**
 * Supabase Database Storage Module
 * Implements IDatabaseStorage interface for Supabase operations
 */

const { IDatabaseStorage } = require('../interfaces');
const SupabaseClient = require('../../../database/supabase-client');

class SupabaseStorage extends IDatabaseStorage {
    constructor(config) {
        super(config);
        this.db = new SupabaseClient();
        this.currentSession = null;
        
        // NEW: Batch optimization properties
        this.batchConfig = config.getDatabaseConfig().batchingOptimizations || {};
        this.pendingResults = [];
        this.pendingErrors = [];
        this.existingPLZsCache = new Set();
        this.batchCacheInitialized = false;
        
        console.log('📊 Database storage initialized with batch optimizations:', {
            batchStorage: this.batchConfig.enableBatchStorage || false,
            batchSize: this.batchConfig.batchStorageSize || 100,
            bulkDuplicateCheck: this.batchConfig.enableBulkDuplicateCheck || false
        });
    }

    /**
     * Initialize bulk duplicate checking cache for the month
     */
    async initializeBulkDuplicateCache(month) {
        if (!this.batchConfig.enableBulkDuplicateCheck || this.batchCacheInitialized) {
            return;
        }

        try {
            console.log(`🔍 Initializing bulk duplicate cache for ${month}...`);
            this.existingPLZsCache = await this.db.getExistingPLZsForMonth(month);
            this.batchCacheInitialized = true;
            
            console.log(`✅ Bulk duplicate cache initialized: ${this.existingPLZsCache.size} existing PLZs found`);
        } catch (error) {
            console.error('❌ Error initializing bulk duplicate cache:', error.message);
            this.existingPLZsCache = new Set(); // Fallback to empty set
        }
    }

    /**
     * Check if PLZ exists using bulk cache (optimization)
     */
    isDuplicateOptimized(plz) {
        if (this.batchConfig.enableBulkDuplicateCheck && this.batchCacheInitialized) {
            return this.existingPLZsCache.has(plz);
        }
        return false; // Fallback to individual checking
    }

    /**
     * Add result to pending batch for storage
     */
    addToPendingBatch(priceData) {
        if (!this.batchConfig.enableBatchStorage) {
            return false; // Not using batch storage
        }

        this.pendingResults.push(priceData);
        
        // Check if we should flush the batch
        if (this.pendingResults.length >= (this.batchConfig.batchStorageSize || 100)) {
            return true; // Signal that batch should be flushed
        }
        
        return false;
    }

    /**
     * Flush pending results batch to database
     */
    async flushPendingBatch() {
        if (this.pendingResults.length === 0) {
            return [];
        }

        try {
            console.log(`📊 Flushing batch: ${this.pendingResults.length} results...`);
            
            const results = await this.bulkStorePriceData([...this.pendingResults]);
            
            // Update cache with newly stored PLZs
            if (this.batchCacheInitialized) {
                this.pendingResults.forEach(item => {
                    this.existingPLZsCache.add(item.plz);
                });
            }
            
            this.pendingResults = []; // Clear the batch
            console.log(`✅ Batch flushed successfully: ${results.length} records stored`);
            
            return results;
        } catch (error) {
            console.error('❌ Error flushing pending batch:', error.message);
            throw error;
        }
    }

    /**
     * Add error to pending batch for logging
     */
    addErrorToPendingBatch(errorData) {
        if (!this.batchConfig.enableBatchErrorLogging) {
            return false;
        }

        this.pendingErrors.push(errorData);
        
        // Check if we should flush the error batch
        if (this.pendingErrors.length >= (this.batchConfig.batchErrorSize || 50)) {
            return true;
        }
        
        return false;
    }

    /**
     * Flush pending errors batch to database
     */
    async flushPendingErrors(sessionId) {
        if (this.pendingErrors.length === 0) {
            return [];
        }

        try {
            console.log(`📝 Flushing error batch: ${this.pendingErrors.length} errors...`);
            
            const results = [];
            for (const errorData of this.pendingErrors) {
                const result = await this.logError(sessionId, errorData);
                results.push(result);
            }
            
            this.pendingErrors = []; // Clear the batch
            console.log(`✅ Error batch flushed: ${results.length} errors logged`);
            
            return results;
        } catch (error) {
            console.error('❌ Error flushing pending errors:', error.message);
            throw error;
        }
    }

    /**
     * Store scraped price data
     */
    async storePriceData(priceData) {
        try {
            // Ensure data includes month
            const dataWithMonth = {
                ...priceData,
                data_month: priceData.data_month || this.config.getCurrentMonth()
            };

            // Initialize bulk cache if not done yet
            if (!this.batchCacheInitialized) {
                await this.initializeBulkDuplicateCache(dataWithMonth.data_month);
            }

            // Check for duplicates using optimized bulk cache or individual check
            const duplicateHandling = this.config.getDatabaseConfig().duplicateHandling;
            
            if (duplicateHandling === 'skip') {
                let isDuplicate = false;
                
                if (this.batchConfig.enableBulkDuplicateCheck) {
                    // Use optimized bulk cache
                    isDuplicate = this.isDuplicateOptimized(dataWithMonth.plz);
                } else {
                    // Fall back to individual check
                    isDuplicate = await this.db.dataExists(dataWithMonth.data_month, dataWithMonth.plz);
                }
                
                if (isDuplicate) {
                    console.log(`⏭️  Skipping duplicate data for PLZ ${dataWithMonth.plz}`);
                    return { skipped: true, plz: dataWithMonth.plz };
                }
            }

            // Use batch storage if enabled, otherwise store immediately
            if (this.batchConfig.enableBatchStorage) {
                const shouldFlush = this.addToPendingBatch(dataWithMonth);
                
                if (shouldFlush) {
                    // Batch is full, flush it
                    const results = await this.flushPendingBatch();
                    
                    if (this.config.shouldEnableDetailedLogging()) {
                        console.log(`💾 Batch stored: ${results.length} records including ${dataWithMonth.city_name} (${dataWithMonth.plz})`);
                    }
                    
                    return { batched: true, batchSize: results.length, plz: dataWithMonth.plz };
                } else {
                    // Added to batch, waiting for more
                    if (this.config.shouldEnableDetailedLogging()) {
                        console.log(`📦 Added to batch: ${dataWithMonth.city_name} (${dataWithMonth.plz}) - ${this.pendingResults.length}/${this.batchConfig.batchStorageSize}`);
                    }
                    
                    return { batched: true, pending: true, plz: dataWithMonth.plz };
                }
            } else {
                // Store immediately (original behavior)
                const result = await this.db.insertPriceData(dataWithMonth);
                
                if (this.config.shouldEnableDetailedLogging()) {
                    console.log(`💾 Stored data for ${dataWithMonth.city_name} (${dataWithMonth.plz})`);
                }

                return result;
            }

        } catch (error) {
            console.error(`❌ Error storing price data for PLZ ${priceData.plz}:`, error.message);
            throw error;
        }
    }

    /**
     * Bulk store multiple price records
     */
    async bulkStorePriceData(priceDataArray) {
        try {
            const batchSize = this.config.getDatabaseConfig().batchSize;
            const currentMonth = this.config.getCurrentMonth();
            
            // Prepare data with month
            const dataWithMonth = priceDataArray.map(item => ({
                ...item,
                data_month: item.data_month || currentMonth
            }));

            // Filter out duplicates if configured (but skip if we're already using bulk optimization)
            const duplicateHandling = this.config.getDatabaseConfig().duplicateHandling;
            let finalData = dataWithMonth;

            if (duplicateHandling === 'skip' && !this.batchConfig.enableBulkDuplicateCheck) {
                // Only do individual duplicate checking if bulk optimization is not enabled
                const filteredData = [];
                for (const item of dataWithMonth) {
                    const exists = await this.db.dataExists(item.data_month, item.plz);
                    if (!exists) {
                        filteredData.push(item);
                    } else {
                        console.log(`⏭️  Skipping duplicate data for PLZ ${item.plz}`);
                    }
                }
                finalData = filteredData;
            } else if (this.batchConfig.enableBulkDuplicateCheck) {
                // With bulk optimization, duplicates are already filtered in storePriceData
                console.log(`📊 Using bulk-optimized data (duplicates pre-filtered)`);
            }

            if (finalData.length === 0) {
                console.log('📊 No new data to store (all duplicates)');
                return [];
            }

            console.log(`📊 Bulk storing ${finalData.length} records...`);
            const results = await this.db.bulkInsertPriceData(finalData, batchSize);
            
            console.log(`✅ Successfully stored ${results.length} records`);
            return results;

        } catch (error) {
            console.error('❌ Error in bulk storage:', error.message);
            throw error;
        }
    }

    /**
     * Check if data exists for a specific month and PLZ
     */
    async dataExists(month, plz) {
        try {
            return await this.db.dataExists(month, plz);
        } catch (error) {
            console.error(`❌ Error checking data existence for ${plz}:`, error.message);
            return false;
        }
    }

    /**
     * Check if any data exists for a specific month
     */
    async monthDataExists(month) {
        try {
            return await this.db.monthDataExists(month);
        } catch (error) {
            console.error(`❌ Error checking month data existence:`, error.message);
            return false;
        }
    }

    /**
     * Start a new scraping session
     */
    async startSession(month, totalCities, config) {
        try {
            const sessionData = {
                data_month: month,
                total_cities: totalCities,
                scraper_config: {
                    ...config,
                    startTime: new Date().toISOString(),
                    version: '2.0-modular'
                }
            };

            this.currentSession = await this.db.startScrapingSession(
                month, 
                totalCities, 
                sessionData.scraper_config
            );

            // Initialize bulk duplicate cache if enabled
            await this.initializeBulkDuplicateCache(month);

            console.log(`📝 Started scraping session ${this.currentSession.id} for ${month}`);
            return this.currentSession.id; // Return just the ID, not the whole object

        } catch (error) {
            console.error('❌ Error starting scraping session:', error.message);
            throw error;
        }
    }

    /**
     * Update scraping session progress
     */
    async updateSession(sessionId, updates) {
        try {
            const result = await this.db.updateScrapingSession(sessionId, updates);
            
            if (this.config.shouldEnableDetailedLogging()) {
                console.log(`📊 Updated session ${sessionId} with:`, updates);
            }

            return result;

        } catch (error) {
            console.error(`❌ Error updating session ${sessionId}:`, error.message);
            throw error;
        }
    }

    /**
     * Complete scraping session
     */
    async completeSession(sessionId, summary = {}) {
        try {
            // Flush any remaining batches before completing
            await this.flushAllPendingBatches(sessionId);

            const completionData = {
                completed_at: new Date().toISOString(),
                status: 'completed',
                notes: 'Scraping completed successfully via modular architecture',
                ...summary
            };

            const result = await this.db.completeScrapingSession(sessionId, completionData);
            
            console.log(`✅ Completed scraping session ${sessionId}`);
            this.currentSession = null;
            
            return result;

        } catch (error) {
            console.error(`❌ Error completing session ${sessionId}:`, error.message);
            throw error;
        }
    }

    /**
     * Mark session as failed
     */
    async failSession(sessionId, errorInfo) {
        try {
            // Flush any remaining batches before failing
            await this.flushAllPendingBatches(sessionId);

            const failureData = {
                status: 'failed',
                error_summary: errorInfo.message || 'Session failed',
                failed_at: new Date().toISOString(),
                notes: `Session failed: ${errorInfo.details || 'Unknown error'}`
            };

            const result = await this.db.updateScrapingSession(sessionId, failureData);
            
            console.log(`❌ Marked session ${sessionId} as failed`);
            this.currentSession = null;
            
            return result;

        } catch (error) {
            console.error(`❌ Error marking session as failed:`, error.message);
            throw error;
        }
    }

    /**
     * Flush all pending batches (results and errors)
     */
    async flushAllPendingBatches(sessionId) {
        try {
            console.log('🔄 Flushing all remaining batches...');
            
            // Flush pending results
            if (this.pendingResults.length > 0) {
                console.log(`📊 Flushing final results batch: ${this.pendingResults.length} records`);
                await this.flushPendingBatch();
            }
            
            // Flush pending errors
            if (this.pendingErrors.length > 0) {
                console.log(`📝 Flushing final errors batch: ${this.pendingErrors.length} errors`);
                await this.flushPendingErrors(sessionId);
            }
            
            console.log('✅ All batches flushed successfully');
            
        } catch (error) {
            console.error('❌ Error flushing pending batches:', error.message);
            // Don't throw - we want to continue with session completion even if flush fails
        }
    }

    /**
     * Force flush pending batches (can be called manually)
     */
    async forceBatchFlush(sessionId) {
        await this.flushAllPendingBatches(sessionId);
    }

    /**
     * Log a scraping error
     */
    async logError(sessionId, errorData) {
        try {
            const errorRecord = {
                session_id: sessionId,
                plz: errorData.plz,
                city_name: errorData.city_name,
                error_type: errorData.error_type || 'unknown',
                error_message: errorData.error_message || errorData.message,
                source_url: errorData.source_url || errorData.url,
                retry_count: errorData.retry_count || 0,
                context_data: {
                    timestamp: new Date().toISOString(),
                    scraper_version: '2.0-modular',
                    ...errorData.context_data
                }
            };

            // Use batch error logging if enabled
            if (this.batchConfig.enableBatchErrorLogging) {
                const shouldFlush = this.addErrorToPendingBatch(errorRecord);
                
                if (shouldFlush) {
                    // Error batch is full, flush it
                    await this.flushPendingErrors(sessionId);
                    
                    if (this.config.shouldEnableDetailedLogging()) {
                        console.log(`📝 Error batch flushed including ${errorRecord.city_name || 'unknown city'}`);
                    }
                }
                
                return { batched: true, pending: !shouldFlush };
            } else {
                // Log immediately (original behavior)
                const result = await this.db.logScrapingError(sessionId, errorRecord);
                
                if (this.config.shouldEnableDetailedLogging()) {
                    console.log(`📝 Logged error for ${errorData.city_name || 'unknown city'}`);
                }

                return result;
            }

        } catch (error) {
            console.error('❌ Error logging scraping error:', error.message);
            throw error;
        }
    }

    /**
     * Get scraping statistics for a session
     */
    async getSessionStats(sessionId) {
        try {
            // This would require additional database queries
            // For now, return basic session info
            return this.currentSession;
        } catch (error) {
            console.error(`❌ Error getting session stats:`, error.message);
            return null;
        }
    }

    /**
     * Get available months with data
     */
    async getAvailableMonths() {
        try {
            return await this.db.getAvailableMonths();
        } catch (error) {
            console.error('❌ Error getting available months:', error.message);
            return [];
        }
    }

    /**
     * Get monthly statistics
     */
    async getMonthlyStats(month) {
        try {
            const [averages, coverage] = await Promise.all([
                this.db.getMonthlyAverages(month),
                this.db.getMonthCoverage(month)
            ]);

            return {
                month,
                averages,
                coverage,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error(`❌ Error getting monthly stats for ${month}:`, error.message);
            return null;
        }
    }

    /**
     * Get price data for specific PLZ and month
     */
    async getPriceData(plz, month) {
        try {
            return await this.db.getPriceData(plz, month);
        } catch (error) {
            console.error(`❌ Error getting price data for ${plz}:`, error.message);
            return null;
        }
    }

    /**
     * Get latest price data for a PLZ
     */
    async getLatestPriceData(plz) {
        try {
            return await this.db.getLatestPriceData(plz);
        } catch (error) {
            console.error(`❌ Error getting latest price data for ${plz}:`, error.message);
            return null;
        }
    }

    /**
     * Test database connection
     */
    async testConnection() {
        try {
            return await this.db.testConnection();
        } catch (error) {
            console.error('❌ Database connection test failed:', error.message);
            return false;
        }
    }

    /**
     * Get current session info
     */
    getCurrentSession() {
        return this.currentSession;
    }

    /**
     * Check if session tracking is enabled
     */
    isSessionTrackingEnabled() {
        return this.config.shouldEnableSessionTracking();
    }

    /**
     * Get database configuration
     */
    getDatabaseConfig() {
        return this.config.getDatabaseConfig();
    }

    /**
     * Close any open connections
     */
    async close() {
        try {
            // Flush any remaining batches before closing
            if (this.currentSession) {
                await this.flushAllPendingBatches(this.currentSession.id);
                
                // Mark any open session as interrupted
                await this.db.updateScrapingSession(this.currentSession.id, {
                    status: 'interrupted',
                    notes: 'Session interrupted - storage module closed'
                });
            }

            console.log('📕 Database storage module closed');
        } catch (error) {
            console.error('❌ Error closing database storage:', error.message);
        }
    }

    /**
     * Get current batch status for monitoring
     */
    getBatchStatus() {
        return {
            batchOptimizationsEnabled: {
                batchStorage: this.batchConfig.enableBatchStorage || false,
                bulkDuplicateCheck: this.batchConfig.enableBulkDuplicateCheck || false,
                batchErrorLogging: this.batchConfig.enableBatchErrorLogging || false
            },
            pendingCounts: {
                results: this.pendingResults.length,
                errors: this.pendingErrors.length
            },
            batchSizes: {
                resultsBatchSize: this.batchConfig.batchStorageSize || 100,
                errorsBatchSize: this.batchConfig.batchErrorSize || 50
            },
            cacheStatus: {
                initialized: this.batchCacheInitialized,
                existingPLZsCount: this.existingPLZsCache.size
            }
        };
    }

    /**
     * Get batch optimization statistics
     */
    getBatchStats() {
        const status = this.getBatchStatus();
        
        return {
            ...status,
            estimatedDbCallsReduced: this.calculateDbCallsReduced(),
            nextFlushThresholds: {
                results: (this.batchConfig.batchStorageSize || 100) - this.pendingResults.length,
                errors: (this.batchConfig.batchErrorSize || 50) - this.pendingErrors.length
            }
        };
    }

    /**
     * Calculate estimated database calls reduced through batching
     */
    calculateDbCallsReduced() {
        const resultBatches = Math.floor((this.pendingResults.length + this.existingPLZsCache.size) / (this.batchConfig.batchStorageSize || 100));
        const errorBatches = Math.floor(this.pendingErrors.length / (this.batchConfig.batchErrorSize || 50));
        
        return {
            duplicateChecksReduced: this.batchCacheInitialized ? this.existingPLZsCache.size : 0,
            resultInsertsReduced: resultBatches * (this.batchConfig.batchStorageSize || 100),
            errorInsertsReduced: errorBatches * (this.batchConfig.batchErrorSize || 50)
        };
    }
}

module.exports = SupabaseStorage; 