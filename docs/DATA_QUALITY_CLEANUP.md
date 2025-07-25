# Data Quality Cleanup System

This document describes the comprehensive data quality cleanup system for the German electricity price database. The system is designed to identify, analyze, and fix problematic entries in the database.

## Overview

The data quality issues commonly found include:

1. **Outliers**: Prices above €1.00 per kWh (especially common in big cities)
2. **Extreme outliers**: Prices above €1.50 per kWh (almost certainly wrong)
3. **Missing prices**: Entries with only lokaler OR öko price populated
4. **Invalid relationships**: Lokaler price cheaper than öko price (illogical)

## System Components

### 1. Data Quality Cleanup Service (`services/data-quality-cleanup.js`)

The main service that provides comprehensive cleanup functionality:

```javascript
const DataQualityCleanup = require('./services/data-quality-cleanup');
const cleanup = new DataQualityCleanup();

// Find all problematic entries
const issues = await cleanup.findProblematicEntries();

// Run cleanup on specific month
await cleanup.runCleanup('2025-01-01', 50); // max 50 entries
```

**Key Features:**
- Enhanced price extraction with multiple strategies
- Intelligent validation of price relationships
- Database updates with quality tracking
- Comprehensive error handling and reporting

### 2. CLI Cleanup Tool (`scripts/run-data-cleanup.js`)

Command-line interface for running cleanup operations:

```bash
# Analyze issues without making changes
node scripts/run-data-cleanup.js --analyze-only

# Fix all issues for January 2025
node scripts/run-data-cleanup.js --month 2025-01-01

# Test cleanup on first 10 problematic entries
node scripts/run-data-cleanup.js --max-entries 10
```

### 3. Price Issues Analyzer (`scripts/analyze-price-issues.js`)

Deep analysis tool for investigating specific quality problems:

```bash
# Full analysis of data quality issues
node scripts/analyze-price-issues.js

# Analyze big city price issues only
node scripts/analyze-price-issues.js --big-cities

# Investigate specific URL
node scripts/analyze-price-issues.js --url "https://www.stromauskunft.de/strompreise/10115/"
```

## Enhanced Price Extraction

The cleanup system uses an improved price extraction approach with three strategies:

### Strategy 1: Enhanced Table Extraction
- Filters out comparison tables and advertisements
- Focuses on simple, direct price entries
- Validates table structure and content

### Strategy 2: Enhanced Regex Patterns
- Multiple regex patterns for different price formats
- Handles both Euro and Cent formats
- Context-aware pattern matching

### Strategy 3: Context-Aware Extraction
- Analyzes section headers and nearby content
- Understands page structure and layout
- Extracts prices based on semantic context

## Quality Validation

### Price Validation Thresholds
```javascript
{
    min_price: 0.05,              // Minimum reasonable price
    max_reasonable_price: 0.80,   // Most prices should be under 80 cents
    outlier_threshold: 1.0,       // Prices over €1 are likely wrong
    extreme_threshold: 1.50       // Prices over €1.50 are almost certainly wrong
}
```

### Improvement Validation
The system validates that new prices are actually improvements:
- New prices must be within reasonable ranges
- Outliers must be replaced with lower, reasonable prices
- Missing prices should be filled with valid data
- Price relationships must be logical (lokaler ≥ öko generally)

## Usage Examples

### Basic Cleanup
```bash
# 1. First, analyze the current state
node scripts/run-data-cleanup.js --analyze-only

# 2. Test cleanup on a small sample
node scripts/run-data-cleanup.js --max-entries 10

# 3. Run full cleanup for specific month
node scripts/run-data-cleanup.js --month 2025-01-01
```

### Investigation Workflow
```bash
# 1. Analyze big city issues
node scripts/analyze-price-issues.js --big-cities

# 2. Investigate specific problematic URLs
node scripts/analyze-price-issues.js --url "https://example.com/prices"

# 3. Run comprehensive analysis
node scripts/analyze-price-issues.js
```

### Database Queries for Manual Analysis
```sql
-- Find extreme outliers
SELECT city_name, plz, lokaler_versorger_price, oekostrom_price, source_url
FROM monthly_electricity_prices 
WHERE lokaler_versorger_price > 1.5 OR oekostrom_price > 1.5
ORDER BY lokaler_versorger_price DESC;

-- Find entries with only one price
SELECT city_name, plz, lokaler_versorger_price, oekostrom_price
FROM monthly_electricity_prices 
WHERE (lokaler_versorger_price IS NULL) != (oekostrom_price IS NULL);

-- Find invalid price relationships
SELECT city_name, plz, lokaler_versorger_price, oekostrom_price,
       (oekostrom_price - lokaler_versorger_price) as difference
FROM monthly_electricity_prices 
WHERE lokaler_versorger_price < oekostrom_price 
  AND (oekostrom_price - lokaler_versorger_price) > 0.02
ORDER BY difference DESC;
```

## Configuration

### Cleanup Service Configuration
```javascript
const cleanup = new DataQualityCleanup();

// Adjust validation thresholds
cleanup.validationThresholds = {
    min_price: 0.05,
    max_reasonable_price: 0.80,
    outlier_threshold: 1.0,
    extreme_threshold: 1.50
};

// Set request delay (be respectful to servers)
cleanup.delay = 2000; // 2 seconds between requests
```

### Environment Requirements
Ensure these environment variables are set:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

## Understanding Common Issues

### Why Big Cities Have High Prices
Big cities often show prices > €1 per kWh due to:
1. **Complex page layouts**: More comparison tables and ads
2. **Multiple price sections**: Business vs. residential pricing mixed
3. **Marketing content**: Promotional prices not actual tariffs
4. **Page structure changes**: Dynamic content loading

### Why Lokaler < Öko Happens
This illogical relationship can occur due to:
1. **Extraction from wrong sections**: Comparing business vs. residential
2. **Promotional vs. standard pricing**: Limited-time offers extracted
3. **Unit confusion**: Mixing monthly vs. kWh pricing
4. **Table structure misinterpretation**: Wrong column associations

### Missing Prices
Common causes for missing price data:
1. **Page format changes**: Tables restructured
2. **Dynamic content**: JavaScript-loaded pricing
3. **Regional variations**: Different page layouts by region
4. **Service unavailable**: Temporary provider issues

## Monitoring and Maintenance

### Regular Quality Checks
Run these commands monthly:
```bash
# Check overall data quality
node scripts/run-data-cleanup.js --analyze-only

# Focus on big cities (most problematic)
node scripts/analyze-price-issues.js --big-cities

# Sample investigation
node scripts/analyze-price-issues.js --month $(date +%Y-%m-01)
```

### Quality Metrics to Track
- Percentage of outliers per month
- Success rate of cleanup operations
- Coverage of both price types (lokaler + öko)
- Regional patterns in data quality issues

## Troubleshooting

### Common Issues and Solutions

**Problem**: "No prices found in re-scrape"
**Solution**: Check if the source URL is still valid and page structure hasn't changed

**Problem**: "New prices have invalid relationship"
**Solution**: May indicate the page has mixed pricing types; needs manual investigation

**Problem**: "Database connection failed"
**Solution**: Verify Supabase credentials and network connectivity

**Problem**: High number of extraction failures
**Solution**: May indicate website changes; update extraction patterns

## Future Improvements

Potential enhancements to consider:
1. **Machine learning**: Pattern recognition for price extraction
2. **Real-time validation**: Check prices during initial scraping
3. **Historical analysis**: Track price trends to identify outliers
4. **Automated alerts**: Notify when quality drops below thresholds
5. **Region-specific extraction**: Customize patterns by geographical region

## Support

For issues or questions about the data quality cleanup system:
1. Check the logs for specific error messages
2. Run analysis tools to understand the scope of issues
3. Test with small samples before full cleanup runs
4. Monitor database changes after cleanup operations 