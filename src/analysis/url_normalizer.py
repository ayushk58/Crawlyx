"""URL normalization for crawling, deduplication, and analysis.

Two modes:
- conservative (default): safe for crawl-time deduplication. Never changes
  which resource a URL points to (paths stay case-sensitive, trailing
  slashes preserved).
- aggressive: canonical form for analysis (duplicate detection, link graphs,
  crawl comparisons). Folds trailing slashes, index files, and www.
"""
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode, unquote, quote

DEFAULT_PORTS = {'http': '80', 'https': '443'}
INDEX_FILES = ('index.html', 'index.htm', 'index.php', 'default.html', 'default.htm')


def normalize_url(url, aggressive=False):
    """Normalize a URL. Returns the input unchanged if it cannot be parsed.

    Conservative rules (always applied):
    - strip surrounding whitespace
    - lowercase scheme and hostname
    - remove fragment
    - remove default ports (:80 for http, :443 for https)
    - normalize percent-encoding (decode unreserved characters, uppercase hex)
    - sort query parameters by key (stable), drop empty '?'
    - empty path becomes '/'

    Aggressive rules (aggressive=True, for analysis only):
    - strip trailing slash (except root)
    - strip trailing index files (/index.html etc.)
    - fold www. prefix
    """
    if not url:
        return url

    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url

    scheme = parts.scheme.lower()
    if scheme not in ('http', 'https'):
        return url

    host = (parts.hostname or '').lower()
    if not host:
        return url

    # Rebuild netloc without default port, preserving credentials if present
    netloc = host
    if parts.port is not None and str(parts.port) != DEFAULT_PORTS.get(scheme):
        netloc = f"{host}:{parts.port}"
    if parts.username:
        cred = parts.username + (f":{parts.password}" if parts.password else '')
        netloc = f"{cred}@{netloc}"

    # Normalize percent-encoding in path
    path = quote(unquote(parts.path), safe="/:@!$&'()*+,;=~-._")
    if not path:
        path = '/'

    # Sort query params (stable, preserves duplicate-key order)
    query = ''
    if parts.query:
        pairs = parse_qsl(parts.query, keep_blank_values=True)
        query = urlencode(sorted(pairs, key=lambda kv: kv[0]))

    if aggressive:
        if netloc.startswith('www.'):
            netloc = netloc[4:]
        # Strip trailing index file
        segments = path.rsplit('/', 1)
        if len(segments) == 2 and segments[1].lower() in INDEX_FILES:
            path = segments[0] + '/'
        # Strip trailing slash except root
        if len(path) > 1 and path.endswith('/'):
            path = path.rstrip('/') or '/'

    return urlunsplit((scheme, netloc, path, query, ''))


def is_parameterized(url):
    """True if the URL has a query string."""
    try:
        return bool(urlsplit(url).query)
    except ValueError:
        return False
