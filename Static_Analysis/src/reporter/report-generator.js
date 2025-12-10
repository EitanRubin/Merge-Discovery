import chalk from "chalk";
import fs from 'fs';

export class ReportGenerator {
    constructor() { }

    generateReport(astResults) {
        let results = astResults.results;

        for(let i = 0; i < results.length; i++) {
            console.log(results[i]);
        }

        const report = {
            summary: this.generateSummary(astResults),
            findings: results,
            groupedByFile: this.groupResultsByFile(results)
        };

        return report;
    }

    generateSummary(astResults) {
        const httpCalls = astResults.results;
        const httpMethods = {};
        httpCalls.filter(r => r.httpMethod).forEach(r => {
            httpMethods[r.httpMethod] = (httpMethods[r.httpMethod] || 0) + 1;
        });

        const findingsByType = {};
        httpCalls.forEach(r => {
            findingsByType[r.type] = (findingsByType[r.type] || 0) + 1;
        });

        return {
            totalFiles: new Set(httpCalls.map(r => r.location.file)).size,
            totalFindings: httpCalls.length,
            httpCalls: httpCalls.filter(r => r.type === 'http_call').length,
            urlLiterals: httpCalls.filter(r => r.type === 'url_literal').length,
            httpMethods: httpMethods,
            findingsByType: findingsByType
        };
    }

    groupResultsByFile(results) {
        const grouped = {};
        results.forEach(result => {
            const file = result.location.file;
            if (!grouped[file]) grouped[file] = [];
            grouped[file].push(result);
        });
        return grouped;
    }

    groupResultsByType(results) {
        const grouped = {};
        results.forEach(result => {
            const type = result.type;
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push(result);
        });
        return grouped;
    }

    printReport(report) {
        console.log(chalk.green('📊 ANALYSIS REPORT'));
        console.log('='.repeat(50));

        if (!report) {
            console.log('No analysis results available');
            return report;
        }

        this.printSummary(report.summary);

        return report;
    }

    printSummary(summary) {
        console.log(chalk.cyan('\n📈 Summary:'));
        
        if (!summary) {
            console.log('No analysis data available');
            return;
        }
        
        console.log(`Files analyzed: ${summary.totalFiles || 0}`);
        console.log(`Total findings: ${summary.totalFindings || 0}`);
        console.log(`HTTP calls: ${summary.httpCalls || 0}`);
        console.log(`URL literals: ${summary.urlLiterals || 0}`);
    }

    printFileGroups(groupedByFile) {
        console.log(chalk.cyan('\n📁 Findings by file:'));
        Object.entries(groupedByFile).forEach(([file, findings]) => {
            console.log(chalk.blue(`\n  ${file} (${findings.length} findings)`));
            findings.forEach(finding => {
                const line = finding.location.line;
                const type = finding.type;
                const detail = finding.url || finding.method || finding.callName;
                console.log(`    Line ${line}: ${type} - ${detail}`);
            });
        });
    }

    exportToJSON(report, filename = 'http-analysis-report.json') {
        fs.writeFileSync(filename, JSON.stringify(report, null, 2));
        return filename;
    }

    exportToCSV(report, filename = 'http-analysis-report.csv') {
        const headers = ['File', 'Line', 'Type', 'Method', 'HTTP_Method', 'URL', 'IsInternal'];
        const rows = [headers];

        report.findings.forEach(finding => {
            rows.push([
                finding.location.file,
                finding.location.line,
                finding.type,
                finding.method || finding.callName || '',
                finding.httpMethod || '',
                finding.url || '',
                finding.isInternal ? 'Yes' : 'No'
            ]);
        });

        const csvContent = rows.map(row =>
            row.map(field => `"${field}"`).join(',')
        ).join('\n');

        fs.writeFileSync(filename, csvContent);
        return filename;
    }

    generateMarkdownReport(report) {
        let markdown = '# HTTP Call Analysis Report\n\n';

        markdown += '## 📊 Summary\n\n';
        markdown += `- **Files analyzed:** ${report.summary.totalFiles}\n`;
        markdown += `- **Total findings:** ${report.summary.totalFindings}\n`;
        markdown += `- **HTTP calls:** ${report.summary.httpCalls}\n`;
        markdown += `- **URL literals:** ${report.summary.urlLiterals}\n`;

        markdown += '## 📁 Findings by file\n\n';
        Object.entries(groupedByFile).forEach(([file, findings]) => {
            markdown += `###${file}\n`;
            markdown += `*${findings.length} findings*\n\n`;

            findings.forEach(finding => {
                markdown += `- **Line ${finding.location.line}:** ${finding.type}\n`;
                markdown += `  - Details: ${finding.url || finding.method || finding.callName}\n`;
            });
            markdown += '\n';
        });

        return markdown;
    }

    exportToMarkdown(report, filename = 'http-analysis-report.md') {
        const markdownContent = this.generateMarkdownReport(report);
        fs.writeFileSync(filename, markdownContent);
        return filename;
    }
}