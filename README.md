# Crawlyx

A free, open-source website crawler and technical SEO auditor. Runs locally in your browser — no accounts, no rate limits, no license fees.

## What it does

Crawlyx crawls websites and gives you detailed information about pages, links, SEO elements, and performance — a self-hosted alternative to Screaming Frog, Sitebulb, and similar tools.

## Features

- 🚀 **Fast concurrent crawling** with pause/resume and crash recovery
- 🔄 **JavaScript rendering** for dynamic content (React, Vue, Angular, etc.) via Playwright
- 📊 **SEO extraction** — titles, meta, headings, canonicals, OpenGraph, Twitter Cards, JSON-LD, hreflang
- 🔍 **Issue detection** — 30+ automated SEO, content, technical, and performance checks
- 🔗 **Internal link intelligence** — authority scores, orphan pages, broken/redirected links
- 🧠 **Analysis engine** — site health score, content clusters, TF-IDF duplicate detection
- 🌳 **Interactive visualizations** — crawl tree and authority flow graphs
- 💾 **Crawl history** — save, load, resume, and manage crawls in local SQLite
- 📤 **Exports** — CSV, XLSX, JSON, XML, plus a standalone HTML audit report

## Getting started

### Quick start

**Windows:**
```batch
start-crawlyx.bat
```

**Linux/Mac:**
```bash
chmod +x start-crawlyx.sh
./start-crawlyx.sh
```

Installs dependencies, starts the server, and opens `http://localhost:5000`.

### Docker

```bash
cp .env.example .env
docker compose up -d
# Open http://localhost:5000
```

### Manual

Requirements: Python 3.8+, a modern browser.

```bash
pip install -r requirements.txt
playwright install chromium   # optional, for JavaScript rendering
python main.py
```

Then open `http://localhost:5000`.

## Configuration

Click "Settings" to configure:

- **Crawler settings**: depth (up to 5M URLs), delays, external links
- **Request settings**: user agent, timeouts, proxy, robots.txt
- **JavaScript rendering**: browser engine, wait times, viewport size
- **Filters**: file types and URL patterns to include/exclude
- **Export options**: formats and fields to export
- **Custom CSS**: personalize the UI appearance with custom styles
- **Issue exclusion**: patterns to exclude from SEO issue detection

## Documentation

See [CAPABILITIES.md](CAPABILITIES.md) for a complete description of what Crawlyx does today, including known limitations.

## Known limitations

- Large sites may take time to crawl completely
- JavaScript rendering is slower than HTTP-only crawling
- Settings stored in localStorage (cleared if browser data is cleared)

## Files

- `main.py` - Main application and Flask server
- `src/crawler.py` - Core crawling engine
- `src/analysis/` - Post-crawl analysis engine
- `src/settings_manager.py` - Configuration management
- `web/` - Frontend interface files

## License

MIT License — see [LICENSE](LICENSE) for details.
