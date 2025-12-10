/**
 * Type definitions for the API Discovery Backend
 */

// Request body for the /api/discover endpoint
export interface DiscoverRequest {
  clientUrl: string;
}

// Individual API call discovered
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

// Summary of discovery results
export interface DiscoverySummary {
  total_calls_found: number;
  unique_calls: number;
  duplicates_removed: number;
  sources: {
    noizz25: number;
    static_analysis: number;
  };
  processing_time_ms: number;
}

// Full discovery result
export interface DiscoveryResult {
  success: boolean;
  summary: DiscoverySummary;
  api_calls: ApiCall[];
  errors?: string[];
}

// Response from the /api/discover endpoint
export interface DiscoverResponse {
  success: boolean;
  message: string;
  data?: DiscoveryResult;
  error?: string;
}

// Configuration loaded from environment
export interface AppConfig {
  port: number;
  targetApiUrl: string;
  requestTimeout: number;
  verboseLogging: boolean;
}

// Legacy types for backward compatibility
export interface ProcessClientRequest {
  clientUrl: string;
}

export interface ProcessClientResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface ResultPayload {
  clientUrl: string;
  processedAt: string;
  status: "success" | "error";
  details: any;
}
