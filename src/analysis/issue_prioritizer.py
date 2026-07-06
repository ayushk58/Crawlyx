"""Issue prioritization and grouping.

Turns the flat per-URL issue list from IssueDetector into product-level
insight: one group per issue type with affected counts, examples, template
detection, a recommended fix, and a priority score.
"""
from urllib.parse import urlparse

# Base score by issue type
TYPE_BASE_SCORE = {'error': 50, 'warning': 30, 'info': 10}

# Minimum affected URLs sharing a path section to call it template-level
TEMPLATE_MIN_URLS = 5
TEMPLATE_SHARE = 0.6
SITEWIDE_SHARE = 0.8

RECOMMENDED_FIXES = {
    'Missing Title Tag': 'Add a unique, descriptive <title> (30-60 characters) to each affected page or its template.',
    'Title Too Long': 'Shorten titles to 60 characters or less so they are not truncated in search results.',
    'Title Too Short': 'Expand titles to at least 30 characters with descriptive, keyword-relevant text.',
    'Missing Meta Description': 'Add a meta description (120-160 characters) to each affected page or its template.',
    'Meta Description Too Long': 'Shorten meta descriptions to 160 characters or less.',
    'Meta Description Too Short': 'Expand meta descriptions to 120-160 characters.',
    'Missing H1 Tag': 'Add exactly one H1 heading describing the page content.',
    'Thin Content': 'Expand page content to at least 300 words, or noindex pages that serve no search purpose.',
    'Missing Canonical URL': 'Add a self-referencing canonical link tag to the page template.',
    'Canonical URL Different': 'Verify the canonical target is intended; unintended canonicals remove pages from search.',
    'Missing Viewport Meta Tag': 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the page template.',
    'Missing Language Attribute': 'Add a lang attribute to the <html> tag (e.g. <html lang="en">).',
    'Images Without Alt Text': 'Add descriptive alt attributes to images, or empty alt="" for decorative ones.',
    'Missing OpenGraph Tags': 'Add og:title, og:description and og:image tags for better social sharing.',
    'Missing Twitter Card Tags': 'Add twitter:card and related tags for better Twitter/X sharing.',
    'No Structured Data': 'Add JSON-LD structured data appropriate to the page type (Article, Product, etc.).',
    'Slow Response Time': 'Investigate server response times: caching, database queries, hosting capacity.',
    'Moderate Response Time': 'Consider caching and server-side optimizations to bring response times under 1s.',
    'Large Page Size': 'Compress images, minify assets, and remove unused resources to reduce page weight.',
    'Moderate Page Size': 'Optimize images and assets to bring page size under 1MB.',
    'Noindex Tag Present': 'Confirm noindex is intentional; remove it if these pages should rank.',
    'Nofollow Tag Present': 'Confirm nofollow is intentional; it stops link equity from flowing.',
    'Duplicate Content Detected': 'Consolidate duplicate pages or add canonical tags pointing to the preferred version.',
    'DNS Not Found': 'The domain does not resolve; check DNS configuration.',
    'Request Timeout': 'Server is too slow or unreachable; check hosting and firewall rules.',
    'SSL/TLS Error': 'Fix the SSL certificate (expired, self-signed, or wrong host).',
}

CATEGORY_FALLBACK_FIXES = {
    'Technical': 'Fix the underlying server or URL problem so the page returns a healthy 200 response.',
    'SEO': 'Update the page or its template to follow SEO best practices for this element.',
    'Content': 'Review and improve the page content.',
    'Performance': 'Profile and optimize page delivery.',
    'Accessibility': 'Update the page template to meet accessibility guidelines.',
    'Social': 'Add social sharing meta tags to the page template.',
    'Structured Data': 'Add structured data markup to the page template.',
    'Mobile': 'Make the page template mobile-friendly.',
    'Indexability': 'Review robots directives on the affected pages.',
    'Duplication': 'Consolidate or canonicalize duplicate content.',
}


def _path_section(url):
    """First path segment of a URL ('/' for root-level pages)"""
    try:
        path = urlparse(url).path
    except ValueError:
        return '/'
    segments = [s for s in path.split('/') if s]
    return f'/{segments[0]}/' if len(segments) > 1 else '/'


def _is_homepage(url):
    try:
        path = urlparse(url).path
    except ValueError:
        return False
    return path in ('', '/')


def group_issues(issues, pages=None):
    """Group a flat issue list into prioritized issue groups.

    Args:
        issues: list of {url, type, category, issue, details}
        pages: optional list of crawl results (used for depth, robots,
               and total page count)

    Returns:
        list of group dicts sorted by priority_score (desc)
    """
    pages = pages or []
    page_lookup = {p.get('url'): p for p in pages}
    total_pages = max(len(pages), 1)

    # Bucket issues by issue name
    buckets = {}
    for issue in issues:
        name = issue.get('issue', 'Unknown Issue')
        buckets.setdefault(name, []).append(issue)

    groups = []
    for name, bucket in buckets.items():
        urls = []
        seen = set()
        for i in bucket:
            u = i.get('url', '')
            if u not in seen:
                seen.add(u)
                urls.append(u)

        affected_count = len(urls)
        issue_type = bucket[0].get('type', 'warning')
        category = bucket[0].get('category', '')

        # Template detection: do most affected URLs share a path section?
        sections = {}
        for u in urls:
            s = _path_section(u)
            sections[s] = sections.get(s, 0) + 1
        top_section, top_count = max(sections.items(), key=lambda kv: kv[1])
        is_template_level = (affected_count >= TEMPLATE_MIN_URLS
                             and top_count / affected_count >= TEMPLATE_SHARE
                             and top_section != '/')
        is_sitewide = (bool(pages)
                       and affected_count / total_pages >= SITEWIDE_SHARE
                       and affected_count >= TEMPLATE_MIN_URLS)

        # Priority score
        score = TYPE_BASE_SCORE.get(issue_type, 30)
        score += min(30, 30 * affected_count / total_pages)

        homepage_affected = any(_is_homepage(u) for u in urls)
        if homepage_affected:
            score += 15

        # Depth boost: issues on shallow pages matter more
        depths = [page_lookup[u].get('depth', 0) for u in urls if u in page_lookup]
        if depths and sum(depths) / len(depths) <= 1:
            score += 10

        # Indexable pages affected matter more than noindexed ones
        indexable = [u for u in urls
                     if u in page_lookup and 'noindex' not in page_lookup[u].get('robots', '').lower()]
        if page_lookup and urls and not indexable:
            score -= 15  # only noindexed pages affected

        if is_template_level:
            score += 5

        score = max(0, min(100, round(score, 1)))

        if score >= 75:
            severity = 'critical'
        elif score >= 50:
            severity = 'high'
        elif score >= 30:
            severity = 'medium'
        else:
            severity = 'low'

        likely_cause = None
        if is_sitewide:
            likely_cause = 'Site-wide template or configuration'
        elif is_template_level:
            likely_cause = f'Template used by the {top_section} section'

        groups.append({
            'issue': name,
            'type': issue_type,
            'category': category,
            'severity': severity,
            'priority_score': score,
            'affected_url_count': affected_count,
            'affected_share': round(affected_count / total_pages, 3),
            'example_urls': urls[:5],
            'top_section': top_section,
            'is_template_level': is_template_level,
            'is_sitewide': is_sitewide,
            'homepage_affected': homepage_affected,
            'likely_cause': likely_cause,
            'recommended_fix': RECOMMENDED_FIXES.get(
                name, CATEGORY_FALLBACK_FIXES.get(category, 'Review the affected pages.')),
        })

    groups.sort(key=lambda g: (-g['priority_score'], -g['affected_url_count'], g['issue']))
    return groups
