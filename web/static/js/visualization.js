/**
 * Site Structure Visualization
 *
 * Two sideways tree views (Screaming Frog style), aggregated server-side:
 *  - Crawl Tree (default): hierarchy by shortest link path, depth <= 5.
 *  - Authority Flow: pages hang off the source passing them the most
 *    authority, depth <= 3; stronger flow = brighter, thicker line.
 *
 * Click a node to re-root its tree; '+N more' groups re-root at the parent.
 */

let cy = null;
let vizMode = 'crawltree';     // 'crawltree' | 'authority'
let vizFocus = null;           // root URL of the current tree

const CLUSTER_PALETTE = [
    '#7c3aed', '#0e9f6e', '#2563eb', '#d97706', '#db2777',
    '#0d9488', '#ea580c', '#65a30d', '#0891b2', '#c026d3'
];

function clusterColor(index) {
    return CLUSTER_PALETTE[(index || 0) % CLUSTER_PALETTE.length];
}

function statusColor(code) {
    if (code >= 200 && code < 300) return '#16a34a';
    if (code >= 300 && code < 400) return '#2563eb';
    if (code >= 400 && code < 500) return '#d97706';
    if (code >= 500) return '#dc2626';
    return '#98a2b3';
}

/**
 * Edge color for authority flow: interpolate from a faint gray (weak)
 * to a deep emerald (strong), so the strongest flows stand out on the
 * light background.
 */
function flowColor(t) {
    const weak = [203, 209, 216];  // #cbd1d8
    const strong = [17, 110, 61];  // #116e3d
    const c = weak.map((w, i) => Math.round(w + (strong[i] - w) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Initialize when the tab is opened
 */
function initVisualization() {
    if (cy) return;

    const container = document.getElementById('cy');
    if (!container) return;

    cy = cytoscape({
        container: container,
        elements: [],
        style: [
            {
                selector: 'node',
                style: {
                    'background-color': 'data(color)',
                    'label': 'data(label)',
                    'width': 'data(size)',
                    'height': 'data(size)',
                    'font-size': '10px',
                    'color': '#3d4654',
                    'text-outline-color': '#ffffff',
                    'text-outline-width': 2,
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': 4,
                    'text-wrap': 'ellipsis',
                    'text-max-width': '110px',
                    'overlay-opacity': 0,
                    'border-width': 1.5,
                    'border-color': 'rgba(16,24,40,0.18)'
                }
            },
            {
                // Sideways tree nodes (crawl tree / authority flow):
                // small open circles with the label beside them, SF-style
                selector: 'node[?sideways]',
                style: {
                    'text-valign': 'center',
                    'text-halign': 'right',
                    'text-margin-x': 6,
                    'text-margin-y': 0,
                    'text-max-width': '190px'
                }
            },
            {
                selector: 'node[?open]',
                style: {
                    'background-color': '#ffffff',
                    'border-color': 'data(color)',
                    'border-width': 2
                }
            },
            {
                selector: 'node[type="dir"]',
                style: {
                    'shape': 'round-rectangle',
                    'font-size': '11px',
                    'font-weight': 'bold',
                    'color': '#14181f',
                    'border-width': 2,
                    'border-color': 'rgba(16,24,40,0.25)'
                }
            },
            {
                selector: 'node[type="pagegroup"]',
                style: {
                    'font-size': '10px',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'text-margin-y': 0,
                    'color': '#ffffff',
                    'text-outline-width': 0,
                    'font-weight': 'bold',
                    'border-width': 0
                }
            },
            {
                selector: 'node[type="group"]',
                style: {
                    'shape': 'round-rectangle',
                    'border-style': 'dashed',
                    'border-color': '#98a2b3',
                    'color': '#5b6572',
                    'text-wrap': 'wrap',
                    'text-max-width': '150px'
                }
            },
            {
                selector: 'node[type="problem"]',
                style: {
                    'border-color': '#b91c1c',
                    'border-width': 2
                }
            },
            {
                selector: 'node[?is_orphan]',
                style: {
                    'border-style': 'dashed',
                    'border-color': '#dc2626',
                    'border-width': 2.5
                }
            },
            {
                selector: 'node[?is_root]',
                style: {
                    'border-color': '#14181f',
                    'border-width': 3,
                    'font-size': '12px',
                    'font-weight': 'bold',
                    'color': '#14181f',
                    'text-halign': 'left',
                    'text-margin-x': -6
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-color': '#178a4e',
                    'border-width': 3
                }
            },
            {
                selector: 'node.dimmed',
                style: { 'opacity': 0.25 }
            },
            {
                selector: 'edge',
                style: {
                    'width': 1.2,
                    'line-color': '#c4ccd6',
                    'target-arrow-color': '#c4ccd6',
                    'target-arrow-shape': 'triangle',
                    'arrow-scale': 0.7,
                    'curve-style': 'bezier',
                    'opacity': 0.75
                }
            },
            {
                selector: 'edge[width]',
                style: {
                    'width': 'data(width)'
                }
            },
            {
                // Authority edges: brightness + width encode flow strength
                selector: 'edge[flowColor]',
                style: {
                    'line-color': 'data(flowColor)',
                    'target-arrow-color': 'data(flowColor)',
                    'opacity': 'data(flowOpacity)'
                }
            },
            {
                // Sideways tree connectors: smooth horizontal S-curves that
                // leave the parent flat and arrive at the child flat
                // (d3-style cubic links, as in Screaming Frog's tree graph)
                selector: 'edge.tree-edge',
                style: {
                    'curve-style': 'unbundled-bezier',
                    'edge-distances': 'node-position',
                    'control-point-distances': ele => treeEdgeGeometry(ele).distances,
                    'control-point-weights': ele => treeEdgeGeometry(ele).weights,
                    'target-arrow-shape': 'none',
                    'opacity': 0.55
                }
            },
            {
                selector: 'edge.dimmed',
                style: { 'opacity': 0.1 }
            }
        ],
        layout: { name: 'preset' },
        wheelSensitivity: 0.2,
        minZoom: 0.1,
        maxZoom: 3
    });

    setupInteractions();
    loadFlowGraph(vizMode);
}

/**
 * Tooltips and click/drill interactions
 */
function setupInteractions() {
    let tooltip = null;

    function getTooltip() {
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'cy-tooltip';
            tooltip.style.display = 'none';
            document.body.appendChild(tooltip);
        }
        return tooltip;
    }

    cy.on('mouseover', 'node', function(event) {
        const d = event.target.data();
        const tip = getTooltip();

        if (d.type === 'group') {
            tip.innerHTML = `
                <div class="tooltip-url">${escapeVizHtml(d.label)}</div>
                <div class="tooltip-info">${d.reroot_url ? '<div style="opacity:0.7;">Click to expand from here</div>' : ''}</div>`;
        } else {
            tip.innerHTML = `
                <div class="tooltip-url">${escapeVizHtml(truncateUrl(d.url || '', 60))}</div>
                <div class="tooltip-info">
                    ${d.authority !== undefined ? `<div><strong>Authority:</strong> ${d.authority}</div>` : ''}
                    <div>Status: ${d.status_code}</div>
                    ${d.child_count ? `<div><strong>Children:</strong> ${d.child_count}</div>` : ''}
                    ${d.is_orphan ? '<div style="color:#dc2626;">Orphan page</div>' : ''}
                    <div style="opacity:0.7;">Click to re-root &middot; double-click to open</div>
                </div>`;
        }
        tip.style.display = 'block';
    });

    cy.on('mousemove', 'node', function(event) {
        const tip = getTooltip();
        tip.style.left = (event.originalEvent.pageX + 10) + 'px';
        tip.style.top = (event.originalEvent.pageY + 10) + 'px';
    });

    cy.on('mouseout', 'node', function() {
        getTooltip().style.display = 'none';
    });

    cy.on('dblclick', 'node', function(event) {
        const d = event.target.data();
        if (d.url) window.open(d.url, '_blank');
    });

    cy.on('tap', 'node', function(event) {
        const d = event.target.data();

        if (d.type === 'group' && d.reroot_url) {
            loadFlowGraph(vizMode, d.reroot_url);
            return;
        }
        if (d.type === 'page' && !d.is_root) {
            loadFlowGraph(vizMode, d.url);
            return;
        }

        // Root tap: highlight direct neighborhood
        cy.elements().removeClass('dimmed');
        const neighborhood = event.target.neighborhood().add(event.target);
        cy.elements().not(neighborhood).addClass('dimmed');
    });

    cy.on('tap', function(event) {
        if (event.target === cy) {
            cy.elements().removeClass('dimmed');
        }
    });
}

/**
 * Switch mode from the select
 */
function changeVizMode(mode) {
    vizMode = mode === 'authority' ? 'authority' : 'crawltree';
    vizFocus = null;

    if (!cy) {
        initVisualization();
        return;
    }
    loadFlowGraph(vizMode);
}

/**
 * Fetch a graph from the backend and render it
 */
async function loadFlowGraph(mode, focus = null) {
    let url = `/api/visualization/graph?mode=${encodeURIComponent(mode)}`;
    if (focus) url += `&focus=${encodeURIComponent(focus)}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
            showVizMessage(data.error || 'No crawl data to visualize');
            return;
        }

        vizMode = mode;
        vizFocus = focus;

        const nodes = data.nodes.map(n => {
            const d = n.data;
            d.sideways = true;
            if (d.type === 'group') {
                d.color = '#8b95a5';
            } else {
                // Uniform small open circles, SF-style; ring color carries
                // the meaning (status in crawl tree, cluster in authority)
                d.color = mode === 'authority'
                    ? clusterColor(d.cluster_index)
                    : statusColor(d.status_code);
                d.open = true;
                d.size = d.is_root ? 18 : 13;
            }
            return { data: d };
        });

        // Authority edges: stronger flow = brighter + more opaque line
        const maxFlow = Math.max(...data.edges.map(e => e.data.flow || 0), 0);
        const edges = data.edges.map(e => {
            const d = e.data;
            if (d.flow !== undefined && maxFlow > 0) {
                const t = Math.sqrt(d.flow / maxFlow);  // sqrt: mid flows stay visible
                d.flowColor = flowColor(t);
                d.flowOpacity = +(0.35 + 0.6 * t).toFixed(2);
            }
            return { data: d };
        });

        cy.elements().remove();
        cy.add([...nodes, ...edges]).edges().addClass('tree-edge');
        applyFlowLayout(mode);

        updateVizBreadcrumb();
        renderVizLegend(mode, data.clusters);

        const container = document.getElementById('cy');
        const placeholder = container && container.querySelector('.graph-placeholder');
        if (placeholder) placeholder.style.display = 'none';

    } catch (error) {
        console.error('Error loading graph:', error);
        showVizMessage('Failed to load visualization data');
    }
}

/**
 * Refresh current view (called by app.js when crawl data changes)
 */
function loadVisualizationData() {
    if (!cy) return;
    loadFlowGraph(vizMode, vizFocus);
}

function applyFlowLayout(mode) {
    layoutSidewaysTree();
}

/**
 * Tidy tree layout (Screaming Frog crawl-tree style):
 * root at the left, one column per depth level, leaves stacked evenly,
 * and every parent vertically centered on its children's band.
 */
function layoutSidewaysTree() {
    const COL_WIDTH = 270;   // horizontal gap between depth columns
    const ROW_HEIGHT = 32;   // vertical gap between leaf rows

    // Build the parent->children map; edge insertion order preserves the
    // server's ranking, so children stay sorted top-to-bottom
    const children = {};
    const hasParent = new Set();
    cy.edges().forEach(e => {
        const s = e.source().id(), t = e.target().id();
        (children[s] = children[s] || []).push(t);
        hasParent.add(t);
    });

    let rootId = null;
    cy.nodes().forEach(n => {
        if (n.data('is_root')) rootId = n.id();
    });
    if (!rootId) {
        const roots = cy.nodes().filter(n => !hasParent.has(n.id()));
        rootId = roots.length ? roots[0].id() : (cy.nodes().length ? cy.nodes()[0].id() : null);
    }
    if (!rootId) return;

    const positions = {};
    let nextRow = 0;
    const visited = new Set();

    (function place(id, depth) {
        if (visited.has(id)) return;
        visited.add(id);

        const kids = (children[id] || []).filter(k => !visited.has(k));
        if (kids.length === 0) {
            positions[id] = { x: depth * COL_WIDTH, y: nextRow * ROW_HEIGHT };
            nextRow++;
        } else {
            kids.forEach(k => place(k, depth + 1));
            const ys = kids.map(k => positions[k].y);
            positions[id] = {
                x: depth * COL_WIDTH,
                y: (Math.min(...ys) + Math.max(...ys)) / 2
            };
        }
    })(rootId, 0);

    // Anything disconnected stacks below the tree
    cy.nodes().forEach(n => {
        if (!positions[n.id()]) {
            positions[n.id()] = { x: 0, y: nextRow * ROW_HEIGHT };
            nextRow++;
        }
    });

    cy.nodes().positions(n => positions[n.id()]);
    cy.fit(50);
}

/**
 * Control points for a horizontal cubic link between two placed nodes:
 * the curve leaves the source flat and enters the target flat, bending
 * in the middle (control points at mid-x on each node's row).
 */
function treeEdgeGeometry(ele) {
    const s = ele.source().position();
    const t = ele.target().position();
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return { distances: [0, 0], weights: [0.25, 0.75] };
    const len = Math.sqrt(len2);
    return {
        distances: [-(dx * dy) / (2 * len), (dx * dy) / (2 * len)],
        weights: [(dx * dx / 2) / len2, (dx * dx / 2 + dy * dy) / len2]
    };
}

/**
 * Breadcrumb / context bar
 */
function updateVizBreadcrumb() {
    const el = document.getElementById('vizBreadcrumb');
    if (!el) return;
    el.style.display = 'block';

    const link = (label, onclick) =>
        `<a href="#" onclick="${onclick}; return false;" style="color:#116e3d; text-decoration:none; font-weight:600;">${escapeVizHtml(label)}</a>`;
    const sep = ' <span style="opacity:0.5;">&rsaquo;</span> ';

    if (vizMode === 'authority') {
        el.innerHTML = vizFocus
            ? [link('Authority flow', "loadFlowGraph('authority')"),
               `<strong>${escapeVizHtml(truncateUrl(vizFocus, 70))}</strong>`].join(sep)
            : '<strong>Authority flow</strong> &mdash; authority flows left to right from the homepage (3 levels) &middot; brighter, thicker line = more authority passed';
    } else {
        el.innerHTML = vizFocus
            ? [link('Crawl tree', "loadFlowGraph('crawltree')"),
               `<strong>${escapeVizHtml(truncateUrl(vizFocus, 70))}</strong>`].join(sep)
            : '<strong>Crawl tree</strong> &mdash; homepage at the left, each column is one more click away (max 5) &middot; click a page to re-root';
    }
}

/**
 * Legend per mode
 */
function renderVizLegend(mode, clusters) {
    const el = document.getElementById('vizLegend');
    if (!el) return;

    const item = (color, label) =>
        `<div class="legend-item"><span class="legend-color" style="background: ${color};"></span><span>${label}</span></div>`;
    const note = text =>
        `<div class="legend-item"><span style="opacity:0.7;">${text}</span></div>`;

    if (mode === 'authority') {
        const items = (clusters || []).slice(0, 8).map(c =>
            item(clusterColor(c.color_index), `${escapeVizHtml(c.name)} (${c.page_count})`));
        items.push(
            `<div class="legend-item"><span class="legend-color" style="background: linear-gradient(to right, #cbd1d8, #116e3d); width: 36px; border-radius: 4px;"></span><span>weak &rarr; strong authority flow</span></div>`);
        el.innerHTML = items.join('');
    } else {
        el.innerHTML = [
            item('#16a34a', 'Page OK'),
            item('#2563eb', 'Redirect'),
            item('#d97706', '4xx'),
            item('#dc2626', '5xx / error'),
            item('#8b95a5', '+N more (click)'),
            note('Ring color = status &middot; columns = link depth')
        ].join('');
    }
}

function showVizMessage(message) {
    const container = document.getElementById('cy');
    if (!container) return;
    const placeholder = container.querySelector('.graph-placeholder');
    if (placeholder) {
        placeholder.style.display = 'block';
        const p = placeholder.querySelector('p');
        if (p) p.textContent = message;
    }
}

/**
 * Reset view / export / clear
 */
function resetVisualization() {
    if (!cy) return;
    cy.elements().removeClass('dimmed');
    if (vizFocus) {
        loadFlowGraph(vizMode);
    } else {
        cy.fit(50);
    }
}

function exportVisualizationImage() {
    if (!cy) return;
    const png = cy.png({ output: 'blob', bg: '#ffffff', full: true, scale: 2 });
    const url = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'site-structure-visualization.png';
    link.click();
    URL.revokeObjectURL(url);
}

function clearVisualization() {
    vizFocus = null;

    if (cy) {
        cy.elements().remove();
    }

    const container = document.getElementById('cy');
    if (container) {
        const placeholder = container.querySelector('.graph-placeholder');
        if (placeholder) {
            placeholder.style.display = 'block';
            const p = placeholder.querySelector('p');
            if (p) p.textContent = 'Start crawling to visualize your site structure';
        }
    }
    const breadcrumb = document.getElementById('vizBreadcrumb');
    if (breadcrumb) breadcrumb.style.display = 'none';
}

/**
 * Called when a saved crawl is loaded into the session
 */
function updateVisualizationFromLoadedData(urls, links) {
    if (cy) {
        loadFlowGraph(vizMode);
    }
}

/**
 * Helpers
 */
function truncateUrl(url, maxLength = 60) {
    if (!url || url.length <= maxLength) return url || '';
    return url.substring(0, maxLength - 3) + '...';
}

function escapeVizHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

// Export functions to global scope
window.initVisualization = initVisualization;
window.changeVizMode = changeVizMode;
window.loadFlowGraph = loadFlowGraph;
window.loadVisualizationData = loadVisualizationData;
window.resetVisualization = resetVisualization;
window.exportVisualizationImage = exportVisualizationImage;
window.updateVisualizationFromLoadedData = updateVisualizationFromLoadedData;
window.clearVisualization = clearVisualization;
