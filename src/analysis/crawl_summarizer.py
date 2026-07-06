"""Executive crawl summary: composes all analysis modules into one result.

This is the single entry point the API and reports use. The crawler
collects facts; this module turns them into insight.
"""
import time

from src.analysis.issue_prioritizer import group_issues
from src.analysis.link_graph_analyzer import analyze_link_graph
from src.analysis.cluster_detector import detect_clusters

SEVERITY_PENALTY = {'critical': 10, 'high': 5, 'medium': 2, 'low': 0.5}


def summarize_crawl(pages, links, issues, diagnostics=None):
    """Build the full analysis summary for a completed (or running) crawl."""
    issue_groups = group_issues(issues, pages)
    graph = analyze_link_graph(pages, links)
    clusters = detect_clusters(pages, links, graph['pages'])

    severity_counts = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}
    for g in issue_groups:
        severity_counts[g['severity']] += 1

    reports = graph['reports']
    site_score = 100.0
    for g in issue_groups:
        site_score -= SEVERITY_PENALTY.get(g['severity'], 0)
    site_score -= min(10, len(reports['orphan_pages']))
    site_score -= min(10, len(reports['broken_internal_links']) * 0.5)
    site_score = max(0, round(site_score, 1))

    status_breakdown = {}
    for p in pages:
        code = p.get('status_code', 0)
        bucket = f'{code // 100}xx' if code else 'no_response'
        status_breakdown[bucket] = status_breakdown.get(bucket, 0) + 1

    internal_pages = [p for p in pages if p.get('is_internal', True)]
    depths = [p.get('depth', 0) for p in internal_pages]

    return {
        'generated_at': time.strftime('%Y-%m-%d %H:%M:%S'),
        'site_score': site_score,
        'total_pages': len(pages),
        'internal_pages': len(internal_pages),
        'total_links': len(links),
        'total_issues': len(issues),
        'avg_depth': round(sum(depths) / len(depths), 1) if depths else 0,
        'severity_counts': severity_counts,
        'status_breakdown': status_breakdown,
        'top_issues': issue_groups[:10],
        'issue_groups': issue_groups,
        'link_reports': {
            'orphan_count': len(reports['orphan_pages']),
            'near_orphan_count': len(reports['near_orphan_pages']),
            'broken_internal_links_count': len(reports['broken_internal_links']),
            'redirected_internal_links_count': len(reports['redirected_internal_links']),
            **reports,
        },
        'clusters': clusters,
        'diagnostics': diagnostics or {},
    }
