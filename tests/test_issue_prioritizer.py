import unittest

from src.analysis.issue_prioritizer import group_issues


def make_issue(url, name='Missing Title Tag', issue_type='error', category='SEO'):
    return {'url': url, 'type': issue_type, 'category': category,
            'issue': name, 'details': 'x'}


def make_page(url, depth=2, robots=''):
    return {'url': url, 'depth': depth, 'robots': robots}


class TestGrouping(unittest.TestCase):
    def test_groups_by_issue_name(self):
        issues = [
            make_issue('https://a.com/1'),
            make_issue('https://a.com/2'),
            make_issue('https://a.com/1', name='Missing H1 Tag'),
        ]
        groups = group_issues(issues)
        names = {g['issue'] for g in groups}
        self.assertEqual(names, {'Missing Title Tag', 'Missing H1 Tag'})
        title_group = next(g for g in groups if g['issue'] == 'Missing Title Tag')
        self.assertEqual(title_group['affected_url_count'], 2)

    def test_duplicate_urls_counted_once(self):
        issues = [make_issue('https://a.com/1'), make_issue('https://a.com/1')]
        groups = group_issues(issues)
        self.assertEqual(groups[0]['affected_url_count'], 1)

    def test_example_urls_limited_to_five(self):
        issues = [make_issue(f'https://a.com/p{i}') for i in range(10)]
        groups = group_issues(issues)
        self.assertEqual(len(groups[0]['example_urls']), 5)

    def test_recommended_fix_known_issue(self):
        groups = group_issues([make_issue('https://a.com/1')])
        self.assertIn('title', groups[0]['recommended_fix'].lower())

    def test_recommended_fix_fallback_by_category(self):
        groups = group_issues([make_issue('https://a.com/1', name='Something Odd', category='Technical')])
        self.assertTrue(groups[0]['recommended_fix'])


class TestTemplateDetection(unittest.TestCase):
    def test_template_level_when_urls_share_section(self):
        issues = [make_issue(f'https://a.com/blog/post-{i}') for i in range(6)]
        groups = group_issues(issues)
        g = groups[0]
        self.assertTrue(g['is_template_level'])
        self.assertEqual(g['top_section'], '/blog/')
        self.assertIn('/blog/', g['likely_cause'])

    def test_not_template_level_when_urls_scattered(self):
        issues = [make_issue(f'https://a.com/section{i}/page') for i in range(6)]
        groups = group_issues(issues)
        self.assertFalse(groups[0]['is_template_level'])

    def test_sitewide_detection(self):
        pages = [make_page(f'https://a.com/p{i}') for i in range(10)]
        issues = [make_issue(f'https://a.com/p{i}') for i in range(9)]
        groups = group_issues(issues, pages)
        self.assertTrue(groups[0]['is_sitewide'])


class TestPriorityScore(unittest.TestCase):
    def test_widespread_error_scores_higher_than_single_warning(self):
        pages = [make_page(f'https://a.com/p{i}') for i in range(100)]
        widespread = [make_issue(f'https://a.com/p{i}') for i in range(80)]
        single = [make_issue('https://a.com/p1', name='Thin Content', issue_type='warning', category='Content')]
        groups = group_issues(widespread + single, pages)
        self.assertEqual(groups[0]['issue'], 'Missing Title Tag')
        self.assertGreater(groups[0]['priority_score'], groups[-1]['priority_score'])

    def test_homepage_boost(self):
        pages = [make_page('https://a.com/'), make_page('https://a.com/deep', depth=5)]
        home = group_issues([make_issue('https://a.com/')], pages)[0]
        deep = group_issues([make_issue('https://a.com/deep')], pages)[0]
        self.assertGreater(home['priority_score'], deep['priority_score'])
        self.assertTrue(home['homepage_affected'])

    def test_noindex_only_pages_score_lower(self):
        pages_indexable = [make_page('https://a.com/x', depth=3)]
        pages_noindex = [make_page('https://a.com/x', depth=3, robots='noindex')]
        indexable = group_issues([make_issue('https://a.com/x')], pages_indexable)[0]
        noindexed = group_issues([make_issue('https://a.com/x')], pages_noindex)[0]
        self.assertGreater(indexable['priority_score'], noindexed['priority_score'])

    def test_sorted_by_priority_desc(self):
        pages = [make_page(f'https://a.com/p{i}') for i in range(50)]
        issues = ([make_issue(f'https://a.com/p{i}') for i in range(40)] +
                  [make_issue('https://a.com/p1', name='Thin Content', issue_type='warning', category='Content')])
        groups = group_issues(issues, pages)
        scores = [g['priority_score'] for g in groups]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_severity_labels(self):
        for g in group_issues([make_issue('https://a.com/1')]):
            self.assertIn(g['severity'], ('critical', 'high', 'medium', 'low'))


if __name__ == '__main__':
    unittest.main()
