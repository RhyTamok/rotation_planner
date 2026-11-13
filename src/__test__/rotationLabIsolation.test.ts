import { describe, expect, it } from "vitest";
import { GameConfig, DEFAULT_CONFIG } from "../Game/GameConfig";
import { getGameState } from "../Game/Jobs";
import { skillNode } from "../Controller/Record";

function createViperState() {
	const config = new GameConfig({
		...DEFAULT_CONFIG,
		job: "VPR",
	});

	return getGameState(config);
}

describe("Rotation Lab - Viper State Isolation", () => {
	it("creates independent GameState instances", () => {
		const a = createViperState();
		const b = createViperState();

		expect(a).not.toBe(b);
		expect(a.resources).not.toBe(b.resources);
		expect(a.cooldowns).not.toBe(b.cooldowns);
		expect(a.debuffs).not.toBe(b.debuffs);
	});

	it("keeps simulation time separate", () => {
		const a = createViperState();
		const b = createViperState();

		expect(a.time).toBe(0);
		expect(b.time).toBe(0);

		a.time = 5;

		expect(a.time).toBe(5);
		expect(b.time).toBe(0);
	});

	it("executes Steel Fangs without changing the other state", () => {
		const a = createViperState();
		const b = createViperState();

		const skill = "STEEL_FANGS";

		// Both independent simulations start with the skill ready.
		expect(a.getSkillAvailabilityStatus(skill).status.ready()).toBe(true);
		expect(b.getSkillAvailabilityStatus(skill).status.ready()).toBe(true);

		// Record initial cooldown availability.
		const initialACooldown = a.cooldowns.get("cd_GCD").stacksAvailable();

		const initialBCooldown = b.cooldowns.get("cd_GCD").stacksAvailable();

		// Create a proper ActionNode for the skill.
		const node = skillNode(skill);
		node.tmp_startLockTime = a.time;

		// Execute only in simulation A.
		a.useSkill(skill, node, 0);

		// A must have consumed its available GCD.
		expect(a.cooldowns.get("cd_GCD").stacksAvailable()).toBeLessThan(initialACooldown);

		// B must remain unchanged.
		expect(b.cooldowns.get("cd_GCD").stacksAvailable()).toBe(initialBCooldown);

		expect(b.time).toBe(0);
		expect(b.getSkillAvailabilityStatus(skill).status.ready()).toBe(true);
	});
	it("advances time independently using the event system", () => {
		const a = createViperState();
		const b = createViperState();

		const skill = "STEEL_FANGS";

		const node = skillNode(skill);
		node.tmp_startLockTime = a.time;

		a.useSkill(skill, node, 0);

		// Advance simulation A by one second.
		a.tick(1);

		expect(a.time).toBeCloseTo(1, 5);
		expect(b.time).toBe(0);

		// Simulation B must still have its initial GCD.
		expect(b.getSkillAvailabilityStatus(skill).status.ready()).toBe(true);
	});
});
