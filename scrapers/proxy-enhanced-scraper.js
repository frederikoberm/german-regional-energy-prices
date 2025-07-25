#!/usr/bin/env node

/**
 * Proxy-Enhanced Smart Scraper
 * Handles IP blocking with proxy rotation and enhanced evasion
 */

require('dotenv').config();
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Extend the smart scraper with proxy capabilities
const SmartElectricityScraper = require('./smart-single-scraper');

class ProxyEnhancedScraper extends SmartElectricityScraper {
    constructor() {
        super();
        
        // Proxy configuration
        this.proxies = [
            // Add your proxy servers here
            // 'http://proxy1.example.com:8080',
            // 'http://proxy2.example.com:8080',
            // Or use services like ProxyMesh, Bright Data, etc.
        ];
        
        this.currentProxyIndex = 0;
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        
        // Enhanced delays for stealth
        this.delay = parseInt(process.env.SCRAPER_DELAY) || 5000; // 5 seconds default
        this.randomDelayRange = 3000; // ±3 seconds random
    }

    /**
     * Get next proxy in rotation
     */
    getNextProxy() {
        if (this.proxies.length === 0) return null;
        
        const proxy = this.proxies[this.currentProxyIndex];
        this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
        return proxy;
    }

    /**
     * Get random user agent
     */
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    /**
     * Calculate random delay (more human-like)
     */
    getRandomDelay() {
        const baseDelay = this.delay;
        const randomOffset = Math.random() * this.randomDelayRange - (this.randomDelayRange / 2);
        return Math.max(1000, baseDelay + randomOffset);
    }

    /**
     * Enhanced request with proxy rotation and evasion
     */
    async makeRequest(url, retryCount = 0) {
        const maxRetries = 3;
        
        try {
            // Get proxy and user agent
            const proxy = this.getNextProxy();
            const userAgent = this.getRandomUserAgent();
            
            // Configure request options
            const options = {
                timeout: this.httpConfig.timeout,
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Cache-Control': 'no-cache',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                },
                maxRedirects: 5,
                validateStatus: (status) => {
                    return status >= 200 && status < 400 || status === 404;
                }
            };

            // Add proxy if available
            if (proxy) {
                options.httpsAgent = new HttpsProxyAgent(proxy);
                console.log(`    🔄 Using proxy: ${proxy.replace(/\/\/.*@/, '//***@')}`);
            }

            console.log(`    🌐 User-Agent: ${userAgent.substring(0, 50)}...`);

            const response = await axios.get(url, options);

            if (!response || response.status === 404 || !response.data) {
                return null;
            }

            if (response.data.length < 500) {
                throw new Error('Response too short - likely blocked or redirected');
            }

            // Check for blocking indicators
            const blockingIndicators = [
                'cloudflare',
                'access denied',
                'forbidden',
                'rate limit',
                'captcha',
                'security check',
                'verify you are human'
            ];

            const responseText = response.data.toLowerCase();
            for (const indicator of blockingIndicators) {
                if (responseText.includes(indicator)) {
                    throw new Error(`Blocked: detected '${indicator}' in response`);
                }
            }

            return response;

        } catch (error) {
            if (error.response && error.response.status === 404) {
                return null;
            }

            console.log(`    ⚠️  Request failed (attempt ${retryCount + 1}): ${error.message}`);

            // Retry with different proxy/user agent
            if (retryCount < maxRetries) {
                const retryDelay = (retryCount + 1) * 2000; // Exponential backoff
                console.log(`    ⏳ Retrying in ${retryDelay/1000}s with different settings...`);
                await this.sleep(retryDelay);
                return this.makeRequest(url, retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * Enhanced sleep with random variation
     */
    async sleep(ms = null) {
        let delay;
        if (ms !== null) {
            delay = ms;
        } else {
            // Random delay between 3000ms (3s) and 10000ms (10s)
            delay = Math.floor(Math.random() * (10000 - 3000 + 1)) + 3000;
        }
        
        console.log(`    ⏳ Waiting ${(delay/1000).toFixed(1)}s (randomized human-like delay)...`);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Test proxy connectivity
     */
    async testProxyConnectivity() {
        console.log('🔍 Testing Proxy Connectivity');
        console.log('==============================\n');

        const testUrl = 'https://httpbin.org/ip';

        // Test without proxy
        try {
            console.log('1️⃣  Testing direct connection...');
            const directResponse = await axios.get(testUrl, { timeout: 10000 });
            console.log(`   ✅ Direct IP: ${directResponse.data.origin}`);
        } catch (error) {
            console.log(`   ❌ Direct connection failed: ${error.message}`);
        }

        // Test each proxy
        for (let i = 0; i < this.proxies.length; i++) {
            const proxy = this.proxies[i];
            try {
                console.log(`\n${i + 2}️⃣  Testing proxy: ${proxy.replace(/\/\/.*@/, '//***@')}...`);
                
                const response = await axios.get(testUrl, {
                    timeout: 15000,
                    httpsAgent: new HttpsProxyAgent(proxy)
                });
                
                console.log(`   ✅ Proxy IP: ${response.data.origin}`);
            } catch (error) {
                console.log(`   ❌ Proxy failed: ${error.message}`);
            }
        }
    }

    /**
     * Test stromauskunft.de accessibility
     */
    async testStromauskunftAccess() {
        console.log('\n🌐 Testing Stromauskunft.de Access');
        console.log('==================================\n');

        const testUrl = 'https://www.stromauskunft.de';

        // Test with different methods
        const methods = [
            { name: 'Direct', proxy: null },
            ...this.proxies.map((proxy, i) => ({ name: `Proxy ${i + 1}`, proxy }))
        ];

        for (const method of methods) {
            try {
                console.log(`Testing ${method.name}...`);
                
                const options = {
                    timeout: 20000,
                    headers: {
                        'User-Agent': this.getRandomUserAgent()
                    }
                };

                if (method.proxy) {
                    options.httpsAgent = new HttpsProxyAgent(method.proxy);
                }

                const response = await axios.get(testUrl, options);
                console.log(`   ✅ ${method.name}: ${response.status} (${response.data.length} bytes)`);
                
                // If this works, we found a solution!
                if (response.status === 200) {
                    console.log(`\n🎉 SUCCESS: ${method.name} can access stromauskunft.de!`);
                    return method;
                }
                
            } catch (error) {
                console.log(`   ❌ ${method.name}: ${error.code || error.message}`);
            }
        }

        console.log('\n❌ All methods failed. Site may be down or need more advanced evasion.');
        return null;
    }
}

// Export for use
module.exports = ProxyEnhancedScraper;

// Main execution for testing
if (require.main === module) {
    async function main() {
        const scraper = new ProxyEnhancedScraper();
        
        console.log('🕵️  Proxy-Enhanced Scraper Test');
        console.log('===============================\n');
        
        // Test connectivity
        await scraper.testProxyConnectivity();
        
        // Test stromauskunft.de access
        const workingMethod = await scraper.testStromauskunftAccess();
        
        if (workingMethod) {
            console.log('\n✅ Ready to scrape with enhanced evasion!');
            console.log('Run: npm run scrape:proxy');
        } else {
            console.log('\n🔧 Consider adding proxy services or trying VPN.');
        }
    }
    
    main().catch(console.error);
} 