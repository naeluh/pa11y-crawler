#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { program } = require('commander');
const puppeteer = require('puppeteer');
const pa11y = require('pa11y');
const chalk = require('chalk');
const ora = require('ora');
const { URL } = require('url');

// CLI configuration
program
  .version('1.0.0')
  .description('Crawl a website and generate accessibility reports using pa11y')
  .argument('<url>', 'URL to crawl (e.g., https://example.com)')
  .option('-d, --depth <number>', 'Maximum crawl depth', '3')
  .option(
    '-o, --output <directory>',
    'Output directory for reports',
    'accessibility-reports'
  )
  .option(
    '-c, --concurrency <number>',
    'Maximum concurrent pages to analyze',
    '3'
  )
  .option(
    '-p, --project-key <string>',
    'Project key for reports',
    'ACCESSIBILITY'
  )
  .option(
    '-t, --timeout <number>',
    'Page navigation timeout in milliseconds',
    '30000'
  )
  .option('--summary <text>', 'Custom summary for the report')
  .option('--exclude <patterns>', 'Comma-separated URL patterns to exclude')
  .option(
    '--standard <standard>',
    'Accessibility standard to test against',
    'WCAG2AA'
  )
  .option('--include-notices', 'Include notices in the report')
  .option('--include-warnings', 'Include warnings in the report')
  .parse(process.argv);

const options = program.opts();
const startUrl = program.args[0];

// Validate URL input
if (!startUrl) {
  console.error(chalk.red('Error: URL is required'));
  process.exit(1);
}

try {
  new URL(startUrl);
} catch (error) {
  console.error(chalk.red(`Error: Invalid URL - ${startUrl}`));
  process.exit(1);
}

// Set up configuration
const config = {
  url: startUrl,
  origin: new URL(startUrl).origin,
  depth: parseInt(options.depth, 10),
  outputDir: options.output,
  concurrency: parseInt(options.concurrency, 10),
  projectKey: options.projectKey,
  timeout: parseInt(options.timeout, 10),
  customSummary: options.summary || null,
  excludePatterns: options.exclude ? options.exclude.split(',') : [],
  standard: options.standard,
  includeNotices: options.includeNotices || false,
  includeWarnings: options.includeWarnings || false
};

// Initialize variables
const visitedUrls = new Set();
const pageQueue = [];
const reportData = [];
let browser;
let spinner;

// Create output directory if it doesn't exist
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Create combined report directory
const combinedReportDir = path.join(config.outputDir, 'combined');
if (!fs.existsSync(combinedReportDir)) {
  fs.mkdirSync(combinedReportDir, { recursive: true });
}

// Function to check if URL should be excluded
function shouldExcludeUrl(url) {
  if (!url.startsWith(config.origin)) return true;

  // Exclude common non-HTML resources
  const excludedExtensions = [
    '.css',
    '.js',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.ico',
    '.pdf',
    '.zip',
    '.mp4',
    '.webp',
    '.json'
  ];
  if (excludedExtensions.some((ext) => url.toLowerCase().endsWith(ext)))
    return true;

  // Exclude URLs with fragments (anchors)
  if (url.includes('#')) return true;

  // Check user-defined exclusion patterns
  return config.excludePatterns.some((pattern) => url.includes(pattern));
}

// Function to normalize URL
function normalizeUrl(url, baseUrl) {
  try {
    // Handle relative URLs
    const normalizedUrl = new URL(url, baseUrl).href;
    // Remove trailing slash for consistency
    return normalizedUrl.endsWith('/')
      ? normalizedUrl.slice(0, -1)
      : normalizedUrl;
  } catch (error) {
    return null;
  }
}

// Function to extract links from a page
async function extractLinks(page, baseUrl) {
  return await page.evaluate((origin) => {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.href)
      .filter((href) => href && href.startsWith(origin));
    return [...new Set(links)]; // Remove duplicates
  }, config.origin);
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// FIXED: Function to properly categorize pa11y issues
function categorizeIssues(results) {
  if (!results || !results.issues || !Array.isArray(results.issues)) {
    return { errors: [], warnings: [], notices: [] };
  }

  const errors = results.issues.filter(
    (issue) => issue.type === 'error' || issue.typeCode === 1
  );

  const warnings = results.issues.filter(
    (issue) => issue.type === 'warning' || issue.typeCode === 2
  );

  const notices = results.issues.filter(
    (issue) => issue.type === 'notice' || issue.typeCode === 3
  );

  return { errors, warnings, notices };
}

// FIXED: Function to generate HTML report from pa11y results
function generateHtmlReport(results, url, outputPath) {
  // Use the proper categorization
  const { errors, warnings, notices } = categorizeIssues(results);

  console.log(
    `Report for ${url}: ${errors.length} errors, ${warnings.length} warnings, ${notices.length} notices`
  );

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Report - ${escapeHtml(url)}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 30px; }
        .summary-item { display: inline-block; margin-right: 30px; text-align: center; }
        .summary-number { font-size: 2em; font-weight: bold; display: block; }
        .error .summary-number { color: #e74c3c; }
        .warning .summary-number { color: #f39c12; }
        .notice .summary-number { color: #3498db; }
        .issue { border-left: 4px solid #ddd; padding: 15px; margin-bottom: 15px; background: #fff; }
        .issue.error { border-left-color: #e74c3c; background: #fdf2f2; }
        .issue.warning { border-left-color: #f39c12; background: #fefbf3; }
        .issue.notice { border-left-color: #3498db; background: #f3f8ff; }
        .issue-type { font-weight: bold; text-transform: uppercase; font-size: 0.8em; margin-bottom: 5px; }
        .issue-message { font-weight: bold; margin-bottom: 10px; }
        .issue-code { background: #f4f4f4; padding: 8px; border-radius: 3px; font-family: monospace; font-size: 0.9em; margin: 10px 0; }
        .issue-selector { color: #666; font-family: monospace; }
        .issue-context { color: #888; font-style: italic; margin-top: 5px; font-size: 0.9em; }
        .meta { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .no-issues { text-align: center; padding: 40px; color: #27ae60; font-size: 1.2em; }
        .back-link { display: inline-block; margin-bottom: 20px; color: #3498db; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
        .toggle-section { margin: 10px 0; }
        .toggle-button {
            background: #3498db;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
        }
        .toggle-button:hover { background: #2980b9; }
        .section-content { margin-top: 15px; }
        .section-content.hidden { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <a href="../../combined/index.html" class="back-link">← View Combined Report</a>
        <h1>Accessibility Report</h1>

        <div class="meta">
            <strong>URL:</strong> ${escapeHtml(url)}<br>
            <strong>Date:</strong> ${new Date().toLocaleString()}<br>
            <strong>Standard:</strong> ${config.standard}<br>
            <strong>Project:</strong> ${config.projectKey}
            ${
              config.customSummary
                ? `<br><strong>Summary:</strong> ${escapeHtml(
                    config.customSummary
                  )}`
                : ''
            }
        </div>

        <div class="summary">
            <div class="summary-item error">
                <span class="summary-number">${errors.length}</span>
                <span>Errors</span>
            </div>
            <div class="summary-item warning">
                <span class="summary-number">${warnings.length}</span>
                <span>Warnings</span>
            </div>
            <div class="summary-item notice">
                <span class="summary-number">${notices.length}</span>
                <span>Notices</span>
            </div>
        </div>

        ${
          results.issues.length === 0
            ? '<div class="no-issues">🎉 No accessibility issues found!</div>'
            : ''
        }

        ${
          errors.length > 0
            ? `
        <h2>Errors (${errors.length})</h2>
        <div class="section-content">
        ${errors
          .map(
            (issue) => `
        <div class="issue error">
            <div class="issue-type">Error</div>
            <div class="issue-message">${escapeHtml(issue.message)}</div>
            <div class="issue-code">${escapeHtml(issue.code)}</div>
            <div class="issue-selector">Selector: ${escapeHtml(
              issue.selector
            )}</div>
            ${
              issue.context
                ? `<div class="issue-context">Context: ${escapeHtml(
                    issue.context.substring(0, 200)
                  )}${issue.context.length > 200 ? '...' : ''}</div>`
                : ''
            }
        </div>
        `
          )
          .join('')}
        </div>
        `
            : ''
        }

        ${
          warnings.length > 0
            ? `
        <div class="toggle-section">
            <button class="toggle-button" onclick="toggleSection('warnings')">
                ${config.includeWarnings ? 'Hide' : 'Show'} Warnings (${
                warnings.length
              })
            </button>
        </div>
        <div id="warnings" class="section-content ${
          config.includeWarnings ? '' : 'hidden'
        }">
        <h2>Warnings (${warnings.length})</h2>
        ${warnings
          .map(
            (issue) => `
        <div class="issue warning">
            <div class="issue-type">Warning</div>
            <div class="issue-message">${escapeHtml(issue.message)}</div>
            <div class="issue-code">${escapeHtml(issue.code)}</div>
            <div class="issue-selector">Selector: ${escapeHtml(
              issue.selector
            )}</div>
            ${
              issue.context
                ? `<div class="issue-context">Context: ${escapeHtml(
                    issue.context.substring(0, 200)
                  )}${issue.context.length > 200 ? '...' : ''}</div>`
                : ''
            }
        </div>
        `
          )
          .join('')}
        </div>
        `
            : ''
        }

        ${
          notices.length > 0
            ? `
        <div class="toggle-section">
            <button class="toggle-button" onclick="toggleSection('notices')">
                ${config.includeNotices ? 'Hide' : 'Show'} Notices (${
                notices.length
              })
            </button>
        </div>
        <div id="notices" class="section-content ${
          config.includeNotices ? '' : 'hidden'
        }">
        <h2>Notices (${notices.length})</h2>
        ${notices
          .map(
            (issue) => `
        <div class="issue notice">
            <div class="issue-type">Notice</div>
            <div class="issue-message">${escapeHtml(issue.message)}</div>
            <div class="issue-code">${escapeHtml(issue.code)}</div>
            <div class="issue-selector">Selector: ${escapeHtml(
              issue.selector
            )}</div>
            ${
              issue.context
                ? `<div class="issue-context">Context: ${escapeHtml(
                    issue.context.substring(0, 200)
                  )}${issue.context.length > 200 ? '...' : ''}</div>`
                : ''
            }
        </div>
        `
          )
          .join('')}
        </div>
        `
            : ''
        }
    </div>

    <script>
        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const button = event.target;

            if (section.classList.contains('hidden')) {
                section.classList.remove('hidden');
                button.textContent = button.textContent.replace('Show', 'Hide');
            } else {
                section.classList.add('hidden');
                button.textContent = button.textContent.replace('Hide', 'Show');
            }
        }
    </script>
</body>
</html>
  `;

  fs.writeFileSync(outputPath, html);
}

// Function to run accessibility test on a page
async function runAccessibilityTest(url) {
  try {
    // Configure pa11y options
    const pa11yOptions = {
      standard: config.standard,
      timeout: config.timeout,
      wait: 1000, // Wait 1 second after page load
      chromeLaunchConfig: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      },
      includeNotices: config.includeNotices,
      includeWarnings: config.includeWarnings
    };

    // Run pa11y test
    const results = await pa11y(url, pa11yOptions);

    // Create directory for individual reports
    const urlObj = new URL(url);
    const pathname = urlObj.pathname === '/' ? '/home' : urlObj.pathname;
    const pageDir = path.join(
      config.outputDir,
      'pages',
      pathname.replace(/\//g, '_').replace(/^_/, '')
    );

    if (!fs.existsSync(pageDir)) {
      fs.mkdirSync(pageDir, { recursive: true });
    }

    // Generate HTML report
    const reportPath = path.join(pageDir, 'report.html');
    generateHtmlReport(results, url, reportPath);

    // Get proper counts for logging
    const { errors, warnings, notices } = categorizeIssues(results);
    console.log(
      chalk.green(
        `✓ Analyzed: ${url} (${errors.length} errors, ${warnings.length} warnings, ${notices.length} notices)`
      )
    );

    return { url, results };
  } catch (error) {
    console.error(chalk.red(`Error analyzing ${url}: ${error.message}`));
    return null;
  }
}

// Function to crawl the website
async function crawlWebsite() {
  try {
    // Launch browser for link extraction
    spinner = ora('Launching browser...').start();
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    spinner.succeed('Browser launched');
    spinner = ora(`Starting crawl from ${config.url}`).start();

    // Add the start URL to the queue
    pageQueue.push({ url: config.url, depth: 0 });
    visitedUrls.add(config.url);

    // Process queue
    while (pageQueue.length > 0) {
      // Process up to concurrency pages in parallel
      const batch = pageQueue.splice(0, config.concurrency);
      spinner.text = `Crawling ${batch.length} pages... (${visitedUrls.size} total found)`;

      const results = await Promise.all(
        batch.map(async ({ url, depth }) => {
          // Skip if we've reached max depth
          if (depth >= config.depth) return null;

          // Run accessibility test first
          const accessibilityResult = await runAccessibilityTest(url);
          if (accessibilityResult) {
            reportData.push(accessibilityResult);
          }

          // Extract links if we're not at max depth
          if (depth < config.depth - 1) {
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 800 });

            try {
              // Navigate to URL with timeout
              await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: config.timeout
              });

              const links = await extractLinks(page, url);

              // Add new links to the queue
              for (const link of links) {
                const normalizedLink = normalizeUrl(link, url);
                if (
                  normalizedLink &&
                  !visitedUrls.has(normalizedLink) &&
                  !shouldExcludeUrl(normalizedLink)
                ) {
                  visitedUrls.add(normalizedLink);
                  pageQueue.push({ url: normalizedLink, depth: depth + 1 });
                }
              }
            } catch (error) {
              console.error(
                chalk.yellow(
                  `Warning: Could not extract links from ${url}: ${error.message}`
                )
              );
            } finally {
              await page.close();
            }
          }

          return accessibilityResult;
        })
      );

      // Update progress
      spinner.text = `Crawled ${visitedUrls.size} pages, ${pageQueue.length} remaining...`;
    }

    spinner.succeed(`Crawling complete! Analyzed ${reportData.length} pages.`);

    // Create combined report
    if (reportData.length > 0) {
      spinner = ora('Generating combined report...').start();

      // Combine all issues with proper categorization
      const summaryData = {
        totalPages: reportData.length,
        totalIssues: 0,
        totalErrors: 0,
        totalWarnings: 0,
        totalNotices: 0,
        pageDetails: []
      };

      reportData.forEach((data) => {
        if (!data || !data.results) return;

        // Use the same categorization function
        const { errors, warnings, notices } = categorizeIssues(data.results);

        summaryData.totalIssues += data.results.issues.length;
        summaryData.totalErrors += errors.length;
        summaryData.totalWarnings += warnings.length;
        summaryData.totalNotices += notices.length;

        summaryData.pageDetails.push({
          url: data.url,
          issues: data.results.issues.length,
          errors: errors.length,
          warnings: warnings.length,
          notices: notices.length
        });
      });

      // Create index of all analyzed pages
      const pagesListHtml = summaryData.pageDetails
        .map((page) => {
          const urlObj = new URL(page.url);
          const pathname = urlObj.pathname === '/' ? '/home' : urlObj.pathname;
          const reportPath = `../pages/${pathname
            .replace(/\//g, '_')
            .replace(/^_/, '')}/report.html`;
          const statusColor =
            page.errors > 0
              ? '#e74c3c'
              : page.warnings > 0
              ? '#f39c12'
              : '#27ae60';
          return `
            <tr>
              <td><a href="${reportPath}">${escapeHtml(page.url)}</a></td>
              <td style="color: ${statusColor}; font-weight: bold;">${
            page.issues
          }</td>
              <td style="color: #e74c3c;">${page.errors}</td>
              <td style="color: #f39c12;">${page.warnings}</td>
              <td style="color: #3498db;">${page.notices}</td>
            </tr>
          `;
        })
        .join('');

      // Generate combined summary report
      const combinedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Site Accessibility Report - ${escapeHtml(config.origin)}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; color: #333; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; }
        .summary { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 30px; }
        .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
        .summary-item { text-align: center; padding: 20px; background: white; border-radius: 5px; }
        .summary-number { font-size: 2.5em; font-weight: bold; display: block; margin-bottom: 5px; }
        .pages .summary-number { color: #3498db; }
        .total .summary-number { color: #34495e; }
        .errors .summary-number { color: #e74c3c; }
        .warnings .summary-number { color: #f39c12; }
        .notices .summary-number { color: #3498db; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        tr:hover { background: #f8f9fa; }
        .meta { background: #f8f9fa; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Site Accessibility Report</h1>

        <div class="meta">
            <strong>Origin:</strong> ${escapeHtml(config.origin)}<br>
            <strong>Date:</strong> ${new Date().toLocaleString()}<br>
            <strong>Standard:</strong> ${config.standard}<br>
            <strong>Project:</strong> ${config.projectKey}
            ${
              config.customSummary
                ? `<br><strong>Summary:</strong> ${escapeHtml(
                    config.customSummary
                  )}`
                : ''
            }
            <br><a href="../index.html" style="color: #3498db; text-decoration: none;">← Back to Main Index</a>
        </div>

        <div class="summary">
            <div class="summary-grid">
                <div class="summary-item pages">
                    <span class="summary-number">${
                      summaryData.totalPages
                    }</span>
                    <span>Pages Analyzed</span>
                </div>
                <div class="summary-item total">
                    <span class="summary-number">${
                      summaryData.totalIssues
                    }</span>
                    <span>Total Issues</span>
                </div>
                <div class="summary-item errors">
                    <span class="summary-number">${
                      summaryData.totalErrors
                    }</span>
                    <span>Errors</span>
                </div>
                <div class="summary-item warnings">
                    <span class="summary-number">${
                      summaryData.totalWarnings
                    }</span>
                    <span>Warnings</span>
                </div>
                <div class="summary-item notices">
                    <span class="summary-number">${
                      summaryData.totalNotices
                    }</span>
                    <span>Notices</span>
                </div>
            </div>
        </div>

        <h2>Page Details</h2>
        <table>
            <thead>
                <tr>
                    <th>Page URL</th>
                    <th>Total Issues</th>
                    <th>Errors</th>
                    <th>Warnings</th>
                    <th>Notices</th>
                </tr>
            </thead>
            <tbody>
                ${pagesListHtml}
            </tbody>
        </table>
    </div>
</body>
</html>
      `;

      // Save combined report
      fs.writeFileSync(
        path.join(combinedReportDir, 'index.html'),
        combinedHtml
      );

      // Create main index file
      const mainIndexPath = path.join(config.outputDir, 'index.html');
      fs.writeFileSync(
        mainIndexPath,
        `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Site Accessibility Report - ${escapeHtml(
            config.origin
          )}</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; color: #333; }
            h1 { color: #2c3e50; }
            .container { max-width: 1000px; margin: 0 auto; }
            .card { border: 1px solid #ddd; border-radius: 4px; padding: 20px; margin-bottom: 20px; }
            .btn { display: inline-block; background: #3498db; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; }
            .btn:hover { background: #2980b9; }
            .summary { margin-bottom: 30px; }
            .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
            .stat { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 5px; }
            .stat-number { font-size: 1.5em; font-weight: bold; display: block; }
            .errors { color: #e74c3c; }
            .warnings { color: #f39c12; }
            .notices { color: #3498db; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Site Accessibility Report</h1>
            <div class="card summary">
              <h2>Summary</h2>
              <p><strong>Origin:</strong> ${escapeHtml(config.origin)}</p>
              <p><strong>Pages analyzed:</strong> ${summaryData.totalPages}</p>
              <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
              <div class="stats">
                <div class="stat">
                  <span class="stat-number">${summaryData.totalIssues}</span>
                  <span>Total Issues</span>
                </div>
                <div class="stat errors">
                  <span class="stat-number">${summaryData.totalErrors}</span>
                  <span>Errors</span>
                </div>
                <div class="stat warnings">
                  <span class="stat-number">${summaryData.totalWarnings}</span>
                  <span>Warnings</span>
                </div>
                <div class="stat notices">
                  <span class="stat-number">${summaryData.totalNotices}</span>
                  <span>Notices</span>
                </div>
              </div>
              <p><a href="combined/index.html" class="btn">View Detailed Report</a></p>
            </div>
          </div>
        </body>
        </html>
      `
      );

      spinner.succeed(
        `Combined report generated at ${path.join(
          config.outputDir,
          'index.html'
        )}`
      );
      console.log(
        chalk.green(
          `\nOpen the report: ${path.resolve(config.outputDir, 'index.html')}`
        )
      );

      // Print summary statistics
      console.log(chalk.cyan('\n📊 Summary Statistics:'));
      console.log(chalk.cyan(`Pages analyzed: ${summaryData.totalPages}`));
      console.log(chalk.red(`Total errors: ${summaryData.totalErrors}`));
      console.log(chalk.yellow(`Total warnings: ${summaryData.totalWarnings}`));
      console.log(chalk.blue(`Total notices: ${summaryData.totalNotices}`));
    } else {
      spinner.fail('No pages were successfully analyzed.');
    }
  } catch (error) {
    if (spinner) spinner.fail(`Crawl failed: ${error.message}`);
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

// Main function
async function main() {
  console.log(
    chalk.blue(`
  ╔════════════════════════════════════════════════╗
  ║          Site Accessibility Crawler           ║
  ║                 (using pa11y)                  ║
  ╚════════════════════════════════════════════════╝
  `)
  );
  console.log(chalk.cyan(`Starting crawl of ${config.url}`));
  console.log(chalk.cyan(`Standard: ${config.standard}`));
  console.log(chalk.cyan(`Max depth: ${config.depth}`));
  console.log(chalk.cyan(`Output directory: ${config.outputDir}`));
  console.log(chalk.cyan(`Include warnings: ${config.includeWarnings}`));
  console.log(chalk.cyan(`Include notices: ${config.includeNotices}`));

  await crawlWebsite();
}

main().catch((error) => {
  console.error(chalk.red(`Fatal error: ${error.message}`));
  process.exit(1);
});

// Export functions for testing
module.exports = {
  categorizeIssues,
  escapeHtml,
  shouldExcludeUrl,
  normalizeUrl
};
