/**
 * API Discovery Service
 * 
 * Orchestrates the full API discovery pipeline:
 * 1. Updates Noizz2025 config with user's URL
 * 2. Runs Noizz2025 to crawl and capture JS files (dynamic analysis)
 * 3. Extracts JS content from captured files
 * 4. Runs Static Analysis on extracted JS files
 * 5. Merges results into unified API calls JSON
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { logger } from '../utils/logger';

// Paths relative to the project root
const BASE_DIR = path.resolve(__dirname, '..', '..', '..', '..');
const NOIZZ_DIR = path.join(BASE_DIR, 'Noizz2025');
const OUTPUTS_DIR = path.join(BASE_DIR, 'outputs');
const MERGED_OUTPUT = path.join(OUTPUTS_DIR, 'api_calls_merged.json');
const REAL_API_OUTPUT = path.join(OUTPUTS_DIR, 'real_api_calls.json');

export interface ApiCall {
  method: string;
  url: string;
  file: string | null;
  line: number | null;
  column: number | null;
  sources: string[];
  authentication?: string;
  library?: string | null;
  locations?: Array<{
    file: string;
    line: number;
    column: number | null;
  }>;
}

export interface DiscoveryResult {
  success: boolean;
  summary: {
    total_calls_found: number;
    unique_calls: number;
    duplicates_removed: number;
    sources: {
      noizz25: number;
      static_analysis: number;
    };
    processing_time_ms: number;
  };
  api_calls: ApiCall[];
  errors?: string[];
}

export class ApiDiscoveryService {
  private noizzServerProcess: ChildProcess | null = null;

  /**
   * Update Noizz2025 config with the target URL
   */
  private updateNoizzConfig(targetUrl: string): void {
    const configPath = path.join(NOIZZ_DIR, 'config.json');
    
    let config: any = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    config.start_url = targetUrl;
    config.max_depth = 2;
    config.max_clicks_per_page = 10;

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    logger.info(`Updated Noizz2025 config with URL: ${targetUrl}`);
  }

  /**
   * Start the Noizz2025 API server
   */
  private async startNoizzServer(): Promise<boolean> {
    return new Promise((resolve) => {
      logger.info('Starting Noizz2025 API server...');

      this.noizzServerProcess = spawn('python', ['api_server.py'], {
        cwd: NOIZZ_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      this.noizzServerProcess.stdout?.on('data', (data) => {
        logger.debug(`Noizz2025: ${data.toString()}`);
      });

      this.noizzServerProcess.stderr?.on('data', (data) => {
        logger.debug(`Noizz2025 stderr: ${data.toString()}`);
      });

      // Wait for server to be ready
      let attempts = 0;
      const maxAttempts = 30;
      
      const checkServer = setInterval(async () => {
        attempts++;
        try {
          const response = await axios.get('http://localhost:8000/health', { timeout: 2000 });
          if (response.status === 200) {
            clearInterval(checkServer);
            logger.info('Noizz2025 server is ready');
            resolve(true);
          }
        } catch (e) {
          if (attempts >= maxAttempts) {
            clearInterval(checkServer);
            logger.error('Noizz2025 server failed to start');
            resolve(false);
          }
        }
      }, 1000);
    });
  }

  /**
   * Stop the Noizz2025 server
   */
  private stopNoizzServer(): void {
    if (this.noizzServerProcess) {
      logger.info('Stopping Noizz2025 server...');
      
      if (process.platform === 'win32') {
        spawn('taskkill', ['/F', '/T', '/PID', this.noizzServerProcess.pid!.toString()], { shell: true });
      } else {
        this.noizzServerProcess.kill('SIGTERM');
      }
      
      this.noizzServerProcess = null;
    }
  }

  /**
   * Trigger the mapping process via Noizz2025 API
   */
  private async runNoizzMapping(targetUrl: string): Promise<boolean> {
    try {
      logger.info(`Starting Noizz2025 mapping for: ${targetUrl}`);

      const configPath = path.join(NOIZZ_DIR, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      const response = await axios.post(
        'http://localhost:8000/map',
        { config },
        { timeout: 300000 } // 5 minutes timeout
      );

      if (response.status === 200) {
        const result = response.data;
        logger.info(`Noizz2025 mapping complete:`);
        logger.info(`  - UI endpoints: ${result.ui_endpoints?.length || 0}`);
        logger.info(`  - Server endpoints: ${result.server_endpoints?.length || 0}`);
        logger.info(`  - JS files captured: ${result.js_files_count || 0}`);
        return true;
      }

      return false;
    } catch (error: any) {
      logger.error(`Noizz2025 mapping failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Run the full analysis pipeline using Python script
   */
  private runPythonPipeline(targetUrl: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const scriptPath = path.join(BASE_DIR, 'run_analysis.py');
      
      logger.info('Running Python analysis pipeline...');

      const pythonProcess = spawn('python', [scriptPath, '--url', targetUrl], {
        cwd: BASE_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true
      });

      let output = '';
      let errorOutput = '';

      pythonProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        logger.debug(text);
      });

      pythonProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        logger.debug(`stderr: ${text}`);
      });

      pythonProcess.on('close', (code) => {
        resolve({
          success: code === 0,
          output: output + errorOutput
        });
      });

      pythonProcess.on('error', (error) => {
        logger.error(`Pipeline process error: ${error.message}`);
        resolve({
          success: false,
          output: error.message
        });
      });
    });
  }

  /**
   * Read the merged API calls result
   * @param realOnly - If true, return only real HTTP/HTTPS URLs (filtered)
   */
  private readMergedResult(realOnly: boolean = true): DiscoveryResult | null {
    try {
      // Use real_api_calls.json for filtered results, api_calls_merged.json for all
      const outputFile = realOnly ? REAL_API_OUTPUT : MERGED_OUTPUT;
      
      if (!fs.existsSync(outputFile)) {
        // Fall back to merged if real doesn't exist
        if (realOnly && fs.existsSync(MERGED_OUTPUT)) {
          logger.warn('Real API file not found, falling back to merged');
          return this.readMergedResult(false);
        }
        logger.warn('Output file not found');
        return null;
      }

      const data = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
      logger.info(`Loaded ${realOnly ? 'real' : 'all'} API calls: ${data.api_calls?.length || 0} calls`);
      
      return {
        success: true,
        summary: {
          ...data.summary,
          processing_time_ms: 0 // Will be set by caller
        },
        api_calls: data.api_calls || []
      };
    } catch (error: any) {
      logger.error(`Error reading result: ${error.message}`);
      return null;
    }
  }

  /**
   * Main discovery function - runs the full pipeline
   * @param targetUrl - URL to analyze
   * @param quickMode - If true, return existing results immediately (fast)
   * @param realOnly - If true, return only real HTTP/HTTPS URLs (default: true)
   */
  async discoverApiCalls(targetUrl: string, quickMode: boolean = false, realOnly: boolean = true): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    logger.info(`Starting API discovery for: ${targetUrl} (quickMode: ${quickMode}, realOnly: ${realOnly})`);

    // Quick mode: return existing results immediately
    if (quickMode) {
      const existingResult = this.readMergedResult(realOnly);
      if (existingResult) {
        existingResult.summary.processing_time_ms = Date.now() - startTime;
        logger.info(`Quick mode: Returning existing results (${existingResult.api_calls.length} API calls)`);
        return existingResult;
      }
    }

    try {
      // Step 1: Update config
      this.updateNoizzConfig(targetUrl);

      // Step 2: Run the full Python pipeline
      const pipelineResult = await this.runPythonPipeline(targetUrl);

      if (!pipelineResult.success) {
        errors.push('Pipeline execution failed');
        logger.error('Pipeline failed');
      }

      // Step 3: Read results
      const result = this.readMergedResult(realOnly);

      if (result) {
        result.summary.processing_time_ms = Date.now() - startTime;
        result.errors = errors.length > 0 ? errors : undefined;
        
        logger.info(`API discovery complete in ${result.summary.processing_time_ms}ms`);
        logger.info(`Found ${result.api_calls.length} API calls`);
        
        return result;
      }

      // Return empty result if no data
      return {
        success: false,
        summary: {
          total_calls_found: 0,
          unique_calls: 0,
          duplicates_removed: 0,
          sources: { noizz25: 0, static_analysis: 0 },
          processing_time_ms: Date.now() - startTime
        },
        api_calls: [],
        errors: ['No API calls discovered']
      };

    } catch (error: any) {
      logger.error(`Discovery error: ${error.message}`);
      return {
        success: false,
        summary: {
          total_calls_found: 0,
          unique_calls: 0,
          duplicates_removed: 0,
          sources: { noizz25: 0, static_analysis: 0 },
          processing_time_ms: Date.now() - startTime
        },
        api_calls: [],
        errors: [error.message]
      };
    }
  }

  /**
   * Get existing results without running a new scan
   */
  getExistingResults(): DiscoveryResult | null {
    return this.readMergedResult();
  }

  /**
   * Get the path to the merged output file
   */
  getMergedOutputPath(): string {
    return MERGED_OUTPUT;
  }
}

