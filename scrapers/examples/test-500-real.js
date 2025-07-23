/**
 * Test Real Scraper with First 500 Cities
 * Uses actual PLZ data and runs the full scraper pipeline
 */

require('dotenv').config({ path: '../../.env' });
const fs = require('fs');
const csv = require('csv-parser');
const ScraperFactory = require('../modules/factory/scraper-factory');

async function testReal500Cities() {
    console.log('🧪 Testing Real Scraper with 500 Cities from PLZ Data\n');

    const factory = new ScraperFactory();
    let scraperId = null;

    try {
        // 1. Load first 500 cities from actual PLZ CSV
        console.log('📖 Loading first 500 cities from PLZ CSV...');
        const cities = await loadFirst500RealCities();
        console.log(`✅ Loaded ${cities.length} real cities for testing`);

        // 2. Create scraper with optimizations
        console.log('\n📦 Creating optimized scraper...');
        const { scraper, scraperId: id, config } = await factory.createImprovedScraper({
            config: {
                database: {
                    batchingOptimizations: {
                        enableBatchStorage: true,
                        batchStorageSize: 100,
                        enableBatchErrorLogging: true,
                        batchErrorSize: 50,
                        enableBulkDuplicateCheck: true
                    }
                },
                delays: {
                    betweenRequests: parseInt(process.env.SCRAPER_DELAY) || 500  // Use env delay or 500ms default
                }
            }
        });
        scraperId = id;

        console.log('✅ Scraper created with optimizations enabled');

        // 3. Show test parameters
        const delay = parseInt(process.env.SCRAPER_DELAY) || 500;
        console.log('\n🎯 Test Parameters:');
        console.log(`   • Cities to process: ${cities.length}`);
        console.log(`   • Delay between requests: ${delay}ms`);
        console.log(`   • Estimated time: ${Math.ceil(cities.length * delay / 1000 / 60)} minutes`);
        console.log(`   • Expected batch flushes: ~${Math.ceil(cities.length * 0.6 / 100)} (assuming 60% success)`);
        console.log(`   • Database operations reduced: ~99%`);

        // 4. Run the test
        console.log('\n🔄 Starting real scraper test...');
        const startTime = Date.now();
        
        const result = await scraper.scrapeElectricityPrices(cities, {
            skipExistingData: false // Test everything
        });

        const duration = Date.now() - startTime;
        console.log('\n✅ Test completed!');

        // 5. Show results
        await showTestResults(scraper, result, duration, cities.length);

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

/**
 * Load first 500 cities from actual PLZ CSV
 */
async function loadFirst500RealCities() {
    const csvFile = '../../utils/Postleitzahlen Deutschland.csv';
    
    return new Promise((resolve, reject) => {
        const cities = [];
        let count = 0;
        
        if (!fs.existsSync(csvFile)) {
            reject(new Error(`PLZ CSV file not found: ${csvFile}`));
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
                resolve(cities);
            })
            .on('error', reject);
    });
}

/**
 * Extract and normalize city name with proper German umlaut handling
 */
function extractCityName(fullName) {
    if (!fullName) return '';
    
    return fullName
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
        .replace(/[^a-z0-9\s]/g, '') 
        .replace(/\s+/g, '-');
}

/**
 * Show test results
 */
async function showTestResults(scraper, result, duration, totalCities) {
    console.log('\n📊 === TEST RESULTS ===');
    console.log(`⏱️  Duration: ${(duration / 1000 / 60).toFixed(1)} minutes`);
    console.log(`📈 Total cities: ${totalCities}`);
    
    if (result && result.results) {
        const successRate = (result.results.length / totalCities * 100).toFixed(1);
        console.log(`✅ Successful: ${result.results.length} (${successRate}%)`);
        console.log(`❌ Failed: ${result.errors?.length || 0}`);
        console.log(`🔄 Fallback used: ${result.fallbackDataUsed || 0}`);
    }

    // Show batch optimization results
    if (scraper.databaseStorage && scraper.databaseStorage.getBatchStats) {
        const batchStats = scraper.databaseStorage.getBatchStats();
        
        console.log('\n🎯 Batch Optimization Results:');
        const dbReduction = batchStats.estimatedDbCallsReduced;
        console.log(`   • Duplicate checks saved: ${dbReduction.duplicateChecksReduced}`);
        console.log(`   • Result inserts batched: ${dbReduction.resultInsertsReduced}`);
        console.log(`   • Error inserts batched: ${dbReduction.errorInsertsReduced}`);
        
        const totalSaved = dbReduction.duplicateChecksReduced + dbReduction.resultInsertsReduced + dbReduction.errorInsertsReduced;
        console.log(`   • Total DB operations saved: ~${totalSaved}`);
    }

    // Show example successful cities with umlauts
    if (result && result.results) {
        console.log('\n🇩🇪 Umlaut Handling Examples:');
        const umlautCities = result.results.filter(r => 
            r.city_name && (r.city_name.includes('ü') || r.city_name.includes('ö') || r.city_name.includes('ä'))
        ).slice(0, 3);
        
        umlautCities.forEach(city => {
            console.log(`   ${city.city_name} → €${city.average_price?.toFixed(4) || 'N/A'}/kWh`);
        });
    }

    console.log('\n✅ Real scraper test completed successfully!');
}

// Run the test
if (require.main === module) {
    testReal500Cities()
        .then(() => {
            console.log('\n🎉 500-city real test completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testReal500Cities }; 