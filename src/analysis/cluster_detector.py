"""Content cluster detection (v1: URL path based).

Groups internal pages into clusters by their first path segment
(/blog/*, /products/*, ...). Root-level pages form the '/' cluster.
Optionally enriches clusters with authority metrics and cross-cluster
linking stats when link-graph output is provided.
"""
from urllib.parse import urlparse

from src.analysis.url_normalizer import normalize_url

WEAK_PAGE_AUTHORITY_SHARE = 0.2  # weak = under 20% of the cluster's top authority


def cluster_id_for_url(url):
    """First path segment, e.g. '/blog/'; '/' for root-level pages"""
    try:
        path = urlparse(url).path
    except ValueError:
        return '/'
    segments = [s for s in path.split('/') if s]
    return f'/{segments[0]}/' if len(segments) > 1 else '/'


def detect_clusters(pages, links=None, page_metrics=None):
    """Detect URL-based clusters.

    Args:
        pages: list of crawl results
        links: optional list of link dicts (for cross-cluster linking stats)
        page_metrics: optional {normalized_url: metrics} from link_graph_analyzer

    Returns:
        list of cluster dicts sorted by size (desc)
    """
    page_metrics = page_metrics or {}

    clusters = {}
    cluster_of_page = {}  # normalized_url -> cluster_id
    for p in pages:
        if not p.get('is_internal', True):
            continue
        norm = p.get('normalized_url') or normalize_url(p.get('url', ''), aggressive=True)
        cid = cluster_id_for_url(norm)
        cluster_of_page[norm] = cid
        clusters.setdefault(cid, []).append((norm, p))

    # Cross-cluster linking
    internal_out = {}   # cluster_id -> total internal body links from cluster
    external_out = {}   # cluster_id -> links leaving the cluster
    if links:
        for l in links:
            if not l.get('is_internal') or l.get('placement') != 'body':
                continue
            s = normalize_url(l.get('source_url', ''), aggressive=True)
            t = normalize_url(l.get('target_url', ''), aggressive=True)
            cs, ct = cluster_of_page.get(s), cluster_of_page.get(t)
            if cs is None or ct is None:
                continue
            internal_out[cs] = internal_out.get(cs, 0) + 1
            if cs != ct:
                external_out[cs] = external_out.get(cs, 0) + 1

    results = []
    for cid, members in clusters.items():
        member_metrics = [(norm, page_metrics.get(norm)) for norm, _ in members]
        with_authority = [(norm, m) for norm, m in member_metrics if m]

        top_page = None
        weak_pages = []
        avg_authority = None
        if with_authority:
            with_authority.sort(key=lambda nm: -nm[1]['authority_score'])
            top_norm, top_metrics = with_authority[0]
            top_page = {'url': top_metrics['url'], 'authority_score': top_metrics['authority_score']}
            avg_authority = round(
                sum(m['authority_score'] for _, m in with_authority) / len(with_authority), 1)
            threshold = top_metrics['authority_score'] * WEAK_PAGE_AUTHORITY_SHARE
            weak_pages = [{'url': m['url'], 'authority_score': m['authority_score']}
                          for _, m in with_authority[1:] if m['authority_score'] < threshold]

        orphan_count = sum(1 for norm, m in member_metrics if m and m.get('is_orphan'))

        total_out = internal_out.get(cid, 0)
        cross_out = external_out.get(cid, 0)
        cross_link_share = round(cross_out / total_out, 3) if total_out else None

        results.append({
            'cluster_id': cid,
            'name': 'Root pages' if cid == '/' else cid.strip('/'),
            'size': len(members),
            'example_urls': [p.get('url', '') for _, p in members[:5]],
            'top_authority_page': top_page,
            'avg_authority': avg_authority,
            'weak_pages': weak_pages[:10],
            'orphan_count': orphan_count,
            'cross_cluster_link_share': cross_link_share,
        })

    results.sort(key=lambda c: -c['size'])
    return results
