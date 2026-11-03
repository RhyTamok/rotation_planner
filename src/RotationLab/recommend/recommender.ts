import { ShellJob } from "../../Game/Data/Jobs";
import { simulatePrefix } from "../editor/paletteState";
import { needsTarget } from "../rules/encounterRules";
import { RotationStep, SimulationOptions } from "../simulation/types";
import { arrange, Candidate, Recommendation, RecommenderContext } from "./context";
import { recommendViper } from "./vpr";

export type { Recommendation } from "./context";

// One ruleset per job, each documented in docs/rulesets/<job>-recommendations.md.
const RECOMMENDERS: Partial<Record<ShellJob, (ctx: RecommenderContext) => Candidate[]>> = {
	VPR: recommendViper,
};

export function isRecommendationSupported(job: ShellJob): boolean {
	return RECOMMENDERS[job] !== undefined;
}

export interface Recommendations {
	// Display time at which the next action would be pressed.
	time: number;
	// Best first.
	ranked: Recommendation[];
	// Excluded by the encounter rules (e.g. "needs a target" in downtime), kept for debugging.
	filtered: Recommendation[];
}

// Recommends the next actions after `steps` (the rotation up to the insertion point). As for the
// palette, `countdownExtension` comes from the full rotation's result so both run on one clock.
export function recommendAfter(
	job: ShellJob,
	steps: RotationStep[],
	options: SimulationOptions,
	targetCount: number,
	countdownExtension = 0,
): Recommendations | undefined {
	const recommender = RECOMMENDERS[job];
	if (!recommender) return undefined;
	const simulator = simulatePrefix(job, steps, options, countdownExtension);
	const ctx = new RecommenderContext(
		job,
		simulator.game,
		simulator.result("prefix").actions,
		targetCount,
	);
	const time = simulator.displayTime;
	const ranked: Recommendation[] = [];
	const filtered: Recommendation[] = [];
	for (const rec of arrange(recommender(ctx), ctx.freeSlots)) {
		const at = ctx.isGcd(rec.shows) ? time + ctx.gcdIn : time;
		if (
			options.encounterRules &&
			simulator.host.timeline.duringUntargetable(at) &&
			needsTarget(simulator.game, rec.shows)
		) {
			filtered.push({ ...rec, reason: `${rec.reason}; needs a target` });
		} else {
			ranked.push(rec);
		}
	}
	return { time, ranked, filtered };
}
