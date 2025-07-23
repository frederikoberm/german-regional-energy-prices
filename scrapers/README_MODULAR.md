# 🏗️ Modular Electricity Price Scraper v2.0

A completely refactored, modular architecture for scraping German electricity prices with database storage and monthly organization.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Set up environment (copy and edit .env.example to .env)
cp .env.example .env

# Validate setup
npm run scrape:validate

# Start scraping
npm run scrape
```

## 📋 Table of Contents

- [Architecture Overview](#-architecture-overview)
- [Key Features](#-key-features)
- [Command Line Usage](#-command-line-usage)
- [Module Documentation](#-module-documentation)
- [Configuration](#-configuration)
- [Migration from Legacy System](#-migration-from-legacy-system)
- [Development Guide](#-development-guide)
- [Troubleshooting](#-troubleshooting)

## 🏛️ Architecture Overview

The modular scraper follows a clean architecture pattern with clear separation of concerns:

```
scrapers/modules/
├── config.js                 # Centralized configuration
├── interfaces.js             # Interface definitions
├── core/
│   └── scraper-core.js       # Main orchestration logic
├── adapters/
│   └── stromauskunft-adapter.js    # Source-specific scraping
├── extractors/
│   └── stromauskunft-extractor.js  # HTML parsing & price extraction
├── quality/
│   └── quality-validator.js        # Outlier detection & validation
├── storage/
│   └── supabase-storage.js         # Database operations
├── state/
│   └── database-state-manager.js   # Session state management
└── factory/
    └── scraper-factory.js          # Module assembly & dependency injection
```

### Core Principles

- **📦 Modular**: Each component has a single responsibility
- **🔌 Pluggable**: Easy to swap implementations (different sources, storage backends)
- **🧪 Testable**: Clear interfaces enable isolated testing
- **📈 Scalable**: Components can be optimized independently
- **🔄 Resumable**: Built-in state management for interrupted sessions

## ✨ Key Features

### 🗄️ Database Integration
- **Monthly partitioning** - Data organized by month for efficient querying
- **Duplicate prevention** - Automatic detection and handling of existing data
- **Session tracking** - Complete audit trail of scraping sessions
- **Quality metrics** - Built-in data quality monitoring

### 🎯 Smart Scraping
- **Multiple extraction strategies** - Table parsing with regex fallback
- **Outlier detection** - Automatic identification of suspicious prices
- **Rate limiting** - Respectful scraping with configurable delays
- **Error recovery** - Robust error handling with retry logic

### 🔧 Developer Experience
- **Easy configuration** - Environment-based settings
- **Clear logging** - Detailed progress and error reporting
- **CLI interface** - Rich command-line options
- **State resumption** - Pick up where you left off

## 🖥️ Command Line Usage

### Basic Commands

```bash
# Default scraping (current month)
npm run scrape

# Test mode (faster, smaller batches)
npm run scrape:test

# Force re-scrape existing data
npm run scrape:force

# Show current status
npm run scrape:status

# Reset all progress
npm run scrape:reset

# Validate setup without scraping
npm run scrape:validate

# Show help
npm run scrape:help
```

### Advanced Usage

```bash
# Scrape specific month
node scrapers/modular-scraper.js --month 2025-01

# Use custom input file
node scrapers/modular-scraper.js --input "my-cities.csv"

# Override batch configuration
node scrapers/modular-scraper.js --batch-size 3

# Combine options
node scrapers/modular-scraper.js --test --force --month 2024-12
```

### Command Line Options

| Option | Short | Description |
|--------|-------|-------------|
| `--help` | `-h` | Show help message |
| `--force` | `-f` | Force re-scrape existing data |
| `--test` | `-t` | Use test configuration |
| `--reset` | `-r` | Reset all progress |
| `--status` | `-s` | Show status and exit |
| `--validate` | `-v` | Validate components only |
| `--month MONTH` | `-m` | Specify month (YYYY-MM) |
| `--input FILE` | `-i` | Input CSV file |
| `--batch-size SIZE` | `-b` | Override batch size |

## 📚 Module Documentation

### 🎛️ Configuration Module (`config.js`)

Centralized configuration management with environment-specific settings.

```javascript
const ScraperConfig = require('./modules/config');
const config = new ScraperConfig();

// Access settings
const delays = config.getDelays();
const outlierThresholds = config.getOutlierThresholds();
const dbConfig = config.getDatabaseConfig();
```

**Key Features:**
- Environment-based configuration (dev/prod/test)
- Validation of configuration values
- Easy override for testing
- Typed configuration getters

### 🔌 Source Adapter (`adapters/stromauskunft-adapter.js`)

Handles source-specific scraping logic and HTTP requests.

```javascript
const adapter = new StromauskunftAdapter(config, extractor);

// Scrape a city
const result = await adapter.scrapeCity('Hamburg', '20095');

// Get adapter info
const info = adapter.getSourceInfo();
const performance = adapter.getPerformanceStats();
```

**Responsibilities:**
- HTTP request management
- URL construction and normalization
- Response validation
- Error handling and retries
- Performance tracking

### 🔍 Price Extractor (`extractors/stromauskunft-extractor.js`)

Specialized HTML parsing and price extraction.

```javascript
const extractor = new StromauskunftExtractor(config);

// Extract prices from HTML
const prices = extractor.extractPrices(html, pageText, url);

// Multiple extraction strategies
const strategies = extractor.getStrategies();
// ['tableFirst', 'regexFallback']
```

**Extraction Strategies:**
1. **Table-first**: Clean table parsing (preferred)
2. **Regex fallback**: Pattern matching for missing data
3. **Summary sections**: Structured data extraction

### 🎯 Quality Validator (`quality/quality-validator.js`)

Comprehensive data quality validation and outlier detection.

```javascript
const validator = new QualityValidator(config);

// Detect outliers
const outliers = validator.detectOutliers(lokalerPrice, oekoPrice);

// Validate price data
const validation = validator.validatePriceData(priceData);

// Generate quality metrics
const metrics = validator.getQualityMetrics(results);
```

**Quality Features:**
- Price range validation
- Outlier severity classification
- Price relationship analysis
- Quality scoring and reporting

### 🗄️ Database Storage (`storage/supabase-storage.js`)

Complete database integration with session management.

```javascript
const storage = new SupabaseStorage(config);

// Store price data
await storage.storePriceData(priceData);

// Bulk operations
await storage.bulkStorePriceData(priceDataArray);

// Session management
const session = await storage.startSession(month, totalCities, config);
await storage.updateSession(sessionId, progress);
await storage.completeSession(sessionId, summary);
```

**Storage Features:**
- Monthly data partitioning
- Automatic duplicate handling
- Session and error tracking
- Bulk insert optimization
- Query helpers

### 🔄 State Manager (`state/database-state-manager.js`)

Handles scraping session state and recovery.

```javascript
const stateManager = new DatabaseStateManager(config, storage);

// Load previous state
const state = await stateManager.loadState();

// Save current progress
await stateManager.saveState(currentState);

// Batch management
const batchInfo = stateManager.getCurrentBatch(cities, currentBatch);
await stateManager.completeBatch(batchNumber, results);
```

**State Features:**
- Automatic state persistence
- Batch progress tracking
- Recovery from interruptions
- Completion estimation

### 🏭 Scraper Factory (`factory/scraper-factory.js`)

Assembles and configures all modules with dependency injection.

```javascript
const factory = new ScraperFactory();

// Create complete scraper
const { scraper, scraperId, config } = await factory.createScraper();

// Test configuration
const { scraper } = await factory.createTestScraper();

// Validate components
const results = await factory.testComponents();
```

**Factory Features:**
- Dependency injection
- Component validation
- Test configurations
- Resource cleanup

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with your configuration:

```env
# Supabase (Required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Scraping (Optional)
SCRAPER_DELAY=1000
DB_BATCH_SIZE=100
NODE_ENV=development
LOG_LEVEL=info
ENABLE_SCRAPING_LOGS=true
```

### Configuration Override

```javascript
// Custom configuration
const customConfig = {
    delays: {
        betweenRequests: 500,  // Faster scraping
        maxRetries: 5          // More retries
    },
    batching: {
        totalBatches: 3        // Fewer, larger batches
    }
};

const { scraper } = await factory.createScraper({
    config: customConfig
});
```

### Test Configuration

Test mode automatically applies optimized settings:

```javascript
// Test mode settings
{
    delays: { betweenRequests: 100 },
    batching: { totalBatches: 2 },
    logging: { level: 'warn' }
}
```

## 🔄 Migration from Legacy System

The new modular system can run alongside the legacy scraper during transition.

### Running Both Systems

```bash
# Legacy scraper (CSV output)
npm run scrape:legacy

# New modular scraper (database output)
npm run scrape
```

### Data Migration

The database schema includes all fields from the CSV system:

```sql
-- Legacy CSV columns are preserved
lokaler_versorger_price -> lokaler_versorger_price
oekostrom_price -> oekostrom_price
average_price -> average_price
is_outlier -> is_outlier
outlier_severity -> outlier_severity
-- Plus new database-specific fields
data_month, source_url, extraction_method, etc.
```

### Gradual Migration Strategy

1. **Phase 1**: Validate new system with test mode
2. **Phase 2**: Run both systems in parallel
3. **Phase 3**: Compare outputs for consistency
4. **Phase 4**: Switch to modular system
5. **Phase 5**: Archive legacy system

## 🛠️ Development Guide

### Adding a New Data Source

1. **Create Source Adapter**:
```javascript
// scrapers/modules/adapters/new-source-adapter.js
class NewSourceAdapter extends ISourceAdapter {
    async scrapeCity(cityName, plz) {
        // Implement scraping logic
    }
    // ... implement all interface methods
}
```

2. **Create Price Extractor**:
```javascript
// scrapers/modules/extractors/new-source-extractor.js
class NewSourceExtractor extends IPriceExtractor {
    extractPrices(html, pageText, url) {
        // Implement extraction logic
    }
    // ... implement all interface methods
}
```

3. **Update Factory**:
```javascript
// Add to scraper-factory.js
createSourceAdapter(sourceType, config, extractor) {
    switch (sourceType.toLowerCase()) {
        case 'newsource':
            return new NewSourceAdapter(config, extractor);
        // ... existing cases
    }
}
```

4. **Update Configuration**:
```javascript
// Add to config.js
sources: {
    newsource: {
        baseUrl: 'https://new-source.com',
        // ... source-specific config
    }
}
```

### Running Tests

```bash
# Validate all components
npm run scrape:validate

# Test with minimal data
npm run scrape:test

# Component-specific testing
node -e "
const ScraperFactory = require('./scrapers/modules/factory/scraper-factory');
const factory = new ScraperFactory();
factory.testComponents().then(console.log);
"
```

### Debugging

Enable detailed logging:

```env
LOG_LEVEL=debug
ENABLE_SCRAPING_LOGS=true
```

View database sessions:
```sql
-- In Supabase SQL Editor
SELECT * FROM scraping_sessions ORDER BY started_at DESC LIMIT 10;
SELECT * FROM scraping_errors WHERE session_id = 'your-session-id';
```

## 🚨 Troubleshooting

### Common Issues

#### Database Connection Failed
```bash
npm run db:test
```
- Check `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Verify Supabase project is active
- Check network connectivity

#### "No valid prices found"
- Website structure may have changed
- Check extraction strategies in extractor module
- Enable detailed logging to see extraction attempts

#### "Duplicate key value" Error
- Data already exists for this month/PLZ
- Use `--force` to overwrite
- Check duplicate handling configuration

#### Scraping Too Slow
```bash
# Use test mode for faster scraping
npm run scrape:test

# Or reduce delays in configuration
NODE_ENV=test npm run scrape
```

#### Out of Memory
- Reduce batch size: `--batch-size 2`
- Check for infinite loops in extraction logic
- Monitor database connection pooling

### Getting Help

1. **Check logs**: Enable `ENABLE_SCRAPING_LOGS=true`
2. **Validate setup**: `npm run scrape:validate`
3. **Check status**: `npm run scrape:status`
4. **Review database**: Check `scraping_errors` table
5. **Test components**: Use factory test methods

### Performance Optimization

```javascript
// Optimize for speed
const speedConfig = {
    delays: { betweenRequests: 500 },
    batching: { totalBatches: 2 },
    database: { batchSize: 200 }
};

// Optimize for reliability
const reliableConfig = {
    delays: { betweenRequests: 2000, maxRetries: 5 },
    batching: { totalBatches: 10 },
    quality: { enableOutlierDetection: true }
};
```

## 🎯 Future Enhancements

The modular architecture enables easy extension:

- **🌍 Geographic Completion**: Automatic fallback for missing cities
- **📊 Advanced Analytics**: Real-time quality monitoring
- **🔄 Multiple Sources**: Easy addition of new price comparison sites
- **📱 API Integration**: RESTful API for accessing scraped data
- **⚡ Performance Optimization**: Parallel processing and caching
- **🤖 ML Integration**: Price prediction and anomaly detection

## 📝 License

This project maintains the same license as the original electricity price scraper.

---

**Built with ❤️ for the German energy market analysis community.** 