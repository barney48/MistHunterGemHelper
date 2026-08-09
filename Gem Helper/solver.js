// Branch-and-bound solver: pick one gem (or leave empty) per slot to best satisfy
// the affix-level goals. An affix's "level" is defined as the count of socketed
// gems that grant it (matches how Mist Hunter affixes stack).
//
// Scoring is LEXICOGRAPHIC (compared left to right, lower is better), so that
// the goal order is a real priority order -- goals listed first are protected
// first, and no amount of shortfall further down can outweigh missing a
// higher-priority target:
//
//   [ shortfall(goal 0), shortfall(goal 1), ... , overflow, gemsUsed ]
//
// overflow = levels stacked past an affix's cap; gemsUsed is the final
// tie-break so that, once every goal is met, spare sockets are left empty
// rather than filled with more of an already-satisfied affix.
//
// (A single weighted sum can't express this: with one shared shortfall weight
// every goal is equally sacrificable and ties break on search order instead.)
const NODE_CAP = 400000;
const TIME_CAP_MS = 4000;

// Compare two score buffers of equal length, lexicographically.
function cmpScore(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

// `baseline` is an {affix: levels} map of affix levels you already have without
// socketing anything -- e.g. affixes built into a gear piece in place of a
// socket. They count toward targets (and toward the affix's cap) for free.
function solveGems(gems, slots, goals, baseline) {
  baseline = baseline || {};
  const activeGoals = goals.filter(g => g.min != null || g.max != null);
  const goalAffixes = activeGoals.map(g => g.affix);
  const goalSet = new Set(goalAffixes);

  const usableSlots = slots
    .map((slot, originalIndex) => ({ slot, originalIndex }))
    .filter(({ slot }) => slot.allowedTypes && slot.allowedTypes.length > 0);

  // Build candidate list per slot: gems of an allowed type that grant >=1 goal
  // affix, deduped by which goal-affixes they'd actually contribute (gems that
  // are interchangeable for scoring purposes collapse to one representative).
  const slotCandidates = usableSlots.map(({ slot }) => {
    const allowed = new Set(slot.allowedTypes);
    const allowedLevels = new Set(slot.allowedLevels || [1, 2]); // an explicit [] is preserved (slot accepts no level); only a missing field defaults to both
    const seenKeys = new Map();
    for (const gem of gems) {
      if (!allowed.has(gem.type)) continue;
      if (!allowedLevels.has(gem.affixes.length)) continue;
      const relevant = gem.affixes.filter(a => goalSet.has(a));
      if (relevant.length === 0) continue;
      const key = relevant.slice().sort().join("|");
      if (!seenKeys.has(key)) seenKeys.set(key, { gem, relevant });
    }
    const list = Array.from(seenKeys.values());
    list.push(null); // leave slot empty
    list.forEach((c, i) => { if (c) c.idx = i; else list.idxOfNull = i; });
    return list;
  });

  const n = usableSlots.length;

  // Slots that accept exactly the same gems are interchangeable, so filling
  // slot A with gem 1 and slot B with gem 2 is the same build as the reverse.
  // Tag identical slots so the search only walks one arrangement of each set
  // instead of every permutation -- without this, a loadout with several
  // matching sockets blows up factorially.
  const signatureOf = ({ slot }) =>
    slot.allowedTypes.slice().sort().join(",") + "|" + (slot.allowedLevels || [1, 2]).slice().sort().join(",");

  // order = index order to branch on, most-constrained (fewest useful candidates)
  // first, but keeping identical slots adjacent so the symmetry rule applies.
  const order = usableSlots.map((_, i) => i).sort((a, b) => {
    const d = slotCandidates[a].length - slotCandidates[b].length;
    if (d !== 0) return d;
    const sa = signatureOf(usableSlots[a]), sb = signatureOf(usableSlots[b]);
    return sa < sb ? -1 : sa > sb ? 1 : a - b;
  });
  const orderedCandidates = order.map(i => slotCandidates[i]);

  // twin[i] = position of the previous slot identical to this one, or -1.
  const twin = new Array(n).fill(-1);
  for (let i = 1; i < n; i++) {
    if (signatureOf(usableSlots[order[i]]) === signatureOf(usableSlots[order[i - 1]])) twin[i] = i - 1;
  }

  // remainingPossible[i][affix] = # of slots among order[i..n-1] that have some
  // candidate granting that affix (used as an optimistic upper bound for pruning)
  const remainingPossible = new Array(n + 1);
  remainingPossible[n] = {};
  for (let i = n - 1; i >= 0; i--) {
    const next = Object.assign({}, remainingPossible[i + 1]);
    const grantable = new Set();
    for (const c of orderedCandidates[i]) {
      if (!c) continue;
      for (const a of c.relevant) grantable.add(a);
    }
    for (const a of grantable) next[a] = (next[a] || 0) + 1;
    remainingPossible[i] = next;
  }

  const minOf = {}, maxOf = {};
  for (const g of activeGoals) {
    if (g.min != null) minOf[g.affix] = g.min;
    if (g.max != null) maxOf[g.affix] = g.max;
  }

  // Priority order == the order the goals were given in.
  const priorityAffixes = goalAffixes.slice();
  const SCORE_LEN = priorityAffixes.length + 2; // + overflow + gemsUsed

  let bestScore = null;
  let bestAssignment = null;
  let nodes = 0;
  let limited = false;
  const startTime = Date.now();

  const counts = {};
  for (const a of goalAffixes) counts[a] = baseline[a] || 0;
  const path = new Array(n).fill(null);
  const chosenIdx = new Array(n).fill(-1); // canonical candidate index per slot, for the symmetry rule
  let gemsUsed = 0;

  // Reused buffers -- this runs on every node, so avoid allocating per call.
  const scoreBuf = new Array(SCORE_LEN);
  const boundBuf = new Array(SCORE_LEN);

  // A gem grants at most 2 goal-relevant levels, so this many gems is the
  // fewest that could possibly cover what's still required. A solution that
  // meets every goal with no overflow and hits this count cannot be beaten,
  // so the search can stop the moment it finds one.
  const requiredTotal = activeGoals.reduce(
    (sum, g) => sum + Math.max(0, (g.min || 0) - (baseline[g.affix] || 0)), 0);
  const minGemsBound = Math.ceil(requiredTotal / 2);

  function isProvablyOptimal(score) {
    for (let i = 0; i < SCORE_LEN - 2; i++) if (score[i] !== 0) return false;
    return score[SCORE_LEN - 2] === 0 && score[SCORE_LEN - 1] <= minGemsBound;
  }

  function currentOverflow() {
    let overflow = 0;
    for (const a in maxOf) {
      const have = counts[a] || 0;
      if (have > maxOf[a]) overflow += have - maxOf[a];
    }
    return overflow;
  }

  // Exact score, only meaningful once every slot is decided.
  function fillScore(buf) {
    for (let i = 0; i < priorityAffixes.length; i++) {
      const a = priorityAffixes[i];
      const have = counts[a] || 0;
      const want = minOf[a];
      buf[i] = want != null && have < want ? want - have : 0;
    }
    buf[SCORE_LEN - 2] = currentOverflow();
    buf[SCORE_LEN - 1] = gemsUsed;
    return buf;
  }

  // Optimistic bound: assumes every remaining slot fills as favourably as
  // possible. Overflow and gemsUsed only ever grow, so using them as-is is
  // still a valid lower bound.
  function fillBound(buf, index) {
    const rp = remainingPossible[index];
    for (let i = 0; i < priorityAffixes.length; i++) {
      const a = priorityAffixes[i];
      const have = counts[a] || 0;
      const want = minOf[a];
      const potential = have + (rp[a] || 0);
      buf[i] = want != null && potential < want ? want - potential : 0;
    }
    buf[SCORE_LEN - 2] = currentOverflow();
    buf[SCORE_LEN - 1] = gemsUsed;
    return buf;
  }

  const priorityIndex = {};
  priorityAffixes.forEach((a, i) => { priorityIndex[a] = i; });

  // Search-order heuristic only (never affects which answer is correct): try
  // gems that serve the highest-priority unmet goal first, so a strong
  // solution turns up early and prunes harder.
  function helpfulness(candidate) {
    if (!candidate) return 0;
    let score = 0;
    for (const a of candidate.relevant) {
      const have = counts[a] || 0;
      if (minOf[a] != null && have < minOf[a]) {
        score += 1000 * (priorityAffixes.length - priorityIndex[a]);
      } else if (maxOf[a] != null && have >= maxOf[a]) {
        score -= 100;
      } else {
        score -= 1; // doesn't help an unmet target -- try leaving it empty first
      }
    }
    return score;
  }

  function dfs(index) {
    nodes++;
    if (nodes > NODE_CAP || (nodes % 2000 === 0 && Date.now() - startTime > TIME_CAP_MS)) {
      limited = true;
      return false; // signal: stop exploring further
    }
    if (index === n) {
      fillScore(scoreBuf);
      if (bestScore === null || cmpScore(scoreBuf, bestScore) < 0) {
        bestScore = scoreBuf.slice();
        bestAssignment = path.slice();
        // Nothing can beat this -- stop without flagging the search as cut short.
        if (isProvablyOptimal(bestScore)) return false;
      }
      return true;
    }
    if (bestScore !== null && cmpScore(fillBound(boundBuf, index), bestScore) >= 0) {
      return true; // prune, can't beat best
    }

    const candidates = orderedCandidates[index]
      .slice()
      .sort((a, b) => helpfulness(b) - helpfulness(a));

    // For a run of identical slots, only consider candidates at or after the
    // one the previous twin took -- every other arrangement is a permutation
    // of a build already explored.
    const floor = twin[index] === -1 ? -1 : chosenIdx[twin[index]];

    for (const cand of candidates) {
      const candIdx = cand ? cand.idx : orderedCandidates[index].idxOfNull;
      if (candIdx < floor) continue;
      if (cand) {
        for (const a of cand.relevant) counts[a] = (counts[a] || 0) + 1;
        gemsUsed++;
      }
      chosenIdx[index] = candIdx;
      path[index] = cand ? cand.gem : null;
      const keepGoing = dfs(index + 1);
      if (cand) {
        for (const a of cand.relevant) counts[a] -= 1;
        gemsUsed--;
      }
      if (!keepGoing) return false;
    }
    return true;
  }

  if (n > 0 && activeGoals.length > 0) dfs(0);

  const assignment = new Array(slots.length).fill(null);
  if (bestAssignment) {
    order.forEach((originalPos, i) => {
      const { originalIndex } = usableSlots[originalPos];
      assignment[originalIndex] = bestAssignment[i];
    });
  }

  const achieved = {};
  for (const a of goalAffixes) achieved[a] = baseline[a] || 0;
  for (const gem of assignment) {
    if (!gem) continue;
    for (const a of gem.affixes) {
      if (a in achieved) achieved[a] += 1;
    }
  }

  const goalResults = activeGoals.map(g => {
    const count = achieved[g.affix] || 0;
    let status = "met";
    if (g.min != null && count < g.min) status = "under";
    else if (g.max != null && count > g.max) status = "over";
    return { affix: g.affix, min: g.min, max: g.max, count, status };
  });

  return { assignment, achieved, goalResults, nodes, limited, hasGoals: activeGoals.length > 0, usableSlotCount: n };
}
