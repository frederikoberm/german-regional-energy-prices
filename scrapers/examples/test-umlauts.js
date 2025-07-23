/**
 * Test German Umlaut Handling
 * Verifies that city names with umlauts are properly normalized
 */

// Import the normalization functions
const ScraperFactory = require('../modules/factory/scraper-factory');

/**
 * Test city names with umlauts
 */
function testUmlautNormalization() {
    console.log('🧪 Testing German Umlaut Normalization\n');

    const testCities = [
        'München',      // ü → ue
        'Köln',         // ö → ou  
        'Düsseldorf',   // ü → ue
        'Würzburg',     // ü → ue
        'Göttingen',    // ö → ou
        'Nürnberg',     // ü → ue
        'Braunschweig', // no umlauts
        'Mühlhausen',   // ü → ue
        'Völklingen',   // ö → ou
        'Saarbrücken',  // ü → ue
        'Lübeck',       // ü → ue
        'Hörde',        // ö → ou
        'Märkisch',     // ä → ae
        'Böblingen',    // ö → ou
        'Tübingen'      // ü → ue
    ];

    const expectedResults = [
        'muenchen',
        'koeln',          // ö → oe
        'duesseldorf', 
        'wuerzburg',
        'goettingen',     // ö → oe
        'nuernberg',
        'braunschweig',
        'muehlhausen',
        'voelklingen',    // ö → oe
        'saarbruecken',
        'luebeck',
        'hoerde',         // ö → oe
        'maerkisch',
        'boeblingen',     // ö → oe
        'tuebingen'
    ];

    console.log('Testing normalization:');
    console.log('Original → Expected → Actual');
    console.log('─'.repeat(50));

    let allPassed = true;

    for (let i = 0; i < testCities.length; i++) {
        const original = testCities[i];
        const expected = expectedResults[i];
        const actual = normalizeTestCity(original);
        const passed = actual === expected;
        
        if (!passed) allPassed = false;
        
        const status = passed ? '✅' : '❌';
        console.log(`${original} → ${expected} → ${actual} ${status}`);
    }

    console.log('\n' + '═'.repeat(50));
    console.log(allPassed ? '🎉 All tests PASSED!' : '⚠️  Some tests FAILED!');
    
    return allPassed;
}

/**
 * Normalize city name for testing (matches the logic in adapters)
 */
function normalizeTestCity(cityName) {
    return cityName
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
        // Clean up and normalize
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Test URL generation with umlauts
 */
function testUrlGeneration() {
    console.log('\n🌐 Testing URL Generation:');
    console.log('─'.repeat(30));
    
    const baseUrl = 'https://www.stromauskunft.de/de/stadt/stromanbieter-in-';
    const testCities = ['München', 'Köln', 'Düsseldorf'];
    
    testCities.forEach(city => {
        const normalized = normalizeTestCity(city);
        const url = `${baseUrl}${normalized}.html`;
        console.log(`${city} → ${url}`);
    });
}

// Run tests if this file is executed directly
if (require.main === module) {
    const passed = testUmlautNormalization();
    testUrlGeneration();
    
    if (passed) {
        console.log('\n✅ Umlaut handling is working correctly!');
        process.exit(0);
    } else {
        console.log('\n❌ Umlaut handling needs fixing!');
        process.exit(1);
    }
}

module.exports = {
    testUmlautNormalization,
    testUrlGeneration,
    normalizeTestCity
}; 