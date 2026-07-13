"""Benchmark post-crawl analysis paths at 10,000 URLs.

Run: python tests/benchmark_10k.py
Not part of the unit test suite; verifies the 10k-URL performance target.
"""
import random
import time
import sys

sys.path.insert(0, '.')

from src.core.issue_detector import IssueDetector
from src.core.link_manager import LinkManager

N = 10000


def build_results():
    results = []
    for i in range(N):
        url = f'https://example.com/page-{i}'
        result = {
            'url': url,
            'status_code': 200 if i % 20 else 404,
            'is_internal': True,
            'content_type': 'text/html',
            'title': f'Title {i % 2000}',            # ~5 pages per duplicate group
            'meta_description': f'Description {i % 2000}',
            'h1': f'Heading {i % 2000}',
            'redirects': [],
            'final_url': '',
        }
        if i % 10 == 0:  # 10% redirect chains
            result['redirects'] = [
                {'url': f'https://example.com/old-{i}', 'status_code': 301},
                {'url': f'https://example.com/mid-{i}', 'status_code': 302},
            ]
            result['final_url'] = url
        results.append(result)
    return results


def bench(label, fn):
    start = time.time()
    fn()
    print(f'{label}: {time.time() - start:.2f}s')


def main():
    results = build_results()
    detector = IssueDetector()

    bench('redirect chain/loop detection (10k)',
          lambda: detector.detect_redirect_issues(results))
    bench('duplicate title/meta/H1 grouping (10k)',
          lambda: detector.detect_duplicate_group_issues(results))

    sitemap = {f'https://example.com/page-{i}' for i in range(0, N, 2)} | \
              {f'https://example.com/only-in-sitemap-{i}' for i in range(500)}
    bench('sitemap reconciliation (10k crawled, 5.5k sitemap)',
          lambda: detector.detect_sitemap_issues(sitemap, results))

    bench('fuzzy duplication (capped, should skip instantly)',
          lambda: detector.detect_duplication_issues(results))

    # Link status resolution: 200k links, statuses recorded as pages complete
    lm = LinkManager('example.com')
    def link_bench():
        rng = random.Random(42)
        for i in range(200000):
            target = f'https://example.com/page-{rng.randrange(N)}'
            link = {'source_url': f'https://example.com/page-{i % N}',
                    'target_url': target, 'target_status': lm.url_status.get(target)}
            lm.all_links.append(link)
            lm.links_by_target.setdefault(target, []).append(link)
            if i % 20 == 0:
                lm.record_status(f'https://example.com/page-{i % N}', 200)
    bench('link status resolution (200k links, incremental)', link_bench)

    unresolved = sum(1 for l in lm.all_links if l['target_status'] is None)
    print(f'  links with unresolved status (targets never "crawled"): {unresolved}')

    print(f'\ntotal issues generated: {len(detector.get_issues())}')


if __name__ == '__main__':
    main()
