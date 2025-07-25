# 📅 Monthly Electricity Price Data Collection Process

**Target Month Example:** August 2025 (`2025-08-01`)

This guide covers the complete monthly workflow for collecting, cleaning, and completing German electricity price data.

---

## 🚀 Step 1: Data Scraping

### 1.1 Run the Main Scraper
```bash
# Start the scraping process for August 2025
node scrapers/smart-single-scraper.js
```

**What to expect:**
- Scraper will process thousands of German PLZ codes
- Success rate typically 60-70% (some PLZs will fail)
- Failed attempts are logged to `logs/scraper-errors-YYYY-MM-DD.jsonl`
- Successful data goes to database with `data_source: 'ORIGINAL'`

**Duration:** 2-4 hours depending on network and proxy setup

### 1.2 Monitor Progress
```bash
# Check current database status
node -e "
const SupabaseClient = require('./database/supabase-client');
async function check() {
  const db = new SupabaseClient();
  const { count } = await db.supabase
    .from('monthly_electricity_prices')
    .select('*', { count: 'exact', head: true })
    .eq('data_month', '2025-08-01');
  console.log('Current entries for August 2025:', count);
  await db.close?.();
}
check();
"
```

---

## 🔧 Step 2: Fix Data Quality & Outliers

### 2.1 Run Data Quality Analysis
```bash
# Analyze price outliers and quality issues
node scripts/analyze-price-issues.js

# Check for missing oeko prices specifically  
node scripts/investigate-missing-oeko.js

# Investigate suspiciously high prices
node scripts/investigate-high-prices.js
```

### 2.2 Fix Identified Issues
```bash
# Fix missing oeko prices using enhanced extraction
node scripts/fix-missing-oeko.js

# Fix outlier high prices 
node scripts/fix-high-prices.js

# Run comprehensive data cleanup
node scripts/run-data-cleanup.js
```

**What these scripts do:**
- **Missing Oeko Prices:** Re-extract eco electricity prices using improved methods
- **High Price Outliers:** Identify and fix prices that are 2-3x higher than regional averages
- **Data Validation:** Ensure price relationships make sense (average vs components)
- **Quality Flags:** Mark entries with `is_outlier: true` and appropriate severity levels

### 2.3 Verify Quality Improvements
```bash
# Check data quality stats after fixes
node -e "
const SupabaseClient = require('./database/supabase-client');
async function check() {
  const db = new SupabaseClient();
  
  // Get outlier count
  const { count: outliers } = await db.supabase
    .from('monthly_electricity_prices')
    .select('*', { count: 'exact', head: true })
    .eq('data_month', '2025-08-01')
    .eq('is_outlier', true);
  
  // Get missing oeko count
  const { count: missingOeko } = await db.supabase
    .from('monthly_electricity_prices')
    .select('*', { count: 'exact', head: true })
    .eq('data_month', '2025-08-01')
    .is('oekostrom_price', null);
  
  console.log('Outliers remaining:', outliers);
  console.log('Missing oeko prices:', missingOeko);
  await db.close?.();
}
check();
"
```

---

## 📍 Step 3: Fill Missing PLZ Codes

### 3.1 Run the Neighbor Filling Script
```bash
# Fill missing PLZ codes with closest geographic neighbors
node scripts/fill-missing-plz-with-neighbors.js
```

**What this script does:**
- Analyzes error logs to find failed PLZ codes
- Loads coordinates from `utils/Postleitzahlen Deutschland.csv`
- Finds closest successful PLZ for each failed one using geographic distance
- Creates fallback entries marked as `data_source: 'FALLBACK'`
- Tracks source PLZ and distance (typically 5-15km)

**Expected output:**
```
✅ Found 2,500+ unique failed PLZ codes from logs
✅ Loaded coordinates for 8,934 PLZ codes  
✅ Loaded 5,000+ successful PLZ entries from database
✅ Created 2,000+ fallback entries
📊 Distance statistics:
   Average distance: 5.7 km
   Maximum distance: 24.57 km
```

### 3.2 Verify Final Coverage
```bash
# Check final database coverage
node -e "
const SupabaseClient = require('./database/supabase-client');
async function check() {
  const db = new SupabaseClient();
  
  const { count } = await db.supabase
    .from('monthly_electricity_prices')
    .select('*', { count: 'exact', head: true })
    .eq('data_month', '2025-08-01');
  
  // Get breakdown by source
  const { data } = await db.supabase
    .from('monthly_electricity_prices')
    .select('data_source')
    .eq('data_month', '2025-08-01')
    .limit(10000);
  
  const counts = {};
  data.forEach(row => counts[row.data_source] = (counts[row.data_source] || 0) + 1);
  
  console.log('📊 Final Coverage for August 2025:');
  console.log('   Total entries:', count);
  console.log('   ORIGINAL entries:', counts.ORIGINAL || 0);
  console.log('   FALLBACK entries:', counts.FALLBACK || 0);
  console.log('   Coverage: ~' + Math.round((count / 8934) * 100) + '% of German PLZ codes');
  
  await db.close?.();
}
check();
"
```

---

## 🎯 Expected Final Results

### ✅ Success Metrics:
- **Coverage:** 85-90% of all German PLZ codes (~7,500-8,000 entries)
- **Data Quality:** <5% outliers, <2% missing oeko prices
- **Accuracy:** Fallback entries within 10km of source on average

### 📊 Typical Breakdown:
- **ORIGINAL entries:** ~5,500 (successful scraping)
- **FALLBACK entries:** ~2,500 (geographic neighbors)
- **Total coverage:** ~8,000 PLZ codes

---

## 🚨 Troubleshooting

### Common Issues:

**1. Scraper Fails Early**
```bash
# Check logs for errors
tail -f logs/scraper-errors-$(date +%Y-%m-%d).jsonl

# Restart with proxy rotation if needed
node scrapers/rotating-proxy-scraper.js
```

**2. Database Connection Issues**
```bash
# Test database connection
node -e "
const SupabaseClient = require('./database/supabase-client');
const db = new SupabaseClient();
db.testConnection().then(() => console.log('✅ DB OK')).catch(console.error);
"
```

**3. Duplicate Key Errors**
- The neighbor filling script automatically handles existing entries
- If you see duplicates, the data is already in the database from a previous run

**4. Low Coverage (<80%)**
- Check if CSV file `utils/Postleitzahlen Deutschland.csv` is present and complete
- Verify scraper logs show reasonable success rate
- Re-run neighbor filling script

---

## 📁 Important Files

- **Scrapers:** `scrapers/smart-single-scraper.js`, `scrapers/modular-scraper.js`
- **Quality Scripts:** `scripts/fix-*.js`, `scripts/analyze-*.js`
- **Neighbor Filling:** `scripts/fill-missing-plz-with-neighbors.js`
- **PLZ Data:** `utils/Postleitzahlen Deutschland.csv`
- **Logs:** `logs/scraper-errors-*.jsonl`

---

## ⏱️ Estimated Timeline

- **Step 1 (Scraping):** 2-4 hours
- **Step 2 (Quality Fixes):** 30-60 minutes  
- **Step 3 (Fill Missing):** 5-10 minutes
- **Total:** 3-5 hours for complete monthly update

---

*Last Updated: July 2025* 