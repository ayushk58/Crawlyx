// Application State
let crawlState = {
    isRunning: false,
    isPaused: false,
    startTime: null,
    baseUrl: null,
    urls: [],
    links: [],
    issues: [],
    stats: {
        discovered: 0,
        crawled: 0,
        depth: 0,
        speed: 0
    },
    filters: {
        active: null,
        issueFilter: 'all',
        linksFilter: {
            internalStatusCode: 'all',
            externalStatusCode: 'all',
            internalSearch: '',
            externalSearch: ''
        }
    }
};

// Incremental polling instance
let incrementalPoller = null;

// Virtual Scrollers
let virtualScrollers = {
    overview: null,
    internal: null,
    external: null,
    internalLinks: null,
    externalLinks: null,
    issues: null
};

// Initialize application
document.addEventListener('DOMContentLoaded', async function() {
    await initializeApp();
});

async function initializeApp() {
    // Setup event listeners
    setupEventListeners();
    if (typeof initDomainRating === 'function') {
        initDomainRating();
    }

    // Initialize tables
    initializeTables();

    // DEBUG: Check sessionStorage
    console.log('DEBUG: Checking sessionStorage force_ui_refresh:', sessionStorage.getItem('force_ui_refresh'));

    // Check if we just loaded a crawl from dashboard
    if (sessionStorage.getItem('force_ui_refresh') === 'true') {
        console.log('DEBUG: Found force_ui_refresh flag, loading crawl data...');
        sessionStorage.removeItem('force_ui_refresh');

        try {
            // Fetch the loaded data immediately with FULL refresh (no incremental)
            const response = await fetch('/api/crawl_status');
            const data = await response.json();

            // DEBUG: Log the full response
            console.log('DEBUG: Full /api/crawl_status response:', JSON.stringify(data, null, 2));

            // Clear existing data first
            clearAllTables();
            resetStats();

            // Force populate all data
            crawlState.urls = [];
            crawlState.links = data.links || [];
            crawlState.issues = data.issues || [];
            crawlState.stats = data.stats || {};
            crawlState.baseUrl = data.stats?.baseUrl || '';

            // Set URL input
            if (crawlState.baseUrl) {
                document.getElementById('urlInput').value = crawlState.baseUrl;
            }

            // Add each URL to tables
            if (data.urls && data.urls.length > 0) {
                data.urls.forEach(url => addUrlToTable(url));
            }

            // Load links if present
            if (data.links && data.links.length > 0) {
                crawlState.pendingLinks = data.links;
                // If links tab is active, load them immediately
                if (isLinksTabActive()) {
                    updateLinksTable(data.links);
                }
            }

            // Load issues if present
            if (data.issues && data.issues.length > 0) {
                crawlState.pendingIssues = data.issues;
                // If issues tab is active, load them immediately
                if (isIssuesTabActive()) {
                    updateIssuesTable(data.issues);
                } else {
                    // Update badge count even if tab not active
                    const issuesTabButton = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.textContent.includes('Issues'));
                    if (issuesTabButton && data.issues.length > 0) {
                        const errorCount = data.issues.filter(i => i.type === 'error').length;
                        const warningCount = data.issues.filter(i => i.type === 'warning').length;
                        let badgeColor = '#3b82f6';
                        if (errorCount > 0) badgeColor = '#ef4444';
                        else if (warningCount > 0) badgeColor = '#f59e0b';
                        issuesTabButton.innerHTML = `Issues <span style="background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 12px; font-size: 12px;">${data.issues.length}</span>`;
                    }
                }
            }

            // Update all displays
            updateStatsDisplay();
            updateFilterCounts();
            updateStatusCodesTable();
            updateCrawlButtons();

            // Check if the crawl is currently running (resumed from dashboard)
            if (data.status === 'running') {
                // Set crawl state to running
                crawlState.isRunning = true;
                crawlState.isPaused = false;
                crawlState.startTime = new Date(); // Set start time to now for timer

                // Show progress UI
                showProgress();

                // Update buttons for running state
                updateCrawlButtons();

                // Start polling for updates
                updateStatus('Crawl resumed - updating...');
                pollCrawlProgress();
            } else {
                // Crawl is not running, just loaded data
                updateStatus(`Loaded crawl: ${data.stats.crawled} URLs, ${data.links?.length || 0} links, ${data.issues?.length || 0} issues`);
            }

            console.log('Loaded crawl from database:', {
                urls: data.urls?.length || 0,
                links: data.links?.length || 0,
                issues: data.issues?.length || 0,
                stats: data.stats,
                status: data.status,
                isRunning: crawlState.isRunning
            });
        } catch (error) {
            console.error('Error loading crawl data:', error);
            updateStatus('Error loading crawl data');
        }
    }

    // Set initial focus
    document.getElementById('urlInput').focus();

    console.log('Crawlyx initialized');
}

function setupEventListeners() {
    // URL input enter key
    document.getElementById('urlInput').addEventListener('keypress', handleUrlKeypress);

    // Update timer every second when crawling
    setInterval(updateTimer, 1000);
}

function handleUrlKeypress(event) {
    if (event.key === 'Enter' && !crawlState.isRunning) {
        toggleCrawl();
    }
}

function toggleCrawl() {
    if (!crawlState.isRunning) {
        startCrawl();
    } else if (crawlState.isPaused) {
        resumeCrawl();
    } else {
        pauseCrawl();
    }
}

function startCrawl() {
    const urlInput = document.getElementById('urlInput');
    let url = urlInput.value.trim();

    if (!url) {
        alert('Please enter a URL to crawl');
        urlInput.focus();
        return;
    }

    // Normalize the URL - add protocol if missing
    url = normalizeUrl(url);

    if (!isValidUrl(url)) {
        alert('Please enter a valid URL or domain');
        urlInput.focus();
        return;
    }

    // Update the input field with the normalized URL
    urlInput.value = url;
    if (typeof refreshDomainRating === 'function') {
        refreshDomainRating(url);
    }

    crawlState.isRunning = true;
    crawlState.isPaused = false;
    crawlState.startTime = new Date();
    crawlState.baseUrl = url;

    // Initialize incremental poller for new crawl
    if (!incrementalPoller) {
        incrementalPoller = new IncrementalPoller();
    }
    incrementalPoller.reset();

    // Update UI
    updateCrawlButtons();
    showProgress();
    updateStatus('Starting crawl...');

    // Clear previous data
    clearAllTables();
    resetStats();

    // Start the actual crawling via Python backend
    startPythonCrawl(url);
}

function pauseCrawl() {
    crawlState.isPaused = true;
    updateCrawlButtons();
    updateStatus('Crawl paused');

    // Pause Python crawler
    fetch('/api/pause_crawl', {
        method: 'POST'
    }).catch(error => {
        console.error('Error pausing crawl:', error);
    });
}

function resumeCrawl() {
    crawlState.isPaused = false;
    updateCrawlButtons();
    updateStatus('Resuming crawl...');

    // Resume Python crawler
    fetch('/api/resume_crawl', {
        method: 'POST'
    }).catch(error => {
        console.error('Error resuming crawl:', error);
    });
}

function stopCrawl() {
    crawlState.isRunning = false;
    crawlState.isPaused = false;

    // Update UI
    updateCrawlButtons();
    hideProgress();
    updateStatus('Crawl stopped');

    // Stop Python crawler
    stopPythonCrawl();
}

function clearCrawlData() {
    if (crawlState.isRunning) {
        if (!confirm('A crawl is currently running. Stop the crawl and clear all data?')) {
            return;
        }
        stopCrawl();
    }

    // Clear all data
    clearAllTables();
    resetStats();
    crawlState.urls = [];
    crawlState.links = [];
    crawlState.issues = [];
    crawlState.baseUrl = null;
    crawlState.filters.active = null;
    crawlState.pendingLinks = null;
    crawlState.pendingIssues = null;
    auditSummaryLoaded = false;
    updateStatusCodesTable();

    // Clear issues and reset badge
    window.currentIssues = [];
    updateIssuesTable([]);  // This will also clear the badge

    // Reset issue filter counts
    document.getElementById('issues-all-count').textContent = '(0)';
    document.getElementById('issues-error-count').textContent = '(0)';
    document.getElementById('issues-warning-count').textContent = '(0)';
    document.getElementById('issues-info-count').textContent = '(0)';

    // Clear visualization
    if (typeof window.clearVisualization === 'function') {
        window.clearVisualization();
    }

    // Clear filter states
    document.querySelectorAll('.filter-item').forEach(item => {
        item.classList.remove('active');
    });

    // Reset the "All Issues" filter to active
    document.querySelector('[data-filter="all"]')?.classList.add('active');

    // Update UI
    updateStatus('Data cleared');
    hideProgress();
    updateCrawlButtons(); // Update save/load button states

    // Reset URL input
    document.getElementById('urlInput').value = '';
    if (typeof refreshDomainRating === 'function') {
        refreshDomainRating('');
    }
    document.getElementById('urlInput').focus();
}

function startPythonCrawl(url) {
    // Call Python backend to start crawling
    fetch('/api/start_crawl', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            updateStatus('Crawling in progress...');
            // Start polling for updates
            pollCrawlProgress();
        } else {
            updateStatus('Error: ' + data.error);
            stopCrawl();
        }
    })
    .catch(error => {
        console.error('Error starting crawl:', error);
        updateStatus('Error starting crawl');
        stopCrawl();
    });
}

function stopPythonCrawl() {
    fetch('/api/stop_crawl', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        console.log('Crawl stopped:', data);
    })
    .catch(error => {
        console.error('Error stopping crawl:', error);
    });
}

function pollCrawlProgress() {
    if (!crawlState.isRunning) return;

    // Use incremental poller if available, otherwise fall back to regular fetch
    const fetchPromise = incrementalPoller
        ? incrementalPoller.fetchUpdate()
        : fetch('/api/crawl_status').then(response => response.json());

    fetchPromise
        .then(data => {
            updateCrawlData(data);

            // Update bottom status bar based on current state
            if (data.status === 'running') {
                updateStatus('Crawling in progress...');
            }

            // Update visualization if visualization tab is active
            const vizTab = document.getElementById('visualization-tab');
            if (vizTab && vizTab.classList.contains('active') && typeof loadVisualizationData === 'function') {
                loadVisualizationData();
            }

            if (data.status === 'demo_stopped' || data.demo_stopped) {
                stopCrawl();
                updateStatus('Demo limit reached — crawl data saved');
                showDemoLimitNotification();
                if (typeof loadVisualizationData === 'function') {
                    loadVisualizationData();
                }
            } else if (crawlState.isRunning && data.status !== 'completed') {
                setTimeout(pollCrawlProgress, 1000); // Poll every second
            } else if (data.status === 'completed') {
                stopCrawl();
                updateStatus('Crawl completed');
                // Update visualization one final time when crawl completes
                if (typeof loadVisualizationData === 'function') {
                    loadVisualizationData();
                }
            }
        })
        .catch(error => {
            console.error('Error polling crawl status:', error);
            // Continue polling even if there's an error (common on large crawls)
            if (crawlState.isRunning) {
                setTimeout(pollCrawlProgress, 1000);
            }
        });
}

function updateCrawlData(data) {
    // Update statistics
    crawlState.stats = data.stats || crawlState.stats;
    updateStatsDisplay();

    // Update crawl health diagnostics
    if (data.diagnostics) {
        updateCrawlHealth(data.diagnostics);
    }

    // Invalidate cached audit summary while new data is coming in
    if (data.status === 'running') {
        auditSummaryLoaded = false;
    }

    // Update memory statistics
    if (data.memory && data.memory_data) {
        updateMemoryDisplay(data.memory, data.memory_data);
    }
    updateCrawlTables(data);
}

function updateCrawlHealth(diag) {
    const setValue = (id, value, warnWhenPositive) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = value;
        if (warnWhenPositive) {
            el.style.color = (typeof value === 'number' && value > 0) ? '#e67e22' : '';
        }
    };

    if (diag.sitemap_found === true) {
        setValue('healthSitemap', 'Found');
    } else if (diag.sitemap_found === false) {
        const el = document.getElementById('healthSitemap');
        if (el) { el.textContent = 'Not found'; el.style.color = '#e67e22'; }
    } else {
        setValue('healthSitemap', '—');
    }

    setValue('healthRobotsBlocked', diag.robots_blocked || 0, true);
    setValue('healthTimeouts', diag.timeouts || 0, true);
    const fetchFailures = (diag.dns_failures || 0) + (diag.ssl_failures || 0) + (diag.connection_errors || 0);
    setValue('healthFetchFailures', fetchFailures, true);
    setValue('healthDepthLimited', diag.depth_limited_urls || 0, true);
    setValue('healthDuplicates', diag.duplicate_url_variants || 0, true);
    setValue('healthParameterized', diag.parameterized_urls || 0, false);

    const maxUrlsRow = document.getElementById('healthMaxUrlsRow');
    if (maxUrlsRow) maxUrlsRow.style.display = diag.stopped_by_max_urls ? '' : 'none';

    const jsRow = document.getElementById('healthJsFailuresRow');
    if (jsRow) {
        const jsFailures = diag.js_render_failures || 0;
        jsRow.style.display = jsFailures > 0 ? '' : 'none';
        setValue('healthJsFailures', jsFailures, true);
    }
}

function updateCrawlTables(data) {
    // Update tables with new URLs
    if (data.urls) {
        data.urls.forEach(url => {
            addUrlToTable(url);
        });
    }

    // Update links tables only if Links tab is active to improve performance
    if (data.links) {
        // Always store links data in crawlState
        crawlState.links = data.links;
        if (isLinksTabActive()) {
            updateLinksTable(data.links);
        } else {
            // Store in pendingLinks for lazy loading when switching to tab
            crawlState.pendingLinks = data.links;
        }
    }

    // Update issues table only if Issues tab is active
    if (data.issues) {
        // Always store issues data in crawlState
        crawlState.issues = data.issues;
        if (isIssuesTabActive()) {
            updateIssuesTable(data.issues);
        } else {
            // Store in pendingIssues for lazy loading when switching to tab
            crawlState.pendingIssues = data.issues;
        }
    }

    // Update filter counts
    updateFilterCounts();

    // Update status codes table (respecting active filter)
    updateStatusCodesTable(crawlState.filters.active);

    // Update progress and status text
    updateProgress(data.progress || 0);
    updateProgressText(data);

}

function updateProgressText(data) {
    const progressText = document.getElementById('progressText');
    if (!progressText) return;

    if (data.status === 'completed') {
        progressText.textContent = 'Crawl completed';
    } else if (data.status === 'running') {
        const stats = data.stats || crawlState.stats;
        if (stats.crawled === 0) {
            progressText.textContent = 'Starting crawl...';
        } else if (stats.discovered > stats.crawled) {
            progressText.textContent = `Crawling... (${stats.crawled}/${stats.discovered} URLs)`;
        } else {
            progressText.textContent = `Finishing up... (${stats.crawled} URLs crawled)`;
        }
    } else {
        progressText.textContent = 'Initializing...';
    }
}

function updateStatsDisplay() {
    document.getElementById('discoveredCount').textContent = crawlState.stats.discovered;
    document.getElementById('crawledCount').textContent = crawlState.stats.crawled;
    document.getElementById('crawlDepth').textContent = crawlState.stats.depth;
    document.getElementById('crawlSpeed').textContent = crawlState.stats.speed + ' URLs/sec';
}

function updateMemoryDisplay(memoryData, memoryDataSizes) {
    if (!memoryData || !memoryDataSizes) return;

    // Actual data size (deep measurement)
    const dataMB = memoryDataSizes.total_deep_mb || 0;
    document.getElementById('memCurrent').textContent = dataMB.toFixed(1) + ' MB';

    // KB per URL (actual data)
    const kbPerUrl = memoryDataSizes.avg_per_url_kb || 0;
    document.getElementById('memPeak').textContent = kbPerUrl.toFixed(1) + ' KB/URL';

    // Estimate for 1M URLs (data only)
    const estimate1M = (kbPerUrl * 1000000) / 1024; // Convert to MB
    const estimate1MDisplay = estimate1M > 1024
        ? (estimate1M / 1024).toFixed(1) + ' GB'
        : estimate1M.toFixed(0) + ' MB';
    document.getElementById('memEstimate1M').textContent = estimate1MDisplay;

    // System available
    const availableMB = memoryData.system?.available_mb || 0;
    document.getElementById('memAvailable').textContent = availableMB.toFixed(0) + ' MB';
}

function updateCrawlButtons() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const clearBtn = document.getElementById('clearBtn');
    const saveCrawlBtn = document.getElementById('saveCrawlBtn');
    const loadCrawlBtn = document.getElementById('loadCrawlBtn');

    if (crawlState.isRunning) {
        if (crawlState.isPaused) {
            startBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                </svg>
                Resume
            `;
        } else {
            startBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
                Pause
            `;
        }
        startBtn.disabled = false;
        stopBtn.disabled = false;
        clearBtn.disabled = false;
        saveCrawlBtn.disabled = true; // Disable during crawl
        loadCrawlBtn.disabled = true; // Disable during crawl
    } else {
        startBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
            Start
        `;
        startBtn.disabled = false;
        stopBtn.disabled = true;
        clearBtn.disabled = false;

        // Save button: only enabled if crawl is completed and has data
        const hasData = crawlState.stats.crawled > 0;
        saveCrawlBtn.disabled = !hasData;

        // Load button: only enabled if no current crawl data
        loadCrawlBtn.disabled = hasData;
    }
}

function showProgress() {
    document.getElementById('progressContainer').style.display = 'flex';
}

function hideProgress() {
    document.getElementById('progressContainer').style.display = 'none';
}

function updateProgress(percentage) {
    document.getElementById('progressFill').style.width = percentage + '%';
}

function updateStatus(message) {
    document.getElementById('statusText').textContent = message;
}

function showDemoLimitNotification() {
    // Remove existing demo notification if any
    const existing = document.getElementById('demoLimitNotification');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'demoLimitNotification';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.6); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background: #ffffff; border: 1px solid #dfe3e8; border-radius: 12px;
        padding: 32px 40px; max-width: 480px; text-align: center;
        color: #2a2f38; box-shadow: 0 20px 50px rgba(16,24,40,0.16);
    `;
    box.innerHTML = `
        <div style="font-size: 28px; margin-bottom: 12px;">&#9888;</div>
        <h2 style="color: #b45309; margin: 0 0 12px; font-size: 18px;">Demo Memory Limit Reached</h2>
        <p style="margin: 0 0 16px; line-height: 1.5; font-size: 14px;">
            This user has reached the 1.5 GB per-user memory limit.<br>
            Your crawl data has been saved automatically.<br><br>
            <strong>This is a free demo and is not intended for production use.</strong>
        </p>
        <button id="demoLimitDismiss" style="
            background: #178a4e; color: #fff; border: none; padding: 10px 28px;
            border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 14px;
        ">OK</button>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document.getElementById('demoLimitDismiss').addEventListener('click', function() {
        overlay.remove();
    });
}

function updateTimer() {
    if (crawlState.isRunning && crawlState.startTime) {
        const elapsed = new Date() - crawlState.startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        document.getElementById('crawlTime').textContent =
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Table Management
function initializeTables() {
    // Clear any existing data first
    clearAllTables();
    // Initialize virtual scrollers for all tables
    initializeVirtualScrollers();
    // Initialize column resizers after virtual scrollers
    setTimeout(() => {
        if (window.initializeColumnResizers) {
            initializeColumnResizers();
        }
    }, 100);
}

function initializeVirtualScrollers() {
    try {
        // Overview table
        const overviewContainer = document.querySelector('#overview-tab .table-container');
        if (overviewContainer && overviewContainer.querySelector('tbody')) {
            virtualScrollers.overview = new VirtualScroller(overviewContainer, {
                rowHeight: 100,
                buffer: 25,
                renderRow: renderOverviewRow
            });
            console.log('Overview virtual scroller initialized');
        }

        // Internal URLs table
        const internalContainer = document.querySelector('#internal-tab .table-container');
        if (internalContainer && internalContainer.querySelector('tbody')) {
            virtualScrollers.internal = new VirtualScroller(internalContainer, {
                rowHeight: 80,
                buffer: 25,
                renderRow: renderInternalRow
            });
            console.log('Internal virtual scroller initialized');
        }

        // External URLs table
        const externalContainer = document.querySelector('#external-tab .table-container');
        if (externalContainer && externalContainer.querySelector('tbody')) {
            virtualScrollers.external = new VirtualScroller(externalContainer, {
                rowHeight: 80,
                buffer: 25,
                renderRow: renderExternalRow
            });
            console.log('External virtual scroller initialized');
        }

        // Internal Links table
        const internalLinksContainer = document.querySelector('#links-tab .internal-links-container');
        if (internalLinksContainer && internalLinksContainer.querySelector('tbody')) {
            virtualScrollers.internalLinks = new VirtualScroller(internalLinksContainer, {
                rowHeight: 80,
                buffer: 25,
                renderRow: renderInternalLinkRow
            });
            console.log('Internal links virtual scroller initialized');
        }

        // External Links table
        const externalLinksContainer = document.querySelector('#links-tab .external-links-container');
        if (externalLinksContainer && externalLinksContainer.querySelector('tbody')) {
            virtualScrollers.externalLinks = new VirtualScroller(externalLinksContainer, {
                rowHeight: 80,
                buffer: 25,
                renderRow: renderExternalLinkRow
            });
            console.log('External links virtual scroller initialized');
        }

        // Issues table renders grouped rows directly (no virtual scroller):
        // one row per issue type, expanded on click.
    } catch (error) {
        console.error('Error initializing virtual scrollers:', error);
    }
}

function isLinksTabActive() {
    const linksTab = document.getElementById('links-tab');
    return linksTab && linksTab.classList.contains('active');
}

function isIssuesTabActive() {
    const issuesTab = document.getElementById('issues-tab');
    return issuesTab && issuesTab.classList.contains('active');
}

function updateLinksTable(links) {
    // Create a lookup map of URL statuses from crawled URLs
    const urlStatusMap = new Map();
    if (crawlState.urls && crawlState.urls.length > 0) {
        crawlState.urls.forEach(url => {
            urlStatusMap.set(url.url, url.status_code);
        });
    }

    // Remove duplicates from links array (extra safety check)
    const uniqueLinks = [];
    const seenLinks = new Set();
    links.forEach(link => {
        const key = `${link.source_url}|${link.target_url}`;
        if (!seenLinks.has(key)) {
            seenLinks.add(key);

            // Update target status with actual crawled status if available
            const crawledStatus = urlStatusMap.get(link.target_url);
            if (crawledStatus) {
                link.target_status = crawledStatus;
            }

            uniqueLinks.push(link);
        }
    });

    // Store unfiltered links in crawlState
    crawlState.links = uniqueLinks;

    // Apply filters and update virtual scrollers
    applyLinksFilter();

    console.log(`Links loaded: ${crawlState.links.filter(l => l.is_internal).length} internal, ${crawlState.links.filter(l => !l.is_internal).length} external`);
}

function applyLinksFilter() {
    if (!crawlState.links || crawlState.links.length === 0) return;

    // Separate internal and external links
    let internalLinks = crawlState.links.filter(link => link.is_internal);
    let externalLinks = crawlState.links.filter(link => !link.is_internal);

    // Apply status code filter for internal links
    const internalStatusFilter = crawlState.filters.linksFilter.internalStatusCode;
    if (internalStatusFilter && internalStatusFilter !== 'all') {
        internalLinks = internalLinks.filter(link => {
            if (!link.target_status) return false;
            const status = parseInt(link.target_status);
            switch (internalStatusFilter) {
                case '2xx': return status >= 200 && status < 300;
                case '3xx': return status >= 300 && status < 400;
                case '4xx': return status >= 400 && status < 500;
                case '5xx': return status >= 500;
                default: return true;
            }
        });
    }

    // Apply search filter for internal links
    const internalSearch = crawlState.filters.linksFilter.internalSearch.toLowerCase();
    if (internalSearch) {
        internalLinks = internalLinks.filter(link =>
            link.source_url.toLowerCase().includes(internalSearch) ||
            link.target_url.toLowerCase().includes(internalSearch) ||
            (link.anchor_text && link.anchor_text.toLowerCase().includes(internalSearch))
        );
    }

    // Apply status code filter for external links
    const externalStatusFilter = crawlState.filters.linksFilter.externalStatusCode;
    if (externalStatusFilter && externalStatusFilter !== 'all') {
        externalLinks = externalLinks.filter(link => {
            if (!link.target_status) return false;
            const status = parseInt(link.target_status);
            switch (externalStatusFilter) {
                case '2xx': return status >= 200 && status < 300;
                case '3xx': return status >= 300 && status < 400;
                case '4xx': return status >= 400 && status < 500;
                case '5xx': return status >= 500;
                default: return true;
            }
        });
    }

    // Apply search filter for external links
    const externalSearch = crawlState.filters.linksFilter.externalSearch.toLowerCase();
    if (externalSearch) {
        externalLinks = externalLinks.filter(link =>
            link.source_url.toLowerCase().includes(externalSearch) ||
            link.target_url.toLowerCase().includes(externalSearch) ||
            (link.target_domain && link.target_domain.toLowerCase().includes(externalSearch))
        );
    }

    // Update virtual scrollers with filtered data
    if (virtualScrollers.internalLinks) {
        virtualScrollers.internalLinks.setData(internalLinks);
    }

    if (virtualScrollers.externalLinks) {
        virtualScrollers.externalLinks.setData(externalLinks);
    }
}

function filterInternalLinks(filterType) {
    crawlState.filters.linksFilter.internalStatusCode = filterType;
    applyLinksFilter();
}

function filterExternalLinks(filterType) {
    crawlState.filters.linksFilter.externalStatusCode = filterType;
    applyLinksFilter();
}

function searchInternalLinks(searchText) {
    crawlState.filters.linksFilter.internalSearch = searchText;
    applyLinksFilter();
}

function searchExternalLinks(searchText) {
    crawlState.filters.linksFilter.externalSearch = searchText;
    applyLinksFilter();
}

function updateIssuesTable(issues) {
    if (!issues || !Array.isArray(issues)) {
        issues = [];
    }

    // Store issues globally for filtering
    window.currentIssues = issues;

    const emptyState = document.getElementById('issuesEmptyState');
    const issuesTable = document.getElementById('issuesTable');

    // Count by type
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    issues.forEach(issue => {
        if (issue.type === 'error') errorCount++;
        else if (issue.type === 'warning') warningCount++;
        else if (issue.type === 'info') infoCount++;
    });

    // Update filter counts
    document.getElementById('issues-all-count').textContent = `(${issues.length})`;
    document.getElementById('issues-error-count').textContent = `(${errorCount})`;
    document.getElementById('issues-warning-count').textContent = `(${warningCount})`;
    document.getElementById('issues-info-count').textContent = `(${infoCount})`;

    // Show/hide empty state
    if (issues.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (issuesTable) issuesTable.style.display = 'none';
        renderGroupedIssues();
    } else {
        if (emptyState) emptyState.style.display = 'none';
        if (issuesTable) issuesTable.style.display = 'table';
        renderGroupedIssues();
    }

    // Update issue count in tab button (find the button, not the tab content)
    const issuesTabButton = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.textContent.includes('Issues'));
    if (issuesTabButton) {
        const totalIssues = issues.length;
        if (totalIssues > 0) {
            let badgeColor = '#3b82f6';
            if (errorCount > 0) badgeColor = '#ef4444';
            else if (warningCount > 0) badgeColor = '#f59e0b';

            issuesTabButton.innerHTML = `Issues <span style="background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 12px; font-size: 12px;">${totalIssues}</span>`;
        } else {
            issuesTabButton.innerHTML = 'Issues';
        }
    }
}

function clearAllTables() {
    // Clear virtual scrollers if they exist
    if (virtualScrollers.overview) {
        virtualScrollers.overview.clear();
    }
    if (virtualScrollers.internal) {
        virtualScrollers.internal.clear();
    }
    if (virtualScrollers.external) {
        virtualScrollers.external.clear();
    }
    if (virtualScrollers.internalLinks) {
        virtualScrollers.internalLinks.clear();
    }
    if (virtualScrollers.externalLinks) {
        virtualScrollers.externalLinks.clear();
    }
    // Clear grouped issues table (not virtualized)
    const issuesBody = document.getElementById('issuesTableBody');
    if (issuesBody) issuesBody.innerHTML = '';
    expandedIssueGroups.clear();

    // Clear status codes table (not virtualized)
    const statusCodesBody = document.getElementById('statusCodesTableBody');
    if (statusCodesBody) statusCodesBody.innerHTML = '';

    crawlState.urls = [];

    console.log('All tables cleared');
}

function formatAnalyticsInfo(analytics) {
    const detected = [];
    if (analytics.gtag || analytics.ga4_id) detected.push('GA4');
    if (analytics.google_analytics) detected.push('GA');
    if (analytics.gtm_id) detected.push('GTM');
    if (analytics.facebook_pixel) detected.push('FB');
    if (analytics.hotjar) detected.push('HJ');
    if (analytics.mixpanel) detected.push('MP');

    return detected.length > 0 ? detected.join(', ') : '';
}

function addUrlToTable(urlData) {
    // Check if URL already exists to prevent duplicates
    const existingUrl = crawlState.urls.find(u => u.url === urlData.url);
    if (existingUrl) {
        return; // Skip duplicate
    }

    crawlState.urls.push(urlData);

    // Update virtual scrollers with new data
    if (virtualScrollers.overview) {
        virtualScrollers.overview.appendData([urlData]);
    }

    if (urlData.is_internal && virtualScrollers.internal) {
        virtualScrollers.internal.appendData([urlData]);
    } else if (!urlData.is_internal && virtualScrollers.external) {
        virtualScrollers.external.appendData([urlData]);
    }

    // Reapply current filter if one is active
    if (crawlState.filters.active) {
        applyFilter(crawlState.filters.active);
    }
}

function addRowToTable(tableBodyId, rowData) {
    const tbody = document.getElementById(tableBodyId);
    const row = tbody.insertRow();

    rowData.forEach(cellData => {
        const cell = row.insertCell();
        // Check if cellData contains HTML (specifically our button)
        if (typeof cellData === 'string' && cellData.includes('<button')) {
            cell.innerHTML = cellData;
        } else {
            cell.textContent = cellData;
        }
    });
}

// Tab Management
function switchTab(tabName) {
    // Remove active class from all tabs and panes
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

    // Add active class to selected tab and pane
    event.target.classList.add('active');
    document.getElementById(tabName + '-tab').classList.add('active');

    // Load pending links data if switching to Links tab
    if (tabName === 'links' && crawlState.pendingLinks) {
        updateLinksTable(crawlState.pendingLinks);
        crawlState.pendingLinks = null; // Clear pending data
    }

    // Load pending issues data if switching to Issues tab
    if (tabName === 'issues' && crawlState.pendingIssues) {
        updateIssuesTable(crawlState.pendingIssues);
        crawlState.pendingIssues = null; // Clear pending data
    }

    // Load audit summary if switching to Audit tab
    if (tabName === 'audit') {
        loadAuditSummary();
    }

    // Initialize visualization if switching to Visualization tab
    if (tabName === 'visualization' && typeof initVisualization === 'function') {
        // Small delay to ensure the tab is visible before initializing
        setTimeout(() => {
            initVisualization();
        }, 100);
    }

}

// Issue Filtering
function filterIssues(filterType) {
    // Store the active filter
    crawlState.filters.issueFilter = filterType;

    // Update active button state; colors come from the .chip CSS classes
    document.querySelectorAll('#issues-tab .filter-bar .chip').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
    });

    // Re-render the grouped view with the type filter applied
    renderGroupedIssues();
}

/**
 * Grouped issues view (Screaming Frog style): one row per issue type with
 * URL count and % of crawled URLs; click a row to expand the affected URLs.
 */
const expandedIssueGroups = new Set();

function renderGroupedIssues() {
    const tbody = document.getElementById('issuesTableBody');
    if (!tbody) return;

    const filterType = crawlState.filters.issueFilter || 'all';
    let issues = window.currentIssues || [];
    if (filterType !== 'all') {
        issues = issues.filter(issue => issue.type === filterType);
    }

    // Group by issue name
    const groups = new Map();
    issues.forEach(issue => {
        const key = issue.issue || 'Unknown issue';
        if (!groups.has(key)) {
            groups.set(key, { name: key, type: issue.type, category: issue.category || '', items: [] });
        }
        groups.get(key).items.push(issue);
    });

    const typeRank = { error: 0, warning: 1, info: 2 };
    const sorted = [...groups.values()].sort((a, b) =>
        (typeRank[a.type] ?? 3) - (typeRank[b.type] ?? 3) || b.items.length - a.items.length);

    const totalUrls = (crawlState.urls && crawlState.urls.length) || 0;
    const badge = t => `<span class="issue-badge issue-badge-${t}">${t === 'error' ? 'Issue' : t === 'warning' ? 'Warning' : 'Opportunity'}</span>`;

    tbody.innerHTML = '';
    const MAX_DETAIL_ROWS = 200;

    sorted.forEach(g => {
        const open = expandedIssueGroups.has(g.name);
        const pct = totalUrls > 0 ? ((g.items.length / totalUrls) * 100).toFixed(2) + '%' : '—';

        const row = document.createElement('tr');
        row.className = 'issue-group-row' + (open ? ' open' : '');
        row.innerHTML = `
            <td><span class="issue-caret">▸</span>${escapeHtml(g.name)}</td>
            <td>${badge(g.type)}</td>
            <td>${escapeHtml(g.category)}</td>
            <td class="issue-num">${g.items.length.toLocaleString()}</td>
            <td class="issue-num">${pct}</td>`;
        row.addEventListener('click', () => {
            if (expandedIssueGroups.has(g.name)) expandedIssueGroups.delete(g.name);
            else expandedIssueGroups.add(g.name);
            renderGroupedIssues();
        });
        tbody.appendChild(row);

        if (!open) return;

        g.items.slice(0, MAX_DETAIL_ROWS).forEach(issue => {
            const r = document.createElement('tr');
            r.className = 'issue-detail-row';
            r.innerHTML = `
                <td colspan="3" style="word-break: break-all;" title="${escapeHtml(issue.url || '')}">${escapeHtml(issue.url || '')}</td>
                <td colspan="2" style="word-break: break-word; white-space: normal;" title="${escapeHtml(issue.details || '')}">${escapeHtml(issue.details || '')}</td>`;
            tbody.appendChild(r);
        });

        if (g.items.length > MAX_DETAIL_ROWS) {
            const r = document.createElement('tr');
            r.className = 'issue-detail-row issue-detail-more';
            r.innerHTML = `<td colspan="5">+${(g.items.length - MAX_DETAIL_ROWS).toLocaleString()} more URLs — use Export for the full list</td>`;
            tbody.appendChild(r);
        }
    });
}

// Filter Management
function toggleFilter(filterType) {
    const filterItems = document.querySelectorAll('.filter-item');
    filterItems.forEach(item => item.classList.remove('active'));

    event.currentTarget.classList.add('active');
    crawlState.filters.active = filterType;

    // Apply filter to tables
    applyFilter(filterType);
}

function applyFilter(filterType) {
    // Set current filter as active
    crawlState.filters.active = filterType;

    // Filter the data arrays and update virtual scrollers
    filterVirtualScrollerData('overview', filterType);
    filterVirtualScrollerData('internal', filterType);
    filterVirtualScrollerData('external', filterType);

    // Update Status Codes table with filtered data
    updateStatusCodesTable(filterType);

    console.log('Applied filter:', filterType);
}

function clearActiveFilters() {
    crawlState.filters.active = null;

    // Reset all virtual scrollers to show full data
    if (virtualScrollers.overview) {
        virtualScrollers.overview.setData(crawlState.urls);
    }
    if (virtualScrollers.internal) {
        const internalUrls = crawlState.urls.filter(url => url.is_internal);
        virtualScrollers.internal.setData(internalUrls);
    }
    if (virtualScrollers.external) {
        const externalUrls = crawlState.urls.filter(url => !url.is_internal);
        virtualScrollers.external.setData(externalUrls);
    }

    // Reset Status Codes table to show all data
    updateStatusCodesTable();
}

function filterVirtualScrollerData(scrollerName, filterType) {
    const scroller = virtualScrollers[scrollerName];
    if (!scroller) return;

    let filteredData = crawlState.urls;

    // Apply base filter for internal/external tables
    if (scrollerName === 'internal') {
        filteredData = filteredData.filter(url => url.is_internal);
    } else if (scrollerName === 'external') {
        filteredData = filteredData.filter(url => !url.is_internal);
    }

    // Apply user-selected filter
    if (filterType) {
        filteredData = filteredData.filter(url => {
            switch (filterType) {
                case 'internal':
                    return isInternalURL(url.url);
                case 'external':
                    return !isInternalURL(url.url);
                case '2xx':
                    return url.status_code >= 200 && url.status_code < 300;
                case '3xx':
                    return url.status_code >= 300 && url.status_code < 400;
                case '4xx':
                    return url.status_code >= 400 && url.status_code < 500;
                case '5xx':
                    return url.status_code >= 500;
                case 'no_response':
                    return (url.status_code === 0 || url.status_code === null || url.status_code === undefined)
                        && url.error_type !== 'file_too_large';
                case 'html':
                    return (url.content_type || '').toLowerCase().includes('html');
                case 'css':
                    return (url.content_type || '').toLowerCase().includes('css');
                case 'js':
                    return (url.content_type || '').toLowerCase().includes('javascript');
                case 'images':
                    return (url.content_type || '').toLowerCase().includes('image');
                default:
                    return true;
            }
        });
    }

    scroller.setData(filteredData);
}

// Legacy function - kept for compatibility but no longer used
function filterTable(tableBodyId, filterType) {
    // This function is deprecated in favor of filterVirtualScrollerData
    // Kept for backwards compatibility only
}

function isInternalURL(url) {
    if (!url || !crawlState.baseUrl) return false;
    try {
        const urlObj = new URL(url);
        const baseObj = new URL(crawlState.baseUrl);

        // Normalize domains by removing www prefix for comparison
        const urlDomain = urlObj.hostname.replace('www.', '');
        const baseDomain = baseObj.hostname.replace('www.', '');

        return urlDomain === baseDomain;
    } catch (e) {
        return false;
    }
}

function isStatusCodeRange(statusText, min, max) {
    const status = parseInt(statusText);
    return status >= min && status <= max;
}

function isContentType(contentType, type) {
    if (!contentType) return false;
    return contentType.toLowerCase().includes(type.toLowerCase());
}

function updateFilterCounts() {
    // Count URLs by type and update filter counts
    const counts = {
        internal: 0,
        external: 0,
        '2xx': 0,
        '3xx': 0,
        '4xx': 0,
        '5xx': 0,
        no_response: 0,
        html: 0,
        css: 0,
        js: 0,
        images: 0
    };

    crawlState.urls.forEach(url => {
        // Count by internal/external using corrected logic
        if (isInternalURL(url.url)) counts.internal++;
        else counts.external++;

        // Count by status code
        const statusCode = parseInt(url.status_code);
        if (statusCode >= 200 && statusCode < 300) counts['2xx']++;
        else if (statusCode >= 300 && statusCode < 400) counts['3xx']++;
        else if (statusCode >= 400 && statusCode < 500) counts['4xx']++;
        else if (statusCode >= 500) counts['5xx']++;
        else if ((url.status_code === 0 || isNaN(statusCode)) && url.error_type !== 'file_too_large') counts.no_response++;

        // Count by content type
        const contentType = url.content_type || '';
        if (contentType.includes('html')) counts.html++;
        else if (contentType.includes('css')) counts.css++;
        else if (contentType.includes('javascript')) counts.js++;
        else if (contentType.includes('image')) counts.images++;
    });

    // Update DOM
    Object.keys(counts).forEach(key => {
        const element = document.getElementById(key + '-count');
        if (element) {
            element.textContent = counts[key];
        }
    });
}

function updateStatusCodesTable(filterType = null) {
    const tbody = document.getElementById('statusCodesTableBody');
    if (!tbody) return;

    // Count status codes, respecting current filter
    const statusCounts = {};
    let filteredUrls = crawlState.urls;

    // Apply filter if specified
    if (filterType === 'internal') {
        filteredUrls = crawlState.urls.filter(url => isInternalURL(url.url));
    } else if (filterType === 'external') {
        filteredUrls = crawlState.urls.filter(url => !isInternalURL(url.url));
    } else if (filterType === '2xx') {
        filteredUrls = crawlState.urls.filter(url => {
            const status = parseInt(url.status_code);
            return status >= 200 && status < 300;
        });
    } else if (filterType === '3xx') {
        filteredUrls = crawlState.urls.filter(url => {
            const status = parseInt(url.status_code);
            return status >= 300 && status < 400;
        });
    } else if (filterType === '4xx') {
        filteredUrls = crawlState.urls.filter(url => {
            const status = parseInt(url.status_code);
            return status >= 400 && status < 500;
        });
    } else if (filterType === '5xx') {
        filteredUrls = crawlState.urls.filter(url => {
            const status = parseInt(url.status_code);
            return status >= 500;
        });
    } else if (filterType === 'no_response') {
        filteredUrls = crawlState.urls.filter(url =>
            (url.status_code === 0 || url.status_code === null || url.status_code === undefined)
            && url.error_type !== 'file_too_large'
        );
    } else if (filterType === 'html') {
        filteredUrls = crawlState.urls.filter(url => (url.content_type || '').includes('html'));
    } else if (filterType === 'css') {
        filteredUrls = crawlState.urls.filter(url => (url.content_type || '').includes('css'));
    } else if (filterType === 'js') {
        filteredUrls = crawlState.urls.filter(url => (url.content_type || '').includes('javascript'));
    } else if (filterType === 'images') {
        filteredUrls = crawlState.urls.filter(url => (url.content_type || '').includes('image'));
    }

    let totalUrls = filteredUrls.length;

    filteredUrls.forEach(url => {
        // Group status_code=0 rows by error_type so DNS / timeout / refused
        // show as distinct rows instead of collapsing into a single "0".
        const isZero = url.status_code === 0 || url.status_code === null || url.status_code === undefined;
        const key = isZero ? `0|${url.error_type || 'unknown'}` : String(url.status_code);
        statusCounts[key] = (statusCounts[key] || 0) + 1;
    });

    // Clear existing rows
    tbody.innerHTML = '';

    // Sort: real HTTP codes first (numeric), then no-response variants
    const keys = Object.keys(statusCounts).sort((a, b) => {
        const aIsZero = a.startsWith('0|');
        const bIsZero = b.startsWith('0|');
        if (aIsZero && !bIsZero) return 1;
        if (!aIsZero && bIsZero) return -1;
        if (aIsZero && bIsZero) return a.localeCompare(b);
        return parseInt(a) - parseInt(b);
    });

    keys.forEach(key => {
        const count = statusCounts[key];
        const percentage = totalUrls > 0 ? ((count / totalUrls) * 100).toFixed(1) : 0;
        let displayCode, statusText;
        if (key.startsWith('0|')) {
            const errorType = key.slice(2);
            displayCode = '0';
            statusText = getStatusCodeText(0, errorType);
        } else {
            displayCode = key;
            statusText = getStatusCodeText(parseInt(key));
        }

        addRowToTable('statusCodesTableBody', [
            displayCode,
            statusText,
            count,
            percentage + '%'
        ]);
    });
}

function getStatusCodeText(statusCode, errorType) {
    if (statusCode >= 200 && statusCode < 300) {
        return 'Success';
    } else if (statusCode >= 300 && statusCode < 400) {
        return 'Redirect';
    } else if (statusCode >= 400 && statusCode < 500) {
        return 'Client Error';
    } else if (statusCode >= 500) {
        return 'Server Error';
    } else if (statusCode === 0) {
        switch (errorType) {
            case 'dns_not_found':       return 'DNS Not Found';
            case 'connection_refused':  return 'Connection Refused';
            case 'timeout':             return 'Timeout';
            case 'ssl_error':           return 'SSL/TLS Error';
            case 'connection_error':    return 'Connection Error';
            case 'file_too_large':      return 'Skipped (file too large)';
            default:                    return 'No Response';
        }
    } else {
        return 'Unknown';
    }
}

function resetStats() {
    crawlState.stats = {
        discovered: 0,
        crawled: 0,
        depth: 0,
        speed: 0
    };
    updateStatsDisplay();
}

// Utility Functions
function normalizeUrl(input) {
    // Remove any whitespace
    input = input.trim();

    // If it already has a protocol, return as-is
    if (input.match(/^https?:\/\//i)) {
        return input;
    }

    // If it looks like a domain or IP, add https://
    if (input.match(/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]*\.([a-zA-Z]{2,}|[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/) ||
        input.match(/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/) ||
        input.match(/^localhost(:[0-9]+)?$/i) ||
        input.match(/^[a-zA-Z0-9-]+\.(com|org|net|edu|gov|mil|int|co|io|dev|app|tech|info|biz|name|pro|museum|aero|coop|travel|jobs|mobi|tel|asia|cat|post|xxx|local|test)$/i)) {
        return 'https://' + input;
    }

    // If it doesn't match common patterns, try adding https:// anyway
    return 'https://' + input;
}

function isValidUrl(string) {
    try {
        const url = new URL(string);
        // Check if it has a valid protocol and hostname
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
    } catch (_) {
        return false;
    }
}

// This is defined in settings.js - no need to redefine here

async function exportData() {
    try {
        // Get current settings to determine export format and fields
        const settingsResponse = await fetch('/api/get_settings');
        const settingsData = await settingsResponse.json();

        if (!settingsData.success) {
            showNotification('Failed to get export settings', 'error');
            return;
        }

        const settings = settingsData.settings;
        const exportFormat = settings.exportFormat || 'csv';
        const exportFields = settings.exportFields || ['url', 'status_code', 'title', 'meta_description', 'h1'];

        // Check if there's data to export - always fetch fresh data from backend
        let hasData = false;
        let exportUrls = [];
        let exportLinks = [];
        let exportIssues = [];

        // Always fetch from backend to ensure we have the latest data including links
        const status = await fetch('/api/crawl_status');
        const statusData = await status.json();

        if (statusData.urls && statusData.urls.length > 0) {
            hasData = true;
            exportUrls = statusData.urls;
            exportLinks = statusData.links || [];
            exportIssues = statusData.issues || [];
        } else if (crawlState.urls && crawlState.urls.length > 0) {
            // Fallback to local state if backend has no data (e.g., loaded crawl)
            hasData = true;
            exportUrls = crawlState.urls;
            // Get links and issues from stored state
            exportLinks = crawlState.links || [];
            exportIssues = crawlState.issues || window.currentIssues || [];
        }

        if (!hasData) {
            showNotification('No crawl data to export', 'error');
            return;
        }

        showNotification('Preparing export...', 'info');

        // Request export from backend, including local data if available
        const exportResponse = await fetch('/api/export_data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                format: exportFormat,
                fields: exportFields,
                // Send local data if we have it (for loaded crawls)
                localData: {
                    urls: exportUrls,
                    links: exportLinks,
                    issues: exportIssues
                }
            })
        });

        const exportData = await exportResponse.json();

        if (!exportData.success) {
            showNotification(exportData.error || 'Export failed', 'error');
            return;
        }

        // Check if we have multiple files to download
        if (exportData.multiple_files && exportData.files) {
            // Download each file separately
            exportData.files.forEach((file, index) => {
                setTimeout(() => {
                    const blob = new Blob([file.content], { type: file.mimetype });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = file.filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                }, index * 500); // Delay between downloads to avoid browser blocking
            });

            showNotification(`Exporting ${exportData.files.length} files...`, 'success');
        } else {
            // Single file download (original logic)
            let blobContent = exportData.content;
            if (exportData.encoding === 'base64') {
                // Binary formats (e.g. XLSX) are sent base64-encoded
                const binary = atob(exportData.content);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                blobContent = bytes;
            }
            const blob = new Blob([blobContent], { type: exportData.mimetype });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = exportData.filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            showNotification(`Export complete: ${exportData.filename}`, 'success');
        }

    } catch (error) {
        console.error('Export error:', error);
        showNotification('Export failed', 'error');
    }
}

// ===== Audit tab =====

let auditSummaryLoaded = false;

async function loadAuditSummary(force = false) {
    if (auditSummaryLoaded && !force) return;

    const container = document.getElementById('auditContent');
    if (!container) return;

    container.innerHTML = '<p style="color:#6b7280; padding: 20px;">Analyzing crawl data...</p>';

    try {
        const response = await fetch('/api/analysis/summary');
        const data = await response.json();

        if (!data.success) {
            container.innerHTML = `<p style="color:#6b7280; padding: 20px;">${escapeHtml(data.error || 'Analysis failed')}</p>`;
            return;
        }

        renderAuditSummary(data.summary);
        auditSummaryLoaded = true;
        loadSimilaritySection();
    } catch (error) {
        console.error('Audit summary error:', error);
        container.innerHTML = '<p style="color:#ef4444; padding: 20px;">Failed to load audit summary.</p>';
    }
}

function renderAuditSummary(s) {
    const container = document.getElementById('auditContent');
    if (!container) return;

    const sevColors = { critical: '#dc2626', high: '#ea580c', medium: '#d97706', low: '#98a2b3' };
    const sevBadge = sev =>
        `<span style="background:${sevColors[sev] || '#98a2b3'}; color:#fff; padding:2px 8px; border-radius:10px; font-size:12px;">${escapeHtml(sev)}</span>`;
    const card = (num, label, color) =>
        `<div class="audit-card">
            <div class="audit-card-value" ${color ? `style="color:${color};"` : ''}>${num}</div>
            <div class="audit-card-label">${label}</div>
        </div>`;

    const sev = s.severity_counts || {};
    const lr = s.link_reports || {};

    let html = '<div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px;">';
    html += card(s.site_score, 'Site score / 100');
    html += card(s.internal_pages, 'Pages crawled');
    html += card(s.total_issues, 'Issues');
    html += card(sev.critical || 0, 'Critical groups', sevColors.critical);
    html += card(sev.high || 0, 'High groups', sevColors.high);
    html += card(lr.orphan_count || 0, 'Orphan pages');
    html += card(lr.broken_internal_links_count || 0, 'Broken internal links');
    html += '</div>';

    // Top issue groups
    html += '<h3 style="font-size:15px; margin: 16px 0 8px;">Top Problems</h3>';
    const groups = s.top_issues || [];
    if (groups.length === 0) {
        html += '<p style="color:#6b7280;">No issues detected.</p>';
    } else {
        html += '<table class="data-table" style="width:100%;"><thead><tr><th>Priority</th><th>Issue</th><th>Affected</th><th>Recommended Fix</th></tr></thead><tbody>';
        groups.forEach(g => {
            const examples = (g.example_urls || []).slice(0, 3)
                .map(u => `<div style="font-size:11px; opacity:0.6; word-break:break-all;">${escapeHtml(u)}</div>`).join('');
            const cause = g.likely_cause
                ? `<div style="font-size:12px; opacity:0.7;">Likely cause: ${escapeHtml(g.likely_cause)}</div>` : '';
            html += `<tr>
                <td>${sevBadge(g.severity)}<div style="font-size:11px; opacity:0.6;">${g.priority_score}</div></td>
                <td><strong>${escapeHtml(g.issue)}</strong><div style="font-size:12px; opacity:0.6;">${escapeHtml(g.category)}</div>${cause}</td>
                <td>${g.affected_url_count} pages${examples}</td>
                <td style="font-size:13px;">${escapeHtml(g.recommended_fix)}</td>
            </tr>`;
        });
        html += '</tbody></table>';
    }

    // Clusters
    const clusters = s.clusters || [];
    if (clusters.length > 0) {
        html += '<h3 style="font-size:15px; margin: 20px 0 8px;">Content Clusters</h3>';
        html += '<table class="data-table" style="width:100%;"><thead><tr><th>Cluster</th><th>Pages</th><th>Avg Authority</th><th>Top Page</th><th>Orphans</th></tr></thead><tbody>';
        clusters.slice(0, 15).forEach(c => {
            const topPage = c.top_authority_page ? c.top_authority_page.url : '-';
            html += `<tr>
                <td>${escapeHtml(c.name)}</td>
                <td>${c.size}</td>
                <td>${c.avg_authority !== null && c.avg_authority !== undefined ? c.avg_authority : '-'}</td>
                <td style="font-size:12px; word-break:break-all;">${escapeHtml(topPage)}</td>
                <td>${c.orphan_count || 0}</td>
            </tr>`;
        });
        html += '</tbody></table>';
    }

    html += '<div id="auditSimilarity"><p style="color:#6b7280; margin-top:20px;">Analyzing content similarity...</p></div>';

    container.innerHTML = html;
}

async function loadSimilaritySection() {
    const el = document.getElementById('auditSimilarity');
    if (!el) return;

    try {
        const response = await fetch('/api/analysis/content_similarity');
        const data = await response.json();

        if (!data.success) {
            el.innerHTML = '';
            return;
        }
        renderSimilaritySection(el, data);
    } catch (error) {
        console.error('Similarity analysis error:', error);
        el.innerHTML = '';
    }
}

function renderSimilaritySection(el, data) {
    const gradeColors = { F: '#dc2626', D: '#ea580c', C: '#d97706', B: '#65a30d', A: '#16a34a' };
    const gradeBadge = g =>
        `<span style="background:${gradeColors[g] || '#95a5a6'}; color:#fff; padding:2px 10px; border-radius:10px; font-size:13px; font-weight:700;">${g}</span>`;

    let html = '<h3 style="font-size:15px; margin: 20px 0 4px;">Similar Content</h3>';
    html += `<p style="font-size:12px; color:#6b7280; margin: 0 0 8px;">Content similarity from titles, descriptions and headings (${data.analyzed_count} pages analyzed). F = near-duplicates that need consolidation, A = mild overlap.</p>`;

    const clusters = data.clusters || [];
    if (clusters.length === 0) {
        html += '<p style="color:#6b7280;">No similar-content clusters found.</p>';
    } else {
        html += '<table class="data-table" style="width:100%;"><thead><tr><th>Grade</th><th>Pages</th><th>Avg Similarity</th><th>Examples</th></tr></thead><tbody>';
        clusters.slice(0, 15).forEach(c => {
            const examples = c.urls.slice(0, 3)
                .map(u => `<div style="font-size:11px; opacity:0.6; word-break:break-all;">${escapeHtml(u)}</div>`).join('');
            const more = c.size > 3 ? `<div style="font-size:11px; opacity:0.5;">+${c.size - 3} more</div>` : '';
            html += `<tr>
                <td>${gradeBadge(c.grade)}</td>
                <td>${c.size}</td>
                <td>${(c.avg_similarity * 100).toFixed(0)}%</td>
                <td>${examples}${more}</td>
            </tr>`;
        });
        html += '</tbody></table>';
        if (clusters.length > 15) {
            html += `<p style="font-size:12px; color:#6b7280;">+${clusters.length - 15} more clusters</p>`;
        }
    }

    const lowRel = data.low_relevance_pages || [];
    if (lowRel.length > 0) {
        html += '<h3 style="font-size:15px; margin: 16px 0 4px;">Low Relevance Pages</h3>';
        html += '<p style="font-size:12px; color:#6b7280; margin: 0 0 8px;">Pages far from the site\'s overall content theme — possibly off-topic or thin.</p>';
        html += lowRel.slice(0, 10).map(r =>
            `<div style="font-size:12px; word-break:break-all; opacity:0.8;">${escapeHtml(r.url)} <span style="opacity:0.6;">(relevance ${(r.relevance_score * 100).toFixed(0)}%)</span></div>`).join('');
        if (lowRel.length > 10) {
            html += `<p style="font-size:12px; color:#6b7280;">+${lowRel.length - 10} more</p>`;
        }
    }

    el.innerHTML = html;
}

function downloadHtmlReport() {
    window.open('/api/report/html', '_blank');
}

// Helper function to escape HTML for safe display
function escapeHtml(text) {
    if (!text) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showUrlDetails(url) {
    // Find the URL data
    const urlData = crawlState.urls.find(u => u.url === url);
    if (!urlData) {
        showNotification('URL data not found', 'error');
        return;
    }

    // Escape all user-controlled text fields to prevent HTML injection
    const safeUrl = escapeHtml(url);
    const safeTitle = escapeHtml(urlData.title) || 'N/A';
    const safeH1 = escapeHtml(urlData.h1) || 'N/A';
    const safeMetaDesc = escapeHtml(urlData.meta_description) || 'N/A';
    const safeLang = escapeHtml(urlData.lang) || 'N/A';
    const safeCharset = escapeHtml(urlData.charset) || 'N/A';
    const safeCanonical = escapeHtml(urlData.canonical_url) || 'N/A';
    const safeRobots = escapeHtml(urlData.robots) || 'N/A';
    const safeContentType = escapeHtml(urlData.content_type) || 'N/A';
    const safeGa4Id = escapeHtml(urlData.analytics?.ga4_id) || 'N/A';
    const safeGtmId = escapeHtml(urlData.analytics?.gtm_id) || 'N/A';

    // Create modal content
    const modalContent = `
        <div class="details-modal-overlay" onclick="closeUrlDetails()">
            <div class="details-modal" onclick="event.stopPropagation()">
                <div class="details-header">
                    <h3>Comprehensive URL Analysis</h3>
                    <button class="close-btn" onclick="closeUrlDetails()">×</button>
                </div>
                <div class="details-content">
                    <div class="details-url">${safeUrl}</div>

                    <div class="details-sections">
                        <div class="details-section">
                            <h4>🔍 Basic SEO</h4>
                            <div class="details-grid">
                                <div><strong>Title:</strong> ${safeTitle}</div>
                                <div><strong>H1:</strong> ${safeH1}</div>
                                <div><strong>Meta Description:</strong> ${safeMetaDesc}</div>
                                <div><strong>Word Count:</strong> ${urlData.word_count || 0}</div>
                                <div><strong>Language:</strong> ${safeLang}</div>
                                <div><strong>Charset:</strong> ${safeCharset}</div>
                                <div><strong>Canonical URL:</strong> ${safeCanonical}</div>
                                <div><strong>Robots Meta:</strong> ${safeRobots}</div>
                            </div>
                        </div>

                        <div class="details-section">
                            <h4>📊 Analytics & Tracking</h4>
                            <div class="details-grid">
                                <div><strong>Google Analytics:</strong> ${urlData.analytics?.google_analytics ? '✅ Yes' : '❌ No'}</div>
                                <div><strong>GA4/Gtag:</strong> ${urlData.analytics?.gtag ? '✅ Yes' : '❌ No'}</div>
                                <div><strong>GA4 ID:</strong> ${safeGa4Id}</div>
                                <div><strong>GTM ID:</strong> ${safeGtmId}</div>
                                <div><strong>Facebook Pixel:</strong> ${urlData.analytics?.facebook_pixel ? '✅ Yes' : '❌ No'}</div>
                                <div><strong>Hotjar:</strong> ${urlData.analytics?.hotjar ? '✅ Yes' : '❌ No'}</div>
                                <div><strong>Mixpanel:</strong> ${urlData.analytics?.mixpanel ? '✅ Yes' : '❌ No'}</div>
                            </div>
                        </div>

                        <div class="details-section">
                            <h4>📱 Social Media</h4>
                            <div class="details-grid">
                                <div><strong>OpenGraph Tags:</strong> ${Object.keys(urlData.og_tags || {}).length} found</div>
                                <div><strong>Twitter Cards:</strong> ${Object.keys(urlData.twitter_tags || {}).length} found</div>
                            </div>
                            ${Object.keys(urlData.og_tags || {}).length > 0 ? `
                                <div class="details-subsection">
                                    <h5>OpenGraph Tags:</h5>
                                    ${Object.entries(urlData.og_tags || {}).map(([key, value]) =>
                                        `<div><strong>og:${escapeHtml(key)}:</strong> ${escapeHtml(value)}</div>`
                                    ).join('')}
                                </div>
                            ` : ''}
                            ${Object.keys(urlData.twitter_tags || {}).length > 0 ? `
                                <div class="details-subsection">
                                    <h5>Twitter Cards:</h5>
                                    ${Object.entries(urlData.twitter_tags || {}).map(([key, value]) =>
                                        `<div><strong>twitter:${escapeHtml(key)}:</strong> ${escapeHtml(value)}</div>`
                                    ).join('')}
                                </div>
                            ` : ''}
                        </div>

                        <div class="details-section">
                            <h4>🔗 Links & Structure</h4>
                            <div class="details-grid">
                                <div><strong>Internal Links:</strong> ${urlData.internal_links || 0}</div>
                                <div><strong>External Links:</strong> ${urlData.external_links || 0}</div>
                                <div><strong>Images:</strong> ${(urlData.images || []).length}</div>
                                <div><strong>H2 Tags:</strong> ${(urlData.h2 || []).length}</div>
                                <div><strong>H3 Tags:</strong> ${(urlData.h3 || []).length}</div>
                            </div>
                        </div>

                        <div class="details-section">
                            <h4>⚡ Performance</h4>
                            <div class="details-grid">
                                <div><strong>Status Code:</strong> ${urlData.status_code}${urlData.error_type ? ' (' + escapeHtml(getStatusCodeText(parseInt(urlData.status_code) || 0, urlData.error_type)) + ')' : ''}</div>
                                <div><strong>Response Time:</strong> ${urlData.response_time || 0}ms</div>
                                <div><strong>Content Type:</strong> ${safeContentType}</div>
                                <div><strong>Size:</strong> ${urlData.size || 0} bytes</div>
                                ${urlData.error ? `<div><strong>Error:</strong> ${escapeHtml(urlData.error)}</div>` : ''}
                            </div>
                        </div>

                        ${(urlData.linked_from && urlData.linked_from.length > 0) ? `
                        <div class="details-section">
                            <h4>🔗 Linked From</h4>
                            <div class="details-grid">
                                <div><strong>Found on ${urlData.linked_from.length} page${urlData.linked_from.length !== 1 ? 's' : ''}:</strong></div>
                            </div>
                            <div class="details-subsection">
                                <ul style="list-style: none; padding: 0; margin: 10px 0;">
                                    ${urlData.linked_from.slice(0, 20).map(sourceUrl => {
                                        const escapedUrl = escapeHtml(sourceUrl);
                                        return `<li style="padding: 5px 0; word-break: break-all;"><a href="${escapedUrl}" target="_blank" style="color: #116e3d; text-decoration: none;">${escapedUrl}</a></li>`;
                                    }).join('')}
                                    ${urlData.linked_from.length > 20 ? `<li style="padding: 5px 0; font-style: italic; color: #9ca3af;">... and ${urlData.linked_from.length - 20} more</li>` : ''}
                                </ul>
                            </div>
                        </div>
                        ` : ''}

                        <div class="details-section">
                            <h4>🏗️ Structured Data</h4>
                            <div class="details-grid">
                                <div><strong>JSON-LD Scripts:</strong> ${(urlData.json_ld || []).length}</div>
                                <div><strong>Schema.org Items:</strong> ${(urlData.schema_org || []).length}</div>
                            </div>
                            ${(urlData.json_ld || []).length > 0 ? `
                                <div class="details-subsection">
                                    <h5>JSON-LD Data:</h5>
                                    <pre class="json-preview">${escapeHtml(JSON.stringify(urlData.json_ld, null, 2))}</pre>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalContent);
}

function closeUrlDetails() {
    const modal = document.querySelector('.details-modal-overlay');
    if (modal) {
        modal.remove();
    }
}

// Save/Load Crawl Functions
async function saveCrawl() {
    try {
        if (crawlState.stats.crawled === 0) {
            showNotification('No crawl data to save', 'error');
            return;
        }

        // Get current crawl data from backend or use local state
        let urls = crawlState.urls;
        let links = crawlState.links;
        let issues = crawlState.issues;
        let stats = crawlState.stats;

        // Try to get fresh data from backend if available
        try {
            const status = await fetch('/api/crawl_status');
            const crawlData = await status.json();
            if (crawlData.urls && crawlData.urls.length > 0) {
                urls = crawlData.urls;
                links = crawlData.links || links;
                issues = crawlData.issues || issues;
                // Keep latest stats
                if (crawlData.stats) {
                    stats = crawlData.stats;
                }
            }
        } catch (e) {
            console.log('Using local state for save:', e);
        }

        // Add metadata
        const saveData = {
            timestamp: new Date().toISOString(),
            baseUrl: crawlState.baseUrl,
            stats: stats,
            urls: urls,
            links: links,
            issues: issues,
            version: '1.1'
        };

        // Create and download the file
        const blob = new Blob([JSON.stringify(saveData, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;

        // Generate filename with domain and timestamp
        const domain = crawlState.baseUrl ? new URL(crawlState.baseUrl).hostname : 'crawl';
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        a.download = `crawlyx_${domain}_${timestamp}.json`;

        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showNotification('Crawl saved successfully', 'success');

    } catch (error) {
        console.error('Save error:', error);
        showNotification('Failed to save crawl', 'error');
    }
}

function loadCrawl() {
    // Create file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';

    fileInput.addEventListener('change', async function(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const saveData = JSON.parse(text);

            // Validate save data
            if (!saveData.version || !saveData.urls || !saveData.stats) {
                showNotification('Invalid crawl file format', 'error');
                return;
            }

            // Clear current data
            clearAllTables();
            resetStats();

            // Load the data
            crawlState.baseUrl = saveData.baseUrl;
            crawlState.stats = saveData.stats;
            crawlState.urls = [];
            crawlState.links = saveData.links || [];
            crawlState.issues = saveData.issues || [];

            // Update UI
            document.getElementById('urlInput').value = saveData.baseUrl || '';
            if (typeof refreshDomainRating === 'function') {
                refreshDomainRating(saveData.baseUrl || '');
            }
            updateStatsDisplay();

            // Populate tables with loaded data
            if (saveData.urls && saveData.urls.length > 0) {
                console.log(`Loading ${saveData.urls.length} URLs...`);

                // Clear crawlState.urls first to avoid duplicate check issues
                crawlState.urls = [];

                // Add URLs to tables (addUrlToTable will handle adding to crawlState.urls)
                saveData.urls.forEach(url => {
                    // Debug: check if url has is_internal flag
                    if (url.is_internal === undefined) {
                        console.warn('URL missing is_internal flag:', url.url);
                        // Try to determine is_internal based on domain
                        if (crawlState.baseUrl) {
                            try {
                                const urlDomain = new URL(url.url).hostname.replace('www.', '');
                                const baseDomain = new URL(crawlState.baseUrl).hostname.replace('www.', '');
                                url.is_internal = urlDomain === baseDomain;
                            } catch (e) {
                                url.is_internal = false;
                            }
                        }
                    }
                    addUrlToTable(url);
                });

                console.log(`Added ${crawlState.urls.length} URLs to state`);
                console.log('Sample URL data:', crawlState.urls[0]);
            }

            // Load links data
            if (saveData.links && saveData.links.length > 0) {
                console.log(`Loading ${saveData.links.length} links...`);
                crawlState.pendingLinks = saveData.links;
                // If Links tab is currently active, load them immediately
                if (isLinksTabActive()) {
                    updateLinksTable(saveData.links);
                }
            }

            // Load issues data if present - filter them based on current exclusion settings
            if (saveData.issues && saveData.issues.length > 0) {
                console.log(`Loading ${saveData.issues.length} issues...`);

                // Filter issues using current exclusion patterns
                try {
                    const filterResponse = await fetch('/api/filter_issues', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ issues: saveData.issues })
                    });
                    const filterData = await filterResponse.json();

                    const filteredIssues = filterData.success ? filterData.issues : saveData.issues;
                    console.log(`Filtered to ${filteredIssues.length} issues after exclusions`);

                    crawlState.issues = filteredIssues;
                    crawlState.pendingIssues = filteredIssues;

                    // If Issues tab is currently active, load them immediately
                    if (isIssuesTabActive()) {
                        updateIssuesTable(filteredIssues);
                    } else {
                        // Update the badge count even if tab is not active
                        const issuesTabButton = Array.from(document.querySelectorAll('.tab-btn')).find(btn => btn.textContent.includes('Issues'));
                        if (issuesTabButton) {
                            const errorCount = filteredIssues.filter(i => i.type === 'error').length;
                            const warningCount = filteredIssues.filter(i => i.type === 'warning').length;
                            let badgeColor = '#3b82f6';
                            if (errorCount > 0) badgeColor = '#ef4444';
                            else if (warningCount > 0) badgeColor = '#f59e0b';
                            issuesTabButton.innerHTML = `Issues <span style="background: ${badgeColor}; color: white; padding: 2px 6px; border-radius: 12px; font-size: 12px;">${filteredIssues.length}</span>`;
                        }
                    }
                } catch (error) {
                    console.error('Failed to filter issues:', error);
                    // Fall back to unfiltered issues if filtering fails
                    crawlState.issues = saveData.issues;
                    crawlState.pendingIssues = saveData.issues;
                    if (isIssuesTabActive()) {
                        updateIssuesTable(saveData.issues);
                    }
                }
            }

            // Update all secondary data
            updateFilterCounts();
            updateStatusCodesTable();
            updateCrawlButtons();

            // Force refresh of all tables
            setTimeout(() => {
                console.log('Force refreshing tables...');
                const overviewCount = document.getElementById('overviewTableBody').children.length;
                const internalCount = document.getElementById('internalTableBody').children.length;
                const externalCount = document.getElementById('externalTableBody').children.length;
                console.log(`Table counts - Overview: ${overviewCount}, Internal: ${internalCount}, External: ${externalCount}`);
            }, 100);

            // Update visualization if it exists and has been initialized
            if (typeof window.updateVisualizationFromLoadedData === 'function') {
                window.updateVisualizationFromLoadedData(saveData.urls, saveData.links);
            }

            showNotification(`Crawl loaded: ${saveData.stats.crawled} URLs from ${new Date(saveData.timestamp).toLocaleDateString()}`, 'success');

        } catch (error) {
            console.error('Load error:', error);
            showNotification('Failed to load crawl file', 'error');
        }
    });

    // Trigger file selection
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
}

// ========================================
// Virtual Scroller Render Functions
// ========================================

function renderOverviewRow(row, urlData, index) {
    const analyticsInfo = formatAnalyticsInfo(urlData.analytics || {});
    const ogTagsCount = Object.keys(urlData.og_tags || {}).length;
    const jsonLdCount = (urlData.json_ld || []).length;
    const linksInfo = `${urlData.internal_links || 0}/${urlData.external_links || 0}`;
    const imagesCount = (urlData.images || []).length;
    const jsRendered = urlData.javascript_rendered ? '✅ JS' : '';

    const cells = [
        urlData.url,
        urlData.status_code,
        urlData.title || '',
        (urlData.meta_description || '').substring(0, 50) + (urlData.meta_description && urlData.meta_description.length > 50 ? '...' : ''),
        urlData.h1 || '',
        urlData.word_count || 0,
        urlData.response_time || 0,
        analyticsInfo,
        ogTagsCount > 0 ? `${ogTagsCount} tags` : '',
        jsonLdCount > 0 ? `${jsonLdCount} scripts` : '',
        linksInfo,
        imagesCount > 0 ? `${imagesCount} images` : '',
        jsRendered,
        `<button class="details-btn" onclick="showUrlDetails('${urlData.url.replace(/'/g, "\\'")}')">📊 Details</button>`
    ];

    cells.forEach(cellData => {
        const cell = document.createElement('td');
        if (typeof cellData === 'string' && cellData.includes('<button')) {
            cell.innerHTML = cellData;
        } else {
            cell.textContent = cellData;
        }
        row.appendChild(cell);
    });
}

function renderInternalRow(row, urlData, index) {
    const cells = [
        urlData.url,
        urlData.status_code,
        urlData.content_type || '',
        urlData.size || 0,
        urlData.title || ''
    ];

    cells.forEach(cellData => {
        const cell = document.createElement('td');
        cell.textContent = cellData;
        row.appendChild(cell);
    });
}

function renderExternalRow(row, urlData, index) {
    const cells = [
        urlData.url,
        urlData.status_code,
        urlData.content_type || '',
        urlData.size || 0,
        urlData.title || ''
    ];

    cells.forEach(cellData => {
        const cell = document.createElement('td');
        cell.textContent = cellData;
        row.appendChild(cell);
    });
}

function renderInternalLinkRow(row, link, index) {
    const statusBadge = link.target_status ? `<span class="status-badge status-${Math.floor(link.target_status / 100)}xx">${link.target_status}</span>` : '';
    const placement = link.placement ? link.placement.charAt(0).toUpperCase() + link.placement.slice(1) : 'Unknown';

    row.innerHTML = `
        <td style="word-break: break-all;">${link.source_url}</td>
        <td style="word-break: break-all;">${link.target_url}</td>
        <td>${statusBadge}</td>
        <td>${link.anchor_text || ''}</td>
        <td>${placement}</td>
    `;
}

function renderExternalLinkRow(row, link, index) {
    const statusBadge = link.target_status ? `<span class="status-badge status-${Math.floor(link.target_status / 100)}xx">${link.target_status}</span>` : '';
    const placement = link.placement ? link.placement.charAt(0).toUpperCase() + link.placement.slice(1) : 'Unknown';

    row.innerHTML = `
        <td style="word-break: break-all;">${link.source_url}</td>
        <td style="word-break: break-all;">${link.target_url}</td>
        <td>${statusBadge}</td>
        <td>${link.target_domain || ''}</td>
        <td>${placement}</td>
    `;
}

function openDemoVideo() {
    const modal = document.getElementById('demoModal');
    const video = document.getElementById('demoVideo');
    if (!modal) return;
    modal.style.display = 'flex';
    if (video) video.currentTime = 0;
}

function closeDemoVideo() {
    const modal = document.getElementById('demoModal');
    const video = document.getElementById('demoVideo');
    if (modal) modal.style.display = 'none';
    if (video) video.pause();
}

