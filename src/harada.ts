import { MarkdownRenderChild } from "obsidian";
import {
	ADD_PLAN_LABEL,
	EMPTY_LABEL,
	SLOT_COUNT,
	type GoalFolderScan,
	type TaskProgress,
} from "./goal-folder";

export type HaradaCellKind = "goal" | "keyplan" | "action";

export interface HaradaClickTarget {
	kind: HaradaCellKind;
	label: string;
	exists: boolean;
	keyplanIndex?: number;
	actionIndex?: number;
	path?: string;
	folderPath?: string;
	progress?: TaskProgress;
}

export interface HaradaChartData {
	goal: string;
	keyplans: string[];
	actions: string[][];
	goalTarget?: HaradaClickTarget;
	keyplanTargets?: HaradaClickTarget[];
	actionTargets?: HaradaClickTarget[][];
}

export interface HaradaColors {
	goalBackgroundColor: string;
	keyplanBackgroundColor: string;
	actionBackgroundColor: string;
	goalTextColor: string;
	keyplanTextColor: string;
	actionTextColor: string;
}

export interface HaradaChartOptions {
	folderChart?: boolean;
	colors?: HaradaColors;
	sourcePath?: string;
}

export function clickTargetFromCell(cell: HTMLElement): HaradaClickTarget | null {
	const kind = cell.dataset.haradaKind;
	if (kind !== "keyplan" && kind !== "action" && kind !== "goal") {
		return null;
	}
	const keyplanRaw = cell.dataset.haradaKeyplan;
	const actionRaw = cell.dataset.haradaAction;
	return {
		kind,
		label: cell.dataset.haradaLabel || EMPTY_LABEL,
		exists: cell.dataset.haradaExists === "true",
		path: cell.dataset.haradaPath || undefined,
		folderPath: cell.dataset.haradaFolder || undefined,
		keyplanIndex: keyplanRaw === undefined || keyplanRaw === "" ? undefined : Number(keyplanRaw),
		actionIndex: actionRaw === undefined || actionRaw === "" ? undefined : Number(actionRaw),
	};
}

export function emptyChartData(): HaradaChartData {
	const keyplans = new Array<string>(SLOT_COUNT).fill(EMPTY_LABEL);
	const actions: string[][] = Array.from({ length: SLOT_COUNT }, () =>
		new Array<string>(SLOT_COUNT).fill(EMPTY_LABEL),
	);
	return { goal: "", keyplans, actions };
}

export function chartFromScan(scan: GoalFolderScan): HaradaChartData {
	const keyplanTargets: HaradaClickTarget[] = scan.keyplans.map((keyplan, keyplanIndex) => ({
		kind: "keyplan",
		label: keyplan.name ?? ADD_PLAN_LABEL,
		exists: !!keyplan.folderPath,
		keyplanIndex,
		path: keyplan.planPath ?? undefined,
		folderPath: keyplan.folderPath ?? undefined,
	}));
	const actionTargets: HaradaClickTarget[][] = scan.keyplans.map((keyplan, keyplanIndex) =>
		keyplan.actions.map((action, actionIndex) => ({
			kind: "action" as const,
			label: action.name ?? EMPTY_LABEL,
			exists: !!action.path,
			keyplanIndex,
			actionIndex,
			path: action.path ?? undefined,
			folderPath: keyplan.folderPath ?? undefined,
			progress: action.progress,
		})),
	);

	return {
		goal: scan.goalTitle,
		keyplans: scan.keyplans.map((keyplan) => keyplan.name ?? ADD_PLAN_LABEL),
		actions: scan.keyplans.map((keyplan) =>
			keyplan.actions.map((action) => action.name ?? EMPTY_LABEL),
		),
		goalTarget: {
			kind: "goal",
			label: scan.goalTitle,
			exists: true,
			path: scan.masterPath,
		},
		keyplanTargets,
		actionTargets,
	};
}

export function parseHaradaText(text: string): HaradaChartData {
	const data = emptyChartData();
	const lines = text.split("\n");
	let currentKeyplanIndex = -1;
	let currentActionIndex = -1;

	for (const line of lines) {
		const leading = line.match(/^(\s+)/);
		const leadingLength = leading ? leading[0].length : 0;
		const level = leadingLength / 2;
		if (!Number.isInteger(level)) {
			break;
		}

		if (level === 0) {
			if (data.goal === "") {
				data.goal = line;
			}
		} else if (level === 1) {
			currentKeyplanIndex += 1;
			currentActionIndex = -1;
			if (currentKeyplanIndex < SLOT_COUNT) {
				data.keyplans[currentKeyplanIndex] = line.trim() || EMPTY_LABEL;
			}
		} else if (level === 2) {
			currentActionIndex += 1;
			if (
				currentKeyplanIndex >= 0 &&
				currentKeyplanIndex < SLOT_COUNT &&
				currentActionIndex < SLOT_COUNT
			) {
				data.actions[currentKeyplanIndex][currentActionIndex] = line.trim() || EMPTY_LABEL;
			}
		}
	}

	return data;
}

function slotIndexFromNine(index: number): number {
	return index > 4 ? index - 1 : index;
}

export function describeCell(
	x: number,
	y: number,
): { kind: HaradaCellKind; keyplanIndex?: number; actionIndex?: number } {
	const boxIndex = Math.floor(x / 3) + Math.floor(y / 3) * 3;
	const inboxIndex = (x % 3) + (y % 3) * 3;

	if (boxIndex === 4 && inboxIndex === 4) {
		return { kind: "goal" };
	}
	if (boxIndex === 4) {
		return { kind: "keyplan", keyplanIndex: slotIndexFromNine(inboxIndex) };
	}
	if (inboxIndex === 4) {
		return { kind: "keyplan", keyplanIndex: slotIndexFromNine(boxIndex) };
	}
	return {
		kind: "action",
		keyplanIndex: slotIndexFromNine(boxIndex),
		actionIndex: slotIndexFromNine(inboxIndex),
	};
}

function applyCellColors(cell: HTMLElement, kind: HaradaCellKind, colors?: HaradaColors) {
	if (!colors) {
		return;
	}
	if (kind === "goal") {
		cell.style.backgroundColor = colors.goalBackgroundColor;
		cell.style.color = colors.goalTextColor;
	} else if (kind === "keyplan") {
		cell.style.backgroundColor = colors.keyplanBackgroundColor;
		cell.style.color = colors.keyplanTextColor;
	} else {
		cell.style.backgroundColor = colors.actionBackgroundColor;
		cell.style.color = colors.actionTextColor;
	}
}

function fillWikilink(host: HTMLElement, content: string) {
	host.empty();
	const match = content.match(/\[\[(.*?)\]\]/);
	if (!match) {
		host.createSpan({ text: content });
		return;
	}
	const split = match[1].split("|");
	const path = split[0];
	const title = split[1] ?? split[0];
	const anchor = host.createEl("a", { text: title, cls: "internal-link" });
	anchor.href = path;
}

export class HaradaMethod extends MarkdownRenderChild {
	constructor(
		containerEl: HTMLElement,
		private data: HaradaChartData | string,
		private options: HaradaChartOptions = {},
	) {
		super(containerEl);
	}

	onload() {
		const chart = typeof this.data === "string" ? parseHaradaText(this.data) : this.data;
		const table = this.renderTable(chart);
		this.containerEl.empty();
		if (!this.containerEl.hasClass("harada-folder-root")) {
			this.containerEl.addClass("harada-code-host");
		}
		this.containerEl.appendChild(table);
		this.fitCellLabels(table);
		const observer = new ResizeObserver(() => this.fitCellLabels(table));
		observer.observe(table);
		this.register(() => observer.disconnect());
	}

	private renderTable(chart: HaradaChartData): HTMLTableElement {
		const table = document.createElement("table");
		table.id = "harada";
		table.classList.add("harada");
		if (this.options.folderChart) {
			table.classList.add("harada-folder");
		}

		for (let y = 0; y < 9; y++) {
			const row = document.createElement("tr");
			for (let x = 0; x < 9; x++) {
				row.appendChild(this.renderCell(chart, x, y));
			}
			table.appendChild(row);
		}

		return table;
	}

	private renderCell(chart: HaradaChartData, x: number, y: number): HTMLTableCellElement {
		const desc = describeCell(x, y);
		const cell = document.createElement("td");
		cell.classList.add("cell", desc.kind);

		if (y % 3 === 0) cell.classList.add("top");
		if (y % 3 === 2) cell.classList.add("bottom");
		if (x % 3 === 0) cell.classList.add("left");
		if (x % 3 === 2) cell.classList.add("right");

		applyCellColors(cell, desc.kind, this.options.colors);

		const target = this.targetFor(chart, desc);
		const content = target?.label ?? this.labelFor(chart, desc);
		const label = cell.createDiv({ cls: "harada-label" });

		if (this.options.folderChart && target) {
			this.renderFolderCell(cell, label, target, content);
		} else {
			fillWikilink(label, content);
		}

		return cell;
	}

	private labelFor(
		chart: HaradaChartData,
		desc: { kind: HaradaCellKind; keyplanIndex?: number; actionIndex?: number },
	): string {
		if (desc.kind === "goal") {
			return chart.goal;
		}
		if (desc.kind === "keyplan" && desc.keyplanIndex !== undefined) {
			return chart.keyplans[desc.keyplanIndex] ?? EMPTY_LABEL;
		}
		if (
			desc.kind === "action" &&
			desc.keyplanIndex !== undefined &&
			desc.actionIndex !== undefined
		) {
			return chart.actions[desc.keyplanIndex]?.[desc.actionIndex] ?? EMPTY_LABEL;
		}
		return EMPTY_LABEL;
	}

	private targetFor(
		chart: HaradaChartData,
		desc: { kind: HaradaCellKind; keyplanIndex?: number; actionIndex?: number },
	): HaradaClickTarget | undefined {
		if (desc.kind === "goal") {
			return chart.goalTarget;
		}
		if (desc.kind === "keyplan" && desc.keyplanIndex !== undefined) {
			return chart.keyplanTargets?.[desc.keyplanIndex];
		}
		if (
			desc.kind === "action" &&
			desc.keyplanIndex !== undefined &&
			desc.actionIndex !== undefined
		) {
			return chart.actionTargets?.[desc.keyplanIndex]?.[desc.actionIndex];
		}
		return undefined;
	}

	private renderFolderCell(
		cell: HTMLElement,
		label: HTMLElement,
		target: HaradaClickTarget,
		content: string,
	) {
		fillWikilink(label, content);
		this.writeCellData(cell, target);
		if (target.exists) {
			cell.title = target.progress
				? `${target.label} (${target.progress.done}/${target.progress.total})`
				: target.label;
		} else if (target.kind === "keyplan") {
			cell.title = "Create a Key Plan";
		} else if (target.kind === "action") {
			cell.title = "Create an action";
		} else {
			cell.title = target.label;
		}

		if (target.kind === "goal") {
			return;
		}

		cell.classList.add("harada-drop-slot");
		if (target.exists) {
			cell.classList.add("harada-draggable");
			cell.setAttr("draggable", "true");
		}
		if (target.progress && target.progress.total > 0) {
			const pct = Math.round((100 * target.progress.done) / target.progress.total);
			cell.classList.add("harada-progress");
			cell.style.backgroundImage = `linear-gradient(to top, color-mix(in srgb, currentColor 16%, transparent) ${pct}%, transparent ${pct}%)`;
			if (target.progress.done >= target.progress.total) {
				cell.classList.add("harada-complete");
			}
		}

		if (target.kind === "keyplan" && target.exists) {
			cell.classList.add("harada-clickable");
			cell.classList.add("harada-linked");
			return;
		}

		cell.classList.add("harada-clickable");
		cell.classList.add(target.exists ? "harada-linked" : "harada-empty");
	}

	private writeCellData(cell: HTMLElement, target: HaradaClickTarget) {
		cell.dataset.haradaKind = target.kind;
		cell.dataset.haradaExists = target.exists ? "true" : "false";
		cell.dataset.haradaLabel = target.label;
		if (this.options.sourcePath) {
			cell.dataset.haradaSource = this.options.sourcePath;
		}
		if (target.path) {
			cell.dataset.haradaPath = target.path;
		}
		if (target.folderPath) {
			cell.dataset.haradaFolder = target.folderPath;
		}
		if (target.keyplanIndex !== undefined) {
			cell.dataset.haradaKeyplan = String(target.keyplanIndex);
		}
		if (target.actionIndex !== undefined) {
			cell.dataset.haradaAction = String(target.actionIndex);
		}
	}

	private fitCellLabels(table: HTMLTableElement) {
		window.requestAnimationFrame(() => {
			table.querySelectorAll("td.cell").forEach((node) => {
				if (node instanceof HTMLElement) {
					fitCellLabel(node);
				}
			});
		});
	}
}

function fitCellLabel(cell: HTMLElement) {
	const label = cell.querySelector(":scope > .harada-label");
	if (!(label instanceof HTMLElement)) {
		return;
	}
	label.style.fontSize = "";
	if (label.clientWidth < 4 || label.clientHeight < 4) {
		return;
	}

	const minSide = Math.min(label.clientWidth, label.clientHeight);
	const start = Math.max(8, minSide * fontRatioFor(cell));
	const minPx = Math.max(7, minSide * 0.08);
	label.style.fontSize = `${start}px`;
	if (fitsLabel(label)) {
		return;
	}

	let lo = minPx;
	let hi = start;
	let best = minPx;
	while (hi - lo > 0.25) {
		const mid = (lo + hi) / 2;
		label.style.fontSize = `${mid}px`;
		if (fitsLabel(label)) {
			best = mid;
			lo = mid;
		} else {
			hi = mid;
		}
	}
	label.style.fontSize = `${best}px`;
	if (!fitsLabel(label) && best > minPx) {
		label.style.fontSize = `${Math.max(minPx, best - 0.5)}px`;
	}
}

function fontRatioFor(cell: HTMLElement): number {
	if (cell.classList.contains("goal")) {
		return 0.34;
	}
	if (cell.classList.contains("keyplan")) {
		return 0.28;
	}
	if (cell.classList.contains("harada-empty")) {
		return 0.2;
	}
	return 0.24;
}

function fitsLabel(label: HTMLElement): boolean {
	const inner = label.firstElementChild;
	if (!(inner instanceof HTMLElement) || !inner.textContent) {
		return true;
	}
	const style = window.getComputedStyle(label);
	const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
	const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
	const maxW = label.getBoundingClientRect().width - padX;
	const maxH = label.getBoundingClientRect().height - padY;
	const range = document.createRange();
	range.selectNodeContents(inner);
	const text = range.getBoundingClientRect();
	const slack = 3;
	return text.width <= maxW - slack && text.height <= maxH - slack;
}
