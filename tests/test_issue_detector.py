"""Tests for post-crawl issue detection: redirect chains/loops,
duplicate title/meta/H1 grouping, and sitemap-vs-crawl reconciliation."""
import unittest

from src.core.issue_detector import IssueDetector


def make_result(url, status_code=200, **overrides):
    result = {
        'url': url,
        'status_code': status_code,
        'is_internal': True,
        'content_type': 'text/html',
        'title': '',
        'meta_description': '',
        'h1': '',
        'redirects': [],
    }
    result.update(overrides)
    return result


class TestRedirectIssues(unittest.TestCase):
    def setUp(self):
        self.detector = IssueDetector()

    def issues_named(self, name):
        return [i for i in self.detector.get_issues() if i['issue'] == name]

    def test_no_redirects_no_issues(self):
        self.detector.detect_redirect_issues([make_result('https://a.com/')])
        self.assertEqual(self.detector.get_issues(), [])

    def test_single_hop_not_flagged_as_chain(self):
        result = make_result(
            'https://a.com/old',
            redirects=[{'url': 'https://a.com/old', 'status_code': 301}],
        )
        self.detector.detect_redirect_issues([result])
        self.assertEqual(self.issues_named('Redirect Chain'), [])

    def test_chain_of_two_hops_flagged(self):
        result = make_result(
            'https://a.com/old',
            redirects=[
                {'url': 'https://a.com/old', 'status_code': 301},
                {'url': 'https://a.com/mid', 'status_code': 302},
            ],
        )
        self.detector.detect_redirect_issues([result])
        chains = self.issues_named('Redirect Chain')
        self.assertEqual(len(chains), 1)
        self.assertEqual(chains[0]['type'], 'warning')
        self.assertIn('2 hops', chains[0]['details'])
        self.assertIn('https://a.com/mid', chains[0]['details'])

    def test_loop_flagged_as_error(self):
        result = make_result(
            'https://a.com/x',
            status_code=301,
            redirects=[
                {'url': 'https://a.com/x', 'status_code': 301},
                {'url': 'https://a.com/y', 'status_code': 301},
                {'url': 'https://a.com/x', 'status_code': 301},
            ],
        )
        self.detector.detect_redirect_issues([result])
        loops = self.issues_named('Redirect Loop')
        self.assertEqual(len(loops), 1)
        self.assertEqual(loops[0]['type'], 'error')
        # A loop should not also be reported as a plain chain
        self.assertEqual(self.issues_named('Redirect Chain'), [])

    def test_loop_detected_from_error_type(self):
        result = make_result(
            'https://a.com/x', status_code=0,
            error='Exceeded 30 redirects', error_type='too_many_redirects',
        )
        self.detector.detect_redirect_issues([result])
        self.assertEqual(len(self.issues_named('Redirect Loop')), 1)

    def test_redirect_to_error_page(self):
        result = make_result(
            'https://a.com/old', status_code=404,
            redirects=[{'url': 'https://a.com/old', 'status_code': 301}],
        )
        self.detector.detect_redirect_issues([result])
        errors = self.issues_named('Redirect to Error Page')
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]['type'], 'error')
        self.assertIn('404', errors[0]['details'])

    def test_excluded_urls_skipped(self):
        detector = IssueDetector(['/wp-admin/*'])
        result = make_result(
            'https://a.com/wp-admin/old',
            redirects=[
                {'url': 'https://a.com/wp-admin/old', 'status_code': 301},
                {'url': 'https://a.com/wp-admin/mid', 'status_code': 301},
            ],
        )
        detector.detect_redirect_issues([result])
        self.assertEqual(detector.get_issues(), [])


class TestDuplicateGroupIssues(unittest.TestCase):
    def setUp(self):
        self.detector = IssueDetector()

    def issues_named(self, name):
        return [i for i in self.detector.get_issues() if i['issue'] == name]

    def test_no_duplicates(self):
        results = [
            make_result('https://a.com/1', title='Alpha', meta_description='da', h1='ha'),
            make_result('https://a.com/2', title='Beta', meta_description='db', h1='hb'),
        ]
        self.detector.detect_duplicate_group_issues(results)
        self.assertEqual(self.detector.get_issues(), [])

    def test_duplicate_titles_grouped(self):
        results = [
            make_result('https://a.com/1', title='Same Title'),
            make_result('https://a.com/2', title='Same Title'),
            make_result('https://a.com/3', title='same title  '),  # case/space-insensitive
            make_result('https://a.com/4', title='Unique'),
        ]
        self.detector.detect_duplicate_group_issues(results)
        dupes = self.issues_named('Duplicate Title')
        self.assertEqual(len(dupes), 3)
        self.assertEqual({i['url'] for i in dupes},
                         {'https://a.com/1', 'https://a.com/2', 'https://a.com/3'})
        self.assertIn('3 pages', dupes[0]['details'])

    def test_duplicate_meta_and_h1(self):
        results = [
            make_result('https://a.com/1', meta_description='Same desc', h1='Same H1'),
            make_result('https://a.com/2', meta_description='Same desc', h1='Same H1'),
        ]
        self.detector.detect_duplicate_group_issues(results)
        self.assertEqual(len(self.issues_named('Duplicate Meta Description')), 2)
        self.assertEqual(len(self.issues_named('Duplicate H1')), 2)

    def test_empty_values_not_grouped(self):
        results = [
            make_result('https://a.com/1'),
            make_result('https://a.com/2'),
        ]
        self.detector.detect_duplicate_group_issues(results)
        self.assertEqual(self.detector.get_issues(), [])

    def test_redirected_urls_not_grouped(self):
        # /old serves /final's content after a redirect - not a distinct page
        results = [
            make_result('https://a.com/final', title='Same'),
            make_result('https://a.com/old', title='Same',
                        redirects=[{'url': 'https://a.com/old', 'status_code': 301}]),
        ]
        self.detector.detect_duplicate_group_issues(results)
        self.assertEqual(self.issues_named('Duplicate Title'), [])

    def test_non_200_and_external_skipped(self):
        results = [
            make_result('https://a.com/1', title='Same'),
            make_result('https://a.com/2', title='Same', status_code=404),
            make_result('https://b.com/3', title='Same', is_internal=False),
        ]
        self.detector.detect_duplicate_group_issues(results)
        self.assertEqual(self.issues_named('Duplicate Title'), [])

    def test_scales_linearly_to_10k(self):
        import time
        results = [
            make_result(f'https://a.com/p{i}',
                        title=f'Title {i % 500}',
                        meta_description=f'Desc {i % 500}',
                        h1=f'H1 {i % 500}')
            for i in range(10000)
        ]
        start = time.time()
        self.detector.detect_duplicate_group_issues(results)
        elapsed = time.time() - start
        self.assertLess(elapsed, 5.0)
        self.assertEqual(len(self.issues_named('Duplicate Title')), 10000)


class TestSitemapReconciliation(unittest.TestCase):
    def setUp(self):
        self.detector = IssueDetector()

    def issues_named(self, name):
        return [i for i in self.detector.get_issues() if i['issue'] == name]

    def test_no_sitemap_no_issues(self):
        self.detector.detect_sitemap_issues(set(), [make_result('https://a.com/')])
        self.assertEqual(self.detector.get_issues(), [])

    def test_in_sitemap_not_crawled(self):
        sitemap = {'https://a.com/', 'https://a.com/missing'}
        results = [make_result('https://a.com/')]
        self.detector.detect_sitemap_issues(sitemap, results)
        missing = self.issues_named('In Sitemap, Not Crawled')
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]['url'], 'https://a.com/missing')

    def test_in_sitemap_error_status(self):
        sitemap = {'https://a.com/gone'}
        results = [make_result('https://a.com/gone', status_code=404)]
        self.detector.detect_sitemap_issues(sitemap, results)
        errors = self.issues_named('Sitemap URL Not Indexable')
        self.assertEqual(len(errors), 1)
        self.assertIn('404', errors[0]['details'])

    def test_crawled_not_in_sitemap(self):
        sitemap = {'https://a.com/'}
        results = [
            make_result('https://a.com/'),
            make_result('https://a.com/orphaned-from-sitemap'),
        ]
        self.detector.detect_sitemap_issues(sitemap, results)
        missing = self.issues_named('Crawled, Not in Sitemap')
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0]['url'], 'https://a.com/orphaned-from-sitemap')

    def test_url_normalization_prevents_false_positives(self):
        # Trailing slash / fragment differences should not create mismatches
        sitemap = {'https://a.com/page#frag'}
        results = [make_result('https://a.com/page')]
        self.detector.detect_sitemap_issues(sitemap, results)
        self.assertEqual(self.issues_named('In Sitemap, Not Crawled'), [])
        self.assertEqual(self.issues_named('Crawled, Not in Sitemap'), [])

    def test_external_and_non_html_not_flagged_as_missing_from_sitemap(self):
        sitemap = {'https://a.com/'}
        results = [
            make_result('https://a.com/'),
            make_result('https://b.com/x', is_internal=False),
            make_result('https://a.com/img.png', content_type='image/png'),
            make_result('https://a.com/404', status_code=404),
            make_result('https://a.com/old',
                        redirects=[{'url': 'https://a.com/old', 'status_code': 301}]),
        ]
        self.detector.detect_sitemap_issues(sitemap, results)
        self.assertEqual(self.issues_named('Crawled, Not in Sitemap'), [])


class TestFuzzyDuplicationCap(unittest.TestCase):
    def test_pairwise_duplication_skipped_beyond_cap(self):
        detector = IssueDetector()
        results = [
            make_result(f'https://a.com/p{i}', title='Same page title here',
                        meta_description='Same description text for everyone',
                        h1='Same H1', word_count=500)
            for i in range(30)
        ]
        detector.detect_duplication_issues(results, max_pages=10)
        self.assertEqual(detector.get_issues(), [])

    def test_pairwise_duplication_runs_under_cap(self):
        detector = IssueDetector()
        results = [
            make_result(f'https://a.com/p{i}', title='Same page title here',
                        meta_description='Same description text for everyone',
                        h1='Same H1', word_count=500)
            for i in range(3)
        ]
        detector.detect_duplication_issues(results, max_pages=10)
        self.assertTrue(any(i['issue'] == 'Duplicate Content Detected'
                            for i in detector.get_issues()))


if __name__ == '__main__':
    unittest.main()
