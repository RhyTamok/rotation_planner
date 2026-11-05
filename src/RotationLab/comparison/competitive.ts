import { rankOf, TIE_TOLERANCE } from "./baseline";
import { CumulativeSeries, dpsAt, TIME_TOLERANCE, totalAt } from "./compare";

// Competitiveness and regret over a time interval (design spec 3, 3.1, 3.2; roadmap M3a). Pure maths
// over `compare.ts`: no simulation runs here, and no baseline is involved. Everything is measured
// against the best configuration at each instant.
//
// Between consecutive landing times every total D_i is constant, so the leader set, the competitive
// set and the percentage regret are constant too, and the results below are exact, with no sampling.
//
// Units: every result is a fraction (0.001 = 0.1%), like `deltaPct` in `baseline.ts`. The only value
// in percentage points is the `epsilonPct` argument, converted once, in `epsilonFraction`.

// A stretch of constant totals. Its state is the one at `start`, and DPS falls as 1/t until `end`.
// `start` is included and `end` is not, except for the last piece, a zero-length one at T2: a hit
// landing exactly at T2 counts at T2, as in the cutoff table, but has no duration to weigh.
export interface CompetitivePiece {
	start: number;
	end: number;
	totals: Record<string, number>;
	// (best total - own total) / best total. Undefined while every total is 0 (percentage regret
	// N/A; DPS regret is 0 and all entries tie as leaders).
	regretFraction: Record<string, number | undefined>;
	// Rank 1 with the cutoff table's tie tolerance. Several can lead at once.
	leaders: string[];
	// Leaders, plus any entry whose regret is within ε. Several can be competitive at once.
	competitive: string[];
}

export interface EntryCompetitiveness {
	id: string;
	// Shares of the interval's elapsed time, not probabilities of a kill time. They are not exclusive
	// between entries, because of ties and because several entries can be within ε.
	leaderCoverage: number;
	competitiveCoverage: number;
	competitiveNotLeaderCoverage: number;
	// Largest bestDPS - DPS over the closed interval, and the earliest instant it occurs.
	maxRegretDps: number;
	maxRegretDpsAt: number;
	// Largest percentage regret; undefined when every total is 0 throughout.
	maxRegretFraction?: number;
	// Mean of bestDPS - DPS over elapsed time, in DPS.
	meanRegretDps: number;
}

// An entry joining or leaving the competitive set after T1. The set at T1 is `pieces[0].competitive`.
export interface CompetitiveTransition {
	// The landing instant. It is T2 itself for a hit within the time tolerance of T2.
	time: number;
	id: string;
	kind: "enter" | "exit";
	// Every entry whose total rose at this instant, whether or not it is the one that moved: an
	// entry usually drops out because another entry's hit landed.
	landings: { id: string; amount: number }[];
}

export interface IntervalAnalysis {
	T1: number;
	T2: number;
	epsilonPct: number;
	// In the order given.
	entries: EntryCompetitiveness[];
	pieces: CompetitivePiece[];
	transitions: CompetitiveTransition[];
}

function epsilonFraction(epsilonPct: number): number {
	return epsilonPct / 100;
}

function assertValid(
	series: Record<string, CumulativeSeries>,
	ids: string[],
	T1: number,
	T2: number,
	epsilonPct: number,
) {
	if (ids.length === 0) throw new Error("At least one configuration is required.");
	if (new Set(ids).size !== ids.length) throw new Error("Configuration ids must be unique.");
	for (const id of ids) {
		if (!series[id]) throw new Error(`No series for configuration "${id}".`);
	}
	if (!(T1 > 0 && T2 > T1 && Number.isFinite(T2))) {
		throw new Error(`The interval must satisfy 0 < T1 < T2; got [${T1}, ${T2}].`);
	}
	if (!(epsilonPct >= 0 && Number.isFinite(epsilonPct))) {
		throw new Error(`epsilonPct must be 0 or more; got ${epsilonPct}.`);
	}
}

// T1, then each landing instant strictly inside the interval. Times within TIME_TOLERANCE are one
// instant: `totalAt` at the first already includes the others, so float noise makes no extra piece.
// Landings that close to T1 or T2 belong to those endpoints, again as `totalAt` counts them.
function pieceStarts(
	series: Record<string, CumulativeSeries>,
	ids: string[],
	T1: number,
	T2: number,
): number[] {
	const times = ids.flatMap((id) => series[id].times).sort((a, b) => a - b);
	const starts = [T1];
	for (const t of times) {
		if (t > starts[starts.length - 1] + TIME_TOLERANCE && t < T2 - TIME_TOLERANCE) {
			starts.push(t);
		}
	}
	return starts;
}

function pieceAt(
	series: Record<string, CumulativeSeries>,
	ids: string[],
	start: number,
	end: number,
	epsilon: number,
): CompetitivePiece {
	const totals: Record<string, number> = {};
	const regretFraction: Record<string, number | undefined> = {};
	const best = Math.max(...ids.map((id) => totalAt(series[id], start)));
	const dps = ids.map((id) => dpsAt(series[id], start)!);
	const leaders: string[] = [];
	const competitive: string[] = [];
	ids.forEach((id, i) => {
		const total = totalAt(series[id], start);
		// Time cancels, so this holds for the whole piece.
		const regret = best > 0 ? (best - total) / best : undefined;
		totals[id] = total;
		regretFraction[id] = regret;
		const leader = rankOf(dps[i], dps) === 1;
		if (leader) leaders.push(id);
		// A gap of exactly ε is competitive: the slack keeps float noise from deciding that case.
		if (leader || (regret !== undefined && regret <= epsilon + TIE_TOLERANCE)) {
			competitive.push(id);
		}
	});
	return { start, end, totals, regretFraction, leaders, competitive };
}

function entryMetrics(
	id: string,
	pieces: CompetitivePiece[],
	T1: number,
	T2: number,
): EntryCompetitiveness {
	const duration = T2 - T1;
	let leaderTime = 0;
	let competitiveTime = 0;
	let competitiveNotLeaderTime = 0;
	let regretIntegral = 0;
	let maxRegretDps = -Infinity;
	let maxRegretDpsAt = T1;
	let maxRegretFraction: number | undefined;
	for (const piece of pieces) {
		const elapsed = piece.end - piece.start;
		const leader = piece.leaders.includes(id);
		const competitive = piece.competitive.includes(id);
		if (leader) leaderTime += elapsed;
		if (competitive) competitiveTime += elapsed;
		if (competitive && !leader) competitiveNotLeaderTime += elapsed;

		const gap = Math.max(...Object.values(piece.totals)) - piece.totals[id];
		// The integral of gap / t over the piece is gap * ln(end / start); log1p keeps very short
		// pieces accurate.
		regretIntegral += gap * Math.log1p(elapsed / piece.start);
		// gap / t falls within a piece, so its largest value is at the left end.
		const regretDps = gap / piece.start;
		if (regretDps > maxRegretDps) {
			maxRegretDps = regretDps;
			maxRegretDpsAt = piece.start;
		}
		const regret = piece.regretFraction[id];
		if (
			regret !== undefined &&
			(maxRegretFraction === undefined || regret > maxRegretFraction)
		) {
			maxRegretFraction = regret;
		}
	}
	return {
		id,
		leaderCoverage: Math.min(1, leaderTime / duration),
		competitiveCoverage: Math.min(1, competitiveTime / duration),
		competitiveNotLeaderCoverage: Math.min(1, competitiveNotLeaderTime / duration),
		maxRegretDps,
		maxRegretDpsAt,
		maxRegretFraction,
		meanRegretDps: regretIntegral / duration,
	};
}

function competitiveTransitions(
	pieces: CompetitivePiece[],
	ids: string[],
): CompetitiveTransition[] {
	const transitions: CompetitiveTransition[] = [];
	for (let i = 1; i < pieces.length; i++) {
		const before = pieces[i - 1];
		const after = pieces[i];
		const moved = ids.filter(
			(id) => before.competitive.includes(id) !== after.competitive.includes(id),
		);
		if (moved.length === 0) continue;
		const landings = ids
			.filter((id) => after.totals[id] !== before.totals[id])
			.map((id) => ({ id, amount: after.totals[id] - before.totals[id] }));
		for (const id of moved) {
			const kind = after.competitive.includes(id) ? "enter" : "exit";
			transitions.push({ time: after.start, id, kind, landings });
		}
	}
	return transitions;
}

// Exact leader and competitive coverage, regret and competitive-set changes over [T1, T2], with
// 0 < T1 < T2. `epsilonPct` is in percentage points (0.10 = 0.10%). It decides only which entries are
// competitive: the totals, leaders and regret do not depend on it.
export function intervalAnalysis(
	series: Record<string, CumulativeSeries>,
	ids: string[],
	T1: number,
	T2: number,
	epsilonPct: number,
): IntervalAnalysis {
	assertValid(series, ids, T1, T2, epsilonPct);
	const epsilon = epsilonFraction(epsilonPct);
	const starts = pieceStarts(series, ids, T1, T2);
	const pieces = starts.map((start, i) =>
		pieceAt(series, ids, start, starts[i + 1] ?? T2, epsilon),
	);
	pieces.push(pieceAt(series, ids, T2, T2, epsilon));
	return {
		T1,
		T2,
		epsilonPct,
		entries: ids.map((id) => entryMetrics(id, pieces, T1, T2)),
		pieces,
		transitions: competitiveTransitions(pieces, ids),
	};
}
