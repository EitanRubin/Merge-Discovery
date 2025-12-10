/**
 * Type definitions for the API Discovery Frontend
 */

// Status of the discovery request
export type DiscoveryStatus = 'idle' | 'running' | 'success' | 'failed';

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

// Response from the API
export interface DiscoverResponse {
  success: boolean;
  message: string;
  data?: DiscoveryResult;
  error?: string;
}

// Request body for the API
export interface DiscoverRequest {
  clientUrl: string;
}
