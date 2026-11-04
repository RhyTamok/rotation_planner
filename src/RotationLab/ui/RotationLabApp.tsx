import React, { useEffect, useMemo, useRef, useState } from "react";

import { LevelSync } from "../../Game/Common";
import { makeDefaultConfig } from "../../Game/GameConfig";
import { parseSteps, serializeSteps } from "../editor/clipboard";
import { createHistory, record, redo, undo } from "../editor/history";
import {
	buildRows,
	copySteps,
	insertSteps,
	moveBlock,
	moveEntryBefore,
	neighbourAfterRemovalOf,
	rangeIds,
	removeEntries,
	updateStep,
} from "../editor/rotationEdits";
import {
	ComparisonDocument,
	createComparison,
	editComparison,
	removeRotationFromComparisons,
} from "../models/Comparison";
import { createRotation, newId, RotationDocument } from "../models/Rotation";
import { createScenario, ScenarioDocument, scenarioToOptions } from "../models/Scenario";
import {
	parseComparisonDocument,
	parseGearSetDocument,
	parseRotationDocument,
	parseScenarioDocument,
} from "../models/validation";
import { resolveGear } from "../models/GearSet";
import { GearPanel } from "./GearPanel";
import { TargetsPanel } from "./TargetsPanel";
import { SimulationCache } from "../simulation/SimulationManager";
import { PartyBuffWindow, RotationStep } from "../simulation/types";
import {
	KeyValueStorage,
	loadWorkspace,
	mergeWorkspace,
	parseWorkspace,
	saveWorkspace,
	serializeWorkspace,
	Workspace,
} from "../storage/WorkspaceStore";
import { formatNumber, RotationTable } from "./RotationTable";
import { ScenarioPanel } from "./ScenarioPanel";
import { SkillPalette } from "./SkillPalette";
import { RecommendationPanel } from "./RecommendationPanel";
import { isRecommendationSupported } from "../recommend/recommender";
import { ComparisonView } from "./ComparisonView";

// Stable empty list, so the table's memoized buff lanes are not rebuilt on every render.
const NO_BUFFS: Required<PartyBuffWindow>[] = [];

const JOB = "VPR" as const;

function newRotation(name = "New rotation", gearSetId?: string): RotationDocument {
	return createRotation({ name, job: JOB, steps: [], gearSetId });
}

// Loads the stored workspace, guaranteeing at least one rotation and one scenario.
function initialState(storage: KeyValueStorage) {
	const { workspace, errors } = loadWorkspace(storage);
	return {
		workspace: {
			...workspace,
			rotations: workspace.rotations.length > 0 ? workspace.rotations : [newRotation()],
			scenarios:
				workspace.scenarios.length > 0
					? workspace.scenarios
					: [createScenario({ name: "Default" })],
		},
		errors,
	};
}

// Problems that would make a document unloadable; such workspaces are not saved.
function validationProblems(workspace: Workspace): string[] {
	return [
		...workspace.rotations.flatMap((r) => {
			const parsed = parseRotationDocument(r);
			return parsed.ok ? [] : [`${r.name}: ${parsed.errors.join("; ")}`];
		}),
		...workspace.scenarios.flatMap((s) => {
			const parsed = parseScenarioDocument(s);
			return parsed.ok ? [] : [`${s.name}: ${parsed.errors.join("; ")}`];
		}),
		...workspace.gearSets.flatMap((g) => {
			const parsed = parseGearSetDocument(g);
			return parsed.ok ? [] : [`${g.name}: ${parsed.errors.join("; ")}`];
		}),
		...workspace.comparisons.flatMap((c) => {
			const parsed = parseComparisonDocument(c, workspace);
			return parsed.ok ? [] : [`${c.name}: ${parsed.errors.join("; ")}`];
		}),
	];
}

// Stores a comparison, adding it if it was still the unsaved default.
function storeComparison(ws: Workspace, doc: ComparisonDocument): Workspace {
	return {
		...ws,
		comparisons: ws.comparisons.some((c) => c.id === doc.id)
			? ws.comparisons.map((c) => (c.id === doc.id ? doc : c))
			: [...ws.comparisons, doc],
	};
}

function downloadText(filename: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function Stat(props: { label: string; value: string }) {
	return <div>
		<div className="rl-stat-label">{props.label}</div>
		<div className="rl-stat-value">{props.value}</div>
	</div>;
}

export function RotationLabApp(props: { storage?: KeyValueStorage }) {
	const storage = props.storage ?? localStorage;
	const [initial] = useState(() => initialState(storage));
	const [history, setHistory] = useState(() => createHistory<Workspace>(initial.workspace));
	const workspace = history.present;
	// Every workspace change is undoable. Edits typed into the same text or number field merge
	// into one step; clicks and other controls each make their own.
	const setWorkspace = (update: Workspace | ((ws: Workspace) => Workspace)) => {
		const active = document.activeElement;
		const group =
			active instanceof HTMLInputElement && active.type !== "checkbox" ? active : undefined;
		setHistory((h) =>
			record(h, typeof update === "function" ? update(h.present) : update, group),
		);
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			// Inside text fields the browser's own undo applies.
			const tag = (e.target as HTMLElement | null)?.tagName;
			if (tag === "INPUT" || tag === "TEXTAREA") return;
			const key = e.key.toLowerCase();
			if (key === "z" && !e.shiftKey) {
				e.preventDefault();
				setHistory(undo);
			} else if (key === "y" || (key === "z" && e.shiftKey)) {
				e.preventDefault();
				setHistory(redo);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	const [messages, setMessages] = useState<string[]>(initial.errors);
	const [rotationId, setRotationId] = useState(initial.workspace.rotations[0].id);
	const [scenarioId, setScenarioId] = useState(initial.workspace.scenarios[0].id);
	const [comparisonId, setComparisonId] = useState<string>();
	// The selection is the range from `anchorId` (when extended with Shift) to `selectedId`, the
	// row that moves with the arrow keys.
	const [selectedId, setSelectedId] = useState<string>();
	const [anchorId, setAnchorId] = useState<string>();
	const [mode, setMode] = useState<"edit" | "compare">("edit");
	const cache = useMemo(() => new SimulationCache(), []);
	const fileInput = useRef<HTMLInputElement>(null);

	const rotation = workspace.rotations.find((r) => r.id === rotationId) ?? workspace.rotations[0];
	const selectedScenario =
		workspace.scenarios.find((s) => s.id === scenarioId) ?? workspace.scenarios[0];

	// Until a comparison is first edited there is nothing to store: the view shows this default, the
	// current rotation against the next one of its job. Clicking Compare therefore adds no undo step.
	const otherRotationId =
		workspace.rotations.find((r) => r.id !== rotation.id && r.job === rotation.job)?.id ??
		rotation.id;
	const defaultComparison = useMemo(
		() =>
			createComparison({
				job: rotation.job,
				scenarioId: selectedScenario.id,
				rotationIds: [rotation.id, otherRotationId],
			}),
		[rotation.job, rotation.id, otherRotationId, selectedScenario.id],
	);
	const comparison =
		workspace.comparisons.find((c) => c.id === comparisonId) ??
		workspace.comparisons[0] ??
		defaultComparison;
	// In Compare the scenario panel and summary show the comparison's own scenario.
	const scenario =
		(mode === "compare" && workspace.scenarios.find((s) => s.id === comparison.scenarioId)) ||
		selectedScenario;

	const gear = useMemo(
		() => resolveGear(rotation, workspace.gearSets),
		[rotation, workspace.gearSets],
	);
	const problems = useMemo(() => validationProblems(workspace), [workspace]);
	useEffect(() => {
		if (problems.length > 0) return;
		try {
			saveWorkspace(workspace, storage);
		} catch (e) {
			setMessages((m) => [...m, `Could not save: ${(e as Error).message}`]);
		}
	}, [workspace, problems, storage]);

	const simulation = useMemo(() => {
		// Burst windows are not a simulation input; a half-edited one must not stop the simulation.
		const scenarioCheck = parseScenarioDocument({ ...scenario, burstWindows: undefined });
		if (!scenarioCheck.ok) return { error: scenarioCheck.errors.join("; ") };
		try {
			return { sim: cache.get(rotation, scenario, gear) };
		} catch (e) {
			return { error: (e as Error).message };
		}
	}, [cache, rotation, scenario, gear]);
	const result = simulation.sim?.result;
	const rows = useMemo(() => buildRows(rotation, result), [rotation, result]);
	const selection = useMemo(
		() => rangeIds(rotation, anchorId ?? selectedId, selectedId),
		[rotation, anchorId, selectedId],
	);
	// New steps go after the last selected row, or at the end.
	const insertAfter = selection[selection.length - 1];
	// The palette shows the hotbar at that insertion point.
	const prefix = useMemo(() => {
		const index = rotation.entries.findIndex((e) => e.id === insertAfter);
		const end = index < 0 ? rotation.entries.length : index + 1;
		return rotation.entries.slice(0, end).map((e) => e.step);
	}, [rotation, insertAfter]);
	// Scenario, gear and this rotation's targets, for the palette and the recommendations.
	const rotationTargets = rotation.targets;
	const scenarioOptions = useMemo(
		() => ({ ...scenarioToOptions(scenario, gear), targets: rotationTargets }),
		[scenario, gear, rotationTargets],
	);

	const replaceRotation = (next: RotationDocument) =>
		setWorkspace((ws) => ({
			...ws,
			rotations: ws.rotations.map((r) => (r.id === next.id ? next : r)),
		}));
	const replaceScenario = (next: ScenarioDocument) =>
		setWorkspace((ws) => ({
			...ws,
			scenarios: ws.scenarios.map((s) => (s.id === next.id ? next : s)),
		}));

	const replaceComparison = (next: ComparisonDocument) =>
		setWorkspace((ws) => storeComparison(ws, next));
	// In Compare, choosing a scenario also changes the one the comparison is stored with.
	const selectScenario = (id: string) => {
		setScenarioId(id);
		if (mode === "compare") replaceComparison(editComparison(comparison, { scenarioId: id }));
	};

	// Selects one row, or with `extend` grows the selection from its anchor to `id`.
	const select = (id: string | undefined, extend = false) => {
		setAnchorId(extend && id && selectedId ? (anchorId ?? selectedId) : undefined);
		setSelectedId(id);
	};
	const selectRange = (ids: string[]) => {
		setAnchorId(ids[0]);
		setSelectedId(ids[ids.length - 1]);
	};

	const insertBlock = (steps: RotationStep[]) => {
		const edit = insertSteps(rotation, steps, insertAfter);
		replaceRotation(edit.rotation);
		selectRange(edit.insertedIds);
	};
	const insert = (step: RotationStep) => insertBlock([step]);
	const removeIds = (ids: string[]) => {
		if (ids.length === 0) return;
		if (ids.includes(selectedId ?? "")) select(neighbourAfterRemovalOf(rotation, ids));
		replaceRotation(removeEntries(rotation, ids));
	};
	// The × button removes its own row, or the whole selection when that row is part of it.
	const remove = (id: string) => removeIds(selection.includes(id) ? selection : [id]);
	const duplicateSelected = () => {
		if (selection.length === 0) return;
		const edit = insertSteps(rotation, copySteps(rotation, selection), insertAfter);
		replaceRotation(edit.rotation);
		selectRange(edit.insertedIds);
	};

	// Copy, cut and paste use the system clipboard (see editor/clipboard.ts).
	// Clipboard text for the selected steps; the table writes it to the clipboard.
	const copyText = (cut: boolean) => {
		if (selection.length === 0) return undefined;
		const text = serializeSteps(JOB, copySteps(rotation, selection));
		if (cut) removeIds(selection);
		return text;
	};
	const pasteText = (text: string) => {
		const steps = parseSteps(text, JOB);
		if (steps) insertBlock(steps);
		return steps !== undefined;
	};

	const onTableKeyDown = (e: React.KeyboardEvent) => {
		if ((e.target as HTMLElement).tagName === "INPUT") return;
		const index = rotation.entries.findIndex((x) => x.id === selectedId);
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			const delta = e.key === "ArrowUp" ? -1 : 1;
			if (e.altKey) {
				replaceRotation(moveBlock(rotation, selection, delta));
			} else {
				const target =
					rotation.entries[
						Math.max(0, Math.min(rotation.entries.length - 1, index + delta))
					];
				if (target) select(target.id, e.shiftKey);
			}
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			removeIds(selection);
		} else if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			duplicateSelected();
		} else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (rotation.entries.length > 0) selectRange(rotation.entries.map((x) => x.id));
		} else if (e.key === "Escape") {
			select(undefined);
		}
	};

	const addRotation = (doc: RotationDocument) => {
		setWorkspace((ws) => ({ ...ws, rotations: [...ws.rotations, doc] }));
		setRotationId(doc.id);
		select(undefined);
	};
	const deleteRotation = () => {
		const comparisons = removeRotationFromComparisons(workspace.comparisons, rotation.id);
		const dropped = workspace.comparisons.length - comparisons.length;
		const warning =
			dropped > 0
				? ` This also deletes ${dropped} comparison(s) that would have fewer than two configurations left.`
				: "";
		if (!window.confirm(`Delete "${rotation.name}"?${warning}`)) return;
		const remaining = workspace.rotations.filter((r) => r.id !== rotation.id);
		const rotations = remaining.length > 0 ? remaining : [newRotation()];
		setWorkspace((ws) => ({ ...ws, rotations, comparisons }));
		setRotationId(rotations[0].id);
		select(undefined);
	};

	const importFile = async (file: File) => {
		const { workspace: imported, errors } = parseWorkspace(await file.text());
		setWorkspace((ws) => mergeWorkspace(ws, imported));
		setMessages([
			`Imported ${imported.rotations.length} rotation(s), ${imported.scenarios.length} scenario(s) and ${imported.comparisons.length} comparison(s) from ${file.name}.`,
			...errors.map((e) => `Import: ${e}`),
		]);
	};

	const level = (scenario.stats.level ?? makeDefaultConfig(JOB).level) as LevelSync;
	const damage = result?.damage;

	return <div className="rl-app">
		<header className="rl-top">
			<h1>Rotation Lab</h1>
			<div className="rl-modes" role="group" aria-label="View">
				<button aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
					Edit
				</button>
				<button aria-pressed={mode === "compare"} onClick={() => setMode("compare")}>
					Compare
				</button>
			</div>
			<button
				disabled={history.past.length === 0}
				onClick={() => setHistory(undo)}
				title="Undo (Ctrl+Z)"
			>
				Undo
			</button>
			<button
				disabled={history.future.length === 0}
				onClick={() => setHistory(redo)}
				title="Redo (Ctrl+Y)"
			>
				Redo
			</button>
			<select
				aria-label="Rotation"
				value={rotation.id}
				onChange={(e) => {
					setRotationId(e.target.value);
					select(undefined);
				}}
			>
				{workspace.rotations.map((r) => <option key={r.id} value={r.id}>
					{r.name || "(unnamed)"}
				</option>)}
			</select>
			<input
				aria-label="Rotation name"
				value={rotation.name}
				onChange={(e) =>
					replaceRotation({
						...rotation,
						name: e.target.value,
						updatedAt: new Date().toISOString(),
					})
				}
			/>
			<button onClick={() => addRotation(newRotation(undefined, rotation.gearSetId))}>
				New
			</button>
			<button
				onClick={() =>
					addRotation({
						...structuredClone(rotation),
						id: newId(),
						name: `${rotation.name} (copy)`,
						updatedAt: new Date().toISOString(),
					})
				}
			>
				Duplicate
			</button>
			<button onClick={deleteRotation}>Delete</button>
			<span style={{ flex: 1 }} />
			<label>
				Scenario{" "}
				<select
					aria-label="Scenario"
					value={scenario.id}
					onChange={(e) => selectScenario(e.target.value)}
				>
					{workspace.scenarios.map((s) => <option key={s.id} value={s.id}>
						{s.name || "(unnamed)"}
					</option>)}
				</select>
			</label>
			<button
				onClick={() => {
					const doc = {
						...structuredClone(scenario),
						id: newId(),
						name: `${scenario.name} (copy)`,
					};
					// One undo step, so the comparison never points at a scenario undo has removed.
					setWorkspace((ws) => {
						const next = { ...ws, scenarios: [...ws.scenarios, doc] };
						return mode === "compare"
							? storeComparison(
									next,
									editComparison(comparison, { scenarioId: doc.id }),
								)
							: next;
					});
					setScenarioId(doc.id);
				}}
			>
				Copy scenario
			</button>
			<button
				onClick={() =>
					downloadText("rotation-lab-workspace.json", serializeWorkspace(workspace))
				}
			>
				Export
			</button>
			<input
				ref={fileInput}
				type="file"
				accept="application/json,.json"
				aria-label="Import file"
				style={{ display: "none" }}
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (file) void importFile(file);
					e.target.value = "";
				}}
			/>
			<button onClick={() => fileInput.current?.click()}>Import</button>
		</header>

		<section className="rl-summary" aria-label="Summary">
			<Stat label="Expected damage" value={formatNumber(damage?.expectedDamage)} />
			<Stat label="DPS" value={formatNumber(damage?.expectedDps, 1)} />
			<Stat label="Potency" value={formatNumber(result?.totals.appliedPotency)} />
			<Stat label="Auto-attacks" value={formatNumber(damage?.autoAttackDamage)} />
			<Stat label="Pending" value={formatNumber(damage?.pendingDamage)} />
			<Stat label="GCDs" value={formatNumber(result?.totals.gcdCount)} />
			<Stat label="End time" value={formatNumber(result?.endTime, 2)} />
			<Stat
				label="Status"
				value={result === undefined ? "—" : result.valid ? "Valid" : "Has invalid steps"}
			/>
			{simulation.error && <div className="rl-banner">
				Cannot simulate: {simulation.error}
			</div>}
			{result?.countdownExtension !== undefined && <div className="rl-banner">
				The first hit landed {formatNumber(result.countdownExtension, 2)} s after the
				countdown ended. The pull is defined by the first hit, so the countdown was
				lengthened and earlier actions moved earlier by that much.
			</div>}
			{simulation.sim?.rulesetMismatch && <div className="rl-banner">
				Saved for ruleset {simulation.sim.rulesetMismatch.saved.version}; simulated with{" "}
				{simulation.sim.rulesetMismatch.current.version}.
			</div>}
			{problems.length > 0 && <div className="rl-banner">
				Changes not saved until fixed: {problems.join(" | ")}
			</div>}
			{messages.map((m, i) => <div className="rl-banner" key={i}>
				{m}{" "}
				<button onClick={() => setMessages((ms) => ms.filter((_, j) => j !== i))}>
					Dismiss
				</button>
			</div>)}
		</section>

		<ScenarioPanel
			job={JOB}
			scenario={scenario}
			onChange={replaceScenario}
			gearPanel={
				<GearPanel
					job={JOB}
					level={level}
					rotation={rotation}
					gearSets={workspace.gearSets}
					onRotationChange={replaceRotation}
					onGearSetsChange={(gearSets) => setWorkspace((ws) => ({ ...ws, gearSets }))}
				/>
			}
			targetsPanel={
				<TargetsPanel
					rotation={rotation}
					rotations={workspace.rotations}
					onRotationChange={replaceRotation}
				/>
			}
		/>

		{mode === "compare" ? (
			simulation.error ? (
				<section className="rl-compare">
					<div className="rl-banner">Cannot compare: {simulation.error}</div>
				</section>
			) : (
				<ComparisonView
					rotations={workspace.rotations}
					scenario={scenario}
					cache={cache}
					comparison={comparison}
					comparisons={workspace.comparisons}
					onSelectComparison={setComparisonId}
					onComparisonChange={replaceComparison}
					onScenarioChange={replaceScenario}
					gearSets={workspace.gearSets}
				/>
			)
		) : (
			<>
				<RotationTable
					job={JOB}
					rows={rows}
					selectedId={selectedId}
					selection={selection}
					onSelect={select}
					onUpdateStep={(id, step) => replaceRotation(updateStep(rotation, id, step))}
					onRemove={remove}
					partyBuffs={result?.encounter.partyBuffs ?? NO_BUFFS}
					onMove={(id, beforeIndex) => {
						replaceRotation(moveEntryBefore(rotation, id, beforeIndex));
						select(id);
					}}
					onKeyDown={onTableKeyDown}
					copyText={copyText}
					pasteText={pasteText}
				/>

				<SkillPalette
					job={JOB}
					level={level}
					prefix={prefix}
					options={scenarioOptions}
					countdownExtension={result?.countdownExtension}
					onInsert={insert}
				/>

				{isRecommendationSupported(JOB) && <RecommendationPanel
					job={JOB}
					prefix={prefix}
					options={scenarioOptions}
					countdownExtension={result?.countdownExtension}
					onInsert={insert}
				/>}
			</>
		)}

		<footer className="rl-footer">
			Keys: ↑/↓ select (Shift extends, Ctrl+A all) · Alt+↑/↓ move · Del remove · Ctrl+D
			duplicate · Ctrl+C/X/V copy, cut, paste · Ctrl+Z/Y undo, redo · Esc deselect. Built on{" "}
			<a href="https://github.com/xivintheshell/xivintheshell">XIV in the Shell</a> (MIT
			License). <a href="/">Open the original app</a>
		</footer>
	</div>;
}
