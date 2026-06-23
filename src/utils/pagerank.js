/**
 * Normalizes team names based on former_names.csv rules.
 * @param {string} name - The original team name.
 * @param {string} dateStr - The match date (YYYY-MM-DD).
 * @param {Array} nameRules - Array of rules { current, former, start_date, end_date }
 * @returns {string} The normalized team name.
 */
export function normalizeTeamName(name, dateStr, nameRules) {
  if (!name || !nameRules || nameRules.length === 0) return name;
  
  const matchDate = new Date(dateStr);
  if (isNaN(matchDate.getTime())) return name;

  const rule = nameRules.find(r => {
    if (r.former.toLowerCase() !== name.toLowerCase()) return false;
    
    // Check start date
    if (r.start_date) {
      const start = new Date(r.start_date);
      if (!isNaN(start.getTime()) && matchDate < start) return false;
    }
    
    // Check end date
    if (r.end_date) {
      const end = new Date(r.end_date);
      if (!isNaN(end.getTime()) && matchDate > end) return false;
    }
    
    return true;
  });

  return rule ? rule.current : name;
}

/**
 * Builds a shootout lookup map from parsed shootouts CSV rows.
 * Normalized names are used for keys.
 * @param {Array} shootouts - Parsed shootouts rows
 * @param {Array} nameRules - Normalization rules
 * @returns {Object} A map from "date_home_away" to shootout winner
 */
export function buildShootoutsMap(shootouts, nameRules) {
  const map = {};
  if (!shootouts) return map;

  shootouts.forEach(s => {
    if (!s.date || !s.home_team || !s.away_team || !s.winner) return;
    
    const normHome = normalizeTeamName(s.home_team, s.date, nameRules);
    const normAway = normalizeTeamName(s.away_team, s.date, nameRules);
    const normWinner = normalizeTeamName(s.winner, s.date, nameRules);
    
    // Key format: YYYY-MM-DD_HomeTeam_AwayTeam
    const key = `${s.date}_${normHome}_${normAway}`;
    map[key] = normWinner;
  });

  return map;
}

/**
 * Constructs a directed weighted graph from parsed match results.
 */
export function buildGraph({
  matches,
  startDate,
  endDate,
  nameRules = [],
  shootoutsMap = {},
  resolveShootouts = false,
  edgeDirection = 'loser-to-winner', // 'loser-to-winner' (strength) or 'winner-to-loser' (weakness)
  tieWeight = 1
}) {
  const nodesSet = new Set();
  const adj = {};
  
  // Track team statistics in the filtered period
  const stats = {};

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  matches.forEach(m => {
    if (!m.date || !m.home_team || !m.away_team) return;
    
    // Parse date
    const mDate = new Date(m.date);
    if (isNaN(mDate.getTime())) return;
    
    // Filter by date range
    if (start && mDate < start) return;
    if (end && mDate > end) return;
    
    // Check for invalid scores (e.g. future matches with NA)
    if (m.home_score === 'NA' || m.away_score === 'NA' || m.home_score === undefined || m.away_score === undefined) return;
    const hScore = parseInt(m.home_score, 10);
    const aScore = parseInt(m.away_score, 10);
    if (isNaN(hScore) || isNaN(aScore)) return;
    
    // Normalize names based on match date
    const home = normalizeTeamName(m.home_team, m.date, nameRules);
    const away = normalizeTeamName(m.away_team, m.date, nameRules);
    
    // Add to nodes set
    nodesSet.add(home);
    nodesSet.add(away);
    
    // Initialize stats
    if (!stats[home]) stats[home] = { wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, matches: 0 };
    if (!stats[away]) stats[away] = { wins: 0, losses: 0, draws: 0, goalsFor: 0, goalsAgainst: 0, matches: 0 };
    
    // Initialize adjacency list
    if (!adj[home]) adj[home] = [];
    if (!adj[away]) adj[away] = [];

    // Accumulate goal statistics
    stats[home].goalsFor += hScore;
    stats[home].goalsAgainst += aScore;
    stats[home].matches += 1;
    
    stats[away].goalsFor += aScore;
    stats[away].goalsAgainst += hScore;
    stats[away].matches += 1;

    let winner = null;
    let loser = null;
    let goalDiff = 0;
    
    if (hScore > aScore) {
      winner = home;
      loser = away;
      goalDiff = hScore - aScore;
      stats[home].wins += 1;
      stats[away].losses += 1;
    } else if (aScore > hScore) {
      winner = away;
      loser = home;
      goalDiff = aScore - hScore;
      stats[away].wins += 1;
      stats[home].losses += 1;
    } else {
      // Tie
      stats[home].draws += 1;
      stats[away].draws += 1;
      
      // Check if shootout resolved the tie
      let shootoutWinner = null;
      if (resolveShootouts) {
        const key = `${m.date}_${home}_${away}`;
        shootoutWinner = shootoutsMap[key];
      }

      if (shootoutWinner) {
        winner = shootoutWinner;
        loser = (shootoutWinner === home) ? away : home;
        goalDiff = 0; // standard shootout win counts as 0 goal diff in graph logic (weight = 1)
      }
    }

    if (winner && loser) {
      const weight = goalDiff + 1;
      if (edgeDirection === 'loser-to-winner') {
        // Loser votes for Winner (PageRank flow loser -> winner)
        adj[loser].push({ to: winner, weight, match: m });
      } else {
        // Winner votes for Loser (PageRank flow winner -> loser)
        adj[winner].push({ to: loser, weight, match: m });
      }
    } else {
      // Unresolved Tie: add both edges with custom tie weight
      adj[home].push({ to: away, weight: tieWeight, match: m });
      adj[away].push({ to: home, weight: tieWeight, match: m });
    }
  });

  const nodes = Array.from(nodesSet);
  return { nodes, adj, stats };
}

/**
 * Runs the PageRank algorithm on the constructed graph.
 */
export function calculatePageRank({
  nodes,
  adj,
  dampingFactor = 0.85,
  maxIterations = 100,
  tolerance = 1e-6
}) {
  const N = nodes.length;
  if (N === 0) return { ranks: [], iterations: 0, converged: false };

  // 1. Initialize PageRank values equally
  let PR = {};
  nodes.forEach(node => {
    PR[node] = 1 / N;
  });

  // 2. Pre-calculate out-weights and collect sink nodes
  const outWeights = {};
  const sinks = [];

  nodes.forEach(node => {
    let weightSum = 0;
    const edges = adj[node] || [];
    edges.forEach(edge => {
      weightSum += edge.weight;
    });
    
    outWeights[node] = weightSum;
    if (weightSum === 0) {
      sinks.push(node);
    }
  });

  let converged = false;
  let iterations = 0;
  let diff = 0;

  // 3. Power iteration loop
  for (let iter = 0; iter < maxIterations; iter++) {
    iterations++;
    const nextPR = {};
    nodes.forEach(node => {
      nextPR[node] = (1 - dampingFactor) / N;
    });

    // Sum of PageRank of all sink nodes
    let sinkSum = 0;
    sinks.forEach(sink => {
      sinkSum += PR[sink];
    });

    // Distribute PageRank along outgoing edges
    nodes.forEach(u => {
      const edges = adj[u] || [];
      const outW = outWeights[u];
      
      if (outW > 0) {
        const prVal = PR[u];
        edges.forEach(edge => {
          const w = edge.weight;
          const target = edge.to;
          nextPR[target] += dampingFactor * prVal * (w / outW);
        });
      }
    });

    // Distribute sink node PageRank equally among all nodes
    const sinkDistribution = (dampingFactor * sinkSum) / N;
    nodes.forEach(v => {
      nextPR[v] += sinkDistribution;
    });

    // Check convergence
    diff = 0;
    nodes.forEach(node => {
      diff += Math.abs(nextPR[node] - PR[node]);
    });

    PR = nextPR;

    if (diff < tolerance) {
      converged = true;
      break;
    }
  }

  // Normalize/sort ranks
  const sortedRanks = Object.entries(PR)
    .map(([team, score]) => ({ team, score }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({
      rank: index + 1,
      team: item.team,
      score: item.score
    }));

  return {
    ranks: sortedRanks,
    iterations,
    converged,
    toleranceDiff: diff
  };
}
