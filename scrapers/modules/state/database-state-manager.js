/**
 * Database State Manager
 * Implements IStateManager interface using database for state persistence
 */

const { IStateManager } = require('../interfaces');

class DatabaseStateManager extends IStateManager {
    constructor(config, databaseStorage) {
        super(config);
        this.db = databaseStorage;
        this.batchingConfig = config.getBatchingConfig();
        this.currentState = null;
        this.stateKey = 'modular_scraper_state';
    }

    /**
     * Load previous state if exists
     */
    async loadState() {
        try {
            // For now, we'll use a simple approach - check if there's an incomplete session
            // In a full implementation, we could store state in a separate state table
            
            // Check for any recent incomplete sessions
            const recentSessions = await this.findRecentIncompleteSessions();
            
            if (recentSessions && recentSessions.length > 0) {
                const lastSession = recentSessions[0];
                
                // Try to reconstruct state from session data
                const reconstructedState = await this.reconstructStateFromSession(lastSession);
                
                if (reconstructedState) {
                    this.currentState = reconstructedState;
                    console.log(`📁 Loaded state from session ${lastSession.id}`);
                    return reconstructedState;
                }
            }

            console.log('📁 No previous state found - starting fresh');
            return null;

        } catch (error) {
            console.warn('⚠️  Error loading previous state:', error.message);
            return null;
        }
    }

    /**
     * Save current state
     */
    async saveState(state) {
        try {
            this.currentState = state;
            
            // Update the database session with current progress
            if (state.sessionId) {
                const updates = {
                    processed_cities: state.processedCities.size,
                    successful_cities: state.results.length,
                    failed_cities: state.errors.length,
                    notes: `Batch ${state.currentBatch + 1}/${state.totalBatches} - ${state.processedCities.size} cities processed`
                };

                await this.db.updateSession(state.sessionId, updates);
                
                if (this.config.shouldEnableDetailedLogging()) {
                    console.log(`💾 State saved - Session ${state.sessionId}`);
                }
            }

            // Also store state metadata for easier recovery
            await this.storeStateMetadata(state);

        } catch (error) {
            console.error('❌ Error saving state:', error.message);
            throw error;
        }
    }

    /**
     * Get current batch information
     */
    getCurrentBatch(allCities, currentBatch) {
        const batchSize = Math.ceil(allCities.length / this.batchingConfig.totalBatches);
        const startIndex = currentBatch * batchSize;
        const endIndex = Math.min(startIndex + batchSize, allCities.length);
        
        return {
            batchNumber: currentBatch + 1,
            totalBatches: this.batchingConfig.totalBatches,
            batchSize: batchSize,
            startIndex: startIndex,
            endIndex: endIndex,
            cities: allCities.slice(startIndex, endIndex),
            remainingBatches: this.batchingConfig.totalBatches - currentBatch - 1,
            progress: {
                currentBatch: currentBatch + 1,
                totalBatches: this.batchingConfig.totalBatches,
                percentage: ((currentBatch + 1) / this.batchingConfig.totalBatches * 100).toFixed(1)
            }
        };
    }

    /**
     * Mark batch as completed
     */
    async completeBatch(batchNumber, batchResults) {
        try {
            // Update session with batch completion info
            if (this.currentState && this.currentState.sessionId) {
                const updates = {
                    processed_cities: this.currentState.processedCities.size,
                    successful_cities: this.currentState.results.length,
                    failed_cities: this.currentState.errors.length,
                    notes: `Completed batch ${batchNumber}/${this.batchingConfig.totalBatches}. ` +
                           `Results: ${batchResults.totalResults || 0}, Errors: ${batchResults.totalErrors || 0}`
                };

                await this.db.updateSession(this.currentState.sessionId, updates);
            }

            // Store batch completion metadata
            await this.storeBatchMetadata(batchNumber, batchResults);

            console.log(`✅ Batch ${batchNumber} marked as completed`);

        } catch (error) {
            console.error(`❌ Error marking batch ${batchNumber} as completed:`, error.message);
        }
    }

    /**
     * Reset all state (start fresh)
     */
    async resetState() {
        try {
            // Mark any active sessions as cancelled
            if (this.currentState && this.currentState.sessionId) {
                await this.db.updateSession(this.currentState.sessionId, {
                    status: 'cancelled',
                    notes: 'Session cancelled - state reset requested'
                });
            }

            // Clear current state
            this.currentState = null;

            // Remove state metadata
            await this.clearStateMetadata();

            console.log('♻️  State reset successfully');

        } catch (error) {
            console.error('❌ Error resetting state:', error.message);
            throw error;
        }
    }

    /**
     * Find recent incomplete sessions
     */
    async findRecentIncompleteSessions() {
        try {
            // This would require a custom query to find recent incomplete sessions
            // For now, we'll return null and let the system start fresh
            // In a full implementation, we could add methods to the database client
            // to query sessions by status and date
            
            return null;

        } catch (error) {
            console.warn('⚠️  Error finding recent incomplete sessions:', error.message);
            return null;
        }
    }

    /**
     * Reconstruct state from database session
     */
    async reconstructStateFromSession(session) {
        try {
            // Try to reconstruct the scraping state from session data
            // This is a simplified reconstruction - in a full implementation,
            // we might store more detailed state information
            
            const reconstructedState = {
                sessionId: session.id,
                currentBatch: this.estimateBatchFromProgress(session),
                totalBatches: this.batchingConfig.totalBatches,
                processedCities: new Set(), // Would need to query database for actual processed cities
                results: [], // Would need to query database for actual results
                errors: [], // Would need to query database for actual errors
                startTime: new Date(session.started_at),
                currentMonth: session.data_month,
                configuration: session.scraper_config || {}
            };

            return reconstructedState;

        } catch (error) {
            console.warn('⚠️  Error reconstructing state from session:', error.message);
            return null;
        }
    }

    /**
     * Estimate current batch from session progress
     */
    estimateBatchFromProgress(session) {
        if (!session.total_cities || !session.processed_cities) {
            return 0;
        }

        const progressRatio = session.processed_cities / session.total_cities;
        const estimatedBatch = Math.floor(progressRatio * this.batchingConfig.totalBatches);
        
        return Math.max(0, Math.min(estimatedBatch, this.batchingConfig.totalBatches - 1));
    }

    /**
     * Store state metadata for recovery
     */
    async storeStateMetadata(state) {
        try {
            // Store minimal state metadata as JSON in session notes or config
            const metadata = {
                currentBatch: state.currentBatch,
                totalBatches: state.totalBatches,
                processedCount: state.processedCities.size,
                resultsCount: state.results.length,
                errorsCount: state.errors.length,
                lastUpdated: new Date().toISOString()
            };

            // Update session with metadata
            if (state.sessionId) {
                await this.db.updateSession(state.sessionId, {
                    scraper_config: {
                        ...state.configuration,
                        stateMetadata: metadata
                    }
                });
            }

        } catch (error) {
            console.warn('⚠️  Error storing state metadata:', error.message);
        }
    }

    /**
     * Store batch completion metadata
     */
    async storeBatchMetadata(batchNumber, batchResults) {
        try {
            // Log batch completion as a note in the session
            if (this.currentState && this.currentState.sessionId) {
                const batchNote = `Batch ${batchNumber} completed: ${JSON.stringify(batchResults)}`;
                
                // In a full implementation, we might have a separate batch tracking table
                // For now, we'll just update the session notes
                const existingSession = await this.db.getCurrentSession();
                const updatedNotes = (existingSession?.notes || '') + '\n' + batchNote;
                
                await this.db.updateSession(this.currentState.sessionId, {
                    notes: updatedNotes.trim()
                });
            }

        } catch (error) {
            console.warn('⚠️  Error storing batch metadata:', error.message);
        }
    }

    /**
     * Clear state metadata
     */
    async clearStateMetadata() {
        try {
            // Clear any stored state metadata
            // In this implementation, the state is primarily stored in sessions,
            // so clearing involves marking sessions as completed/cancelled
            
            console.log('🧹 State metadata cleared');

        } catch (error) {
            console.warn('⚠️  Error clearing state metadata:', error.message);
        }
    }

    /**
     * Get current state information
     */
    getCurrentState() {
        return this.currentState;
    }

    /**
     * Check if state exists
     */
    hasState() {
        return !!this.currentState;
    }

    /**
     * Get state recovery information
     */
    getStateRecoveryInfo() {
        if (!this.currentState) {
            return {
                hasRecoverableState: false,
                message: 'No state to recover'
            };
        }

        return {
            hasRecoverableState: true,
            sessionId: this.currentState.sessionId,
            currentBatch: this.currentState.currentBatch + 1,
            totalBatches: this.currentState.totalBatches,
            processedCities: this.currentState.processedCities.size,
            results: this.currentState.results.length,
            errors: this.currentState.errors.length,
            canResume: this.currentState.currentBatch < this.currentState.totalBatches,
            estimatedCompletion: this.calculateEstimatedCompletion()
        };
    }

    /**
     * Calculate estimated completion time
     */
    calculateEstimatedCompletion() {
        if (!this.currentState || !this.currentState.startTime) {
            return 'Unknown';
        }

        const elapsed = Date.now() - this.currentState.startTime.getTime();
        const progress = (this.currentState.currentBatch + 1) / this.currentState.totalBatches;
        
        if (progress <= 0) return 'Unknown';
        
        const estimatedTotal = elapsed / progress;
        const remaining = estimatedTotal - elapsed;
        
        if (remaining <= 0) return 'Nearly complete';
        
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `~${hours}h ${minutes}m remaining`;
        } else {
            return `~${minutes}m remaining`;
        }
    }

    /**
     * Validate state consistency
     */
    validateState(state) {
        const validation = {
            valid: true,
            issues: []
        };

        if (!state) {
            validation.valid = false;
            validation.issues.push('No state provided');
            return validation;
        }

        // Check required fields
        const requiredFields = ['currentBatch', 'totalBatches', 'processedCities', 'results', 'errors'];
        for (const field of requiredFields) {
            if (!state.hasOwnProperty(field)) {
                validation.valid = false;
                validation.issues.push(`Missing required field: ${field}`);
            }
        }

        // Check batch bounds
        if (state.currentBatch < 0 || state.currentBatch >= state.totalBatches) {
            validation.valid = false;
            validation.issues.push(`Current batch ${state.currentBatch} out of bounds (0-${state.totalBatches - 1})`);
        }

        // Check data consistency
        if (state.processedCities && state.results && 
            state.processedCities.size < state.results.length) {
            validation.issues.push('Processed cities count is less than results count');
        }

        return validation;
    }

    /**
     * Get state manager statistics
     */
    getStatistics() {
        return {
            stateKey: this.stateKey,
            hasCurrentState: !!this.currentState,
            batchingEnabled: this.batchingConfig.enabled,
            totalBatches: this.batchingConfig.totalBatches,
            stateSaveInterval: this.batchingConfig.stateSaveInterval,
            currentState: this.currentState ? {
                sessionId: this.currentState.sessionId,
                currentBatch: this.currentState.currentBatch,
                totalBatches: this.currentState.totalBatches,
                progress: `${this.currentState.currentBatch + 1}/${this.currentState.totalBatches}`
            } : null
        };
    }
}

module.exports = DatabaseStateManager; 