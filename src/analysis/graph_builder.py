"""Cytoscape-ready graph payloads for the site visualizations.

Two tree modes, aggregated server-side so the browser never renders a
hairball:

- crawltree:  hierarchy by shortest link path from the homepage (BFS over
              internal links), max depth 5.
- authority:  authority-flow graph. The tree skeleton hangs each page off
              the source that passes it the MOST authority
              (source_authority x edge_weight / source_out_weight), max
              depth 3. On top of the skeleton, dashed cross edges show the
              other strongest inflows per page — including flow back into
              the homepage — so convergent page->page and page->home flow
              is visible, not just home->page. Nodes carry inflow/outflow
              totals and a flow_role (receiver/donor/balanced).
              Edge width/intensity = amount of authority flowing.

Click any node to re-root its tree; '+N more' groups re-root at the parent.
"""
import math
from urllib.parse import urlparse

from src.analysis.url_normalizer import normalize_url
from src.analysis.link_graph_analyzer import analyze_link_graph
from src.analysis.cluster_detector import detect_clusters, cluster_id_for_url

MAX_NODES = 250
CRAWLTREE_CHILD_CAP = 12   # children per node (75 for the root when focused)
CRAWLTREE_MAX_DEPTH = 5    # levels below the root
AUTHORITY_CHILD_CAP = 10
AUTHORITY_MAX_DEPTH = 3
FOCUS_ROOT_CHILD_CAP = 75

# Cross-flow edges (authority mode): extra strongest inflows drawn on top
# of the tree skeleton so convergent flow is visible.
CROSS_EDGES_PER_NODE = 2     # additional inflows shown per page
CROSS_EDGES_TO_ROOT = 3      # inflows shown into the root (page -> home flow)
CROSS_EDGES_TOTAL_CAP = 120
FLOW_ROLE_RATIO = 1.25       # inflow/outflow imbalance to call receiver/donor

PAGE_SIZE_MIN, PAGE_SIZE_MAX = 15, 60
CLUSTER_SIZE_MAX = 90
EDGE_WIDTH_MIN, EDGE_WIDTH_MAX = 1, 10


def _norm(url):
    return normalize_url(url, aggressive=True)


def _page_label(norm_url):
    try:
        path = urlparse(norm_url).path
    except ValueError:
        return norm_url
    if path in ('', '/'):
        return '/'
    return path.rstrip('/').rsplit('/', 1)[-1] or path


def _scale(value, max_value, lo, hi):
    """sqrt scale into [lo, hi]"""
    if max_value <= 0:
        return lo
    return round(lo + (hi - lo) * math.sqrt(max(0.0, min(1.0, value / max_value))), 1)


class _Graph:
    """Shared computed state for one build call"""

    def __init__(self, pages, links):
        result = analyze_link_graph(pages, links)
        self.metrics = result['pages']          # normalized_url -> metrics
        self.edges = result['edges']            # [{source, target, weight}]
        self.clusters = detect_clusters(pages, links, self.metrics)
        self.cluster_of = {norm: cluster_id_for_url(norm) for norm in self.metrics}
        self.cluster_index = {c['cluster_id']: i for i, c in enumerate(self.clusters)}
        self.links = links

        self.out_weight = {}
        for e in self.edges:
            self.out_weight[e['source']] = self.out_weight.get(e['source'], 0.0) + e['weight']

        # Total authority flowing in/out of each page (for net-flow roles)
        # and distinct linking-page counts (edges are already deduped pairs)
        self.inflow = {}
        self.outflow = {}
        self.in_pages = {}
        self.out_pages = {}
        for e in self.edges:
            self.in_pages[e['target']] = self.in_pages.get(e['target'], 0) + 1
            self.out_pages[e['source']] = self.out_pages.get(e['source'], 0) + 1
            fl = self.flow(e['source'], e['target'], e['weight'])
            if fl <= 0:
                continue
            self.outflow[e['source']] = self.outflow.get(e['source'], 0.0) + fl
            self.inflow[e['target']] = self.inflow.get(e['target'], 0.0) + fl

    def flow(self, source, target, weight):
        ow = self.out_weight.get(source, 0.0)
        if ow <= 0:
            return 0.0
        return self.metrics[source]['authority_score'] * weight / ow

    def flow_role(self, norm_url):
        """'receiver' | 'donor' | 'balanced' by in/out flow imbalance"""
        i = self.inflow.get(norm_url, 0.0)
        o = self.outflow.get(norm_url, 0.0)
        if i < 0.1 and o < 0.1:
            return 'balanced'
        if i > o * FLOW_ROLE_RATIO:
            return 'receiver'
        if o > i * FLOW_ROLE_RATIO:
            return 'donor'
        return 'balanced'

    def page_node(self, norm_url):
        m = self.metrics[norm_url]
        cid = self.cluster_of.get(norm_url, '/')
        return {'data': {
            'id': norm_url,
            'type': 'page',
            'label': _page_label(norm_url),
            'url': m['url'],
            'authority': m['authority_score'],
            'status_code': m['status_code'],
            'depth': m['crawl_depth'],
            'cluster': cid,
            'cluster_index': self.cluster_index.get(cid, 0),
            'is_orphan': m['is_orphan'],
            'inflow': round(self.inflow.get(norm_url, 0.0), 1),
            'outflow': round(self.outflow.get(norm_url, 0.0), 1),
            'in_pages': self.in_pages.get(norm_url, 0),
            'out_pages': self.out_pages.get(norm_url, 0),
            'flow_role': self.flow_role(norm_url),
            'size': _scale(m['authority_score'], 100, PAGE_SIZE_MIN, PAGE_SIZE_MAX),
        }}

    def home(self):
        """Shallowest crawled page (the homepage)"""
        return min(self.metrics, key=lambda n: (self.metrics[n]['crawl_depth'], len(n)))


def _edge_widths(edges):
    """Set 'width' on edge data from relative flow"""
    max_flow = max((e['data'].get('flow', 0) for e in edges), default=0)
    for e in edges:
        if 'flow' in e['data']:
            e['data']['width'] = _scale(e['data']['flow'], max_flow,
                                        EDGE_WIDTH_MIN, EDGE_WIDTH_MAX)
        else:
            e['data'].setdefault('width', 1)
    return edges


def build_graph(pages, links, mode='crawltree', focus=None, expand=None):
    """Build a visualization payload.

    Args:
        pages, links: crawler output
        mode: 'crawltree' | 'authority'
        focus: URL to re-root the tree at
        expand: unused (kept for API compatibility)

    Returns:
        {'mode', 'nodes', 'edges', 'clusters'}
    """
    g = _Graph(pages, links)
    cluster_meta = [{'cluster_id': c['cluster_id'], 'name': c['name'],
                     'page_count': c['size'], 'color_index': g.cluster_index[c['cluster_id']]}
                    for c in g.clusters]

    if not g.metrics:
        return {'mode': mode, 'nodes': [], 'edges': [], 'clusters': cluster_meta}

    if mode == 'authority':
        nodes, edges = _emit_tree(g, *_authority_hierarchy(g, focus),
                                  max_depth=AUTHORITY_MAX_DEPTH,
                                  child_cap=AUTHORITY_CHILD_CAP, focused=bool(focus))
        _add_cross_flow_edges(g, nodes, edges)
    else:
        nodes, edges = _emit_tree(g, *_crawl_hierarchy(g, focus),
                                  max_depth=CRAWLTREE_MAX_DEPTH,
                                  child_cap=CRAWLTREE_CHILD_CAP, focused=bool(focus))

    return {'mode': mode, 'nodes': nodes, 'edges': _edge_widths(edges),
            'clusters': cluster_meta}


def _add_cross_flow_edges(g, nodes, edges):
    """Overlay the strongest non-skeleton inflows between visible pages.

    The tree skeleton shows one parent per page (its strongest source).
    Real authority converges from many sources and also flows back to the
    homepage, so for every visible page we add up to CROSS_EDGES_PER_NODE
    dashed edges from its next-strongest visible sources (CROSS_EDGES_TO_ROOT
    for the root, which the skeleton can never point into).
    """
    emitted = {n['data']['id'] for n in nodes if n['data'].get('type') == 'page'}
    existing = {(e['data']['source'], e['data']['target']) for e in edges}
    root_id = next((n['data']['id'] for n in nodes if n['data'].get('is_root')), None)

    candidates = {}  # target -> [(flow, source)]
    for e in g.edges:
        s, t = e['source'], e['target']
        if s not in emitted or t not in emitted or (s, t) in existing:
            continue
        fl = g.flow(s, t, e['weight'])
        if fl > 0:
            candidates.setdefault(t, []).append((fl, s))

    cross = []
    for t, sources in candidates.items():
        sources.sort(reverse=True)
        cap = CROSS_EDGES_TO_ROOT if t == root_id else CROSS_EDGES_PER_NODE
        cross.extend((fl, s, t) for fl, s in sources[:cap])

    cross.sort(reverse=True)
    for fl, s, t in cross[:CROSS_EDGES_TOTAL_CAP]:
        edges.append({'data': {'id': f'x:{s}->{t}', 'source': s, 'target': t,
                               'flow': round(fl, 2), 'cross': True}})


def _resolve_root(g, focus):
    if focus:
        root = _norm(focus)
        if root not in g.metrics:
            raise ValueError(f'Unknown page: {focus}')
        return root
    return g.home()


def _crawl_hierarchy(g, focus):
    """BFS shortest-link-path hierarchy. Returns (root, children, edge_meta, extras)."""
    adj = {}
    for l in g.links:
        if not l.get('is_internal') or l.get('placement') == 'image':
            continue
        s, t = _norm(l.get('source_url', '')), _norm(l.get('target_url', ''))
        if s in g.metrics and t in g.metrics and s != t:
            adj.setdefault(s, []).append(t)

    root = _resolve_root(g, focus)

    parent = {root: None}
    order = [root]
    qi = 0
    while qi < len(order):
        u = order[qi]
        qi += 1
        for v in adj.get(u, ()):
            if v not in parent:
                parent[v] = u
                order.append(v)

    children = {}
    for v, p in parent.items():
        if p is not None:
            children.setdefault(p, []).append(v)

    # Rank children by authority
    for kids in children.values():
        kids.sort(key=lambda n: -g.metrics[n]['authority_score'])

    unreached = len(g.metrics) - len(parent)
    extras = {'unreached': unreached if not focus else 0}
    return root, children, {}, extras


def _authority_hierarchy(g, focus):
    """Authority-flow hierarchy: each page hangs off the source passing it
    the most authority. Returns (root, children, edge_meta, extras)."""
    root = _resolve_root(g, focus)

    # Strongest incoming flow per target
    best_parent = {}   # target -> (flow, source)
    for e in g.edges:
        s, t = e['source'], e['target']
        if t == root:
            continue
        fl = g.flow(s, t, e['weight'])
        if fl > best_parent.get(t, (0.0, None))[0]:
            best_parent[t] = (fl, s)

    children = {}
    edge_meta = {}     # (parent, child) -> {'flow': x}
    for t, (fl, s) in best_parent.items():
        children.setdefault(s, []).append(t)
        edge_meta[(s, t)] = {'flow': round(fl, 2)}

    for parent_norm, kids in children.items():
        kids.sort(key=lambda n: -edge_meta[(parent_norm, n)]['flow'])

    # Pages whose strongest-source chain never reaches the root would
    # silently vanish; count them so the tree is honest about coverage.
    reachable = {root}
    stack = [root]
    while stack:
        u = stack.pop()
        for v in children.get(u, ()):
            if v not in reachable:
                reachable.add(v)
                stack.append(v)
    unreached = len(g.metrics) - len(reachable) if not focus else 0

    return root, children, edge_meta, {
        'unreached': unreached,
        'unreached_label': 'pages receive their authority from elsewhere'}


def _emit_tree(g, root, children, edge_meta, extras, max_depth, child_cap, focused):
    """Emit a capped tree from a hierarchy: BFS with per-node child caps,
    depth limit, and '+N more' groups that re-root on click."""
    nodes, edges = [], []

    def tree_edge(src, dst, meta=None):
        data = {'id': f'e:{src}->{dst}', 'source': src, 'target': dst}
        if meta:
            data.update(meta)
        else:
            data['width'] = 1
        edges.append({'data': data})

    def emit_node(n, depth, is_root=False):
        node = g.page_node(n)
        node['data']['tree_depth'] = depth
        node['data']['child_count'] = len(children.get(n, ()))
        if is_root:
            node['data']['is_root'] = True
        nodes.append(node)

    def more_group(parent_norm, count, depth, label=None):
        group_id = f'more:{parent_norm}'
        nodes.append({'data': {
            'id': group_id, 'type': 'group',
            'label': label or f'+{count} more',
            'count': count, 'reroot_url': g.metrics[parent_norm]['url'],
            'tree_depth': depth, 'size': PAGE_SIZE_MIN + 8}})
        tree_edge(parent_norm, group_id)

    emit_node(root, 0, is_root=True)
    queue = [(root, 0)]
    qi = 0
    while qi < len(queue) and len(nodes) < MAX_NODES:
        u, depth = queue[qi]
        qi += 1
        kids = children.get(u, [])
        if not kids:
            continue

        # Depth limit: deeper levels collapse into a re-rootable group
        if depth >= max_depth:
            more_group(u, len(kids), depth + 1, label=f'+{len(kids)} deeper')
            continue

        cap = FOCUS_ROOT_CHILD_CAP if (focused and u == root) else child_cap
        room = MAX_NODES - len(nodes)
        shown = kids[:min(cap, room)]
        hidden = len(kids) - len(shown)

        for v in shown:
            emit_node(v, depth + 1)
            tree_edge(u, v, edge_meta.get((u, v)))
            queue.append((v, depth + 1))

        if hidden > 0:
            more_group(u, hidden, depth + 1)

    if extras.get('unreached'):
        label = extras.get('unreached_label', 'pages not linked from root')
        nodes.append({'data': {
            'id': 'unlinked', 'type': 'group',
            'label': f"{extras['unreached']} {label}",
            'count': extras['unreached'], 'tree_depth': 1, 'size': PAGE_SIZE_MIN + 8}})
        tree_edge(root, 'unlinked')

    return nodes, edges
