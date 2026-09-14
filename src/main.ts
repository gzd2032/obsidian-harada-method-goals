import {
	App,
	MarkdownPostProcessorContext,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import {
	chartFromScan,
	clickTargetFromCell,
	HaradaMethod,
	type HaradaClickTarget,
	type HaradaColors,
} from "./harada";
import {
	applyChartDrop,
	createActionNote,
	createGoalFolder,
	createKeyPlan,
	deleteActionNote,
	deleteKeyPlanFolder,
	renameKeyPlanFolder,
	isMasterNote,
	isMisnamedMasterNote,
	pathIsUnderGoalFolder,
	scanGoalFolder,
	scanGoalFolderFromFile,
	syncGoalsOutline,
	type GoalFolderScan,
	type GoalFolderSettings,
} from "./goal-folder";
import { openActionDetail, openPlanDetail, promptForName, promptForNewGoal } from "./modals";
import { HaradaChartView, VIEW_TYPE_HARADA_CHART } from "./chart-view";

interface HaradaMethodGoalsSettings extends HaradaColors, GoalFolderSettings {}

const DEFAULT_SETTINGS: HaradaMethodGoalsSettings = {
	goalBackgroundColor: "#FFE5AC",
	keyplanBackgroundColor: "#EFFFC9",
	actionBackgroundColor: "#FFFFFF",
	goalTextColor: "#000000",
	keyplanTextColor: "#000000",
	actionTextColor: "#000000",
	masterNoteFilename: "goals.md",
	parentFolder: "",
};

export default class HaradaMethodGoalsPlugin extends Plugin {
	settings: HaradaMethodGoalsSettings;
	private refreshTimer: number | null;
	private mountingPaths = new Set<string>();
	private lastCellActivate = 0;
	private lastMasterPath: string | null = null;
	private dragPayload: { sourcePath: string; kind: "keyplan" | "action"; keyplanIndex: number; actionIndex?: number } | null = null;
	private dragMoved = false;
	private warnedMisnamed = new Set<string>();
	private embeddedCharts = new Map<HTMLElement, HaradaMethod>();

	async onload() {
		try {
			this.refreshTimer = null;
			await this.loadSettings();

			this.addSettingTab(new HaradaMethodGoalsSettingTab(this.app, this));

			this.registerView(VIEW_TYPE_HARADA_CHART, (leaf) => new HaradaChartView(leaf, this));
			this.addRibbonIcon("layout-grid", "Harada chart", () => {
				void this.openChartView();
			});
			this.addCommand({
				id: "open-harada-chart",
				name: "Open Harada chart",
				callback: () => {
					void this.openChartView();
				},
			});

			this.registerMarkdownCodeBlockProcessor("goals", (source, element, context) => {
				this.renderGoalsCodeBlock(source, element, context);
			});
			this.registerMarkdownCodeBlockProcessor("harada", (source, element, context) => {
				this.renderGoalsCodeBlock(source, element, context);
			});

			const stealCellEvent = (event: PointerEvent | MouseEvent) => {
				this.activateHaradaCellEvent(event);
			};
			this.registerDomEvent(window, "pointerdown", stealCellEvent, { capture: true });
			this.registerDomEvent(window, "mousedown", stealCellEvent, { capture: true });
			this.registerDomEvent(window, "click", stealCellEvent, { capture: true });
			this.registerDomEvent(document, "dragstart", (event) => this.onChartDragStart(event), true);
			this.registerDomEvent(document, "dragover", (event) => this.onChartDragOver(event), true);
			this.registerDomEvent(document, "drop", (event) => this.onChartDrop(event), true);
			this.registerDomEvent(document, "dragend", () => {
				this.clearDropHighlights();
				window.setTimeout(() => {
					this.dragPayload = null;
					this.dragMoved = false;
				}, 50);
			});

			this.registerMarkdownPostProcessor((element, context) => {
				try {
					this.scheduleFolderChart(element, context);
				} catch (error) {
					console.error("Harada Method Goals: chart processor failed", error);
				}
			});

			this.registerEvent(
				this.app.workspace.on("layout-change", () => {
					this.injectFolderChartsIntoViews();
				}),
			);
			this.registerEvent(
				this.app.workspace.on("file-open", (file) => {
					this.warnIfMisnamed(file);
					this.rememberMaster(file);
					this.injectFolderChartsIntoViews();
					this.refreshChartViews();
				}),
			);
			window.setTimeout(() => this.injectFolderChartsIntoViews(), 0);

			this.addCommand({
				id: "create-harada-goal",
				name: "Create Harada goal",
				callback: () => {
					void this.createGoalFromCommand();
				},
			});

			this.registerEvent(this.app.vault.on("create", (file) => this.scheduleRefresh(file, undefined, true)));
			this.registerEvent(this.app.vault.on("delete", (file) => this.scheduleRefresh(file, undefined, true)));
			this.registerEvent(this.app.vault.on("modify", (file) => this.scheduleRefresh(file)));
			this.registerEvent(this.app.metadataCache.on("changed", (file) => this.scheduleRefresh(file)));
			this.registerEvent(
				this.app.vault.on("rename", (file, oldPath) => {
					this.scheduleRefresh(file, oldPath, true);
				}),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Harada Method Goals failed to load", error);
			new Notice(`Harada Method Goals failed to load: ${message}`);
			throw error;
		}
	}

	onunload() {
		if (this.refreshTimer) {
			window.clearTimeout(this.refreshTimer);
		}
	}

	async applySettings() {
		if (typeof document === "undefined") {
			return;
		}
		const paint = (className: string, background: string, color: string) => {
			Array.from(document.getElementsByClassName(className)).forEach((element) => {
				const el = element as HTMLElement;
				el.style.backgroundColor = background;
				el.style.color = color;
			});
		};
		paint("goal", this.settings.goalBackgroundColor, this.settings.goalTextColor);
		paint("keyplan", this.settings.keyplanBackgroundColor, this.settings.keyplanTextColor);
		paint("action", this.settings.actionBackgroundColor, this.settings.actionTextColor);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.applySettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.applySettings();
	}

	private renderGoalsCodeBlock(
		source: string,
		element: HTMLElement,
		context: MarkdownPostProcessorContext,
	) {
		const scan = scanGoalFolder(this.app, context.sourcePath, this.settings, source);
		if (scan) {
			context.addChild(
				new HaradaMethod(element, chartFromScan(scan), {
					folderChart: true,
					colors: this.settings,
					sourcePath: context.sourcePath,
				}),
			);
			return;
		}

		context.addChild(
			new HaradaMethod(element, source, {
				colors: this.settings,
			}),
		);
	}

	private scheduleFolderChart(element: HTMLElement, context: MarkdownPostProcessorContext) {
		if (!element || !context?.sourcePath || !this.settings) {
			return;
		}
		if (!isMasterNote(context.sourcePath, this.settings.masterNoteFilename)) {
			return;
		}

		window.setTimeout(() => {
			this.injectFolderChartsIntoViews();
		}, 50);
	}

	private injectFolderChartsIntoViews() {
		if (!this.settings) {
			return;
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) {
				continue;
			}
			if (!isMasterNote(view.file.path, this.settings.masterNoteFilename)) {
				continue;
			}
			const sizer = previewSizer(view);
			if (!sizer || sizer.querySelector("table.harada-folder")) {
				continue;
			}
			const stable = findStableChartParent(sizer);
			if (!stable) {
				continue;
			}
			void this.mountFolderChart(stable, view.file.path);
		}
	}

	private async mountFolderChart(hostParent: HTMLElement, sourcePath: string) {
		if (!isMasterNote(sourcePath, this.settings.masterNoteFilename)) {
			return;
		}
		if (hostParent.querySelector("table.harada-folder") || this.mountingPaths.has(sourcePath)) {
			return;
		}
		this.mountingPaths.add(sourcePath);

		try {
			const scan = await scanGoalFolderFromFile(this.app, sourcePath, this.settings);
			if (!scan || hostParent.querySelector("table.harada-folder")) {
				return;
			}

			this.addChild(
				new HaradaMethod(hostParent, chartFromScan(scan), {
					folderChart: true,
					colors: this.settings,
					sourcePath,
				}),
			);
		} finally {
			this.mountingPaths.delete(sourcePath);
		}
	}

	private activateHaradaCellEvent(event: PointerEvent | MouseEvent) {
		if ("button" in event && event.button !== 0) {
			return;
		}
		const eventTarget = event.target;
		if (!(eventTarget instanceof Element)) {
			return;
		}
		const cell = eventTarget.closest("td.harada-clickable, td.harada-draggable");
		if (!(cell instanceof HTMLElement) || !cell.closest("table.harada-folder")) {
			return;
		}

		if (event.type !== "click") {
			if (cell.classList.contains("harada-draggable")) {
				return;
			}
			event.stopPropagation();
			event.stopImmediatePropagation();
			return;
		}

		if (this.dragMoved || !cell.classList.contains("harada-clickable")) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const now = Date.now();
		if (now - this.lastCellActivate < 400) {
			return;
		}
		this.lastCellActivate = now;
		void this.activateHaradaCell(cell);
	}

	private async activateHaradaCell(cell: HTMLElement) {
		const sourcePath = cell.dataset.haradaSource;
		if (!sourcePath) {
			new Notice("Could not open this Harada cell.");
			return;
		}
		const scan = await scanGoalFolderFromFile(this.app, sourcePath, this.settings);
		if (!scan) {
			new Notice("Open this chart from a goals.md note to click cells.");
			return;
		}
		const target = clickTargetFromCell(cell);
		if (!target) {
			return;
		}
		await this.handleCellClick(scan, sourcePath, target);
	}

	private async handleCellClick(
		scan: GoalFolderScan,
		sourcePath: string,
		target: HaradaClickTarget,
	) {
		try {
			if (target.kind === "goal") {
				return;
			}

			if (target.kind === "keyplan") {
				if (target.exists) {
					this.showPlanDetail(scan, sourcePath, target);
					return;
				}
				const name = await promptForName(this.app, "New Key Plan", "Key Plan name");
				if (!name) {
					return;
				}
				await createKeyPlan(this.app, scan.folderPath, name);
				await syncGoalsOutline(this.app, scan.masterPath, this.settings);
				new Notice(`Created Key Plan “${name}”`);
				return;
			}

			let folderPath = target.folderPath ?? null;
			if (!folderPath) {
				const keyplanName = await promptForName(
					this.app,
					"New Key Plan",
					"Key Plan name for this action",
				);
				if (!keyplanName) {
					return;
				}
				const created = await createKeyPlan(this.app, scan.folderPath, keyplanName);
				folderPath = created.folderPath;
			}

			if (target.exists && target.path) {
				this.showActionDetail(scan, sourcePath, target);
				return;
			}

			const actionName = await promptForName(this.app, "New action", "Action name");
			if (!actionName) {
				return;
			}
			const actionPath = await createActionNote(this.app, folderPath, actionName);
			await syncGoalsOutline(this.app, scan.masterPath, this.settings);
			new Notice(`Created action “${actionName}”`);
			await this.openBeside(actionPath, sourcePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Could not update Harada cell: ${message}`);
			console.error(error);
		}
	}

	private showActionDetail(scan: GoalFolderScan, sourcePath: string, target: HaradaClickTarget) {
		if (!target.path) {
			return;
		}
		const path = target.path;
		const title = target.label;
		openActionDetail(this.app, {
			title,
			path,
			onOpenNote: () => this.openBeside(path, sourcePath),
			onDelete: async () => {
				await deleteActionNote(this.app, path);
				await syncGoalsOutline(this.app, scan.masterPath, this.settings);
				new Notice(`Deleted action “${title}”`);
			},
		});
	}

	private showPlanDetail(scan: GoalFolderScan, sourcePath: string, target: HaradaClickTarget) {
		if (!target.folderPath) {
			return;
		}
		let folderPath = target.folderPath;
		const keyplan =
			target.keyplanIndex !== undefined ? scan.keyplans[target.keyplanIndex] : undefined;
		const actions = (keyplan?.actions ?? []).flatMap((action) =>
			action.name && action.path ? [{ name: action.name, path: action.path }] : [],
		);
		let title = target.label;
		openPlanDetail(this.app, {
			title,
			actions,
			onOpenAction: (action) => {
				this.showActionDetail(scan, sourcePath, {
					kind: "action",
					label: action.name,
					exists: true,
					path: action.path,
				});
			},
			onRename: async () => {
				const name = await promptForName(this.app, "Rename Key Plan", "Key Plan name", {
					initial: title,
					confirmLabel: "Rename",
				});
				if (!name) {
					return null;
				}
				folderPath = await renameKeyPlanFolder(this.app, folderPath, name);
				title = folderPath.split("/").pop() ?? name;
				await syncGoalsOutline(this.app, scan.masterPath, this.settings);
				new Notice(`Renamed Key Plan to “${title}”`);
				return title;
			},
			onDelete: async () => {
				await deleteKeyPlanFolder(this.app, folderPath);
				await syncGoalsOutline(this.app, scan.masterPath, this.settings);
				new Notice(`Deleted Key Plan “${title}”`);
			},
		});
	}

	private async openBeside(path: string, sourcePath: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		const sourceLeaf = this.app.workspace.getMostRecentLeaf();
		const leaf = this.app.workspace.getLeaf("split");
		if (file instanceof TFile) {
			await leaf.openFile(file);
		} else {
			await this.app.workspace.openLinkText(path, sourcePath, true);
		}
		if (sourceLeaf) {
			this.app.workspace.setActiveLeaf(sourceLeaf, { focus: true });
		}
	}

	activeMasterPath(): string | null {
		const active = this.app.workspace.getActiveFile();
		if (active && isMasterNote(active.path, this.settings.masterNoteFilename)) {
			this.lastMasterPath = active.path;
			return active.path;
		}
		if (this.lastMasterPath && this.app.vault.getAbstractFileByPath(this.lastMasterPath)) {
			return this.lastMasterPath;
		}
		const hit = this.app.vault
			.getMarkdownFiles()
			.find((file) => isMasterNote(file.path, this.settings.masterNoteFilename));
		return hit?.path ?? null;
	}

	private rememberMaster(file: TFile | null) {
		if (file && isMasterNote(file.path, this.settings.masterNoteFilename)) {
			this.lastMasterPath = file.path;
		}
	}

	private warnIfMisnamed(file: TFile | null) {
		if (!file || this.warnedMisnamed.has(file.path)) {
			return;
		}
		if (!isMisnamedMasterNote(file.path, this.settings.masterNoteFilename)) {
			return;
		}
		this.warnedMisnamed.add(file.path);
		const want = this.settings.masterNoteFilename.replace(/\.md$/i, "") || "goals";
		new Notice(
			`This note is named ${want}.md, so Obsidian saved it as ${want}.md.md. Rename the note to “${want}”.`,
			8000,
		);
	}

	async openChartView() {
		const { workspace } = this.app;
		this.rememberMaster(workspace.getActiveFile());
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_HARADA_CHART)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf("split");
			await leaf.setViewState({ type: VIEW_TYPE_HARADA_CHART, active: true });
		}
		workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof HaradaChartView) {
			await view.renderChart();
		}
	}

	private refreshChartViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HARADA_CHART)) {
			const view = leaf.view;
			if (view instanceof HaradaChartView) {
				void view.renderChart();
			}
		}
	}

	private onChartDragStart(event: DragEvent) {
		const cell = this.chartCellFromEvent(event, "td.harada-draggable");
		if (!cell) {
			return;
		}
		const kind = cell.dataset.haradaKind;
		const sourcePath = cell.dataset.haradaSource;
		if ((kind !== "keyplan" && kind !== "action") || !sourcePath) {
			return;
		}
		this.dragMoved = false;
		this.dragPayload = {
			sourcePath,
			kind,
			keyplanIndex: Number(cell.dataset.haradaKeyplan ?? "0"),
			actionIndex: cell.dataset.haradaAction === undefined ? undefined : Number(cell.dataset.haradaAction),
		};
		event.dataTransfer?.setData("text/plain", cell.dataset.haradaLabel ?? "");
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = "move";
		}
	}

	private onChartDragOver(event: DragEvent) {
		if (!this.dragPayload) {
			return;
		}
		const cell = this.chartCellFromEvent(event, "td.harada-drop-slot");
		this.clearDropHighlights();
		if (!cell || cell.dataset.haradaKind !== this.dragPayload.kind) {
			return;
		}
		event.preventDefault();
		cell.classList.add("harada-drop-target");
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = "move";
		}
	}

	private async onChartDrop(event: DragEvent) {
		const payload = this.dragPayload;
		const cell = this.chartCellFromEvent(event, "td.harada-drop-slot");
		this.clearDropHighlights();
		if (!payload || !cell || cell.dataset.haradaKind !== payload.kind) {
			return;
		}
		event.preventDefault();
		this.dragMoved = true;
		const scan = await scanGoalFolderFromFile(this.app, payload.sourcePath, this.settings);
		if (!scan) {
			return;
		}
		const error = await applyChartDrop(
			this.app,
			scan,
			payload,
			{
				kind: payload.kind,
				keyplanIndex: Number(cell.dataset.haradaKeyplan ?? "0"),
				actionIndex:
					cell.dataset.haradaAction === undefined ? undefined : Number(cell.dataset.haradaAction),
			},
			this.settings,
		);
		if (error) {
			new Notice(error);
		}
	}

	private chartCellFromEvent(event: Event, selector: string): HTMLElement | null {
		const target = event.target;
		if (!(target instanceof Element)) {
			return null;
		}
		const cell = target.closest(selector);
		if (!(cell instanceof HTMLElement) || !cell.closest("table.harada-folder")) {
			return null;
		}
		return cell;
	}

	private clearDropHighlights() {
		document.querySelectorAll("td.harada-drop-target").forEach((node) => {
			node.classList.remove("harada-drop-target");
		});
	}

	private async createGoalFromCommand() {
		const name = await promptForNewGoal(this.app);
		if (!name) {
			return;
		}
		try {
			const path = await createGoalFolder(
				this.app,
				name,
				this.settings.parentFolder,
				this.settings,
			);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				this.lastMasterPath = path;
				await this.app.workspace.getLeaf(false).openFile(file);
				await this.openChartView();
			} else {
				await this.app.workspace.openLinkText(path, "", false);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Could not create Harada goal: ${message}`);
			console.error(error);
		}
	}

	private scheduleRefresh(file: TAbstractFile, oldPath?: string, syncOutline = false) {
		if (!this.fileAffectsOpenGoal(file.path) && !(oldPath && this.fileAffectsOpenGoal(oldPath))) {
			return;
		}
		if (this.refreshTimer) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			if (syncOutline) {
				void this.syncOpenGoalOutlines().then(() => this.rerenderGoalViews());
			} else {
				this.rerenderGoalViews();
			}
		}, 150);
	}

	private async syncOpenGoalOutlines() {
		const seen = new Set<string>();
		if (this.lastMasterPath) {
			seen.add(this.lastMasterPath);
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) {
				continue;
			}
			if (!isMasterNote(view.file.path, this.settings.masterNoteFilename)) {
				continue;
			}
			seen.add(view.file.path);
		}
		for (const path of seen) {
			await syncGoalsOutline(this.app, path, this.settings);
		}
	}

	private fileAffectsOpenGoal(filePath: string): boolean {
		const masters = new Set<string>();
		if (this.lastMasterPath) {
			masters.add(this.lastMasterPath);
		}
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) {
				if (isMasterNote(view.file.path, this.settings.masterNoteFilename)) {
					masters.add(view.file.path);
				}
			}
		}
		for (const master of masters) {
			const folderPath = master.includes("/") ? master.slice(0, master.lastIndexOf("/")) : "";
			if (pathIsUnderGoalFolder(filePath, folderPath)) {
				return true;
			}
		}
		return false;
	}

	private rerenderGoalViews() {
		window.setTimeout(() => {
			void this.refreshEmbeddedCharts().then(() => {
				this.injectFolderChartsIntoViews();
				this.refreshChartViews();
			});
		}, 50);
	}

	private async refreshEmbeddedCharts() {
		const hosts = new Map<HTMLElement, string>();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) {
				continue;
			}
			if (!isMasterNote(view.file.path, this.settings.masterNoteFilename)) {
				continue;
			}
			const sourcePath = view.file.path;
			view.contentEl.querySelectorAll("table.harada-folder").forEach((table) => {
				if (table.parentElement) {
					hosts.set(table.parentElement, sourcePath);
				}
			});
			view.contentEl.querySelectorAll(".harada-code-host, .block-language-goals, .block-language-harada").forEach((node) => {
				if (node instanceof HTMLElement) {
					hosts.set(node, sourcePath);
				}
			});
		}
		for (const [host, sourcePath] of hosts) {
			const scan = await scanGoalFolderFromFile(this.app, sourcePath, this.settings);
			if (!scan) {
				continue;
			}
			this.replaceEmbeddedChart(host, sourcePath, scan);
		}
	}

	private replaceEmbeddedChart(host: HTMLElement, sourcePath: string, scan: GoalFolderScan) {
		const prev = this.embeddedCharts.get(host);
		if (prev) {
			this.removeChild(prev);
			this.embeddedCharts.delete(host);
		}
		const chart = new HaradaMethod(host, chartFromScan(scan), {
			folderChart: true,
			colors: this.settings,
			sourcePath,
		});
		this.addChild(chart);
		this.embeddedCharts.set(host, chart);
	}
}

function previewSizer(view: MarkdownView): HTMLElement | null {
	return (
		view.contentEl.querySelector<HTMLElement>(".markdown-preview-sizer") ??
		view.previewMode?.containerEl?.querySelector<HTMLElement>(".markdown-preview-sizer") ??
		view.contentEl.querySelector<HTMLElement>(".markdown-preview-view") ??
		view.previewMode?.containerEl ??
		null
	);
}

function findStableChartParent(root: HTMLElement): HTMLElement | null {
	return (
		root.querySelector<HTMLElement>(".harada-code-host") ??
		root.querySelector<HTMLElement>(".block-language-goals") ??
		root.querySelector<HTMLElement>(".block-language-harada") ??
		null
	);
}

class HaradaMethodGoalsSettingTab extends PluginSettingTab {
	plugin: HaradaMethodGoalsPlugin;

	constructor(app: App, plugin: HaradaMethodGoalsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Files" });

		new Setting(containerEl)
			.setName("Master note filename")
			.setDesc("Note that hosts the chart. Default: goals.md")
			.addText((text) =>
				text
					.setPlaceholder("goals.md")
					.setValue(this.plugin.settings.masterNoteFilename)
					.onChange(async (value) => {
						this.plugin.settings.masterNoteFilename = value.trim() || "goals.md";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Parent folder")
			.setDesc("Vault-relative path for new goals (for example Planner/Goal). Leave empty to create at the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Planner/Goal")
					.setValue(this.plugin.settings.parentFolder)
					.onChange(async (value) => {
						this.plugin.settings.parentFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl("h2", { text: "Colors" });

		new Setting(containerEl)
			.setName("Goal background color")
			.addColorPicker((cb) =>
				cb.setValue(this.plugin.settings.goalBackgroundColor).onChange(async (value) => {
					this.plugin.settings.goalBackgroundColor = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Goal text color")
			.addColorPicker((cb) =>
				cb.setValue(this.plugin.settings.goalTextColor).onChange(async (value) => {
					this.plugin.settings.goalTextColor = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Key Plan background color")
			.addColorPicker((cb) =>
				cb.setValue(this.plugin.settings.keyplanBackgroundColor).onChange(async (value) => {
					this.plugin.settings.keyplanBackgroundColor = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Key Plan text color")
			.addColorPicker((cb) =>
				cb.setValue(this.plugin.settings.keyplanTextColor).onChange(async (value) => {
					this.plugin.settings.keyplanTextColor = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Action background color")
			.addColorPicker((cb) =>
				cb.setValue(this.plugin.settings.actionBackgroundColor).onChange(async (value) => {
					this.plugin.settings.actionBackgroundColor = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Action text color")
			.addColorPicker((cb) =>
				cb.setValue(this.plugin.settings.actionTextColor).onChange(async (value) => {
					this.plugin.settings.actionTextColor = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
