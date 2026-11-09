// Saves text as a file in the browser's downloads. Kept out of the component files so that Vite's
// Fast Refresh can hot-swap them (a component module must export only components).
export function downloadText(filename: string, text: string, type = "application/json") {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}
