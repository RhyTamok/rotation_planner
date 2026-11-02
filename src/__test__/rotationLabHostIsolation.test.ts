import { describe, expect, it } from "vitest";

import { rotationTestSetup, rotationTestTeardown } from "./utils";
import { controller } from "../Controller/Controller";
import { skillNode } from "../Controller/Record";
import { DEFAULT_CONFIG, GameConfig } from "../Game/GameConfig";
import { getGameState } from "../Game/Jobs";
import { GameState } from "../Game/GameState";
import { Potency } from "../Game/Potency";

beforeEach(rotationTestSetup);
afterEach(rotationTestTeardown);

function countGlobalTimelineElements(): number {
	return (
		controller.timeline.sharedElements.length +
		controller.timeline.slots.reduce((sum, slot) => sum + slot.elements.length, 0)
	);
}

// Minimal host that resolves potencies against the game that owns it.
// Kept inline so this test does not depend on the Rotation Lab simulator.
function makeStubHost() {
	const host = {
		game: undefined as GameState | undefined,
		resolved: [] as Potency[],
		warnings: 0,
		resolvePotency(p: Potency) {
			p.resolve(host.game!.getDisplayTime());
			host.resolved.push(p);
		},
		resolveHealingPotency(p: Potency) {
			p.resolve(host.game!.getDisplayTime());
		},
		resolveOverTimePotency(p: Potency) {
			p.resolve(host.game!.getDisplayTime());
			host.resolved.push(p);
		},
		reportWarning() {
			host.warnings++;
		},
		reportInterruption() {},
		reportManaTick() {},
		reportLucidTick() {},
		reportAutoTick() {},
		reportDotTick() {},
		reportHotTick() {},
		reportOverTimeStart() {},
		reportOverTimeDrop() {},
		timeline: {
			duringUntargetable: () => false,
			nextTargetableAfter: (t: number) => t,
			getBuffMarkers: () => [],
		},
	};
	return host;
}

describe("Rotation Lab - simulation host isolation", () => {
	it("resolves damage through its own host, not the global controller", () => {
		const host = makeStubHost();
		const game = getGameState(new GameConfig({ ...DEFAULT_CONFIG, job: "VPR" }), host);
		host.game = game;

		const globalElementsBefore = countGlobalTimelineElements();
		const globalTimeBefore = controller.game.time;

		const node = skillNode("STEEL_FANGS");
		node.tmp_startLockTime = game.time;
		game.useSkill("STEEL_FANGS", node, 0);
		game.tick(3);

		const potency = node.getInitialPotency();
		expect(potency).toBeDefined();
		// Damage landed, and it was stamped with this game's clock.
		expect(host.resolved).toContain(potency);
		expect(potency!.applicationTime).toBeGreaterThanOrEqual(potency!.sourceTime);
		expect(potency!.applicationTime).toBeLessThanOrEqual(game.getDisplayTime());

		// The global controller was not touched.
		expect(countGlobalTimelineElements()).toBe(globalElementsBefore);
		expect(controller.game.time).toBe(globalTimeBefore);
	});
});
