import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ChartSeries, LineChart } from "../RotationLab/ui/compare/LineChart";
import {
	clampRange,
	MIN_SPAN,
	panRange,
	valueOnLine,
	valuesInRange,
	zoomRange,
} from "../RotationLab/ui/compare/viewRange";
import { formatInterval, formatNumber } from "../RotationLab/ui/format";

const domain = { start: 10, end: 110 };

describe("Rotation Lab - chart range maths", () => {
	it("zooms around a point that stays put", () => {
		const zoomed = zoomRange(domain, domain, 30, 0.5);
		expect(zoomed).toEqual({ start: 20, end: 70 });
		// 30 s was a fifth of the way across, and still is.
		expect((30 - zoomed.start) / (zoomed.end - zoomed.start)).toBeCloseTo(0.2, 12);
	});

	it("never zooms past the domain, nor below the smallest span", () => {
		expect(zoomRange({ start: 20, end: 70 }, domain, 30, 10)).toEqual(domain);
		const tiny = zoomRange(domain, domain, 50, 1e-6);
		expect(tiny.end - tiny.start).toBeCloseTo(MIN_SPAN, 12);
		expect(clampRange({ start: 0, end: 5 }, { start: 0, end: 0.2 })).toEqual({
			start: 0,
			end: 0.2,
		});
	});

	it("drags within the domain, keeping the span", () => {
		expect(panRange({ start: 20, end: 40 }, domain, 15)).toEqual({ start: 35, end: 55 });
		expect(panRange({ start: 20, end: 40 }, domain, -50)).toEqual({ start: 10, end: 30 });
		expect(panRange({ start: 80, end: 100 }, domain, 50)).toEqual({ start: 90, end: 110 });
	});

	it("reads the line between points, taking the first point at a jump", () => {
		const points = [
			{ t: 10, value: 0 },
			{ t: 20, value: 10 },
			{ t: 20, value: 50 },
			{ t: 30, value: undefined },
		];
		expect(valueOnLine(points, 15)).toBe(5);
		expect(valueOnLine(points, 20)).toBe(10);
		expect(valueOnLine(points, 25)).toBeUndefined();
		expect(valueOnLine(points, 5)).toBeUndefined();
	});

	it("fits the y axis to what is on show, edges included", () => {
		const points = [
			{ t: 0, value: 1000 },
			{ t: 10, value: 100 },
			{ t: 20, value: 102 },
			{ t: 30, value: 101 },
		];
		expect(valuesInRange(points, { start: 12, end: 25 }).sort((a, b) => a - b)).toEqual([
			100.4, 101.5, 102,
		]);
	});
});

// A large early swing and a small late one: the case zooming is for.
const series: ChartSeries[] = [
	{
		letter: "B",
		label: "B: test",
		seriesClass: "rl-series-b",
		points: [
			{ t: 10, value: 500 },
			{ t: 60, value: 3 },
			{ t: 110, value: 1 },
		],
		valueAt: () => 0,
	},
];

function renderChart() {
	render(
		<LineChart
			ariaLabel="Test chart"
			from={10}
			to={110}
			series={series}
			windows={[]}
			downtime={[]}
			cutoffs={[30, 100]}
			zeroLabel="Baseline"
			format={(v) => formatNumber(v)}
			formatExact={(v) => formatNumber(v, 1)}
		/>,
	);
	const chart = screen.getByRole("img", { name: "Test chart" });
	const controls = screen.getByRole("group", { name: "Test chart: zoom" });
	return { chart, controls };
}

const yLabels = (chart: HTMLElement) =>
	[...chart.querySelectorAll("g text.rl-chart-label")].map((t) => t.textContent);

describe("Rotation Lab - chart zoom", () => {
	it("zooms with the buttons, rescales the y axis and shows everything again", async () => {
		const user = userEvent.setup();
		const { chart, controls } = renderChart();
		expect(within(chart).getAllByTestId("chart-cutoff")).toHaveLength(2);
		expect(screen.queryByTestId("chart-range")).toBeNull();
		expect(within(controls).getByRole("button", { name: "Show all" })).toHaveProperty(
			"disabled",
			true,
		);
		const before = yLabels(chart);

		const zoomIn = within(controls).getByRole("button", { name: "Zoom in" });
		for (let i = 0; i < 3; i++) await user.click(zoomIn);
		// 100 s / 1.5³ around 60 s.
		const half = 100 / 1.5 ** 3 / 2;
		expect(screen.getByTestId("chart-range").textContent).toBe(
			`Showing ${formatInterval(60 - half, 60 + half)}`,
		);
		// Neither cutoff is on show now, and the axis follows the small values that are.
		expect(within(chart).queryAllByTestId("chart-cutoff")).toHaveLength(0);
		expect(yLabels(chart)).not.toEqual(before);
		expect(Math.max(...yLabels(chart).map((l) => Number(l!.replace(/\D/g, ""))))).toBeLessThan(
			500,
		);

		await user.click(within(controls).getByRole("button", { name: "Show all" }));
		expect(screen.queryByTestId("chart-range")).toBeNull();
		expect(yLabels(chart)).toEqual(before);
	});

	it("labels ticks with enough decimals to tell them apart", () => {
		// A tall plot, as on a large monitor: jsdom has no layout, so its size is given.
		const box = vi
			.spyOn(HTMLElement.prototype, "getBoundingClientRect")
			.mockReturnValue({ width: 1200, height: 600, left: 0, top: 0 } as DOMRect);
		render(
			<LineChart
				ariaLabel="Flat chart"
				from={10}
				to={20}
				series={[
					{
						...series[0],
						points: [
							{ t: 10, value: 0 },
							{ t: 20, value: 0 },
						],
					},
				]}
				windows={[]}
				downtime={[]}
				cutoffs={[]}
				zeroLabel="Baseline"
				format={(v, d) => formatNumber(v, d)}
				formatExact={(v) => formatNumber(v, 1)}
			/>,
		);
		const labels = yLabels(screen.getByRole("img", { name: "Flat chart" }));
		// A flat line gets an axis from -1 to 1 in steps of 0.5; whole numbers would repeat.
		expect(new Set(labels).size).toBe(labels.length);
		expect(labels).toContain(formatNumber(0.5, 1));
		box.mockRestore();
	});

	it("zooms with the wheel and resets on a double click", () => {
		const { chart } = renderChart();
		fireEvent.wheel(chart.parentElement!, { deltaY: -100 });
		expect(screen.getByTestId("chart-range")).toBeTruthy();
		fireEvent.wheel(chart.parentElement!, { deltaY: 100 });
		expect(screen.queryByTestId("chart-range")).toBeNull();
		fireEvent.wheel(chart.parentElement!, { deltaY: -100 });
		fireEvent.doubleClick(chart);
		expect(screen.queryByTestId("chart-range")).toBeNull();
	});
});
