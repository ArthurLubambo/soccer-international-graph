import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import {
  Trophy,
  Network,
  Settings,
  Search,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  Calendar,
  AlertTriangle,
  Play,
  ArrowRight,
  TrendingUp,
  X,
  Share2,
  Check
} from 'lucide-react';
import { buildGraph, calculatePageRank, buildShootoutsMap } from './utils/pagerank';
import { FIFA_MEMBERS } from './data/fifaMembers';
import NetworkGraph from './components/NetworkGraph';

function PageRankDiagram() {
  const nodes = [
    { label: 'Weak',    y: 185, r: 22, opacity: 0.35 },
    { label: 'Average', y: 115, r: 27, opacity: 0.65 },
    { label: 'Elite',   y:  38, r: 33, opacity: 1.00 },
  ];
  const cx = 80;
  return (
    <svg viewBox="0 0 160 230" width="100%" style={{ display: 'block', margin: '0 auto', maxWidth: 200 }}>
      <defs>
        <marker id="hiw-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,1 L0,7 L7,4 Z" fill="#6366f1" />
        </marker>
      </defs>

      {/* Animated flow lines */}
      {[{ y1: 163, y2: 148 }, { y1: 92, y2: 76 }].map(({ y1, y2 }, i) => (
        <line key={i} x1={cx} y1={y1} x2={cx} y2={y2}
          className="hiw-flow-line"
          style={{ animationDelay: `${i * 0.4}s` }}
          markerEnd="url(#hiw-arrow)"
        />
      ))}

      {/* Nodes */}
      {nodes.map(({ label, y, r, opacity }) => (
        <g key={label}>
          <circle cx={cx} cy={y} r={r}
            fill={`rgba(99,102,241,${opacity})`}
            stroke="#6366f1" strokeWidth="1.5"
          />
          <text x={cx} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="9" fontWeight="600" fill="white" fontFamily="Inter,sans-serif">
            {label}
          </text>
        </g>
      ))}

      {/* Legend */}
      <text x={cx} y={220} textAnchor="middle" fontSize="8.5"
        fill="#9ca3af" fontFamily="Inter,sans-serif">
        score flows from loser → winner
      </text>
    </svg>
  );
}

function App() {
  // Data loading states
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [rawMatches, setRawMatches] = useState([]);
  const [rawNameRules, setRawNameRules] = useState([]);
  const [rawShootouts, setRawShootouts] = useState([]);

  // UI state
  const [activeTab, setActiveTab] = useState('rankings'); // 'rankings' | 'graph'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [sortConfig, setSortConfig] = useState({ key: 'score', direction: 'desc' });
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // PageRank config state
  const [startYear, setStartYear] = useState(2023);
  const [endYear, setEndYear] = useState(2026);
  const [minAvailableYear, setMinAvailableYear] = useState(1872);
  const [maxAvailableYear, setMaxAvailableYear] = useState(2026);

  const [dampingFactor, setDampingFactor] = useState(0.95);
  const [maxIterations, setMaxIterations] = useState(100);
  const [tolerance, setTolerance] = useState(1e-6);
  const [resolveShootouts, setResolveShootouts] = useState(false);
  const [normalizeNames, setNormalizeNames] = useState(true);
  const [tieWeight, setTieWeight] = useState(1.0);
  const [fifaOnly, setFifaOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  // Read URL params once on first mount (before data loads)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.has('sy'))   setStartYear(parseInt(p.get('sy')));
    if (p.has('ey'))   setEndYear(parseInt(p.get('ey')));
    if (p.has('d'))    setDampingFactor(parseFloat(p.get('d')));
    if (p.has('iter')) setMaxIterations(parseInt(p.get('iter')));
    if (p.has('tol'))  setTolerance(parseFloat(p.get('tol')));
    if (p.has('tw'))   setTieWeight(parseFloat(p.get('tw')));
    if (p.has('rs'))   setResolveShootouts(p.get('rs') === '1');
    if (p.has('nn'))   setNormalizeNames(p.get('nn') === '1');
    if (p.has('fifa')) setFifaOnly(p.get('fifa') === '1');
    if (p.has('tab'))  setActiveTab(p.get('tab'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep URL in sync with current params (replaceState = no history spam)
  useEffect(() => {
    if (loading) return;
    const p = new URLSearchParams({
      sy:   startYear,
      ey:   endYear,
      d:    dampingFactor,
      iter: maxIterations,
      tol:  tolerance,
      tw:   tieWeight,
      rs:   resolveShootouts ? '1' : '0',
      nn:   normalizeNames   ? '1' : '0',
      fifa: fifaOnly         ? '1' : '0',
      tab:  activeTab,
    });
    window.history.replaceState(null, '', `?${p.toString()}`);
  }, [loading, startYear, endYear, dampingFactor, maxIterations, tolerance,
      tieWeight, resolveShootouts, normalizeNames, fifaOnly, activeTab]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Load and Parse CSV files on mount
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setErrorMsg('');
        
        // Run fetches in parallel
        const [resMatches, resNames, resShootouts] = await Promise.all([
          fetch('/data/results.csv').then(res => {
            if (!res.ok) throw new Error('Failed to fetch results.csv');
            return res.text();
          }),
          fetch('/data/former_names.csv').then(res => {
            if (!res.ok) throw new Error('Failed to fetch former_names.csv');
            return res.text();
          }),
          fetch('/data/shootouts.csv').then(res => {
            if (!res.ok) throw new Error('Failed to fetch shootouts.csv');
            return res.text();
          })
        ]);

        // Parse matches CSV
        const parsedMatches = Papa.parse(resMatches, { 
          header: true, 
          skipEmptyLines: true 
        }).data;

        // Parse former names CSV
        const parsedNames = Papa.parse(resNames, { 
          header: true, 
          skipEmptyLines: true 
        }).data;

        // Parse shootouts CSV
        const parsedShootouts = Papa.parse(resShootouts, { 
          header: true, 
          skipEmptyLines: true 
        }).data;

        setRawMatches(parsedMatches);
        setRawNameRules(parsedNames);
        setRawShootouts(parsedShootouts);

        // Compute available years
        let minYear = 1872;
        let maxYear = 2026;
        
        if (parsedMatches.length > 0) {
          const years = parsedMatches
            .map(m => m.date ? new Date(m.date).getFullYear() : null)
            .filter(y => y !== null && !isNaN(y));
          if (years.length > 0) {
            minYear = Math.min(...years);
            maxYear = Math.max(...years);
          }
        }
        
        setMinAvailableYear(minYear);
        setMaxAvailableYear(maxYear);

        // Only apply defaults if URL has no year params
        const p = new URLSearchParams(window.location.search);
        if (!p.has('sy')) setStartYear(Math.max(minYear, 2023));
        if (!p.has('ey')) setEndYear(maxYear);
        setLoading(false);
      } catch (err) {
        console.error(err);
        setErrorMsg(`Error loading data: ${err.message}. Make sure results.csv, former_names.csv and shootouts.csv exist in the public/data/ directory.`);
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Compute shootouts map using active normalization rules
  const shootoutsMap = useMemo(() => {
    return buildShootoutsMap(rawShootouts, normalizeNames ? rawNameRules : []);
  }, [rawShootouts, rawNameRules, normalizeNames]);

  // Compute graph structure
  const graphData = useMemo(() => {
    if (rawMatches.length === 0) return { nodes: [], adj: {}, stats: {} };
    
    // Construct Date strings
    const startDateStr = `${startYear}-01-01`;
    const endDateStr = `${endYear}-12-31`;

    return buildGraph({
      matches: rawMatches,
      startDate: startDateStr,
      endDate: endDateStr,
      nameRules: normalizeNames ? rawNameRules : [],
      shootoutsMap,
      resolveShootouts,
      edgeDirection: 'loser-to-winner',
      tieWeight
    });
  }, [
    rawMatches,
    startYear,
    endYear,
    rawNameRules,
    normalizeNames,
    shootoutsMap,
    resolveShootouts,
    tieWeight
  ]);

  // Compute PageRank on the graphData
  const prResult = useMemo(() => {
    return calculatePageRank({
      nodes: graphData.nodes,
      adj: graphData.adj,
      dampingFactor,
      maxIterations,
      tolerance
    });
  }, [graphData, dampingFactor, maxIterations, tolerance]);

  // Merge PageRank results with Team Stats
  const teamRankings = useMemo(() => {
    if (!prResult.ranks) return [];
    
    return prResult.ranks.map(pr => {
      const stats = graphData.stats[pr.team] || { wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, matches: 0 };
      const gd = stats.goalsFor - stats.goalsAgainst;
      
      return {
        ...pr,
        matches: stats.matches,
        wins: stats.wins,
        draws: stats.draws,
        losses: stats.losses,
        goalsFor: stats.goalsFor,
        goalsAgainst: stats.goalsAgainst,
        goalDiff: gd
      };
    });
  }, [prResult.ranks, graphData.stats]);

  // Filter rankings by search query and FIFA membership
  const filteredRankings = useMemo(() => {
    let result = teamRankings;
    if (fifaOnly) result = result.filter(r => FIFA_MEMBERS.has(r.team));
    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(r => r.team.toLowerCase().includes(query));
    }
    return result;
  }, [teamRankings, searchQuery, fifaOnly]);

  // Sort rankings
  const sortedRankings = useMemo(() => {
    const sortableItems = [...filteredRankings];
    if (sortConfig.key !== null) {
      sortableItems.sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];
        
        // Handle sorting alphabetically for team name
        if (typeof aVal === 'string') {
          return sortConfig.direction === 'asc' 
            ? aVal.localeCompare(bVal) 
            : bVal.localeCompare(aVal);
        }
        
        // Numbers sorting
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }
    return sortableItems;
  }, [filteredRankings, sortConfig]);

  // Paginated Rankings
  const paginatedRankings = useMemo(() => {
    const startIndex = (page - 1) * pageSize;
    return sortedRankings.slice(startIndex, startIndex + pageSize);
  }, [sortedRankings, page, pageSize]);

  // Total pages count
  const totalPages = Math.max(1, Math.ceil(sortedRankings.length / pageSize));

  // Reset page when anything that changes the rankings changes
  useEffect(() => {
    setPage(1);
  }, [searchQuery, dampingFactor, maxIterations, tolerance, tieWeight,
      startYear, endYear, resolveShootouts, normalizeNames, fifaOnly]);

  // Stats for the stats row
  const dashboardStats = useMemo(() => {
    let totalMatchesFiltered = 0;
    let totalGoalsFiltered = 0;
    
    // Count total matches (each match was registered twice in stats unless we look at the raw matches)
    const startDateStr = `${startYear}-01-01`;
    const endDateStr = `${endYear}-12-31`;
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    
    rawMatches.forEach(m => {
      if (!m.date) return;
      const mDate = new Date(m.date);
      if (mDate >= start && mDate <= end) {
        if (m.home_score !== 'NA' && m.away_score !== 'NA' && m.home_score !== undefined && m.away_score !== undefined) {
          const hs = parseInt(m.home_score, 10);
          const as = parseInt(m.away_score, 10);
          if (!isNaN(hs) && !isNaN(as)) {
            totalMatchesFiltered++;
            totalGoalsFiltered += (hs + as);
          }
        }
      }
    });

    const avgGoals = totalMatchesFiltered > 0 ? (totalGoalsFiltered / totalMatchesFiltered).toFixed(2) : '0.00';
    
    // Calculate density: actual edges / potential edges
    const teamCount = graphData.nodes.length;
    let edgeCount = 0;
    Object.values(graphData.adj).forEach(edges => {
      edgeCount += edges.length;
    });
    const maxEdges = teamCount * (teamCount - 1);
    const density = maxEdges > 0 ? (edgeCount / maxEdges * 100).toFixed(2) : '0.00';

    return {
      teamCount,
      matchCount: totalMatchesFiltered,
      avgGoals,
      density: `${density}%`
    };
  }, [rawMatches, startYear, endYear, graphData]);

  // Detailed Team Inspection statistics (Incoming PageRank inflows and outflows)
  const teamDetailData = useMemo(() => {
    if (!selectedTeam) return null;
    
    const teamStats = graphData.stats[selectedTeam] || { wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, matches: 0 };
    const rankInfo = teamRankings.find(r => r.team === selectedTeam) || { rank: 'N/A', score: 0 };

    // We want to see who passes PageRank to this team (Inflows)
    // Under loser -> winner: edges point from loser to winner.
    // If edge direction is loser-to-winner:
    //   - Inflow: Outgoing edges of other teams pointing to this team. (e.g. Teams that this team beat)
    //   - Outflow: Outgoing edges of this team pointing to other teams. (e.g. Teams that beat this team)
    // If edge direction is winner-to-loser:
    //   - Inflow: Outgoing edges of other teams pointing to this team. (e.g. Teams that beat this team)
    //   - Outflow: Outgoing edges of this team pointing to other teams. (e.g. Teams that this team beat)
    
    const inflows = [];
    const outflows = [];
    
    // Loop through all nodes to find matches pointing to `selectedTeam`
    graphData.nodes.forEach(otherTeam => {
      const edges = graphData.adj[otherTeam] || [];
      edges.forEach(edge => {
        if (edge.to === selectedTeam) {
          inflows.push({
            opponent: otherTeam,
            weight: edge.weight,
            match: edge.match
          });
        }
      });
    });

    // Outflow: edges pointing FROM selectedTeam TO other teams
    const outEdges = graphData.adj[selectedTeam] || [];
    outEdges.forEach(edge => {
      outflows.push({
        opponent: edge.to,
        weight: edge.weight,
        match: edge.match
      });
    });

    // Group flows by opponent to show aggregated weights
    const aggregateFlows = (flowArray) => {
      const grouped = {};
      flowArray.forEach(item => {
        if (!grouped[item.opponent]) {
          grouped[item.opponent] = { opponent: item.opponent, totalWeight: 0, count: 0, matchesList: [] };
        }
        grouped[item.opponent].totalWeight += item.weight;
        grouped[item.opponent].count += 1;
        grouped[item.opponent].matchesList.push(item.match);
      });
      return Object.values(grouped).sort((a, b) => b.totalWeight - a.totalWeight);
    };

    return {
      team: selectedTeam,
      rank: rankInfo.rank,
      score: rankInfo.score,
      stats: teamStats,
      inflows: aggregateFlows(inflows),
      outflows: aggregateFlows(outflows)
    };
  }, [selectedTeam, graphData, teamRankings]);

  // Request sorting on table headers
  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand">
          <Trophy className="brand-icon" size={24} />
          <h1>International Football Ranker</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Data source: {rawMatches.length.toLocaleString()} matches (1872 - 2026)
          </span>
          <button
            onClick={handleShare}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 600,
              background: copied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${copied ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.15)'}`,
              borderRadius: '0.5rem', color: copied ? '#4ade80' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'all 0.2s'
            }}
          >
            {copied ? <Check size={14} /> : <Share2 size={14} />}
            {copied ? 'Copied!' : 'Share'}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <h2>Loading & Pre-processing Soccer Datasets...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Parsing matches, former country mappings, and penalty shootout data.</p>
        </div>
      ) : errorMsg ? (
        <div className="loading-overlay" style={{ color: 'var(--error)' }}>
          <AlertTriangle size={48} />
          <h2>Failed to Load Application Data</h2>
          <p style={{ maxWidth: '600px', textAlign: 'center', marginTop: '1rem' }}>{errorMsg}</p>
        </div>
      ) : (
        <main className="dashboard">
          {/* Left Controls Panel */}
          <section className="sidebar">
            {/* PageRank Configuration Card */}
            <div className="card">
              <h2 className="card-title">
                <Sliders size={18} className="text-warning" />
                Network Parameters
              </h2>
              
              {/* Date Filter */}
              <div className="form-group">
                <label style={{ marginBottom: '0.5rem', display: 'block' }}>
                  <Calendar size={13} style={{ verticalAlign: 'middle', marginRight: '0.3rem' }} />
                  Match Year Range
                </label>

                {/* From row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', width: '2.5rem', flexShrink: 0 }}>From</span>
                  <input
                    type="range"
                    min={minAvailableYear}
                    max={maxAvailableYear}
                    value={startYear}
                    onChange={(e) => setStartYear(Math.min(parseInt(e.target.value), endYear))}
                    style={{ flex: 1, cursor: 'pointer' }}
                  />
                  <input
                    type="number"
                    min={minAvailableYear}
                    max={endYear}
                    value={startYear}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v >= minAvailableYear && v <= endYear) setStartYear(v);
                    }}
                    style={{ width: '4rem', padding: '0.2rem 0.3rem', fontSize: '0.8rem', background: 'var(--bg-input, rgba(255,255,255,0.07))', border: '1px solid var(--border-color)', borderRadius: '0.3rem', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                </div>

                {/* To row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', width: '2.5rem', flexShrink: 0 }}>To</span>
                  <input
                    type="range"
                    min={minAvailableYear}
                    max={maxAvailableYear}
                    value={endYear}
                    onChange={(e) => setEndYear(Math.max(parseInt(e.target.value), startYear))}
                    style={{ flex: 1, cursor: 'pointer' }}
                  />
                  <input
                    type="number"
                    min={startYear}
                    max={maxAvailableYear}
                    value={endYear}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (!isNaN(v) && v >= startYear && v <= maxAvailableYear) setEndYear(v);
                    }}
                    style={{ width: '4rem', padding: '0.2rem 0.3rem', fontSize: '0.8rem', background: 'var(--bg-input, rgba(255,255,255,0.07))', border: '1px solid var(--border-color)', borderRadius: '0.3rem', color: 'var(--text-primary)', textAlign: 'center' }}
                  />
                </div>

                {/* Quick presets */}
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                  {[5, 10, 20, 50].map(n => (
                    <button
                      key={n}
                      className="btn-secondary"
                      style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}
                      onClick={() => { setStartYear(Math.max(minAvailableYear, maxAvailableYear - n)); setEndYear(maxAvailableYear); }}
                    >
                      Last {n}y
                    </button>
                  ))}
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}
                    onClick={() => { setStartYear(minAvailableYear); setEndYear(maxAvailableYear); }}
                  >
                    All time
                  </button>
                </div>
              </div>

              {/* PageRank Damping Factor */}
              <div className="form-group">
                <label>Damping Factor (d = {dampingFactor})</label>
                <input 
                  type="range" 
                  min="0.1" 
                  max="0.95" 
                  step="0.05" 
                  value={dampingFactor} 
                  onChange={(e) => setDampingFactor(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              {/* Advanced Settings Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1rem 0 0.5rem 0' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Advanced Graph Settings</span>
                <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-color)' }}></div>
              </div>

              {/* Normalize Names Toggle */}
              <div className="toggle-group">
                <label htmlFor="toggle-normalize">Normalize Historical Names</label>
                <span className="toggle-switch">
                  <input 
                    type="checkbox" 
                    id="toggle-normalize" 
                    checked={normalizeNames}
                    onChange={(e) => setNormalizeNames(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </span>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                Maps former names to modern names (e.g. Swaziland to Eswatini) based on match date.
              </p>

              {/* Resolve Shootouts Toggle */}
              <div className="toggle-group">
                <label htmlFor="toggle-shootouts">Resolve Shootout Winners</label>
                <span className="toggle-switch">
                  <input 
                    type="checkbox" 
                    id="toggle-shootouts" 
                    checked={resolveShootouts}
                    onChange={(e) => setResolveShootouts(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </span>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                Uses shootout database to determine a winner for ties, instead of treating them as draws.
              </p>

              {/* FIFA Members Only Toggle */}
              <div className="toggle-group">
                <label htmlFor="toggle-fifa">FIFA Members Only</label>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    id="toggle-fifa"
                    checked={fifaOnly}
                    onChange={(e) => setFifaOnly(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </span>
              </div>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                Hides non-FIFA entities (e.g. Abkhazia, Northern Cyprus) from the rankings.
              </p>

              {/* Tie Weight */}
              <div className="form-group">
                <label htmlFor="tieWeight">Tie Weight: {tieWeight}</label>
                <input 
                  type="range" 
                  min="0" 
                  max="2" 
                  step="0.1" 
                  value={tieWeight} 
                  onChange={(e) => setTieWeight(parseFloat(e.target.value))}
                  style={{ width: '100%', cursor: 'pointer' }}
                />
              </div>

              {/* Algorithm Details Summary */}
              <div style={{ padding: '0.75rem', backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span>Iterations run:</span>
                  <span className="text-success" style={{ fontWeight: 600 }}>{prResult.iterations}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span>Tolerance limit:</span>
                  <span>{tolerance}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Convergence diff:</span>
                  <span>{prResult.toleranceDiff ? prResult.toleranceDiff.toExponential(3) : '0.000'}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Right Dashboard Area */}
          <section className="main-content">
            {/* Stats Row */}
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-icon">
                  <Trophy size={18} />
                </div>
                <div className="stat-info">
                  <h3>Active Teams</h3>
                  <p>{dashboardStats.teamCount}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ color: 'var(--success)', backgroundColor: 'rgba(16, 185, 129, 0.1)' }}>
                  <Calendar size={18} />
                </div>
                <div className="stat-info">
                  <h3>Match Count</h3>
                  <p>{dashboardStats.matchCount.toLocaleString()}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ color: 'var(--warning)', backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                  <TrendingUp size={18} />
                </div>
                <div className="stat-info">
                  <h3>Avg Goals/Game</h3>
                  <p>{dashboardStats.avgGoals}</p>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon" style={{ color: 'var(--accent-secondary)', backgroundColor: 'rgba(168, 85, 247, 0.1)' }}>
                  <Network size={18} />
                </div>
                <div className="stat-info">
                  <h3>Graph Density</h3>
                  <p>{dashboardStats.density}</p>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="tabs" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                className={`tab-btn ${activeTab === 'rankings' ? 'active' : ''}`}
                onClick={() => setActiveTab('rankings')}
              >
                <Trophy size={16} />
                Rankings Table
              </button>
              <button
                className={`tab-btn ${activeTab === 'graph' ? 'active' : ''}`}
                onClick={() => setActiveTab('graph')}
              >
                <Network size={16} />
                Interactive Graph Visualizer
              </button>
              <button className="how-it-works-btn" onClick={() => setShowHowItWorks(true)} style={{ marginLeft: 'auto' }}>
                <Info size={15} /> How it works
              </button>
            </div>

            {/* Workspace: Rankings/Graph Split-screen with details inspector */}
            <div className="workspace-layout">
              {/* Left Side: Table or Visualizer */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {activeTab === 'rankings' ? (
                  <div className="card" style={{ flex: 1 }}>
                    {/* Table search toolbar */}
                    <div className="search-container">
                      <Search className="search-icon" size={18} />
                      <input 
                        type="text" 
                        placeholder="Search team names (e.g. Brazil, Argentina, France)..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="search-input"
                      />
                      {searchQuery && (
                        <button 
                          onClick={() => setSearchQuery('')}
                          style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                        >
                          <X size={16} />
                        </button>
                      )}
                    </div>

                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th style={{ width: '60px', textAlign: 'center' }}>Rank</th>
                            <th className="sortable" onClick={() => requestSort('team')}>Team Name</th>
                            <th className="sortable" style={{ textAlign: 'right' }} onClick={() => requestSort('score')}>PageRank Score</th>
                            <th className="sortable" style={{ textAlign: 'center' }} onClick={() => requestSort('matches')}>Played</th>
                            <th style={{ textAlign: 'center' }}>Record (W-D-L)</th>
                            <th className="sortable" style={{ textAlign: 'center' }} onClick={() => requestSort('goalDiff')}>GD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedRankings.length > 0 ? (
                            paginatedRankings.map((teamRow) => {
                              const isSelected = selectedTeam === teamRow.team;
                              const rankClass = teamRow.rank <= 3 ? `rank-${teamRow.rank}` : '';
                              
                              return (
                                <tr 
                                  key={teamRow.team} 
                                  className={`table-row ${isSelected ? 'selected' : ''}`}
                                  onClick={() => setSelectedTeam(teamRow.team)}
                                >
                                  <td style={{ textAlign: 'center' }}>
                                    <span className={`rank-badge ${rankClass}`}>{teamRow.rank}</span>
                                  </td>
                                  <td className="team-name-cell">{teamRow.team}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    <span className="score-badge">{(teamRow.score * 100).toFixed(4)}%</span>
                                  </td>
                                  <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{teamRow.matches}</td>
                                  <td style={{ textAlign: 'center', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                    <span className="text-success">{teamRow.wins}</span>-
                                    <span>{teamRow.draws}</span>-
                                    <span className="text-error">{teamRow.losses}</span>
                                  </td>
                                  <td style={{ textAlign: 'center', fontWeight: '600' }} className={teamRow.goalDiff > 0 ? 'text-success' : teamRow.goalDiff < 0 ? 'text-error' : ''}>
                                    {teamRow.goalDiff > 0 ? `+${teamRow.goalDiff}` : teamRow.goalDiff}
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                                No teams found matching search query.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div className="pagination">
                        <span>Showing {((page - 1) * pageSize) + 1} - {Math.min(sortedRankings.length, page * pageSize)} of {sortedRankings.length} teams</span>
                        <div className="pagination-buttons">
                          <button 
                            className="btn-secondary" 
                            disabled={page === 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                          >
                            <ChevronLeft size={16} />
                          </button>
                          <span style={{ display: 'flex', alignItems: 'center', padding: '0 0.5rem', fontWeight: 600 }}>Page {page} of {totalPages}</span>
                          <button 
                            className="btn-secondary" 
                            disabled={page === totalPages}
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  // Network Graph visualizer
                  <NetworkGraph 
                    nodes={graphData.nodes}
                    adj={graphData.adj}
                    ranks={prResult.ranks}
                    selectedTeam={selectedTeam}
                    onSelectTeam={setSelectedTeam}
                  />
                )}
              </div>

              {/* Right Side: Team Detail Inspector */}
              <div className="sidebar">
                <div className="card inspector" style={{ minHeight: '400px' }}>
                  <h2 className="card-title">
                    <Info size={18} className="text-success" />
                    Team Inspector
                  </h2>
                  
                  {teamDetailData ? (
                    <div>
                      <div className="inspector-header">
                        <h2>{teamDetailData.team}</h2>
                        <span className="score-badge" style={{ fontSize: '1rem', padding: '0.25rem 0.6rem' }}>
                          Rank #{teamDetailData.rank}
                        </span>
                      </div>
                      
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem', fontFamily: 'monospace' }}>
                        PageRank Score: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{(teamDetailData.score * 100).toFixed(6)}%</span>
                      </div>

                      <div className="inspector-stats-grid">
                        <div className="inspector-stat">
                          <div className="inspector-stat-label">Matches</div>
                          <div className="inspector-stat-val">{teamDetailData.stats.matches}</div>
                        </div>
                        <div className="inspector-stat stat-win">
                          <div className="inspector-stat-label">Wins</div>
                          <div className="inspector-stat-val">{teamDetailData.stats.wins}</div>
                        </div>
                        <div className="inspector-stat stat-loss">
                          <div className="inspector-stat-label">Losses</div>
                          <div className="inspector-stat-val">{teamDetailData.stats.losses}</div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.5rem', fontSize: '0.8rem', backgroundColor: 'rgba(255,255,255,0.02)', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid var(--border-color)' }}>
                        <div style={{ textAlign: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Goals For: </span>
                          <span style={{ fontWeight: 600 }}>{teamDetailData.stats.goalsFor}</span>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Goals Against: </span>
                          <span style={{ fontWeight: 600 }}>{teamDetailData.stats.goalsAgainst}</span>
                        </div>
                      </div>

                      {/* Inflows (Prestige Sources) */}
                      <div className="history-section">
                        <h3 className="history-section-title">
                          <TrendingUp size={14} className="text-success" />
                          Rank Inflows (Sources)
                        </h3>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                          {edgeDirection === 'loser-to-winner' 
                            ? 'Teams this country defeated (they feed PageRank here):' 
                            : 'Teams that defeated this country (they push PageRank here):'}
                        </p>
                        <div className="connection-list">
                          {teamDetailData.inflows.length > 0 ? (
                            teamDetailData.inflows.map((flow) => (
                              <div 
                                key={flow.opponent} 
                                className="connection-item"
                                style={{ cursor: 'pointer' }}
                                onClick={() => setSelectedTeam(flow.opponent)}
                              >
                                <span className="connection-team hover-underline">{flow.opponent}</span>
                                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({flow.count} {flow.count === 1 ? 'match' : 'matches'})</span>
                                  <span className="connection-weight">+{flow.totalWeight}</span>
                                </span>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: '1rem', textAlignment: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              No rank inflows in this configuration.
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Outflows (Prestige Destinations) */}
                      <div className="history-section" style={{ marginTop: '1.25rem' }}>
                        <h3 className="history-section-title">
                          <ArrowRight size={14} className="text-error" />
                          Rank Outflows (Destinations)
                        </h3>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                          {edgeDirection === 'loser-to-winner' 
                            ? 'Teams that defeated this country (we pass PageRank to them):' 
                            : 'Teams this country defeated (we push PageRank to them):'}
                        </p>
                        <div className="connection-list">
                          {teamDetailData.outflows.length > 0 ? (
                            teamDetailData.outflows.map((flow) => (
                              <div 
                                key={flow.opponent} 
                                className="connection-item"
                                style={{ cursor: 'pointer' }}
                                onClick={() => setSelectedTeam(flow.opponent)}
                              >
                                <span className="connection-team hover-underline">{flow.opponent}</span>
                                <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({flow.count} {flow.count === 1 ? 'match' : 'matches'})</span>
                                  <span className="connection-weight">-{flow.totalWeight}</span>
                                </span>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: '1rem', textAlignment: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              No rank outflows in this configuration.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="inspector-placeholder">
                      <Trophy size={36} />
                      <p>Select a country from the rankings table or network graph to inspect their match stats and PageRank flow details.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </main>
      )}

      {showHowItWorks && (
        <div className="hiw-backdrop" onClick={() => setShowHowItWorks(false)}>
          <div className="hiw-card" onClick={e => e.stopPropagation()}>
            <button className="hiw-close" onClick={() => setShowHowItWorks(false)}>
              <X size={16} />
            </button>
            <h3>How PageRank works</h3>
            <p>Every win earns score transferred from the loser. Beating a highly-ranked team moves more score than beating a weak one — like citations between academic papers.</p>
            <PageRankDiagram />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
