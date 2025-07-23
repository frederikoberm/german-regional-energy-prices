-- ============================================
-- German Electricity Price Database Schema
-- Supabase/PostgreSQL Implementation
-- ============================================

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. MONTHLY PRICE DATA TABLE (Main storage)
-- ============================================

CREATE TABLE monthly_electricity_prices (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    
    -- Monthly partitioning
    data_month DATE NOT NULL, -- First day of the month (e.g., '2025-07-01' for July 2025)
    
    -- Location data
    plz VARCHAR(5) NOT NULL,
    city_name VARCHAR(100) NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Price data (in EUR per kWh)
    lokaler_versorger_price DECIMAL(6, 4),
    oekostrom_price DECIMAL(6, 4),
    average_price DECIMAL(6, 4),
    
    -- Data source tracking
    data_source VARCHAR(20) NOT NULL CHECK (data_source IN ('ORIGINAL', 'FALLBACK')),
    source_url TEXT,
    source_plz VARCHAR(5), -- For fallback data, which PLZ was used as source
    distance_km DECIMAL(8, 3) DEFAULT 0, -- Distance to source (0 for original data)
    
    -- Quality metadata
    is_outlier BOOLEAN DEFAULT FALSE,
    outlier_severity VARCHAR(15) DEFAULT 'normal' CHECK (outlier_severity IN ('normal', 'high', 'very_high')),
    
    -- Metadata
    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure no duplicates for same month + PLZ
    UNIQUE(data_month, plz)
);

-- ============================================
-- 2. SCRAPING SESSIONS TABLE (Track scraping runs)
-- ============================================

CREATE TABLE scraping_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    data_month DATE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'paused')),
    
    -- Progress tracking
    total_cities INTEGER,
    processed_cities INTEGER DEFAULT 0,
    successful_cities INTEGER DEFAULT 0,
    failed_cities INTEGER DEFAULT 0,
    fallback_cities INTEGER DEFAULT 0,
    
    -- Quality metrics
    outliers_detected INTEGER DEFAULT 0,
    high_severity_outliers INTEGER DEFAULT 0,
    
    -- Configuration used
    scraper_config JSONB,
    
    -- Notes and error summary
    notes TEXT,
    error_summary TEXT
);

-- ============================================
-- 3. SCRAPING ERRORS TABLE (Detailed error tracking)
-- ============================================

CREATE TABLE scraping_errors (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    session_id UUID REFERENCES scraping_sessions(id) ON DELETE CASCADE,
    
    -- Error details
    plz VARCHAR(5),
    city_name VARCHAR(100),
    error_type VARCHAR(50),
    error_message TEXT,
    source_url TEXT,
    
    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Additional context
    retry_count INTEGER DEFAULT 0,
    context_data JSONB
);

-- ============================================
-- 4. DATA QUALITY METRICS TABLE (Monthly aggregates)
-- ============================================

CREATE TABLE monthly_quality_metrics (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    data_month DATE NOT NULL UNIQUE,
    
    -- Coverage metrics
    total_plz_count INTEGER,
    original_data_count INTEGER,
    fallback_data_count INTEGER,
    coverage_percentage DECIMAL(5, 2),
    
    -- Price statistics
    avg_lokaler_versorger_price DECIMAL(6, 4),
    avg_oekostrom_price DECIMAL(6, 4),
    avg_overall_price DECIMAL(6, 4),
    
    -- Quality metrics
    outlier_count INTEGER,
    outlier_percentage DECIMAL(5, 2),
    high_severity_outlier_count INTEGER,
    
    -- Geographic distribution
    max_fallback_distance_km DECIMAL(8, 3),
    avg_fallback_distance_km DECIMAL(8, 3),
    
    -- Timestamps
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. INDEXES FOR PERFORMANCE
-- ============================================

-- Most common query patterns
CREATE INDEX idx_monthly_prices_month_plz ON monthly_electricity_prices(data_month, plz);
CREATE INDEX idx_monthly_prices_plz ON monthly_electricity_prices(plz);
CREATE INDEX idx_monthly_prices_month ON monthly_electricity_prices(data_month);
CREATE INDEX idx_monthly_prices_data_source ON monthly_electricity_prices(data_source);
CREATE INDEX idx_monthly_prices_outliers ON monthly_electricity_prices(is_outlier) WHERE is_outlier = TRUE;

-- Geographic queries
CREATE INDEX idx_monthly_prices_location ON monthly_electricity_prices(latitude, longitude);

-- Session tracking
CREATE INDEX idx_sessions_month_status ON scraping_sessions(data_month, status);
CREATE INDEX idx_errors_session_type ON scraping_errors(session_id, error_type);

-- ============================================
-- 6. AUTOMATIC TIMESTAMP UPDATES
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_monthly_prices_updated_at
    BEFORE UPDATE ON monthly_electricity_prices
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. ROW LEVEL SECURITY (Optional - for multi-tenant)
-- ============================================

-- Enable RLS (uncomment if needed for API security)
-- ALTER TABLE monthly_electricity_prices ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE scraping_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE scraping_errors ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE monthly_quality_metrics ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 8. HELPER FUNCTIONS
-- ============================================

-- Function to get data for a specific month and PLZ
CREATE OR REPLACE FUNCTION get_price_for_month_plz(
    p_month DATE,
    p_plz VARCHAR(5)
)
RETURNS TABLE (
    plz VARCHAR(5),
    city_name VARCHAR(100),
    lokaler_versorger_price DECIMAL(6, 4),
    oekostrom_price DECIMAL(6, 4),
    average_price DECIMAL(6, 4),
    data_source VARCHAR(20),
    is_outlier BOOLEAN,
    outlier_severity VARCHAR(15),
    distance_km DECIMAL(8, 3)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mp.plz,
        mp.city_name,
        mp.lokaler_versorger_price,
        mp.oekostrom_price,
        mp.average_price,
        mp.data_source,
        mp.is_outlier,
        mp.outlier_severity,
        mp.distance_km
    FROM monthly_electricity_prices mp
    WHERE mp.data_month = p_month AND mp.plz = p_plz;
END;
$$ LANGUAGE plpgsql;

-- Function to get latest data for a PLZ
CREATE OR REPLACE FUNCTION get_latest_price_for_plz(p_plz VARCHAR(5))
RETURNS TABLE (
    data_month DATE,
    city_name VARCHAR(100),
    lokaler_versorger_price DECIMAL(6, 4),
    oekostrom_price DECIMAL(6, 4),
    average_price DECIMAL(6, 4),
    data_source VARCHAR(20),
    is_outlier BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mp.data_month,
        mp.city_name,
        mp.lokaler_versorger_price,
        mp.oekostrom_price,
        mp.average_price,
        mp.data_source,
        mp.is_outlier
    FROM monthly_electricity_prices mp
    WHERE mp.plz = p_plz
    ORDER BY mp.data_month DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 9. SAMPLE DATA VIEWS (for reporting)
-- ============================================

-- View for monthly coverage summary
CREATE VIEW monthly_coverage_summary AS
SELECT 
    data_month,
    COUNT(*) as total_entries,
    COUNT(*) FILTER (WHERE data_source = 'ORIGINAL') as original_count,
    COUNT(*) FILTER (WHERE data_source = 'FALLBACK') as fallback_count,
    COUNT(*) FILTER (WHERE is_outlier = TRUE) as outlier_count,
    ROUND(AVG(average_price), 4) as avg_price,
    ROUND(AVG(distance_km) FILTER (WHERE data_source = 'FALLBACK'), 2) as avg_fallback_distance
FROM monthly_electricity_prices
GROUP BY data_month
ORDER BY data_month DESC;

-- View for latest prices by PLZ
CREATE VIEW latest_prices_by_plz AS
SELECT DISTINCT ON (plz)
    plz,
    city_name,
    data_month,
    lokaler_versorger_price,
    oekostrom_price,
    average_price,
    data_source,
    is_outlier,
    distance_km
FROM monthly_electricity_prices
ORDER BY plz, data_month DESC;

-- ============================================
-- END OF SCHEMA
-- ============================================ 