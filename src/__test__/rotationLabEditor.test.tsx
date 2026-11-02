import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
	buildRows,
	duplicateEntry,
	insertSteps,
	moveEntry,
	moveEntryBefore,
	neighbourAfterRemoval,
	removeEntry,
	updateStep,
} from "../RotationLab/editor/rotationEdits";
import { createRotation, RotationDocument } from "../RotationLab/models/Rotation";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { KeyValueStorage, WORKSPACE_KEY } from "../RotationLab/storage/WorkspaceStore";
import { RotationLabApp } from "../RotationLab/ui/RotationLabApp";
import { formatNumber } from "../RotationLab/ui/RotationTable";

const actionsOf = (r: RotationDocument) =>
	r.entries.map((e) => (e.step.type === "skill" ? e.step.action : e.step.type));

describe("Rotation Lab - editing operations", () => {
	const base = createRotation({
		name: "Edit",
		job: "VPR",
		steps: ["STEEL_FANGS", "REAVING_FANGS", "SERPENTS_IRE"],
	});
	const [a, b, c] = base.entries.map((e) => e.id);

	it("inserts after the given entry, or at the end", () => {
		const middle = insertSteps(base, [{ type: "skill", action: "VICEWINDER" }], a);
		expect(actionsOf(middle.rotation)).toEqual([
			"STEEL_FANGS",
			"VICEWINDER",
			"REAVING_FANGS",
			"SERPENTS_IRE",
		]);
		expect(middle.rotation.entries[1].id).toBe(middle.insertedIds[0]);

		const end = insertSteps(base, [{ type: "wait", seconds: 1 }]);
		expect(actionsOf(end.rotation)).toEqual([
			"STEEL_FANGS",
			"REAVING_FANGS",
			"SERPENTS_IRE",
			"wait",
		]);
		// The original document is untouched.
		expect(actionsOf(base)).toEqual(["STEEL_FANGS", "REAVING_FANGS", "SERPENTS_IRE"]);
	});

	it("removes, moves, duplicates and updates entries", () => {
		expect(actionsOf(removeEntry(base, b))).toEqual(["STEEL_FANGS", "SERPENTS_IRE"]);
		expect(actionsOf(moveEntry(base, c, -1))).toEqual([
			"STEEL_FANGS",
			"SERPENTS_IRE",
			"REAVING_FANGS",
		]);
		expect(moveEntry(base, a, -1)).toBe(base);
		expect(moveEntry(base, c, 1)).toBe(base);

		const dup = duplicateEntry(base, a);
		expect(actionsOf(dup.rotation)).toEqual([
			"STEEL_FANGS",
			"STEEL_FANGS",
			"REAVING_FANGS",
			"SERPENTS_IRE",
		]);
		expect(dup.insertedIds[0]).not.toBe(a);

		const updated = updateStep(base, b, { type: "wait", seconds: 2 });
		expect(updated.entries[1]).toEqual({ id: b, step: { type: "wait", seconds: 2 } });
	});

	it("moves an entry to a drop position between rows", () => {
		expect(actionsOf(moveEntryBefore(base, a, 3))).toEqual([
			"REAVING_FANGS",
			"SERPENTS_IRE",
			"STEEL_FANGS",
		]);
		expect(actionsOf(moveEntryBefore(base, c, 0))).toEqual([
			"SERPENTS_IRE",
			"STEEL_FANGS",
			"REAVING_FANGS",
		]);
		expect(actionsOf(moveEntryBefore(base, a, 2))).toEqual([
			"REAVING_FANGS",
			"STEEL_FANGS",
			"SERPENTS_IRE",
		]);
		// Dropping onto its own position is a no-op.
		expect(moveEntryBefore(base, b, 1)).toBe(base);
		expect(moveEntryBefore(base, b, 2)).toBe(base);
	});

	it("keeps the selection next to a removed entry", () => {
		expect(neighbourAfterRemoval(base, b)).toBe(c);
		expect(neighbourAfterRemoval(base, c)).toBe(b);
	});

	it("joins entries with simulated actions and step errors", () => {
		const rotation = createRotation({
			name: "Rows",
			job: "VPR",
			steps: [
				"STEEL_FANGS",
				{ type: "wait", seconds: 1 },
				{ type: "jumpTo", displayTime: -20 },
			],
		});
		const result = simulateRotation({
			id: rotation.id,
			steps: rotation.entries.map((e) => e.step),
		});
		const rows = buildRows(rotation, result);

		expect(rows[0].action?.executedAction).toBe("STEEL_FANGS");
		expect(rows[1].action).toBeUndefined();
		expect(rows[2].error?.stepIndex).toBe(2);
	});
});

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
	};
}

describe("Rotation Lab - editor page", () => {
	// jsdom does not implement scrollIntoView, which the table uses to keep the selection visible.
	beforeEach(() => {
		Element.prototype.scrollIntoView = vi.fn();
	});

	it("builds a rotation from the palette and shows simulated results", async () => {
		const user = userEvent.setup();
		const storage = memoryStorage();
		render(<RotationLabApp storage={storage} />);

		const palette = screen.getByRole("complementary", { name: "Skill palette" });
		const steelFangs = within(palette).getByRole("button", { name: /Steel Fangs/ });
		await user.click(steelFangs);
		await user.click(steelFangs);
		await user.click(steelFangs);

		const rows = screen.getAllByTestId("rotation-row");
		expect(rows).toHaveLength(3);
		// Repeated presses of the Steel Fangs button execute the combo.
		expect(rows[1].textContent).toContain("Hunter's Sting");
		expect(rows[2].textContent).toContain("pressed Steel Fangs");

		const summary = screen.getByRole("region", { name: "Summary" });
		expect(summary.textContent).toContain("Valid");
		expect(summary.textContent).toMatch(/Expected damage[\d,]+/);

		// The workspace is saved and contains the three steps.
		const saved = JSON.parse(storage.data.get(WORKSPACE_KEY)!);
		expect(saved.rotations[0].entries).toHaveLength(3);
	});

	it("edits with the keyboard and flags invalid steps", async () => {
		const user = userEvent.setup();
		render(<RotationLabApp storage={memoryStorage()} />);
		const palette = screen.getByRole("complementary", { name: "Skill palette" });

		// Reawaken needs Serpent Offerings, so it is invalid at the start of a fight.
		await user.click(within(palette).getByRole("button", { name: /Reawaken/ }));
		await user.click(within(palette).getByRole("button", { name: /Steel Fangs/ }));
		let rows = screen.getAllByTestId("rotation-row");
		expect(rows[0].className).toContain("rl-invalid");
		expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain(
			"Has invalid steps",
		);

		// Select Reawaken, move it below Steel Fangs, then delete it.
		await user.click(rows[0]);
		await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
		rows = screen.getAllByTestId("rotation-row");
		expect(rows[1].textContent).toContain("Reawaken");
		await user.keyboard("{Delete}");
		rows = screen.getAllByTestId("rotation-row");
		expect(rows).toHaveLength(1);
		expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain("Valid");
	});

	it("does not save a scenario that would fail to load", async () => {
		const user = userEvent.setup();
		const storage = memoryStorage();
		render(<RotationLabApp storage={storage} />);

		await user.click(screen.getByRole("button", { name: "Add downtime" }));
		const savedBefore = storage.data.get(WORKSPACE_KEY);
		// End before start: invalid.
		const end = screen.getByLabelText("Downtime end");
		await user.clear(end);
		await user.type(end, "10");

		expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain(
			"Changes not saved",
		);
		expect(storage.data.get(WORKSPACE_KEY)).toBe(savedBefore);
	});

	it("compares two rotations at cutoffs", async () => {
		const user = userEvent.setup();
		render(<RotationLabApp storage={memoryStorage()} />);
		const palette = screen.getByRole("complementary", { name: "Skill palette" });
		const reaving = within(palette).getByRole("button", { name: /Reaving Fangs/ });
		await user.click(reaving);
		await user.click(reaving);
		await user.click(screen.getByRole("button", { name: "Duplicate" }));
		// Add a third GCD to the copy only, so it ends up ahead. (The button now shows the combo
		// finisher, so it is clicked by reference rather than looked up by name again.)
		await user.click(reaving);

		await user.click(screen.getByRole("button", { name: "Compare" }));
		// The copy is the current rotation, so it is A by default and the original is B.
		const comparison = screen.getByRole("region", { name: "Comparison" });
		expect(within(comparison).getAllByTestId("cutoff-row")).toHaveLength(1);
		expect(comparison.textContent).toMatch(/A: .*\(copy\) pulls ahead/);
		expect(comparison.textContent).not.toContain("overtakes");

		await user.type(
			within(comparison).getByRole("spinbutton", { name: "Cutoff seconds" }),
			"1",
		);
		await user.click(within(comparison).getByRole("button", { name: "Add cutoff" }));
		expect(within(comparison).getAllByTestId("cutoff-row")).toHaveLength(2);
	});

	it("removes a row with its × button and shows debug timing columns", async () => {
		const user = userEvent.setup();
		render(<RotationLabApp storage={memoryStorage()} />);
		const palette = screen.getByRole("complementary", { name: "Skill palette" });
		const steelFangs = within(palette).getByRole("button", { name: /Steel Fangs/ });
		await user.click(steelFangs);
		await user.click(within(palette).getByRole("button", { name: /Serpent's Ire/ }));
		await user.click(steelFangs);
		expect(screen.getAllByTestId("rotation-row")).toHaveLength(3);

		await user.click(screen.getByRole("checkbox", { name: "Debug" }));
		const gcdDeltas = screen.getAllByTestId("delta-gcd").map((c) => c.textContent);
		const actionDeltas = screen.getAllByTestId("delta-action").map((c) => c.textContent);
		// Default scenario: no frame-rate tax, so a 2.5 s GCD shows exactly 2.500.
		expect(gcdDeltas).toEqual(["", "", formatNumber(2.5, 3)]);
		expect(actionDeltas[0]).toBe("");
		expect(actionDeltas[1]).not.toBe("");

		const removeButtons = screen.getAllByRole("button", { name: "Remove step" });
		await user.click(removeButtons[1]);
		const rows = screen.getAllByTestId("rotation-row");
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.textContent).join()).not.toContain("Serpent's Ire");
	});
});
