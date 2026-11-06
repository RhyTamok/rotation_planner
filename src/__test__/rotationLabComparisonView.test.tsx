import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ComparisonDocument, createComparison } from "../RotationLab/models/Comparison";
import { createRotation, RotationDocument } from "../RotationLab/models/Rotation";
import { createScenario, ScenarioDocument } from "../RotationLab/models/Scenario";
import { SimulationCache } from "../RotationLab/simulation/SimulationManager";
import { RotationResult } from "../RotationLab/simulation/types";
import { ComparisonView } from "../RotationLab/ui/ComparisonView";
import { formatDeltaPct, formatNumber, formatSigned } from "../RotationLab/ui/format";

// A result with just the fields the comparison reads.
function fakeResult(hits: [number, number][], endTime: number): RotationResult {
	return {
		actions: [],
		endTime,
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

// Rotations named after their keys, whose simulations return the given hits. `null` fails.
function setup(
	hitsByName: Record<string, [number, number][] | null>,
	options: {
		endTime?: number;
		cutoffs?: number[];
		use?: string[];
		scenario?: Partial<ScenarioDocument>;
	} = {},
) {
	// Different steps, because the cache rightly treats identical rotations as one simulation.
	const rotations = Object.keys(hitsByName).map((name, i) =>
		createRotation({
			name,
			job: "VPR",
			steps: Array.from({ length: i }, () => "STEEL_FANGS"),
		}),
	);
	const scenario = { ...createScenario({ name: "Test" }), ...options.scenario };
	const simulate = vi.fn((rotation: RotationDocument) => {
		const hits = hitsByName[rotation.name];
		if (hits === null) throw new Error(`${rotation.name} is broken`);
		return { result: fakeResult(hits, options.endTime ?? 20) };
	});
	const cache = new SimulationCache(64, simulate);
	const initial = createComparison({
		job: "VPR",
		scenarioId: scenario.id,
		rotationIds: rotations
			.filter((r) => !options.use || options.use.includes(r.name))
			.map((r) => r.id),
	});
	const start = { ...initial, cutoffs: options.cutoffs ?? [] };
	let latest: ComparisonDocument = start;

	function Harness(props: { scenario: ScenarioDocument }) {
		const [doc, setDoc] = useState(start);
		latest = doc;
		return <ComparisonView
			rotations={rotations}
			scenario={props.scenario}
			cache={cache}
			comparison={doc}
			comparisons={[doc]}
			onSelectComparison={() => {}}
			onComparisonChange={setDoc}
			onScenarioChange={() => {}}
			gearSets={[]}
		/>;
	}
	render(<Harness scenario={scenario} />);
	return {
		simulate,
		doc: () => latest,
		region: screen.getByRole("region", { name: "Comparison" }),
	};
}

const cells = (row: HTMLElement) =>
	within(row)
		.getAllByRole("cell")
		.map((c) => c.textContent);

const THREE: Record<string, [number, number][]> = {
	Aa: [
		[10, 100],
		[20, 100],
	],
	Bb: [
		[10, 200],
		[20, 100],
	],
	Cc: [
		[10, 50],
		[20, 50],
	],
};

describe("Rotation Lab - comparison view", () => {
	it("shows DPS, difference, percentage and rank for every configuration", () => {
		const { region } = setup(THREE);
		const [row] = within(region).getAllByTestId("cutoff-row");
		// At the 20 s end of the fight: 10, 15 and 5 DPS against baseline A.
		expect(cells(row).slice(0, 13)).toEqual([
			`${formatNumber(20, 2)} s (end)`,
			formatNumber(10, 1),
			formatSigned(0, 1),
			formatDeltaPct(0),
			"2",
			formatNumber(15, 1),
			formatSigned(5, 1),
			formatDeltaPct(0.5),
			"1",
			formatNumber(5, 1),
			formatSigned(-5, 1),
			formatDeltaPct(-0.5),
			"3",
		]);
	});

	it("changes the baseline without simulating, keeping each line's colour", async () => {
		const user = userEvent.setup();
		const { region, simulate, doc } = setup(THREE);
		const lines = () =>
			[...region.querySelectorAll("svg[role=img]")][0].querySelectorAll("path.rl-chart-line");
		const classes = () => [...lines()].map((p) => p.getAttribute("class"));
		expect(classes()).toEqual(["rl-chart-line rl-series-b", "rl-chart-line rl-series-c"]);
		const runs = simulate.mock.calls.length;
		expect(runs).toBe(3);

		await user.click(within(region).getByRole("radio", { name: "Baseline B" }));

		expect(simulate.mock.calls.length).toBe(runs);
		expect(doc().baselineId).toBe(doc().configurations[1].id);
		expect(classes()).toEqual(["rl-chart-line rl-series-a", "rl-chart-line rl-series-c"]);
		const [row] = within(region).getAllByTestId("cutoff-row");
		// Own DPS and rank unchanged; differences now against B's 15 DPS.
		expect(cells(row).slice(1, 5)).toEqual([
			formatNumber(10, 1),
			formatSigned(-5, 1),
			formatDeltaPct(-5 / 15),
			"2",
		]);
		expect(cells(row).slice(5, 9)).toEqual([
			formatNumber(15, 1),
			formatSigned(0, 1),
			formatDeltaPct(0),
			"1",
		]);
	});

	it("adds up to four configurations and moves the baseline when it is removed", async () => {
		const user = userEvent.setup();
		const { region, doc } = setup(THREE, { use: ["Aa", "Bb"] });
		const rows = () => within(region).getAllByTestId("configuration-row");
		expect(rows()).toHaveLength(2);

		const add = within(region).getByRole("button", { name: "Add configuration" });
		await user.click(add);
		// It prefers a rotation not in use yet.
		const third = within(region).getByRole<HTMLSelectElement>("combobox", {
			name: "Rotation C",
		});
		expect(third.selectedOptions[0].textContent).toBe("Cc");
		await user.click(add);
		expect(rows()).toHaveLength(4);
		expect(within(region).queryByRole("button", { name: "Add configuration" })).toBeNull();

		const before = doc().configurations[1].id;
		await user.click(within(region).getByRole("button", { name: "Remove configuration A" }));
		expect(rows()).toHaveLength(3);
		expect(doc().baselineId).toBe(before);
	});

	it("disables what needs a baseline with one configuration, keeping its own figures", async () => {
		const user = userEvent.setup();
		const { region } = setup(THREE, { use: ["Aa"] });
		expect(within(region).queryByRole("radio", { name: /Baseline/ })).toBeNull();
		expect(within(region).queryByRole("button", { name: /Remove configuration/ })).toBeNull();
		expect(within(region).queryByRole("img", { name: /difference/ })).toBeNull();
		expect(within(region).getByRole("img", { name: /Running DPS/ })).toBeTruthy();
		const [row] = within(region).getAllByTestId("cutoff-row");
		expect(cells(row).slice(0, 2)).toEqual([
			`${formatNumber(20, 2)} s (end)`,
			formatNumber(10, 1),
		]);
		expect(region.textContent).not.toContain("Rank");
		expect(within(region).getAllByTestId("resource-row")).toHaveLength(1);

		await user.click(within(region).getByRole("button", { name: "Add configuration" }));
		expect(within(region).getByRole("img", { name: /difference/ })).toBeTruthy();
	});

	it("keeps comparing the others when one configuration cannot be simulated", () => {
		const { region } = setup({ ...THREE, Cc: null });
		expect(region.textContent).toContain("C: Cc cannot be simulated: Cc is broken");
		const [row] = within(region).getAllByTestId("cutoff-row");
		expect(cells(row).slice(5, 9)).toEqual([
			formatNumber(15, 1),
			formatSigned(5, 1),
			formatDeltaPct(0.5),
			"1",
		]);
	});

	it("hides differences, keeping DPS and ranks, when the baseline cannot be simulated", () => {
		const { region } = setup({ ...THREE, Aa: null });
		expect(region.textContent).toContain(
			"Differences are hidden until the baseline can be simulated.",
		);
		expect(within(region).queryByRole("img", { name: /difference/ })).toBeNull();
		const [row] = within(region).getAllByTestId("cutoff-row");
		// Bb and Cc only: DPS and rank.
		expect(cells(row).slice(1, 5)).toEqual([formatNumber(15, 1), "1", formatNumber(5, 1), "2"]);
		expect(region.textContent).not.toContain("Δ%");
	});

	it("shows N/A for percentages against a baseline without damage", () => {
		const { region } = setup({ Zero: [], Bb: [[10, 200]] });
		const [row] = within(region).getAllByTestId("cutoff-row");
		expect(cells(row).slice(1, 9)).toEqual([
			formatNumber(0, 1),
			formatSigned(0, 1),
			"N/A",
			"2",
			formatNumber(10, 1),
			formatSigned(10, 1),
			"N/A",
			"1",
		]);
	});

	it("reports every 30 s by default, and storing an edit keeps the rest editable", async () => {
		const user = userEvent.setup();
		const { region, doc } = setup(THREE, { endTime: 95 });
		const times = () =>
			within(region)
				.getAllByTestId("cutoff-row")
				.map((r) => cells(r)[0]);
		const shown = (...t: number[]) => t.map((v) => `${formatNumber(v, 2)} s`);
		expect(times()).toEqual([...shown(30, 60, 90), `${formatNumber(95, 2)} s (end)`]);
		expect(doc().cutoffs).toEqual([]);

		await user.click(within(region).getAllByRole("button", { name: "Remove cutoff" })[1]);
		expect(doc().cutoffs).toEqual([30, 90]);
		expect(times().slice(0, 2)).toEqual(shown(30, 90));

		await user.click(within(region).getByRole("button", { name: "Use every 30 s" }));
		expect(doc().cutoffs).toEqual([]);
		expect(times()).toHaveLength(4);
	});

	it("draws cutoff markers, downtime bands and the percentage toggle", async () => {
		const user = userEvent.setup();
		const { region } = setup(THREE, {
			endTime: 95,
			scenario: { downtime: [{ start: 40, end: 50 }] },
		});
		const chart = within(region).getByRole("img", { name: /difference/ });
		// 30, 60, 90 and the end of the fight.
		expect(within(chart).getAllByTestId("chart-cutoff")).toHaveLength(4);
		expect(chart.querySelectorAll("rect.rl-chart-downtime")).toHaveLength(1);
		expect(chart.textContent).toContain("Baseline: A: Aa");
		expect(chart.textContent).not.toContain("%");

		await user.click(within(region).getByRole("radio", { name: "Δ%" }));
		expect(within(region).getByRole("img", { name: /difference/ }).textContent).toContain("%");
	});

	it("shows burst totals per configuration against the baseline", () => {
		const { region } = setup(THREE, {
			scenario: { burstWindows: [{ start: 0, end: 10, label: "Opener" }] },
		});
		const [row] = within(region).getAllByTestId("window-row");
		expect(cells(row)).toEqual([
			`Opener: ${formatNumber(0, 2)}–${formatNumber(10, 2)} s`,
			formatNumber(100),
			formatNumber(200),
			formatSigned(100, 0),
			formatNumber(50),
			formatSigned(-50, 0),
		]);
	});
});
