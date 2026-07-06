import unittest

from src.analysis.url_normalizer import normalize_url, is_parameterized


class TestConservative(unittest.TestCase):
    def test_lowercase_scheme_and_host(self):
        self.assertEqual(normalize_url('HTTPS://Example.COM/Path'), 'https://example.com/Path')

    def test_path_case_preserved(self):
        self.assertEqual(normalize_url('https://example.com/CaseSensitive'), 'https://example.com/CaseSensitive')

    def test_fragment_removed(self):
        self.assertEqual(normalize_url('https://example.com/a#section'), 'https://example.com/a')

    def test_default_port_removed(self):
        self.assertEqual(normalize_url('https://example.com:443/a'), 'https://example.com/a')
        self.assertEqual(normalize_url('http://example.com:80/a'), 'http://example.com/a')

    def test_nondefault_port_kept(self):
        self.assertEqual(normalize_url('https://example.com:8443/a'), 'https://example.com:8443/a')

    def test_empty_path_becomes_root(self):
        self.assertEqual(normalize_url('https://example.com'), 'https://example.com/')

    def test_trailing_slash_preserved(self):
        self.assertEqual(normalize_url('https://example.com/a/'), 'https://example.com/a/')

    def test_query_sorted(self):
        self.assertEqual(normalize_url('https://example.com/a?b=2&a=1'), 'https://example.com/a?a=1&b=2')

    def test_query_blank_values_kept(self):
        self.assertEqual(normalize_url('https://example.com/a?x=&y=1'), 'https://example.com/a?x=&y=1')

    def test_empty_query_dropped(self):
        self.assertEqual(normalize_url('https://example.com/a?'), 'https://example.com/a')

    def test_percent_encoding_normalized(self):
        # %7E is unreserved tilde -> decoded
        self.assertEqual(normalize_url('https://example.com/%7Euser'), 'https://example.com/~user')

    def test_encoded_space_preserved(self):
        self.assertEqual(normalize_url('https://example.com/a%20b'), 'https://example.com/a%20b')

    def test_www_preserved(self):
        self.assertEqual(normalize_url('https://www.example.com/'), 'https://www.example.com/')

    def test_non_http_unchanged(self):
        self.assertEqual(normalize_url('mailto:a@b.com'), 'mailto:a@b.com')
        self.assertEqual(normalize_url('ftp://example.com/f'), 'ftp://example.com/f')

    def test_garbage_unchanged(self):
        self.assertEqual(normalize_url(''), '')
        self.assertIsNone(normalize_url(None))

    def test_whitespace_stripped(self):
        self.assertEqual(normalize_url('  https://example.com/a  '), 'https://example.com/a')


class TestAggressive(unittest.TestCase):
    def test_trailing_slash_stripped(self):
        self.assertEqual(normalize_url('https://example.com/a/', aggressive=True), 'https://example.com/a')

    def test_root_slash_kept(self):
        self.assertEqual(normalize_url('https://example.com/', aggressive=True), 'https://example.com/')

    def test_index_html_stripped(self):
        self.assertEqual(normalize_url('https://example.com/dir/index.html', aggressive=True), 'https://example.com/dir')

    def test_root_index_stripped(self):
        self.assertEqual(normalize_url('https://example.com/index.html', aggressive=True), 'https://example.com/')

    def test_www_folded(self):
        self.assertEqual(normalize_url('https://www.example.com/a', aggressive=True), 'https://example.com/a')

    def test_variants_collapse(self):
        variants = [
            'https://www.example.com/blog/',
            'https://example.com/blog',
            'HTTPS://EXAMPLE.com/blog/index.html#top',
            'https://example.com:443/blog/',
        ]
        normalized = {normalize_url(v, aggressive=True) for v in variants}
        self.assertEqual(normalized, {'https://example.com/blog'})


class TestIsParameterized(unittest.TestCase):
    def test_basic(self):
        self.assertTrue(is_parameterized('https://example.com/a?x=1'))
        self.assertFalse(is_parameterized('https://example.com/a'))


if __name__ == '__main__':
    unittest.main()
