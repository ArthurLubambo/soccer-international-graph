import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ZoomIn, ZoomOut, RefreshCw } from 'lucide-react';

// ─── colour helpers ───────────────────────────────────────────────────────────

function nodeColors(rank, topCount) {
  if (rank === 1)  return { inner: '#fde68a', outer: '#b45309' }; // gold
  if (rank === 2)  return { inner: '#e2e8f0', outer: '#475569' }; // silver
  if (rank === 3)  return { inner: '#fed7aa', outer: '#9a3412' }; // bronze
  const pct = rank / topCount;
  if (pct < 0.20)  return { inner: '#6ee7b7', outer: '#065f46' }; // emerald  (top 20 %)
  if (pct < 0.45)  return { inner: '#7dd3fc', outer: '#1e40af' }; // sky blue
  if (pct < 0.70)  return { inner: '#c4b5fd', outer: '#4c1d95' }; // violet
  return               { inner: '#f9a8d4', outer: '#9d174d' };    // pink
}

// weight → warm heatmap colour  (blue → teal → amber → orange)
function edgeColor(weight, maxWeight, alpha) {
  const t = maxWeight > 0 ? Math.min(1, Math.log1p(weight) / Math.log1p(maxWeight)) : 0;
  // 0 → cool blue  0.5 → teal  1 → warm orange
  let r, g, b;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(59  + s * (20  - 59));
    g = Math.round(130 + s * (184 - 130));
    b = Math.round(246 + s * (166 - 246));
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(20  + s * (249 - 20));
    g = Math.round(184 + s * (115 - 184));
    b = Math.round(166 + s * (22  - 166));
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

// ─── layout helpers ───────────────────────────────────────────────────────────

// Place nodes in concentric rings so high-ranked teams start near centre
function concentricPosition(idx, total, width, height) {
  const RINGS = [
    { count: 1,  r: 0 },
    { count: 5,  r: 0.12 },
    { count: 10, r: 0.22 },
    { count: 18, r: 0.34 },
    { count: 30, r: 0.45 },
  ];

  let ring = RINGS[RINGS.length - 1];
  let offset = 0;
  for (const rg of RINGS) {
    if (idx < offset + rg.count) { ring = rg; break; }
    offset += rg.count;
  }

  const posInRing = idx - offset;
  const countInRing = ring.count;
  const angle = (posInRing / Math.max(1, countInRing)) * Math.PI * 2 - Math.PI / 2;
  const radius = Math.min(width, height) * ring.r;

  return {
    x: width  / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
    y: height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
  };
}

// ─── component ───────────────────────────────────────────────────────────────

export default function NetworkGraph({
  nodes,
  adj,
  ranks = [],
  selectedTeam,
  onSelectTeam
}) {
  const canvasRef   = useRef(null);
  const containerRef = useRef(null);

  const [topCount,   setTopCount]   = useState(30);
  const [showLabels, setShowLabels] = useState(true);
  const [maxEdgesPerNode, setMaxEdgesPerNode] = useState(3);

  const [transform,    setTransform]    = useState({ x: 0, y: 0, scale: 1 });
  const [draggedNode,  setDraggedNode]  = useState(null);
  const [hoveredNode,  setHoveredNode]  = useState(null);

  const simNodesRef     = useRef([]);
  const simEdgesRef     = useRef([]);
  const isMouseDownRef  = useRef(false);
  const lastMouseRef    = useRef({ x: 0, y: 0 });
  const isPanningRef    = useRef(false);

  // ── top-N teams ────────────────────────────────────────────────────────────
  const topTeams = useMemo(() => ranks.slice(0, topCount).map(r => r.team), [ranks, topCount]);

  // ── build simulation nodes + edges ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || topTeams.length === 0) return;
    const W = canvas.width;
    const H = canvas.height;

    const teamSet = new Set(topTeams);

    const graphNodes = topTeams.map((team, idx) => {
      const existing  = simNodesRef.current.find(n => n.id === team);
      const rankInfo  = ranks.find(r => r.team === team) || { rank: 999, score: 0 };

      // rank-normalised radius  (min 9, max 36)
      const normRank = rankInfo.rank / topCount;
      const r = 9 + (36 - 9) * Math.pow(Math.max(0, 1 - normRank), 0.55);

      if (existing) {
        return { ...existing, rank: rankInfo.rank, score: rankInfo.score, radius: r };
      }

      const pos = concentricPosition(idx, topTeams.length, W, H);
      return { id: team, ...pos, vx: 0, vy: 0, rank: rankInfo.rank, score: rankInfo.score, radius: r };
    });

    // Aggregate all raw edges, then keep only the N strongest per source
    const rawEdges = {};
    teamSet.forEach(team => {
      (adj[team] || []).forEach(edge => {
        if (!teamSet.has(edge.to)) return;
        const key = `${team}__${edge.to}`;
        rawEdges[key] = (rawEdges[key] || { source: team, target: edge.to, weight: 0 });
        rawEdges[key].weight += edge.weight;
      });
    });

    const allEdges = Object.values(rawEdges).sort((a, b) => b.weight - a.weight);

    // per-source limit
    const srcCount = {};
    const graphEdges = allEdges.filter(e => {
      srcCount[e.source] = (srcCount[e.source] || 0);
      if (srcCount[e.source] >= maxEdgesPerNode) return false;
      srcCount[e.source]++;
      return true;
    });

    simNodesRef.current = graphNodes;
    simEdgesRef.current = graphEdges;

    // reset view to fit
    setTransform({ x: 0, y: 0, scale: 1 });
  }, [topTeams, adj, ranks, maxEdgesPerNode]);

  // ── physics + draw loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;

    // Physics tuning — stronger repulsion, weaker gravity, longer springs
    const kRepulsion = 6000;
    const kSpring    = 0.035;
    const lRest      = 260;
    const kGravity   = 0.005;
    const friction   = 0.84;

    // Pre-compute max edge weight for colour scaling
    const maxWeight = simEdgesRef.current.reduce((m, e) => Math.max(m, e.weight), 1);

    let animId;

    const runFrame = () => {
      const snodes = simNodesRef.current;
      const sedges = simEdgesRef.current;

      // 1. Repulsion (all pairs)
      for (let i = 0; i < snodes.length; i++) {
        const u = snodes[i];
        for (let j = i + 1; j < snodes.length; j++) {
          const v = snodes[j];
          let dx = v.x - u.x || 0.1;
          const dy = v.y - u.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          // extra push when nodes overlap (hard-core repulsion)
          const minDist = u.radius + v.radius + 18;
          const effectiveDist = Math.min(dist, minDist);
          const force = kRepulsion / (effectiveDist * effectiveDist + 50);
          const fx = force * (dx / dist);
          const fy = force * (dy / dist);
          if (u !== draggedNode) { u.vx -= fx; u.vy -= fy; }
          if (v !== draggedNode) { v.vx += fx; v.vy += fy; }
        }
      }

      // 2. Spring forces (along edges)
      sedges.forEach(edge => {
        const u = snodes.find(n => n.id === edge.source);
        const v = snodes.find(n => n.id === edge.target);
        if (!u || !v) return;
        const dx   = v.x - u.x;
        const dy   = v.y - u.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const str  = kSpring * (1 + Math.log1p(edge.weight) * 0.15);
        const f    = str * (dist - lRest);
        const fx   = f * (dx / dist);
        const fy   = f * (dy / dist);
        if (u !== draggedNode) { u.vx += fx; u.vy += fy; }
        if (v !== draggedNode) { v.vx -= fx; v.vy -= fy; }
      });

      // 3. Gravity (soft pull to canvas centre)
      snodes.forEach(node => {
        if (node === draggedNode) return;
        node.vx += (W / 2 - node.x) * kGravity;
        node.vy += (H / 2 - node.y) * kGravity;
      });

      // 4. Integrate
      snodes.forEach(node => {
        if (node === draggedNode) return;
        node.vx *= friction;
        node.vy *= friction;
        node.x  += node.vx;
        node.y  += node.vy;
        const pad = node.radius + 12;
        node.x = Math.max(pad, Math.min(W - pad, node.x));
        node.y = Math.max(pad, Math.min(H - pad, node.y));
      });

      // 5. Draw
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.scale, transform.scale);

      const activeNode = hoveredNode || selectedTeam;

      // Edges
      sedges.forEach(edge => {
        const u = snodes.find(n => n.id === edge.source);
        const v = snodes.find(n => n.id === edge.target);
        if (!u || !v) return;

        const connected = activeNode &&
          (edge.source === activeNode || edge.target === activeNode);
        const dimmed = activeNode && !connected;

        const alpha  = dimmed ? 0.04 : connected ? 0.9 : 0.55;
        const color  = edgeColor(edge.weight, maxWeight, alpha);
        const bw     = 1.2 + Math.log1p(edge.weight) * 1.1;
        const lw     = connected ? bw + 1.5 : bw;

        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        ctx.lineWidth   = lw;
        ctx.strokeStyle = color;
        ctx.stroke();

        // Arrowhead
        if (!dimmed) {
          const arrowLen = 9 + lw;
          const angle = Math.atan2(v.y - u.y, v.x - u.x);
          const ax = v.x - Math.cos(angle) * (v.radius + 4);
          const ay = v.y - Math.sin(angle) * (v.radius + 4);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(ax - arrowLen * Math.cos(angle - Math.PI / 7),
                     ay - arrowLen * Math.sin(angle - Math.PI / 7));
          ctx.lineTo(ax - arrowLen * Math.cos(angle + Math.PI / 7),
                     ay - arrowLen * Math.sin(angle + Math.PI / 7));
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }
      });

      // Nodes
      snodes.forEach(node => {
        const isSelected    = selectedTeam === node.id;
        const isHovered     = hoveredNode  === node.id;
        const isConnected   = activeNode && sedges.some(
          e => (e.source === node.id && e.target === activeNode) ||
               (e.target === node.id && e.source === activeNode)
        );
        const isActive      = node.id === activeNode;
        const isDimmed      = activeNode && !isActive && !isConnected && !isSelected && !isHovered;

        ctx.save();
        ctx.globalAlpha = isDimmed ? 0.18 : 1;

        // Glow ring for selected/hovered
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.08)';
          ctx.fill();
          ctx.shadowColor = isSelected ? '#f1f5f9' : '#a5b4fc';
          ctx.shadowBlur  = 22;
        }

        // Fill gradient
        const { inner, outer } = nodeColors(node.rank, topCount);
        const grad = ctx.createRadialGradient(
          node.x - node.radius * 0.25, node.y - node.radius * 0.25, node.radius * 0.05,
          node.x, node.y, node.radius
        );
        grad.addColorStop(0, inner);
        grad.addColorStop(1, outer);

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Border
        ctx.lineWidth   = isSelected || isHovered ? 2.5 : 1.2;
        ctx.strokeStyle = isSelected ? '#ffffff'
                        : isHovered  ? '#e0e7ff'
                        : 'rgba(255,255,255,0.25)';
        ctx.stroke();

        ctx.restore();

        // Label
        if (showLabels) {
          ctx.save();
          ctx.globalAlpha = isDimmed ? 0.15 : 1;

          const label = node.id.length > 14 ? node.id.slice(0, 13) + '…' : node.id;
          const fs = isActive || isSelected || isHovered ? 12 : 10;

          // Text shadow for legibility on any background
          ctx.font         = `${isActive || isSelected ? 700 : 500} ${fs}px "Inter", sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'top';
          ctx.shadowColor  = 'rgba(0,0,0,0.85)';
          ctx.shadowBlur   = 4;

          ctx.fillStyle = isSelected ? '#ffffff'
                        : isHovered  ? '#e0e7ff'
                        : '#d1d5db';
          ctx.fillText(label, node.x, node.y + node.radius + 4);
          ctx.restore();
        }
      });

      ctx.restore();
      animId = requestAnimationFrame(runFrame);
    };

    animId = requestAnimationFrame(runFrame);
    return () => cancelAnimationFrame(animId);
  }, [transform, hoveredNode, selectedTeam, draggedNode, showLabels, topCount]);

  // ── mouse helpers ──────────────────────────────────────────────────────────
  const simCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      x: (sx - transform.x) / transform.scale,
      y: (sy - transform.y) / transform.scale,
      sx, sy
    };
  };

  const hitNode = (coords) => {
    const snodes = simNodesRef.current;
    for (let i = snodes.length - 1; i >= 0; i--) {
      const n  = snodes[i];
      const dx = coords.x - n.x;
      const dy = coords.y - n.y;
      if (Math.sqrt(dx * dx + dy * dy) <= n.radius + 6) return n;
    }
    return null;
  };

  const handleMouseDown = (e) => {
    const c = simCoords(e);
    isMouseDownRef.current  = true;
    lastMouseRef.current    = { x: c.sx, y: c.sy };
    const node = hitNode(c);
    if (node) {
      setDraggedNode(node);
      onSelectTeam(node.id);
      isPanningRef.current = false;
    } else {
      isPanningRef.current = true;
    }
  };

  const handleMouseMove = (e) => {
    const c = simCoords(e);
    if (draggedNode && isMouseDownRef.current) {
      draggedNode.x  = c.x;
      draggedNode.y  = c.y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      return;
    }
    if (isPanningRef.current && isMouseDownRef.current) {
      const dx = c.sx - lastMouseRef.current.x;
      const dy = c.sy - lastMouseRef.current.y;
      setTransform(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
      lastMouseRef.current = { x: c.sx, y: c.sy };
      return;
    }
    setHoveredNode(hitNode(c)?.id ?? null);
  };

  const handleMouseUp = () => {
    isMouseDownRef.current = false;
    setDraggedNode(null);
    isPanningRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const f    = e.deltaY < 0 ? 1.1 : 0.91;
    const ns   = Math.max(0.12, Math.min(5, transform.scale * f));
    setTransform({
      scale: ns,
      x: mx - (mx - transform.x) * (ns / transform.scale),
      y: my - (my - transform.y) * (ns / transform.scale),
    });
  };

  const zoomIn  = () => setTransform(p => {
    const ns = Math.min(5, p.scale * 1.3);
    const W = canvasRef.current?.width ?? 800;
    const H = canvasRef.current?.height ?? 580;
    return { scale: ns, x: W/2 - (W/2 - p.x) * (ns/p.scale), y: H/2 - (H/2 - p.y) * (ns/p.scale) };
  });
  const zoomOut = () => setTransform(p => {
    const ns = Math.max(0.12, p.scale / 1.3);
    const W = canvasRef.current?.width ?? 800;
    const H = canvasRef.current?.height ?? 580;
    return { scale: ns, x: W/2 - (W/2 - p.x) * (ns/p.scale), y: H/2 - (H/2 - p.y) * (ns/p.scale) };
  });

  const resetView = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    simNodesRef.current.forEach((node, idx) => {
      const pos = concentricPosition(idx, simNodesRef.current.length, canvas.width, canvas.height);
      node.x = pos.x;
      node.y = pos.y;
      node.vx = 0;
      node.vy = 0;
    });
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  // ── colour legend entries ─────────────────────────────────────────────────
  const legend = [
    { label: 'Top 3',         color: '#fde68a' },
    { label: 'Top 20%',       color: '#6ee7b7' },
    { label: 'Top 45%',       color: '#7dd3fc' },
    { label: 'Top 70%',       color: '#c4b5fd' },
    { label: 'Rest',          color: '#f9a8d4' },
  ];

  return (
    <div className="card graph-card" ref={containerRef} style={{ padding: 0 }}>
      <canvas
        ref={canvasRef}
        width={820}
        height={580}
        style={{
          cursor: draggedNode ? 'grabbing' : 'default',
          display: 'block',
          borderRadius: '0.75rem 0.75rem 0 0'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Toolbar */}
      <div className="graph-toolbar">
        <button className="btn-secondary" onClick={zoomIn}    title="Zoom In">  <ZoomIn  size={15} /></button>
        <button className="btn-secondary" onClick={zoomOut}   title="Zoom Out"> <ZoomOut size={15} /></button>
        <button className="btn-secondary" onClick={resetView} title="Reset">    <RefreshCw size={15} /></button>

        <button
          className="btn-secondary"
          style={showLabels ? { backgroundColor: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' } : {}}
          onClick={() => setShowLabels(s => !s)}
          title="Toggle Labels"
        >
          Labels
        </button>

        {/* Top-N selector */}
        <select
          value={topCount}
          onChange={e => setTopCount(+e.target.value)}
          className="form-input"
          style={{ width: '120px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
        >
          <option value="20">Top 20</option>
          <option value="30">Top 30</option>
          <option value="40">Top 40</option>
          <option value="60">Top 60</option>
        </select>

        {/* Edges-per-node selector */}
        <select
          value={maxEdgesPerNode}
          onChange={e => setMaxEdgesPerNode(+e.target.value)}
          className="form-input"
          style={{ width: '130px', padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
        >
          <option value="2">2 edges/node</option>
          <option value="3">3 edges/node</option>
          <option value="5">5 edges/node</option>
          <option value="8">8 edges/node</option>
        </select>
      </div>

      {/* Legend + hint */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', padding: '0.5rem 1rem 0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginRight: '0.25rem' }}>Rank tier:</span>
        {legend.map(l => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: l.color, display: 'inline-block', flexShrink: 0 }} />
            {l.label}
          </span>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Edge colour = match weight (blue → orange)
        </span>
      </div>
    </div>
  );
}
