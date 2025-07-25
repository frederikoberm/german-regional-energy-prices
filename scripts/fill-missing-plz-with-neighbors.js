#!/usr/bin/env node

/**
 * Fill Missing PLZ Data with Closest Geographic Neighbors
 * 
 * This script:
 * 1. Analyzes scraping error logs to find failed PLZ codes
 * 2. Loads postal code coordinates from CSV
 * 3. Finds successful PLZ entries in database
 * 4. For each failed PLZ, finds the closest successful neighbor
 * 5. Creates fallback database entries using neighbor data
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const SupabaseClient = require('../database/supabase-client');

class PLZNeighborFiller {
    constructor() {
        this.db = new SupabaseClient();
        this.plzCoordinates = new Map(); // PLZ -> {lat, lon, city}
        this.failedPLZs = new Set();
        this.successfulPLZs = new Map(); // PLZ -> full price data
        this.currentMonth = new Date().toISOString().slice(0, 7) + '-01'; // YYYY-MM-01
    }

    /**
     * Calculate distance between two coordinates using Haversine formula
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Load failed PLZ codes from error log files
     */
    async loadFailedPLZs() {
        console.log('📋 Loading failed PLZ codes from log files...');
        const logDir = 'logs';
        
        if (!fs.existsSync(logDir)) {
            console.log('⚠️  No logs directory found');
            return;
        }

        const logFiles = fs.readdirSync(logDir)
            .filter(file => file.startsWith('scraper-errors-') && file.endsWith('.jsonl'))
            .sort()
            .reverse(); // Start with most recent

        let totalErrors = 0;
        
        for (const logFile of logFiles) {
            const logPath = path.join(logDir, logFile);
            console.log(`🔍 Processing ${logFile}...`);
            
            try {
                const logContent = fs.readFileSync(logPath, 'utf8');
                const logLines = logContent.trim().split('\n').filter(line => line.trim());
                
                for (const line of logLines) {
                    try {
                        const logEntry = JSON.parse(line);
                        if (logEntry.plz && logEntry.error_type) {
                            this.failedPLZs.add(logEntry.plz);
                            totalErrors++;
                        }
                    } catch (parseError) {
                        // Skip malformed log lines
                        continue;
                    }
                }
            } catch (fileError) {
                console.warn(`⚠️  Could not read log file ${logFile}:`, fileError.message);
                continue;
            }
        }

        console.log(`✅ Found ${this.failedPLZs.size} unique failed PLZ codes from ${totalErrors} total errors`);
        console.log(`📊 Sample failed PLZs:`, Array.from(this.failedPLZs).slice(0, 10).join(', '));
    }

    /**
     * Load PLZ coordinates from CSV file
     */
    async loadPLZCoordinates() {
        console.log('📍 Loading PLZ coordinates from CSV...');
        
        return new Promise((resolve, reject) => {
            const csvPath = 'utils/Postleitzahlen Deutschland.csv';
            let count = 0;
            
            fs.createReadStream(csvPath)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    try {
                        const plz = row['Postleitzahl / Post code'];
                        const geoPoint = row['geo_point_2d'];
                        const cityName = row['PLZ Name (short)'];
                        
                        if (plz && geoPoint && cityName) {
                            const [lat, lon] = geoPoint.split(', ').map(coord => parseFloat(coord.trim()));
                            
                            if (!isNaN(lat) && !isNaN(lon)) {
                                this.plzCoordinates.set(plz, {
                                    lat: lat,
                                    lon: lon,
                                    city: cityName
                                });
                                count++;
                            }
                        }
                    } catch (error) {
                        // Skip malformed rows
                    }
                })
                .on('end', () => {
                    console.log(`✅ Loaded coordinates for ${count} PLZ codes`);
                    resolve();
                })
                .on('error', reject);
        });
    }

    /**
     * Load successful PLZ data from database
     */
    async loadSuccessfulPLZs() {
        console.log('💾 Loading successful PLZ data from database...');
        
        try {
            // Load ALL PLZ data for the current month (fetch in pages to avoid limit)
            this.existingPLZs = new Set();
            let page = 0;
            const pageSize = 1000;
            let hasMore = true;

            console.log('🔄 Fetching all existing PLZ codes...');
            while (hasMore) {
                const { data: pageData, error: pageError } = await this.db.supabase
                    .from('monthly_electricity_prices')
                    .select('plz')
                    .eq('data_month', this.currentMonth)
                    .range(page * pageSize, (page + 1) * pageSize - 1);

                if (pageError) throw pageError;

                if (pageData.length === 0) {
                    hasMore = false;
                } else {
                    pageData.forEach(record => this.existingPLZs.add(record.plz));
                    page++;
                    console.log(`   📄 Loaded page ${page}: ${pageData.length} PLZs (total so far: ${this.existingPLZs.size})`);
                    
                    if (pageData.length < pageSize) {
                        hasMore = false;
                    }
                }
            }

            // Load only ORIGINAL data for use as source for fallbacks (also paginated)
            page = 0;
            hasMore = true;
            this.successfulPLZs = new Map();

            console.log('🔄 Fetching ORIGINAL PLZ data for fallback source...');
            while (hasMore) {
                const { data: pageData, error: pageError } = await this.db.supabase
                    .from('monthly_electricity_prices')
                    .select('plz, city_name, latitude, longitude, lokaler_versorger_price, oekostrom_price, average_price, data_source')
                    .eq('data_month', this.currentMonth)
                    .eq('data_source', 'ORIGINAL')
                    .not('lokaler_versorger_price', 'is', null)
                    .not('oekostrom_price', 'is', null)
                    .range(page * pageSize, (page + 1) * pageSize - 1);

                if (pageError) throw pageError;

                if (pageData.length === 0) {
                    hasMore = false;
                } else {
                    pageData.forEach(record => this.successfulPLZs.set(record.plz, record));
                    page++;
                    console.log(`   📄 Loaded ORIGINAL page ${page}: ${pageData.length} PLZs (total: ${this.successfulPLZs.size})`);
                    
                    if (pageData.length < pageSize) {
                        hasMore = false;
                    }
                }
            }

            console.log(`✅ Loaded ${this.successfulPLZs.size} successful ORIGINAL PLZ entries from database`);
            console.log(`✅ Found ${this.existingPLZs.size} total existing PLZ entries (including fallbacks)`);
            console.log(`📊 Sample successful PLZs:`, Array.from(this.successfulPLZs.keys()).slice(0, 10).join(', '));
            
        } catch (error) {
            console.error('❌ Error loading successful PLZs:', error.message);
            throw error;
        }
    }

    /**
     * Find closest successful neighbor for a failed PLZ
     */
    findClosestNeighbor(failedPLZ) {
        const failedCoords = this.plzCoordinates.get(failedPLZ);
        if (!failedCoords) {
            return null; // No coordinates available for this PLZ
        }

        let closestPLZ = null;
        let minDistance = Infinity;

        for (const [successfulPLZ, priceData] of this.successfulPLZs) {
            // First try to get coordinates from database
            let successfulCoords = null;
            if (priceData.latitude && priceData.longitude) {
                successfulCoords = {
                    lat: parseFloat(priceData.latitude),
                    lon: parseFloat(priceData.longitude)
                };
            } else {
                // Fallback to CSV coordinates
                successfulCoords = this.plzCoordinates.get(successfulPLZ);
            }

            if (!successfulCoords) continue;

            const distance = this.calculateDistance(
                failedCoords.lat, failedCoords.lon,
                successfulCoords.lat, successfulCoords.lon
            );

            if (distance < minDistance) {
                minDistance = distance;
                closestPLZ = successfulPLZ;
            }
        }

        return closestPLZ ? {
            sourcePLZ: closestPLZ,
            distance: minDistance,
            sourceData: this.successfulPLZs.get(closestPLZ)
        } : null;
    }

    /**
     * Create fallback entries for failed PLZs
     */
    async createFallbackEntries() {
        console.log('🔄 Creating fallback entries for failed PLZs...');
        
        const fallbackEntries = [];
        let processed = 0;
        let skipped = 0;

        for (const failedPLZ of this.failedPLZs) {
            processed++;
            
            // Skip if already exists in database (might be a retry that succeeded or already has fallback)
            if (this.existingPLZs && this.existingPLZs.has(failedPLZ)) {
                skipped++;
                continue;
            }

            const failedCoords = this.plzCoordinates.get(failedPLZ);
            if (!failedCoords) {
                console.log(`⚠️  No coordinates found for PLZ ${failedPLZ}`);
                skipped++;
                continue;
            }

            const neighbor = this.findClosestNeighbor(failedPLZ);
            if (!neighbor) {
                console.log(`⚠️  No neighbor found for PLZ ${failedPLZ}`);
                skipped++;
                continue;
            }

            // Create fallback entry
            const fallbackEntry = {
                data_month: this.currentMonth,
                plz: failedPLZ,
                city_name: failedCoords.city,
                latitude: failedCoords.lat,
                longitude: failedCoords.lon,
                lokaler_versorger_price: neighbor.sourceData.lokaler_versorger_price,
                oekostrom_price: neighbor.sourceData.oekostrom_price,
                average_price: neighbor.sourceData.average_price,
                data_source: 'FALLBACK',
                source_plz: neighbor.sourcePLZ,
                distance_km: Math.round(neighbor.distance * 1000) / 1000, // Round to 3 decimal places
                source_url: `fallback_from_${neighbor.sourcePLZ}`
            };

            fallbackEntries.push(fallbackEntry);

            if (processed % 100 === 0) {
                console.log(`📊 Processed ${processed}/${this.failedPLZs.size} failed PLZs...`);
            }
        }

        console.log(`📋 Created ${fallbackEntries.length} fallback entries (skipped ${skipped})`);

        // Insert fallback entries in batches
        if (fallbackEntries.length > 0) {
            console.log('💾 Inserting fallback entries into database...');
            
            try {
                const results = await this.db.bulkInsertPriceData(fallbackEntries, 100);
                console.log(`✅ Successfully inserted ${results.length} fallback entries`);
                
                // Show some statistics
                const distances = fallbackEntries.map(entry => entry.distance_km);
                const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
                const maxDistance = Math.max(...distances);
                
                console.log(`📊 Distance statistics:`);
                console.log(`   Average distance: ${Math.round(avgDistance * 100) / 100} km`);
                console.log(`   Maximum distance: ${Math.round(maxDistance * 100) / 100} km`);
                
            } catch (error) {
                console.error('❌ Error inserting fallback entries:', error.message);
                throw error;
            }
        }

        return fallbackEntries.length;
    }

    /**
     * Main execution function
     */
    async run() {
        try {
            console.log('🚀 Starting PLZ neighbor filling process...');
            console.log(`📅 Target month: ${this.currentMonth}`);
            
            // Load all required data
            await this.loadFailedPLZs();
            await this.loadPLZCoordinates();
            await this.loadSuccessfulPLZs();
            
            // Create fallback entries
            const createdCount = await this.createFallbackEntries();
            
            console.log('✅ PLZ neighbor filling completed!');
            console.log(`📊 Summary:`);
            console.log(`   Failed PLZs found: ${this.failedPLZs.size}`);
            console.log(`   Successful PLZs available: ${this.successfulPLZs.size}`);
            console.log(`   Fallback entries created: ${createdCount}`);
            
        } catch (error) {
            console.error('❌ Error in PLZ neighbor filling:', error.message);
            throw error;
        } finally {
            await this.db.close?.();
        }
    }
}

// Run the script if called directly
if (require.main === module) {
    const filler = new PLZNeighborFiller();
    filler.run().catch(error => {
        console.error('💥 Script failed:', error);
        process.exit(1);
    });
}

module.exports = PLZNeighborFiller; 