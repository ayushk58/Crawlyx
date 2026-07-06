import unittest

from src.analysis.content_similarity import analyze_content_similarity


def page(url, title='', meta='', h1='', h2=None, status=200):
    return {'url': url, 'status_code': status, 'is_internal': True,
            'title': title, 'meta_description': meta, 'h1': h1,
            'h2': h2 or [], 'h3': [], 'depth': 1}


def near_duplicates(n, prefix='https://a.com/dup'):
    return [page(f'{prefix}{i}',
                 title='Best email newsletter marketing guide for beginners',
                 meta='Learn email newsletter marketing strategy tips and tricks guide',
                 h1='Email newsletter marketing guide')
            for i in range(n)]


class TestSimilarity(unittest.TestCase):
    def test_near_duplicates_detected(self):
        pages = near_duplicates(3) + [
            page('https://a.com/other', title='Chocolate cake baking recipe',
                 meta='How to bake a chocolate cake at home oven flour sugar',
                 h1='Chocolate cake recipe')
        ]
        result = analyze_content_similarity(pages)
        self.assertEqual(len(result['clusters']), 1)
        cluster = result['clusters'][0]
        self.assertEqual(cluster['size'], 3)
        self.assertGreaterEqual(cluster['avg_similarity'], 0.8)
        self.assertIn(cluster['grade'], ('D', 'F'))

    def test_distinct_pages_no_cluster(self):
        pages = [
            page('https://a.com/1', title='Chocolate cake baking recipe flour sugar oven'),
            page('https://a.com/2', title='Winter hiking boots mountain trail gear'),
            page('https://a.com/3', title='Python programming tutorial functions classes'),
        ]
        result = analyze_content_similarity(pages)
        self.assertEqual(result['clusters'], [])

    def test_closest_url_populated(self):
        pages = near_duplicates(2) + [page('https://a.com/x', title='Quantum physics particles wave theory experiment')]
        result = analyze_content_similarity(pages)
        rows = {r['url']: r for r in result['pages']}
        self.assertEqual(rows['https://a.com/dup0']['closest_url'], 'https://a.com/dup1')
        self.assertGreaterEqual(rows['https://a.com/dup0']['similarity'], 0.8)

    def test_low_relevance_outlier(self):
        # 10 pages about newsletters + 1 totally off-topic page
        pages = [page(f'https://a.com/n{i}',
                      title=f'Newsletter marketing tips part {i}',
                      meta='Email newsletter marketing subscribers growth engagement',
                      h1='Newsletter marketing')
                 for i in range(10)]
        pages.append(page('https://a.com/legal',
                          title='Privacy policy terms conditions cookies GDPR legal',
                          h1='Privacy policy legal terms'))
        result = analyze_content_similarity(pages)
        low = {r['url'] for r in result['low_relevance_pages']}
        self.assertIn('https://a.com/legal', low)
        self.assertNotIn('https://a.com/n1', low)

    def test_non_200_and_textless_skipped(self):
        pages = near_duplicates(2) + [
            page('https://a.com/404', title='Best email newsletter marketing guide', status=404),
            page('https://a.com/empty'),
        ]
        result = analyze_content_similarity(pages)
        self.assertEqual(result['analyzed_count'], 2)
        self.assertEqual(result['skipped_count'], 2)

    def test_empty_and_single_page(self):
        self.assertEqual(analyze_content_similarity([])['clusters'], [])
        self.assertEqual(analyze_content_similarity(near_duplicates(1))['clusters'], [])

    def test_grades_sorted_worst_first(self):
        pages = near_duplicates(4)
        pages += [page(f'https://a.com/loose{i}',
                       title='Content marketing strategy planning ideas calendar' + (' extra unique words here' if i else ''),
                       meta='Content marketing strategy for brands planning')
                  for i in range(2)]
        result = analyze_content_similarity(pages)
        grades = [c['grade'] for c in result['clusters']]
        self.assertEqual(grades, sorted(grades, key=lambda g: 'FDCBA'.index(g)))


if __name__ == '__main__':
    unittest.main()
