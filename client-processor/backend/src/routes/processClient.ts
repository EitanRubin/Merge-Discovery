/**
 * Process Client Routes
 * 
 * Defines the /api/process-client endpoint
 * Handles request validation and delegates to the service layer
 */

import { Router, Request, Response } from 'express';
import { ClientProcessorService } from '../services/clientProcessor';
import { ProcessClientRequest, ProcessClientResponse, AppConfig } from '../types';
import { logger } from '../utils/logger';

/**
 * Create the process-client router with the given configuration
 */
export function createProcessClientRouter(config: AppConfig): Router {
  const router = Router();
  const processorService = new ClientProcessorService(config);

  /**
   * POST /api/process-client
   * 
   * Accepts a client URL, processes it, and sends the result to the target API.
   * This is a synchronous endpoint - it waits for processing to complete.
   * 
   * Request Body:
   * {
   *   "clientUrl": "https://example.com"
   * }
   * 
   * Success Response (200):
   * {
   *   "success": true,
   *   "message": "Processing complete",
   *   "data": { ... ResultPayload ... }
   * }
   * 
   * Error Responses:
   * - 400: Invalid or missing clientUrl
   * - 500: Server error or failed to send to target API
   * - 502: Failed to reach target API
   */
  router.post('/', async (req: Request, res: Response) => {
    logger.requestReceived('POST', '/api/process-client', req.body);

    try {
      const { clientUrl } = req.body as ProcessClientRequest;

      // Validate clientUrl presence
      if (!clientUrl) {
        const response: ProcessClientResponse = {
          success: false,
          message: 'Validation failed',
          error: 'clientUrl is required in request body'
        };
        logger.warn('Request validation failed: missing clientUrl');
        return res.status(400).json(response);
      }

      // Validate URL format
      const validation = processorService.validateUrl(clientUrl);
      if (!validation.valid) {
        const response: ProcessClientResponse = {
          success: false,
          message: 'Validation failed',
          error: validation.error
        };
        logger.warn(`Request validation failed: ${validation.error}`);
        return res.status(400).json(response);
      }

      // Check if TARGET_API_URL is configured
      if (!config.targetApiUrl) {
        const response: ProcessClientResponse = {
          success: false,
          message: 'Server configuration error',
          error: 'TARGET_API_URL is not configured on the server'
        };
        logger.error('TARGET_API_URL is not configured');
        return res.status(500).json(response);
      }

      // Process the URL (synchronous - waits for completion)
      const result = await processorService.process(clientUrl);

      if (!result.success) {
        // Determine appropriate status code based on error
        const statusCode = result.error?.includes('target API') ? 502 : 500;
        
        const response: ProcessClientResponse = {
          success: false,
          message: 'Processing failed',
          data: result.payload,
          error: result.error
        };
        return res.status(statusCode).json(response);
      }

      // Success response
      const response: ProcessClientResponse = {
        success: true,
        message: 'Processing complete - result sent to target API',
        data: result.payload
      };
      
      return res.status(200).json(response);

    } catch (error) {
      logger.error('Unexpected error in process-client route', { 
        error: (error as Error).message,
        stack: (error as Error).stack 
      });

      const response: ProcessClientResponse = {
        success: false,
        message: 'Internal server error',
        error: (error as Error).message
      };
      return res.status(500).json(response);
    }
  });

  return router;
}

