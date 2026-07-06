import unittest

from src.analysis.link_graph_analyzer import analyze_link_graph


def page(url, status=200, depth=1, internal=True):
    return {'url': url, 'status_code': status, 'depth': depth, 'is_internal': internal}


def link(source, target, placement='body', status=200, internal=True, anchor='x'):
    return {'source_url': source, 'target_url': target, 'placement': placement,
            'target_status': status, 'is_internal': internal, 'anchor_text': anchor}


HOME = 'https://a.com/'
P1 = 'https://a.com/p1'
P2 = 'https://a.com/p2'
P3 = 'https://a.com/p3'


class TestMetrics(unittest.TestCase):
    def test_inlink_outlink_counts(self):
        pages = [page(HOME, depth=0), page(P1), page(P2)]
        links = [link(HOME, P1), link(HOME, P2), link(P1, P2)]
        result = analyze_link_graph(pages, links)
        m = result['pages']
        self.assertEqual(m[HOME]['outlinks'], 2)
        self.assertEqual(m[P2]['inlinks'], 2)
        self.assertEqual(m[P2]['body_inlinks'], 2)

    def test_placement_counts(self):
        pages = [page(HOME, depth=0), page(P1)]
        links = [link(HOME, P1, placement='navigation'), link(P1, HOME, placement='footer')]
        result = analyze_link_graph(pages, links)
        self.assertEqual(result['pages'][P1]['nav_inlinks'], 1)
        self.assertEqual(result['pages'][HOME]['footer_inlinks'], 1)

    def test_external_links_ignored(self):
        pages = [page(HOME, depth=0)]
        links = [link(HOME, 'https://other.com/x', internal=False)]
        result = analyze_link_graph(pages, links)
        self.assertEqual(result['pages'][HOME]['outlinks'], 0)

    def test_url_variants_join(self):
        # Trailing-slash and www variants should resolve to the same page;
        # metrics are keyed by normalized URL
        pages = [page(HOME, depth=0), page('https://a.com/p1/')]
        links = [link(HOME, 'https://www.a.com/p1')]
        result = analyze_link_graph(pages, links)
        self.assertEqual(result['pages'][P1]['inlinks'], 1)
        self.assertEqual(result['pages'][P1]['url'], 'https://a.com/p1/')


class TestAuthority(unittest.TestCase):
    def test_more_linked_page_has_higher_authority(self):
        pages = [page(HOME, depth=0), page(P1), page(P2), page(P3)]
        links = [link(HOME, P1), link(P2, P1), link(P3, P1), link(P1, P2)]
        m = analyze_link_graph(pages, links)['pages']
        self.assertGreater(m[P1]['authority_score'], m[P3]['authority_score'])

    def test_body_link_passes_more_than_footer(self):
        pages = [page(HOME, depth=0), page(P1), page(P2)]
        links = [link(HOME, P1, placement='body'), link(HOME, P2, placement='footer')]
        m = analyze_link_graph(pages, links)['pages']
        self.assertGreater(m[P1]['authority_score'], m[P2]['authority_score'])

    def test_links_to_non_200_pass_nothing(self):
        pages = [page(HOME, depth=0), page(P1, status=404), page(P2)]
        links = [link(HOME, P1, status=404), link(HOME, P2)]
        m = analyze_link_graph(pages, links)['pages']
        self.assertGreater(m[P2]['authority_score'], m[P1]['authority_score'])

    def test_scores_bounded_0_100(self):
        pages = [page(HOME, depth=0), page(P1), page(P2)]
        links = [link(HOME, P1), link(P1, P2), link(P2, HOME)]
        m = analyze_link_graph(pages, links)['pages']
        for metrics in m.values():
            self.assertGreaterEqual(metrics['authority_score'], 0)
            self.assertLessEqual(metrics['authority_score'], 100)
        self.assertEqual(max(x['authority_score'] for x in m.values()), 100.0)

    def test_empty_graph(self):
        result = analyze_link_graph([], [])
        self.assertEqual(result['pages'], {})


class TestFlagsAndReports(unittest.TestCase):
    def test_orphan_detection(self):
        pages = [page(HOME, depth=0), page(P1), page(P2, depth=3)]
        links = [link(HOME, P1)]  # P2 crawled (e.g. via sitemap) but never linked
        result = analyze_link_graph(pages, links)
        self.assertTrue(result['pages'][P2]['is_orphan'])
        orphan_urls = [m['url'] for m in result['reports']['orphan_pages']]
        self.assertEqual(orphan_urls, [P2])

    def test_homepage_not_orphan(self):
        pages = [page(HOME, depth=0)]
        result = analyze_link_graph(pages, [])
        self.assertFalse(result['pages'][HOME]['is_orphan'])

    def test_near_orphan(self):
        pages = [page(HOME, depth=0), page(P1), page(P2)]
        links = [link(HOME, P1), link(HOME, P2), link(P1, P2)]
        result = analyze_link_graph(pages, links)
        self.assertTrue(result['pages'][P1]['is_near_orphan'])
        self.assertFalse(result['pages'][P2]['is_near_orphan'])

    def test_broken_and_redirected_links_reported(self):
        pages = [page(HOME, depth=0), page(P1, status=404), page(P2, status=301)]
        links = [link(HOME, P1, status=404), link(HOME, P2, status=301)]
        reports = analyze_link_graph(pages, links)['reports']
        self.assertEqual(len(reports['broken_internal_links']), 1)
        self.assertEqual(reports['broken_internal_links'][0]['target_url'], P1)
        self.assertEqual(len(reports['redirected_internal_links']), 1)

    def test_highest_authority_sorted(self):
        pages = [page(HOME, depth=0), page(P1), page(P2)]
        links = [link(HOME, P1), link(P2, P1)]
        top = analyze_link_graph(pages, links)['reports']['highest_authority']
        scores = [m['authority_score'] for m in top]
        self.assertEqual(scores, sorted(scores, reverse=True))


if __name__ == '__main__':
    unittest.main()
