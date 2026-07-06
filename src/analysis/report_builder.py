"""Standalone HTML report generation from a crawl summary."""
import html

SEVERITY_COLORS = {'critical': '#c0392b', 'high': '#e67e22', 'medium': '#f1c40f', 'low': '#95a5a6'}

CSS = """
body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
       color: #2c3e50; max-width: 960px; margin: 0 auto; padding: 32px 24px; }
h1 { font-size: 26px; margin-bottom: 4px; }
h2 { font-size: 20px; margin-top: 36px; border-bottom: 2px solid #ecf0f1; padding-bottom: 6px; }
.meta { color: #7f8c8d; font-size: 13px; }
.score { font-size: 48px; font-weight: 700; }
.cards { display: flex; gap: 16px; flex-wrap: wrap; margin: 16px 0; }
.card { flex: 1; min-width: 140px; background: #f8f9fa; border-radius: 8px; padding: 14px; }
.card .num { font-size: 24px; font-weight: 700; }
.card .label { font-size: 12px; color: #7f8c8d; text-transform: uppercase; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
th { text-align: left; background: #f8f9fa; }
th, td { padding: 8px 10px; border-bottom: 1px solid #ecf0f1; vertical-align: top; }
.sev { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-size: 12px; }
.fix { color: #566573; font-size: 13px; }
.urls { color: #7f8c8d; font-size: 12px; word-break: break-all; }
"""


def _e(text):
    return html.escape(str(text if text is not None else ''))


def _sev_badge(severity):
    color = SEVERITY_COLORS.get(severity, '#95a5a6')
    return f'<span class="sev" style="background:{color}">{_e(severity)}</span>'


def build_html_report(summary, site_url=''):
    """Render a self-contained HTML audit report from summarize_crawl output."""
    s = summary
    parts = []
    parts.append('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">')
    parts.append(f'<title>SEO Audit Report {_e(site_url)}</title>')
    parts.append(f'<style>{CSS}</style></head><body>')

    # Header / summary
    parts.append(f'<h1>SEO Audit Report</h1>')
    parts.append(f'<div class="meta">{_e(site_url)} &middot; generated {_e(s.get("generated_at", ""))} by Crawlyx</div>')
    sev = s.get('severity_counts', {})
    parts.append('<div class="cards">')
    parts.append(f'<div class="card"><div class="num score" style="font-size:32px">{_e(s.get("site_score", 0))}</div><div class="label">Site score / 100</div></div>')
    parts.append(f'<div class="card"><div class="num">{_e(s.get("internal_pages", 0))}</div><div class="label">Pages crawled</div></div>')
    parts.append(f'<div class="card"><div class="num">{_e(s.get("total_issues", 0))}</div><div class="label">Issues found</div></div>')
    parts.append(f'<div class="card"><div class="num" style="color:{SEVERITY_COLORS["critical"]}">{_e(sev.get("critical", 0))}</div><div class="label">Critical groups</div></div>')
    parts.append(f'<div class="card"><div class="num" style="color:{SEVERITY_COLORS["high"]}">{_e(sev.get("high", 0))}</div><div class="label">High groups</div></div>')
    parts.append('</div>')

    # Crawl scope
    parts.append('<h2>Crawl Scope</h2><table>')
    parts.append(f'<tr><td>Pages crawled</td><td>{_e(s.get("total_pages", 0))}</td></tr>')
    parts.append(f'<tr><td>Links collected</td><td>{_e(s.get("total_links", 0))}</td></tr>')
    parts.append(f'<tr><td>Average crawl depth</td><td>{_e(s.get("avg_depth", 0))}</td></tr>')
    for bucket, count in sorted(s.get('status_breakdown', {}).items()):
        parts.append(f'<tr><td>Status {_e(bucket)}</td><td>{_e(count)}</td></tr>')
    diag = s.get('diagnostics') or {}
    if diag:
        if diag.get('sitemap_found') is not None:
            parts.append(f'<tr><td>Sitemap</td><td>{"Found" if diag.get("sitemap_found") else "Not found"}</td></tr>')
        for label, key in (('Robots-blocked URLs', 'robots_blocked'), ('Timeouts', 'timeouts'),
                           ('Duplicate URL variants', 'duplicate_url_variants')):
            if diag.get(key):
                parts.append(f'<tr><td>{label}</td><td>{_e(diag[key])}</td></tr>')
    parts.append('</table>')

    # Priority recommendations
    parts.append('<h2>Priority Recommendations</h2>')
    top = s.get('top_issues', [])
    if top:
        parts.append('<table><tr><th>Priority</th><th>Issue</th><th>Affected</th><th>Recommended fix</th></tr>')
        for g in top:
            examples = '<br>'.join(_e(u) for u in g.get('example_urls', [])[:3])
            cause = f'<div class="fix">Likely cause: {_e(g["likely_cause"])}</div>' if g.get('likely_cause') else ''
            parts.append(
                f'<tr><td>{_sev_badge(g.get("severity"))}<br><span class="meta">{_e(g.get("priority_score"))}</span></td>'
                f'<td><strong>{_e(g.get("issue"))}</strong><div class="meta">{_e(g.get("category"))}</div>{cause}</td>'
                f'<td>{_e(g.get("affected_url_count"))} pages<div class="urls">{examples}</div></td>'
                f'<td class="fix">{_e(g.get("recommended_fix"))}</td></tr>')
        parts.append('</table>')
    else:
        parts.append('<p>No issues detected.</p>')

    # Internal linking
    lr = s.get('link_reports', {})
    parts.append('<h2>Internal Linking</h2>')
    parts.append('<div class="cards">')
    for label, key in (('Orphan pages', 'orphan_count'), ('Near-orphans', 'near_orphan_count'),
                       ('Broken internal links', 'broken_internal_links_count'),
                       ('Redirected internal links', 'redirected_internal_links_count')):
        parts.append(f'<div class="card"><div class="num">{_e(lr.get(key, 0))}</div><div class="label">{label}</div></div>')
    parts.append('</div>')

    strongest = lr.get('highest_authority', [])[:5]
    if strongest:
        parts.append('<h3>Highest internal authority</h3><table><tr><th>Page</th><th>Authority</th><th>Inlinks</th></tr>')
        for m in strongest:
            parts.append(f'<tr><td class="urls">{_e(m.get("url"))}</td><td>{_e(m.get("authority_score"))}</td><td>{_e(m.get("inlinks"))}</td></tr>')
        parts.append('</table>')

    broken = lr.get('broken_internal_links', [])[:20]
    if broken:
        parts.append('<h3>Broken internal links</h3><table><tr><th>From</th><th>To</th><th>Status</th></tr>')
        for l in broken:
            parts.append(f'<tr><td class="urls">{_e(l.get("source_url"))}</td><td class="urls">{_e(l.get("target_url"))}</td><td>{_e(l.get("target_status"))}</td></tr>')
        parts.append('</table>')

    orphans = lr.get('orphan_pages', [])[:20]
    if orphans:
        parts.append('<h3>Orphan pages</h3><table><tr><th>Page</th><th>Depth</th></tr>')
        for m in orphans:
            parts.append(f'<tr><td class="urls">{_e(m.get("url"))}</td><td>{_e(m.get("crawl_depth"))}</td></tr>')
        parts.append('</table>')

    # Clusters
    clusters = s.get('clusters', [])
    if clusters:
        parts.append('<h2>Content Clusters</h2>')
        parts.append('<table><tr><th>Cluster</th><th>Pages</th><th>Avg authority</th><th>Top page</th><th>Orphans</th></tr>')
        for c in clusters[:15]:
            top_page = c.get('top_authority_page') or {}
            parts.append(
                f'<tr><td>{_e(c.get("name"))}</td><td>{_e(c.get("size"))}</td>'
                f'<td>{_e(c.get("avg_authority") if c.get("avg_authority") is not None else "-")}</td>'
                f'<td class="urls">{_e(top_page.get("url", "-"))}</td>'
                f'<td>{_e(c.get("orphan_count", 0))}</td></tr>')
        parts.append('</table>')

    parts.append('<p class="meta">Generated by Crawlyx.</p></body></html>')
    return ''.join(parts)
