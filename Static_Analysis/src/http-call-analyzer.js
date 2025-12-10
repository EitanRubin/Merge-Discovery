import { DeepHTTPAnalyzer } from "./deep-http-analyzer.js";
import { ReportGenerator } from "./reporter/report-generator.js";
import { ValidationUtils } from "./utils/validation-utils.js";
import chalk from "chalk";
import path from "path";

export class HTTPAnalyzer {
    constructor(options = {}) {
        this.options = this.validateAndSetOptions(options);

        this.deepAnalyzer = new DeepHTTPAnalyzer(this.options);
        this.reportGenerator = new ReportGenerator();
    }

    validateAndSetOptions(options) {
        const defaultOptions = {
            includeExtensions: ['.js', '.jsx', '.ts', '.tsx', '.vue', '.php', '.py', '.rb', '.java', '.cs', '.cpp', '.c', '.h', '.go', '.rs', '.kt', '.swift', '.dart', '.scala', '.html', '.xml', '.json', '.yml', '.yaml'],
            excludePatterns: ['node_modules', 'dist', 'build', '.git', '__pycache__', 'vendor', 'target', 'bin', 'obj', '.next', '.nuxt', 'coverage', 'tmp', 'temp', '.cache']
        };

        const validatedOptions = { ...defaultOptions, ...options };

        const errors = ValidationUtils.validateOptions(validatedOptions, {
            includeExtensions: {
                type: 'object',
                required: true,
                validate: (val) => Array.isArray(val) && val.length > 0
            },
            excludePatterns: {
                type: 'object',
                required: true,
                validate: (val) => Array.isArray(val)
            }
        });

        if (errors.length > 0) {
            throw new Error(`Invalid options: ${errors.join(', ')}`);
        }

        return validatedOptions;
    }

    async analyzeDirectory(dirPath) {
        if (!ValidationUtils.isValidDirectory(dirPath)) {
            throw new Error(`Invalid directory: ${dirPath}`);
        }

        let results = null;
        try {            
            results = await this.deepAnalyzer.analyzeDirectory(dirPath);
        } catch (error) {
            console.error(`error at analyzeDirectory: ${error}`)
        }
        if(!results)return;

        try {
            const report = this.reportGenerator.generateReport(results);           
            return report;
        } catch (error) {
            console.error(`Error generating report: ${error}`)
        }

    }

    async analyzeFile(filePath) {
        // Use deep analyzer for single file analysis
        return await this.deepAnalyzer.analyzeDirectory(path.dirname(filePath));
    }

    printReport(report) {
        return this.reportGenerator.printReport(report);
    }

    exportReport(report, format = 'json', filename = null) {
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

        switch (format.toLowerCase()) {
            case 'json':
                filename = filename || `http-analysis-${timestamp}.json`;
                return this.reportGenerator.exportToJSON(report, filename);

            case 'csv':
                filename = filename || `http-analysis-${timestamp}.csv`;
                return this.reportGenerator.exportToCSV(report, filename);

            case 'markdown':
                filename = filename || `http-analysis-${timestamp}.md`;
                return this.reportGenerator.exportToMarkdown(report);

            default:
                throw new Error(`Unsupported export format: ${format}`);
        }
    }

    getStatistics(report) {
        const stats = {
            ...report.summary,
            mostCommonPatterns: this.getMostCommonPatterns(report.findings),
            filesByFindings: this.getFilesByFindingsCount(report.groupedByFile),
        };

        return stats;
    }

    getMostCommonPatterns(findings) {
        const patterns = {};
        const methods = {};

        findings.forEach(finding => {
            const pattern = finding.method || finding.type;
            patterns[pattern] = (patterns[pattern] || 0) + 1;

            if (finding.httpMethod) {
                methods[finding.httpMethod] = (methods[finding.httpMethod] || 0) + 1;
            }
        });

        return {
            patterns: Object.entries(patterns)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([pattern, count]) => ({ pattern, count })),
            httpMethods: Object.entries(methods)
                .sort(([, a], [, b]) => b - a)
                .map(([method, count]) => ({ method, count }))
        };
    }

    getFilesByFindingsCount(groupedByFile) {
        return Object.entries(groupedByFile)
            .map(([file, findings]) => ({
                file,
                count: findings.length,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);
    }

    groupInternalUrlByType(internalUrls) {
        const grouped = {};

        internalUrls.forEach(finding => {
            const type = finding.type;
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push(finding);
        });

        return grouped;
    }

    updateOptions(newOptions) {
        this.options = this.validateAndSetOptions({ ...this.options, ...newOptions });

        // Recreate deep analyzer with new options
        this.deepAnalyzer = new DeepHTTPAnalyzer(this.options);

        console.log(chalk.blue('🔄️ Options updated'));
    }

    getOptions() {
        return { ...this.options };
    }

    // Enhanced deep analysis methods
    async performDeepAnalysis(dirPath) {
        if (!ValidationUtils.isValidDirectory(dirPath)) {
            throw new Error(`Invalid directory: ${dirPath}`);
        }

        console.log(chalk.blue('🔍 Starting comprehensive deep HTTP analysis...'));
        
        try {
            const results = await this.deepAnalyzer.analyzeDirectory(dirPath);
            const report = this.reportGenerator.generateReport(results);
            
            console.log(chalk.green('✅ Deep analysis completed successfully!'));
            return report;
        } catch (error) {
            console.error(chalk.red('❌ Deep analysis failed:'), error);
            throw error;
        }
    }

    async analyzeFileDeep(filePath) {
        try {
            const result = await this.deepAnalyzer.analyzeFile(filePath);
            return result;
        } catch (error) {
            console.error(chalk.red(`❌ Error in deep file analysis: ${error.message}`));
            throw error;
        }
    }

    getDeepAnalysisStatistics() {
        return this.deepAnalyzer.getStatistics();
    }

    generateSecurityReport() {
        const results = this.deepAnalyzer.getResults();
        return {
            summary: results.statistics,
            securityIssues: results.statistics.securityIssues || [],
            recommendations: this.deepAnalyzer.generateRecommendations(),
            httpsCoverage: this.calculateHttpsCoverage(results.httpCalls)
        };
    }

    generatePerformanceReport() {
        const results = this.deepAnalyzer.getResults();
        const performanceIssues = [];
        
        results.httpCalls.forEach(call => {
            if (call.performance && call.performance.suggestions.length > 0) {
                performanceIssues.push({
                    location: call.location,
                    suggestions: call.performance.suggestions
                });
            }
        });

        return {
            totalCalls: results.statistics.totalHttpCalls,
            performanceIssues,
            recommendations: this.generatePerformanceRecommendations(results.httpCalls)
        };
    }

    calculateHttpsCoverage(httpCalls) {
        if (!httpCalls || httpCalls.length === 0) return 0;
        
        const httpsCallsCount = httpCalls.filter(call => 
            call.url && typeof call.url === 'string' && call.url.startsWith('https:')
        ).length;
        
        return Math.round((httpsCallsCount / httpCalls.length) * 100);
    }

    generatePerformanceRecommendations(httpCalls) {
        const recommendations = [];
        const callsInLoops = httpCalls.filter(call => 
            call.performance?.suggestions?.some(s => s.type === 'loop_optimization')
        ).length;
        
        if (callsInLoops > 0) {
            recommendations.push({
                type: 'batch_requests',
                message: `${callsInLoops} HTTP calls detected in loops - consider request batching`,
                priority: 'high'
            });
        }

        const getCalls = httpCalls.filter(call => call.httpMethod === 'GET').length;
        if (getCalls > 20) {
            recommendations.push({
                type: 'caching',
                message: `${getCalls} GET requests found - implement caching strategy`,
                priority: 'medium'
            });
        }

        return recommendations;
    }
}

export default HTTPAnalyzer;