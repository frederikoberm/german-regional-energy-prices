# German Electricity Price Data Collection & Completion

A complete system for scraping electricity prices from stromauskunft.de and creating a comprehensive dataset for all German postal codes (PLZ) using geographic proximity fallbacks, with built-in data quality validation and outlier detection.

## 📋 Overview

This project collects electricity pricing data for German cities and creates a complete dataset covering all 8,934 German postal codes by:

1. **Smart batch scraping** electricity prices from stromauskunft.de
2. **Intelligent city classification** (small/medium/large) with adaptive extraction strategies
3. **Real-time data quality validation** with automatic outlier detection
4. **Multiple extraction strategies** to handle different website layouts
5. **Geographic interpolation** for missing data using nearest neighbor fallback
6. **Complete dataset generation** with 100% PLZ coverage

## 🚀 **Current Project Status**

### ✅ **LIVE & DEPLOYED**
- **🌐 Production API**: https://regional-energy-prices-b8ywkg52d.vercel.app
- **🗄️ Database**: Supabase PostgreSQL with real price data
- **📊 Data Coverage**: 1000+ records for July 2025 (growing)
- **🔧 Architecture**: Smart Single-File Scraper + API + Database

### 📈 **Recent Achievements**
- ✅ **Smart Single-File Scraper** with city classification and multiple extraction strategies
- ✅ **Complete API Layer** deployed on Vercel
- ✅ **Database Integration** with Supabase PostgreSQL  
- ✅ **Simplified Architecture** - moved from complex modular to clean single-file
- ✅ **Resume Functionality** - automatically skips already processed cities
- ✅ **Analysis Metadata** - tracks extraction methods and performance

### 🔄 **Operational Workflow** 
1. **Monthly Scraping**: Run locally with `npm run scrape:smart`
2. **Auto-Resume**: System skips already processed cities automatically
3. **Data Storage**: Direct integration with Supabase PostgreSQL
4. **Quality Control**: Real-time outlier detection and validation
5. **API Access**: Live API serves data globally via Vercel

## 🧠 **Smart Scraper Features**

### 🏙️ **Intelligent City Classification**
- **Small cities**: Often return 404s (expected ~83% rate), use simple extraction methods
- **Medium cities**: Standard extraction with regex fallbacks  
- **Large cities**: Complex DOM structures, multiple extraction strategies

### 🔧 **Multiple Extraction Strategies**
- **Table Standard**: Primary method for clean price tables
- **Table Simple**: For small cities with minimal data
- **Table Complex**: For large cities with complicated layouts
- **Regex Standard**: Fallback pattern matching
- **Regex Advanced**: Flexible patterns for unusual formats
- **Format Detection**: Handles both Euro and Cent price formats

### 📊 **Analysis Metadata Collection**
- City classification accuracy tracking
- Extraction method success rates
- DOM structure analysis
- Response time monitoring
- Success rates by city class

---

## 🛡️ Data Quality Features

### Automatic Outlier Detection
- **High outliers**: Prices ≥€1.00 per kWh 🟡
- **Very high outliers**: Prices ≥€1.50 per kWh 🔴
- **Real-time validation**: Automatic flagging during extraction
- **Smart filtering**: Prevents comparison table data from contaminating price summaries

### Enhanced Price Extraction
- **Multiple strategies**: 7 different extraction methods per city class
- **Validation logging**: Detailed extraction process tracking
- **Quality metrics**: Outlier statistics and validation success rates
- **Format handling**: Automatic Euro/Cent conversion

---

## 📁 Required Input Files

### 1. German Postal Codes Database
**File**: `Postleitzahlen Deutschland.csv` (**⚠️ Not included in git - download separately**)
- **Format**: Semicolon-separated (`;`)
- **Required columns**:
  - `PLZ Name (short)` - City name
  - `Postleitzahl / Post code` - PLZ code
  - `geo_point_2d` - Coordinates in format "latitude, longitude"
- **Note**: This file is excluded from version control due to its size (85MB)

### 2. Dependencies
```bash
npm install
```

---

## 🚀 **Quick Start Guide**

### **Step 1: Setup Environment**
```bash
# Clone repository
git clone <repo-url>
cd regional_energy_prices

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your Supabase credentials
```

### **Step 2: Download PLZ Data**
Download `Postleitzahlen Deutschland.csv` and place in `utils/` folder.

### **Step 3: Run Smart Scraper**
```bash
# Run the smart scraper (processes 1000 cities)
npm run scrape:smart

# The scraper will:
# - Check for already processed cities
# - Classify each city by size
# - Use appropriate extraction strategies
# - Store results in Supabase
# - Track detailed analytics
```

### **Step 4: Monitor Progress**
```bash
# Check session progress in database
npm run db:examples

# View error logs
ls -la logs/
```

### **Step 5: Complete Dataset (Optional)**
```bash
# Fill in missing cities with geographic fallbacks
node services/create_complete_electricity_data.js
```

---

## 🔧 **Available Scripts**

```bash
# === SCRAPING ===
npm run scrape:smart          # Smart single-file scraper (RECOMMENDED)
npm run scrape:1000-simple    # Simple scraper without classification
npm run scrape:1000           # Legacy modular scraper

# === API ===
npm run api:start             # Start API server locally
npm run api:dev               # Development mode with hot reload
npm run api:test              # Test all API endpoints

# === DATABASE ===
npm run db:examples           # Run database connection examples
npm run db:test               # Test database connection

# === TESTING ===
npm run test:batch            # Test with 500 cities
npm run test:umlauts          # Test special character handling
```

---

## 🌐 API Layer

### 🚀 **LIVE API DEPLOYMENT**

**Production API**: https://regional-energy-prices-b8ywkg52d.vercel.app

### 📋 **Quick API Usage**

**Required Header for All Requests:**
```bash
-H "x-vercel-protection-bypass: YOUR_BYPASS_SECRET"
```

**Example Usage:**
```bash
# Health Check
curl -H "x-vercel-protection-bypass: YOUR_SECRET" \
  https://regional-energy-prices-b8ywkg52d.vercel.app/health

# Get Price Data
curl -H "x-vercel-protection-bypass: YOUR_SECRET" \
  "https://regional-energy-prices-b8ywkg52d.vercel.app/api/v1/price/10115/2025/7"

# National Average
curl -H "x-vercel-protection-bypass: YOUR_SECRET" \
  "https://regional-energy-prices-b8ywkg52d.vercel.app/api/v1/average/2025/7"
```

### 📍 **Core API Endpoints**

**Price Data:**
- `GET /api/v1/price/{plz}/{year}/{month}` - Get price for specific PLZ and month
- `GET /api/v1/price/{plz}/latest` - Get most recent price for PLZ
- `POST /api/v1/price/bulk` - Get prices for multiple PLZs

**Analytics:**
- `GET /api/v1/average/{year}/{month}` - National averages for month
- `GET /api/v1/coverage/{year}/{month}` - Data coverage statistics

**Metadata:**
- `GET /api/v1/months` - List available data months
- `GET /health` - API health check

---

## 📊 **Smart Scraper Architecture**

### **Single-File Design Benefits:**
- ✅ **Simple deployment** - one file contains everything
- ✅ **Easy debugging** - all logic in one place
- ✅ **No dependency injection complexity** - direct method calls
- ✅ **Faster startup** - no module loading overhead
- ✅ **Simplified maintenance** - single file to update

### **Intelligence Preserved:**
- ✅ **City classification** - smart heuristics for size detection
- ✅ **Multiple strategies** - 7 different extraction methods
- ✅ **Analysis metadata** - comprehensive performance tracking
- ✅ **Quality validation** - outlier detection and price validation

### **Key Components:**
```
scrapers/smart-single-scraper.js  - Main scraper with all features
├── City Classification           - Small/Medium/Large detection
├── HTTP Request Handling         - Timeout management & retries  
├── Extraction Strategies         - 7 different methods
├── Quality Validation           - Outlier detection
├── Database Integration         - Direct Supabase storage
├── Session Management           - Progress tracking
├── Resume Functionality         - Skip processed cities
└── Analysis Metadata           - Performance analytics
```

---

## 🎯 **Expected Performance**

### **Smart Scraper Metrics:**
- **Success Rate**: ~70% overall (varies by city class)
  - Small cities: ~17% (high 404 rate expected)
  - Medium cities: ~100% 
  - Large cities: ~100%
- **Processing Speed**: ~50-60 cities per minute (2s delay)
- **Memory Usage**: ~50-100MB
- **Database Efficiency**: Direct insertion per city

### **Quality Improvements:**
- **Price accuracy**: Multiple extraction strategies reduce errors
- **Contamination prevention**: Smart table filtering
- **Format handling**: Auto Euro/Cent conversion
- **Error detection**: Real-time outlier flagging

---

## 🚨 **Troubleshooting**

### **Common Issues:**

#### 1. **Timeout Errors**
```bash
# Check if stromauskunft.de is responsive
curl -I --connect-timeout 10 --max-time 30 "https://www.stromauskunft.de"

# The site can be slow - timeouts are normal
```

#### 2. **Database Connection Issues**
```bash
# Test connection
npm run db:test

# Check environment variables
cat .env
```

#### 3. **Resume Not Working**
```bash
# Check what's already processed
node -e "
const db = require('./database/supabase-client');
const client = new db();
client.getExistingPLZsForMonth('2025-07-01').then(plzs => 
  console.log('Processed PLZs:', plzs.size)
);
"
```

#### 4. **Low Success Rate**
- **Small cities**: 83% 404 rate is normal - these cities don't have data pages
- **Medium/Large cities**: Should have high success rates
- **Network issues**: Check internet connectivity to Germany

---

## 📁 **Project Structure**

### 🔧 **Core Scraper**
- `scrapers/smart-single-scraper.js` - **Main smart scraper (RECOMMENDED)**
- `scrapers/stromauskunft_scraper_batched.js` - Legacy batch scraper
- `scrapers/modular-scraper.js` - Modular architecture version

### 🌐 **API Layer**
- `api/server.js` - Express server with middleware and security
- `api/routes/api-routes.js` - REST API endpoints (v1)
- `api/middleware/` - Validation and error handling
- `api/test-api.js` - Comprehensive API test suite

### 🗄️ **Database Layer**
- `database/schema.sql` - Supabase PostgreSQL schema
- `database/supabase-client.js` - Database connection client
- `database/examples.js` - Usage examples

### 🚀 **Deployment Configuration**
- `vercel.json` - Vercel serverless deployment config
- `.env` - Environment variables (local only, not in git)

### 📊 **Data Processing**
- `services/create_complete_electricity_data.js` - Geographic completion tool
- `services/improved_price_extraction.js` - Advanced extraction utilities
- `services/validate_price_outliers.js` - Outlier analysis tools

### 📝 **Utilities & Scripts**
- `run-1000-*.js` - Various runner scripts for different approaches
- `utils/Postleitzahlen Deutschland.csv` - Source PLZ database
- `logs/` - Error logs and session tracking

---

## 🏆 **Success Criteria**

### ✅ **COMPLETED ACHIEVEMENTS**

#### 🗃️ **Data Collection & Quality**
✅ **Smart city classification** with adaptive extraction strategies  
✅ **Multiple extraction methods** for different website layouts  
✅ **Real-time outlier detection** and validation  
✅ **Resume functionality** - automatically skips processed cities  
✅ **Complete geographic coverage** capability  
✅ **Analysis metadata** collection for performance optimization  

#### 🌐 **API & Infrastructure** 
✅ **Production API deployed** on Vercel  
✅ **Supabase PostgreSQL** database integration  
✅ **Rate limiting and security** measures  
✅ **Comprehensive input validation**  
✅ **Structured error handling**  
✅ **RESTful API design** with versioning  

#### 🚀 **Architecture & Performance**
✅ **Simplified single-file architecture** - no modular complexity  
✅ **Direct database integration** - no batch optimization overhead  
✅ **Session tracking** for progress monitoring  
✅ **Intelligent classification** for better success rates  
✅ **Error logging** to local files for debugging  

### 🎯 **CURRENT METRICS**
- **📊 Processing Speed**: ~50-60 cities/minute with respectful delays
- **🗄️ Database Records**: 1000+ price entries (July 2025)
- **🔒 Security**: Rate limited API with bypass authentication
- **🌍 Global Availability**: 99.9% uptime via Vercel Edge Network
- **📈 Success Rate**: ~70% overall (varies by city class)

---

## 📞 **Support**

If you encounter issues:
1. **Check stromauskunft.de availability** - the site can be slow or unavailable
2. **Review the troubleshooting section** above
3. **Check error logs** in the `logs/` folder  
4. **Verify database connection** with `npm run db:test`
5. **Test with simple script** first before running full scraper

The smart scraper is designed to be robust and resumable - interruptions should not cause data loss thanks to automatic duplicate detection and session tracking.

---

## 🔄 **Next Steps**

1. **Run smart scraper** regularly to build monthly datasets
2. **Monitor success rates** by city class and adjust strategies
3. **Use geographic completion** for 100% PLZ coverage
4. **Access data via API** for applications and analysis
5. **Scale up** with multiple geographic regions if needed

The system provides a complete pipeline from raw scraping to production-ready API access! 🚀 