/**
 * API Discovery Backend - Main Entry Point
 * 
 * This Express server provides an API for discovering API calls from websites.
 * When a URL is submitted, it:
 * 1. Runs Noizz2025 to crawl the website and capture JS files (dynamic analysis)
 * 2. Runs Static_Analysis to parse JS files with Babel AST (static analysis)
 * 3. Merges results into a unified JSON of all discovered API calls
 * 4. Optionally sends the result to a configured TARGET_API_URL
 * 
 * Environment Variables / Config:
 * - PORT: Server port (default: 3001)
 * - TARGET_API_URL: Optional - endpoint to send results to
 * - REQUEST_TIMEOUT: Timeout in ms (default: 30000)
 * - VERBOSE_LOGGING: Enable debug logs (default: false)
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createDiscoverRouter } from './routes/discover';
import { createProcessClientRouter } from './routes/processClient';
import { AppConfig } from './types';
import { logger } from './utils/logger';

// Load environment variables
dotenv.config();

// Try to load config from config.json if it exists
let fileConfig: Partial<AppConfig> = {};
const configPath = path.join(__dirname, '..', 'config.json');
try {
  if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(configContent);
    console.log('Loaded configuration from config.json');
  }
} catch (e) {
  console.log('No config.json found, using environment variables');
}

// Build configuration (env vars take precedence over config file)
const config: AppConfig = {
  port: parseInt(process.env.PORT || String(fileConfig.port) || '3001', 10),
  targetApiUrl: process.env.TARGET_API_URL || fileConfig.targetApiUrl || '',
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || String(fileConfig.requestTimeout) || '30000', 10),
  verboseLogging: process.env.VERBOSE_LOGGING === 'true' || fileConfig.verboseLogging || false
};

// Set logger verbose mode
logger.setVerbose(config.verboseLogging);

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Request logging middleware
app.use((req, res, next) => {
  logger.debug(`Incoming request: ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    targetApiConfigured: !!config.targetApiUrl,
    version: '2.0.0'
  });
});

// Main API routes
app.use('/api/discover', createDiscoverRouter(config));
app.use('/api/process-client', createProcessClientRouter(config));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    message: 'Endpoint not found',
    availableEndpoints: [
      'GET  /health',
      'POST /api/discover',
      'GET  /api/discover/results',
      'GET  /api/discover/download',
      'POST /api/process-client'
    ]
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ 
    success: false, 
    message: 'Internal server error',
    error: err.message 
  });
});

// Start server
const server = app.listen(config.port, () => {
  logger.info(`╔════════════════════════════════════════════════════════════╗`);
  logger.info(`║          API DISCOVERY BACKEND v2.0.0                      ║`);
  logger.info(`╠════════════════════════════════════════════════════════════╣`);
  logger.info(`║  Port: ${config.port}                                               ║`);
  logger.info(`║  Target API: ${config.targetApiUrl ? config.targetApiUrl.substring(0, 40) : 'NOT CONFIGURED'}${' '.repeat(Math.max(0, 40 - (config.targetApiUrl?.length || 14)))}║`);
  logger.info(`╠════════════════════════════════════════════════════════════╣`);
  logger.info(`║  Endpoints:                                                ║`);
  logger.info(`║    POST /api/discover      - Run full discovery            ║`);
  logger.info(`║    GET  /api/discover/results - Get latest results         ║`);
  logger.info(`║    GET  /api/discover/download - Download JSON             ║`);
  logger.info(`╚════════════════════════════════════════════════════════════╝`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
