import unittest

from src.analysis.graph_builder import build_graph, CRAWLTREE_CHILD_CAP, MAX_NODES


def page(url, status=200, depth=1, robots=''):
    return {'url': url, 'status_code': status, 'depth': depth,
            'is_internal': True, 'robots': robots}


def link(source, target, placement='body', status=200):
    return {'source_url': source, 'target_url': target, 'placement': placement,
            'target_status': status, 'is_internal': True, 'anchor_text': 'x'}


HOME = 'https://a.com/'


def site():
    """home -> a, b; a -> c; c also linked from home (shortest path = via home? no: home->a->c only)"""
    pages = [page(HOME, depth=0), page('https://a.com/a'), page('https://a.com/b'),
             page('https://a.com/a/c', depth=2), page('https://a.com/orphan', depth=3)]
    links = [link(HOME, 'https://a.com/a'), link(HOME, 'https://a.com/b'),
             link('https://a.com/a', 'https://a.com/a/c')]
    return pages, links


class TestCrawlTree(unittest.TestCase):
    def test_bfs_hierarchy(self):
        pages, links = site()
        result = build_graph(pages, links, mode='crawltree')
        by_id = {n['data']['id']: n['data'] for n in result['nodes']}
        self.assertTrue(by_id[HOME]['is_root'])
        self.assertEqual(by_id[HOME]['tree_depth'], 0)
        self.assertEqual(by_id['https://a.com/a']['tree_depth'], 1)
        self.assertEqual(by_id['https://a.com/a/c']['tree_depth'], 2)

    def test_edges_follow_shortest_path(self):
        pages, links = site()
        result = build_graph(pages, links, mode='crawltree')
        pairs = {(e['data']['source'], e['data']['target']) for e in result['edges']}
        self.assertIn((HOME, 'https://a.com/a'), pairs)
        self.assertIn(('https://a.com/a', 'https://a.com/a/c'), pairs)

    def test_shortest_path_wins_over_deep_link(self):
        # c linked from both home (depth 1) and a (depth 2): parent must be home
        pages, links = site()
        links.append(link(HOME, 'https://a.com/a/c'))
        result = build_graph(pages, links, mode='crawltree')
        pairs = {(e['data']['source'], e['data']['target']) for e in result['edges']}
        self.assertIn((HOME, 'https://a.com/a/c'), pairs)
        self.assertNotIn(('https://a.com/a', 'https://a.com/a/c'), pairs)

    def test_unlinked_pages_grouped(self):
        pages, links = site()
        result = build_graph(pages, links, mode='crawltree')
        unlinked = next(n['data'] for n in result['nodes'] if n['data']['id'] == 'unlinked')
        self.assertEqual(unlinked['count'], 1)  # /orphan

    def test_child_cap_with_overflow_group(self):
        pages = [page(HOME, depth=0)]
        links = []
        for i in range(CRAWLTREE_CHILD_CAP + 10):
            u = f'https://a.com/p{i}'
            pages.append(page(u))
            links.append(link(HOME, u))
        result = build_graph(pages, links, mode='crawltree')
        groups = [n['data'] for n in result['nodes'] if n['data']['type'] == 'group']
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['count'], 10)
        self.assertEqual(groups[0]['reroot_url'], HOME)

    def test_focus_reroots_with_bigger_cap(self):
        pages = [page(HOME, depth=0)]
        links = []
        for i in range(CRAWLTREE_CHILD_CAP + 10):
            u = f'https://a.com/p{i}'
            pages.append(page(u))
            links.append(link(HOME, u))
        result = build_graph(pages, links, mode='crawltree', focus=HOME)
        page_nodes = [n for n in result['nodes'] if n['data']['type'] == 'page']
        self.assertEqual(len(page_nodes), CRAWLTREE_CHILD_CAP + 10 + 1)  # all + root

    def test_node_budget(self):
        pages = [page(HOME, depth=0)]
        links = []
        for i in range(400):
            u = f'https://a.com/p{i}'
            pages.append(page(u))
            links.append(link(HOME, u))
            for j in range(3):
                v = f'https://a.com/p{i}/s{j}'
                pages.append(page(v, depth=2))
                links.append(link(u, v))
        result = build_graph(pages, links, mode='crawltree', focus=HOME)
        self.assertLessEqual(len(result['nodes']), MAX_NODES + 60)  # + overflow groups

    def test_unknown_focus_raises(self):
        pages, links = site()
        with self.assertRaises(ValueError):
            build_graph(pages, links, mode='crawltree', focus='https://a.com/none')


if __name__ == '__main__':
    unittest.main()
