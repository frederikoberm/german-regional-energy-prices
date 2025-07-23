# 🗄️ Supabase Database Setup Guide

This guide will help you set up and configure the Supabase database for storing German electricity price data by month.

## 📋 Prerequisites

- [Supabase account](https://supabase.com) (free tier is sufficient to start)
- Node.js installed (version 14 or higher)

---

## 🚀 Step 1: Create Supabase Project

1. **Sign up/Login** to [Supabase](https://supabase.com)
2. **Create new project**:
   - Click "New Project"
   - Choose your organization
   - Enter project name: `german-electricity-prices`
   - Choose a strong database password (save this!)
   - Select region closest to you (Europe recommended for German data)
   - Click "Create new project"

3. **Wait for setup** (2-3 minutes)

---

## 🔧 Step 2: Database Schema Setup

### Method A: Using Supabase Dashboard (Recommended)

1. **Open SQL Editor**:
   - Go to your project dashboard
   - Click "SQL Editor" in the left sidebar
   - Click "New query"

2. **Run the schema**:
   - Copy the entire content from `database/schema.sql`
   - Paste it into the SQL editor
   - Click "Run" (or Ctrl+Enter)
   - You should see "Success. No rows returned"

3. **Verify tables created**:
   - Go to "Table Editor" in the left sidebar
   - You should see tables:
     - `monthly_electricity_prices`
     - `scraping_sessions`
     - `scraping_errors`
     - `monthly_quality_metrics`

### Method B: Using Node.js Script

```bash
# Run schema setup (after completing Step 3)
node database/setup-schema.js
```

---

## 🔑 Step 3: Get API Keys and Configure Environment

1. **Get API credentials**:
   - Go to "Settings" → "API" in your Supabase dashboard
   - Copy your "Project URL"
   - Copy your "anon/public" key

2. **Create environment file**:
   ```bash
   cp .env.example .env
   ```

3. **Configure `.env` file**:
   ```env
   # Replace with your actual values
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   
   NODE_ENV=development
   SCRAPER_DELAY=1000
   DB_BATCH_SIZE=100
   LOG_LEVEL=info
   ENABLE_SCRAPING_LOGS=true
   ```

---

## 📦 Step 4: Install Dependencies

```bash
npm install
```

This will install:
- `@supabase/supabase-js` - Supabase client library
- `dotenv` - Environment variable management

---

## ✅ Step 5: Test Connection

### Quick Test
```bash
npm run db:test
```

### Complete Examples
```bash
npm run db:examples
```

This will run comprehensive tests including:
- Database connection
- Insert operations
- Query operations
- Session management
- Error handling

---

## 📊 Step 6: Understanding the Schema

### Core Tables

#### 1. `monthly_electricity_prices`
Main storage for electricity price data, partitioned by month:

```sql
-- Key columns:
data_month      -- Month partition (YYYY-MM-01)
plz             -- German postal code
city_name       -- City name
latitude/longitude -- Geographic coordinates
lokaler_versorger_price -- Local provider price (EUR/kWh)
oekostrom_price -- Green energy price (EUR/kWh) 
average_price   -- Average price (EUR/kWh)
data_source     -- 'ORIGINAL' or 'FALLBACK'
source_plz      -- Source PLZ for fallback data
distance_km     -- Distance to source (0 for original)
is_outlier      -- Quality flag
outlier_severity -- 'normal', 'high', 'very_high'
```

#### 2. `scraping_sessions`
Tracks each monthly scraping run:

```sql
-- Key columns:
data_month      -- Month being scraped
status          -- 'running', 'completed', 'failed', 'paused'
total_cities    -- Target number of cities
processed_cities -- Progress counter
successful_cities -- Success counter
scraper_config  -- Configuration used (JSON)
```

#### 3. `scraping_errors`
Detailed error tracking:

```sql
-- Key columns:
session_id      -- Links to scraping_sessions
plz/city_name   -- Location where error occurred
error_type      -- Category of error
error_message   -- Detailed error description
retry_count     -- Number of retry attempts
```

### Key Features

- **Monthly Partitioning**: Data is organized by month for efficient querying
- **Deduplication**: Unique constraint prevents duplicate PLZ+month combinations
- **Quality Tracking**: Built-in outlier detection and data source tracking
- **Performance**: Optimized indexes for common query patterns
- **Session Management**: Complete scraping run tracking and error logging

---

## 🔍 Step 7: Common Operations

### Check if data exists for current month:
```javascript
const db = new SupabaseClient();
const currentMonth = db.getCurrentMonth();
const exists = await db.monthDataExists(currentMonth);
```

### Insert scraped data:
```javascript
const priceData = {
    plz: '20095',
    city_name: 'Hamburg',
    lokaler_versorger_price: 0.38,
    oekostrom_price: 0.25,
    average_price: 0.315,
    data_source: 'ORIGINAL',
    source_url: 'https://www.stromauskunft.de/...'
};

await db.insertPriceData(priceData);
```

### Query price data:
```javascript
// Get specific PLZ for current month
const hamburgData = await db.getPriceData('20095', currentMonth);

// Get latest data for any PLZ
const latestData = await db.getLatestPriceData('20095');

// Get monthly averages
const averages = await db.getMonthlyAverages(currentMonth);
```

---

## 🛠️ Step 8: Migration from CSV

If you have existing CSV data to migrate:

1. **Prepare data structure**:
   ```javascript
   // Convert CSV format to database format
   const dbRecord = {
       plz: csvRow.PLZ,
       city_name: csvRow.City,
       latitude: parseFloat(csvRow.Latitude),
       lokaler_versorger_price: parseFloat(csvRow.Lokaler_Versorger_Price_EUR_per_kWh),
       // ... other fields
       data_month: '2025-01-01' // Specify the month
   };
   ```

2. **Bulk insert**:
   ```javascript
   await db.bulkInsertPriceData(dbRecords);
   ```

3. **See full example**: Run `npm run db:examples` and check Example 8

---

## 🔒 Step 9: Security Considerations

### Row Level Security (Optional)
The schema includes RLS setup (commented out by default). Enable if you need multi-tenant access:

```sql
-- Enable RLS for API access control
ALTER TABLE monthly_electricity_prices ENABLE ROW LEVEL SECURITY;
```

### API Key Management
- **Never commit `.env` files** to version control
- **Use anon key** for client-side operations
- **Use service role key** only for admin operations server-side

---

## 📈 Step 10: Monitoring and Maintenance

### Supabase Dashboard Features:
- **Table Editor**: View and edit data directly
- **SQL Editor**: Run custom queries
- **Database**: Monitor performance and connections
- **Auth**: Manage users (if adding authentication later)
- **Storage**: For future file uploads (price charts, reports, etc.)

### Regular Maintenance:
- Monitor database size (free tier: 500MB)
- Review query performance in Dashboard
- Check error logs in `scraping_errors` table
- Monitor monthly coverage using views

---

## 🆘 Troubleshooting

### Common Issues:

#### "Connection failed"
- Check your `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- Verify project is active in Supabase dashboard
- Check network connectivity

#### "Permission denied"
- Make sure RLS is disabled for initial setup
- Verify you're using the correct API key
- Check table permissions in Supabase dashboard

#### "Duplicate key value"
- Data already exists for this month+PLZ combination
- Use `dataExists()` to check before inserting
- Consider updating instead of inserting

#### "Schema not found"
- Re-run the schema setup from `database/schema.sql`
- Check SQL Editor for any error messages
- Verify all tables were created

### Getting Help:
- Check [Supabase Documentation](https://supabase.com/docs)
- Review logs in `scraping_errors` table
- Run `npm run db:examples` to verify setup
- Check Supabase Dashboard → Database → Logs

---

## 🎯 Next Steps

After completing this setup:

1. **Test the system** with sample data using `npm run db:examples`
2. **Modify your scrapers** to use `SupabaseClient` instead of CSV
3. **Implement API layer** for data access
4. **Set up monitoring** for production use

The database is now ready to replace your CSV storage system with monthly data organization, better performance, and comprehensive quality tracking!

---

## 📚 Quick Reference

### Key Commands:
```bash
npm run db:test          # Test connection
npm run db:examples      # Run all examples
```

### Key Files:
- `database/schema.sql` - Database schema
- `database/supabase-client.js` - Main client library
- `database/examples.js` - Usage examples
- `.env` - Environment configuration 