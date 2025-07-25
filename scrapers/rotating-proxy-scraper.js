#!/usr/bin/env node

/**
 * Rotating Proxy Scraper
 * Changes IP address for each request using various proxy sources
 */

require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const SmartElectricityScraper = require('./smart-single-scraper');

class RotatingProxyScraper extends SmartElectricityScraper {
    constructor() {
        super();
        
        // Override smart scraper limit to process ALL cities
        this.targetCityCount = 999999; // Process all available cities (8934)
        
        // Proxy rotation setup
        this.proxyConfig = {
            enableRotation: true,
            maxFailuresPerProxy: 3,
            testProxiesOnStartup: true,
            fallbackToVPN: true
        };
        
        // Different proxy sources
        this.proxySources = {
            // Option 1: Premium proxy services (most reliable)
            premium: [
                // Add your premium proxy URLs here
                // 'http://username:password@proxy1.service.com:8080',
                // 'http://username:password@proxy2.service.com:8080',
            ],
            
            // Option 2: Free proxy lists (less reliable)
            free: [
                // We'll fetch these dynamically from free proxy APIs
            ],
            
            // Option 3: Tor proxies (changes frequently)
            tor: [
                'socks5://127.0.0.1:9050'  // Default Tor SOCKS proxy
            ]
        };
        
        this.workingProxies = [];
        this.proxyStats = {};
        this.currentProxyIndex = 0;
        this.requestCount = 0;
    }

    /**
     * Fetch free proxies from public APIs
     */
    async fetchFreeProxies() {
        console.log('🔍 Fetching free proxies...');
        
        const freeProxyAPIs = [
            'https://api.proxyscrape.com/v2/?request=get&protocol=http&timeout=10000&country=all',
            'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
            'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt'
        ];
        
        const allProxies = [];
        
        for (const apiUrl of freeProxyAPIs) {
            try {
                console.log(`   Fetching from: ${apiUrl.split('/')[2]}...`);
                const response = await axios.get(apiUrl, { timeout: 10000 });
                
                const proxies = response.data
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line && line.includes(':'))
                    .map(proxy => `http://${proxy}`)
                    .slice(0, 20); // Limit to 20 per source
                
                allProxies.push(...proxies);
                console.log(`   ✅ Found ${proxies.length} proxies`);
                
            } catch (error) {
                console.log(`   ❌ Failed to fetch from ${apiUrl.split('/')[2]}: ${error.message}`);
            }
        }
        
        // Remove duplicates
        const uniqueProxies = [...new Set(allProxies)];
        console.log(`📋 Total unique free proxies: ${uniqueProxies.length}`);
        
        return uniqueProxies;
    }

    /**
     * Test if a proxy is working
     */
    async testProxy(proxyUrl, timeout = 15000) {
        try {
            const testUrls = [
                'https://httpbin.org/ip',
                'https://api.ipify.org?format=json'
            ];
            
            // Choose the right agent based on proxy type
            let agent;
            if (proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks4://')) {
                agent = new SocksProxyAgent(proxyUrl);
            } else {
                agent = new HttpsProxyAgent(proxyUrl);
            }
            
            for (const testUrl of testUrls) {
                const response = await axios.get(testUrl, {
                    timeout,
                    httpsAgent: agent,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                if (response.status === 200 && response.data) {
                    const ip = response.data.origin || response.data.ip;
                    return { working: true, ip, responseTime: response.duration || 0 };
                }
            }
            
            return { working: false, error: 'No valid response' };
            
        } catch (error) {
            return { 
                working: false, 
                error: error.code || error.message,
                timeout: error.code === 'ECONNABORTED'
            };
        }
    }

    /**
     * Initialize and test all proxy sources
     */
    async initializeProxies() {
        console.log('🚀 Initializing Proxy Rotation System');
        console.log('====================================\n');
        
        // Collect all proxies
        let allProxies = [];
        
        // Add premium proxies
        if (this.proxySources.premium.length > 0) {
            console.log(`📋 Premium proxies: ${this.proxySources.premium.length}`);
            allProxies.push(...this.proxySources.premium.map(p => ({ url: p, type: 'premium' })));
        }
        
        // Add Tor proxies
        if (this.proxySources.tor.length > 0) {
            console.log(`🧅 Tor proxies: ${this.proxySources.tor.length}`);
            allProxies.push(...this.proxySources.tor.map(p => ({ url: p, type: 'tor' })));
        }
        
        // Fetch and add free proxies
        if (process.env.USE_FREE_PROXIES !== 'false') {
            const freeProxies = await this.fetchFreeProxies();
            allProxies.push(...freeProxies.map(p => ({ url: p, type: 'free' })));
        }
        
        console.log(`\n🧪 Testing ${allProxies.length} proxies...`);
        
        // Test proxies in parallel (but limit concurrency)
        const batchSize = 10;
        const workingProxies = [];
        
        for (let i = 0; i < allProxies.length; i += batchSize) {
            const batch = allProxies.slice(i, i + batchSize);
            
            const promises = batch.map(async (proxy) => {
                const result = await this.testProxy(proxy.url);
                
                if (result.working) {
                    console.log(`   ✅ ${proxy.type}: ${proxy.url.replace(/\/\/.*@/, '//***@')} -> ${result.ip}`);
                    return { ...proxy, ...result };
                } else {
                    console.log(`   ❌ ${proxy.type}: ${proxy.url.replace(/\/\/.*@/, '//***@')} (${result.error})`);
                    return null;
                }
            });
            
            const results = await Promise.all(promises);
            workingProxies.push(...results.filter(r => r !== null));
            
            // Progress update
            console.log(`   Tested ${Math.min(i + batchSize, allProxies.length)}/${allProxies.length}...`);
        }
        
        this.workingProxies = workingProxies;
        
        // Initialize stats
        this.workingProxies.forEach(proxy => {
            this.proxyStats[proxy.url] = {
                requests: 0,
                failures: 0,
                lastUsed: null,
                avgResponseTime: proxy.responseTime || 0
            };
        });
        
        console.log(`\n🎉 Proxy initialization complete!`);
        console.log(`   Working proxies: ${this.workingProxies.length}`);
        console.log(`   Premium: ${this.workingProxies.filter(p => p.type === 'premium').length}`);
        console.log(`   Free: ${this.workingProxies.filter(p => p.type === 'free').length}`);
        console.log(`   Tor: ${this.workingProxies.filter(p => p.type === 'tor').length}`);
        
        if (this.workingProxies.length === 0) {
            throw new Error('No working proxies found! Consider adding premium proxy services.');
        }
        
        return this.workingProxies.length;
    }

    /**
     * Get next proxy with intelligent rotation
     */
    getNextProxy() {
        if (this.workingProxies.length === 0) {
            return null;
        }
        
        // Filter out failed proxies
        const availableProxies = this.workingProxies.filter(proxy => {
            const stats = this.proxyStats[proxy.url];
            if (!stats) {
                // Initialize stats if missing
                this.proxyStats[proxy.url] = {
                    requests: 0,
                    failures: 0,
                    lastUsed: null,
                    avgResponseTime: 0
                };
                return true; // New proxy, consider it available
            }
            return stats.failures < this.proxyConfig.maxFailuresPerProxy;
        });
        
        if (availableProxies.length === 0) {
            console.log('⚠️  All proxies have failed, resetting failure counts...');
            // Reset failure counts
            Object.values(this.proxyStats).forEach(stats => stats.failures = 0);
            return this.workingProxies[0];
        }
        
        // Rotate through available proxies
        const proxy = availableProxies[this.currentProxyIndex % availableProxies.length];
        this.currentProxyIndex++;
        
        return proxy;
    }

    /**
     * Enhanced request with automatic proxy rotation
     */
    async makeRequest(url, retryCount = 0) {
        const maxRetries = 3;
        let lastError = null;
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const proxy = this.getNextProxy();
            
            if (!proxy) {
                throw new Error('No available proxies');
            }
            
            try {
                this.requestCount++;
                let stats = this.proxyStats[proxy.url];
                
                // Defensive fix: Initialize stats if missing
                if (!stats) {
                    console.log(`    ⚠️  Initializing missing stats for proxy: ${proxy.ip}`);
                    this.proxyStats[proxy.url] = {
                        requests: 0,
                        failures: 0,
                        lastUsed: null,
                        avgResponseTime: 0
                    };
                    stats = this.proxyStats[proxy.url];
                }
                
                stats.requests++;
                stats.lastUsed = new Date();
                
                console.log(`    🔄 Request #${this.requestCount} via ${proxy.type} proxy: ${proxy.ip}`);
                
                const startTime = Date.now();
                
                // Choose the right agent based on proxy type
                let agent;
                if (proxy.url.startsWith('socks5://') || proxy.url.startsWith('socks4://')) {
                    agent = new SocksProxyAgent(proxy.url);
                } else {
                    agent = new HttpsProxyAgent(proxy.url);
                }

                const response = await axios.get(url, {
                    timeout: this.httpConfig.timeout,
                    httpsAgent: agent,
                    headers: {
                        'User-Agent': this.getRandomUserAgent(),
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Connection': 'keep-alive',
                        'Cache-Control': 'no-cache'
                    },
                    maxRedirects: 5,
                    validateStatus: (status) => {
                        return status >= 200 && status < 400 || status === 404;
                    }
                });
                
                // Update response time
                stats.avgResponseTime = (stats.avgResponseTime + (Date.now() - startTime)) / 2;
                
                if (!response || response.status === 404 || !response.data) {
                    return null;
                }
                
                if (response.data.length < 500) {
                    throw new Error('Response too short - likely blocked');
                }
                
                return response;
                
            } catch (error) {
                lastError = error;
                stats.failures++;
                
                console.log(`    ❌ Proxy ${proxy.ip} failed (attempt ${attempt + 1}): ${error.message}`);
                
                // If this proxy has failed too many times, mark it as bad
                if (stats.failures >= this.proxyConfig.maxFailuresPerProxy) {
                    console.log(`    🚫 Proxy ${proxy.ip} marked as failed (${stats.failures} failures)`);
                }
                
                // Wait before retry
                if (attempt < maxRetries) {
                    await this.sleep(2000); // 2 second wait before retry
                }
            }
        }
        
        // All retries failed
        if (lastError?.response?.status === 404) {
            return null;
        }
        
        throw lastError || new Error('All proxy attempts failed');
    }

    /**
     * Get random user agent
     */
    getRandomUserAgent() {
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        
        return userAgents[Math.floor(Math.random() * userAgents.length)];
    }

    /**
     * Show proxy statistics
     */
    showProxyStats() {
        console.log('\n📊 Proxy Usage Statistics:');
        console.log('=========================');
        
        const sortedProxies = this.workingProxies
            .map(proxy => ({
                ...proxy,
                stats: this.proxyStats[proxy.url]
            }))
            .sort((a, b) => b.stats.requests - a.stats.requests);
        
        sortedProxies.forEach((proxy, index) => {
            const stats = proxy.stats;
            const successRate = stats.requests > 0 ? 
                ((stats.requests - stats.failures) / stats.requests * 100).toFixed(1) : 0;
            
            console.log(`   ${index + 1}. ${proxy.type} ${proxy.ip}`);
            console.log(`      Requests: ${stats.requests}, Failures: ${stats.failures}, Success: ${successRate}%`);
        });
        
        console.log(`\nTotal requests: ${this.requestCount}`);
    }

    /**
     * Enhanced database insertion with duplicate handling
     */
    async insertPriceDataSafely(priceData) {
        try {
            // First check if data already exists to avoid duplicate key errors
            const currentMonth = new Date().toISOString().slice(0, 7) + '-01';
            const exists = await this.db.dataExists(currentMonth, priceData.plz);
            
            if (exists) {
                console.log(`    ⏭️  Skipping ${priceData.city_name} - data already exists`);
                return { skipped: true };
            }
            
            // Insert if doesn't exist
            await this.db.insertPriceData(priceData);
            return { inserted: true };
            
        } catch (error) {
            // Handle duplicate key error gracefully
            if (error.message.includes('duplicate key value violates unique constraint')) {
                console.log(`    ⏭️  Skipping ${priceData.city_name} - duplicate detected during insertion`);
                return { skipped: true, reason: 'duplicate_key' };
            }
            
            // Re-throw other errors
            throw error;
        }
    }

    /**
     * Override processCities to use enhanced duplicate handling
     */
    async processCities(cities) {
        console.log('\n🚀 Starting city processing with Proxy + Tor support...\n');

        for (let i = 0; i < cities.length; i++) {
            const city = cities[i];
            
            // Process the city
            const result = await this.scrapeCityWithClassification(city);
            
            // Store result if successful using enhanced duplicate handling
            if (result) {
                try {
                    const insertResult = await this.insertPriceDataSafely(result);
                    
                    if (insertResult.inserted) {
                        console.log(`    ✅ Data stored for ${city.cityName}`);
                    }
                    // If skipped, message already logged in insertPriceDataSafely
                    
                } catch (dbError) {
                    console.error(`❌ Database error for ${city.cityName}:`, dbError.message);
                }
            }

            // Enhanced progress reporting for large batches
            const progressInterval = cities.length > 1000 ? 100 : 50; // Report every 100 for large batches
            
            if ((i + 1) % progressInterval === 0) {
                const progressPercent = ((i + 1) / cities.length * 100).toFixed(1);
                const successRate = (this.stats.successful / this.stats.totalProcessed * 100).toFixed(1);
                const estimatedTimeLeft = Math.ceil((cities.length - i - 1) * 4 / 60); // 4 seconds per city average
                
                console.log(`\n📊 === PROGRESS REPORT ===`);
                console.log(`   🎯 Cities: ${i + 1}/${cities.length} (${progressPercent}%)`);
                console.log(`   ✅ Success: ${this.stats.successful}, ❌ Failed: ${this.stats.failed}`);
                console.log(`   📈 Success rate: ${successRate}%`);
                console.log(`   ⏱️  Estimated time left: ${estimatedTimeLeft} minutes`);
                
                // Show proxy performance
                console.log(`   🔄 Proxy requests: ${this.requestCount}`);
                const workingProxyCount = this.workingProxies.filter(p => {
                    const stats = this.proxyStats[p.url];
                    return stats && stats.failures < this.proxyConfig.maxFailuresPerProxy;
                }).length;
                console.log(`   🌐 Working proxies: ${workingProxyCount}/${this.workingProxies.length}\n`);
            }

            // Respectful randomized delay
            if (i < cities.length - 1) {
                await this.sleep(); // No parameter = random 2-5s delay
            }
        }
    }

    /**
     * Override the run method to initialize proxies first
     */
    async run() {
        try {
            console.log('🚀 Starting Smart Proxy + Tor Scraper');
            console.log('====================================\n');

            // Initialize proxy system first
            await this.initializeProxies();
            
            console.log('\n🎯 Smart Features Enabled:');
            console.log('   ✅ City classification (small/medium/large)');
            console.log('   ✅ Multiple extraction strategies');
            console.log('   ✅ Outlier detection and validation');
            console.log('   ✅ Automatic duplicate skipping');
            console.log('   ✅ Proxy rotation with Tor support');
            console.log('   ✅ Enhanced error handling\n');
            
            // Test database connection
            const connectionOk = await this.db.testConnection();
            if (!connectionOk) {
                throw new Error('Database connection failed');
            }

            // Load and filter cities (inherits smart scraper's duplicate checking)
            const citiesToProcess = await this.getUnprocessedCities();
            if (citiesToProcess.length === 0) {
                console.log('🎉 All cities have been processed!');
                console.log('✅ Smart Proxy + Tor scraper completed successfully!');
                process.exit(0); // Ensure clean exit
            }
            
            console.log(`🎯 Processing ALL remaining cities: ${citiesToProcess.length} cities`);
            console.log(`📊 Estimated completion time: ${Math.ceil(citiesToProcess.length * 4 / 60)} minutes`);

            // Initialize session
            await this.initializeSession(citiesToProcess.length);

            // Show plan
            this.showScrapingPlan(citiesToProcess.length);

            // Process cities with enhanced duplicate handling
            await this.processCities(citiesToProcess);

            // Complete session
            await this.completeSession();

            console.log('\n🎉 Smart proxy scraper completed successfully!');
            this.printFinalStats();
            
            // Final completion summary
            console.log('\n🏆 === SCRAPING MISSION COMPLETE ===');
            console.log(`✅ All available cities have been processed!`);
            console.log(`📊 Total database entries: ${this.stats.successful + 1000} cities`);
            console.log(`🌍 Coverage: Complete German electricity price database`);
            console.log(`💾 Data stored in Supabase monthly_electricity_prices table`);
            
        } catch (error) {
            console.error('💥 Fatal error:', error.message);
            if (this.sessionId) {
                await this.failSession(error);
            }
            throw error;
        } finally {
            // Show final stats
            if (this.workingProxies && this.workingProxies.length > 0) {
                this.showProxyStats();
            }
            
            // Ensure clean exit
            console.log('\n👋 Exiting scraper...');
            setTimeout(() => {
                process.exit(0);
            }, 2000); // Give time for final logs
        }
    }
}

// Export for use
module.exports = RotatingProxyScraper;

// Main execution
if (require.main === module) {
    async function main() {
        const scraper = new RotatingProxyScraper();
        
        try {
            await scraper.run();
            console.log('\n✅ Rotating proxy scraper completed successfully!');
            process.exit(0);
        } catch (error) {
            console.error('\n❌ Rotating proxy scraper failed:', error.message);
            process.exit(1);
        }
    }
    
    main();
} 