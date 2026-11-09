import React, { useState } from "react";

import { CSV_FORMATS, CsvFormat, CsvFormatKey } from "../export/csv";
import { downloadText } from "./download";

// The CSV format is a per-viewer convenience, shared by both CSV buttons and kept in
// localStorage, not in the workspace.
const FORMAT_KEY = "rotation-lab.csv-format";

function loadFormat(): CsvFormatKey {
	try {
		const stored = window.localStorage.getItem(FORMAT_KEY);
		return stored === "semicolon" ? "semicolon" : "comma";
	} catch {
		return "comma";
	}
}

function storeFormat(key: CsvFormatKey) {
	try {
		window.localStorage.setItem(FORMAT_KEY, key);
	} catch {
		// Not remembered; the choice still applies to this page.
	}
}

// A CSV download button with its format choice. `build` runs on click only.
export function CsvDownload(props: {
	label: string;
	fileName: string;
	build: (format: CsvFormat) => string;
	disabled?: boolean;
}) {
	const [key, setKey] = useState<CsvFormatKey>(loadFormat);
	return <span className="rl-csv-download">
		<button
			disabled={props.disabled}
			onClick={() =>
				// The byte order mark makes Excel read the file as UTF-8 (skill names with ’).
				downloadText(
					props.fileName,
					"﻿" + props.build(CSV_FORMATS[key]),
					"text/csv;charset=utf-8",
				)
			}
		>
			{props.label}
		</button>{" "}
		<select
			aria-label="CSV format"
			value={key}
			onChange={(e) => {
				const next = e.target.value as CsvFormatKey;
				setKey(next);
				storeFormat(next);
			}}
		>
			<option
				value="comma"
				title="Comma between fields, decimal point: international tools and English spreadsheets"
			>
				Comma
			</option>
			<option
				value="semicolon"
				title="Semicolon between fields, decimal comma: German-language Excel"
			>
				Semicolon
			</option>
		</select>
	</span>;
}
