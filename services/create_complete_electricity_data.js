const fs = require('fs');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

class ElectricityDataCompleter {
    constructor() {
        this.allPLZs = [];
        this.electricityData = [];
        this.completedData = [];
    }

    // Haversine formula for calculating distance between two lat/lng points
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Distance in kilometers
    }

    toRadians(degrees) {
        return degrees * (Math.PI/180);
    }

    // Load all PLZs with coordinates
    async loadAllPLZs(filename) {
        return new Promise((resolve, reject) => {
            const plzs = [];
            fs.createReadStream(filename)
                .pipe(csv({ separator: ';' }))
                .on('data', (row) => {
                    const plz = row['Postleitzahl / Post code'] || row.PLZ || row.plz;
                    const cityName = row['PLZ Name (short)'] || row.Name || row.Ort;
                    const geoPoint = row['geo_point_2d'];
                    
                    if (plz && cityName && geoPoint) {
                        // Parse geo_point_2d format: "latitude, longitude"
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
                    console.log(`✅ Loaded ${plzs.length} PLZs with coordinates`);
                    this.allPLZs = plzs;
                    resolve();
                })
                .on('error', reject);
        });
    }

    // Load existing electricity data
    async loadElectricityData(filename) {
        return new Promise((resolve, reject) => {
            const data = [];
            fs.createReadStream(filename)
                .pipe(csv())
                .on('data', (row) => {
                    const plz = row.PLZ?.toString();
                    if (plz && row.Average_Price_EUR_per_kWh) {
                        data.push({
                            city: row.City,
                            plz: plz,
                            lokalerVersorgerPrice: parseFloat(row.Lokaler_Versorger_Price_EUR_per_kWh),
                            oekostromPrice: parseFloat(row.Oekostrom_Price_EUR_per_kWh),
                            averagePrice: parseFloat(row.Average_Price_EUR_per_kWh),
                            sourceUrl: row.Source_URL
                        });
                    }
                })
                .on('end', () => {
                    console.log(`✅ Loaded ${data.length} PLZs with electricity data`);
                    this.electricityData = data;
                    resolve();
                })
                .on('error', reject);
        });
    }

    // Find closest PLZ with electricity data
    findClosestWithData(targetPLZ) {
        const target = this.allPLZs.find(p => p.plz === targetPLZ.plz);
        if (!target) return null;

        let closest = null;
        let minDistance = Infinity;

        for (const electricityPLZ of this.electricityData) {
            const sourcePLZ = this.allPLZs.find(p => p.plz === electricityPLZ.plz);
            if (!sourcePLZ) continue;

            const distance = this.calculateDistance(
                target.latitude, target.longitude,
                sourcePLZ.latitude, sourcePLZ.longitude
            );

            if (distance < minDistance) {
                minDistance = distance;
                closest = {
                    ...electricityPLZ,
                    distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
                };
            }
        }

        return closest;
    }

    // Create complete dataset
    async createCompleteDataset() {
        console.log('🔍 Creating complete dataset...');
        const electricityPLZSet = new Set(this.electricityData.map(d => d.plz));
        
        let directMatches = 0;
        let fallbackMatches = 0;
        let noMatches = 0;

        for (const plz of this.allPLZs) {
            const existingData = this.electricityData.find(d => d.plz === plz.plz);
            
            if (existingData) {
                // Direct match - use original data
                this.completedData.push({
                    PLZ: plz.plz,
                    City: existingData.city,
                    Latitude: plz.latitude,
                    Longitude: plz.longitude,
                    Lokaler_Versorger_Price_EUR_per_kWh: existingData.lokalerVersorgerPrice,
                    Oekostrom_Price_EUR_per_kWh: existingData.oekostromPrice,
                    Average_Price_EUR_per_kWh: existingData.averagePrice,
                    Source_URL: existingData.sourceUrl,
                    Data_Source: 'ORIGINAL',
                    Source_PLZ: plz.plz,
                    Distance_km: 0
                });
                directMatches++;
            } else {
                // Find closest PLZ with data
                const closest = this.findClosestWithData(plz);
                
                if (closest) {
                    this.completedData.push({
                        PLZ: plz.plz,
                        City: plz.cityName,
                        Latitude: plz.latitude,
                        Longitude: plz.longitude,
                        Lokaler_Versorger_Price_EUR_per_kWh: closest.lokalerVersorgerPrice,
                        Oekostrom_Price_EUR_per_kWh: closest.oekostromPrice,
                        Average_Price_EUR_per_kWh: closest.averagePrice,
                        Source_URL: closest.sourceUrl,
                        Data_Source: 'FALLBACK',
                        Source_PLZ: closest.plz,
                        Distance_km: closest.distance
                    });
                    fallbackMatches++;
                } else {
                    // No data available at all
                    this.completedData.push({
                        PLZ: plz.plz,
                        City: plz.cityName,
                        Latitude: plz.latitude,
                        Longitude: plz.longitude,
                        Lokaler_Versorger_Price_EUR_per_kWh: null,
                        Oekostrom_Price_EUR_per_kWh: null,
                        Average_Price_EUR_per_kWh: null,
                        Source_URL: null,
                        Data_Source: 'NO_DATA',
                        Source_PLZ: null,
                        Distance_km: null
                    });
                    noMatches++;
                }
            }

            // Progress indicator
            if ((directMatches + fallbackMatches + noMatches) % 1000 === 0) {
                console.log(`📊 Processed ${directMatches + fallbackMatches + noMatches}/${this.allPLZs.length} PLZs...`);
            }
        }

        console.log(`\n📈 === COMPLETION SUMMARY ===`);
        console.log(`✅ Direct matches: ${directMatches}`);
        console.log(`🔄 Fallback matches: ${fallbackMatches}`);
        console.log(`❌ No data available: ${noMatches}`);
        console.log(`📊 Total PLZs: ${this.allPLZs.length}`);
        console.log(`📈 Coverage: ${((directMatches + fallbackMatches) / this.allPLZs.length * 100).toFixed(1)}%`);
    }

    // Save complete dataset to CSV
    async saveCompleteDataset(filename) {
        const csvWriter = createCsvWriter({
            path: filename,
            header: [
                { id: 'PLZ', title: 'PLZ' },
                { id: 'City', title: 'City' },
                { id: 'Latitude', title: 'Latitude' },
                { id: 'Longitude', title: 'Longitude' },
                { id: 'Lokaler_Versorger_Price_EUR_per_kWh', title: 'Lokaler_Versorger_Price_EUR_per_kWh' },
                { id: 'Oekostrom_Price_EUR_per_kWh', title: 'Oekostrom_Price_EUR_per_kWh' },
                { id: 'Average_Price_EUR_per_kWh', title: 'Average_Price_EUR_per_kWh' },
                { id: 'Source_URL', title: 'Source_URL' },
                { id: 'Data_Source', title: 'Data_Source' },
                { id: 'Source_PLZ', title: 'Source_PLZ' },
                { id: 'Distance_km', title: 'Distance_km' }
            ]
        });

        await csvWriter.writeRecords(this.completedData);
        console.log(`💾 Complete dataset saved to: ${filename}`);
    }

    // Generate statistics about fallback distances
    generateDistanceStats() {
        const fallbackData = this.completedData.filter(d => d.Data_Source === 'FALLBACK');
        if (fallbackData.length === 0) return;

        const distances = fallbackData.map(d => d.Distance_km).sort((a, b) => a - b);
        const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
        const median = distances[Math.floor(distances.length / 2)];
        const max = Math.max(...distances);
        const min = Math.min(...distances);

        console.log(`\n📏 === DISTANCE STATISTICS ===`);
        console.log(`📊 Fallback matches: ${fallbackData.length}`);
        console.log(`📐 Average distance: ${mean.toFixed(2)} km`);
        console.log(`📍 Median distance: ${median.toFixed(2)} km`);
        console.log(`🔺 Max distance: ${max.toFixed(2)} km`);
        console.log(`🔻 Min distance: ${min.toFixed(2)} km`);

        // Distance distribution
        const ranges = [
            { name: '0-5km', count: distances.filter(d => d <= 5).length },
            { name: '5-10km', count: distances.filter(d => d > 5 && d <= 10).length },
            { name: '10-25km', count: distances.filter(d => d > 10 && d <= 25).length },
            { name: '25-50km', count: distances.filter(d => d > 25 && d <= 50).length },
            { name: '>50km', count: distances.filter(d => d > 50).length }
        ];

        console.log(`\n📊 Distance Distribution:`);
        ranges.forEach(range => {
            const percentage = (range.count / fallbackData.length * 100).toFixed(1);
            console.log(`  ${range.name}: ${range.count} (${percentage}%)`);
        });
    }

    // Main execution function
    async run() {
        try {
            console.log('🚀 Starting electricity data completion...\n');
            
            await this.loadAllPLZs('Postleitzahlen Deutschland.csv');
            await this.loadElectricityData('electricity_prices_results_progress.csv');
            
            await this.createCompleteDataset();
            
            await this.saveCompleteDataset('complete_electricity_prices.csv');
            
            this.generateDistanceStats();
            
            console.log('\n🎉 Data completion finished successfully!');
            console.log('📁 Output file: complete_electricity_prices.csv');
            
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    }
}

// Command line usage
if (require.main === module) {
    const completer = new ElectricityDataCompleter();
    completer.run();
}

module.exports = ElectricityDataCompleter; 