# pa11y-crawler

A Node.js CLI tool that crawls a website, finds all pages within the same origin, and generates accessibility reports using pa11y.

## Features

- Crawls websites to find all pages within the same origin
- Respects maximum crawl depth
- Runs pa11y-crawler accessibility tests on each page
- Generates individual HTML reports for each page

## Installation

### Local Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Make the script executable:

```bash
chmod +x index.js
```

### Global Installation

To use the tool from anywhere on your system:

```bash
npm install -g .
```

## Usage

### Basic Usage

```bash
node index.js https://example.com
```

Or if installed globally:

```bash
pa11y-crawler https://example.com
```

### Options

```
Options:
  -V, --version                 output the version number
  -d, --depth <number>          Maximum crawl depth (default: "3")
  -o, --output <directory>      Output directory for reports (default: "accessibility-reports")
  -c, --concurrency <number>    Maximum concurrent pages to analyze (default: "3")
  -p, --project-key <string>    Project key for reports (default: "ACCESSIBILITY")
  -t, --timeout <number>        Page navigation timeout in milliseconds (default: "30000")
  --summary <text>              Custom summary for the report
  --exclude <patterns>          Comma-separated URL patterns to exclude
  -h, --help                    display help for command
```

### Examples

Crawl with a maximum depth of 2 and custom output directory:

```bash
node index.js https://example.com -d 2 -o reports
```

Exclude specific URL patterns:

```bash
node index.js https://example.com --exclude login,admin,cart
```

Add a custom summary to the report:

```bash
node index.js https://example.com --summary "Accessibility audit conducted on April 25, 2025"
```

Increase concurrency for faster crawling (be careful with server load):

```bash
node index.js https://example.com -c 5
```

## Dependencies

- pa11y - Accessibility testing engine
- puppeteer - Headless browser automation
- commander - Command-line interface
- chalk - Terminal styling
- ora - Terminal spinners
