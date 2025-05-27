#!/usr/bin/env node

// Debug script to test pa11y results and understand issue structure
const pa11y = require('pa11y');
const chalk = require('chalk');

async function debugPa11y(url) {
  console.log(chalk.blue(`\n🔍 Debugging pa11y results for: ${url}\n`));

  try {
    // Test with different configurations
    const configs = [
      {
        name: 'Default Config',
        options: {
          standard: 'WCAG2AA',
          includeNotices: true,
          includeWarnings: true
        }
      },
      {
        name: 'Minimal Config',
        options: {
          standard: 'WCAG2AA'
        }
      },
      {
        name: 'With Runner Info',
        options: {
          standard: 'WCAG2AA',
          includeNotices: true,
          includeWarnings: true,
          runners: ['axe', 'htmlcs']
        }
      }
    ];

    for (const config of configs) {
      console.log(chalk.yellow(`\n--- Testing with ${config.name} ---`));

      try {
        const results = await pa11y(url, config.options);

        console.log('✅ Results received');
        console.log(`📊 Total issues: ${results.issues?.length || 0}`);

        if (results.issues && results.issues.length > 0) {
          // Analyze the structure of issues
          console.log('\n📋 Issue Structure Analysis:');

          const firstIssue = results.issues[0];
          console.log('First issue keys:', Object.keys(firstIssue));
          console.log('First issue:', JSON.stringify(firstIssue, null, 2));

          // Count by type
          const typeCounts = {};
          const runnerCounts = {};
          const codeCounts = {};

          results.issues.forEach((issue) => {
            // Type analysis
            const type = issue.type || issue.typeCode || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;

            // Runner analysis
            const runner = issue.runner || 'unknown';
            runnerCounts[runner] = (runnerCounts[runner] || 0) + 1;

            // Code pattern analysis
            if (issue.code) {
              const codeType = issue.code.split('.')[0] || 'unknown';
              codeCounts[codeType] = (codeCounts[codeType] || 0) + 1;
            }
          });

          console.log('\n📈 Issue Type Distribution:');
          Object.entries(typeCounts).forEach(([type, count]) => {
            console.log(`  ${type}: ${count}`);
          });

          console.log('\n🏃 Runner Distribution:');
          Object.entries(runnerCounts).forEach(([runner, count]) => {
            console.log(`  ${runner}: ${count}`);
          });

          console.log('\n🔢 Code Pattern Distribution:');
          Object.entries(codeCounts).forEach(([code, count]) => {
            console.log(`  ${code}: ${count}`);
          });

          // Sample of different issue types
          const sampleIssues = {
            errors: results.issues.filter(
              (i) => i.type === 'error' || i.type === 1
            ),
            warnings: results.issues.filter(
              (i) => i.type === 'warning' || i.type === 2
            ),
            notices: results.issues.filter(
              (i) => i.type === 'notice' || i.type === 3
            )
          };

          console.log('\n🔍 Sample Issues by Type:');
          Object.entries(sampleIssues).forEach(([type, issues]) => {
            if (issues.length > 0) {
              console.log(`\n${type.toUpperCase()} (${issues.length} total):`);
              console.log(JSON.stringify(issues[0], null, 2));
            }
          });
        } else {
          console.log('✅ No issues found');
        }
      } catch (error) {
        console.error(`❌ Error with ${config.name}:`, error.message);
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Fatal error:'), error.message);
    console.error(error.stack);
  }
}

// Usage
if (require.main === module) {
  const url = process.argv[2] || 'https://example.com';
  debugPa11y(url);
}
