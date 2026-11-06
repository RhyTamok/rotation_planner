// Formats in the viewer's locale; empty for undefined.
export function formatNumber(x: number | undefined, digits = 0): string {
	return x === undefined
		? ""
		: x.toLocaleString(undefined, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
			});
}

// With an explicit + or −, except for what rounds to zero. Empty for undefined.
export function formatSigned(x: number | undefined, digits = 1): string {
	return x === undefined
		? ""
		: x.toLocaleString(undefined, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
				signDisplay: "exceptZero",
			});
}

// A fraction from the maths layer (0.05) as signed percentage points (+5.00%). Undefined means the
// baseline's DPS is 0, which has no percentage.
export function formatDeltaPct(fraction: number | undefined): string {
	return fraction === undefined ? "N/A" : `${formatSigned(fraction * 100, 2)}%`;
}
