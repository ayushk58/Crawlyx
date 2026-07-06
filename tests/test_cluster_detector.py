import unittest

from src.analysis.cluster_detector import detect_clusters
from src.analysis.link_graph_analyzer import analyze_link_graph


def page(url, status=200, depth=1):
    return {'url': url, 'status_code': status, 'depth': depth, 'is_internal': True}


def link(source, target, placement='body', status=200):
    return {'source_url': source, 'target_url': target, 'placement': placement,
            'target_status': status, 'is_internal': True}


class TestClusters(unittest.TestCase):
    def test_groups_by_first_path_segment(self):
        pages = [page('https://a.com/'), page('https://a.com/blog/x'),
                 page('https://a.com/blog/y'), page('https://a.com/shop/z')]
        clusters = detect_clusters(pages)
        by_id = {c['cluster_id']: c for c in clusters}
        self.assertEqual(by_id['/blog/']['size'], 2)
        self.assertEqual(by_id['/shop/']['size'], 1)
        self.assertEqual(by_id['/']['size'], 1)

    def test_sorted_by_size(self):
        pages = [page(f'https://a.com/blog/{i}') for i in range(3)] + [page('https://a.com/shop/x')]
        clusters = detect_clusters(pages)
        self.assertEqual(clusters[0]['cluster_id'], '/blog/')

    def test_root_pages_named(self):
        clusters = detect_clusters([page('https://a.com/about')])
        self.assertEqual(clusters[0]['name'], 'Root pages')

    def test_external_pages_excluded(self):
        pages = [page('https://a.com/blog/x'),
                 {'url': 'https://other.com/y', 'is_internal': False, 'status_code': 200, 'depth': 1}]
        clusters = detect_clusters(pages)
        self.assertEqual(sum(c['size'] for c in clusters), 1)

    def test_with_metrics_top_page_and_weak_pages(self):
        pages = [page('https://a.com/', depth=0), page('https://a.com/blog/hub'),
                 page('https://a.com/blog/a'), page('https://a.com/blog/b')]
        links = [link('https://a.com/', 'https://a.com/blog/hub'),
                 link('https://a.com/blog/a', 'https://a.com/blog/hub'),
                 link('https://a.com/blog/b', 'https://a.com/blog/hub')]
        graph = analyze_link_graph(pages, links)
        clusters = detect_clusters(pages, links, graph['pages'])
        blog = next(c for c in clusters if c['cluster_id'] == '/blog/')
        self.assertEqual(blog['top_authority_page']['url'], 'https://a.com/blog/hub')
        self.assertIsNotNone(blog['avg_authority'])

    def test_cross_cluster_share(self):
        pages = [page('https://a.com/blog/a'), page('https://a.com/blog/b'),
                 page('https://a.com/shop/x')]
        links = [link('https://a.com/blog/a', 'https://a.com/blog/b'),
                 link('https://a.com/blog/a', 'https://a.com/shop/x')]
        clusters = detect_clusters(pages, links)
        blog = next(c for c in clusters if c['cluster_id'] == '/blog/')
        self.assertEqual(blog['cross_cluster_link_share'], 0.5)

    def test_empty(self):
        self.assertEqual(detect_clusters([]), [])


if __name__ == '__main__':
    unittest.main()
