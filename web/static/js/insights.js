/**
 * Insights panel — mirrors live crawl counters into the right-hand cards.
 * Read-only: polls existing DOM counters maintained by app.js, so it needs
 * no hooks into the crawler code.
 */
(function () {
    const RING_CIRC = 169.6; // 2 * PI * r(27)

    function num(id) {
        const el = document.getElementById(id);
        if (!el) return 0;
        const m = (el.textContent || '').replace(/,/g, '').match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function update() {
        // Crawl overview ring
        const crawled = num('crawledCount');
        const discovered = num('discoveredCount');
        const pct = discovered > 0 ? Math.min(100, Math.round((crawled / discovered) * 100)) : 0;
        setText('insightPct', pct + '%');
        setText('insightCrawled', crawled.toLocaleString());
        const speed = document.getElementById('crawlSpeed');
        setText('insightSub', 'URLs crawled' + (speed && !speed.textContent.startsWith('0') ? ' · ' + speed.textContent : ''));
        const ring = document.getElementById('insightRingFill');
        if (ring) ring.style.strokeDashoffset = (RING_CIRC * (1 - pct / 100)).toFixed(1);

        // URL types
        const types = { Html: num('html-count'), Css: num('css-count'), Js: num('js-count'), Images: num('images-count') };
        const max = Math.max(types.Html, types.Css, types.Js, types.Images, 1);
        for (const key of Object.keys(types)) {
            const bar = document.getElementById('insightBar' + key);
            if (bar) bar.style.width = ((types[key] / max) * 100).toFixed(0) + '%';
            setText('insightVal' + key, types[key].toLocaleString());
        }

        // Issues
        setText('insightErrors', num('issues-error-count').toLocaleString());
        setText('insightWarnings', num('issues-warning-count').toLocaleString());
        setText('insightInfos', num('issues-info-count').toLocaleString());
    }

    document.addEventListener('DOMContentLoaded', function () {
        update();
        setInterval(update, 1000);
    });
})();
