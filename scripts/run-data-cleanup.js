#!/usr/bin/env node

/**
 * Data Quality Cleanup CLI
 * Command-line interface for running data quality cleanup operations
 */

const DataQualityCleanup = require('../services/data-quality-cleanup');

async function main() {
    const args = process.argv.slice(2);
    const cleanup = new DataQualityCleanup();

    // Parse command line arguments
    const options = {
        month: null,
        maxEntries: null,
        onlyAnalyze: false,
        targetIssue: null
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--month':
                options.month = args[++i];
                break;
            case '--max-entries':
                options.maxEntries = parseInt(args[++i]);
                break;
            case '--analyze-only':
                options.onlyAnalyze = true;
                break;
            case '--target':
                options.targetIssue = args[++i];
                break;
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
                break;
        }
    }

    console.log('🧹 Data Quality Cleanup Tool');
    console.log('============================\n');

    try {
        if (options.onlyAnalyze) {
            // Only analyze, don't fix
            console.log('🔍 ANALYSIS MODE - No changes will be made');
            const problematicData = await cleanup.findProblematicEntries(options.month);
            
            console.log('\n📊 DETAILED ANALYSIS:');
            console.log(`Total entries checked: ${problematicData.summary.total_entries}`);
            console.log(`Problematic entries: ${problematicData.summary.problematic_entries}`);
            console.log('');
            console.log('Issue breakdown:');
            console.log(`  🚨 Outliers (>€1.00): ${problematicData.summary.outliers}`);
            console.log(`  💥 Extreme outliers (>€1.50): ${problematicData.summary.extreme_outliers}`);
            console.log(`  ❓ Missing prices: ${problematicData.summary.missing_prices}`);
            console.log(`  ⚠️  Invalid price relationships: ${problematicData.summary.invalid_relationships}`);
            
            // Show some examples
            if (problematicData.categorized.extreme_outliers.length > 0) {
                console.log('\n💥 Examples of extreme outliers:');
                problematicData.categorized.extreme_outliers.slice(0, 5).forEach(entry => {
                    console.log(`  ${entry.city_name} (${entry.plz}): Lokaler €${entry.lokaler_versorger_price}, Öko €${entry.oekostrom_price}`);
                });
            }
            
            if (problematicData.categorized.missing_prices.length > 0) {
                console.log('\n❓ Examples of missing prices:');
                problematicData.categorized.missing_prices.slice(0, 5).forEach(entry => {
                    const missing = entry.quality_issues.find(i => i.type === 'missing_price');
                    console.log(`  ${entry.city_name} (${entry.plz}): ${missing.message}`);
                });
            }
            
        } else {
            // Run actual cleanup
            console.log('🔧 CLEANUP MODE - Database will be updated');
            if (options.maxEntries) {
                console.log(`📊 Processing maximum ${options.maxEntries} entries\n`);
            }
            
            await cleanup.runCleanup(options.month, options.maxEntries);
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
🧹 Data Quality Cleanup Tool

USAGE:
  node scripts/run-data-cleanup.js [OPTIONS]

OPTIONS:
  --month YYYY-MM-DD     Process specific month (e.g., 2025-01-01)
  --max-entries N        Limit processing to N entries (for testing)
  --analyze-only         Only analyze issues, don't fix them
  --target TYPE          Target specific issue type (outliers, missing, invalid)
  --help, -h             Show this help message

EXAMPLES:
  # Analyze issues without making changes
  node scripts/run-data-cleanup.js --analyze-only

  # Fix all issues for January 2025
  node scripts/run-data-cleanup.js --month 2025-01-01

  # Test cleanup on first 10 problematic entries
  node scripts/run-data-cleanup.js --max-entries 10

  # Analyze issues for specific month
  node scripts/run-data-cleanup.js --month 2025-01-01 --analyze-only

ISSUE TYPES:
  - Outliers: Prices above €1.00 per kWh (likely extraction errors)
  - Extreme outliers: Prices above €1.50 per kWh (almost certainly wrong)
  - Missing prices: Entries with only lokaler OR öko price
  - Invalid relationships: Lokaler price lower than öko price

The tool will:
1. 🔍 Scan database for quality issues
2. 🌐 Re-scrape problematic pages with enhanced extraction
3. ✅ Validate new prices for reasonableness
4. 💾 Update database with corrected data
5. 📊 Report success/failure statistics
`);
}

// Run the script
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { main }; 