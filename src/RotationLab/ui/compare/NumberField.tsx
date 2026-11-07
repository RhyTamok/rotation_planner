import React, { useState } from "react";

// Simulated times carry float noise (128.36699999999988), and a field can show one by default. This
// only rounds the text: the value stays exact unless the user types a new one.
const displayed = (value: number) => String(Math.round(value * 1000) / 1000);

// A number input that can be cleared and retyped freely; only values passing `valid` are committed,
// so a half-typed number never reaches the document.
export function NumberField(props: {
	label: string;
	value: number;
	onCommit: (value: number) => void;
	valid?: (value: number) => boolean;
	min?: number;
	max?: number;
	step?: number;
}) {
	const [text, setText] = useState(displayed(props.value));
	const [shown, setShown] = useState(props.value);
	if (props.value !== shown) {
		// Changed from outside (e.g. another edit): show the new value.
		setShown(props.value);
		setText(displayed(props.value));
	}
	return <input
		type="number"
		aria-label={props.label}
		min={props.min}
		max={props.max}
		step={props.step}
		value={text}
		onChange={(e) => {
			setText(e.target.value);
			const v = Number(e.target.value);
			if (e.target.value.trim() !== "" && Number.isFinite(v) && (props.valid?.(v) ?? true)) {
				setShown(v);
				props.onCommit(v);
			}
		}}
	/>;
}
