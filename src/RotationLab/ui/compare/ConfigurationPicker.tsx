import React from "react";

import { ComparisonDocument, MAX_CONFIGURATIONS } from "../../models/Comparison";
import { GearSetDocument } from "../../models/GearSet";
import { RotationDocument } from "../../models/Rotation";
import { ConfigEntry } from "./entries";

function gearName(rotation: RotationDocument, gearSets: GearSetDocument[]) {
	return (
		(gearSets.find((g) => g.id === rotation.gearSetId)?.name ?? "job defaults") +
		(rotation.gearOverrides ? " + overrides" : "")
	);
}

// One row per configuration: which rotation, which is the baseline, and its gear.
export function ConfigurationPicker(props: {
	doc: ComparisonDocument;
	entries: ConfigEntry[];
	candidates: RotationDocument[];
	gearSets: GearSetDocument[];
	onRotation: (configId: string, rotationId: string) => void;
	onBaseline: (configId: string) => void;
	onAdd: () => void;
	onRemove: (configId: string) => void;
}) {
	const { doc, entries, candidates, gearSets } = props;
	const comparing = entries.length > 1;
	return <div className="rl-config-list">
		{entries.map((entry) => <div
			key={entry.id}
			className="rl-config-row"
			data-testid="configuration-row"
		>
			<svg className="rl-swatch" width={28} height={6} aria-hidden="true">
				<line
					className={`rl-chart-line ${entry.seriesClass}`}
					x1={0}
					x2={28}
					y1={3}
					y2={3}
				/>
			</svg>
			<label>
				{entry.letter}{" "}
				<select
					aria-label={`Rotation ${entry.letter}`}
					value={entry.rotation?.id ?? ""}
					onChange={(e) => props.onRotation(entry.id, e.target.value)}
				>
					{candidates.map((r) => <option key={r.id} value={r.id}>
						{r.name || "(unnamed)"}
					</option>)}
				</select>
			</label>
			{comparing && <label>
				<input
					type="radio"
					name={`rl-baseline-${doc.id}`}
					aria-label={`Baseline ${entry.letter}`}
					checked={doc.baselineId === entry.id}
					onChange={() => props.onBaseline(entry.id)}
				/>{" "}
				{doc.baselineId === entry.id ? <b>Baseline</b> : "Baseline"}
			</label>}
			{entry.rotation && <span className="rl-note">
				gear: {gearName(entry.rotation, gearSets)}
			</span>}
			{comparing && <button
				className="rl-remove"
				aria-label={`Remove configuration ${entry.letter}`}
				onClick={() => props.onRemove(entry.id)}
			>
				×
			</button>}
		</div>)}
		{entries.length < MAX_CONFIGURATIONS && <div className="rl-compare-controls">
			<button onClick={props.onAdd}>Add configuration</button>
			{!comparing && <span className="rl-note">
				Differences from a baseline, ranks and the difference chart need a second
				configuration. To compare gear, duplicate the rotation and change the copy's gear.
			</span>}
		</div>}
	</div>;
}
