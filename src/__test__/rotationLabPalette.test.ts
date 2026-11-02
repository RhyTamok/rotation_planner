import { describe, expect, it } from "vitest";

import { ActionKey } from "../Game/Data";
import { hotbarStateAfter } from "../RotationLab/editor/paletteState";
import { RotationStep, SimulationOptions } from "../RotationLab/simulation/types";

const OPTIONS: SimulationOptions = { encounterRules: true, config: { fps: 0 } };
const BUTTONS: ActionKey[] = [
	"STEEL_FANGS",
	"REAVING_FANGS",
	"SERPENTS_IRE",
	"VICEWINDER",
	"REAWAKEN",
];

const skills = (...actions: ActionKey[]): RotationStep[] =>
	actions.map((action) => ({ type: "skill", action }));

describe("Rotation Lab - palette state at the insertion point", () => {
	it("shows the base buttons before anything is pressed", () => {
		const hotbar = hotbarStateAfter("VPR", [], BUTTONS, OPTIONS);
		expect(hotbar.time).toBeCloseTo(-5, 6);
		expect(hotbar.buttons.get("REAVING_FANGS")!.shows).toBe("REAVING_FANGS");
		expect(hotbar.buttons.get("SERPENTS_IRE")!.cooldown).toBeUndefined();
	});

	it("shows combo follow-ups on the buttons that execute them", () => {
		const hotbar = hotbarStateAfter("VPR", skills("REAVING_FANGS"), BUTTONS, OPTIONS);
		expect(hotbar.buttons.get("REAVING_FANGS")!.shows).toBe("SWIFTSKINS_STING");
		expect(hotbar.buttons.get("STEEL_FANGS")!.shows).toBe("HUNTERS_STING");
	});

	it("shows the remaining cooldown of oGCDs, but not the normal GCD roll", () => {
		const hotbar = hotbarStateAfter(
			"VPR",
			skills("REAVING_FANGS", "SERPENTS_IRE"),
			BUTTONS,
			OPTIONS,
		);
		const ire = hotbar.buttons.get("SERPENTS_IRE")!;
		// Serpent's Ire waits for the pull at 0 s and has a 120 s recast.
		expect(ire.cooldown).toBeCloseTo(120 - hotbar.time, 6);
		expect(hotbar.buttons.get("STEEL_FANGS")!.cooldown).toBeUndefined();
	});

	it("tracks charges and whether requirements are met", () => {
		const before = hotbarStateAfter("VPR", skills("REAVING_FANGS"), BUTTONS, OPTIONS);
		expect(before.buttons.get("VICEWINDER")!.charges).toEqual({ available: 2, max: 2 });
		expect(before.buttons.get("REAWAKEN")!.usable).toBe(false);

		const after = hotbarStateAfter(
			"VPR",
			skills("REAVING_FANGS", "SERPENTS_IRE", "VICEWINDER"),
			BUTTONS,
			OPTIONS,
		);
		expect(after.buttons.get("VICEWINDER")!.charges!.available).toBe(1);
		// Serpent's Ire grants Ready to Reawaken.
		expect(after.buttons.get("REAWAKEN")!.usable).toBe(true);
	});

	it("runs on the full rotation's clock when the countdown was extended", () => {
		const steps: RotationStep[] = [{ type: "wait", seconds: 2 }];
		const hotbar = hotbarStateAfter("VPR", steps, BUTTONS, OPTIONS, 3);
		expect(hotbar.time).toBeCloseTo(-5 - 3 + 2, 6);
	});
});
