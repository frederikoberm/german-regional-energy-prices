/**
 * Geographic Completion Module
 * Finds fallback data for cities without price information by finding the closest city with data
 */

const fs = require('fs');
const csv = require('csv-parser');
const { IGeographicCompletion } = require('../interfaces');

class GeographicCompletion extends IGeographicCompletion {
    constructor(config) {
        super(config);
        this.allPLZs = [];
        this.loadedPLZs = false;
        this.stats = {
            fallbackDataFound: 0,
            noDataAvailable: 0,
            averageDistance: 0,
            maxDistance: 0,
            minDistance: Infinity
        };
    }

    /**
     * Load PLZ coordinates data if not already loaded
     */
    async loadPLZCoordinates() {
        if (this.loadedPLZs) return;

        const plzFile = this.config.getGeographicConfig().plzCoordinatesFile;
        
        return new Promise((resolve, reject) => {
            const plzs = [];
            
            if (!fs.existsSync(plzFile)) {
                console.warn(`⚠️  PLZ coordinates file not found: ${plzFile}`);
                console.warn(`    Geographic completion will be limited without coordinates`);
                resolve();
                return;
            }

            fs.createReadStream(plzFile)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    const plz = row['Postleitzahl / Post code'] || row.PLZ || row.plz;
                    const cityName = row['PLZ Name (short)'] || row.Name || row.Ort;
                    const geoPoint = row['geo_point_2d'];
                    
                    if (plz && cityName && geoPoint) {
                        const coords = geoPoint.split(',');
                        if (coords.length === 2) {
                            const lat = parseFloat(coords[0].trim());
                            const lng = parseFloat(coords[1].trim());
                            
                            if (!isNaN(lat) && !isNaN(lng)) {
                                plzs.push({
                                    plz: plz.toString(),
                                    cityName: cityName,
                                    latitude: lat,
                                    longitude: lng
                                });
                            }
                        }
                    }
                })
                .on('end', () => {
                    this.allPLZs = plzs;
                    this.loadedPLZs = true;
                    console.log(`📍 Loaded ${plzs.length} PLZ coordinates for geographic completion`);
                    resolve();
                })
                .on('error', reject);
        });
    }

    /**
     * Find fallback data for a city with missing price data
     * @param {Object} cityData - City information (PLZ, name, coordinates)
     * @param {Array} availableData - Available price data from other cities
     * @returns {Promise<Object|null>} Fallback data or null
     */
    async findFallbackData(cityData, availableData) {
        try {
            // Ensure PLZ coordinates are loaded
            await this.loadPLZCoordinates();

            // Find coordinates for the target city
            let targetCoords = null;
            
            if (cityData.latitude && cityData.longitude) {
                // Use provided coordinates
                targetCoords = {
                    latitude: cityData.latitude,
                    longitude: cityData.longitude
                };
            } else {
                // Look up coordinates from PLZ database
                const plzEntry = this.allPLZs.find(p => p.plz === cityData.plz);
                if (plzEntry) {
                    targetCoords = {
                        latitude: plzEntry.latitude,
                        longitude: plzEntry.longitude
                    };
                }
            }

            if (!targetCoords) {
                console.warn(`⚠️  No coordinates found for ${cityData.cityName} (${cityData.plz})`);
                this.stats.noDataAvailable++;
                return null;
            }

            // Find the closest city with data
            let closest = null;
            let minDistance = Infinity;
            const maxFallbackDistance = this.config.getQualityConfig().maxFallbackDistance;

            for (const dataPoint of availableData) {
                // Skip invalid data points
                if (!dataPoint.plz || dataPoint.data_source === 'FALLBACK') continue;

                // Get coordinates for this data point
                let sourceCoords = null;
                
                if (dataPoint.latitude && dataPoint.longitude) {
                    sourceCoords = {
                        latitude: dataPoint.latitude,
                        longitude: dataPoint.longitude
                    };
                } else {
                    const plzEntry = this.allPLZs.find(p => p.plz === dataPoint.plz);
                    if (plzEntry) {
                        sourceCoords = {
                            latitude: plzEntry.latitude,
                            longitude: plzEntry.longitude
                        };
                    }
                }

                if (!sourceCoords) continue;

                // Calculate distance
                const distance = this.calculateDistance(
                    targetCoords.latitude, targetCoords.longitude,
                    sourceCoords.latitude, sourceCoords.longitude
                );

                // Check if this is the closest so far and within max distance
                if (distance < minDistance && distance <= maxFallbackDistance) {
                    minDistance = distance;
                    closest = {
                        ...dataPoint,
                        source_plz: dataPoint.plz,
                        distance_km: Math.round(distance * 100) / 100
                    };
                }
            }

            if (closest) {
                this.stats.fallbackDataFound++;
                this.updateDistanceStats(closest.distance_km);
                
                // Prepare fallback result
                const fallbackResult = {
                    plz: cityData.plz,
                    city_name: cityData.cityName,
                    latitude: targetCoords.latitude,
                    longitude: targetCoords.longitude,
                    lokaler_versorger_price: closest.lokaler_versorger_price,
                    oekostrom_price: closest.oekostrom_price,
                    average_price: closest.average_price,
                    data_source: 'FALLBACK',
                    source_url: closest.source_url,
                    source_plz: closest.source_plz,
                    distance_km: closest.distance_km,
                    extraction_method: 'geographic_fallback',
                    is_outlier: false,
                    outlier_severity: 'normal',
                    validation_attempted: false,
                    validation_successful: false
                };

                return fallbackResult;
            } else {
                this.stats.noDataAvailable++;
                return null;
            }

        } catch (error) {
            console.error(`❌ Error finding fallback data for ${cityData.cityName}:`, error.message);
            this.stats.noDataAvailable++;
            return null;
        }
    }

    /**
     * Calculate distance between two geographic points using Haversine formula
     * @param {number} lat1 - Latitude 1
     * @param {number} lon1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lon2 - Longitude 2
     * @returns {number} Distance in kilometers
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Convert degrees to radians
     */
    toRadians(degrees) {
        return degrees * (Math.PI/180);
    }

    /**
     * Update distance statistics
     */
    updateDistanceStats(distance) {
        if (distance > this.stats.maxDistance) {
            this.stats.maxDistance = distance;
        }
        if (distance < this.stats.minDistance) {
            this.stats.minDistance = distance;
        }
        
        // Calculate running average
        const totalFallbacks = this.stats.fallbackDataFound;
        this.stats.averageDistance = ((this.stats.averageDistance * (totalFallbacks - 1)) + distance) / totalFallbacks;
    }

    /**
     * Get completion statistics
     * @param {Array} results - Array of results (original + fallback)
     * @returns {Object} Completion statistics
     */
    getCompletionStats(results) {
        const originalData = results.filter(r => r.data_source === 'ORIGINAL').length;
        const fallbackData = results.filter(r => r.data_source === 'FALLBACK').length;
        const totalResults = results.length;

        const fallbackDistances = results
            .filter(r => r.data_source === 'FALLBACK' && r.distance_km)
            .map(r => r.distance_km)
            .sort((a, b) => a - b);

        const distanceStats = fallbackDistances.length > 0 ? {
            count: fallbackDistances.length,
            average: fallbackDistances.reduce((a, b) => a + b, 0) / fallbackDistances.length,
            median: fallbackDistances[Math.floor(fallbackDistances.length / 2)],
            min: Math.min(...fallbackDistances),
            max: Math.max(...fallbackDistances),
            ranges: {
                '0-5km': fallbackDistances.filter(d => d <= 5).length,
                '5-10km': fallbackDistances.filter(d => d > 5 && d <= 10).length,
                '10-25km': fallbackDistances.filter(d => d > 10 && d <= 25).length,
                '25-50km': fallbackDistances.filter(d => d > 25 && d <= 50).length,
                '50km+': fallbackDistances.filter(d => d > 50).length
            }
        } : null;

        return {
            total_results: totalResults,
            original_data: originalData,
            fallback_data: fallbackData,
            completion_rate: totalResults > 0 ? ((originalData + fallbackData) / totalResults * 100).toFixed(1) : 0,
            fallback_rate: totalResults > 0 ? (fallbackData / totalResults * 100).toFixed(1) : 0,
            distance_statistics: distanceStats,
            processing_stats: {
                fallback_found: this.stats.fallbackDataFound,
                no_data_available: this.stats.noDataAvailable
            }
        };
    }

    /**
     * Print completion summary
     */
    printCompletionSummary(results) {
        const stats = this.getCompletionStats(results);
        
        console.log('\n🗺️  === GEOGRAPHIC COMPLETION SUMMARY ===');
        console.log(`📊 Total results: ${stats.total_results}`);
        console.log(`✅ Original data: ${stats.original_data}`);
        console.log(`🔄 Fallback data: ${stats.fallback_data}`);
        console.log(`📈 Completion rate: ${stats.completion_rate}%`);
        console.log(`🗺️  Fallback rate: ${stats.fallback_rate}%`);

        if (stats.distance_statistics) {
            const dist = stats.distance_statistics;
            console.log('\n📏 Distance Statistics:');
            console.log(`   📐 Average: ${dist.average.toFixed(2)} km`);
            console.log(`   📍 Median: ${dist.median.toFixed(2)} km`);
            console.log(`   🔻 Min: ${dist.min.toFixed(2)} km`);
            console.log(`   🔺 Max: ${dist.max.toFixed(2)} km`);
            
            console.log('\n📊 Distance Distribution:');
            Object.entries(dist.ranges).forEach(([range, count]) => {
                const percentage = ((count / dist.count) * 100).toFixed(1);
                console.log(`   ${range}: ${count} (${percentage}%)`);
            });
        }

        console.log(`\n💡 Processing: ${stats.processing_stats.fallback_found} fallbacks found, ${stats.processing_stats.no_data_available} without fallback data`);
    }
}

module.exports = GeographicCompletion; 