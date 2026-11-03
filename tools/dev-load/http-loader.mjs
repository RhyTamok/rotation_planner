// Node module hooks that resolve and load modules over HTTP from a Vite dev server, so the
// browser's native ES module evaluation order can be reproduced in Node.
export async function resolve(specifier, context, next) {
	const parent = context.parentURL;
	if (parent?.startsWith("http://") && (specifier.startsWith("/") || specifier.startsWith("."))) {
		return { url: new URL(specifier, parent).href, shortCircuit: true };
	}
	if (specifier.startsWith("http://")) {
		return { url: specifier, shortCircuit: true };
	}
	return next(specifier, context);
}

export async function load(url, context, next) {
	if (url.startsWith("http://")) {
		const res = await fetch(url, { headers: { accept: "*/*", "sec-fetch-dest": "script" } });
		if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
		return { format: "module", source: await res.text(), shortCircuit: true };
	}
	return next(url, context);
}
