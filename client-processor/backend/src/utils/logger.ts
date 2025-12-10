/**
 * Simple logging utility with timestamps and log levels
 * Provides consistent logging format across the application
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

class Logger {
  private verboseMode: boolean = false;

  /**
   * Set verbose mode for debug logging
   */
  setVerbose(enabled: boolean): void {
    this.verboseMode = enabled;
  }

  /**
   * Get current timestamp in ISO format
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Format and output log message
   */
  private log(level: LogLevel, message: string, data?: any): void {
    const timestamp = this.getTimestamp();
    const prefix = `[${timestamp}] [${level}]`;
    
    if (data) {
      console.log(`${prefix} ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Log info messages
   */
  info(message: string, data?: any): void {
    this.log('INFO', message, data);
  }

  /**
   * Log warning messages
   */
  warn(message: string, data?: any): void {
    this.log('WARN', message, data);
  }

  /**
   * Log error messages
   */
  error(message: string, data?: any): void {
    this.log('ERROR', message, data);
  }

  /**
   * Log debug messages (only in verbose mode)
   */
  debug(message: string, data?: any): void {
    if (this.verboseMode) {
      this.log('DEBUG', message, data);
    }
  }

  /**
   * Log request received
   */
  requestReceived(method: string, path: string, body?: any): void {
    this.info(`Request received: ${method} ${path}`, this.verboseMode ? body : undefined);
  }

  /**
   * Log process started
   */
  processStarted(clientUrl: string): void {
    this.info(`Process started for URL: ${clientUrl}`);
  }

  /**
   * Log process completed
   */
  processCompleted(clientUrl: string, duration: number): void {
    this.info(`Process completed for URL: ${clientUrl} (${duration}ms)`);
  }

  /**
   * Log API call to target
   */
  targetApiCall(url: string, status: 'started' | 'success' | 'failed', error?: string): void {
    if (status === 'started') {
      this.info(`Sending result to target API: ${url}`);
    } else if (status === 'success') {
      this.info(`Successfully sent result to target API: ${url}`);
    } else {
      this.error(`Failed to send result to target API: ${url}`, { error });
    }
  }
}

// Export singleton instance
export const logger = new Logger();

