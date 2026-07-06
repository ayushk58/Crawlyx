import unittest

from src.analysis.crawl_summarizer import summarize_crawl
from src.analysis.report_builder import build_html_report


def page(url, status=200, depth=1):
    return {'url': url, 'status_code': status, 'depth': depth,
            'is_internal': True, 'robots': ''}


def link(source, target, placement='body', status=200):
    return {'source_url': source, 'target_url': target, 'placement': placement,
            'target_status': status, 'is_internal': True, 'anchor_text': 'x'}


def issue(url, name='Missing Title Tag', issue_type='error', category='SEO'):
    return {'url': url, 'type': issue_type, 'category': category,
            'issue': name, 'details': 'd'}


PAGES = [
    page('https://a.com/', depth=0),
    page('https://a.com/blog/x'),
    page('https://a.com/blog/y'),
    page('https://a.com/dead', status=404, depth=2),
]
LINKS = [
    link('https://a.com/', 'https://a.com/blog/x'),
    link('https://a.com/blog/x', 'https://a.com/blog/y'),
    link('https://a.com/', 'https://a.com/dead', status=404),
]
ISSUES = [
    issue('https://a.com/blog/x'),
    issue('https://a.com/blog/y'),
    issue('https://a.com/dead', name='404 Client Error', category='Technical'),
]


class TestSummarizer(unittest.TestCase):
    def setUp(self):
        self.summary = summarize_crawl(PAGES, LINKS, ISSUES, {'sitemap_found': True})

    def test_counts(self):
        self.assertEqual(self.summary['total_pages'], 4)
        self.assertEqual(self.summary['total_issues'], 3)
        self.assertEqual(self.summary['status_breakdown']['2xx'], 3)
        self.assertEqual(self.summary['status_breakdown']['4xx'], 1)

    def test_site_score_in_range(self):
        self.assertGreaterEqual(self.summary['site_score'], 0)
        self.assertLessEqual(self.summary['site_score'], 100)

    def test_perfect_site_scores_100(self):
        clean = summarize_crawl([page('https://a.com/', depth=0)], [], [])
        self.assertEqual(clean['site_score'], 100)

    def test_issue_groups_present_and_sorted(self):
        groups = self.summary['issue_groups']
        self.assertEqual(len(groups), 2)
        scores = [g['priority_score'] for g in groups]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_link_reports(self):
        lr = self.summary['link_reports']
        self.assertEqual(lr['broken_internal_links_count'], 1)

    def test_clusters(self):
        names = {c['cluster_id'] for c in self.summary['clusters']}
        self.assertIn('/blog/', names)

    def test_diagnostics_passthrough(self):
        self.assertTrue(self.summary['diagnostics']['sitemap_found'])


class TestReportBuilder(unittest.TestCase):
    def test_report_contains_key_sections(self):
        summary = summarize_crawl(PAGES, LINKS, ISSUES, {'sitemap_found': True})
        report = build_html_report(summary, site_url='https://a.com')
        self.assertIn('<!DOCTYPE html>', report)
        self.assertIn('SEO Audit Report', report)
        self.assertIn('Priority Recommendations', report)
        self.assertIn('Internal Linking', report)
        self.assertIn('Content Clusters', report)
        self.assertIn('Missing Title Tag', report)

    def test_report_escapes_html(self):
        evil = [issue('https://a.com/<script>alert(1)</script>')]
        summary = summarize_crawl(PAGES, LINKS, evil)
        report = build_html_report(summary)
        self.assertNotIn('<script>alert(1)</script>', report)

    def test_report_with_empty_crawl(self):
        summary = summarize_crawl([], [], [])
        report = build_html_report(summary)
        self.assertIn('No issues detected', report)


if __name__ == '__main__':
    unittest.main()
