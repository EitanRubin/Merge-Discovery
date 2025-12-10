import HTTPAnalyzer from '../http-call-analyzer.js';
import { DeepHTTPAnalyzer } from '../deep-http-analyzer.js';
import { ValidationUtils } from '../utils/validation-utils.js';
import chalk from "chalk";
import fs from 'fs';

export class CLI {
    constructor() {
        this.analyzer = null;
    }

    parseArgs(args) {
        const options = {
            directory: './', // Generic: start from current directory
            format: 'json',
            output: null,
            quiet: false,
            verbose: false,
            include: null,
            exclude: null,
            deep: false,
            security: false,
            performance: false
        };

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];

            switch (arg) {
                case '--help':
                case '-h':
                    this.showHelp();
                    process.exit(0);

                case '--version':
                case '-v':
                    this.showVersion();
                    process.exit(0);

                case '--format':
                case '-f':
                    options.format = args[++i];
                    break;

                case '--output':
                case '-o':
                    options.output = args[++i];
                    break;

                case '--quiet':
                case '-q':
                    options.quiet = true;
                    break;

                case '--verbose':
                    options.verbose = true;
                    break;

                case '--include':
                    options.include = args[++i].split(',');
                    break;

                case '--exclude':
                    options.exclude = args[++i].split(',');
                    break;

                case '--deep':
                case '-d':
                    options.deep = true;
                    break;

                case '--security':
                case '-s':
                    options.security = true;
                    break;

                case '--performance':
                case '-p':
                    options.performance = true;
                    break;

                case '--json':
                case '-j':
                    options.format = 'json';
                    options.deep = true; // Auto-enable deep analysis for JSON
                    options.security = true;
                    options.performance = true;
                    break;

                case '--export':
                case '-e':
                    options.output = args[++i];
                    break;

                default:
                    if (!arg.startsWith('--') && !options.directorySet) {
                        options.directory = arg;
                        options.directorySet = true;
                    }
            }
        }

        return options;
    }

    async run(args) {
        try {
            const options = this.parseArgs(args);

            if (!options.quiet) {
                this.showBanner();
            }

            if (!ValidationUtils.isValidDirectory(options.directory)) {
                console.error(chalk.red(`❌ Directory not found: ${options.directory}`));
                process.exit(1)
            }

            const analyzerOptions = {
                verbose: options.verbose,
                deep: options.deep,
                includeSecurityAnalysis: options.security,
                includePerformanceAnalysis: options.performance
            };

            if (options.include) {
                analyzerOptions.includeExtensions = options.include.map(ext =>
                    ext.startsWith('.') ? ext : `.${ext}`
                )
            }

            if (options.exclude) {
                analyzerOptions.excludePatterns = [
                    ...analyzerOptions.excludePatterns || [],
                    ...options.exclude
                ];
            }

            let report;
            
            // Choose analyzer based on options
            if (options.deep || options.security || options.performance) {
                console.log(chalk.blue('🔬 Using Deep HTTP Analyzer...'));
                this.analyzer = new DeepHTTPAnalyzer(analyzerOptions);
                report = await this.analyzer.analyzeDirectory(options.directory);
                
                if (options.security) {
                    const securityReport = this.analyzer.generateSecurityReport();
                    console.log(chalk.red.bold('\n🔒 Security Analysis:'));
                    this.printSecurityReport(securityReport);
                }
                
                if (options.performance) {
                    const performanceReport = this.analyzer.generatePerformanceReport();
                    console.log(chalk.yellow.bold('\n⚡ Performance Analysis:'));
                    this.printPerformanceReport(performanceReport);
                }
            } else {
                this.analyzer = new HTTPAnalyzer(analyzerOptions);
                report = this.analyzer.analyzeDirectory(options.directory);
            }

            if (!options.quiet && report) {
                if (this.analyzer.printReport) {
                    this.analyzer.printReport(report);
                } else {
                    console.log(chalk.blue('\nAnalysis Results:'));
                    console.log(chalk.green(`✅ Found ${report.httpCalls ? report.httpCalls.length : 'N/A'} HTTP calls`));
                }
            }

            // Export functionality
            if (options.format !== 'console' || options.output) {
                try {
                    let exportResult;
                    
                    if (options.deep || options.security || options.performance) {
                        // Use Deep Analyzer export
                        exportResult = this.analyzer.exportToJSON(options.output);
                        
                        if (exportResult.success) {
                            console.log(chalk.green(`\n💾 Comprehensive report exported to: ${exportResult.filename}`));
                            console.log(chalk.gray(`   📊 File size: ${Math.round(exportResult.size / 1024 * 100) / 100} KB`));
                            console.log(chalk.gray(`   🔍 HTTP calls: ${exportResult.callCount}`));
                        } else {
                            console.error(chalk.red(`❌ Export failed: ${exportResult.error}`));
                        }
                    } else {
                        // Use traditional analyzer export
                        const filename = this.analyzer.exportReport(report, options.format, options.output);
                        console.log(chalk.green(`\n💾 Report exported to: ${filename}`));
                    }
                } catch (error) {
                    console.error(chalk.red(`❌ Error exporting report: ${error.message}`));
                }
            }

            console.log(chalk.green('\n✅ Analysis completed successfully'));

        } catch (error) {
            console.error(chalk.red(`❌ Error: ${error.message}`));
            if (this.parseArgs(args).verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    }

    showBanner() {
        console.log(chalk.blue.bold('\n🔍 HTTP Call Analyzer'));
        console.log(chalk.gray('   Detect HTTP calls and URLs in your codebase\n'));
    }

    showVersion() {
        try {
            const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
            console.log(`HTTP Call Analyzer v${packageJson.version}`);
        } catch {
            console.log('HTTP Call Analyzer v1.0.0');
        }
    }

    showHelp() {
        console.log(chalk.blue.bold('\n🔍 HTTP Call Analyzer'));
        console.log(chalk.gray('   Detect HTTP calls and URLs in your codebase\n'));

        console.log(chalk.yellow('Usage:'));
        console.log('  http-analyzer [directory] [options]\n');

        console.log(chalk.yellow('Options:'));
        console.log('  -h, --help          Show this help message');
        console.log('  -v, --version       Show version information');
        console.log('  -f, --format        Output format (json, csv, markdown)');
        console.log('  -o, --output        Output file path');
        console.log('  -e, --export        Export to specified file');
        console.log('  -j, --json          Export comprehensive JSON report (auto-enables deep analysis)');
        console.log('  -q, --quiet         Suppress output');
        console.log('  --verbose           Show verbose output');
        console.log('  --include           File extensions to include (e.g., js,ts)');
        console.log('  --exclude           Patterns to exclude');
        console.log('  -d, --deep          Enable deep analysis');
        console.log('  -s, --security      Include security analysis');
        console.log('  -p, --performance   Include performance analysis\n');

        console.log(chalk.yellow('Examples:'));
        console.log('  http-analyzer ./');
        console.log('  http-analyzer ./ --deep --security');
        console.log('  http-analyzer ./project -d -s -p --verbose');
        console.log('  http-analyzer ./app --json --export report.json');
        console.log('  http-analyzer ./codebase -j -e my-analysis.json');
    }

    printSecurityReport(securityReport) {
        const { securityIssues, httpsCoverage, recommendations } = securityReport;
        
        console.log(chalk.blue(`HTTPS Coverage: ${httpsCoverage}%`));
        
        if (securityIssues.length > 0) {
            console.log(chalk.red(`\nSecurity Issues Found: ${securityIssues.length}`));
            
            const grouped = this.groupBy(securityIssues, 'type');
            Object.entries(grouped).forEach(([type, issues]) => {
                console.log(chalk.red(`  ${type}: ${issues.length} issue(s)`));
                issues.slice(0, 3).forEach(issue => {
                    const severity = issue.severity === 'high' ? chalk.red('HIGH') :
                                   issue.severity === 'medium' ? chalk.yellow('MEDIUM') : 
                                   chalk.blue('LOW');
                    console.log(chalk.gray(`    • ${severity}: ${issue.message}`));
                });
            });
        } else {
            console.log(chalk.green('No security issues found'));
        }
        
        if (recommendations.length > 0) {
            console.log(chalk.blue('\nRecommendations:'));
            recommendations.forEach(rec => {
                const priority = rec.priority === 'high' ? chalk.red('HIGH') :
                               rec.priority === 'medium' ? chalk.yellow('MEDIUM') :
                               chalk.blue('LOW');
                console.log(chalk.gray(`  • ${priority}: ${rec.message}`));
            });
        }
    }

    printPerformanceReport(performanceReport) {
        const { totalCalls, performanceIssues, recommendations } = performanceReport;
        
        console.log(chalk.blue(`Total HTTP Calls: ${totalCalls}`));
        
        if (performanceIssues.length > 0) {
            console.log(chalk.yellow(`\nPerformance Issues Found: ${performanceIssues.length}`));
            
            performanceIssues.slice(0, 5).forEach((issue, index) => {
                console.log(chalk.gray(`  ${index + 1}. File: ${issue.location.file}, Line: ${issue.location.line}`));
                issue.suggestions.forEach(suggestion => {
                    console.log(chalk.gray(`     • ${suggestion.message}`));
                });
            });
        } else {
            console.log(chalk.green('No performance issues found'));
        }
        
        if (recommendations.length > 0) {
            console.log(chalk.blue('\nPerformance Recommendations:'));
            recommendations.forEach(rec => {
                const priority = rec.priority === 'high' ? chalk.red('HIGH') :
                               rec.priority === 'medium' ? chalk.yellow('MEDIUM') :
                               chalk.blue('LOW');
                console.log(chalk.gray(`  • ${priority}: ${rec.message}`));
            });
        }
    }

    groupBy(array, key) {
        return array.reduce((result, item) => {
            const group = item[key];
            if (!result[group]) {
                result[group] = [];
            }
            result[group].push(item);
            return result;
        }, {});
    }
}

export default CLI;