/**
 * Site Structure Visualization
 *
 * Two sideways tree views (Screaming Frog style), aggregated server-side:
 *  - Crawl Tree (default): hierarchy by shortest link path, depth <= 5.
 *  - Authority Flow: pages hang off the source passing them the most
 *    authority, depth <= 3; stronger flow = brighter, thicker line.
 *    Skeleton edges render as tapered ribbons (wide at the source,
 *    narrow at the target) on a canvas underlay, so authority visibly
 *    "drains" downstream. Cross-flow edges stay dashed Cytoscape edges.
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

const FLOW_ROLE_COLORS = {
    receiver: '#0e9f6e',   // net authority receiver (green)
    donor: '#2563eb',      // net authority donor (blue)
    balanced: '#8b95a5'
};

function flowRoleColor(role) {
    return FLOW_ROLE_COLORS[role] || FLOW_ROLE_COLORS.balanced;
}

/**
 * Node fill for the authority tree: light -> deep emerald by score,
 * red for pages with no authority (matches the equity-tree style).
 */
function authorityColor(a) {
    if (!a || a <= 0) return '#ef4444';
    const t = Math.sqrt(Math.max(0, Math.min(1, a / 100)));
    const lo = [110, 214, 160], hi = [10, 122, 64];
    const c = lo.map((l, i) => Math.round(l + (hi[i] - l) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function statusColor(code) {
    if (code >= 200 && code < 300) return '#16a34a';
    if (code >= 300 && code < 400) return '#2563eb';
    if (code >= 400 && code < 500) return '#d97706';
    if (code >= 500) return '#dc2626';
    return '#98a2b3';
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
                    'border-color': 'rgba(16,24,40,0.18)',
                    'text-events': 'yes'
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
                // Authority mode: filled node, label + numbers underneath
                selector: 'node[?flowLabel]',
                style: {
                    'text-wrap': 'wrap',
                    'line-height': 1.35,
                    'font-family': '"JetBrains Mono", monospace',
                    'font-size': '9.5px',
                    'text-max-width': '150px'
                }
            },
            {
                // Soft halo behind high-authority nodes
                selector: 'node[?flowLabel][authority > 50]',
                style: {
                    'underlay-color': '#101828',
                    'underlay-opacity': 0.05,
                    'underlay-padding': 14,
                    'underlay-shape': 'ellipse'
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
                // Top-down authority tree: root label sits below like the rest
                selector: 'node[?flowLabel][?is_root]',
                style: {
                    'underlay-padding': 20,
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-x': 0,
                    'text-margin-y': 6,
                    'border-width': 0
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
                // Authority tree edges: vertical S-curves (d3-style cubic
                // links, same family as the crawl tree's), width = flow
                selector: 'edge.flow-edge',
                style: {
                    'curve-style': 'unbundled-bezier',
                    'edge-distances': 'node-position',
                    'control-point-distances': ele => flowEdgeGeometry(ele).distances,
                    'control-point-weights': ele => flowEdgeGeometry(ele).weights,
                    'line-color': '#8fcaa8',
                    'target-arrow-shape': 'none',
                    'opacity': 0.9
                }
            },
            {
                // Cross-flow edges: the other strongest inflows per page,
                // incl. flow back into the homepage. Thin + dashed so the
                // skeleton stays readable; arrow keeps direction obvious.
                selector: 'edge.cross-edge',
                style: {
                    'line-style': 'dashed',
                    'line-color': '#bcdfca',
                    'width': 1.2,
                    'target-arrow-shape': 'triangle',
                    'target-arrow-color': '#9ccfb2',
                    'arrow-scale': 0.55,
                    'opacity': 0.7
                }
            },
            {
                selector: 'edge.dimmed',
                style: { 'opacity': 0.1 }
            },
            {
                // Skeleton flow edges are drawn as tapered ribbons on the
                // underlay canvas instead; keep the Cytoscape edge for
                // hierarchy/layout but never paint it.
                selector: 'edge.taper-hidden',
                style: { 'opacity': 0 }
            }
        ],
        layout: { name: 'preset' },
        wheelSensitivity: 0.2,
        minZoom: 0.1,
        maxZoom: 3
    });

    setupInteractions();
    cy.on('render', scheduleTaperDraw);
    loadFlowGraph(vizMode);
}

/**
 * Tapered flow ribbons (authority mode)
 *
 * Cytoscape edges have one width for their whole length, so the skeleton
 * edges are hidden ('taper-hidden') and redrawn here as filled ribbons on
 * a canvas that sits UNDER Cytoscape's own canvases: wide where the
 * authority leaves the parent, narrow where it reaches the child. Same
 * cubic geometry as flowEdgeGeometry(), same width scale, same data.
 */
let taperCanvas = null;
let taperRaf = null;

function ensureTaperCanvas() {
    if (taperCanvas) return taperCanvas;
    const container = document.getElementById('cy');
    if (!container) return null;
    taperCanvas = document.createElement('canvas');
    taperCanvas.setAttribute('data-id', 'taper-layer');
    taperCanvas.style.position = 'absolute';
    taperCanvas.style.top = '0';
    taperCanvas.style.left = '0';
    taperCanvas.style.pointerEvents = 'none';
    // First child + no z-index => painted beneath Cytoscape's canvases
    container.insertBefore(taperCanvas, container.firstChild);
    return taperCanvas;
}

function scheduleTaperDraw() {
    if (taperRaf) return;
    taperRaf = requestAnimationFrame(() => {
        taperRaf = null;
        drawTaperLayer();
    });
}

function taperColor(intensity, alpha) {
    // weak flow -> pale mint, strong flow -> deep emerald
    const lo = [191, 227, 207], hi = [26, 138, 79];
    const t = Math.sqrt(Math.max(0, Math.min(1, intensity)));
    const c = lo.map((l, i) => Math.round(l + (hi[i] - l) * t));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

function cubicPoint(p0, p1, p2, p3, u) {
    const mt = 1 - u;
    const a = mt * mt * mt, b = 3 * mt * mt * u, c = 3 * mt * u * u, d = u * u * u;
    return {
        x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
        y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
    };
}

function drawTaperLayer() {
    const canvas = ensureTaperCanvas();
    if (!canvas || !cy) return;

    const container = document.getElementById('cy');
    const w = container.clientWidth, h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    if (vizMode !== 'authority') return;

    const zoom = cy.zoom(), pan = cy.pan();
    const toScreen = (p) => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y });

    const skeleton = cy.edges('.taper-hidden');
    if (skeleton.length === 0) return;

    let maxWidth = 1;
    skeleton.forEach(e => { maxWidth = Math.max(maxWidth, e.data('width') || 1); });

    const SAMPLES = 22;

    skeleton.forEach(e => {
        const s = e.source().position(), t = e.target().position();
        const dx = t.x - s.x, dy = t.y - s.y;
        if (dx * dx + dy * dy < 1) return;

        // Same vertical cubic as flowEdgeGeometry(): control points at mid-y
        const ym = s.y + dy / 2;
        const c1 = { x: s.x, y: ym }, c2 = { x: t.x, y: ym };

        // Trim ends by node radius so ribbons meet the circles cleanly
        const srcR = ((e.source().data('size') || 20) / 2) + 1;
        const tgtR = ((e.target().data('size') || 20) / 2) + 1;

        let pts = [];
        for (let i = 0; i <= SAMPLES; i++) {
            pts.push(cubicPoint(s, c1, c2, t, i / SAMPLES));
        }
        const distTo = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
        while (pts.length > 3 && distTo(pts[0], s) < srcR) pts.shift();
        while (pts.length > 3 && distTo(pts[pts.length - 1], t) < tgtR) pts.pop();
        if (pts.length < 3) return;

        // Ribbon half-widths (model units): wide at source, narrow at target
        const flowWidth = e.data('width') || 1;   // 1..10 from _edge_widths()
        const halfStart = (flowWidth * 1.25) / 2;
        const halfEnd = Math.max(0.4, flowWidth * 0.18) / 2;

        const left = [], right = [];
        for (let i = 0; i < pts.length; i++) {
            const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
            let nx = -(next.y - prev.y), ny = next.x - prev.x;
            const nlen = Math.hypot(nx, ny) || 1;
            nx /= nlen; ny /= nlen;
            const f = i / (pts.length - 1);
            const hw = halfStart + (halfEnd - halfStart) * f;
            left.push({ x: pts[i].x + nx * hw, y: pts[i].y + ny * hw });
            right.push({ x: pts[i].x - nx * hw, y: pts[i].y - ny * hw });
        }

        const dimmed = e.hasClass('dimmed');
        const intensity = flowWidth / maxWidth;
        const sScr = toScreen(pts[0]), tScr = toScreen(pts[pts.length - 1]);
        const grad = ctx.createLinearGradient(sScr.x, sScr.y, tScr.x, tScr.y);
        if (dimmed) {
            grad.addColorStop(0, taperColor(intensity, 0.08));
            grad.addColorStop(1, taperColor(intensity, 0.04));
        } else {
            grad.addColorStop(0, taperColor(intensity, 0.9));
            grad.addColorStop(1, taperColor(intensity * 0.7, 0.45));
        }

        ctx.beginPath();
        const first = toScreen(left[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < left.length; i++) {
            const p = toScreen(left[i]);
            ctx.lineTo(p.x, p.y);
        }
        for (let i = right.length - 1; i >= 0; i--) {
            const p = toScreen(right[i]);
            ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
    });
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
                    ${d.inflow !== undefined && vizMode === 'authority'
                        ? `<div><strong>Flow in:</strong> ${d.inflow} &middot; <strong>out:</strong> ${d.outflow}
                           ${d.flow_role !== 'balanced' ? ` &middot; <span style="color:${flowRoleColor(d.flow_role)}; font-weight:600;">net ${d.flow_role}</span>` : ''}</div>`
                        : ''}
                    <div>Status: ${d.status_code}</div>
                    ${d.child_count ? `<div><strong>Children:</strong> ${d.child_count}</div>` : ''}
                    ${d.is_orphan ? '<div style="color:#dc2626;">Orphan page</div>' : ''}
                    <div style="opacity:0.7;">Click for details &middot; double-click to open</div>
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
        if (d.type !== 'page') return;

        // Highlight the node's direct links and open its detail card
        cy.elements().removeClass('dimmed');
        const neighborhood = event.target.neighborhood().add(event.target);
        cy.elements().not(neighborhood).addClass('dimmed');
        showNodeCard(d, event.originalEvent);
    });

    cy.on('tap', function(event) {
        if (event.target === cy) {
            cy.elements().removeClass('dimmed');
            hideNodeCard();
        }
    });
}

/**
 * Click card: the numbers for one page — how many pages link to it,
 * how many it links to, and how much authority moves. Re-rooting and
 * opening the page live here as explicit buttons.
 */
let nodeCard = null;

function hideNodeCard() {
    if (nodeCard) nodeCard.style.display = 'none';
}

function showNodeCard(d, evt) {
    if (!nodeCard) {
        nodeCard = document.createElement('div');
        nodeCard.className = 'viz-node-card';
        document.body.appendChild(nodeCard);
    }

    const row = (label, value) =>
        `<div class="vnc-row"><span>${label}</span><strong>${value}</strong></div>`;

    const stats = [];
    if (d.authority !== undefined) stats.push(row('Authority', d.authority));
    if (d.in_pages !== undefined) {
        stats.push(row('Pages linking here', d.in_pages));
        stats.push(row('Pages it links to', d.out_pages));
    }
    if (d.inflow !== undefined && vizMode === 'authority') {
        const role = d.flow_role !== 'balanced'
            ? ` <span style="color:${flowRoleColor(d.flow_role)}; font-weight:600;">(net ${d.flow_role})</span>` : '';
        stats.push(row('Authority in / out', `${d.inflow} / ${d.outflow}${role}`));
    }
    stats.push(row('Status', d.status_code));
    if (d.is_orphan) stats.push('<div class="vnc-row" style="color:#dc2626;">Orphan page</div>');

    nodeCard.innerHTML = `
        <div class="vnc-url">${escapeVizHtml(truncateUrl(d.url || '', 70))}</div>
        ${stats.join('')}
        <div class="vnc-actions">
            ${d.is_root ? '' : `<button onclick="hideNodeCard(); loadFlowGraph(vizMode, '${encodeURI(d.url)}')">Focus here</button>`}
            <button onclick="window.open('${encodeURI(d.url)}', '_blank')">Open page</button>
        </div>`;

    nodeCard.style.display = 'block';
    const pad = 12;
    let x = evt.pageX + pad, y = evt.pageY + pad;
    const rect = nodeCard.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - pad) x = evt.pageX - rect.width - pad;
    if (y + rect.height > window.scrollY + window.innerHeight - pad) y = evt.pageY - rect.height - pad;
    nodeCard.style.left = x + 'px';
    nodeCard.style.top = y + 'px';
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

    hideNodeCard();

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
            if (mode === 'authority') {
                // Equity-tree style: filled circles sized + shaded by
                // authority, score and link counts under the label
                if (d.type === 'group') {
                    d.color = '#8b95a5';
                } else {
                    // Name only on the canvas; the numbers live in the
                    // click card and hover tooltip
                    d.color = authorityColor(d.authority);
                    d.flowLabel = true;
                }
            } else {
                d.sideways = true;
                if (d.type === 'group') {
                    d.color = '#8b95a5';
                } else {
                    // Small open circles, SF-style; ring color = status
                    d.color = statusColor(d.status_code);
                    d.open = true;
                    d.size = d.is_root ? 18 : 13;
                }
            }
            return { data: d };
        });

        const edges = data.edges.map(e => ({ data: e.data }));

        cy.elements().remove();
        cy.add([...nodes, ...edges]).edges().forEach(e => {
            if (mode === 'authority') {
                // Skeleton edges are painted as tapered ribbons on the
                // underlay canvas; only cross-flow edges stay visible.
                e.addClass(e.data('cross') ? 'flow-edge cross-edge' : 'flow-edge taper-hidden');
            } else {
                e.addClass('tree-edge');
            }
        });
        applyFlowLayout(mode);
        scheduleTaperDraw();

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
    if (mode === 'authority') layoutTopDownTree();
    else layoutSidewaysTree();
}

/**
 * Top-down tidy tree (equity-tree style): root centered at the top,
 * one row per level, leaves spread evenly, parents centered over
 * their children. Cross-flow edges are ignored for positioning.
 */
function layoutTopDownTree() {
    const X_GAP = 150;    // horizontal gap between leaf columns
    const Y_GAP = 175;    // vertical gap between levels

    const children = {};
    const hasParent = new Set();
    cy.edges().forEach(e => {
        if (e.data('cross')) return;
        const s = e.source().id(), t = e.target().id();
        (children[s] = children[s] || []).push(t);
        hasParent.add(t);
    });

    let rootId = null;
    cy.nodes().forEach(n => { if (n.data('is_root')) rootId = n.id(); });
    if (!rootId) {
        const roots = cy.nodes().filter(n => !hasParent.has(n.id()));
        rootId = roots.length ? roots[0].id() : (cy.nodes().length ? cy.nodes()[0].id() : null);
    }
    if (!rootId) return;

    const positions = {};
    let nextCol = 0;
    const visited = new Set();

    (function place(id, depth) {
        if (visited.has(id)) return;
        visited.add(id);

        const kids = (children[id] || []).filter(k => !visited.has(k));
        if (kids.length === 0) {
            positions[id] = { x: nextCol * X_GAP, y: depth * Y_GAP };
            nextCol++;
        } else {
            kids.forEach(k => place(k, depth + 1));
            const xs = kids.map(k => positions[k].x);
            positions[id] = {
                x: (Math.min(...xs) + Math.max(...xs)) / 2,
                y: depth * Y_GAP
            };
        }
    })(rootId, 0);

    // Anything disconnected sits on its own bottom row
    let maxY = 0;
    Object.values(positions).forEach(p => { maxY = Math.max(maxY, p.y); });
    cy.nodes().forEach(n => {
        if (!positions[n.id()]) {
            positions[n.id()] = { x: nextCol * X_GAP, y: maxY + Y_GAP };
            nextCol++;
        }
    });

    cy.nodes().positions(n => positions[n.id()]);
    cy.fit(50);
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
        if (e.data('cross')) return; // overlay edges are not hierarchy
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
 * Control points for a vertical cubic link (top-down authority tree):
 * the curve leaves the parent straight down and arrives at the child
 * straight down, bending in the middle — the transpose of the crawl
 * tree's horizontal S-curves.
 */
function flowEdgeGeometry(ele) {
    const s = ele.source().position();
    const t = ele.target().position();
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return { distances: [0], weights: [0.5] };
    const len = Math.sqrt(len2);

    // d3 vertical link: cubic bezier with control points (0, dy/2) and
    // (dx, dy/2) relative to the source. Sample it at several points and
    // express each as (weight along the chord, perpendicular offset) so
    // cytoscape renders a faithful, smooth version of the exact curve.
    const ym = dy / 2;
    const distances = [], weights = [];
    for (const u of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const mt = 1 - u;
        const bx = 3 * mt * u * u * dx + u * u * u * dx;
        const by = 3 * mt * mt * u * ym + 3 * mt * u * u * ym + u * u * u * dy;
        weights.push((bx * dx + by * dy) / len2);
        distances.push((by * dx - bx * dy) / len);
    }
    return { distances, weights };
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
            : '<strong>Authority flow</strong> &mdash; link equity flows down from the homepage &middot; node size/shade = authority &middot; dashed = other top inflows, incl. page &rarr; home';
    } else {
        el.innerHTML = vizFocus
            ? [link('Crawl tree', "loadFlowGraph('crawltree')"),
               `<strong>${escapeVizHtml(truncateUrl(vizFocus, 70))}</strong>`].join(sep)
            : '<strong>Crawl tree</strong> &mdash; homepage at the left, each column is one more click away (max 5) &middot; click a page for details';
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
        el.innerHTML = [
            `<div class="legend-item"><span class="legend-color" style="background: linear-gradient(to right, #6ed6a0, #0a7a40); width: 36px; border-radius: 4px;"></span><span>size + shade = authority</span></div>`,
            item('#ef4444', 'No authority'),
            note('Tapered line = authority passed, draining downstream &middot; dashed = other top inflows (incl. back to home) &middot; click a node for numbers')
        ].join('');
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
    // The taper underlay isn't part of Cytoscape's export; reveal the
    // hidden skeleton edges so the exported image keeps its structure.
    const hidden = cy.edges('.taper-hidden');
    hidden.removeClass('taper-hidden');
    const png = cy.png({ output: 'blob', bg: '#ffffff', full: true, scale: 2 });
    hidden.addClass('taper-hidden');
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
    scheduleTaperDraw();

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
window.hideNodeCard = hideNodeCard;
