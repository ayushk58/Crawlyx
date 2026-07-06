"""Semantic-style content similarity from crawl data (no external AI).

Mirrors Screaming Frog's 'Semantically Similar' and 'Low Relevance Content'
analysis, but uses TF-IDF cosine similarity over the text the crawler
already extracts (title, meta description, H1, H2, H3) instead of LLM
embeddings:

- per page: closest similar page + similarity score (0-1)
- similarity clusters: connected components above a threshold, graded A-F
  by duplication risk (higher similarity + more pages = worse grade)
- low relevance: pages far from the site's content centroid
"""
import math
import re
from collections import Counter

from src.analysis.url_normalizer import normalize_url

SIMILARITY_THRESHOLD = 0.80   # pages >= this are 'similar' (TF-IDF is stricter than embeddings)
LOW_RELEVANCE_THRESHOLD = 0.15  # centroid similarity below this = off-topic candidate
MAX_PAGES = 2000              # pairwise cap; beyond this only same-cluster pages compared

_TOKEN_RE = re.compile(r'[a-z0-9]+')

STOPWORDS = frozenset((
    'the a an and or but of to in for on with at by from as is are was were be been '
    'this that these those it its your our their his her you we they i he she '
    'what which who how why when where all any can will just not no do does did '
    'has have had more most other some such only own same so than too very s t '
    'if then else out up down over under again once here there').split())


def _tokenize(text):
    return [t for t in _TOKEN_RE.findall(text.lower()) if t not in STOPWORDS and len(t) > 1]


def _page_text(page):
    """Concatenate the content signals we store for a page"""
    parts = [
        page.get('title', ''), page.get('meta_description', ''), page.get('h1', ''),
        ' '.join(page.get('h2', []) or []), ' '.join(page.get('h3', []) or []),
    ]
    return ' '.join(p for p in parts if p)


def _tfidf_vectors(docs):
    """docs: list of token lists -> list of {term: weight} L2-normalized"""
    n = len(docs)
    df = Counter()
    for tokens in docs:
        df.update(set(tokens))

    vectors = []
    for tokens in docs:
        tf = Counter(tokens)
        vec = {}
        for term, count in tf.items():
            idf = math.log((1 + n) / (1 + df[term])) + 1
            vec[term] = (1 + math.log(count)) * idf
        norm = math.sqrt(sum(w * w for w in vec.values())) or 1.0
        vectors.append({t: w / norm for t, w in vec.items()})
    return vectors


def _cosine(a, b):
    if len(b) < len(a):
        a, b = b, a
    return sum(w * b.get(t, 0.0) for t, w in a.items())


def _grade(avg_similarity, size):
    """Duplication-risk grade for a similarity cluster.

    F = near-duplicates at scale, A = mild overlap between a couple of pages.
    """
    score = avg_similarity + min(size, 20) / 100  # size worsens the grade slightly
    if score >= 0.97:
        return 'F'
    if score >= 0.92:
        return 'D'
    if score >= 0.87:
        return 'C'
    if score >= 0.83:
        return 'B'
    return 'A'


def analyze_content_similarity(pages, threshold=SIMILARITY_THRESHOLD):
    """Analyze content similarity across crawled pages.

    Args:
        pages: crawl results (only internal, 200, HTML-ish pages with text are used)
        threshold: cosine similarity at/above which two pages count as similar

    Returns:
        {
          'pages': [{url, closest_url, similarity, relevance_score, is_low_relevance}],
          'clusters': [{cluster_id, grade, avg_similarity, size, urls}],
          'low_relevance_pages': [...subset of pages...],
          'analyzed_count': int, 'skipped_count': int
        }
    """
    candidates = []
    for p in pages:
        if not p.get('is_internal', True) or p.get('status_code') != 200:
            continue
        tokens = _tokenize(_page_text(p))
        if len(tokens) < 3:
            continue
        candidates.append((p, tokens))

    skipped = len(pages) - len(candidates)
    candidates = candidates[:MAX_PAGES]
    n = len(candidates)
    if n < 2:
        return {'pages': [], 'clusters': [], 'low_relevance_pages': [],
                'analyzed_count': n, 'skipped_count': skipped}

    vectors = _tfidf_vectors([tokens for _, tokens in candidates])

    # Site centroid for relevance scoring
    centroid = Counter()
    for vec in vectors:
        centroid.update(vec)
    centroid = {t: w / n for t, w in centroid.items()}
    c_norm = math.sqrt(sum(w * w for w in centroid.values())) or 1.0
    centroid = {t: w / c_norm for t, w in centroid.items()}

    # Pairwise similarity: closest neighbor per page + edges above threshold
    best = [(0.0, None)] * n
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    pair_sims = {}
    for i in range(n):
        for j in range(i + 1, n):
            sim = _cosine(vectors[i], vectors[j])
            if sim > best[i][0]:
                best[i] = (sim, j)
            if sim > best[j][0]:
                best[j] = (sim, i)
            if sim >= threshold:
                union(i, j)
                pair_sims[(i, j)] = sim

    # Per-page rows
    page_rows = []
    relevance = []
    for i, (p, _) in enumerate(candidates):
        rel = _cosine(vectors[i], centroid)
        relevance.append(rel)
        sim, j = best[i]
        page_rows.append({
            'url': p.get('url', ''),
            'closest_url': candidates[j][0].get('url', '') if j is not None else None,
            'similarity': round(sim, 3),
            'relevance_score': round(rel, 3),
            'is_low_relevance': rel < LOW_RELEVANCE_THRESHOLD,
        })

    # Clusters from components (size >= 2)
    components = {}
    for i in range(n):
        components.setdefault(find(i), []).append(i)

    clusters = []
    for root, members in components.items():
        if len(members) < 2:
            continue
        member_set = set(members)
        sims = [s for (i, j), s in pair_sims.items() if i in member_set and j in member_set]
        avg_sim = sum(sims) / len(sims) if sims else threshold
        urls = [candidates[i][0].get('url', '') for i in members]
        clusters.append({
            'cluster_id': f'sim-{len(clusters)}',
            'grade': _grade(avg_sim, len(members)),
            'avg_similarity': round(avg_sim, 3),
            'size': len(members),
            'urls': urls,
        })

    grade_order = {'F': 0, 'D': 1, 'C': 2, 'B': 3, 'A': 4}
    clusters.sort(key=lambda c: (grade_order[c['grade']], -c['size']))

    return {
        'pages': page_rows,
        'clusters': clusters,
        'low_relevance_pages': [r for r in page_rows if r['is_low_relevance']],
        'analyzed_count': n,
        'skipped_count': skipped,
    }
