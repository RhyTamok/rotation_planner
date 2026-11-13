import { formatResultLabel } from "../models/Rotation";
import { ActionKey } from "../../Game/Data";
import { BaselineComparison } from "../comparison/baseline";
import { competitiveAt } from "../comparison/competitive";
import { RotationResult, SimulatedAction } from "../simulation/types";

// CSV exports (comparison roadmap M4; spec 2.6): the per-action timeline of one rotation and the
// per-cutoff summary of a comparison. Analysis only, not a reproducibility format. Pure: numbers
// use a fixed number of decimals and an explicit decimal mark, never the browser's locale, so a
// file does not depend on who exported it.

export interface CsvFormat {
	delimiter: "," | ";";
	decimal: "." | ",";
}

// International tools and English spreadsheets, and German-language Excel, which reads a
// semicolon-separated file with decimal commas as numbers (with decimal points, as text or dates).
export const CSV_FORMATS = {
	comma: { delimiter: ",", decimal: "." },
	semicolon: { delimiter: ";", decimal: "," },
} as const satisfies Record<string, CsvFormat>;

export type CsvFormatKey = keyof typeof CSV_FORMATS;

// Decimals per kind of value.
const TIME_DIGITS = 3;
const AMOUNT_DIGITS = 2;
const PERCENT_DIGITS = 4;

type Cell = { text: string } | { number: number | undefined; digits: number } | undefined;

const text = (s: string): Cell => ({ text: s });
const num = (n: number | undefined, digits: number): Cell => ({ number: n, digits });
const flag = (b: boolean | undefined): Cell => (b === undefined ? undefined : text(String(b)));

function formatNumber(n: number | undefined, digits: number, format: CsvFormat): string {
	if (n === undefined || !Number.isFinite(n)) return "";
	let s = n.toFixed(digits);
	// No "-0.00" for what rounds to zero.
	if (Number(s) === 0) s = (0).toFixed(digits);
	return format.decimal === "." ? s : s.replace(".", format.decimal);
}

// Text that a spreadsheet would read as a formula gets a leading apostrophe. Numbers are never
// changed, so a negative difference stays a number.
const FORMULA_START = /^[=+\-@\t\r]/;

function field(cell: Cell, format: CsvFormat): string {
	if (cell === undefined) return "";
	let s = "text" in cell ? cell.text : formatNumber(cell.number, cell.digits, format);
	if ("text" in cell && FORMULA_START.test(s)) s = `'${s}`;
	return s.includes(format.delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// RFC 4180: CRLF line ends, including after the last line.
// Every export ends with a `simulated_with` column naming the ruleset, game patch and engine
// version that produced the numbers, on every row so that it survives sorting and filtering.
function toCsv(header: string[], rows: Cell[][], format: CsvFormat): string {
	const label = text(formatResultLabel());
	return [[...header, "simulated_with"].map(text), ...rows.map((row) => [...row, label])]
		.map((row) => row.map((cell) => field(cell, format)).join(format.delimiter) + "\r\n")
		.join("");
}

// Invalid reasons, broken combos and damage still pending at the end, as one text field. The
// numeric notes (pull hold, GCD delay, ghosting) have their own columns.
function notesOf(action: SimulatedAction): string {
	const notes: string[] = [];
	if (!action.valid) notes.push(...action.invalidReasons);
	for (const combo of action.comboBreaks ?? []) notes.push(`breaks the ${combo}`);
	if ((action.pendingDamage ?? action.pendingPotency) > 0) notes.push("lands after the end");
	return notes.join("; ");
}

// One row per executed action, in the order pressed. `skill_name` is the skill that executed,
// under its displayed name, so the file can be read back by the rotation list import (M8a);
// `pressed` is the button, which differs for combo follow-ups. Times are display seconds from the
// pull (negative before it); press time, not landing time.
export function timelineCsv(
	result: RotationResult,
	nameOf: (action: ActionKey) => string,
	format: CsvFormat,
): string {
	const gauges = result.actions[0]?.resources.gauges.map((g) => g.label) ?? [];
	const header = [
		"step",
		"skill_name",
		"pressed",
		"press_time_s",
		"lock_end_s",
		"type",
		"valid",
		"gcd_delay_s",
		"clipped",
		"pull_hold_s",
		"ghosted_by_s",
		"targets",
		"potency",
		"pending_potency",
		"damage",
		"pending_damage",
		...gauges,
		"notes",
	];
	const rows = result.actions.map((a): Cell[] => [
		num(a.stepIndex + 1, 0),
		text(nameOf(a.executedAction)),
		text(nameOf(a.requestedAction)),
		num(a.startTime, TIME_DIGITS),
		num(a.lockEndTime, TIME_DIGITS),
		text(a.isGCD ? "GCD" : "oGCD"),
		flag(a.valid),
		num(a.gcdDelay, TIME_DIGITS),
		flag(a.gcdDelay === undefined ? undefined : (a.clipped ?? false)),
		num(a.pullHold, TIME_DIGITS),
		num(a.ghostedBy, TIME_DIGITS),
		num(a.targetsHit, 0),
		num(a.appliedPotency, AMOUNT_DIGITS),
		num(a.pendingPotency, AMOUNT_DIGITS),
		num(a.expectedDamage, AMOUNT_DIGITS),
		num(a.pendingDamage, AMOUNT_DIGITS),
		// Gauges are whole numbers; a fractional one would keep its decimals rather than round.
		...gauges.map((label) => {
			const amount = a.resources.gauges.find((g) => g.label === label)?.amount;
			return num(amount, amount !== undefined && Number.isInteger(amount) ? 0 : 3);
		}),
		text(notesOf(a)),
	]);
	return toCsv(header, rows, format);
}

export interface SummaryEntry {
	id: string;
	// "A"
	letter: string;
	rotationName: string;
}

// One row per cutoff and configuration, from the same `compareConfigurations` result as the
// cutoff table, with the same cells hidden: differences without a baseline (`showDeltas`), and
// rank and the threshold with one configuration (`showRank`). Hidden and undefined values are
// empty. Δ% is in percentage points.
export function cutoffSummaryCsv(
	args: {
		comparison: BaselineComparison;
		entries: SummaryEntry[];
		showDeltas: boolean;
		showRank: boolean;
		epsilonPct: number;
	},
	format: CsvFormat,
): string {
	const { comparison, showDeltas, showRank, epsilonPct } = args;
	const potency = comparison.metric === "potency";
	const perSecond = potency ? "pps" : "dps";
	const header = [
		"cutoff_s",
		"configuration",
		"rotation",
		"baseline",
		potency ? "total_potency" : "total_damage",
		perSecond,
		`delta_${perSecond}`,
		"delta_pct",
		"rank",
		"within_epsilon",
		"epsilon_pct",
	];
	const entryOf = new Map(args.entries.map((e) => [e.id, e]));
	const rows: Cell[][] = [];
	for (const table of comparison.cutoffs) {
		const within =
			showRank && table.time > 0
				? competitiveAt(comparison.series, comparison.ids, table.time, epsilonPct)
						.competitive
				: undefined;
		for (const row of table.rows) {
			const entry = entryOf.get(row.id);
			rows.push([
				num(table.time, TIME_DIGITS),
				text(entry?.letter ?? row.id),
				text(entry?.rotationName ?? ""),
				flag(showDeltas ? row.id === comparison.baselineId : undefined),
				num(row.total, AMOUNT_DIGITS),
				num(row.dps, AMOUNT_DIGITS),
				showDeltas ? num(row.deltaDps, AMOUNT_DIGITS) : undefined,
				showDeltas
					? num(
							row.deltaPct === undefined ? undefined : row.deltaPct * 100,
							PERCENT_DIGITS,
						)
					: undefined,
				showRank ? num(row.rank, 0) : undefined,
				flag(within?.includes(row.id)),
				showRank ? num(epsilonPct, 2) : undefined,
			]);
		}
	}
	return toCsv(header, rows, format);
}

// A file name from a user-given name: no characters that file systems reject.
export function csvFileName(name: string, suffix: string): string {
	const base =
		name
			.replace(/[\\/:*?"<>|]+/g, " ")
			.replace(/\s+/g, " ")
			.trim() || "rotation-lab";
	return `${base}-${suffix}.csv`;
}
