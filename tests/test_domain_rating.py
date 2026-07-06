import unittest
from unittest.mock import patch, MagicMock

from src.domain_rating import extract_domain, fetch_domain_rating, _cache


class TestExtractDomain(unittest.TestCase):
    def test_url_with_https(self):
        self.assertEqual(extract_domain('https://www.example.com/path'), 'example.com')

    def test_bare_domain(self):
        self.assertEqual(extract_domain('blog.example.co.uk'), 'blog.example.co.uk')

    def test_empty(self):
        self.assertIsNone(extract_domain(''))
        self.assertIsNone(extract_domain(None))


class TestFetchDomainRating(unittest.TestCase):
    def setUp(self):
        _cache.clear()

    @patch('src.domain_rating.requests.get')
    def test_fetch_success(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {'domain_rating': {'domain_rating': 72.0}},
        )
        mock_get.return_value.raise_for_status = MagicMock()

        result = fetch_domain_rating('https://example.com')
        self.assertTrue(result['success'])
        self.assertEqual(result['domain_rating'], 72.0)
        self.assertEqual(result['domain'], 'example.com')
        mock_get.assert_called_once()

    @patch('src.domain_rating.requests.get')
    def test_uses_cache(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {'domain_rating': {'domain_rating': 50.0}},
        )
        mock_get.return_value.raise_for_status = MagicMock()

        fetch_domain_rating('example.com')
        fetch_domain_rating('example.com')
        self.assertEqual(mock_get.call_count, 1)


if __name__ == '__main__':
    unittest.main()
