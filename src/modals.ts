import { App, Modal, Setting, TFile, setIcon } from "obsidian";
import {
	appendActionTask,
	parseActionNotes,
	parseActionTasks,
	removeActionTaskLine,
	updateActionNotes,
	updateActionTaskLine,
} from "./goal-folder";

export function promptForName(
	app: App,
	title: string,
	placeholder = "Name",
	options: { initial?: string; confirmLabel?: string } = {},
): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new NamePromptModal(app, title, placeholder, resolve, options);
		modal.open();
	});
}

export function promptForNewGoal(app: App): Promise<string | null> {
	return new Promise((resolve) => {
		const modal = new CreateGoalModal(app, resolve);
		modal.open();
	});
}

export function promptConfirm(
	app: App,
	heading: string,
	message: string,
	confirmLabel = "Delete",
): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new ConfirmModal(app, heading, message, confirmLabel, resolve);
		modal.open();
	});
}

export function openActionDetail(app: App, options: ActionDetailOptions) {
	new ActionDetailModal(app, options).open();
}

export function openPlanDetail(app: App, options: PlanDetailOptions) {
	new PlanDetailModal(app, options).open();
}

class NamePromptModal extends Modal {
	private inputEl: HTMLInputElement | null = null;
	private resolved = false;

	constructor(
		app: App,
		private heading: string,
		private placeholder: string,
		private onSubmit: (value: string | null) => void,
		private options: { initial?: string; confirmLabel?: string } = {},
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.heading });

		const input = contentEl.createEl("input", {
			cls: "harada-name-input",
			type: "text",
			placeholder: this.placeholder,
		});
		input.value = this.options.initial ?? "";
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.submit();
			}
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.options.confirmLabel ?? "Create")
					.setCta()
					.onClick(() => {
						this.submit();
					}),
			);

		this.inputEl = input;
		window.setTimeout(() => {
			input.focus();
			input.select();
		}, 0);
	}

	onClose() {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolved = true;
			this.onSubmit(null);
		}
	}

	private submit() {
		const name = (this.inputEl?.value ?? "").trim();
		if (!name) {
			return;
		}
		this.resolved = true;
		this.onSubmit(name);
		this.close();
	}
}

class CreateGoalModal extends Modal {
	private name = "";
	private resolved = false;

	constructor(
		app: App,
		private onSubmit: (value: string | null) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Create Harada goal" });

		new Setting(contentEl)
			.setName("Goal name")
			.setDesc("Creates a folder with a master goals note inside. New goals go in the parent folder from Settings.")
			.addText((text) => {
				text.setPlaceholder("Marathon").onChange((value) => {
					this.name = value;
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						this.submit();
					}
				});
			});

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.close();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Create")
					.setCta()
					.onClick(() => {
						this.submit();
					}),
			);
	}

	onClose() {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolved = true;
			this.onSubmit(null);
		}
	}

	private submit() {
		const name = this.name.trim();
		if (!name) {
			return;
		}
		this.resolved = true;
		this.onSubmit(name);
		this.close();
	}
}

class ConfirmModal extends Modal {
	private resolved = false;

	constructor(
		app: App,
		private heading: string,
		private message: string,
		private confirmLabel: string,
		private onSubmit: (ok: boolean) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.heading });
		contentEl.createEl("p", { text: this.message });
		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => {
					this.finish(false);
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText(this.confirmLabel)
					.setDestructive()
					.onClick(() => {
						this.finish(true);
					}),
			);
	}

	onClose() {
		this.contentEl.empty();
		if (!this.resolved) {
			this.resolved = true;
			this.onSubmit(false);
		}
	}

	private finish(ok: boolean) {
		if (this.resolved) {
			return;
		}
		this.resolved = true;
		this.onSubmit(ok);
		this.close();
	}
}

export interface ActionDetailOptions {
	title: string;
	path: string;
	keyPlanName?: string;
	onOpenNote: () => void | Promise<void>;
	onOpenKeyPlan?: () => void;
	onRename: (newName: string) => Promise<{ title: string; path: string } | null>;
	onDelete: () => Promise<void>;
}

class ActionDetailModal extends Modal {
	private headerEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	private notesTextarea: HTMLTextAreaElement | null = null;
	private editingIndex: number | null = null;
	private isEditingTitle = false;
	private busy = false;
	private skipBlurCommit = false;
	private isDeleted = false;

	constructor(
		app: App,
		private options: ActionDetailOptions,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("harada-detail-modal");

		this.headerEl = contentEl.createDiv({ cls: "harada-detail-header" });
		this.renderHeader();

		const body = contentEl.createDiv({ cls: "harada-detail-body" });
		body.createDiv({ text: "Tasks", cls: "harada-section-label" });
		this.listEl = body.createDiv({ cls: "harada-task-list" });

		const notesSection = body.createDiv({ cls: "harada-notes-section" });
		notesSection.createDiv({ text: "Notes", cls: "harada-section-label" });
		this.notesTextarea = notesSection.createEl("textarea", {
			cls: "harada-notes-textarea",
			attr: { placeholder: "Add notes...", rows: "4" },
		});
		this.notesTextarea.addEventListener("blur", () => {
			void this.commitNotes();
		});

		const footer = contentEl.createDiv({ cls: "harada-detail-footer" });
		new Setting(footer)
			.addButton((btn) =>
				btn.setButtonText("Open note").onClick(() => {
					this.close();
					void this.options.onOpenNote();
				}),
			)
			.addButton((btn) =>
				btn
					.setButtonText("Delete action")
					.setDestructive()
					.onClick(() => {
						void this.deleteAction();
					}),
			);

		this.editingIndex = -1;
		void this.renderTasks();
		void this.loadNotes();
	}

	private renderHeader() {
		if (!this.headerEl) {
			return;
		}
		this.headerEl.empty();

		if (this.options.keyPlanName) {
			const context = this.headerEl.createDiv({ cls: "harada-detail-context" });
			const plan = context.createSpan({
				text: this.options.keyPlanName,
				cls: "harada-detail-context-link",
			});
			plan.setAttr("role", "button");
			plan.setAttr("tabindex", "0");
			plan.setAttr("title", "Open Key Plan");
			const openPlan = () => {
				if (!this.options.onOpenKeyPlan) {
					return;
				}
				this.close();
				this.options.onOpenKeyPlan();
			};
			plan.addEventListener("click", openPlan);
			plan.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openPlan();
				}
			});
		}

		const titleRow = this.headerEl.createDiv({ cls: "harada-detail-title-row" });

		if (this.isEditingTitle) {
			const input = titleRow.createEl("input", {
				type: "text",
				cls: "harada-title-input",
			});
			input.value = this.options.title;

			const save = async () => {
				const val = input.value.trim();
				if (val && val !== this.options.title) {
					const res = await this.options.onRename(val);
					if (res) {
						this.options.title = res.title;
						this.options.path = res.path;
					}
				}
				this.isEditingTitle = false;
				this.renderHeader();
			};

			const cancel = () => {
				this.isEditingTitle = false;
				this.renderHeader();
			};

			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					void save();
				} else if (e.key === "Escape") {
					e.preventDefault();
					cancel();
				}
			});

			const actions = titleRow.createDiv({ cls: "harada-detail-title-actions" });
			const saveBtn = actions.createEl("button", {
				cls: "clickable-icon harada-icon-btn",
				attr: { type: "button", "aria-label": "Save action name" },
			});
			setIcon(saveBtn, "check");
			saveBtn.addEventListener("click", () => {
				void save();
			});

			const cancelBtn = actions.createEl("button", {
				cls: "clickable-icon harada-icon-btn",
				attr: { type: "button", "aria-label": "Cancel" },
			});
			setIcon(cancelBtn, "cross");
			cancelBtn.addEventListener("click", () => {
				cancel();
			});

			window.setTimeout(() => {
				input.focus();
				input.select();
			}, 0);
			return;
		}

		const title = titleRow.createSpan({
			text: this.options.title,
			cls: "harada-detail-title",
		});
		title.setAttr("role", "button");
		title.setAttr("tabindex", "0");
		title.setAttr("title", "Open note");
		const openNote = () => {
			this.close();
			void this.options.onOpenNote();
		};
		title.addEventListener("click", openNote);
		title.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				openNote();
			}
		});

		const actions = titleRow.createDiv({ cls: "harada-detail-title-actions" });
		const editBtn = actions.createEl("button", {
			cls: "clickable-icon harada-icon-btn",
			attr: { type: "button", "aria-label": "Rename action" },
		});
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("click", () => {
			this.isEditingTitle = true;
			this.renderHeader();
		});
	}

	onClose() {
		if (!this.isDeleted) {
			void this.commitNotes();
		}
		this.contentEl.empty();
	}

	private async loadNotes() {
		if (!this.notesTextarea) {
			return;
		}
		const current = await this.readActionFile();
		if (!current) {
			return;
		}
		this.notesTextarea.value = parseActionNotes(current.content);
	}

	private async commitNotes() {
		if (this.busy || !this.notesTextarea || this.isDeleted) {
			return;
		}
		const text = this.notesTextarea.value;
		const current = await this.readActionFile();
		if (!current) {
			return;
		}
		const existing = parseActionNotes(current.content);
		if (existing === text.trim()) {
			return;
		}
		this.busy = true;
		try {
			await this.app.vault.modify(
				current.file,
				updateActionNotes(current.content, text),
			);
		} finally {
			this.busy = false;
		}
	}

	private async renderTasks() {
		if (!this.listEl) {
			return;
		}
		this.listEl.empty();
		const file = this.app.vault.getAbstractFileByPath(this.options.path);
		if (!(file instanceof TFile)) {
			this.listEl.createEl("p", { text: "This action note is missing.", cls: "harada-empty-hint" });
			return;
		}
		const content = await this.app.vault.read(file);
		const tasks = parseActionTasks(content);
		const last = tasks[tasks.length - 1];
		const hasTrailingBlank = !!last && last.text.trim() === "";
		const rows = hasTrailingBlank ? tasks : [...tasks, { index: -1, checked: false, text: "" }];
		if (this.editingIndex === -1) {
			const blank = rows[rows.length - 1];
			if (blank && blank.index >= 0) {
				this.editingIndex = blank.index;
			}
		}

		for (const task of rows) {
			this.renderTaskRow(task);
		}

		if (this.editingIndex !== null) {
			const input = this.listEl.querySelector<HTMLInputElement>("input.harada-task-input");
			window.setTimeout(() => {
				input?.focus();
				input?.select();
			}, 0);
		}
	}

	private renderTaskRow(task: { index: number; checked: boolean; text: string }) {
		if (!this.listEl) {
			return;
		}
		const editing = this.editingIndex === task.index;
		const row = this.listEl.createDiv({ cls: "harada-list-row harada-task-row" });
		const box = row.createEl("input", { type: "checkbox" });
		box.checked = task.checked;
		box.addEventListener("change", () => {
			void this.toggleTask(task.index, box.checked);
		});

		if (editing) {
			const input = row.createEl("input", {
				type: "text",
				cls: "harada-task-input",
				placeholder: "New task",
			});
			input.value = task.text;
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					this.skipBlurCommit = true;
					void this.commitEdit(task.index, input.value, box.checked);
				} else if (event.key === "Escape") {
					event.preventDefault();
					this.skipBlurCommit = true;
					this.editingIndex = task.index === -1 ? -1 : null;
					void this.renderTasks();
				}
			});
			input.addEventListener("blur", () => {
				if (this.skipBlurCommit) {
					return;
				}
				const value = input.value;
				const checked = box.checked;
				window.setTimeout(() => {
					if (this.skipBlurCommit) {
						return;
					}
					void this.commitEdit(task.index, value, checked);
				}, 120);
			});
		} else {
			const label = row.createSpan({
				text: task.text,
				cls: "harada-task-text",
			});
			if (!task.text) {
				label.addClass("harada-task-placeholder");
				label.setText("New task");
			}
			label.addEventListener("click", () => {
				this.editingIndex = task.index;
				void this.renderTasks();
			});
		}

		const trailing = row.createDiv({ cls: "harada-list-row-actions" });
		const editBtn = trailing.createEl("button", {
			cls: "clickable-icon harada-icon-btn",
			attr: { type: "button", "aria-label": "Edit" },
		});
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("mousedown", (event) => event.preventDefault());
		editBtn.addEventListener("click", () => {
			if (editing) {
				const input = row.querySelector<HTMLInputElement>("input.harada-task-input");
				this.skipBlurCommit = true;
				void this.commitEdit(task.index, input?.value ?? task.text, box.checked);
				return;
			}
			this.editingIndex = task.index;
			void this.renderTasks();
		});

		const deleteBtn = trailing.createEl("button", {
			cls: "clickable-icon harada-icon-btn",
			attr: { type: "button", "aria-label": "Delete" },
		});
		setIcon(deleteBtn, "trash");
		deleteBtn.addEventListener("mousedown", (event) => event.preventDefault());
		deleteBtn.addEventListener("click", () => {
			void this.deleteTask(task.index);
		});
	}

	private async readActionFile(): Promise<{ file: TFile; content: string } | null> {
		const file = this.app.vault.getAbstractFileByPath(this.options.path);
		if (!(file instanceof TFile)) {
			return null;
		}
		return { file, content: await this.app.vault.read(file) };
	}

	private async toggleTask(lineIndex: number, checked: boolean) {
		if (this.busy) {
			return;
		}
		const current = await this.readActionFile();
		if (!current) {
			return;
		}
		if (lineIndex < 0) {
			if (!checked) {
				return;
			}
			this.busy = true;
			try {
				await this.app.vault.modify(current.file, appendActionTask(current.content, "", true));
				this.editingIndex = -1;
				await this.renderTasks();
			} finally {
				this.busy = false;
			}
			return;
		}
		this.busy = true;
		try {
			await this.app.vault.modify(
				current.file,
				updateActionTaskLine(current.content, lineIndex, { checked }),
			);
			await this.renderTasks();
		} finally {
			this.busy = false;
		}
	}

	private async commitEdit(lineIndex: number, rawText: string, checked: boolean) {
		if (this.busy) {
			return;
		}
		this.busy = true;
		this.skipBlurCommit = true;
		try {
			const text = rawText.replace(/\s+/g, " ").trim();
			if (lineIndex < 0 && !text && !checked) {
				return;
			}
			const current = await this.readActionFile();
			if (!current) {
				return;
			}
			const tasks = parseActionTasks(current.content);
			const existing = tasks.find((task) => task.index === lineIndex);
			if (existing && existing.text === text && existing.checked === checked) {
				return;
			}
			const last = tasks[tasks.length - 1];
			if (lineIndex < 0 && last && last.text === text && last.checked === checked) {
				return;
			}
			if (lineIndex < 0) {
				await this.app.vault.modify(current.file, appendActionTask(current.content, text, checked));
			} else {
				await this.app.vault.modify(
					current.file,
					updateActionTaskLine(current.content, lineIndex, { text, checked }),
				);
			}
			if (this.editingIndex === lineIndex) {
				this.editingIndex = -1;
			}
			await this.renderTasks();
		} finally {
			this.busy = false;
			this.skipBlurCommit = false;
		}
	}

	private async deleteTask(lineIndex: number) {
		if (this.busy || lineIndex < 0) {
			this.editingIndex = -1;
			await this.renderTasks();
			return;
		}
		const current = await this.readActionFile();
		if (!current) {
			return;
		}
		const task = parseActionTasks(current.content).find((item) => item.index === lineIndex);
		const label = task?.text.trim() || "this task";
		this.skipBlurCommit = true;
		const ok = await promptConfirm(
			this.app,
			"Delete task",
			`Delete “${label}”?`,
			"Delete",
		);
		if (!ok) {
			this.skipBlurCommit = false;
			return;
		}
		this.busy = true;
		try {
			const latest = await this.readActionFile();
			if (!latest) {
				return;
			}
			await this.app.vault.modify(latest.file, removeActionTaskLine(latest.content, lineIndex));
			this.editingIndex = -1;
			await this.renderTasks();
		} finally {
			this.busy = false;
			this.skipBlurCommit = false;
		}
	}

	private async deleteAction() {
		const ok = await promptConfirm(
			this.app,
			"Delete action",
			`Move “${this.options.title}” to the trash?`,
			"Delete",
		);
		if (!ok) {
			return;
		}
		this.isDeleted = true;
		this.close();
		await this.options.onDelete();
	}
}

export interface PlanDetailOptions {
	title: string;
	actions: { name: string; path: string }[];
	onOpenAction: (action: { name: string; path: string }) => void;
	onRename: () => Promise<string | null>;
	onDelete: () => Promise<void>;
}

class PlanDetailModal extends Modal {
	private subjectEl: HTMLElement | null = null;

	constructor(
		app: App,
		private options: PlanDetailOptions,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("harada-detail-modal");

		const header = contentEl.createDiv({ cls: "harada-detail-header" });
		header.createDiv({ text: "Key Plan", cls: "harada-detail-context" });
		const titleRow = header.createDiv({ cls: "harada-detail-title-row" });
		this.subjectEl = titleRow.createSpan({
			text: this.options.title,
			cls: "harada-detail-title harada-detail-title-static",
		});
		const actions = titleRow.createDiv({ cls: "harada-detail-title-actions" });
		const editBtn = actions.createEl("button", {
			cls: "clickable-icon harada-icon-btn",
			attr: { type: "button", "aria-label": "Rename Key Plan" },
		});
		setIcon(editBtn, "pencil");
		editBtn.addEventListener("click", () => {
			void this.renamePlan();
		});

		const body = contentEl.createDiv({ cls: "harada-detail-body" });
		body.createDiv({ text: "Actions", cls: "harada-section-label" });
		if (this.options.actions.length === 0) {
			body.createEl("p", { text: "No actions in this Key Plan yet.", cls: "harada-empty-hint" });
		} else {
			const list = body.createDiv({ cls: "harada-task-list" });
			for (const action of this.options.actions) {
				const row = list.createDiv({ cls: "harada-list-row harada-plan-row" });
				const label = row.createSpan({ text: action.name, cls: "harada-plan-row-label" });
				label.setAttr("role", "button");
				label.setAttr("tabindex", "0");
				const open = () => {
					this.close();
					this.options.onOpenAction(action);
				};
				label.addEventListener("click", open);
				label.addEventListener("keydown", (event) => {
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						open();
					}
				});
			}
		}

		const footer = contentEl.createDiv({ cls: "harada-detail-footer" });
		new Setting(footer).addButton((btn) =>
			btn
				.setButtonText("Delete Key Plan")
				.setDestructive()
				.onClick(() => {
					void this.deletePlan();
				}),
		);
	}

	onClose() {
		this.contentEl.empty();
	}

	private async renamePlan() {
		const next = await this.options.onRename();
		if (!next || !this.subjectEl) {
			return;
		}
		this.options.title = next;
		this.subjectEl.setText(next);
	}

	private async deletePlan() {
		const ok = await promptConfirm(
			this.app,
			"Delete Key Plan",
			`Move “${this.options.title}” and its action notes to the trash?`,
			"Delete",
		);
		if (!ok) {
			return;
		}
		this.close();
		await this.options.onDelete();
	}
}
