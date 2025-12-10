/**
 * API Discovery Routes
 * 
 * POST /api/discover - Discover API calls from a target URL
 * GET /api/download - Download the latest API calls JSON
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { ApiDiscoveryService } from '../services/apiDiscoveryService';
import { DiscoverRequest, DiscoverResponse, AppConfig } from '../types';
import { logger } from '../utils/logger';

export function createDiscoverRouter(config: AppConfig): Router {
  const router = Router();
  const discoveryService = new ApiDiscoveryService();

  /**
   * POST /api/discover
   * 
   * Runs the full API discovery pipeline:
   * 1. Dynamic analysis (Noizz2025 crawling)
   * 2. Static analysis (Babel AST parsing)
   * 3. Merge and deduplicate results
   * 4. Optionally send to TARGET_API_URL
   * 
   * Request Body:
   * {
   *   "clientUrl": "http://localhost:4200",
   *   "quickMode": true  // Optional: return existing results immediately
   * }
   */
  router.post('/', async (req: Request, res: Response) => {
    logger.requestReceived('POST', '/api/discover', req.body);

    try {
      const { clientUrl, quickMode, showAll } = req.body as DiscoverRequest & { quickMode?: boolean; showAll?: boolean };

      // Validate clientUrl
      if (!clientUrl) {
        const response: DiscoverResponse = {
          success: false,
          message: 'Validation failed',
          error: 'clientUrl is required'
        };
        return res.status(400).json(response);
      }

      // Validate URL format
      try {
        new URL(clientUrl);
      } catch {
        const response: DiscoverResponse = {
          success: false,
          message: 'Validation failed',
          error: 'Invalid URL format'
        };
        return res.status(400).json(response);
      }

      // realOnly = true by default (filter out framework patterns)
      // showAll = true means show all including framework patterns
      const realOnly = !showAll;

      logger.info(`Starting API discovery for: ${clientUrl} (quickMode: ${quickMode || false}, realOnly: ${realOnly})`);

      // Run the discovery pipeline
      const result = await discoveryService.discoverApiCalls(clientUrl, quickMode || false, realOnly);

      // Send to TARGET_API_URL if configured
      if (config.targetApiUrl && result.success) {
        try {
          logger.info(`Sending results to target API: ${config.targetApiUrl}`);
          await axios.post(config.targetApiUrl, {
            clientUrl,
            discoveredAt: new Date().toISOString(),
            ...result
          }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: config.requestTimeout
          });
          logger.info('Results sent to target API successfully');
        } catch (error: any) {
          logger.warn(`Failed to send to target API: ${error.message}`);
          // Don't fail the request, just log the warning
        }
      }

      // Return response
      const response: DiscoverResponse = {
        success: result.success,
        message: result.success 
          ? `Discovered ${result.summary.unique_calls} unique API calls`
          : 'Discovery completed with errors',
        data: result
      };

      return res.status(result.success ? 200 : 500).json(response);

    } catch (error: any) {
      logger.error('Discovery error', { error: error.message });
      const response: DiscoverResponse = {
        success: false,
        message: 'Internal server error',
        error: error.message
      };
      return res.status(500).json(response);
    }
  });

  /**
   * GET /api/discover/download
   * 
   * Download the latest merged API calls JSON file
   */
  router.get('/download', (req: Request, res: Response) => {
    logger.requestReceived('GET', '/api/discover/download');

    try {
      const outputPath = discoveryService.getMergedOutputPath();

      if (!fs.existsSync(outputPath)) {
        return res.status(404).json({
          success: false,
          message: 'No results available',
          error: 'Run a discovery first to generate results'
        });
      }

      const filename = `api_calls_${new Date().toISOString().split('T')[0]}.json`;
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      const fileStream = fs.createReadStream(outputPath);
      fileStream.pipe(res);

    } catch (error: any) {
      logger.error('Download error', { error: error.message });
      return res.status(500).json({
        success: false,
        message: 'Download failed',
        error: error.message
      });
    }
  });

  /**
   * GET /api/discover/results
   * 
   * Get the latest discovery results without triggering a new scan
   */
  router.get('/results', (req: Request, res: Response) => {
    logger.requestReceived('GET', '/api/discover/results');

    try {
      const outputPath = discoveryService.getMergedOutputPath();

      if (!fs.existsSync(outputPath)) {
        return res.status(404).json({
          success: false,
          message: 'No results available',
          error: 'Run a discovery first to generate results'
        });
      }

      const data = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      
      return res.json({
        success: true,
        message: 'Results retrieved',
        data: {
          success: true,
          summary: data.summary,
          api_calls: data.api_calls
        }
      });

    } catch (error: any) {
      logger.error('Results fetch error', { error: error.message });
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch results',
        error: error.message
      });
    }
  });

  return router;
}

