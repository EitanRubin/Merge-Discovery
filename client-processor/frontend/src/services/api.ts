/**
 * API Service
 * 
 * Handles communication with the backend API
 */

import { DiscoverRequest, DiscoverResponse } from '../types';

// API base URL - uses Vite proxy in development
const API_BASE_URL = '/api';

/**
 * Discover API calls from a target URL
 * 
 * Makes a POST request to trigger the discovery pipeline:
 * - If quickMode=true: returns existing results immediately (fast)
 * - If quickMode=false: runs full analysis (slow, 5-10 minutes)
 * 
 * @param clientUrl - The URL to analyze
 * @param quickMode - If true, return existing results immediately (default: true)
 * @returns Promise with the discovery result
 */
export async function discoverApiCalls(clientUrl: string, quickMode: boolean = true): Promise<DiscoverResponse> {
  const requestBody = { clientUrl, quickMode };

  try {
    const response = await fetch(`${API_BASE_URL}/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const data: DiscoverResponse = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.message || `Request failed with status ${response.status}`,
        error: data.error || response.statusText,
        data: data.data
      };
    }

    return data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      success: false,
      message: 'Failed to connect to server',
      error: errorMessage
    };
  }
}

/**
 * Get the latest discovery results without triggering a new scan
 */
export async function getLatestResults(): Promise<DiscoverResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/discover/results`);
    const data: DiscoverResponse = await response.json();
    return data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return {
      success: false,
      message: 'Failed to fetch results',
      error: errorMessage
    };
  }
}

/**
 * Download the JSON file
 */
export function downloadJson(): void {
  const link = document.createElement('a');
  link.href = `${API_BASE_URL}/discover/download`;
  link.download = `api_calls_${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Check backend health
 */
export async function checkHealth(): Promise<{ status: string; targetApiConfigured: boolean }> {
  const response = await fetch('/health');
  return response.json();
}
