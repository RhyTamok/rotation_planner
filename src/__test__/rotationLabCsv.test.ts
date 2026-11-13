import { describe, expect, it } from "vitest";
import {
	AVAILABLE_RULESETS,
	ENGINE_VERSION,
	formatResultLabel,
	resultLabel,
} from "../RotationLab/models/Rotation";

import { ACTIONS } from "../Game/Data";
import { compareConfigurations } from "../RotationLab/comparison/baseline";
import { competitiveAt } from "../RotationLab/comparison/competitive";
import {
	CSV_FORMATS,
	CsvFormat,
	csvFileName,
	cutoffSummaryCsv,
	timelineCsv,
} from "../RotationLab/export/csv";
import { parseRotationList } from "../RotationLab/import/rotationList";
import { simulateRotation } from "../RotationLab/simulation/RotationSimulator";
import { RotationResult, SimulatedAction } from "../RotationLab/simulation/types";

// CSV exports (comparison roadmap M4).

const { comma, semicolon } = CSV_FORMATS;

// RFC 4180 reader for the tests: quoted fields, doubled quotes, CRLF rows.
function parseCsv(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c !== '"') field += c;
			else if (text[i + 1] === '"') field += text[++i];
			else quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === delimiter) {
			row.push(field);
			field = "";
		} else if (c === "\r" && text[i + 1] === "\n") {
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
			i++;
		} else field += c;
	}
	return rows;
}

function action(patch: Partial<SimulatedAction>): SimulatedAction {
	return {
		stepIndex: 0,
		requestedAction: "STEEL_FANGS",
		executedAction: "STEEL_FANGS",
		startTime: 0,
		lockEndTime: 0.6,
		isGCD: true,
		valid: true,
		invalidReasons: [],
		resources: {
			gauges: [
				{ key: "RATTLING_COIL", label: "Rattling Coil", amount: 1, max: 3 },
				{ key: "SERPENT_OFFERINGS", label: "Serpent Offering", amount: 50, max: 100 },
			],
			timers: [],
		},
		appliedPotency: 0,
		pendingPotency: 0,
		targetsHit: 1,
		modifiers: [],
		...patch,
	} as SimulatedAction;
}

const NAMES: Record<string, string> = {
	STEEL_FANGS: "Steel Fangs",
	HUNTERS_STING: "Hunter's Sting",
	SERPENTS_IRE: "Serpent's Ire",
};
const nameOf = (key: string) => NAMES[key] ?? key;

const TIMELINE = {
	actions: [
		action({
			startTime: -0.5,
			lockEndTime: 0.1,
			pullHold: 0.25,
			appliedPotency: 200,
			expectedDamage: 12345.678,
		}),
		action({
			stepIndex: 2,
			requestedAction: "STEEL_FANGS",
			executedAction: "HUNTERS_STING",
			startTime: 2.5,
			lockEndTime: 3.1,
			gcdDelay: 0.0004,
			clipped: true,
			appliedPotency: 300.5,
			expectedDamage: 20000,
			pendingPotency: 0,
			pendingDamage: 0,
			comboBreaks: ["single-target combo"],
		}),
		action({
			stepIndex: 3,
			requestedAction: "SERPENTS_IRE",
			executedAction: "SERPENTS_IRE",
			startTime: 3.1,
			lockEndTime: 3.7,
			isGCD: false,
			valid: false,
			invalidReasons: ["not ready"],
			ghostedBy: 1,
			targetsHit: 0,
			pendingPotency: 100,
			pendingDamage: 5000.25,
		}),
	],
} as unknown as RotationResult;

// Every export ends with the `simulated_with` column (roadmap 1.8); the goldens below spell out the
// other columns. The first line is the header.
const LABEL = formatResultLabel();
const labelled = (lines: string[], delimiter = ",") =>
	lines.map((line, i) =>
		line === "" ? line : `${line}${delimiter}${i === 0 ? "simulated_with" : LABEL}`,
	);

describe("Rotation Lab - CSV export", () => {
	it("writes the per-action timeline (golden, comma format)", () => {
		expect(timelineCsv(TIMELINE, nameOf, comma)).toBe(
			labelled([
				"step,skill_name,pressed,press_time_s,lock_end_s,type,valid,gcd_delay_s,clipped,pull_hold_s,ghosted_by_s,targets,potency,pending_potency,damage,pending_damage,Rattling Coil,Serpent Offering,notes",
				"1,Steel Fangs,Steel Fangs,-0.500,0.100,GCD,true,,,0.250,,1,200.00,0.00,12345.68,,1,50,",
				"3,Hunter's Sting,Steel Fangs,2.500,3.100,GCD,true,0.000,true,,,1,300.50,0.00,20000.00,0.00,1,50,breaks the single-target combo",
				"4,Serpent's Ire,Serpent's Ire,3.100,3.700,oGCD,false,,,,1.000,0,0.00,100.00,,5000.25,1,50,not ready; lands after the end",
				"",
			]).join("\r\n"),
		);
	});

	it("labels every row with the ruleset, game patch and engine version", () => {
		// Plain text in every dialect: no comma, semicolon or bare number a spreadsheet could
		// reinterpret ("7.5" alone becomes a date in German Excel).
		expect(LABEL).toBe(
			`ruleset ${resultLabel().ruleset} / game patch ${resultLabel().gamePatch} / engine ${ENGINE_VERSION}`,
		);
		expect(resultLabel()).toEqual({
			ruleset: AVAILABLE_RULESETS.reborn,
			gamePatch: "7.5",
			engineVersion: ENGINE_VERSION,
		});
		expect(LABEL).not.toMatch(/[,;"]/);
		for (const [format, delimiter] of [
			[comma, ","],
			[semicolon, ";"],
		] as const) {
			const rows = parseCsv(timelineCsv(TIMELINE, nameOf, format), delimiter);
			expect(rows[0].at(-1)).toBe("simulated_with");
			expect(rows.slice(1).map((row) => row.at(-1))).toEqual(rows.slice(1).map(() => LABEL));
		}
	});

	it("uses decimal commas with semicolons, whatever the browser's locale", () => {
		const rows = parseCsv(timelineCsv(TIMELINE, nameOf, semicolon), ";");
		expect(rows[1].slice(0, 5)).toEqual(["1", "Steel Fangs", "Steel Fangs", "-0,500", "0,100"]);
		expect(rows[1][14]).toBe("12345,68");
		expect(rows.every((r) => r.length === rows[0].length)).toBe(true);
	});

	it("quotes delimiters, quotes and line breaks, and defuses formulas in text only", () => {
		const names: Record<string, string> = {
			STEEL_FANGS: '=HYPERLINK("x");\nnext',
			HUNTERS_STING: "-minus, comma",
			SERPENTS_IRE: "@at",
		};
		const csv = timelineCsv(TIMELINE, (k) => names[k], semicolon);
		expect(csv).toContain(`"'=HYPERLINK(""x"");\nnext"`);
		// The comma needs no quotes with semicolons.
		expect(csv).toContain(";'-minus, comma;");
		expect(csv).toContain(";'@at;");
		const rows = parseCsv(csv, ";");
		expect(rows).toHaveLength(4);
		// A negative number stays a number.
		expect(rows[1][3]).toBe("-0,500");
		expect(rows[1][1]).toBe(`'=HYPERLINK("x");\nnext`);
	});

	it("reads back through the rotation list import as the same executed skills", () => {
		const result = simulateRotation(
			{ id: "r", steps: ["STEEL_FANGS", "STEEL_FANGS", "SERPENTS_IRE", "STEEL_FANGS"] },
			{ encounterRules: true, config: { fps: 0 }, end: "settled" },
		);
		const executed = result.actions.map((a) => a.executedAction);
		// A combo follow-up executed, so the pressed and executed columns differ.
		expect(executed).not.toEqual(result.actions.map((a) => a.requestedAction));
		for (const format of [comma, semicolon]) {
			// With the byte order mark the download adds, and the displayed names the app uses.
			const csv = "﻿" + timelineCsv(result, (k) => ACTIONS[k].name, format);
			const imported = parseRotationList(csv, "VPR");
			if (!imported.ok) throw new Error(imported.errors.join(" "));
			const steps = imported.steps.map((s) => (s.type === "skill" ? s.action : s.type));
			expect(steps).toEqual(executed);
			// Pressing the executed skills directly plays out the same way.
			const again = simulateRotation(
				{ id: "r2", steps: steps as typeof executed },
				{ encounterRules: true, config: { fps: 0 }, end: "settled" },
			);
			expect(again.actions.map((a) => a.executedAction)).toEqual(executed);
		}
	});

	it("makes safe file names", () => {
		expect(csvFileName('My: "best"/opener?', "timeline")).toBe("My best opener-timeline.csv");
		expect(csvFileName("  ", "cutoffs")).toBe("rotation-lab-cutoffs.csv");
	});
});

describe("Rotation Lab - cutoff summary CSV", () => {
	function fakeResult(hits: [number, number][]): RotationResult {
		return {
			actions: [],
			damage: { expectedDamage: 0, autoAttackDamage: 0, pendingDamage: 0 },
			damageEvents: hits.map(([time, damage]) => ({
				time,
				source: "STEEL_FANGS",
				potency: damage / 10,
				expectedDamage: damage,
				isAutoAttack: false,
				hitTarget: true,
			})),
			encounter: { partyBuffs: [], downtime: [] },
		} as unknown as RotationResult;
	}
	// At 10 s: A 100 DPS, B 80, C 99.95. At 20 s: A 60, B 90, C 60.
	const configs = [
		{
			id: "a",
			result: fakeResult([
				[5, 1000],
				[15, 200],
			]),
		},
		{
			id: "b",
			result: fakeResult([
				[5, 800],
				[15, 1000],
			]),
		},
		{
			id: "c",
			result: fakeResult([
				[10, 999.5],
				[20, 200.5],
			]),
		},
	];
	const entries = [
		{ id: "a", letter: "A", rotationName: "Opener; v2" },
		{ id: "b", letter: "B", rotationName: "Late" },
		{ id: "c", letter: "C", rotationName: "Close" },
	];
	const comparison = compareConfigurations(configs, "a", [10, 20]);
	const summary = (showDeltas: boolean, showRank: boolean, format: CsvFormat = comma) =>
		parseCsv(
			cutoffSummaryCsv(
				{ comparison, entries, showDeltas, showRank, epsilonPct: 0.1 },
				format,
			),
			format.delimiter,
		);

	it("writes one row per cutoff and configuration (golden)", () => {
		expect(
			cutoffSummaryCsv(
				{ comparison, entries, showDeltas: true, showRank: true, epsilonPct: 0.1 },
				comma,
			),
		).toBe(
			labelled([
				"cutoff_s,configuration,rotation,baseline,total_damage,dps,delta_dps,delta_pct,rank,within_epsilon,epsilon_pct",
				"10.000,A,Opener; v2,true,1000.00,100.00,0.00,0.0000,1,true,0.10",
				"10.000,B,Late,false,800.00,80.00,-20.00,-20.0000,3,false,0.10",
				"10.000,C,Close,false,999.50,99.95,-0.05,-0.0500,2,true,0.10",
				"20.000,A,Opener; v2,true,1200.00,60.00,0.00,0.0000,2,false,0.10",
				"20.000,B,Late,false,1800.00,90.00,30.00,50.0000,1,true,0.10",
				"20.000,C,Close,false,1200.00,60.00,0.00,0.0000,2,false,0.10",
				"",
			]).join("\r\n"),
		);
	});

	it("agrees with the comparison maths in every cell", () => {
		const rows = summary(true, true, semicolon).slice(1);
		const num = (s: string) => Number(s.replace(",", "."));
		let i = 0;
		for (const table of comparison.cutoffs) {
			const within = competitiveAt(comparison.series, comparison.ids, table.time, 0.1);
			for (const row of table.rows) {
				const [time, , , , total, dps, deltaDps, deltaPct, rank, inside] = rows[i++];
				expect(num(time)).toBeCloseTo(table.time, 3);
				expect(num(total)).toBeCloseTo(row.total, 2);
				expect(num(dps)).toBeCloseTo(row.dps!, 2);
				expect(num(deltaDps)).toBeCloseTo(row.deltaDps!, 2);
				expect(num(deltaPct)).toBeCloseTo(row.deltaPct! * 100, 4);
				expect(Number(rank)).toBe(row.rank);
				expect(inside).toBe(String(within.competitive.includes(row.id)));
			}
		}
		expect(i).toBe(rows.length);
	});

	it("leaves the cells empty that the table hides", () => {
		// Baseline failed: the stand-in's differences are not differences from the baseline.
		const noBaseline = summary(false, true)[1];
		expect(noBaseline.slice(3, 9)).toEqual(["", "1000.00", "100.00", "", "", "1"]);
		// One configuration: no rank and no threshold.
		const alone = summary(false, false)[1];
		expect(alone.slice(8)).toEqual(["", "", "", LABEL]);
	});

	it("names potency columns when there is no damage model", () => {
		const potency = { ...comparison, metric: "potency" as const };
		const header = cutoffSummaryCsv(
			{ comparison: potency, entries, showDeltas: true, showRank: true, epsilonPct: 0.1 },
			comma,
		).split("\r\n")[0];
		expect(header).toContain("total_potency,pps,delta_pps");
	});
});
