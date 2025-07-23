/**
 * Supabase Database Usage Examples
 * Demonstrates all CRUD operations for the electricity price system
 */

require('dotenv').config();
const SupabaseClient = require('./supabase-client');

class DatabaseExamples {
    constructor() {
        this.db = new SupabaseClient();
    }

    /**
     * Example 1: Basic Connection and Testing
     */
    async example1_testConnection() {
        console.log('\n=== Example 1: Testing Database Connection ===');
        
        const isConnected = await this.db.testConnection();
        if (isConnected) {
            console.log('✅ Database is accessible and ready');
        } else {
            console.log('❌ Database connection failed');
        }
    }

    /**
     * Example 2: Insert Single Price Record
     */
    async example2_insertSingleRecord() {
        console.log('\n=== Example 2: Insert Single Price Record ===');
        
        const sampleData = {
            plz: '20095',
            city_name: 'Hamburg',
            latitude: 53.5511,
            longitude: 9.9937,
            lokaler_versorger_price: 0.38,
            oekostrom_price: 0.25,
            average_price: 0.315,
            data_source: 'ORIGINAL',
            source_url: 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-hamburg',
            is_outlier: false,
            outlier_severity: 'normal'
        };

        try {
            const result = await this.db.insertPriceData(sampleData);
            console.log('✅ Inserted record:', result.id);
            console.log(`📍 PLZ: ${result.plz}, City: ${result.city_name}`);
            console.log(`💰 Prices: Local=${result.lokaler_versorger_price}€, Green=${result.oekostrom_price}€, Avg=${result.average_price}€`);
        } catch (error) {
            if (error.message.includes('duplicate key')) {
                console.log('ℹ️  Record already exists for this month and PLZ');
            } else {
                console.error('❌ Error inserting record:', error.message);
            }
        }
    }

    /**
     * Example 3: Bulk Insert with Fallback Data
     */
    async example3_bulkInsertWithFallback() {
        console.log('\n=== Example 3: Bulk Insert with Fallback Data ===');
        
        const bulkData = [
            {
                plz: '21266',
                city_name: 'Jesteburg',
                latitude: 53.2937,
                longitude: 9.9658,
                lokaler_versorger_price: 0.41,
                oekostrom_price: 0.27,
                average_price: 0.34,
                data_source: 'ORIGINAL',
                source_url: 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-jesteburg'
            },
            {
                plz: '21265', // Missing data, using fallback
                city_name: 'Tostedt',
                latitude: 53.2896,
                longitude: 9.7173,
                lokaler_versorger_price: 0.41, // Using Jesteburg prices
                oekostrom_price: 0.27,
                average_price: 0.34,
                data_source: 'FALLBACK',
                source_plz: '21266',
                distance_km: 6.45,
                source_url: 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-jesteburg'
            }
        ];

        try {
            const results = await this.db.bulkInsertPriceData(bulkData);
            console.log(`✅ Bulk insert completed: ${results.length} records`);
            
            // Show breakdown
            const original = results.filter(r => r.data_source === 'ORIGINAL').length;
            const fallback = results.filter(r => r.data_source === 'FALLBACK').length;
            console.log(`📊 Original data: ${original}, Fallback data: ${fallback}`);
        } catch (error) {
            console.error('❌ Error in bulk insert:', error.message);
        }
    }

    /**
     * Example 4: Query Price Data
     */
    async example4_queryPriceData() {
        console.log('\n=== Example 4: Query Price Data ===');
        
        const currentMonth = this.db.getCurrentMonth();
        
        // Get specific PLZ data
        const hamburgData = await this.db.getPriceData('20095', currentMonth);
        if (hamburgData) {
            console.log('📍 Hamburg (20095) prices:');
            console.log(`   Local Provider: ${hamburgData.lokaler_versorger_price}€/kWh`);
            console.log(`   Green Energy: ${hamburgData.oekostrom_price}€/kWh`);
            console.log(`   Average: ${hamburgData.average_price}€/kWh`);
            console.log(`   Data Source: ${hamburgData.data_source}`);
        } else {
            console.log('❌ No data found for Hamburg in current month');
        }

        // Get latest data for a PLZ
        const latestData = await this.db.getLatestPriceData('20095');
        if (latestData) {
            console.log('\n📅 Latest available data for 20095:');
            console.log(`   Month: ${latestData.data_month}`);
            console.log(`   Average Price: ${latestData.average_price}€/kWh`);
        }
    }

    /**
     * Example 5: Monthly Statistics
     */
    async example5_monthlyStatistics() {
        console.log('\n=== Example 5: Monthly Statistics ===');
        
        const currentMonth = this.db.getCurrentMonth();
        
        // Get monthly averages
        const averages = await this.db.getMonthlyAverages(currentMonth);
        if (averages) {
            console.log(`📊 Monthly averages for ${currentMonth}:`);
            console.log(`   Local Provider Avg: ${averages.lokaler_versorger_avg.toFixed(4)}€/kWh`);
            console.log(`   Green Energy Avg: ${averages.oekostrom_avg.toFixed(4)}€/kWh`);
            console.log(`   Overall Average: ${averages.overall_avg.toFixed(4)}€/kWh`);
            console.log(`   Sample Size: ${averages.sample_size} cities`);
        } else {
            console.log('❌ No data available for monthly averages');
        }

        // Get coverage statistics
        const coverage = await this.db.getMonthCoverage(currentMonth);
        if (coverage) {
            console.log('\n📈 Coverage statistics:');
            console.log(`   Total Entries: ${coverage.total_entries}`);
            console.log(`   Original Data: ${coverage.original_count}`);
            console.log(`   Fallback Data: ${coverage.fallback_count}`);
            console.log(`   Outliers: ${coverage.outlier_count}`);
            if (coverage.avg_fallback_distance) {
                console.log(`   Avg Fallback Distance: ${coverage.avg_fallback_distance}km`);
            }
        }
    }

    /**
     * Example 6: Scraping Session Management
     */
    async example6_scrapingSessionManagement() {
        console.log('\n=== Example 6: Scraping Session Management ===');
        
        const currentMonth = this.db.getCurrentMonth();
        
        try {
            // Start a scraping session
            const session = await this.db.startScrapingSession(currentMonth, 1000, {
                scraper_version: '2.0',
                delay_ms: 1000,
                batch_size: 100
            });
            
            console.log(`✅ Started scraping session: ${session.id}`);
            console.log(`📅 Month: ${session.data_month}`);
            console.log(`🎯 Target: ${session.total_cities} cities`);

            // Simulate some progress
            await this.db.updateScrapingSession(session.id, {
                processed_cities: 250,
                successful_cities: 230,
                failed_cities: 20
            });
            console.log('📊 Updated session progress');

            // Log a sample error
            await this.db.logScrapingError(session.id, {
                plz: '12345',
                city_name: 'Example City',
                error_type: 'network_timeout',
                error_message: 'Request timed out after 30 seconds',
                source_url: 'https://example.com/city',
                retry_count: 3
            });
            console.log('📝 Logged scraping error');

            // Complete the session
            await this.db.completeScrapingSession(session.id, {
                successful_cities: 980,
                failed_cities: 20,
                fallback_cities: 150,
                outliers_detected: 15,
                notes: 'Scraping completed successfully with high coverage'
            });
            console.log('✅ Completed scraping session');

        } catch (error) {
            console.error('❌ Error in session management:', error.message);
        }
    }

    /**
     * Example 7: Data Validation and Quality Checks
     */
    async example7_dataValidation() {
        console.log('\n=== Example 7: Data Validation and Quality Checks ===');
        
        const currentMonth = this.db.getCurrentMonth();
        
        // Check if data exists before scraping
        const monthExists = await this.db.monthDataExists(currentMonth);
        console.log(`📅 Data exists for ${currentMonth}: ${monthExists ? 'Yes' : 'No'}`);

        // Check specific PLZ
        const plzExists = await this.db.dataExists(currentMonth, '20095');
        console.log(`📍 Hamburg (20095) data exists: ${plzExists ? 'Yes' : 'No'}`);

        // Get available months
        const availableMonths = await this.db.getAvailableMonths();
        console.log('📊 Available data months:');
        availableMonths.slice(0, 5).forEach(month => {
            console.log(`   ${month}`);
        });
        if (availableMonths.length > 5) {
            console.log(`   ... and ${availableMonths.length - 5} more`);
        }
    }

    /**
     * Example 8: Migration from CSV to Database
     */
    async example8_csvMigration() {
        console.log('\n=== Example 8: CSV Migration Example ===');
        
        // This example shows how you would migrate existing CSV data
        const csvSimulatedData = [
            {
                City: 'Berlin',
                PLZ: '10115',
                Latitude: '52.5200',
                Longitude: '13.4050',
                Lokaler_Versorger_Price_EUR_per_kWh: '0.39',
                Oekostrom_Price_EUR_per_kWh: '0.26',
                Average_Price_EUR_per_kWh: '0.325',
                Source_URL: 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-berlin',
                Data_Source: 'ORIGINAL',
                Is_Outlier: 'false',
                Outlier_Severity: 'normal'
            }
        ];

        // Convert CSV format to database format
        const dbRecords = csvSimulatedData.map(csvRow => ({
            plz: csvRow.PLZ,
            city_name: csvRow.City,
            latitude: parseFloat(csvRow.Latitude),
            longitude: parseFloat(csvRow.Longitude),
            lokaler_versorger_price: parseFloat(csvRow.Lokaler_Versorger_Price_EUR_per_kWh),
            oekostrom_price: parseFloat(csvRow.Oekostrom_Price_EUR_per_kWh),
            average_price: parseFloat(csvRow.Average_Price_EUR_per_kWh),
            data_source: csvRow.Data_Source,
            source_url: csvRow.Source_URL,
            is_outlier: csvRow.Is_Outlier === 'true',
            outlier_severity: csvRow.Outlier_Severity,
            // Add specific month if migrating historical data
            data_month: '2025-01-01' // or extract from filename/context
        }));

        console.log('📄 CSV to Database conversion example:');
        console.log('Original CSV fields → Database fields');
        console.log('PLZ → plz');
        console.log('City → city_name');
        console.log('Lokaler_Versorger_Price_EUR_per_kWh → lokaler_versorger_price');
        console.log('... (converted to appropriate data types)');
        
        // Uncomment to actually insert:
        // await this.db.bulkInsertPriceData(dbRecords);
        console.log('💡 Ready for bulk insert when needed');
    }

    /**
     * Run all examples
     */
    async runAllExamples() {
        console.log('🚀 Running Supabase Database Examples...\n');
        
        try {
            await this.example1_testConnection();
            await this.example2_insertSingleRecord();
            await this.example3_bulkInsertWithFallback();
            await this.example4_queryPriceData();
            await this.example5_monthlyStatistics();
            await this.example6_scrapingSessionManagement();
            await this.example7_dataValidation();
            await this.example8_csvMigration();
            
            console.log('\n✅ All examples completed successfully!');
        } catch (error) {
            console.error('\n❌ Error running examples:', error.message);
        }
    }
}

// Run examples if this file is executed directly
if (require.main === module) {
    const examples = new DatabaseExamples();
    examples.runAllExamples();
}

module.exports = DatabaseExamples; 