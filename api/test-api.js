/**
 * Simple API Test Script
 * Tests the main API endpoints to verify functionality
 */

require('dotenv').config();
const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function testAPI() {
    console.log('🧪 Testing German Electricity Price API');
    console.log(`📍 Base URL: ${API_BASE_URL}`);
    console.log('=' .repeat(50));

    const tests = [
        {
            name: 'Health Check',
            method: 'GET',
            endpoint: '/health',
            expectedStatus: 200
        },
        {
            name: 'API Root',
            method: 'GET', 
            endpoint: '/',
            expectedStatus: 200
        },
        {
            name: 'Available Months',
            method: 'GET',
            endpoint: '/api/v1/months',
            expectedStatus: 200
        },
        {
            name: 'Price Data (if available)',
            method: 'GET',
            endpoint: '/api/v1/price/10115/2025/7', // Berlin PLZ, July 2025
            expectedStatus: [200, 404] // 200 if data exists, 404 if not
        },
        {
            name: 'Latest Price (if available)',
            method: 'GET',
            endpoint: '/api/v1/price/10115/latest', // Berlin PLZ
            expectedStatus: [200, 404]
        },
        {
            name: 'National Average (if available)',
            method: 'GET',
            endpoint: '/api/v1/average/2025/7',
            expectedStatus: [200, 404]
        },
        {
            name: 'Coverage Stats (if available)',
            method: 'GET',
            endpoint: '/api/v1/coverage/2025/7',
            expectedStatus: [200, 404]
        },
        {
            name: 'Invalid PLZ (should fail)',
            method: 'GET',
            endpoint: '/api/v1/price/1234/2025/7', // Invalid PLZ (only 4 digits)
            expectedStatus: 400
        },
        {
            name: 'Future Date (should fail)',
            method: 'GET',
            endpoint: '/api/v1/price/10115/2030/12', // Future date
            expectedStatus: 400
        },
        {
            name: 'Invalid Endpoint (should fail)',
            method: 'GET',
            endpoint: '/api/v1/nonexistent',
            expectedStatus: 404
        }
    ];

    let passed = 0;
    let total = tests.length;

    for (const test of tests) {
        try {
            console.log(`\n🔍 Testing: ${test.name}`);
            console.log(`   ${test.method} ${test.endpoint}`);

            const response = await axios({
                method: test.method,
                url: `${API_BASE_URL}${test.endpoint}`,
                validateStatus: () => true // Don't throw on non-2xx status codes
            });

            const expectedStatuses = Array.isArray(test.expectedStatus) 
                ? test.expectedStatus 
                : [test.expectedStatus];

            if (expectedStatuses.includes(response.status)) {
                console.log(`   ✅ PASS - Status: ${response.status}`);
                
                // Show some response details for successful tests
                if (response.status === 200 && response.data) {
                    if (response.data.success) {
                        console.log(`   📄 Message: ${response.data.message}`);
                        if (response.data.data && typeof response.data.data === 'object') {
                            const dataKeys = Object.keys(response.data.data);
                            console.log(`   📊 Data keys: ${dataKeys.slice(0, 3).join(', ')}${dataKeys.length > 3 ? '...' : ''}`);
                        }
                    }
                }
                passed++;
            } else {
                console.log(`   ❌ FAIL - Expected status: ${test.expectedStatus}, Got: ${response.status}`);
                if (response.data && response.data.error) {
                    console.log(`   📝 Error: ${response.data.error.message}`);
                }
            }

        } catch (error) {
            console.log(`   ❌ FAIL - Network/Request Error: ${error.message}`);
            if (error.code === 'ECONNREFUSED') {
                console.log('   💡 Hint: Make sure the API server is running (npm run api:dev)');
            }
        }
    }

    console.log('\n' + '=' .repeat(50));
    console.log(`🎯 Test Results: ${passed}/${total} tests passed`);
    
    if (passed === total) {
        console.log('🎉 All tests passed! API is working correctly.');
    } else {
        console.log(`⚠️  ${total - passed} tests failed. Check the API implementation.`);
    }

    // Test with sample data if we have any
    console.log('\n📊 Testing with sample data...');
    await testWithSampleData();
}

async function testWithSampleData() {
    try {
        // First check if we have any data at all
        const monthsResponse = await axios.get(`${API_BASE_URL}/api/v1/months`);
        
        if (monthsResponse.data.success && monthsResponse.data.data.available_months.length > 0) {
            const latestMonth = monthsResponse.data.data.latest_month;
            console.log(`✅ Found data for: ${latestMonth.formatted}`);
            
            // Test coverage for that month
            const coverageResponse = await axios.get(
                `${API_BASE_URL}/api/v1/coverage/${latestMonth.year}/${latestMonth.month}`
            );
            
            if (coverageResponse.data.success) {
                const coverage = coverageResponse.data.data.coverage;
                console.log(`📈 Coverage: ${coverage.total_records} records (${coverage.original_data.percentage}% original, ${coverage.fallback_data.percentage}% fallback)`);
            }

            // Test national averages
            const avgResponse = await axios.get(
                `${API_BASE_URL}/api/v1/average/${latestMonth.year}/${latestMonth.month}`
            );
            
            if (avgResponse.data.success) {
                const avg = avgResponse.data.data.national_averages;
                console.log(`💰 National Average Price: €${avg.average?.toFixed(4) || 'N/A'}/kWh`);
            }

        } else {
            console.log('ℹ️  No scraped data found in database yet. Run a scraping session first:');
            console.log('   npm run test:500  # Test with 500 cities');
            console.log('   npm run scrape    # Full scraping session');
        }

    } catch (error) {
        console.log(`⚠️  Could not test with sample data: ${error.message}`);
    }
}

// Add bulk test
async function testBulkEndpoint() {
    console.log('\n🔄 Testing bulk endpoint...');
    
    try {
        const bulkData = {
            year: 2025,
            month: 7,
            plzList: ['10115', '80331', '20095', '50667', '01067'] // Berlin, Munich, Hamburg, Cologne, Dresden
        };

        const response = await axios.post(`${API_BASE_URL}/api/v1/price/bulk`, bulkData);
        
        if (response.status === 200) {
            console.log(`✅ Bulk request successful`);
            console.log(`📊 Found data for ${response.data.data.found_count}/${response.data.data.requested_count} cities`);
        } else {
            console.log(`⚠️  Bulk request returned status: ${response.status}`);
        }

    } catch (error) {
        console.log(`❌ Bulk test failed: ${error.message}`);
    }
}

// Run the tests
if (require.main === module) {
    testAPI()
        .then(() => testBulkEndpoint())
        .then(() => {
            console.log('\n🏁 API testing completed!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = { testAPI }; 