import { describe, expect, it } from "vitest";

import { createScenario, scenarioToOptions } from "../RotationLab/models/Scenario";
import { recommendAfter } from "../RotationLab/recommend/recommender";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationStep, SimulationOptions, TimeZero } from "../RotationLab/simulation/types";

// Self-play (roadmap 1.7): build a rotation by always taking the top recommendation, the way a
// user could by clicking the first entry of the panel over and over. The recommender is advice
// for a rotation built by hand, so this is a regression guard, not a measure of how good the
// result is: the rotation must simulate without an invalid action and without wasting gauge.
// It deliberately pins no damage total; the golden rotations do that.

// Long enough for the opener, the filler phase and the two-minute burst after it.
const FIGHT_SECONDS = 150;
const MAX_STEPS = 400;

function selfPlay(options: SimulationOptions) {
	const steps: RotationStep[] = [];
	const simulate = () => simulateRotation({ id: "self-play", steps }, options, "VPR");
	let result = simulate();
	while (result.endTime < FIGHT_SECONDS && steps.length < MAX_STEPS) {
		const next = recommendAfter("VPR", steps, options, result.countdownExtension)?.ranked[0];
		if (next === undefined) break;
		steps.push({ type: "skill", action: next.action });
		result = simulate();
	}
	return { steps, result };
}

describe("Rotation Lab - following the top recommendation", () => {
	const modes: TimeZero[] = ["firstHit", "firstPress"];
	it.each(modes)("builds a valid rotation that wastes no gauge (time zero: %s)", (timeZero) => {
		// The editor's own defaults: a new scenario, default gear, no downtime or extra targets.
		const options = scenarioToOptions(createScenario({ end: "lastAction", timeZero }));
		const { steps, result } = selfPlay(options);

		// It never ran out of suggestions and filled the whole fight.
		expect(result.endTime).toBeGreaterThanOrEqual(FIGHT_SECONDS);
		expect(steps.length).toBeLessThan(MAX_STEPS);

		expect(result.errors).toEqual([]);
		expect(
			result.actions.filter((a) => !a.valid).map((a) => [a.stepIndex, a.invalidReasons]),
		).toEqual([]);
		// Overcapping Rattling Coils or Serpent Offerings, a wrong combo ender, and so on.
		expect(result.warnings).toEqual([]);
		expect(result.actions.flatMap((a) => a.comboBreaks ?? [])).toEqual([]);

		// The basics of any Viper rotation happened.
		const used = new Set(result.actions.map((a) => a.executedAction));
		for (const action of ["SERPENTS_IRE", "REAWAKEN", "OUROBOROS", "VICEWINDER"]) {
			expect(used, action).toContain(action);
		}
		expect(result.actions.filter((a) => a.executedAction === "SERPENTS_IRE").length).toBe(2);
	});

	// Roadmap 1.7, second half: pinned totals for an opener and a two-minute loop.
	it.todo("golden rotations (waiting for the user's opener and two-minute loop)");
});
