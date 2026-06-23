import React, { useRef, useEffect, useState, useMemo } from 'react';
import { ZoomIn, ZoomOut, RefreshCw, Layers } from 'lucide-react';

export default function NetworkGraph({ 
  nodes, 
  adj, 
  ranks = [], 
  selectedTeam, 
  onSelectTeam 
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  // Graph configuration
  const [topCount, setTopCount] = useState(40); // Default show top 40 teams
  const [showLabels, setShowLabels] = useState(true);
  
  // Transform state (Pan and Zoom)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.8 });
  const [draggedNode, setDraggedNode] = useState(null);
  const [hoveredNode, setHoveredNode] = useState(null);
  
  // Local physics simulation states (persisted across renders)
  const simNodesRef = useRef([]);
  const simEdgesRef = useRef([]);
  const isMouseDownRef = useRef(false);
  const lastMousePosRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);

  // Get top N teams by PageRank score
  const topTeams = useMemo(() => {
    return ranks.slice(0, topCount).map(r => r.team);
  }, [ranks, topCount]);

  // Set up nodes and edges for the simulation whenever topTeams or adj changes
  useEffect(() => {
    if (!canvasRef.current || topTeams.length === 0) return;

    const width = canvasRef.current.width || 800;
    const height = canvasRef.current.height || 600;

    // Build unique nodes list
    const teamSet = new Set(topTeams);
    const graphNodes = Array.from(teamSet).map((team, idx) => {
      // Find if we already have coordinates from previous simulation run to avoid resetting positions
      const existing = simNodesRef.current.find(n => n.id === team);
      
      // Calculate rank and score
      const rankInfo = ranks.find(r => r.team === team) || { rank: 999, score: 0 };
      
      if (existing) {
        return {
          ...existing,
          rank: rankInfo.rank,
          score: rankInfo.score
        };
      }

      // Generate initial position in a circle
      const angle = (idx / teamSet.size) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.35;
      
      return {
        id: team,
        x: width / 2 + Math.cos(angle) * radius,
        y: height / 2 + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        rank: rankInfo.rank,
        score: rankInfo.score,
        radius: 12 + rankInfo.score * 800 // Node size proportional to PageRank score
      };
    });

    // Build edges list
    const graphEdges = [];
    teamSet.forEach(team => {
      const edges = adj[team] || [];
      edges.forEach(edge => {
        // Only include edge if both winner and loser are in the visible top list
        if (teamSet.has(edge.to)) {
          // Check if edge already exists to aggregate weight
          const existingEdge = graphEdges.find(
            e => (e.source === team && e.target === edge.to)
          );
          if (existingEdge) {
            existingEdge.weight += edge.weight;
          } else {
            graphEdges.push({
              source: team,
              target: edge.to,
              weight: edge.weight
            });
          }
        }
      });
    });

    simNodesRef.current = graphNodes;
    simEdgesRef.current = graphEdges;
    
    // Center the graph initial transform
    setTransform({
      x: width / 2 - (width / 2) * 0.8,
      y: height / 2 - (height / 2) * 0.8,
      scale: 0.8
    });
  }, [topTeams, adj, ranks]);

  // Main simulation loop and Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let animId;
    const width = canvas.width;
    const height = canvas.height;
    
    // Physics constants
    const kRepulsion = 1500;
    const kSpring = 0.05;
    const lRest = 160;
    const kGravity = 0.015;
    const friction = 0.82;

    const runFrame = () => {
      const snodes = simNodesRef.current;
      const sedges = simEdgesRef.current;

      // 1. Calculate repulsion forces (between all node pairs)
      for (let i = 0; i < snodes.length; i++) {
        const u = snodes[i];
        for (let j = i + 1; j < snodes.length; j++) {
          const v = snodes[j];
          let dx = v.x - u.x;
          let dy = v.y - u.y;
          if (dx === 0) dx = 0.1; // Prevent division by zero
          
          const dist = Math.sqrt(dx * dx + dy * dy);
          const force = kRepulsion / (dist * dist + 100);
          
          const fx = force * (dx / dist);
          const fy = force * (dy / dist);
          
          if (u !== draggedNode) {
            u.vx -= fx;
            u.vy -= fy;
          }
          if (v !== draggedNode) {
            v.vx += fx;
            v.vy += fy;
          }
        }
      }

      // 2. Calculate spring forces (along active edges)
      sedges.forEach(edge => {
        const u = snodes.find(n => n.id === edge.source);
        const v = snodes.find(n => n.id === edge.target);
        if (!u || !v) return;

        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        
        // Edge weight affects spring strength
        const strength = kSpring * (1 + Math.log1p(edge.weight) * 0.2);
        const force = strength * (dist - lRest);
        
        const fx = force * (dx / dist);
        const fy = force * (dy / dist);

        if (u !== draggedNode) {
          u.vx += fx;
          u.vy += fy;
        }
        if (v !== draggedNode) {
          v.vx -= fx;
          v.vy -= fy;
        }
      });

      // 3. Center gravity force (pull towards canvas center)
      const cx = width / 2;
      const cy = height / 2;
      snodes.forEach(node => {
        if (node === draggedNode) return;
        
        const dx = cx - node.x;
        const dy = cy - node.y;
        
        node.vx += dx * kGravity;
        node.vy += dy * kGravity;
      });

      // 4. Update node positions with friction
      snodes.forEach(node => {
        if (node === draggedNode) return;
        
        node.vx *= friction;
        node.vy *= friction;
        
        node.x += node.vx;
        node.y += node.vy;
        
        // Clamp to screen boundaries to keep nodes visible
        const padding = node.radius + 10;
        node.x = Math.max(padding, Math.min(width - padding, node.x));
        node.y = Math.max(padding, Math.min(height - padding, node.y));
      });

      // 5. Drawing phase
      ctx.clearRect(0, 0, width, height);
      
      // Save context and apply pan/zoom transforms
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.scale, transform.scale);
      
      // Determine highlighting context
      const activeHighlightNode = hoveredNode || selectedTeam;
      
      // Draw Edges
      sedges.forEach(edge => {
        const u = snodes.find(n => n.id === edge.source);
        const v = snodes.find(n => n.id === edge.target);
        if (!u || !v) return;

        const isHighlighted = activeHighlightNode && 
          (edge.source === activeHighlightNode || edge.target === activeHighlightNode);
        
        const isSelectedEdge = selectedTeam && 
          (edge.source === selectedTeam || edge.target === selectedTeam);

        // Edge styling
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        
        // Width proportional to accumulated weight
        const baseWidth = 1 + Math.log1p(edge.weight) * 1.5;
        ctx.lineWidth = isHighlighted ? baseWidth + 1.5 : baseWidth;
        
        // Color based on highlight status
        if (isSelectedEdge) {
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)'; // Glow Indigo
        } else if (isHighlighted) {
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.6)'; // Glow Purple
        } else if (activeHighlightNode) {
          ctx.strokeStyle = 'rgba(75, 85, 99, 0.08)'; // Dimmed out
        } else {
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.18)'; // Normal transparent blue
        }
        ctx.stroke();

        // Draw arrowheads
        if (isHighlighted || !activeHighlightNode) {
          const arrowLength = 8 + ctx.lineWidth;
          const angle = Math.atan2(v.y - u.y, v.x - u.x);
          
          // Arrow position just at node boundary
          const arrowX = v.x - Math.cos(angle) * (v.radius + 3);
          const arrowY = v.y - Math.sin(angle) * (v.radius + 3);
          
          ctx.beginPath();
          ctx.moveTo(arrowX, arrowY);
          ctx.lineTo(
            arrowX - arrowLength * Math.cos(angle - Math.PI / 8),
            arrowY - arrowLength * Math.sin(angle - Math.PI / 8)
          );
          ctx.lineTo(
            arrowX - arrowLength * Math.cos(angle + Math.PI / 8),
            arrowY - arrowLength * Math.sin(angle + Math.PI / 8)
          );
          ctx.closePath();
          ctx.fillStyle = isSelectedEdge 
            ? 'rgba(99, 102, 241, 0.7)' 
            : isHighlighted 
              ? 'rgba(168, 85, 247, 0.6)' 
              : 'rgba(99, 102, 241, 0.25)';
          ctx.fill();
        }
      });

      // Draw Nodes
      snodes.forEach(node => {
        const isSelected = selectedTeam === node.id;
        const isHovered = hoveredNode === node.id;
        const isHighlighted = activeHighlightNode && 
          (node.id === activeHighlightNode || 
           sedges.some(e => (e.source === node.id && e.target === activeHighlightNode) || (e.target === node.id && e.source === activeHighlightNode)));

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        
        // Node coloring based on PageRank rank
        let fillGrad = ctx.createRadialGradient(node.x, node.y, node.radius * 0.1, node.x, node.y, node.radius);
        
        if (node.rank === 1) {
          // Gold
          fillGrad.addColorStop(0, '#fde047');
          fillGrad.addColorStop(1, '#ca8a04');
        } else if (node.rank === 2) {
          // Silver
          fillGrad.addColorStop(0, '#f1f5f9');
          fillGrad.addColorStop(1, '#64748b');
        } else if (node.rank === 3) {
          // Bronze
          fillGrad.addColorStop(0, '#fed7aa');
          fillGrad.addColorStop(1, '#b45309');
        } else {
          // General gradient Indigo/Purple
          fillGrad.addColorStop(0, '#818cf8');
          fillGrad.addColorStop(1, '#4f46e5');
        }
        
        // Render node transparency if dimmed
        ctx.save();
        if (activeHighlightNode && !isHighlighted && !isSelected && !isHovered) {
          ctx.globalAlpha = 0.2;
        } else {
          ctx.globalAlpha = 1.0;
        }

        // Draw shadow/glow on hovered/selected node
        if (isSelected || isHovered) {
          ctx.shadowColor = '#6366f1';
          ctx.shadowBlur = 15;
        }

        ctx.fillStyle = fillGrad;
        ctx.fill();
        ctx.restore();

        // Node borders
        ctx.lineWidth = isSelected || isHovered ? 3.0 : 1.5;
        ctx.strokeStyle = isSelected 
          ? '#f3f4f6' 
          : isHovered 
            ? '#818cf8' 
            : 'rgba(255,255,255,0.15)';
        
        ctx.save();
        if (activeHighlightNode && !isHighlighted && !isSelected && !isHovered) {
          ctx.globalAlpha = 0.25;
        }
        ctx.stroke();
        ctx.restore();

        // Draw Labels
        if (showLabels) {
          ctx.save();
          if (activeHighlightNode && !isHighlighted && !isSelected && !isHovered) {
            ctx.globalAlpha = 0.25;
          }
          
          ctx.fillStyle = isSelected 
            ? '#ffffff' 
            : isHovered 
              ? '#818cf8' 
              : 'rgba(243, 244, 246, 0.9)';
              
          ctx.font = isSelected || isHovered 
            ? 'bold 12px "Outfit", sans-serif' 
            : '500 11px "Inter", sans-serif';
            
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(node.id, node.x, node.y + node.radius + 5);
          ctx.restore();
        }
      });
      
      ctx.restore();
      
      animId = requestAnimationFrame(runFrame);
    };

    animId = requestAnimationFrame(runFrame);
    
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [transform, hoveredNode, selectedTeam, draggedNode, showLabels]);

  // Coordinate conversion helper from Screen to Sim Space
  const getMouseCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    
    // Convert screen coordinates to simulation coordinates
    const simX = (clientX - transform.x) / transform.scale;
    const simY = (clientY - transform.y) / transform.scale;
    
    return { x: simX, y: simY, screenX: clientX, screenY: clientY };
  };

  const handleMouseDown = (e) => {
    const coords = getMouseCoords(e);
    isMouseDownRef.current = true;
    lastMousePosRef.current = { x: coords.screenX, y: coords.screenY };

    // Check if clicked a node
    const snodes = simNodesRef.current;
    let clickedNode = null;
    
    for (let i = snodes.length - 1; i >= 0; i--) {
      const node = snodes[i];
      const dx = coords.x - node.x;
      const dy = coords.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= node.radius + 5) {
        clickedNode = node;
        break;
      }
    }

    if (clickedNode) {
      setDraggedNode(clickedNode);
      onSelectTeam(clickedNode.id);
      isPanningRef.current = false;
    } else {
      isPanningRef.current = true;
    }
  };

  const handleMouseMove = (e) => {
    const coords = getMouseCoords(e);
    const snodes = simNodesRef.current;

    // Handle node dragging
    if (draggedNode && isMouseDownRef.current) {
      draggedNode.x = coords.x;
      draggedNode.y = coords.y;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      return;
    }

    // Handle panning
    if (isPanningRef.current && isMouseDownRef.current) {
      const dx = coords.screenX - lastMousePosRef.current.x;
      const dy = coords.screenY - lastMousePosRef.current.y;
      
      setTransform(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));
      
      lastMousePosRef.current = { x: coords.screenX, y: coords.screenY };
      return;
    }

    // Handle node hover checking
    let hoverItem = null;
    for (let i = snodes.length - 1; i >= 0; i--) {
      const node = snodes[i];
      const dx = coords.x - node.x;
      const dy = coords.y - node.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= node.radius + 8) {
        hoverItem = node.id;
        break;
      }
    }
    setHoveredNode(hoverItem);
  };

  const handleMouseUp = () => {
    isMouseDownRef.current = false;
    setDraggedNode(null);
    isPanningRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const zoomIntensity = 0.08;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? (1 + zoomIntensity) : (1 - zoomIntensity);
    const nextScale = Math.max(0.15, Math.min(4, transform.scale * zoomFactor));

    // Zoom to mouse pointer position
    const nextX = mouseX - (mouseX - transform.x) * (nextScale / transform.scale);
    const nextY = mouseY - (mouseY - transform.y) * (nextScale / transform.scale);

    setTransform({
      x: nextX,
      y: nextY,
      scale: nextScale
    });
  };

  // Zoom control buttons
  const zoomIn = () => {
    setTransform(prev => {
      const nextScale = Math.min(4, prev.scale * 1.25);
      return {
        scale: nextScale,
        x: prev.x - 100 * prev.scale, // simple offset toward center
        y: prev.y - 75 * prev.scale
      };
    });
  };

  const zoomOut = () => {
    setTransform(prev => {
      const nextScale = Math.max(0.15, prev.scale / 1.25);
      return {
        scale: nextScale,
        x: prev.x + 80 * prev.scale,
        y: prev.y + 60 * prev.scale
      };
    });
  };

  const resetView = () => {
    if (!canvasRef.current) return;
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    
    // Spread nodes back out slightly
    simNodesRef.current.forEach((node, idx) => {
      const angle = (idx / simNodesRef.current.length) * Math.PI * 2;
      const radius = Math.min(width, height) * 0.35;
      node.x = width / 2 + Math.cos(angle) * radius;
      node.y = height / 2 + Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
    });

    setTransform({
      x: width / 2 - (width / 2) * 0.8,
      y: height / 2 - (height / 2) * 0.8,
      scale: 0.8
    });
  };

  return (
    <div className="card graph-card" ref={containerRef} style={{ padding: 0 }}>
      {/* Canvas */}
      <canvas 
        ref={canvasRef}
        width={780}
        height={600}
        style={{ cursor: draggedNode ? 'grabbing' : isPanningRef.current ? 'move' : 'default', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Toolbar Controls */}
      <div className="graph-toolbar">
        <button className="btn-secondary" onClick={zoomIn} title="Zoom In">
          <ZoomIn size={16} />
        </button>
        <button className="btn-secondary" onClick={zoomOut} title="Zoom Out">
          <ZoomOut size={16} />
        </button>
        <button className="btn-secondary" onClick={resetView} title="Reset Simulation & View">
          <RefreshCw size={16} />
        </button>
        <button 
          className={`btn-secondary ${showLabels ? 'active' : ''}`}
          onClick={() => setShowLabels(s => !s)}
          title="Toggle Labels"
          style={showLabels ? { backgroundColor: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' } : {}}
        >
          Layers
        </button>
        
        {/* Top Count Selection */}
        <select 
          value={topCount}
          onChange={(e) => setTopCount(parseInt(e.target.value))}
          className="form-input"
          style={{ width: '120px', padding: '0.2rem 0.5rem', fontSize: '0.8rem', backgroundPosition: 'right 0.5rem center' }}
        >
          <option value="20">Top 20 Teams</option>
          <option value="30">Top 30 Teams</option>
          <option value="40">Top 40 Teams</option>
          <option value="60">Top 60 Teams</option>
          <option value="85">Top 85 Teams</option>
        </select>
      </div>

      <div className="graph-instructions">
        <strong>Controls:</strong>
        <ul style={{ paddingLeft: '1rem', marginTop: '0.25rem', listStyleType: 'disc' }}>
          <li>Drag background to Pan</li>
          <li>Scroll wheel to Zoom</li>
          <li>Drag nodes to move</li>
          <li>Hover to view links</li>
          <li>Click to inspect</li>
        </ul>
      </div>
    </div>
  );
}
