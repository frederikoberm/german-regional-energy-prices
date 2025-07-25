# Data Quality Cleanup - Quick Start Guide

This guide will help you quickly identify and fix data quality issues in your electricity price database.

## 🚀 Quick Start

### 1. Check Current Data Quality
```bash
# Analyze current data quality issues
npm run cleanup:analyze

# Or specifically check big cities (most problematic)
npm run analyze:cities
```

### 2. Test Cleanup on Small Sample
```bash
# Test cleanup on first 10 problematic entries
npm run cleanup:test
```

### 3. Run Full Cleanup
```bash
# Clean all problematic entries
npm run cleanup:run

# Or clean specific month
npm run cleanup:month 2025-01-01
```

## 🔍 Investigation Tools

### Analyze Specific Issues
```bash
# Full analysis of all data quality problems
npm run analyze:issues

# Analyze only big city price issues
npm run analyze:cities

# Investigate a specific URL
npm run analyze:url "https://www.stromauskunft.de/strompreise/10115/"
```

### Direct Script Usage
```bash
# Analysis with more options
node scripts/run-data-cleanup.js --analyze-only --month 2025-01-01

# Cleanup with limits
node scripts/run-data-cleanup.js --max-entries 50

# Detailed URL investigation
node scripts/analyze-price-issues.js --url "https://example.com/prices"
```

## 📊 What Gets Fixed

The cleanup system automatically identifies and fixes:

1. **🚨 Price Outliers** (>€1.00/kWh)
   - Common in big cities due to complex page layouts
   - Usually caused by extraction from wrong table sections

2. **💥 Extreme Outliers** (>€1.50/kWh)
   - Almost certainly extraction errors
   - Often from business pricing or promotional content

3. **❓ Missing Prices** 
   - Entries with only lokaler OR öko price
   - Due to page structure changes or failed extractions

4. **⚠️ Invalid Relationships**
   - Lokaler price cheaper than öko price
   - Illogical and indicates extraction from wrong sources

## 🛠️ How It Works

1. **Scan Database**: Identifies problematic entries using quality rules
2. **Re-scrape Pages**: Fetches original web pages again with enhanced extraction
3. **Enhanced Extraction**: Uses 3 strategies:
   - Enhanced table extraction (filters ads/comparisons)
   - Improved regex patterns (handles multiple formats)
   - Context-aware extraction (understands page structure)
4. **Validate Results**: Ensures new prices are logical and reasonable
5. **Update Database**: Replaces bad data with validated correct data

## 📈 Expected Results

Typical success rates:
- **Price Outliers**: 70-85% success rate
- **Missing Prices**: 60-75% success rate  
- **Invalid Relationships**: 80-90% success rate

Big cities may have lower success rates due to complex page layouts.

## ⚡ Quick Commands Reference

```bash
# Essential commands
npm run cleanup:analyze    # Check what needs fixing
npm run cleanup:test      # Test on 10 entries
npm run cleanup:run       # Fix all issues

# Investigation commands  
npm run analyze:cities    # Focus on big city issues
npm run analyze:issues    # Comprehensive analysis

# Monthly cleanup workflow
npm run cleanup:analyze
npm run cleanup:month $(date +%Y-%m-01)
```

## 🔧 Configuration

### Environment Setup
Ensure these are set in your `.env` file:
```env
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Adjust Thresholds (Optional)
Edit `services/data-quality-cleanup.js` if needed:
```javascript
this.validationThresholds = {
    min_price: 0.05,              // Minimum reasonable price
    max_reasonable_price: 0.80,   // Most prices under 80 cents
    outlier_threshold: 1.0,       // Prices over €1 are suspicious
    extreme_threshold: 1.50       // Prices over €1.50 almost certainly wrong
};
```

## 🚨 Important Notes

1. **Always analyze first** before running cleanup to understand scope
2. **Test on small samples** before processing large datasets
3. **Monitor success rates** - low rates may indicate website changes
4. **Be respectful** - system includes 2-second delays between requests
5. **Check results** - review database updates after cleanup runs

## 🆘 Troubleshooting

**No improvements found**: Website may have changed structure
**Database errors**: Check Supabase connection and credentials  
**High failure rates**: May need to update extraction patterns
**Script permissions**: Run `chmod +x scripts/*.js` if needed

For detailed documentation, see `docs/DATA_QUALITY_CLEANUP.md` 