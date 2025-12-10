/**
 * API Discovery Component
 * 
 * Main UI component for discovering API calls from websites.
 * Features:
 * - Text input for URL entry
 * - Discover button to trigger analysis
 * - Status feedback (Running, Success, Failed)
 * - API calls table with filtering
 * - Download JSON button
 */

import { useState, FormEvent, useMemo } from 'react';
import { discoverApiCalls, downloadJson } from '../services/api';
import { DiscoveryStatus, DiscoverResponse, ApiCall } from '../types';
import './ClientProcessor.css';

export function ClientProcessor() {
  // State
  const [clientUrl, setClientUrl] = useState<string>('');
  const [status, setStatus] = useState<DiscoveryStatus>('idle');
  const [response, setResponse] = useState<DiscoverResponse | null>(null);
  const [methodFilter, setMethodFilter] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [quickMode, setQuickMode] = useState<boolean>(true); // Default to quick mode

  // Filtered API calls
  const filteredCalls = useMemo(() => {
    if (!response?.data?.api_calls) return [];
    
    return response.data.api_calls.filter(call => {
      const matchesMethod = methodFilter === 'ALL' || call.method === methodFilter;
      const matchesSearch = searchFilter === '' || 
        call.url.toLowerCase().includes(searchFilter.toLowerCase()) ||
        (call.file && call.file.toLowerCase().includes(searchFilter.toLowerCase()));
      return matchesMethod && matchesSearch;
    });
  }, [response?.data?.api_calls, methodFilter, searchFilter]);

  // Get unique methods for filter dropdown
  const availableMethods = useMemo(() => {
    if (!response?.data?.api_calls) return [];
    const methods = new Set(response.data.api_calls.map(c => c.method));
    return Array.from(methods).sort();
  }, [response?.data?.api_calls]);

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    
    if (!clientUrl.trim()) {
      setStatus('failed');
      setResponse({
        success: false,
        message: 'Validation failed',
        error: 'Please enter a URL'
      });
      return;
    }

    setStatus('running');
    setResponse(null);
    setMethodFilter('ALL');
    setSearchFilter('');

    try {
      const result = await discoverApiCalls(clientUrl, quickMode);
      setStatus(result.success ? 'success' : 'failed');
      setResponse(result);
    } catch (error) {
      setStatus('failed');
      setResponse({
        success: false,
        message: 'Unexpected error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  /**
   * Handle download button click
   */
  const handleDownload = () => {
    downloadJson();
  };

  /**
   * Get method badge color
   */
  const getMethodColor = (method: string) => {
    const colors: Record<string, string> = {
      GET: '#00f5d4',
      POST: '#7b2cbf',
      PUT: '#f77f00',
      PATCH: '#fcbf49',
      DELETE: '#ff4757',
      OPTIONS: '#808080',
      HEAD: '#808080'
    };
    return colors[method] || '#808080';
  };

  /**
   * Get status class
   */
  const getStatusClass = () => {
    switch (status) {
      case 'running': return 'status-running';
      case 'success': return 'status-success';
      case 'failed': return 'status-failed';
      default: return 'status-idle';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'running': return 'Analyzing...';
      case 'success': return 'Complete';
      case 'failed': return 'Failed';
      default: return 'Ready';
    }
  };

  return (
    <div className="processor-container">
      {/* Header */}
      <header className="processor-header">
        <div className="logo">
          <span className="logo-icon">🔍</span>
          <span className="logo-text">API Discovery</span>
        </div>
        <div className={`status-badge ${getStatusClass()}`}>
          {status === 'running' && <span className="spinner"></span>}
          {getStatusText()}
        </div>
      </header>

      {/* Main Content */}
      <main className="processor-main">
        {/* Input Form */}
        <div className="form-card">
          <h1 className="form-title">Discover API Calls</h1>
          <p className="form-subtitle">
            Enter a URL to analyze and discover all API endpoints (dynamic + static analysis)
          </p>

          <form onSubmit={handleSubmit} className="url-form">
            <div className="input-group">
              <label htmlFor="clientUrl" className="input-label">
                Target URL
              </label>
              <input
                id="clientUrl"
                type="text"
                value={clientUrl}
                onChange={(e) => setClientUrl(e.target.value)}
                placeholder="http://localhost:4200"
                className="url-input"
                disabled={status === 'running'}
              />
            </div>

            <button
              type="submit"
              className="discover-button"
              disabled={status === 'running'}
            >
              {status === 'running' ? (
                <>
                  <span className="button-spinner"></span>
                  {quickMode ? 'Loading...' : 'Analyzing...'}
                </>
              ) : (
                <>
                  <span className="button-icon">🔍</span>
                  {quickMode ? 'Load Results' : 'Full Scan'}
                </>
              )}
            </button>
          </form>

          <div className="mode-toggle">
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={quickMode}
                onChange={(e) => setQuickMode(e.target.checked)}
                disabled={status === 'running'}
              />
              <span className="toggle-text">
                Quick Mode (use existing results - instant)
              </span>
            </label>
            {!quickMode && (
              <p className="mode-warning">
                ⚠️ Full scan takes 5-10 minutes. Only use if you need fresh data.
              </p>
            )}
          </div>

          {status === 'running' && (
            <div className="progress-info">
              <p>⏳ Running full analysis pipeline...</p>
              <p className="progress-detail">This may take 1-3 minutes depending on the website size.</p>
            </div>
          )}
        </div>

        {/* Error Display */}
        {response && !response.success && (
          <div className="response-card response-error">
            <div className="response-header">
              <span className="response-icon">✕</span>
              <h2 className="response-title">{response.message}</h2>
            </div>
            {response.error && (
              <div className="error-box">
                <strong>Error:</strong> {response.error}
              </div>
            )}
          </div>
        )}

        {/* Success Results */}
        {response?.success && response.data && (
          <>
            {/* Summary Card */}
            <div className="response-card response-success">
              <div className="response-header">
                <span className="response-icon">✓</span>
                <h2 className="response-title">{response.message}</h2>
              </div>

              <div className="summary-grid">
                <div className="summary-item">
                  <span className="summary-value">{response.data.summary.unique_calls}</span>
                  <span className="summary-label">Unique API Calls</span>
                </div>
                <div className="summary-item">
                  <span className="summary-value">{response.data.summary.sources.noizz25}</span>
                  <span className="summary-label">Dynamic Analysis</span>
                </div>
                <div className="summary-item">
                  <span className="summary-value">{response.data.summary.sources.static_analysis}</span>
                  <span className="summary-label">Static Analysis</span>
                </div>
                <div className="summary-item">
                  <span className="summary-value">{(response.data.summary.processing_time_ms / 1000).toFixed(1)}s</span>
                  <span className="summary-label">Processing Time</span>
                </div>
              </div>

              <button className="download-button" onClick={handleDownload}>
                <span className="button-icon">⬇</span>
                Download JSON
              </button>
            </div>

            {/* API Calls Table */}
            {response.data.api_calls.length > 0 && (
              <div className="api-calls-card">
                <div className="table-header">
                  <h3>Discovered API Calls</h3>
                  <div className="table-filters">
                    <select 
                      value={methodFilter} 
                      onChange={(e) => setMethodFilter(e.target.value)}
                      className="filter-select"
                    >
                      <option value="ALL">All Methods</option>
                      {availableMethods.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Search URLs..."
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      className="filter-input"
                    />
                  </div>
                </div>

                <div className="table-info">
                  Showing {filteredCalls.length} of {response.data.api_calls.length} calls
                </div>

                <div className="api-table-container">
                  <table className="api-table">
                    <thead>
                      <tr>
                        <th>Method</th>
                        <th>URL</th>
                        <th>Source</th>
                        <th>File</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCalls.map((call, index) => (
                        <tr key={index}>
                          <td>
                            <span 
                              className="method-badge"
                              style={{ backgroundColor: getMethodColor(call.method) }}
                            >
                              {call.method}
                            </span>
                          </td>
                          <td className="url-cell">{call.url}</td>
                          <td>
                            <div className="source-badges">
                              {call.sources.map(s => (
                                <span key={s} className={`source-badge source-${s.replace('_', '-')}`}>
                                  {s === 'noizz25' ? 'Dynamic' : 'Static'}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="file-cell">
                            {call.file ? (
                              <span title={`Line ${call.line}`}>
                                {call.file.split('/').pop()}:{call.line}
                              </span>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Raw JSON Preview */}
            <details className="json-preview-card">
              <summary>View Raw JSON</summary>
              <pre>{JSON.stringify(response.data, null, 2)}</pre>
            </details>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="processor-footer">
        <p>API Discovery Tool v2.0.0 • Dynamic + Static Analysis</p>
      </footer>
    </div>
  );
}
