#!/usr/bin/env node

/**
 * Fix Missing Oekostrom Prices
 * Uses enhanced extraction specifically for oekostrom prices
 */

const EnhancedOekoExtractor = require('../services/enhanced-oeko-extractor');

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🔧 Enhanced Oekostrom Price Fixer

USAGE:
  node scripts/fix-missing-oeko.js [OPTIONS]

OPTIONS:
  --max-entries N        Limit to N entries (for testing)
  --help, -h             Show this help

EXAMPLES:
  # Test on first 5 missing oeko entries
  node scripts/fix-missing-oeko.js --max-entries 5

  # Fix all missing oeko entries
  node scripts/fix-missing-oeko.js
        `);
        return;
    }

    const maxEntries = args.includes('--max-entries') ? 
        parseInt(args[args.indexOf('--max-entries') + 1]) : null;

    const extractor = new EnhancedOekoExtractor();

    try {
        await extractor.fixMissingOekoPrices(null, maxEntries);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { main }; 