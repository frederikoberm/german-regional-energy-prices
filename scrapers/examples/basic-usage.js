/**
 * Basic Usage Example - Test Batch Optimizations
 * Tests the new database batch optimizations with 500 cities
 */

require('dotenv').config({ path: '../../.env' });
const fs = require('fs');
const csv = require('csv-parser');
const ScraperFactory = require('../modules/factory/scraper-factory');

async function testBatchOptimizations() {
    console.log('🧪 Testing Batch Optimizations - 500 Cities\n');

    const factory = new ScraperFactory();
    let scraperId = null;

    try {
        // 1. Create a scraper instance with optimizations enabled
        console.log('📦 Creating optimized scraper instance...');
        const { scraper, scraperId: id, config } = await factory.createImprovedScraper({
            config: {
                database: {
                    batchingOptimizations: {
                        enableBatchStorage: true,
                        batchStorageSize: 100,        // Batch every 100 cities
                        enableBatchErrorLogging: true,
                        batchErrorSize: 50,           // Batch every 50 errors
                        enableBulkDuplicateCheck: true // Single duplicate check query
                    }
                },
                delays: {
                    betweenRequests: 1000  // 1 second delay for testing
                }
            }
        });
        scraperId = id;

        console.log('✅ Optimized scraper created successfully');
        config.printConfig();

        // 2. Load first 500 cities from CSV
        console.log('\n📖 Loading first 500 cities from CSV...');
        const cities = await loadFirst500Cities();
        console.log(`✅ Loaded ${cities.length} cities for testing`);

        // 3. Show expected batch behavior
        console.log('\n🎯 Expected Batch Behavior:');
        console.log(`   • 1 bulk duplicate check (instead of ${cities.length} individual queries)`);
        console.log(`   • ~${Math.ceil((cities.length * 0.6) / 100)} result batches (assuming 60% success rate)`);
        console.log(`   • ~${Math.ceil((cities.length * 0.4) / 50)} error batches (assuming 40% failure rate)`);
        console.log(`   • Significant reduction in database operations`);

        // 4. Run the scraper with batch monitoring
        console.log('\n🔄 Starting optimized scraping process...');
        const startTime = Date.now();
        
        const result = await scraper.scrapeElectricityPrices(cities, {
            skipExistingData: false // Allow re-scraping for demo
        });

        const duration = Date.now() - startTime;
        console.log('\n✅ Scraping completed!');

        // 5. Show optimization results
        await showOptimizationResults(scraper, result, duration);

    } catch (error) {
        console.error('❌ Error in batch optimization test:', error);
        throw error;
    }
}

/**
 * Load first 500 cities from the German PLZ CSV file
 */
async function loadFirst500Cities() {
    const csvFile = '../../utils/Postleitzahlen Deutschland.csv';
    
    return new Promise((resolve, reject) => {
        const cities = [];
        let count = 0;
        
        if (!fs.existsSync(csvFile)) {
            // Fallback to sample cities if CSV not available
            console.log('⚠️  PLZ CSV not found, using sample cities...');
            resolve(getSampleCities());
            return;
        }

        fs.createReadStream(csvFile)
            .pipe(csv({ separator: ';' }))
            .on('data', (row) => {
                if (count >= 500) return; // Limit to first 500

                const cityName = row['PLZ Name (short)'] || row.Name || row.Ort;
                const plz = row['Postleitzahl / Post code'] || row.PLZ || row.plz;
                const geoPoint = row['geo_point_2d'];

                if (cityName && plz) {
                    const city = {
                        originalName: cityName,
                        cityName: cityName,
                        normalizedName: extractCityName(cityName),
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
                console.log(`📊 Loaded ${cities.length} cities from CSV`);
                resolve(cities);
            })
            .on('error', reject);
    });
}

/**
 * Extract city name from compound names with proper German umlaut handling
 */
function extractCityName(fullName) {
    if (!fullName) return '';
    
    // Handle compound city names (e.g., "Hamburg, Altstadt" -> "hamburg")
    const cleaned = fullName
        .split(',')[0]  // Take first part before comma
        .split('(')[0]  // Remove parenthetical content
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
        .replace(/[^a-z0-9\s]/g, '') // Remove remaining special characters
        .replace(/\s+/g, '-'); // Replace spaces with hyphens
    
    return cleaned;
}

/**
 * Get sample cities if CSV is not available
 */
function getSampleCities() {
    const samples = [];
    const baseCities = [
        { name: 'Hamburg', plz: '20095', lat: 53.5511, lng: 9.9937 },
        { name: 'München', plz: '80331', lat: 48.1351, lng: 11.5820 },
        { name: 'Berlin', plz: '10115', lat: 52.5200, lng: 13.4050 },
        { name: 'Köln', plz: '50667', lat: 50.9375, lng: 6.9603 },
        { name: 'Frankfurt', plz: '60311', lat: 50.1109, lng: 8.6821 }
    ];

    // Create 500 variations for testing
    for (let i = 0; i < 500; i++) {
        const base = baseCities[i % baseCities.length];
        const plzVariation = parseInt(base.plz) + Math.floor(i / baseCities.length);
        
        samples.push({
            originalName: `${base.name} ${i}`,
            cityName: `${base.name} ${i}`,
            normalizedName: `${base.name.toLowerCase()}-${i}`,
            plz: plzVariation.toString(),
            latitude: base.lat + (Math.random() - 0.5) * 0.1,
            longitude: base.lng + (Math.random() - 0.5) * 0.1
        });
    }

    console.log(`📊 Generated ${samples.length} sample cities for testing`);
    return samples;
}

/**
 * Show optimization results and statistics
 */
async function showOptimizationResults(scraper, result, duration) {
    console.log('\n📊 === BATCH OPTIMIZATION RESULTS ===');
    console.log(`⏱️  Total duration: ${(duration / 1000).toFixed(1)} seconds`);
    
    // Get batch statistics from storage
    if (scraper.databaseStorage && scraper.databaseStorage.getBatchStats) {
        const batchStats = scraper.databaseStorage.getBatchStats();
        
        console.log('\n🎯 Batch Status:');
        console.log(`   • Batch storage enabled: ${batchStats.batchOptimizationsEnabled.batchStorage}`);
        console.log(`   • Bulk duplicate check enabled: ${batchStats.batchOptimizationsEnabled.bulkDuplicateCheck}`);
        console.log(`   • Batch error logging enabled: ${batchStats.batchOptimizationsEnabled.batchErrorLogging}`);
        
        console.log('\n📈 Database Calls Reduced:');
        const dbReduction = batchStats.estimatedDbCallsReduced;
        console.log(`   • Duplicate checks saved: ${dbReduction.duplicateChecksReduced}`);
        console.log(`   • Result inserts batched: ${dbReduction.resultInsertsReduced}`);
        console.log(`   • Error inserts batched: ${dbReduction.errorInsertsReduced}`);
        
        if (batchStats.pendingCounts.results > 0 || batchStats.pendingCounts.errors > 0) {
            console.log('\n⏳ Pending Batches:');
            console.log(`   • Results waiting: ${batchStats.pendingCounts.results}/${batchStats.batchSizes.resultsBatchSize}`);
            console.log(`   • Errors waiting: ${batchStats.pendingCounts.errors}/${batchStats.batchSizes.errorsBatchSize}`);
        }
        
        console.log('\n🗃️  Cache Status:');
        console.log(`   • Cache initialized: ${batchStats.cacheStatus.initialized}`);
        console.log(`   • Existing PLZs cached: ${batchStats.cacheStatus.existingPLZsCount}`);
    }
    
    console.log('\n✅ Test completed successfully!');
    console.log('   Check the console output above for batch flush messages');
    console.log('   Look for "📊 Flushing batch" and "✅ Bulk duplicate cache initialized" messages');
}

// Run the test
if (require.main === module) {
    testBatchOptimizations()
        .then(() => {
            console.log('\n🎉 Batch optimization test completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testBatchOptimizations };