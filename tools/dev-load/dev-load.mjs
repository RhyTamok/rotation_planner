// Loads a page entry module from a running Vite dev server in Node with a jsdom DOM.
// Usage: node dev-load.mjs <projectDir> <devServerOrigin> <entryPath>
import { register, createRequire } from "node:module";
import path from "node:path";

const [projectDir, origin, entryPath] = process.argv.slice(2);
register(new URL("./http-loader.mjs", import.meta.url));
const require = createRequire(path.join(projectDir, "package.json"));
const { JSDOM } = require("jsdom");

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
	url: origin + "/rotation-lab.html",
	pretendToBeVisual: true,
});
const g = globalThis;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (!(key in g)) {
		try {
			g[key] = dom.window[key];
		} catch {}
	}
}
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
g.location = dom.window.location;
g.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.HTMLCanvasElement.prototype.getContext = () => null;
dom.window.URL.createObjectURL = () => "blob:stub";

const errors = [];
process.on("uncaughtException", (e) => errors.push(e));
try {
	// Same preamble Vite injects into the HTML for @vitejs/plugin-react.
	const RefreshRuntime = (await import(origin + "/@react-refresh")).default;
	RefreshRuntime.injectIntoGlobalHook(dom.window);
	dom.window.$RefreshReg$ = () => {};
	dom.window.$RefreshSig$ = () => (type) => type;
	dom.window.__vite_plugin_react_preamble_installed__ = true;
	await import(origin + entryPath);
	await new Promise((r) => setTimeout(r, 1000));
} catch (e) {
	errors.push(e);
}
const root = dom.window.document.getElementById("root");
console.log(
	"errors:",
	errors.length
		? errors.map((e) => String(e?.stack ?? e).split("\n").slice(0, 3).join(" | "))
		: "none",
);
console.log("rendered:", JSON.stringify((root?.textContent ?? "").slice(0, 120)));
process.exit(0);
