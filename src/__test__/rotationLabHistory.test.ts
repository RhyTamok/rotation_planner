import { describe, expect, it } from "vitest";

import { parseSteps, serializeSteps } from "../RotationLab/editor/clipboard";
import {
	COALESCE_MS,
	createHistory,
	HISTORY_LIMIT,
	record,
	redo,
	undo,
} from "../RotationLab/editor/history";
import {
	copySteps,
	moveBlock,
	neighbourAfterRemovalOf,
	rangeIds,
	removeEntries,
} from "../RotationLab/editor/rotationEdits";
import { createRotation, RotationDocument } from "../RotationLab/models/Rotation";

const actionsOf = (r: RotationDocument) =>
	r.entries.map((e) => (e.step.type === "skill" ? e.step.action : e.step.type));

describe("Rotation Lab - undo history", () => {
	it("undoes and redoes, and a new edit clears the redo stack", () => {
		let h = createHistory("a");
		h = record(h, "b", undefined, 1000);
		h = record(h, "c", undefined, 1001);
		h = undo(h);
		expect(h.present).toBe("b");
		h = undo(h);
		expect(h.present).toBe("a");
		expect(undo(h)).toBe(h);
		h = redo(h);
		expect(h.present).toBe("b");
		h = record(h, "d", undefined, 2000);
		expect(h.future).toEqual([]);
		expect(redo(h)).toBe(h);
		expect(h.past).toEqual(["a", "b"]);
	});

	it("merges quick edits from the same source into one step", () => {
		const field = {};
		let h = createHistory("");
		h = record(h, "1", field, 1000);
		h = record(h, "12", field, 1000 + COALESCE_MS - 1);
		h = record(h, "123", field, 1000 + 2 * COALESCE_MS - 2);
		expect(h.past).toEqual([""]);
		// Another source, or a pause, starts a new step.
		h = record(h, "123x", {}, 5000);
		h = record(h, "123xy", field, 5001);
		expect(h.past).toEqual(["", "123", "123x"]);
		// An undo never merges with the next edit.
		h = record(undo(h), "z", field, 5002);
		expect(h.past).toEqual(["", "123", "123x"]);
	});

	it("ignores no-op edits and keeps a bounded number of steps", () => {
		let h = createHistory(0);
		expect(record(h, 0)).toBe(h);
		for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = record(h, i, undefined, i);
		expect(h.past).toHaveLength(HISTORY_LIMIT);
		expect(h.past[0]).toBe(10);
	});
});

describe("Rotation Lab - range edits", () => {
	const base = createRotation({
		name: "R",
		job: "VPR",
		steps: ["STEEL_FANGS", "REAVING_FANGS", "SERPENTS_IRE", "VICEWINDER", "STEEL_MAW"],
	});
	const id = (i: number) => base.entries[i].id;

	it("selects ranges in either direction", () => {
		expect(rangeIds(base, id(3), id(1))).toEqual([id(1), id(2), id(3)]);
		expect(rangeIds(base, undefined, id(2))).toEqual([id(2)]);
		expect(rangeIds(base, "gone", id(2))).toEqual([id(2)]);
		expect(rangeIds(base)).toEqual([]);
	});

	it("removes, copies and moves a block", () => {
		const block = [id(1), id(2)];
		expect(actionsOf(removeEntries(base, block))).toEqual([
			"STEEL_FANGS",
			"VICEWINDER",
			"STEEL_MAW",
		]);
		expect(copySteps(base, [id(2), id(1)]).map((s) => s.type === "skill" && s.action)).toEqual([
			"REAVING_FANGS",
			"SERPENTS_IRE",
		]);
		expect(actionsOf(moveBlock(base, block, 1))).toEqual([
			"STEEL_FANGS",
			"VICEWINDER",
			"REAVING_FANGS",
			"SERPENTS_IRE",
			"STEEL_MAW",
		]);
		expect(actionsOf(moveBlock(base, block, -1))[0]).toBe("REAVING_FANGS");
		// At an end, or with a gap in the selection, nothing moves.
		expect(moveBlock(base, [id(0)], -1)).toBe(base);
		expect(moveBlock(base, [id(1), id(3)], 1)).toBe(base);
	});

	it("keeps the selection next to a removed block", () => {
		expect(neighbourAfterRemovalOf(base, [id(1), id(2)])).toBe(id(3));
		expect(neighbourAfterRemovalOf(base, [id(3), id(4)])).toBe(id(2));
		expect(
			neighbourAfterRemovalOf(
				base,
				base.entries.map((e) => e.id),
			),
		).toBeUndefined();
	});
});

describe("Rotation Lab - step clipboard", () => {
	it("round-trips steps and refuses anything else", () => {
		const steps = [
			{ type: "skill" as const, action: "STEEL_FANGS" as const, delay: 0.3 },
			{ type: "wait" as const, seconds: 1 },
		];
		const text = serializeSteps("VPR", steps);
		expect(parseSteps(text, "VPR")).toEqual(steps);
		expect(parseSteps(text, "DRG")).toBeUndefined();
		expect(parseSteps("Steel Fangs", "VPR")).toBeUndefined();
		expect(
			parseSteps(serializeSteps("VPR", [{ type: "skill", action: "FIRE" as never }]), "VPR"),
		).toBeUndefined();
		expect(parseSteps(serializeSteps("VPR", []), "VPR")).toBeUndefined();
	});
});
