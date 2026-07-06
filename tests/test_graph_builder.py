import unittest

from src.analysis.graph_builder import (
    build_graph, AUTHORITY_MAX_DEPTH, AUTHORITY_CHILD_CAP, CRAWLTREE_MAX_DEPTH)


def page(url, status=200, depth=1):
    return {'url': url, 'status_code': status, 'depth': depth, 'is_internal': True}


def link(source, target, placement='body', status=200):
    return {'source_url': source, 'target_url': target, 'placement': placement,
            'target_status': status, 'is_internal': True, 'anchor_text': 'x'}


HOME = 'https://a.com/'


class TestAuthorityTree(unittest.TestCase):
    def setUp(self):
        # home -> hub (body), home -> b (footer); hub -> c
        self.pages = [page(HOME, depth=0), page('https://a.com/hub'),
                      page('https://a.com/b'), page('https://a.com/hub/c', depth=2)]
        self.links = [link(HOME, 'https://a.com/hub'),
                      link(HOME, 'https://a.com/b', placement='footer'),
                      link('https://a.com/hub', 'https://a.com/hub/c')]
        self.result = build_graph(self.pages, self.links, mode='authority')

    def test_root_is_homepage(self):
        by_id = {n['data']['id']: n['data'] for n in self.result['nodes']}
        self.assertTrue(by_id[HOME]['is_root'])
        self.assertEqual(by_id[HOME]['tree_depth'], 0)

    def test_children_hang_off_strongest_source(self):
        pairs = {(e['data']['source'], e['data']['target']) for e in self.result['edges']}
        self.assertIn((HOME, 'https://a.com/hub'), pairs)
        self.assertIn(('https://a.com/hub', 'https://a.com/hub/c'), pairs)

    def test_edges_carry_flow_and_width(self):
        flow_edges = [e['data'] for e in self.result['edges'] if 'flow' in e['data']]
        self.assertTrue(flow_edges)
        for e in flow_edges:
            self.assertGreaterEqual(e['flow'], 0)
            self.assertGreaterEqual(e['width'], 1)

    def test_body_link_flow_beats_footer(self):
        edges = {(e['data']['source'], e['data']['target']): e['data']
                 for e in self.result['edges']}
        hub = edges[(HOME, 'https://a.com/hub')]
        b = edges[(HOME, 'https://a.com/b')]
        self.assertGreater(hub['flow'], b['flow'])

    def test_depth_capped_at_3(self):
        # chain of 6 levels below home
        pages = [page(HOME, depth=0)]
        links = []
        prev = HOME
        for i in range(6):
            u = f'https://a.com/l{i}'
            pages.append(page(u, depth=i + 1))
            links.append(link(prev, u))
            prev = u
        result = build_graph(pages, links, mode='authority')
        depths = [n['data']['tree_depth'] for n in result['nodes'] if n['data']['type'] == 'page']
        self.assertEqual(max(depths), AUTHORITY_MAX_DEPTH)
        deeper = [n['data'] for n in result['nodes']
                  if n['data']['type'] == 'group' and 'deeper' in n['data']['label']]
        self.assertEqual(len(deeper), 1)
        self.assertTrue(deeper[0]['reroot_url'])

    def test_child_cap_with_group(self):
        pages = [page(HOME, depth=0)]
        links = []
        for i in range(AUTHORITY_CHILD_CAP + 5):
            u = f'https://a.com/p{i}'
            pages.append(page(u))
            links.append(link(HOME, u))
        result = build_graph(pages, links, mode='authority')
        groups = [n['data'] for n in result['nodes'] if n['data']['type'] == 'group']
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]['count'], 5)

    def test_focus_reroots(self):
        result = build_graph(self.pages, self.links, mode='authority',
                             focus='https://a.com/hub')
        by_id = {n['data']['id']: n['data'] for n in result['nodes']}
        self.assertTrue(by_id['https://a.com/hub']['is_root'])

    def test_unknown_focus_raises(self):
        with self.assertRaises(ValueError):
            build_graph(self.pages, self.links, mode='authority', focus='https://a.com/x')


class TestCrawlTreeDepthCap(unittest.TestCase):
    def test_depth_capped_at_5(self):
        pages = [page(HOME, depth=0)]
        links = []
        prev = HOME
        for i in range(8):
            u = f'https://a.com/l{i}'
            pages.append(page(u, depth=i + 1))
            links.append(link(prev, u))
            prev = u
        result = build_graph(pages, links, mode='crawltree')
        depths = [n['data']['tree_depth'] for n in result['nodes'] if n['data']['type'] == 'page']
        self.assertEqual(max(depths), CRAWLTREE_MAX_DEPTH)
        deeper = [n['data'] for n in result['nodes']
                  if n['data']['type'] == 'group' and 'deeper' in n['data']['label']]
        self.assertEqual(len(deeper), 1)


class TestRemovedModes(unittest.TestCase):
    def test_default_mode_is_crawltree(self):
        result = build_graph([page(HOME, depth=0)], [])
        self.assertEqual(result['mode'], 'crawltree')

    def test_empty_crawl(self):
        result = build_graph([], [], mode='authority')
        self.assertEqual(result['nodes'], [])


if __name__ == '__main__':
    unittest.main()
