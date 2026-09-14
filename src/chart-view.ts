import { ItemView, WorkspaceLeaf } from "obsidian";
import { chartFromScan, HaradaMethod } from "./harada";
import { scanGoalFolderFromFile } from "./goal-folder";
import type HaradaMethodGoalsPlugin from "./main";

export const VIEW_TYPE_HARADA_CHART = "harada-method-goals-chart";

export class HaradaChartView extends ItemView {
	private chartChild: HaradaMethod | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: HaradaMethodGoalsPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_HARADA_CHART;
	}

	getDisplayText(): string {
		return "Harada chart";
	}

	getIcon(): string {
		return "layout-grid";
	}

	async onOpen() {
		await this.renderChart();
	}

	async renderChart() {
		const container = this.contentEl;
		if (this.chartChild) {
			this.removeChild(this.chartChild);
			this.chartChild = null;
		}
		container.empty();
		container.addClass("harada-chart-view");

		const sourcePath = this.plugin.activeMasterPath();
		if (!sourcePath) {
			container.createEl("p", {
				text: "Open a goals note, or run Create Harada goal.",
			});
			return;
		}

		const scan = await scanGoalFolderFromFile(this.app, sourcePath, this.plugin.settings);
		if (!scan) {
			container.createEl("p", {
				text: "This note is not a Harada goal. Rename it to goals.",
			});
			return;
		}

		const host = container.createDiv({ cls: "harada-code-host" });
		this.chartChild = new HaradaMethod(host, chartFromScan(scan), {
			folderChart: true,
			colors: this.plugin.settings,
			sourcePath,
		});
		this.addChild(this.chartChild);
	}
}
