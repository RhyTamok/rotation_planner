import React, { useMemo, useRef, useState } from "react";

import { ShellJob } from "../../Game/Data/Jobs";
import { recommendAfter, Recommendation } from "../recommend/recommender";
import { RotationStep, SimulationOptions } from "../simulation/types";
import { formatNumber } from "./format";
import { TimerChips } from "./RotationTable";
import { actionName, skillIconUrl } from "./SkillPalette";

// Floating panel with the next-action recommendations at the insertion point
// (docs/rulesets/<job>-recommendations.md). It can be dragged by its title bar; the position and
// the list mode are per-viewer conveniences kept in localStorage.

const POSITION_KEY = "rotationLab.recommendations.position";
const MODE_KEY = "rotationLab.recommendations.mode";
const WIDTH = 300;
// Part of the title bar that must stay on screen.
const VISIBLE = 60;

type Mode = "all" | "best";
interface Position {
	x: number;
	y: number;
}

function readStored<T>(key: string, fallback: T, valid: (x: unknown) => x is T): T {
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return fallback;
		const parsed: unknown = JSON.parse(raw);
		return valid(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

function writeStored(key: string, value: unknown) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage may be unavailable (private window); the setting just isn't remembered.
	}
}

const isPosition = (x: unknown): x is Position =>
	typeof x === "object" &&
	x !== null &&
	Number.isFinite((x as Position).x) &&
	Number.isFinite((x as Position).y);
const isMode = (x: unknown): x is Mode => x === "all" || x === "best";

function clamp({ x, y }: Position): Position {
	return {
		x: Math.min(Math.max(x, VISIBLE - WIDTH), window.innerWidth - VISIBLE),
		y: Math.min(Math.max(y, 0), window.innerHeight - 32),
	};
}

// Next to the skill palette, which sits on the right edge.
const defaultPosition = (): Position => ({ x: window.innerWidth - 2 * WIDTH - 40, y: 120 });

export function RecommendationPanel(props: {
	job: ShellJob;
	// The rotation up to the insertion point, as for the palette.
	prefix: RotationStep[];
	options: SimulationOptions;
	countdownExtension?: number;
	// From the rotation document; not editable yet (per-window targets are planned separately).
	targetCount: number;
	onInsert: (step: RotationStep) => void;
}) {
	const { job, prefix, options, countdownExtension, targetCount, onInsert } = props;
	const [mode, setModeState] = useState<Mode>(() => readStored(MODE_KEY, "all", isMode));
	const [position, setPosition] = useState<Position>(() =>
		clamp(readStored(POSITION_KEY, defaultPosition(), isPosition)),
	);
	const drag = useRef<{ dx: number; dy: number } | undefined>(undefined);

	const recommendations = useMemo(() => {
		try {
			return recommendAfter(job, prefix, options, targetCount, countdownExtension);
		} catch {
			// The scenario is invalid mid-edit; the summary reports why.
			return undefined;
		}
	}, [job, prefix, options, targetCount, countdownExtension]);

	const setMode = (next: Mode) => {
		setModeState(next);
		writeStored(MODE_KEY, next);
	};

	const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
		// Only the primary button drags, and not from the controls in the title bar.
		if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, label")) return;
		drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
		e.currentTarget.setPointerCapture(e.pointerId);
		e.preventDefault();
	};
	const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
		if (!drag.current) return;
		setPosition(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
	};
	const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
		if (!drag.current) return;
		drag.current = undefined;
		e.currentTarget.releasePointerCapture(e.pointerId);
		writeStored(POSITION_KEY, position);
	};

	const ranked = recommendations?.ranked ?? [];
	const shown = mode === "best" ? ranked.slice(0, 1) : ranked;
	const entry = (rec: Recommendation, i: number, filtered = false) => <li
		key={`${rec.action}-${i}`}
	>
		<button
			className={filtered ? "rl-unusable" : ""}
			onClick={() => onInsert({ type: "skill", action: rec.action })}
			title={`Insert ${actionName(rec.action)} after the selected row`}
		>
			<img className="rl-icon" src={skillIconUrl(job, rec.shows)} alt="" />
			<span className="rl-recommend-text">
				<span>{actionName(rec.shows)}</span>
				<span className="rl-recommend-reason">
					{mode === "all" && <span className="rl-recommend-rule">{rec.rule}</span>}
					{rec.reason}
				</span>
			</span>
		</button>
	</li>;

	return <aside
		className="rl-recommend"
		aria-label="Recommendations"
		style={{ left: position.x, top: position.y, width: WIDTH }}
	>
		<header
			className="rl-recommend-header"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			title="Drag to move"
		>
			<h2>
				Next
				{recommendations && ` at ${formatNumber(recommendations.time, 2)} s`}
			</h2>
			<div className="rl-recommend-modes" role="group" aria-label="List mode">
				<button aria-pressed={mode === "best"} onClick={() => setMode("best")}>
					Best
				</button>
				<button aria-pressed={mode === "all"} onClick={() => setMode("all")}>
					All
				</button>
			</div>
		</header>
		<div className="rl-recommend-body">
			{recommendations && <div className="rl-recommend-timers" aria-label="Timers">
				<TimerChips timers={recommendations.resources.timers} />
			</div>}
			{!recommendations ? (
				<p className="rl-recommend-empty">No recommendations: the scenario is invalid.</p>
			) : shown.length === 0 ? (
				<p className="rl-recommend-empty">Nothing to recommend here.</p>
			) : (
				<ol className="rl-recommend-list">{shown.map((rec, i) => entry(rec, i))}</ol>
			)}
			{mode === "all" && recommendations && recommendations.filtered.length > 0 && <>
				<h3>Filtered</h3>
				<ol className="rl-recommend-list">
					{recommendations.filtered.map((rec, i) => entry(rec, i, true))}
				</ol>
			</>}
		</div>
	</aside>;
}
