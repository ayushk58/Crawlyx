/**
 * Ahrefs Domain Rating widget (top-left header).
 * Fetches via /api/domain-rating when the crawl URL changes.
 */

let drDebounceTimer = null;
let drLastDomain = null;

function initDomainRating() {
    const input = document.getElementById('urlInput');
    if (!input) return;

    input.addEventListener('input', () => {
        clearTimeout(drDebounceTimer);
        drDebounceTimer = setTimeout(() => refreshDomainRating(input.value), 600);
    });
    input.addEventListener('blur', () => refreshDomainRating(input.value));

    refreshDomainRating(input.value);
}

function domainFromTarget(target) {
    const raw = (target || '').trim();
    if (!raw) return '';
    try {
        const u = raw.includes('://') ? raw : `https://${raw}`;
        return new URL(u).hostname.replace(/^www\./i, '');
    } catch {
        return raw.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./i, '');
    }
}

function resetDrWidget() {
    const widget = document.getElementById('drWidget');
    const valueEl = document.getElementById('drValue');
    const domainEl = document.getElementById('drDomain');
    const fillEl = document.getElementById('drRingFill');
    if (!widget || !valueEl || !fillEl) return;

    drLastDomain = null;
    widget.classList.remove('dr-loading', 'dr-error');
    widget.classList.add('dr-empty');
    valueEl.textContent = '—';
    if (domainEl) domainEl.textContent = '';
    fillEl.style.opacity = '0';
    setDrRing(fillEl, 0);
}

function refreshDomainRating(urlOrDomain) {
    const widget = document.getElementById('drWidget');
    const valueEl = document.getElementById('drValue');
    const domainEl = document.getElementById('drDomain');
    const fillEl = document.getElementById('drRingFill');
    if (!widget || !valueEl || !fillEl) return;

    const target = (urlOrDomain || '').trim();
    if (!target) {
        resetDrWidget();
        return;
    }

    widget.classList.remove('dr-empty', 'dr-error');
    widget.classList.add('dr-loading');
    fillEl.style.opacity = '1';
    setDrRing(fillEl, 0);
    valueEl.textContent = '…';
    if (domainEl) domainEl.textContent = domainFromTarget(target);

    const params = new URLSearchParams({ target });
    fetch(`/api/domain-rating?${params}`)
        .then(r => r.json())
        .then(data => {
            widget.classList.remove('dr-loading');
            if (!data.success) {
                widget.classList.add('dr-error');
                valueEl.textContent = '—';
                setDrRing(fillEl, 0);
                if (domainEl) domainEl.textContent = '';
                return;
            }
            if (drLastDomain && drLastDomain !== data.domain) {
                // stale response — user changed URL while request was in flight
            }
            drLastDomain = data.domain;
            widget.classList.remove('dr-empty');
            const fillEl = document.getElementById('drRingFill');
            if (fillEl) fillEl.style.opacity = '1';
            const rating = Math.max(0, Math.min(100, Number(data.domain_rating) || 0));
            valueEl.textContent = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
            if (domainEl) domainEl.textContent = data.domain;
            setDrRing(fillEl, rating);
        })
        .catch(() => {
            widget.classList.remove('dr-loading');
            widget.classList.add('dr-error');
            valueEl.textContent = '—';
            setDrRing(fillEl, 0);
        });
}

function setDrRing(circleEl, rating) {
    const length = circleEl.getTotalLength();
    const pct = Math.max(0, Math.min(100, Number(rating) || 0)) / 100;
    // Use style (not attributes) so we win over any CSS; offset method = accurate arc fill
    circleEl.style.strokeDasharray = String(length);
    circleEl.style.strokeDashoffset = String(length * (1 - pct));
}

window.initDomainRating = initDomainRating;
window.refreshDomainRating = refreshDomainRating;
