# Crawlyx — Current Capabilities

Crawlyx is a web-based site crawler and SEO auditor. This document describes what the product **does today**, based on the shipped codebase.

---

## Overview

| Area | Summary |
|------|---------|
| **Product type** | Local web app (Flask + browser UI) |
| **Crawl engine** | Concurrent HTTP crawler with optional JavaScript rendering (Playwright) |
| **Primary use** | Technical SEO audits, link analysis, issue detection, export |
| **Run locally** | `PORT=5050 .venv/bin/python main.py` → `http://localhost:5050` |

---

## Crawling

### Discovery & scope

- Start from a seed URL and crawl internal links recursively
- Configurable **max depth** and **max URLs** (up to 5M in settings)
- Optional **crawl of external links** (off by default)
- **Sitemap discovery** — finds `sitemap.xml`, nested sitemaps, and sitemap URLs declared in `robots.txt`; adds discovered URLs to the crawl queue
- **URL normalization** — deduplicates variants (trailing slashes, query order, www, index files) for analysis
- Tracks **parameterized URLs** and **duplicate URL variants** in crawl diagnostics

### Request configuration

- Custom **User-Agent**
- **Timeouts** and **retry** attempts
- **Crawl delay** between requests
- **Follow redirects** (on/off)
- **Accept-Language** header
- **Custom HTTP headers** (admin settings)
- **Proxy** support (admin settings)
- **Respect robots.txt** — disallowed URLs are skipped; blocked count shown in crawl health
- **Allow cookies** toggle
- **Concurrent requests** (configurable)

### Content filters

- Include / exclude by **file extension**
- Include / exclude by **URL pattern** (wildcards)
- **Maximum file size** limit (skip oversized responses)
- Default exclusions for common non-HTML assets (PDF, ZIP, etc.)

### JavaScript rendering

- Optional **Playwright** rendering for SPAs and dynamic pages (React, Vue, Angular, etc.)
- Browser engines: **Chromium**, **Firefox**, **WebKit**
- Headless or headed mode
- Configurable **wait time**, **page load timeout**, **viewport**, **JS User-Agent**
- **Max concurrent browser pages**

### Crawl control

- Start, **stop**, **pause**, and **resume** crawls
- Real-time progress bar and live statistics
- Per-browser-session isolated crawler instances

---

## Data extracted per URL

For each crawled page, Crawlyx collects:

| Field | Details |
|-------|---------|
| **URL & status** | Final URL, HTTP status, response time, content type, page size |
| **Title** | `<title>` text |
| **Meta description** | `meta name="description"` |
| **Headings** | H1 (single), H2 and H3 (up to 10 each) |
| **Word count** | Visible text word count |
| **Canonical** | `<link rel="canonical">` href |
| **Robots meta** | `meta name="robots"` content |
| **Language & charset** | `html lang`, charset meta |
| **Viewport** | Mobile viewport meta |
| **OpenGraph** | All `og:*` tags |
| **Twitter Cards** | All `twitter:*` tags |
| **JSON-LD** | Parsed `application/ld+json` blocks |
| **Schema.org microdata** | `itemtype` / `itemprop` structures |
| **hreflang** | `link rel="alternate" hreflang` entries |
| **Images** | `src`, `alt`, width, height |
| **Link counts** | Internal vs external link counts on the page |
| **Analytics detection** | GA, GA4, GTM, Facebook Pixel, Hotjar, Mixpanel (pattern match in HTML) |
| **Linked from** | Source pages that link to this URL |
| **Crawl depth** | Hops from seed URL |
| **Errors** | DNS failure, timeout, SSL error, connection refused, etc. (when no HTTP response) |

---

## Links

### Collection

- All `<a href>` links with **source URL**, **target URL**, **anchor text**, internal/external flag, and **target status** (if crawled)
- **Link placement** classification: `body`, `navigation`, `footer`, or `image`
- Image `src` links collected for broken-image detection
- Search and filter in the **Links** tab (internal / external)

### Internal link intelligence (Audit tab)

- **Inlinks / outlinks** per page, broken down by placement
- **Authority score** (0–100) — weighted PageRank-style internal link equity; body links weighted highest, nav/footer discounted, sitewide body links discounted
- **Orphan pages** — crawled but with zero internal inlinks
- **Near-orphan pages** — at most one internal inlink
- **Overlinked pages** — excessive outlinks
- **Underlinked pages** — deep pages with very few inlinks
- **Broken internal links** report
- **Redirected internal links** report (target returns 3xx)

---

## Issue detection

Automated checks run during and after the crawl. Issues are grouped by type in the **Issues** tab and prioritized in the **Audit** tab with severity, affected URL counts, example URLs, template-level detection, and recommended fixes.

### SEO

| Issue | Type |
|-------|------|
| Missing title tag | Error |
| Title too long (>60 chars) | Warning |
| Title too short (<30 chars) | Warning |
| Missing meta description | Error |
| Meta description too long (>160 chars) | Warning |
| Meta description too short (<120 chars) | Warning |
| Missing H1 tag | Error |

### Content

| Issue | Type |
|-------|------|
| Thin content (<300 words) | Warning |
| Broken image (no response) | Error |
| Broken image (4xx/5xx) | Error |
| Duplicate content (metadata similarity) | Warning |

### Technical

| Issue | Type |
|-------|------|
| No HTTP response (DNS, timeout, SSL, connection) | Error |
| 4xx client errors | Error |
| 5xx server errors | Error |
| 3xx redirects | Info |
| Missing canonical URL | Warning |
| Canonical points to different URL | Warning |

### Indexability

| Issue | Type |
|-------|------|
| `noindex` in meta robots | Error |
| `nofollow` in meta robots | Error |

### Mobile

| Issue | Type |
|-------|------|
| Missing viewport meta tag | Error |

### Accessibility (basic)

| Issue | Type |
|-------|------|
| Missing `lang` on `<html>` | Warning |
| Images without alt text | Warning |

### Social

| Issue | Type |
|-------|------|
| Missing OpenGraph tags | Warning |
| Missing Twitter Card tags | Warning |

### Structured data

| Issue | Type |
|-------|------|
| No JSON-LD or Schema.org markup | Error |

### Performance

| Issue | Type |
|-------|------|
| Slow response time (>3s) | Error |
| Moderate response time (>1s) | Warning |
| Large page size (>3MB) | Error |
| Moderate page size (>1MB) | Warning |

### Redirects (post-crawl)

| Issue | Type |
|-------|------|
| Redirect chain (>1 hop, full hop path shown) | Warning |
| Redirect loop (revisited URL or too many redirects) | Error |
| Redirect ending in a 4xx/5xx page | Error |

### Sitemap reconciliation (post-crawl)

| Issue | Type |
|-------|------|
| In sitemap, not crawled (blocked, filtered, or unreachable) | Warning |
| Sitemap URL returned non-200 | Error |
| Crawled, not in sitemap (internal 200 HTML pages) | Info |

Only runs when an XML sitemap was discovered.

### Duplication (post-crawl)

- **Duplicate title / meta description / H1 grouping** — exact (case/whitespace-insensitive) groups across internal 200 pages; every member flagged with group size and sample URLs. Scales linearly to 10k+ URLs.
- **Metadata duplicate detection** — compares title, meta description, H1, and word count across page pairs (configurable similarity threshold, default 0.85). Pairwise scan is skipped above 800 pages; exact grouping covers large crawls.
- **Issue exclusion patterns** — skip issue detection for admin/dev paths (configurable)

---

## Analysis engine

Beyond per-URL issues, the **Audit** tab runs post-crawl analysis:

### Site score

- Composite **site health score** (0–100) based on issue severity, orphans, and broken internal links

### Issue prioritization

- Groups issues by type with **severity** (critical / high / medium / low)
- **Template detection** — flags issues affecting many URLs under the same path pattern
- **Recommended fixes** per issue type

### Content clusters

- Groups internal pages by **first URL path segment** (e.g. `/blog/`, `/products/`)
- Per cluster: page count, average authority, top page, weak pages, cross-cluster linking stats

### Content similarity

- **TF-IDF cosine similarity** over title, meta description, H1, H2, H3
- Per-page closest similar page and similarity score
- **Similarity clusters** graded A–F by duplication risk
- **Low-relevance pages** — content far from the site centroid (off-topic candidates)

### Crawl diagnostics

- Sitemap found / not found
- Robots-blocked URL count
- Timeouts, SSL errors, DNS failures
- Duplicate URL variant count
- Parameterized URL count

---

## Visualizations

Interactive **Cytoscape** graphs in the **Visualization** tab:

| Mode | Description |
|------|-------------|
| **Crawl Tree** | Site hierarchy by shortest link path from homepage (BFS), max depth 5 |
| **Authority Flow** | Tree by highest authority-passing parent link, max depth 3; tapered ribbon edges (wide at source, narrow at target) = authority flow |

- Click any node to re-root the tree
- Color-coded by status code and content cluster
- Node size scaled by authority or page count

---

## Domain Rating

- **Ahrefs Domain Rating** widget in the header (free public API, no key required)
- Updates when a target URL is entered
- Shows domain name, DR score (0–100), and a filled ring indicator

---

## UI & navigation

### Main tabs

| Tab | Purpose |
|-----|---------|
| **Overview** | All crawled URLs in a filterable data table |
| **Internal** | Internal URLs only |
| **External** | External URLs only |
| **Status Codes** | URLs grouped by response code |
| **Links** | All discovered links with anchor text and placement |
| **Issues** | All detected SEO/technical issues |
| **Audit** | Prioritized analysis summary, link intelligence, clusters, similarity |
| **Visualization** | Interactive site structure graphs |

### Sidebar filters

- Internal / external
- Response codes: 2xx, 3xx, 4xx, 5xx, no response
- Content type: HTML, CSS, JavaScript, images
- Live statistics: URLs discovered, crawled, depth, speed, memory

### URL detail panel

Click any URL to inspect full extracted metadata (title, meta, headings, robots, canonical, analytics, etc.)

---

## Export

### Formats

- **CSV** — spreadsheet-friendly
- **XLSX** — Excel workbook with URLs, Issues, and Links sheets
- **JSON** — structured data with all selected fields
- **XML** — markup format

### Exportable fields

`url`, `status_code`, `title`, `meta_description`, `h1`, `word_count`, `content_type`, `response_time`, `canonical_url`, `og_tags`, `twitter_tags`, `json_ld`, `analytics`, `internal_links`, `external_links`, `images`, `links_detailed`, `lang`, `charset`, `viewport`, `robots`, `issues_detected`

### Other export options

- Separate **links** file (when `links_detailed` selected)
- Separate **issues** export
- **HTML audit report** via `/api/report/html`
- **Save crawl** to browser (JSON download) and **load crawl** from file

---

## Persistence

### Crawl history (database)

- Save crawls to local SQLite storage
- List, load, resume, archive, and delete saved crawls
- Dashboard for crawl history and stats

### Sessions

- Isolated crawler sessions per browser (no accounts, no login)
- Settings stored in **browser localStorage** (per browser) and SQLite
- Session expiry after inactivity

---

## API endpoints (selected)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/start_crawl` | Start a crawl |
| `POST /api/stop_crawl` | Stop a crawl |
| `GET /api/crawl_status` | Live crawl progress and data |
| `GET /api/analysis/summary` | Full audit summary |
| `GET /api/analysis/link_graph` | Link graph metrics and reports |
| `GET /api/analysis/content_similarity` | Similarity clusters and low-relevance pages |
| `GET /api/visualization/graph` | Cytoscape graph payload |
| `GET /api/domain-rating` | Ahrefs DR for a target domain |
| `GET /api/report/html` | Downloadable HTML audit report |
| `POST /api/export_data` | Export crawl data (CSV/JSON/XML/XLSX) |
| `GET /api/crawls/list` | List saved crawls |
| `POST /api/crawls/<id>/load` | Load a saved crawl |

---

## Configuration (Settings)

| Section | Options |
|---------|---------|
| **Crawler** | Max depth, max URLs, crawl delay, follow redirects, crawl external links |
| **HTTP** | User-Agent, timeout, retries, Accept-Language, robots.txt, cookies, sitemap discovery |
| **Content filters** | Include/exclude extensions and URL patterns, max file size |
| **Duplication** | Enable duplication check, similarity threshold |
| **Export** | Default format, field selection |
| **JavaScript** | Enable rendering, wait time, timeout, browser engine, headless, viewport, concurrent pages |
| **Issue exclusion** | URL patterns to skip in issue detection |
| **Custom CSS** | Personalize the UI |
| **Advanced** | Concurrent requests, memory limit, log level, proxy, custom headers |

---

## Known limitations

These are **not** implemented today:

- Blocked URL list (only a blocked count)
- X-Robots-Tag HTTP header (only meta robots checked)
- Canonical HTTP header (only `<link rel="canonical">`)
- hreflang validation rules
- Pagination (`rel=next` / `rel=prev`) audit
- Security checks (mixed content, security headers)
- Raw vs rendered HTML diff
- Exact body-level duplicate detection
- Crawl comparison / diff between two runs
- Integrations: Google Search Console, Analytics, PageSpeed Insights, Majestic, Moz
- Rendered screenshots, AMP validation, spelling/grammar, full WCAG/AXE accessibility
- XML sitemap generation, robots.txt editor
- Custom extraction (XPath/CSS/regex) or custom JavaScript during crawl
- AI prompts during crawl

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.8+, Flask, Waitress |
| Crawler | `requests`, BeautifulSoup, Playwright |
| Frontend | Vanilla JS, Cytoscape.js, Geist font |
| Storage | SQLite (crawl persistence, auth) |
| Export | CSV, openpyxl (XLSX), JSON, XML |
