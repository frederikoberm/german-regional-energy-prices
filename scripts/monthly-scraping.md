# Monthly Scraping Workflow

## 🏠 Local Scraping Process

### 1. Run Monthly Scraping (Local Machine)
```bash
# Full scraping of all German cities
npm run scrape

# Or test with subset first
npm run test:500

# Check scraping status
npm run scrape:status
```

### 2. Verify Data in Supabase
```bash
# Test database connection
npm run db:test

# Check available months
npm run api:dev
curl http://localhost:3000/api/v1/months
```

### 3. Deploy API to Vercel
```bash
# Deploy to production
npm run deploy:vercel

# Or preview deployment first
npm run deploy:preview
```

## ⏰ Automated Monthly Scraping

### Option 1: Cron Job (Linux/Mac)
```bash
# Edit crontab
crontab -e

# Add line to run on 1st of each month at 2 AM
0 2 1 * * cd /path/to/regional_energy_prices && npm run scrape
```

### Option 2: Task Scheduler (Windows)
- Open Task Scheduler
- Create Basic Task
- Set trigger: Monthly, 1st day, 2:00 AM
- Action: Start Program
- Program: `node`
- Arguments: `scrapers/modular-scraper.js`
- Start in: `C:\path\to\regional_energy_prices`

### Option 3: Simple Script
```bash
#!/bin/bash
# monthly-scrape.sh

cd /path/to/regional_energy_prices
echo "Starting monthly scraping at $(date)"

# Run scraping
npm run scrape

# Check if successful
if [ $? -eq 0 ]; then
    echo "Scraping completed successfully!"
    
    # Optional: Deploy updated API
    npm run deploy:vercel
else
    echo "Scraping failed!"
    exit 1
fi
```

## 🔍 Monitoring

### Check API Health
```bash
# Your deployed API
curl https://your-app.vercel.app/health

# Local testing
curl http://localhost:3000/health
```

### Check Data Freshness
```bash
# See latest available month
curl https://your-app.vercel.app/api/v1/months
```

## 📊 Data Flow

```
Local Machine → Supabase → Vercel API → Users
     ↓
[Monthly Scraping] → [Database] → [API Serving] → [Consumers]
```

### Benefits:
- ✅ Reliable scraping environment (local)
- ✅ Scalable API serving (Vercel)
- ✅ Managed database (Supabase)
- ✅ Low costs
- ✅ Easy maintenance 