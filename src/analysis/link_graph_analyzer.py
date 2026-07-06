"""Internal link intelligence: per-page metrics, weighted authority, reports.

Consumes the crawler's facts (pages + links) and produces insight:
- per-page inlink/outlink counts by placement
- a weighted PageRank-style internal authority score (0-100)
- orphan / near-orphan / overlinked / underlinked detection
- broken and redirected internal link reports

Link weights follow SEO reality: body links pass most value, navigation
and footer links little. Links to non-200 pages pass nothing. Body links
that appear site-wide (same target linked from most pages) are discounted.
"""
from src.analysis.url_normalizer import normalize_url

LINK_WEIGHTS = {'body': 1.0, 'navigation': 0.3, 'footer': 0.1, 'image': 0.2}
SITEWIDE_LINK_SHARE = 0.7   # body links to a target from >70% of pages get discounted
SITEWIDE_DISCOUNT = 0.5
NEAR_ORPHAN_MAX_INLINKS = 1
OVERLINKED_MIN_OUTLINKS = 100
UNDERLINKED_MAX_INLINKS = 2
UNDERLINKED_MIN_DEPTH = 2
PAGERANK_DAMPING = 0.85
PAGERANK_ITERATIONS = 30


def _norm(url):
    return normalize_url(url, aggressive=True)


def analyze_link_graph(pages, links):
    """Analyze internal linking.

    Args:
        pages: list of crawl results (url, status_code, depth, is_internal, ...)
        links: list of link dicts (source_url, target_url, placement,
               is_internal, target_status)

    Returns:
        {'pages': {url: metrics}, 'reports': {...}}
    """
    # Index crawled internal pages by normalized URL
    page_by_norm = {}
    for p in pages:
        if p.get('is_internal', True):
            page_by_norm[p.get('normalized_url') or _norm(p.get('url', ''))] = p

    total_pages = max(len(page_by_norm), 1)

    # All internal links (image links are kept for broken-link reporting but
    # excluded from inlink/outlink counts below)
    internal_links = [l for l in links if l.get('is_internal')]

    # Per-target distinct sources (for sitewide-link discount and inlink counts)
    sources_per_target = {}
    for l in internal_links:
        t = _norm(l.get('target_url', ''))
        s = _norm(l.get('source_url', ''))
        sources_per_target.setdefault(t, set()).add(s)

    # Init metrics for every crawled internal page
    metrics = {}
    for norm_url, p in page_by_norm.items():
        metrics[norm_url] = {
            'url': p.get('url', ''),
            'inlinks': 0,
            'outlinks': 0,
            'body_inlinks': 0,
            'nav_inlinks': 0,
            'footer_inlinks': 0,
            'crawl_depth': p.get('depth', 0),
            'status_code': p.get('status_code', 0),
            'authority_score': 0.0,
            'is_orphan': False,
            'is_near_orphan': False,
            'is_overlinked': False,
            'is_underlinked': False,
        }

    # Build weighted edges and count metrics
    edges = {}  # (source_norm, target_norm) -> weight
    broken_links = []
    redirected_links = []

    for l in internal_links:
        s = _norm(l.get('source_url', ''))
        t = _norm(l.get('target_url', ''))
        placement = l.get('placement', 'body')
        target_status = l.get('target_status')

        if s in metrics and placement != 'image':
            metrics[s]['outlinks'] += 1
        if t in metrics and placement != 'image':
            metrics[t]['inlinks'] += 1
            key = {'body': 'body_inlinks', 'navigation': 'nav_inlinks',
                   'footer': 'footer_inlinks'}.get(placement)
            if key:
                metrics[t][key] += 1

        # Broken / redirected internal links
        if target_status is not None:
            if target_status == 0 or target_status >= 400:
                broken_links.append(l)
            elif 300 <= target_status < 400:
                redirected_links.append(l)

        # Authority edges: only between known pages, only to healthy targets
        if s not in metrics or t not in metrics or s == t:
            continue
        if target_status is not None and target_status != 200:
            continue

        weight = LINK_WEIGHTS.get(placement, 1.0)
        if (placement == 'body'
                and len(sources_per_target.get(t, ())) / total_pages > SITEWIDE_LINK_SHARE):
            weight *= SITEWIDE_DISCOUNT

        edges[(s, t)] = max(edges.get((s, t), 0.0), weight)

    _compute_authority(metrics, edges)

    # Flags
    for norm_url, m in metrics.items():
        if m['status_code'] != 200:
            continue
        if m['inlinks'] == 0 and m['crawl_depth'] > 0:
            m['is_orphan'] = True
        elif m['inlinks'] <= NEAR_ORPHAN_MAX_INLINKS and m['crawl_depth'] > 0:
            m['is_near_orphan'] = True
        if m['outlinks'] >= OVERLINKED_MIN_OUTLINKS:
            m['is_overlinked'] = True
        if (m['inlinks'] <= UNDERLINKED_MAX_INLINKS
                and m['crawl_depth'] >= UNDERLINKED_MIN_DEPTH
                and not m['is_orphan'] and not m['is_near_orphan']):
            m['is_underlinked'] = True

    reports = _build_reports(metrics, broken_links, redirected_links)
    edge_list = [{'source': s, 'target': t, 'weight': w}
                 for (s, t), w in edges.items() if w > 0]
    return {'pages': metrics, 'reports': reports, 'edges': edge_list}


def _compute_authority(metrics, edges):
    """Weighted PageRank over internal links; scores scaled to 0-100."""
    nodes = list(metrics.keys())
    n = len(nodes)
    if n == 0:
        return

    out_weight = {}  # total outgoing edge weight per source
    incoming = {}    # target -> [(source, weight)]
    for (s, t), w in edges.items():
        if w <= 0:
            continue
        out_weight[s] = out_weight.get(s, 0.0) + w
        incoming.setdefault(t, []).append((s, w))

    rank = {node: 1.0 / n for node in nodes}
    for _ in range(PAGERANK_ITERATIONS):
        # Redistribute rank of dangling nodes (no outgoing edges) evenly
        dangling = sum(rank[node] for node in nodes if node not in out_weight)
        base = (1 - PAGERANK_DAMPING) / n + PAGERANK_DAMPING * dangling / n
        new_rank = {}
        for node in nodes:
            incoming_rank = sum(
                rank[s] * w / out_weight[s] for s, w in incoming.get(node, ())
            )
            new_rank[node] = base + PAGERANK_DAMPING * incoming_rank
        rank = new_rank

    max_rank = max(rank.values()) or 1.0
    for node in nodes:
        metrics[node]['authority_score'] = round(100 * rank[node] / max_rank, 1)


def _build_reports(metrics, broken_links, redirected_links):
    """Product-level link reports"""
    healthy = [m for m in metrics.values() if m['status_code'] == 200]
    by_authority = sorted(healthy, key=lambda m: -m['authority_score'])

    def link_row(l):
        return {'source_url': l.get('source_url', ''),
                'target_url': l.get('target_url', ''),
                'anchor_text': l.get('anchor_text', ''),
                'placement': l.get('placement', ''),
                'target_status': l.get('target_status')}

    return {
        'highest_authority': by_authority[:10],
        'lowest_authority': [m for m in reversed(by_authority) if m['crawl_depth'] > 0][:10],
        'orphan_pages': [m for m in healthy if m['is_orphan']],
        'near_orphan_pages': [m for m in healthy if m['is_near_orphan']],
        'overlinked_pages': [m for m in healthy if m['is_overlinked']],
        'underlinked_pages': [m for m in healthy if m['is_underlinked']],
        'broken_internal_links': [link_row(l) for l in broken_links],
        'redirected_internal_links': [link_row(l) for l in redirected_links],
    }
