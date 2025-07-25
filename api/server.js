/**
 * German Electricity Price API Server
 * Provides REST API access to monthly electricity price data
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
require('dotenv').config();

const SupabaseClient = require('../database/supabase-client');
const apiRoutes = require('./routes/api-routes');
const { errorHandler, notFoundHandler } = require('./middleware/error-middleware');
const { validateEnvironment } = require('./utils/validation');

// Validate environment variables on startup
validateEnvironment();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Trust proxy for Vercel deployment (fixes rate limiting)
app.set('trust proxy', true);

// Initialize database connection
const db = new SupabaseClient();

// Test database connection on startup
async function initializeServer() {
    try {
        console.log('🔗 Testing database connection...');
        await db.testConnection();
        console.log('✅ Database connection successful');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    }
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Allow Swagger UI to work
}));

// CORS configuration
const corsOptions = {
    origin: true, // Allow all origins - you can restrict this later
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: NODE_ENV === 'production' ? 100 : 1000, // requests per window
    message: {
        error: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Add database to request context
app.use((req, res, next) => {
    req.db = db;
    next();
});

// Health check endpoint (before authentication)
app.get('/health', async (req, res) => {
    try {
        // Test database connectivity
        await db.testConnection();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            environment: NODE_ENV,
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: 'Database connection failed',
            environment: NODE_ENV
        });
    }
});

// API routes
app.use('/api/v1', apiRoutes);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'German Electricity Price API',
        version: '1.0.0',
        documentation: '/api/v1/docs',
        endpoints: {
            health: '/health',
            priceByPLZ: '/api/v1/price/{plz}/{year}/{month}',
            latestPrice: '/api/v1/price/{plz}/latest',
            nationalAverage: '/api/v1/average/{year}/{month}',
            coverage: '/api/v1/coverage/{year}/{month}',
            availableMonths: '/api/v1/months'
        }
    });
});

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
async function startServer() {
    await initializeServer();
    
    app.listen(PORT, () => {
        console.log(`🚀 German Electricity Price API running on port ${PORT}`);
        console.log(`📖 Environment: ${NODE_ENV}`);
        console.log(`🌐 API Base URL: http://localhost:${PORT}/api/v1`);
        console.log(`💚 Health Check: http://localhost:${PORT}/health`);
        
        if (NODE_ENV === 'development') {
            console.log(`📋 Available endpoints:`);
            console.log(`   GET /health`);
            console.log(`   GET /api/v1/price/{plz}/{year}/{month}`);
            console.log(`   GET /api/v1/price/{plz}/latest`);
            console.log(`   GET /api/v1/average/{year}/{month}`);
            console.log(`   GET /api/v1/coverage/{year}/{month}`);
            console.log(`   GET /api/v1/months`);
        }
    });
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🔄 SIGTERM received, shutting down gracefully...');
    await db.close?.();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('\n🔄 SIGINT received, shutting down gracefully...');
    await db.close?.();
    process.exit(0);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Promise Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start the server
if (require.main === module) {
    startServer().catch(error => {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = app; 