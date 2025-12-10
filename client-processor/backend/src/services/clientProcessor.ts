/**
 * Client Processor Service
 * 
 * This service handles the core business logic:
 * 1. Validates and processes the client URL
 * 2. Fetches information from the client URL
 * 3. Builds the result payload
 * 4. Sends the payload to the target API
 */

import axios, { AxiosError } from 'axios';
import { ResultPayload, ProcessedDetails, AppConfig } from '../types';
import { logger } from '../utils/logger';

export class ClientProcessorService {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Validate that the provided string is a valid URL
   */
  validateUrl(url: string): { valid: boolean; error?: string } {
    if (!url || url.trim() === '') {
      return { valid: false, error: 'URL is required and cannot be empty' };
    }

    try {
      const parsedUrl = new URL(url);
      
      // Check for valid protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { valid: false, error: 'URL must use http or https protocol' };
      }

      return { valid: true };
    } catch (e) {
      return { valid: false, error: 'Invalid URL format' };
    }
  }

  /**
   * Extract URL information
   */
  private extractUrlInfo(url: string): ProcessedDetails['urlInfo'] {
    const parsedUrl = new URL(url);
    return {
      protocol: parsedUrl.protocol.replace(':', ''),
      hostname: parsedUrl.hostname,
      pathname: parsedUrl.pathname,
      fullUrl: url
    };
  }

  /**
   * Fetch information from the client URL
   */
  private async fetchClientUrl(url: string): Promise<ProcessedDetails['fetchResult'] | undefined> {
    const startTime = Date.now();
    
    try {
      logger.debug(`Fetching client URL: ${url}`);
      
      const response = await axios.get(url, {
        timeout: this.config.requestTimeout,
        validateStatus: () => true, // Accept all status codes
        maxRedirects: 5
      });

      const responseTime = Date.now() - startTime;

      return {
        statusCode: response.status,
        contentType: response.headers['content-type'] || 'unknown',
        contentLength: parseInt(response.headers['content-length'] || '0', 10),
        responseTime
      };
    } catch (error) {
      logger.warn(`Failed to fetch client URL: ${url}`, { error: (error as Error).message });
      return undefined;
    }
  }

  /**
   * Process the client URL and build the result payload
   */
  async processClientUrl(clientUrl: string): Promise<ResultPayload> {
    const startTime = Date.now();
    
    logger.processStarted(clientUrl);

    // Extract URL information
    const urlInfo = this.extractUrlInfo(clientUrl);

    // Fetch information from the URL
    const fetchResult = await this.fetchClientUrl(clientUrl);

    const processingDuration = Date.now() - startTime;

    // Build the result payload
    const payload: ResultPayload = {
      clientUrl,
      processedAt: new Date().toISOString(),
      status: fetchResult ? 'success' : 'error',
      details: {
        urlInfo,
        fetchResult,
        discoveredEndpoints: [], // Placeholder for future integration
        metadata: {
          processingDuration,
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        }
      }
    };

    logger.processCompleted(clientUrl, processingDuration);

    return payload;
  }

  /**
   * Send the result payload to the target API
   */
  async sendToTargetApi(payload: ResultPayload): Promise<{ success: boolean; error?: string }> {
    const targetUrl = this.config.targetApiUrl;

    if (!targetUrl) {
      return { success: false, error: 'TARGET_API_URL is not configured' };
    }

    logger.targetApiCall(targetUrl, 'started');

    try {
      const response = await axios.post(targetUrl, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: this.config.requestTimeout
      });

      logger.targetApiCall(targetUrl, 'success');
      logger.debug('Target API response', { status: response.status, data: response.data });

      return { success: true };
    } catch (error) {
      const axiosError = error as AxiosError;
      const errorMessage = axiosError.response 
        ? `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`
        : axiosError.message;

      logger.targetApiCall(targetUrl, 'failed', errorMessage);

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Main processing function - validates, processes, and sends to target
   */
  async process(clientUrl: string): Promise<{
    success: boolean;
    payload?: ResultPayload;
    error?: string;
  }> {
    // Validate URL
    const validation = this.validateUrl(clientUrl);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Process the URL
    const payload = await this.processClientUrl(clientUrl);

    // Send to target API
    const sendResult = await this.sendToTargetApi(payload);

    if (!sendResult.success) {
      return { 
        success: false, 
        payload, 
        error: `Failed to send to target API: ${sendResult.error}` 
      };
    }

    return { success: true, payload };
  }
}

