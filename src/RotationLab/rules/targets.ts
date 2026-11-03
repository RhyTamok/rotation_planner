import { MAX_ABILITY_TARGETS } from "../../Controller/Common";
import { TargetRange } from "../simulation/types";

// Target ranges of a rotation (handoff section 6, "Targets"):
// - A range holds the total number of enemies, the main target included, from `start`
//   (inclusive) to `end` (exclusive), in seconds from the pull. Outside every range only the main
//   target is present.
// - Ranges must not overlap. Overlapping or empty ranges are reported per row, but the rotation
//   keeps simulating: the range that starts first wins the overlap, and empty ones are ignored.
// - An action can hit an extra enemy only if it was present when the button was pressed and is
//   still present when the damage lands, so the count is the lowest one between the two.

// Ranges as the simulation uses them: sorted, without overlaps, without empty ranges.
export function effectiveRanges(ranges: readonly TargetRange[]): TargetRange[] {
	const sorted = ranges
		.filter((r) => r.end > r.start)
		.map((r) => ({
			...r,
			enemies: Math.min(MAX_ABILITY_TARGETS, Math.max(1, Math.floor(r.enemies))),
		}))
		.sort((a, b) => a.start - b.start);
	const out: TargetRange[] = [];
	for (const r of sorted) {
		const previousEnd = out.length > 0 ? out[out.length - 1].end : -Infinity;
		const start = Math.max(r.start, previousEnd);
		if (r.end > start) out.push({ ...r, start });
	}
	return out;
}

// Enemies present at `time`, for ranges from effectiveRanges.
export function enemiesAt(ranges: readonly TargetRange[], time: number): number {
	return ranges.find((r) => time >= r.start && time < r.end)?.enemies ?? 1;
}

// The lowest number of enemies present at any moment from `from` to `to` (both included), for
// ranges from effectiveRanges.
export function enemiesThroughout(
	ranges: readonly TargetRange[],
	from: number,
	to: number,
): number {
	const times = [from, to];
	for (const r of ranges) {
		for (const t of [r.start, r.end]) {
			if (t > from && t <= to) times.push(t);
		}
	}
	return Math.min(...times.map((t) => enemiesAt(ranges, t)));
}

// The target list (1-indexed enemy numbers) for an action pressed at `press` whose damage lands at
// `resolve`.
export function targetListFor(ranges: readonly TargetRange[], press: number, resolve: number) {
	const count = enemiesThroughout(ranges, press, Math.max(press, resolve));
	return Array.from({ length: count }, (_, i) => i + 1);
}

// One message per row with a problem (undefined for rows without one), for the targets table.
export function targetRangeProblems(ranges: readonly TargetRange[]): (string | undefined)[] {
	return ranges.map((r, i) => {
		if (!(r.end > r.start)) return "End must be after start; this range is ignored";
		const clashes = ranges
			.map((other, j) => ({ other, j }))
			.filter(
				({ other, j }) =>
					j !== i &&
					other.end > other.start &&
					r.start < other.end &&
					other.start < r.end,
			)
			.map(({ j }) => j + 1);
		return clashes.length > 0
			? `Overlaps row ${clashes.join(", ")}; the range that starts first counts there`
			: undefined;
	});
}
