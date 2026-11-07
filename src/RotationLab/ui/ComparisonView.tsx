import React, { useMemo } from "react";

import { compareConfigurations, cutoffTable } from "../comparison/baseline";
import { burstWindows, dpsAt } from "../comparison/compare";
import { competitiveAt, intervalAnalysis } from "../comparison/competitive";
import { listedCutoffs, reportedCutoffs } from "../comparison/cutoffs";
import { curveStart, deltaDpsCurve, deltaPctCurve, runningDpsCurve } from "../comparison/curves";
import { effectiveInterval, localSensitivity } from "../comparison/sensitivity";
import {
	addConfiguration,
	ComparisonAnalysis,
	ComparisonDocument,
	DEFAULT_CHARTS_FROM,
	editComparison,
	MAX_EPSILON_PCT,
	MIN_EPSILON_PCT,
	removeConfiguration,
} from "../models/Comparison";
import { GearSetDocument, resolveGear } from "../models/GearSet";
import { RotationDocument } from "../models/Rotation";
import { ScenarioDocument } from "../models/Scenario";
import { SimulationCache } from "../simulation/SimulationManager";
import { BurstSection } from "./compare/BurstSection";
import { ConfigurationPicker } from "./compare/ConfigurationPicker";
import { CompetitivenessSection } from "./compare/CompetitivenessSection";
import { CutoffTables } from "./compare/CutoffTables";
import { ConfigEntry, SimulatedEntry, slotOf } from "./compare/entries";
import { ChartAnnotation, ChartSeries, LineChart } from "./compare/LineChart";
import { NumberField } from "./compare/NumberField";
import { SensitivitySection } from "./compare/SensitivitySection";
import { formatDeltaPct, formatNumber, formatSigned } from "./format";

// More changes than this are listed but not drawn, so that many tiny flips cannot flood the chart.
const MAX_CHART_ANNOTATIONS = 24;

export function ComparisonView(props: {
	rotations: RotationDocument[];
	scenario: ScenarioDocument;
	cache: SimulationCache;
	// The comparison on show: stored, or the default that is stored on its first edit.
	comparison: ComparisonDocument;
	// All stored comparisons, to choose from.
	comparisons: ComparisonDocument[];
	onSelectComparison: (id: string) => void;
	onComparisonChange: (comparison: ComparisonDocument) => void;
	onScenarioChange: (scenario: ScenarioDocument) => void;
	gearSets: GearSetDocument[];
}) {
	const { rotations, scenario, cache, comparison: doc, gearSets } = props;
	const edit = (patch: Parameters<typeof editComparison>[1]) =>
		props.onComparisonChange(editComparison(doc, patch));
	const settings = doc.analysis;
	const setAnalysis = (patch: Partial<ComparisonAnalysis>) =>
		edit({ analysis: { ...settings, ...patch } });
	const { graphUnit, epsilonPct } = settings;
	const chartsFrom = doc.display.chartsFrom ?? DEFAULT_CHARTS_FROM;
	const candidates = useMemo(
		() => rotations.filter((r) => r.job === doc.job),
		[rotations, doc.job],
	);

	// Baseline, cutoff and display edits keep `doc.configurations`, so they never get here.
	const entries = useMemo(
		() =>
			doc.configurations.map((c, i): ConfigEntry => {
				const rotation = rotations.find((r) => r.id === c.rotationId);
				const { letter, seriesClass } = slotOf(i);
				const entry: ConfigEntry = {
					id: c.id,
					letter,
					seriesClass,
					rotation,
					label: `${letter}: ${rotation ? rotation.name || "(unnamed)" : "(missing)"}`,
				};
				if (!rotation) return { ...entry, error: "its rotation no longer exists" };
				try {
					const gear = resolveGear(rotation, gearSets);
					return { ...entry, result: cache.get(rotation, scenario, gear).result };
				} catch (e) {
					return { ...entry, error: (e as Error).message };
				}
			}),
		[doc.configurations, rotations, scenario, gearSets, cache],
	);
	const simulated = useMemo(
		() => entries.filter((e): e is SimulatedEntry => e.result !== undefined),
		[entries],
	);

	// With the baseline missing, the first simulated entry stands in so that DPS, totals and ranks
	// still show; `hasBaseline` hides everything measured from it.
	const hasBaseline = simulated.some((e) => e.id === doc.baselineId);
	const baselineId = hasBaseline ? doc.baselineId : simulated[0]?.id;
	const showRank = simulated.length > 1;
	const showDeltas = hasBaseline && showRank;

	const endTime = simulated.reduce((end, e) => Math.max(end, e.result.endTime), 0);
	const listed = useMemo(() => listedCutoffs(doc.cutoffs, endTime), [doc.cutoffs, endTime]);
	const cutoffs = useMemo(() => reportedCutoffs(listed, endTime), [listed, endTime]);
	const comparison = useMemo(
		() =>
			baselineId === undefined
				? undefined
				: compareConfigurations(
						simulated.map((e) => ({ id: e.id, result: e.result })),
						baselineId,
						cutoffs,
					),
		[simulated, baselineId, cutoffs],
	);

	const derivedWindows = useMemo(
		() => (simulated[0] ? burstWindows(simulated[0].result) : []),
		[simulated],
	);
	// Custom windows that end before they start (mid-edit) are skipped until fixed.
	const windows = useMemo(
		() => scenario.burstWindows?.filter((w) => w.end > w.start) ?? derivedWindows,
		[scenario.burstWindows, derivedWindows],
	);

	const perSecond = comparison?.metric === "potency" ? "PPS" : "DPS";
	const unit = comparison?.metric === "potency" ? "Potency" : "Damage";
	const chartFrom = curveStart(chartsFrom);

	const runningSeries = useMemo((): ChartSeries[] => {
		if (!comparison) return [];
		return simulated.map((e) => ({
			letter: e.letter,
			label: e.label,
			seriesClass: e.seriesClass,
			points: runningDpsCurve(comparison.series[e.id], chartFrom, endTime),
			valueAt: (t) => dpsAt(comparison.series[e.id], t),
		}));
	}, [comparison, simulated, chartFrom, endTime]);

	const differenceSeries = useMemo((): ChartSeries[] => {
		if (!comparison || !showDeltas) return [];
		const curve = graphUnit === "dps" ? deltaDpsCurve : deltaPctCurve;
		return simulated
			.filter((e) => e.id !== comparison.baselineId)
			.map((e) => ({
				letter: e.letter,
				label: e.label,
				seriesClass: e.seriesClass,
				// A percentage curve holds fractions, like the maths layer; shown as points.
				points: curve(comparison, e.id, chartFrom, endTime).map(({ t, value }) => ({
					t,
					value: graphUnit === "pct" && value !== undefined ? value * 100 : value,
				})),
				// The cutoff table's own calculation, so hover and table cannot disagree.
				valueAt: (t) => {
					const row = cutoffTable(
						comparison.series,
						comparison.ids,
						comparison.baselineId,
						t,
					).rows.find((r) => r.id === e.id);
					return graphUnit === "dps" ? row?.deltaDps : row?.deltaPct;
				},
			}));
	}, [comparison, showDeltas, simulated, graphUnit, chartFrom, endTime]);

	// Everything below needs at least two configurations, and none of it reruns a simulation.
	const intervalStart = settings.intervalStart ?? chartFrom;
	const intervalEnd = settings.intervalEnd ?? endTime;
	const interval = useMemo(
		() => effectiveInterval(intervalStart, intervalEnd, endTime),
		[intervalStart, intervalEnd, endTime],
	);
	const competitiveness = useMemo(
		() =>
			comparison && showRank && interval
				? intervalAnalysis(
						comparison.series,
						comparison.ids,
						interval.start,
						interval.end,
						epsilonPct,
					)
				: undefined,
		[comparison, showRank, interval, epsilonPct],
	);
	const sensitivityTime = settings.sensitivityTime ?? endTime;
	const sensitivity = useMemo(
		() =>
			comparison && showRank
				? localSensitivity(
						comparison,
						sensitivityTime,
						settings.sensitivityDelta,
						endTime,
						epsilonPct,
					)
				: undefined,
		[comparison, showRank, sensitivityTime, settings.sensitivityDelta, endTime, epsilonPct],
	);

	const letterOf = (id: string) => simulated.find((e) => e.id === id)?.letter ?? id;
	const stateAt = (t: number) =>
		comparison && t > 0
			? competitiveAt(comparison.series, comparison.ids, t, epsilonPct)
			: undefined;
	const withinAt = (t: number) => {
		const within = stateAt(t)?.competitive ?? [];
		return within.length === simulated.length ? "All" : within.map(letterOf).join(", ");
	};
	const transitions = competitiveness?.transitions ?? [];
	const annotations: ChartAnnotation[] =
		transitions.length > MAX_CHART_ANNOTATIONS
			? []
			: transitions.map((t) => ({ time: t.time, letter: letterOf(t.id), kind: t.kind }));

	const baselineEntry = entries.find((e) => e.id === doc.baselineId);
	const overlays = [
		windows.length > 0 && "Shaded: burst windows.",
		scenario.downtime.length > 0 && "Hatched: downtime.",
		"Dashed: cutoffs.",
	]
		.filter(Boolean)
		.join(" ");

	return <section className="rl-compare" aria-label="Comparison">
		<div className="rl-compare-controls">
			{props.comparisons.length > 1 && <label>
				Comparison{" "}
				<select
					aria-label="Comparison"
					value={doc.id}
					onChange={(e) => props.onSelectComparison(e.target.value)}
				>
					{props.comparisons.map((c) => <option key={c.id} value={c.id}>
						{c.name || "(unnamed)"}
					</option>)}
				</select>
			</label>}
			<label>
				Charts from{" "}
				<input
					type="number"
					min={0}
					step={5}
					aria-label="Charts from seconds"
					value={chartsFrom}
					onChange={(e) => {
						const t = Number(e.target.value);
						if (Number.isFinite(t) && t >= 0) {
							edit({ display: { ...doc.display, chartsFrom: t } });
						}
					}}
					style={{ width: 64 }}
				/>{" "}
				s
			</label>
			{showRank && <label className="rl-window-row">
				Relevance threshold ε{" "}
				<NumberField
					label="Relevance threshold percent"
					value={epsilonPct}
					min={MIN_EPSILON_PCT}
					max={MAX_EPSILON_PCT}
					step={MIN_EPSILON_PCT}
					valid={(v) => v >= MIN_EPSILON_PCT && v <= MAX_EPSILON_PCT}
					// Whole steps of 0.01, so that a typed 0.123 cannot store more than it shows.
					onCommit={(v) => setAnalysis({ epsilonPct: Math.round(v * 100) / 100 })}
				/>{" "}
				%
			</label>}
			<span className="rl-note">Scenario “{scenario.name}”</span>
		</div>
		<ConfigurationPicker
			doc={doc}
			entries={entries}
			candidates={candidates}
			gearSets={gearSets}
			onRotation={(configId, rotationId) =>
				edit({
					configurations: doc.configurations.map((c) =>
						c.id === configId ? { ...c, rotationId } : c,
					),
				})
			}
			onBaseline={(id) => edit({ baselineId: id })}
			onAdd={() => {
				const used = new Set(doc.configurations.map((c) => c.rotationId));
				const next = candidates.find((r) => !used.has(r.id)) ?? candidates[0];
				if (next) props.onComparisonChange(addConfiguration(doc, next.id));
			}}
			onRemove={(id) => props.onComparisonChange(removeConfiguration(doc, id))}
		/>

		{entries.map((e) =>
			e.error === undefined ? null : (
				<div className="rl-banner" key={e.id}>
					{e.label} cannot be simulated: {e.error}
					{e.id === doc.baselineId &&
						" Differences are hidden until the baseline can be simulated."}
				</div>
			),
		)}

		{comparison && <>
			{showDeltas && <>
				<h2>
					{perSecond} difference from the baseline
					{comparison.metric === "potency" && " (no damage model for this job or level)"}
				</h2>
				<div className="rl-compare-controls">
					<label>
						<input
							type="radio"
							name={`rl-graph-unit-${doc.id}`}
							checked={graphUnit === "dps"}
							onChange={() => setAnalysis({ graphUnit: "dps" })}
						/>{" "}
						Δ{perSecond}
					</label>
					<label>
						<input
							type="radio"
							name={`rl-graph-unit-${doc.id}`}
							checked={graphUnit === "pct"}
							onChange={() => setAnalysis({ graphUnit: "pct" })}
						/>{" "}
						Δ%
					</label>
				</div>
				<LineChart
					ariaLabel={`${perSecond} difference from the baseline over time`}
					from={chartFrom}
					to={endTime}
					series={differenceSeries}
					windows={windows}
					downtime={scenario.downtime}
					cutoffs={cutoffs}
					zeroLabel={`Baseline: ${baselineEntry?.label ?? ""}`}
					format={(v, d) =>
						graphUnit === "dps"
							? formatSigned(v, d)
							: `${formatSigned(v, Math.max(2, d))}%`
					}
					formatExact={(v) =>
						graphUnit === "dps" ? formatSigned(v, 1) : formatDeltaPct(v)
					}
					highlight={sensitivity?.interval}
					annotations={annotations}
					footerAt={(t) => {
						const state = stateAt(t);
						if (!state) return "";
						return `Leader: ${state.leaders.map(letterOf).join(", ")} · Within ε: ${withinAt(t)}`;
					}}
				/>
				<p className="rl-note">
					{graphUnit === "dps"
						? `Total so far ÷ time since the pull, minus the baseline's. Jumps when a hit lands, and drifts towards zero between hits.`
						: "Difference from the baseline's total so far. Changes only when a hit lands."}{" "}
					{overlays} ▲ and ▼: a configuration comes within ε of the best, or falls outside
					it, in the evaluated interval.
					{transitions.length > MAX_CHART_ANNOTATIONS &&
						` ${transitions.length} such changes are too many to draw; see the list under Competitiveness.`}
				</p>
			</>}

			<CutoffTables
				entries={simulated}
				comparison={comparison}
				listed={listed}
				custom={doc.cutoffs.length > 0}
				endTime={endTime}
				perSecond={perSecond}
				unit={unit}
				showDeltas={showDeltas}
				showRank={showRank}
				withinAt={withinAt}
				onChange={(next) => edit({ cutoffs: next })}
			/>

			{showRank && <>
				<CompetitivenessSection
					entries={simulated}
					analysis={competitiveness}
					interval={interval}
					start={intervalStart}
					end={intervalEnd}
					custom={
						settings.intervalStart !== undefined || settings.intervalEnd !== undefined
					}
					epsilonPct={epsilonPct}
					perSecond={perSecond}
					onInterval={setAnalysis}
				/>
				<SensitivitySection
					entries={simulated}
					sensitivity={sensitivity}
					time={sensitivityTime}
					delta={settings.sensitivityDelta}
					endTime={endTime}
					perSecond={perSecond}
					showDeltas={showDeltas}
					onChange={setAnalysis}
				/>
			</>}

			<h2>
				Running {perSecond}
				{comparison.metric === "potency" &&
					!showDeltas &&
					" (no damage model for this job or level)"}
			</h2>
			<LineChart
				ariaLabel={`Running ${perSecond} over time`}
				from={chartFrom}
				to={endTime}
				series={runningSeries}
				windows={windows}
				downtime={scenario.downtime}
				cutoffs={cutoffs}
				format={(v, d) => formatNumber(v, d)}
				formatExact={(v) => formatNumber(v, 1)}
			/>
			<p className="rl-note">Total so far ÷ time since the pull. {overlays}</p>

			<BurstSection
				scenario={scenario}
				derived={derivedWindows}
				windows={windows}
				entries={simulated}
				comparison={comparison}
				unit={unit}
				showDeltas={showDeltas}
				onWindowsChange={(burst) => {
					const next = { ...scenario, updatedAt: new Date().toISOString() };
					if (burst === undefined) delete next.burstWindows;
					else next.burstWindows = burst;
					props.onScenarioChange(next);
				}}
			/>
		</>}
	</section>;
}
