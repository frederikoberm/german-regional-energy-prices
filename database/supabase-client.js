/**
 * Supabase Database Client
 * Handles all database operations for German electricity price data
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

class SupabaseClient {
    constructor() {
        this.supabase = null;
        this.isConnected = false;
        this.init();
    }

    /**
     * Initialize Supabase connection
     */
    init() {
        try {
            // Load environment variables
            const supabaseUrl = process.env.SUPABASE_URL;
            const supabaseKey = process.env.SUPABASE_ANON_KEY;

            if (!supabaseUrl || !supabaseKey) {
                throw new Error('Missing Supabase environment variables. Please check SUPABASE_URL and SUPABASE_ANON_KEY');
            }

            // Create Supabase client
            this.supabase = createClient(supabaseUrl, supabaseKey, {
                auth: {
                    persistSession: false // For server-side applications
                }
            });

            this.isConnected = true;
            console.log('✅ Supabase client initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Supabase client:', error.message);
            throw error;
        }
    }

    /**
     * Test database connection
     */
    async testConnection() {
        try {
            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('count', { count: 'exact', head: true });

            if (error) throw error;

            console.log('✅ Database connection test successful');
            return true;
        } catch (error) {
            console.error('❌ Database connection test failed:', error.message);
            return false;
        }
    }

    /**
     * Get current month in YYYY-MM-DD format (first day of month)
     */
    getCurrentMonth() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}-01`;
    }

    /**
     * Format month string to first day of month
     */
    formatMonth(year, month) {
        const monthStr = String(month).padStart(2, '0');
        return `${year}-${monthStr}-01`;
    }

    /**
     * Check if data exists for a specific month and PLZ
     */
    async dataExists(month, plz) {
        try {
            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('id')
                .eq('data_month', month)
                .eq('plz', plz)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
                throw error;
            }

            return !!data;
        } catch (error) {
            console.error('Error checking data existence:', error.message);
            return false;
        }
    }

    /**
     * Check if any data exists for a specific month
     */
    async monthDataExists(month) {
        try {
            const { count, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('*', { count: 'exact', head: true })
                .eq('data_month', month);

            if (error) throw error;

            return count > 0;
        } catch (error) {
            console.error('Error checking month data existence:', error.message);
            return false;
        }
    }

    /**
     * Get all existing PLZs for a specific month (bulk duplicate checking optimization)
     */
    async getExistingPLZsForMonth(month) {
        try {
            const allPLZs = new Set();
            let hasMore = true;
            let offset = 0;
            const batchSize = 1000;

            // Paginate through all results to get complete set
            while (hasMore) {
                const { data, error } = await this.supabase
                    .from('monthly_electricity_prices')
                    .select('plz')
                    .eq('data_month', month)
                    .range(offset, offset + batchSize - 1);

                if (error) throw error;

                // Add PLZs to set
                data.forEach(row => allPLZs.add(row.plz));

                // Check if we got a full batch (meaning there might be more)
                hasMore = data.length === batchSize;
                offset += batchSize;
            }

            return allPLZs;
        } catch (error) {
            console.error('Error getting existing PLZs for month:', error.message);
            return new Set(); // Return empty set on error
        }
    }

    /**
     * Insert a single price record
     */
    async insertPriceData(priceData) {
        try {
            // Ensure required fields
            const record = {
                data_month: priceData.data_month || this.getCurrentMonth(),
                plz: priceData.plz,
                city_name: priceData.city_name,
                latitude: priceData.latitude || null,
                longitude: priceData.longitude || null,
                lokaler_versorger_price: priceData.lokaler_versorger_price || null,
                oekostrom_price: priceData.oekostrom_price || null,
                average_price: priceData.average_price || null,
                data_source: priceData.data_source || 'ORIGINAL',
                source_url: priceData.source_url || null,
                source_plz: priceData.source_plz || null,
                distance_km: priceData.distance_km || 0,
                is_outlier: priceData.is_outlier || false,
                outlier_severity: priceData.outlier_severity || 'normal'
            };

            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .insert(record)
                .select();

            if (error) throw error;

            return data[0];
        } catch (error) {
            console.error('Error inserting price data:', error.message);
            throw error;
        }
    }

    /**
     * Bulk insert price records
     */
    async bulkInsertPriceData(priceDataArray, batchSize = 100) {
        try {
            const results = [];
            const currentMonth = this.getCurrentMonth();

            // Process in batches
            for (let i = 0; i < priceDataArray.length; i += batchSize) {
                const batch = priceDataArray.slice(i, i + batchSize);
                
                // Prepare records
                const records = batch.map(item => ({
                    data_month: item.data_month || currentMonth,
                    plz: item.plz,
                    city_name: item.city_name,
                    latitude: item.latitude || null,
                    longitude: item.longitude || null,
                    lokaler_versorger_price: item.lokaler_versorger_price || null,
                    oekostrom_price: item.oekostrom_price || null,
                    average_price: item.average_price || null,
                    data_source: item.data_source || 'ORIGINAL',
                    source_url: item.source_url || null,
                    source_plz: item.source_plz || null,
                    distance_km: item.distance_km || 0,
                    is_outlier: item.is_outlier || false,
                    outlier_severity: item.outlier_severity || 'normal'
                }));

                const { data, error } = await this.supabase
                    .from('monthly_electricity_prices')
                    .insert(records)
                    .select();

                if (error) throw error;

                results.push(...data);
                console.log(`📊 Inserted batch ${Math.floor(i / batchSize) + 1}: ${records.length} records`);
            }

            console.log(`✅ Bulk insert completed: ${results.length} total records`);
            return results;
        } catch (error) {
            console.error('Error in bulk insert:', error.message);
            throw error;
        }
    }

    /**
     * Get price data for specific PLZ and month
     */
    async getPriceData(plz, month) {
        try {
            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('*')
                .eq('plz', plz)
                .eq('data_month', month)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error getting price data:', error.message);
            return null;
        }
    }

    /**
     * Get latest price data for a PLZ
     */
    async getLatestPriceData(plz) {
        try {
            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('*')
                .eq('plz', plz)
                .order('data_month', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error getting latest price data:', error.message);
            return null;
        }
    }

    /**
     * Get monthly averages
     */
    async getMonthlyAverages(month) {
        try {
            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('lokaler_versorger_price, oekostrom_price, average_price')
                .eq('data_month', month)
                .not('lokaler_versorger_price', 'is', null)
                .not('oekostrom_price', 'is', null)
                .not('average_price', 'is', null);

            if (error) throw error;

            if (data.length === 0) return null;

            const averages = {
                lokaler_versorger_avg: data.reduce((sum, item) => sum + parseFloat(item.lokaler_versorger_price), 0) / data.length,
                oekostrom_avg: data.reduce((sum, item) => sum + parseFloat(item.oekostrom_price), 0) / data.length,
                overall_avg: data.reduce((sum, item) => sum + parseFloat(item.average_price), 0) / data.length,
                sample_size: data.length
            };

            return averages;
        } catch (error) {
            console.error('Error getting monthly averages:', error.message);
            throw error;
        }
    }

    /**
     * Get available months
     */
    async getAvailableMonths() {
        try {
            const { data, error } = await this.supabase
                .from('monthly_electricity_prices')
                .select('data_month')
                .order('data_month', { ascending: false });

            if (error) throw error;

            // Get unique months
            const uniqueMonths = [...new Set(data.map(item => item.data_month))];
            return uniqueMonths;
        } catch (error) {
            console.error('Error getting available months:', error.message);
            throw error;
        }
    }

    /**
     * Get coverage statistics for a month
     */
    async getMonthCoverage(month) {
        try {
            const { data, error } = await this.supabase
                .from('monthly_coverage_summary')
                .select('*')
                .eq('data_month', month)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            return data;
        } catch (error) {
            console.error('Error getting month coverage:', error.message);
            return null;
        }
    }

    /**
     * Start a new scraping session
     */
    async startScrapingSession(month, totalCities, config = {}) {
        try {
            const session = {
                data_month: month,
                total_cities: totalCities,
                scraper_config: config,
                notes: `Scraping session started for ${month}`
            };

            const { data, error } = await this.supabase
                .from('scraping_sessions')
                .insert(session)
                .select()
                .single();

            if (error) throw error;

            console.log(`📊 Started scraping session ${data.id} for ${month}`);
            return data;
        } catch (error) {
            console.error('Error starting scraping session:', error.message);
            throw error;
        }
    }

    /**
     * Update scraping session progress
     */
    async updateScrapingSession(sessionId, updates) {
        try {
            const { data, error } = await this.supabase
                .from('scraping_sessions')
                .update(updates)
                .eq('id', sessionId)
                .select()
                .single();

            if (error) throw error;

            return data;
        } catch (error) {
            console.error('Error updating scraping session:', error.message);
            throw error;
        }
    }

    /**
     * Complete scraping session
     */
    async completeScrapingSession(sessionId, summary = {}) {
        try {
            const updates = {
                completed_at: new Date().toISOString(),
                status: 'completed',
                ...summary
            };

            return await this.updateScrapingSession(sessionId, updates);
        } catch (error) {
            console.error('Error completing scraping session:', error.message);
            throw error;
        }
    }

    /**
     * Log scraping error
     */
    async logScrapingError(sessionId, errorData) {
        try {
            const errorRecord = {
                session_id: sessionId,
                plz: errorData.plz,
                city_name: errorData.city_name,
                error_type: errorData.error_type,
                error_message: errorData.error_message,
                source_url: errorData.source_url,
                retry_count: errorData.retry_count || 0,
                context_data: errorData.context_data || {}
            };

            const { data, error } = await this.supabase
                .from('scraping_errors')
                .insert(errorRecord)
                .select()
                .single();

            if (error) throw error;

            return data;
        } catch (error) {
            console.error('Error logging scraping error:', error.message);
            throw error;
        }
    }
}

module.exports = SupabaseClient; 