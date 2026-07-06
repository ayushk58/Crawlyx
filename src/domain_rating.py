"""Ahrefs public Domain Rating lookup (free endpoint, no API key)."""
import time
from urllib.parse import urlparse

import requests

AHREFS_DR_URL = 'https://api.ahrefs.com/v3/public/domain-rating-free'
CACHE_TTL_SECONDS = 300
_cache = {}  # domain -> (fetched_at, rating)


def extract_domain(target):
    """Normalize a URL or hostname to a domain Ahrefs accepts."""
    if not target or not str(target).strip():
        return None
    raw = str(target).strip()
    if not raw.startswith(('http://', 'https://')):
        raw = 'https://' + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    host = (parsed.netloc or parsed.path.split('/')[0]).lower()
    if host.startswith('www.'):
        host = host[4:]
    return host or None


def fetch_domain_rating(target, timeout=12):
    """Return DR for a domain/URL. Uses a short in-memory cache."""
    domain = extract_domain(target)
    if not domain:
        return {'success': False, 'error': 'Invalid domain or URL'}

    now = time.time()
    cached = _cache.get(domain)
    if cached and now - cached[0] < CACHE_TTL_SECONDS:
        return {'success': True, 'domain': domain, 'domain_rating': cached[1], 'cached': True}

    try:
        response = requests.get(
            AHREFS_DR_URL,
            params={'target': domain, 'output': 'json'},
            headers={'Accept': 'application/json'},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        rating = payload.get('domain_rating', {}).get('domain_rating')
        if rating is None:
            return {'success': False, 'error': 'Unexpected Ahrefs response'}
        rating = round(float(rating), 1)
        _cache[domain] = (now, rating)
        return {'success': True, 'domain': domain, 'domain_rating': rating, 'cached': False}
    except requests.Timeout:
        return {'success': False, 'error': 'Ahrefs request timed out'}
    except requests.RequestException as exc:
        return {'success': False, 'error': f'Ahrefs request failed: {exc}'}
    except (ValueError, TypeError, KeyError):
        return {'success': False, 'error': 'Could not parse Ahrefs response'}
