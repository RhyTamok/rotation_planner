import { describe, expect, it } from "vitest";

import { MAX_LIST_STEPS, parseRotationList } from "../RotationLab/import/rotationList";
import { createRotation } from "../RotationLab/models/Rotation";
import { createScenario } from "../RotationLab/models/Scenario";
import { simulateDocument } from "../RotationLab/simulation/SimulationManager";

function steps(text: string) {
	const parsed = parseRotationList(text, "VPR");
	if (!parsed.ok) throw new Error(parsed.errors.join(" "));
	return parsed.steps.map((s) => (s.type === "skill" ? s.action : s.type));
}
function errors(text: string) {
	const parsed = parseRotationList(text, "VPR");
	return parsed.ok ? [] : parsed.errors;
}

// The opening of the user's exported file, with its comments and columns (vpr.csv, 2026-11-06).
const EXPORT = `#stats = {"job_class": "VPR", "wd": 158, "version": "7.4", "level":100}
#use_strict_skill_naming = False
#enable_autos = True
Time,skill_name,job_class,skill_conditional,targets
0,Reaving Fangs,,,"Boss 1"
0.625,Serpent's Ire,,,
2.48,Swiftskin's Sting,,,"Boss 1"
4.96,Vicewinder,,,"Boss 1"
7.49,Hunter's Coil,,,"Boss 1"
8.115,Twinfang Bite,,,"Boss 1"
8.74,Twinblood Bite,,,"Boss 1"
10.02,Swiftskin's Coil,,,"Boss 1"
10.645,Twinblood Bite,,,"Boss 1"
11.27,Twinfang Bite,,,"Boss 1"
12.55,Reawaken,,,"Boss 1, Boss 2"
14.4,First Generation,,,"Boss 1, Boss 2"
15.025,First Legacy,,,"Boss 1, Boss 2"
16.08,Second Generation,,,"Boss 1, Boss 2"
16.705,Second Legacy,,,"Boss 1, Boss 2"
17.76,Third Generation,,,"Boss 1, Boss 2"
18.385,Third Legacy,,,"Boss 1, Boss 2"
19.44,Fourth Generation,,,"Boss 1, Boss 2"
20.065,Fourth Legacy,,,"Boss 1, Boss 2"
21.12,Ouroboros,,,"Boss 1, Boss 2"
23.65,Hindsting Strike,,,"Boss 1"
24.275,Death Rattle,,,"Boss 1"
25.75,Uncoiled Fury,,,"Boss 1, Boss 2"
26.375,Uncoiled Twinfang,,,"Boss 1, Boss 2"
27,Uncoiled Twinblood,,,"Boss 1, Boss 2"
42.19,Steel Fangs,,,"Boss 1"
44.29,Hunter's Sting,,,"Boss 1"
46.39,Flanksbane Fang,,,"Boss 1"
47.015,Death Rattle,,,"Boss 1"
`;

describe("Rotation Lab - rotation list import", () => {
	it("reads one displayed name per line, in order", () => {
		expect(steps("Reaving Fangs\nSerpent's Ire\n\nSwiftskin's Sting\n")).toEqual([
			"REAVING_FANGS",
			"SERPENTS_IRE",
			"SWIFTSKINS_STING",
		]);
	});

	it("knows the other names in the user's export", () => {
		expect(steps("Hindsbane Fang\nFlanksting Strike")).toEqual([
			"HINDSBANE_FANG",
			"FLANKSTING_STRIKE",
		]);
	});

	it("tolerates case, spacing, Windows line endings, a BOM and a curly apostrophe", () => {
		expect(steps("﻿  reaving FANGS \r\nSerpent’s Ire\r\n")).toEqual([
			"REAVING_FANGS",
			"SERPENTS_IRE",
		]);
	});

	it("reads the skill column of an export, skipping comments and naming what it ignores", () => {
		const parsed = parseRotationList(EXPORT, "VPR");
		if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
		expect(parsed.steps).toHaveLength(29);
		expect(parsed.steps[1]).toEqual({ type: "skill", action: "SERPENTS_IRE" });
		expect(parsed.ignoredColumns).toEqual([
			"Time",
			"job_class",
			"skill_conditional",
			"targets",
		]);
	});

	it("handles quoted fields and spreadsheet separators", () => {
		expect(steps('"t, note";skill\n"0,5";"Reaving Fangs"\n1;Steel Fangs')).toEqual([
			"REAVING_FANGS",
			"STEEL_FANGS",
		]);
		expect(steps('skill,note\nReaving Fangs,"say ""hi"", twice"')).toEqual(["REAVING_FANGS"]);
	});

	it("rejects the whole file on an unknown name, giving each line number", () => {
		expect(errors("# comment\nReaving Fangs\nSteal Fangs\n\nHigh Jump")).toEqual([
			'Line 3: "Steal Fangs" is not a VPR skill.',
			'Line 5: "High Jump" is not a VPR skill.',
		]);
		expect(errors("skill,note\n,forgotten")).toEqual(["Line 2: no skill name."]);
	});

	it("rejects empty and oversized lists", () => {
		expect(errors("# only a comment\n\n")).toEqual(["The file lists no skills."]);
		expect(errors("skill_name\n")).toEqual(["The file lists no skills."]);
		expect(errors("Steel Fangs\n".repeat(MAX_LIST_STEPS + 1))[0]).toContain("the limit is");
		expect(steps("Steel Fangs\n".repeat(MAX_LIST_STEPS))).toHaveLength(MAX_LIST_STEPS);
	});

	// Every name in the opening resolves, and the result plays as written: no step is reported.
	it("gives a rotation the simulator can play", () => {
		const parsed = parseRotationList(EXPORT, "VPR");
		if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
		const rotation = createRotation({ name: "Export", job: "VPR", steps: parsed.steps });
		const { result } = simulateDocument(rotation, createScenario({ name: "Test" }));
		const refused = result.actions.filter((a) => !a.valid);
		expect(refused.map((a) => a.requestedAction)).toEqual([]);
		expect(result.actions.map((a) => a.executedAction)).toEqual(
			parsed.steps.map((s) => (s.type === "skill" ? s.action : "")),
		);
	});
});
