/**
 * API Routes for German Electricity Price Data
 * Core endpoints for accessing monthly price data
 */

const express = require('express');
const { validatePLZ, validateYearMonth, validateMonth } = require('../middleware/validation-middleware');
const { formatResponse, formatError } = require('../utils/response-formatter');
const router = express.Router();

// ===========================================
// PRICE ENDPOINTS
// ===========================================

/**
 * GET /price/{plz}/{year}/{month}
 * Get electricity price for specific PLZ and month
 */
router.get('/price/:plz/:year/:month', validatePLZ, validateYearMonth, async (req, res) => {
    try {
        const { plz, year, month } = req.params;
        const dataMonth = `${year}-${month.padStart(2, '0')}-01`;
        
        console.log(`🔍 Fetching price data for PLZ ${plz}, month ${dataMonth}`);
        
        // Query database for specific PLZ and month
        const { data, error } = await req.db.supabase
            .from('monthly_electricity_prices')
            .select('*')
            .eq('plz', plz)
            .eq('data_month', dataMonth)
            .single();
            
        if (error) {
            if (error.code === 'PGRST116') { // No rows returned
                return res.status(404).json(formatError(
                    'No price data found for this PLZ and month',
                    'NOT_FOUND',
                    { plz, year, month, searched_month: dataMonth }
                ));
            }
            throw error;
        }

        // Format response
        const response = {
            plz: data.plz,
            city_name: data.city_name,
            year: parseInt(year),
            month: parseInt(month),
            data_month: data.data_month,
            prices: {
                local_provider: data.lokaler_versorger_price,
                green_energy: data.oekostrom_price,
                average: data.average_price
            },
            metadata: {
                data_source: data.data_source,
                source_plz: data.source_plz,
                distance_km: data.distance_km,
                is_outlier: data.is_outlier,
                outlier_severity: data.outlier_severity,
                source_url: data.source_url,
                coordinates: data.latitude && data.longitude ? {
                    latitude: data.latitude,
                    longitude: data.longitude
                } : null
            },
            scraped_at: data.created_at
        };

        res.json(formatResponse(response, 'Price data retrieved successfully'));
        
    } catch (error) {
        console.error('❌ Error fetching price data:', error);
        res.status(500).json(formatError('Internal server error', 'INTERNAL_ERROR'));
    }
});

/**
 * GET /price/{plz}/latest
 * Get most recent price data for PLZ
 */
router.get('/price/:plz/latest', validatePLZ, async (req, res) => {
    try {
        const { plz } = req.params;
        
        console.log(`🔍 Fetching latest price data for PLZ ${plz}`);
        
        // Query database for most recent data for this PLZ
        const { data, error } = await req.db.supabase
            .from('monthly_electricity_prices')
            .select('*')
            .eq('plz', plz)
            .order('data_month', { ascending: false })
            .limit(1);
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json(formatError(
                'No price data found for this PLZ',
                'NOT_FOUND',
                { plz }
            ));
        }

        const latest = data[0];
        const dataDate = new Date(latest.data_month);
        
        const response = {
            plz: latest.plz,
            city_name: latest.city_name,
            year: dataDate.getFullYear(),
            month: dataDate.getMonth() + 1,
            data_month: latest.data_month,
            prices: {
                local_provider: latest.lokaler_versorger_price,
                green_energy: latest.oekostrom_price,
                average: latest.average_price
            },
            metadata: {
                data_source: latest.data_source,
                source_plz: latest.source_plz,
                distance_km: latest.distance_km,
                is_outlier: latest.is_outlier,
                outlier_severity: latest.outlier_severity,
                source_url: latest.source_url,
                coordinates: latest.latitude && latest.longitude ? {
                    latitude: latest.latitude,
                    longitude: latest.longitude
                } : null
            },
            scraped_at: latest.created_at
        };

        res.json(formatResponse(response, 'Latest price data retrieved successfully'));
        
    } catch (error) {
        console.error('❌ Error fetching latest price data:', error);
        res.status(500).json(formatError('Internal server error', 'INTERNAL_ERROR'));
    }
});

// ===========================================
// AGGREGATE ENDPOINTS
// ===========================================

/**
 * GET /average/{year}/{month}
 * Get national averages for a month
 */
router.get('/average/:year/:month', validateYearMonth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const dataMonth = `${year}-${month.padStart(2, '0')}-01`;
        
        console.log(`🔍 Calculating national averages for ${dataMonth}`);
        
        // Query database for averages
        const { data, error } = await req.db.supabase
            .from('monthly_electricity_prices')
            .select('lokaler_versorger_price, oekostrom_price, average_price, data_source')
            .eq('data_month', dataMonth);
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json(formatError(
                'No data found for this month',
                'NOT_FOUND',
                { year, month, searched_month: dataMonth }
            ));
        }

        // Calculate averages
        const originalData = data.filter(row => row.data_source === 'ORIGINAL');
        const fallbackData = data.filter(row => row.data_source === 'FALLBACK');
        
        const calculateAvg = (arr, field) => {
            const values = arr.map(row => row[field]).filter(val => val !== null);
            return values.length > 0 ? values.reduce((sum, val) => sum + val, 0) / values.length : null;
        };

        const response = {
            year: parseInt(year),
            month: parseInt(month),
            data_month: dataMonth,
            national_averages: {
                local_provider: calculateAvg(data, 'lokaler_versorger_price'),
                green_energy: calculateAvg(data, 'oekostrom_price'),
                average: calculateAvg(data, 'average_price')
            },
            breakdown: {
                original_data: {
                    count: originalData.length,
                    local_provider: calculateAvg(originalData, 'lokaler_versorger_price'),
                    green_energy: calculateAvg(originalData, 'oekostrom_price'),
                    average: calculateAvg(originalData, 'average_price')
                },
                fallback_data: {
                    count: fallbackData.length,
                    local_provider: calculateAvg(fallbackData, 'lokaler_versorger_price'),
                    green_energy: calculateAvg(fallbackData, 'oekostrom_price'),
                    average: calculateAvg(fallbackData, 'average_price')
                }
            },
            total_records: data.length
        };

        res.json(formatResponse(response, 'National averages calculated successfully'));
        
    } catch (error) {
        console.error('❌ Error calculating averages:', error);
        res.status(500).json(formatError('Internal server error', 'INTERNAL_ERROR'));
    }
});

/**
 * GET /coverage/{year}/{month}
 * Get data coverage statistics for a month
 */
router.get('/coverage/:year/:month', validateYearMonth, async (req, res) => {
    try {
        const { year, month } = req.params;
        const dataMonth = `${year}-${month.padStart(2, '0')}-01`;
        
        console.log(`🔍 Calculating coverage statistics for ${dataMonth}`);
        
        // Query database for coverage stats
        const { data, error } = await req.db.supabase
            .from('monthly_electricity_prices')
            .select('data_source, is_outlier, outlier_severity')
            .eq('data_month', dataMonth);
            
        if (error) throw error;
        
        if (!data || data.length === 0) {
            return res.status(404).json(formatError(
                'No data found for this month',
                'NOT_FOUND',
                { year, month, searched_month: dataMonth }
            ));
        }

        // Calculate coverage statistics
        const total = data.length;
        const originalCount = data.filter(row => row.data_source === 'ORIGINAL').length;
        const fallbackCount = data.filter(row => row.data_source === 'FALLBACK').length;
        const outlierCount = data.filter(row => row.is_outlier === true).length;
        
        const outliersBySeverity = {
            normal: data.filter(row => row.outlier_severity === 'normal').length,
            high: data.filter(row => row.outlier_severity === 'high').length,
            very_high: data.filter(row => row.outlier_severity === 'very_high').length
        };

        const response = {
            year: parseInt(year),
            month: parseInt(month),
            data_month: dataMonth,
            coverage: {
                total_records: total,
                original_data: {
                    count: originalCount,
                    percentage: ((originalCount / total) * 100).toFixed(2)
                },
                fallback_data: {
                    count: fallbackCount,
                    percentage: ((fallbackCount / total) * 100).toFixed(2)
                }
            },
            quality: {
                total_outliers: outlierCount,
                outlier_percentage: ((outlierCount / total) * 100).toFixed(2),
                outliers_by_severity: outliersBySeverity
            }
        };

        res.json(formatResponse(response, 'Coverage statistics calculated successfully'));
        
    } catch (error) {
        console.error('❌ Error calculating coverage:', error);
        res.status(500).json(formatError('Internal server error', 'INTERNAL_ERROR'));
    }
});

// ===========================================
// METADATA ENDPOINTS
// ===========================================

/**
 * GET /months
 * List available months of data
 */
router.get('/months', async (req, res) => {
    try {
        console.log('🔍 Fetching available months');
        
        // Query database for distinct months
        const { data, error } = await req.db.supabase
            .from('monthly_electricity_prices')
            .select('data_month')
            .order('data_month', { ascending: false });
            
        if (error) throw error;
        
        // Get unique months and format them
        const uniqueMonths = [...new Set(data.map(row => row.data_month))]
            .map(monthStr => {
                const date = new Date(monthStr);
                return {
                    data_month: monthStr,
                    year: date.getFullYear(),
                    month: date.getMonth() + 1,
                    formatted: date.toLocaleDateString('de-DE', { 
                        year: 'numeric', 
                        month: 'long' 
                    })
                };
            });

        const response = {
            available_months: uniqueMonths,
            total_months: uniqueMonths.length,
            latest_month: uniqueMonths[0] || null,
            oldest_month: uniqueMonths[uniqueMonths.length - 1] || null
        };

        res.json(formatResponse(response, 'Available months retrieved successfully'));
        
    } catch (error) {
        console.error('❌ Error fetching available months:', error);
        res.status(500).json(formatError('Internal server error', 'INTERNAL_ERROR'));
    }
});

// ===========================================
// BULK QUERY ENDPOINTS
// ===========================================

/**
 * POST /price/bulk
 * Get prices for multiple PLZs for a specific month
 */
router.post('/price/bulk', validateMonth, async (req, res) => {
    try {
        const { plzList, year, month } = req.body;
        
        // Validate input
        if (!Array.isArray(plzList) || plzList.length === 0) {
            return res.status(400).json(formatError(
                'plzList must be a non-empty array',
                'VALIDATION_ERROR'
            ));
        }
        
        if (plzList.length > 100) {
            return res.status(400).json(formatError(
                'Maximum 100 PLZs allowed per request',
                'VALIDATION_ERROR'
            ));
        }
        
        const dataMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
        
        console.log(`🔍 Bulk fetching prices for ${plzList.length} PLZs, month ${dataMonth}`);
        
        // Query database for all PLZs
        const { data, error } = await req.db.supabase
            .from('monthly_electricity_prices')
            .select('*')
            .eq('data_month', dataMonth)
            .in('plz', plzList);
            
        if (error) throw error;
        
        // Format results
        const results = data.map(row => ({
            plz: row.plz,
            city_name: row.city_name,
            prices: {
                local_provider: row.lokaler_versorger_price,
                green_energy: row.oekostrom_price,
                average: row.average_price
            },
            metadata: {
                data_source: row.data_source,
                source_plz: row.source_plz,
                distance_km: row.distance_km,
                is_outlier: row.is_outlier,
                outlier_severity: row.outlier_severity
            }
        }));
        
        // Find missing PLZs
        const foundPLZs = new Set(results.map(r => r.plz));
        const missingPLZs = plzList.filter(plz => !foundPLZs.has(plz));
        
        const response = {
            year: parseInt(year),
            month: parseInt(month),
            data_month: dataMonth,
            requested_count: plzList.length,
            found_count: results.length,
            results: results,
            missing_plzs: missingPLZs
        };

        res.json(formatResponse(response, 'Bulk price data retrieved successfully'));
        
    } catch (error) {
        console.error('❌ Error in bulk price fetch:', error);
        res.status(500).json(formatError('Internal server error', 'INTERNAL_ERROR'));
    }
});

module.exports = router; 