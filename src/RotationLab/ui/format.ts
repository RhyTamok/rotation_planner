// Formats in the viewer's locale; empty for undefined.
export function formatNumber(x: number | undefined, digits = 0): string {
	return x === undefined
		? ""
		: x.toLocaleString(undefined, {
				minimumFractionDigits: digits,
				maximumFractionDigits: digits,
			});
}
