import React, { useEffect, useMemo, useRef, useState } from "react";

import { LevelSync } from "../../Game/Common";
import { makeDefaultConfig } from "../../Game/GameConfig";
import {
	buildRows,
	duplicateEntry,
	insertSteps,
	moveEntry,
	moveEntryBefore,
	neighbourAfterRemoval,
	removeEntry,
	updateStep,
} from "../editor/rotationEdits";
import { createRotation, newId, RotationDocument } from "../models/Rotation";
import { createScenario, ScenarioDocument, scenarioToOptions } from "../models/Scenario";
import { parseRotationDocument, parseScenarioDocument } from "../models/validation";
import { SimulationCache } from "../simulation/SimulationManager";
import { PartyBuffWindow, RotationStep } from "../simulation/types";
import {
	KeyValueStorage,
	loadWorkspace,
	parseWorkspace,
	saveWorkspace,
	serializeWorkspace,
	Workspace,
} from "../storage/WorkspaceStore";
import { formatNumber, RotationTable } from "./RotationTable";
import { ScenarioPanel } from "./ScenarioPanel";
import { SkillPalette } from "./SkillPalette";

// Stable empty list, so the table's memoized buff lanes are not rebuilt on every render.
const NO_BUFFS: Required<PartyBuffWindow>[] = [];

const JOB = "VPR" as const;

function newRotation(name = "New rotation"): RotationDocument {
	return createRotation({ name, job: JOB, steps: [] });
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
	];
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
	const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
	const [messages, setMessages] = useState<string[]>(initial.errors);
	const [rotationId, setRotationId] = useState(initial.workspace.rotations[0].id);
	const [scenarioId, setScenarioId] = useState(initial.workspace.scenarios[0].id);
	const [selectedId, setSelectedId] = useState<string>();
	const cache = useMemo(() => new SimulationCache(), []);
	const fileInput = useRef<HTMLInputElement>(null);

	const rotation = workspace.rotations.find((r) => r.id === rotationId) ?? workspace.rotations[0];
	const scenario = workspace.scenarios.find((s) => s.id === scenarioId) ?? workspace.scenarios[0];

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
		const scenarioCheck = parseScenarioDocument(scenario);
		if (!scenarioCheck.ok) return { error: scenarioCheck.errors.join("; ") };
		try {
			return { sim: cache.get(rotation, scenario) };
		} catch (e) {
			return { error: (e as Error).message };
		}
	}, [cache, rotation, scenario]);
	const result = simulation.sim?.result;
	const rows = useMemo(() => buildRows(rotation, result), [rotation, result]);
	// The palette shows the hotbar at the insertion point: after the selected row, or at the end.
	const prefix = useMemo(() => {
		const index = rotation.entries.findIndex((e) => e.id === selectedId);
		const end = index < 0 ? rotation.entries.length : index + 1;
		return rotation.entries.slice(0, end).map((e) => e.step);
	}, [rotation, selectedId]);
	const scenarioOptions = useMemo(() => scenarioToOptions(scenario), [scenario]);

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

	const insert = (step: RotationStep) => {
		const edit = insertSteps(rotation, [step], selectedId);
		replaceRotation(edit.rotation);
		setSelectedId(edit.insertedIds[0]);
	};
	const remove = (id: string) => {
		if (id === selectedId) setSelectedId(neighbourAfterRemoval(rotation, id));
		replaceRotation(removeEntry(rotation, id));
	};
	const removeSelected = () => {
		if (selectedId) remove(selectedId);
	};
	const duplicateSelected = () => {
		if (!selectedId) return;
		const edit = duplicateEntry(rotation, selectedId);
		replaceRotation(edit.rotation);
		setSelectedId(edit.insertedIds[0]);
	};

	const onTableKeyDown = (e: React.KeyboardEvent) => {
		if ((e.target as HTMLElement).tagName === "INPUT") return;
		const index = rotation.entries.findIndex((x) => x.id === selectedId);
		if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			const delta = e.key === "ArrowUp" ? -1 : 1;
			if (e.altKey && selectedId) {
				replaceRotation(moveEntry(rotation, selectedId, delta));
			} else {
				const target =
					rotation.entries[
						Math.max(0, Math.min(rotation.entries.length - 1, index + delta))
					];
				if (target) setSelectedId(target.id);
			}
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			removeSelected();
		} else if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			duplicateSelected();
		} else if (e.key === "Escape") {
			setSelectedId(undefined);
		}
	};

	const addRotation = (doc: RotationDocument) => {
		setWorkspace((ws) => ({ ...ws, rotations: [...ws.rotations, doc] }));
		setRotationId(doc.id);
		setSelectedId(undefined);
	};
	const deleteRotation = () => {
		if (!window.confirm(`Delete "${rotation.name}"?`)) return;
		const remaining = workspace.rotations.filter((r) => r.id !== rotation.id);
		const rotations = remaining.length > 0 ? remaining : [newRotation()];
		setWorkspace((ws) => ({ ...ws, rotations }));
		setRotationId(rotations[0].id);
		setSelectedId(undefined);
	};

	const importFile = async (file: File) => {
		const { workspace: imported, errors } = parseWorkspace(await file.text());
		// Never overwrite existing documents: clashing ids get fresh ones.
		const rotationIds = new Set(workspace.rotations.map((r) => r.id));
		const scenarioIds = new Set(workspace.scenarios.map((s) => s.id));
		setWorkspace((ws) => ({
			...ws,
			rotations: [
				...ws.rotations,
				...imported.rotations.map((r) =>
					rotationIds.has(r.id) ? { ...r, id: newId() } : r,
				),
			],
			scenarios: [
				...ws.scenarios,
				...imported.scenarios.map((s) =>
					scenarioIds.has(s.id) ? { ...s, id: newId() } : s,
				),
			],
		}));
		setMessages([
			`Imported ${imported.rotations.length} rotation(s) and ${imported.scenarios.length} scenario(s) from ${file.name}.`,
			...errors.map((e) => `Import: ${e}`),
		]);
	};

	const level = (scenario.stats.level ?? makeDefaultConfig(JOB).level) as LevelSync;
	const damage = result?.damage;

	return <div className="rl-app">
		<header className="rl-top">
			<h1>Rotation Lab</h1>
			<select
				aria-label="Rotation"
				value={rotation.id}
				onChange={(e) => {
					setRotationId(e.target.value);
					setSelectedId(undefined);
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
			<button onClick={() => addRotation(newRotation())}>New</button>
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
					onChange={(e) => setScenarioId(e.target.value)}
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
					setWorkspace((ws) => ({ ...ws, scenarios: [...ws.scenarios, doc] }));
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

		<ScenarioPanel job={JOB} scenario={scenario} onChange={replaceScenario} />

		<RotationTable
			job={JOB}
			rows={rows}
			selectedId={selectedId}
			onSelect={setSelectedId}
			onUpdateStep={(id, step) => replaceRotation(updateStep(rotation, id, step))}
			onRemove={remove}
			partyBuffs={result?.encounter.partyBuffs ?? NO_BUFFS}
			onMove={(id, beforeIndex) => {
				replaceRotation(moveEntryBefore(rotation, id, beforeIndex));
				setSelectedId(id);
			}}
			onKeyDown={onTableKeyDown}
		/>

		<SkillPalette
			job={JOB}
			level={level}
			prefix={prefix}
			options={scenarioOptions}
			countdownExtension={result?.countdownExtension}
			onInsert={insert}
		/>

		<footer className="rl-footer">
			Keys: ↑/↓ select · Alt+↑/↓ move · Del remove · Ctrl+D duplicate · Esc deselect. Built on{" "}
			<a href="https://github.com/xivintheshell/xivintheshell">XIV in the Shell</a> (MIT
			License). <a href="/">Open the original app</a>
		</footer>
	</div>;
}
