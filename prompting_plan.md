## 🎯 **PROMPTING PLAN: Electricity Price Scraper → API Service**

---

## **PHASE 1: Database Foundation & Monthly Storage**

### **Prompt 1.1: Supabase Setup & Schema Design**

```
I need to set up a Supabase database for storing German electricity price data by month.

Current data structure (from CSV):
- PLZ (postal code)
- City name
- Latitude/Longitude coordinates
- Lokaler_Versorger_Price_EUR_per_kWh
- Oekostrom_Price_EUR_per_kWh
- Average_Price_EUR_per_kWh
- Source_URL
- Data_Source (ORIGINAL or FALLBACK)
- Source_PLZ (for fallback data)
- Distance_km (distance to source)
- Is_Outlier (quality flag)
- Outlier_Severity (normal/high/very_high)

Requirements:
1. Design tables for monthly price storage (e.g., data scraped in July 2025 should be queryable as "2025/july")
2. Handle both original scraped data and geographic fallback data
3. Store quality metadata (outliers, validation status)
4. Enable efficient querying by PLZ and month
5. Consider data deduplication (same month, same PLZ shouldn't have duplicates)
6. Include indexes for performance

Please provide:
- SQL schema for tables
- Supabase client setup in Node.js
- Environment variable configuration
- Basic CRUD operations examples

```

### **Prompt 1.2: Database Connection & Operations Module**

```
Create a Node.js module for Supabase database operations that will replace the current CSV storage system.

Requirements:
1. Connection management with environment variables
2. Functions for:
   - Storing scraped price data for a specific month
   - Retrieving price data by PLZ and month
   - Checking if data already exists for a month/PLZ combination
   - Bulk insert operations (for batch scraping)
   - Data validation before insertion

3. Error handling and logging
4. Connection pooling if needed
5. Month formatting standardization (e.g., "2025-07" or similar)

The module should be easily importable and replace the current CSV writing logic in the scraper.

Current CSV structure reference: [provide the CSV columns from analysis]

```

---

## **PHASE 2: Scraper Refactoring for Database Storage**

### **Prompt 2.1: Modular Scraper Architecture**

```
Refactor the current monolithic stromauskunft_scraper_batched.js into a modular architecture for better maintainability and future handover to a tech team.

Current scraper analysis:
- Scrapes from stromauskunft.de
- Has price extraction logic with outlier detection
- Uses batching and state management
- Handles geographic completion for missing data

New architecture requirements:
1. **Scraper Core Module**: Abstract the main scraping logic
2. **Source Adapters**: Pluggable modules for different data sources (currently stromauskunft.de, but easily extensible)
3. **Price Extraction Module**: Separate the HTML parsing and price extraction logic
4. **Quality Validation Module**: Outlier detection and validation as separate concern
5. **Geographic Completion Module**: Separate the fallback logic
6. **Database Storage Module**: Replace CSV with Supabase operations
7. **Configuration Module**: Centralized settings (URLs, delays, thresholds, etc.)

Each module should:
- Have clear interfaces and dependencies
- Be easily testable
- Include comprehensive logging
- Have clear documentation for future teams

Please start with the overall architecture design and interfaces.
```

### **Prompt 2.2: Source Adapter Implementation**

```
Create a source adapter system for the electricity price scraper that makes it easy for future teams to add new data sources or modify existing ones.

Current source: stromauskunft.de with specific URL patterns and HTML structure

Requirements:
1. **Base Source Adapter Interface**: Define the contract that all adapters must implement
2. **Stromauskunft Adapter**: Refactor current scraping logic into this adapter
3. **Configuration per adapter**: URLs, delays, parsing rules, etc.
4. **Error handling and retry logic**: Standardized across all adapters
5. **Rate limiting**: Configurable per source
6. **Response validation**: Ensure data quality before returning

Interface should include:
- `scrapeCity(cityName, plz)` → returns price data or null
- `validateResponse(data)` → quality checks
- `getSourceInfo()` → metadata about the source
- Configuration options for delays, timeouts, etc.

Make it obvious to future developers how to add a new source (like a different German energy comparison site).

```

### **Prompt 2.3: Monthly Scraping Orchestrator**

```
Create a main orchestrator that manages the monthly scraping process and stores data in Supabase with proper month tagging.

Requirements:
1. **Month Detection**: Automatically determine current month for data storage
2. **Duplicate Prevention**: Don't re-scrape data that already exists for the current month
3. **Batch Processing**: Maintain the current efficient batching but store in database
4. **State Management**: Track progress in database instead of JSON files
5. **Resume Capability**: Pick up where left off if interrupted
6. **Quality Reporting**: Generate monthly quality reports after scraping
7. **Geographic Completion**: Run fallback logic for missing data and store as FALLBACK type

Integration points:
- Use the new modular scraper architecture
- Store results in Supabase with month metadata
- Support command line arguments for manual month override
- Comprehensive logging and progress tracking

The system should make it obvious when data was scraped and prevent accidental re-scraping of the same month.

```

---

## **PHASE 3: API Layer Development**

### **Prompt 3.1: Express.js API Foundation**

```
Create a Node.js Express API for accessing the electricity price data stored in Supabase.

Core endpoints needed:
1. `GET /price/{plz}/{year}/{month}` - Get price for specific PLZ and month
2. `GET /price/{plz}/latest` - Get most recent price data for PLZ
3. `GET /average/{year}/{month}` - Get national averages for a month
4. `GET /coverage/{year}/{month}` - Get data coverage statistics for a month
5. `GET /health` - API health check
6. `GET /months` - List available months of data

Requirements:
- Express.js framework (no TypeScript, plain JavaScript)
- Input validation and sanitization
- Error handling with proper HTTP status codes
- Response formatting standardization
- CORS configuration
- Request logging
- Environment-based configuration (dev/prod)

Response format should be consistent and include metadata like data source, quality flags, etc.

```

### **Prompt 3.2: Authentication & Authorization**

```
Implement authentication for the electricity price API using a simple but effective approach suitable for future handover.

Requirements:
1. **API Key Authentication**: Simple key-based auth for external users
2. **User Management**: Basic user registration and key generation
3. **Rate Limiting**: Per-user/key rate limits
4. **Usage Tracking**: Log API usage per user/key
5. **Admin Endpoints**: For managing users and viewing usage stats
6. **Security Headers**: Basic security middleware

Implementation approach:
- Store API keys in Supabase (hashed)
- Middleware for authentication
- Simple admin interface (can be basic HTML + endpoints)
- Environment variables for admin credentials
- Clear documentation for users

Keep it simple but professional - easy for a tech team to understand and extend later.

```

### **Prompt 3.3: API Documentation & Testing**

```
Create comprehensive API documentation and testing setup for the electricity price API.

Documentation requirements:
1. **OpenAPI/Swagger specification**: Complete API documentation
2. **Interactive documentation**: Swagger UI setup
3. **Usage examples**: cURL and JavaScript examples
4. **Error responses**: Document all possible error scenarios
5. **Authentication guide**: How to get and use API keys
6. **Rate limiting info**: Current limits and policies

Testing requirements:
1. **Unit tests**: For core functions and utilities
2. **Integration tests**: API endpoint testing
3. **Database tests**: Supabase operations testing
4. **Mock data**: Test data sets for development
5. **Performance tests**: Basic load testing setup

The documentation should be clear enough for external developers to integrate easily, and the tests should give confidence to future teams making changes.

```

---

## **PHASE 4: Production Readiness & Handover**

### **Prompt 4.1: Deployment & Infrastructure**

```
Prepare the electricity price API for production deployment with focus on simplicity and maintainability.

Requirements:
1. **Docker setup**: Containerize the application
2. **Environment configuration**: Clear separation of dev/staging/prod configs
3. **Health monitoring**: Basic health checks and logging
4. **Database migrations**: Version-controlled Supabase schema changes
5. **Backup strategy**: Regular data backups
6. **CI/CD pipeline**: Simple deployment automation (GitHub Actions or similar)
7. **Monitoring**: Basic application monitoring setup

Deployment targets to consider:
- Simple VPS (like DigitalOcean Droplet)
- Cloud platforms (Railway, Render, etc.)
- Provide multiple options for flexibility

Include clear deployment instructions that a tech team can follow.

```

### **Prompt 4.2: Maintenance & Operations Guide**

```
Create comprehensive documentation for ongoing maintenance and operations of the electricity price system.

Documentation sections:
1. **System Architecture Overview**: How all components work together
2. **Monthly Operations**: How to run scraping, verify data quality, handle issues
3. **Database Management**: Backup/restore, performance monitoring, scaling
4. **API Management**: User management, monitoring, rate limit adjustments
5. **Adding New Data Sources**: Step-by-step guide for extending scrapers
6. **Troubleshooting Guide**: Common issues and solutions
7. **Performance Optimization**: Database indexing, API caching, etc.
8. **Security Checklist**: Regular security maintenance tasks

The guide should enable a tech team to:
- Take over operations immediately
- Understand how to modify and extend the system
- Handle common operational issues
- Add new features confidently

Include decision trees for common scenarios (e.g., "What to do if scraping fails", "How to add a new energy comparison site").

```

---

## **🔄 EXECUTION STRATEGY**

### **Immediate Next Steps:**

1. **Start with Phase 1.1** - Get Supabase database design right first
2. **Validate with a small test** - Implement one module and test it with a subset of your current data
3. **Iterate quickly** - Each prompt should build on the previous results

### **Parallel Development:**

- **Database & Scraper work** can happen in parallel after Phase 1.1
- **API development** should wait until database integration is solid
- **Documentation** can be written alongside development

### **Success Criteria for Each Phase:**

- **Phase 1**: Can store and retrieve monthly price data from Supabase
- **Phase 2**: Can run monthly scraping and store results in database
- **Phase 3**: Can query price data via API with authentication
- **Phase 4**: System is ready for tech team handover

### **Validation Points:**

After each major prompt, test with:

- Your existing CSV data (migration test)
- A small subset of PLZs (functionality test)
- Month-based queries (API test)

Would you like me to help you start with Phase 1.1 (Supabase setup), or would you prefer to adjust this plan first?