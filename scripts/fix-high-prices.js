#!/usr/bin/env node

/**
 * Fix High Prices CLI
 * Fixes cities with lokaler prices > €1.00 (extraction errors)
 */

const HighPriceFixer = require('../services/high-price-fixer');

async function main() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
🔧 High Price Fixer

USAGE:
  node scripts/fix-high-prices.js [OPTIONS]

OPTIONS:
  --max-entries N        Limit to N entries (for testing)
  --help, -h             Show this help

EXAMPLES:
  # Test on first 5 high-price entries
  node scripts/fix-high-prices.js --max-entries 5

  # Fix all high-price entries
  node scripts/fix-high-prices.js

DESCRIPTION:
  Fixes cities with lokaler prices > €1.00 per kWh, which are almost
  certainly extraction errors where annual costs were captured instead
  of per-kWh rates.
  
  For example:
  - Dresden stored as €1.4660 -> should be €0.4191
  - Extraction error: taking "1.466,82 EUR" (annual) instead of "41,91 Cent pro kWh"
        `);
        return;
    }

    const maxEntries = args.includes('--max-entries') ? 
        parseInt(args[args.indexOf('--max-entries') + 1]) : null;

    const fixer = new HighPriceFixer();

    try {
        await fixer.fixAllHighPrices(maxEntries);
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