import { App, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";

export const SLOT_COUNT = 8;
export const EMPTY_LABEL = "-";
export const ADD_PLAN_LABEL = "Add plan";
const IGNORED_ACTION_FILENAME = "_plan.md";

export interface GoalFolderSettings {
	masterNoteFilename: string;
	parentFolder: string;
}

export interface TaskProgress {
	done: number;
	total: number;
}

export interface ActionSlot {
	name: string | null;
	path: string | null;
	progress?: TaskProgress;
}

export interface KeyPlanSlot {
	index: number;
	name: string | null;
	folderPath: string | null;
	planPath: string | null;
	actions: ActionSlot[];
}

export interface GoalFolderScan {
	folderPath: string;
	masterPath: string;
	goalTitle: string;
	keyplans: KeyPlanSlot[];
}

export function isMasterNote(
	sourcePath: string,
	masterNoteFilename: string,
	configDir: string,
): boolean {
	if (!sourcePath) {
		return false;
	}
	if (sourcePath === configDir || sourcePath.startsWith(`${configDir}/`)) {
		return false;
	}
	const fileName = sourcePath.split("/").pop() ?? "";
	if (!fileName.toLowerCase().endsWith(".md")) {
		return false;
	}
	const have = fileName.slice(0, -3).toLowerCase();
	const want = masterNoteFilename.replace(/\.md$/i, "").toLowerCase();
	return have === want;
}

export function isMisnamedMasterNote(sourcePath: string, masterNoteFilename: string): boolean {
	if (!sourcePath) {
		return false;
	}
	const fileName = sourcePath.split("/").pop() ?? "";
	const want = masterNoteFilename.replace(/\.md$/i, "").toLowerCase();
	return fileName.toLowerCase() === `${want}.md.md`;
}

export function goalFolderPathFromMaster(masterPath: string): string {
	const idx = masterPath.lastIndexOf("/");
	return idx === -1 ? "" : masterPath.slice(0, idx);
}

export function sanitizeFilename(name: string): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]+/g, "-")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.replace(/\.+$/, "");
	return cleaned || "Untitled";
}

export function parseGoalTitle(content: string, fallback: string): string {
	const match = content.match(/^#\s+(.+?)\s*$/m);
	const title = match?.[1]?.trim();
	return title || fallback;
}

export function masterFilename(settings: GoalFolderSettings): string {
	const raw = settings.masterNoteFilename.trim() || "goals.md";
	return raw.toLowerCase().endsWith(".md") ? raw : `${raw}.md`;
}

function emptyActions(): ActionSlot[] {
	return Array.from({ length: SLOT_COUNT }, () => ({ name: null, path: null }));
}

function emptyKeyplans(): KeyPlanSlot[] {
	return Array.from({ length: SLOT_COUNT }, (_, index) => ({
		index,
		name: null,
		folderPath: null,
		planPath: null,
		actions: emptyActions(),
	}));
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
	return items.sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
	);
}

export function extractGoalsFenceBody(content: string): string {
	const match = content.match(/```(?:goals|harada)[^\n]*\n([\s\S]*?)```/);
	return match?.[1]?.replace(/\n$/, "") ?? "";
}

export function parseOutlineOrder(text: string): { keyplans: string[]; actions: Map<string, string[]> } {
	const keyplans: string[] = [];
	const actions = new Map<string, string[]>();
	let current: string | null = null;
	for (const raw of text.split("\n")) {
		const leading = raw.match(/^(\s*)/)?.[1].length ?? 0;
		const name = raw.trim();
		if (!name) {
			continue;
		}
		const level = leading / 2;
		if (!Number.isInteger(level)) {
			continue;
		}
		if (level === 1) {
			current = name;
			keyplans.push(name);
			if (!actions.has(name)) {
				actions.set(name, []);
			}
		} else if (level >= 2 && current) {
			const list = actions.get(current) ?? [];
			list.push(name);
			actions.set(current, list);
		}
	}
	return { keyplans, actions };
}

export interface OutlineRename {
	kind: "action" | "keyplan";
	oldName: string;
	newName: string;
	/** When set, only rename the action under this Key Plan. */
	keyplanName?: string;
}

/** Rewrite a goals-outline fence body so a rename keeps the same slot. */
export function applyOutlineRename(outlineText: string, rename: OutlineRename): string {
	const oldName = rename.oldName.trim();
	const newName = rename.newName.trim();
	if (!oldName || !newName || oldName.toLowerCase() === newName.toLowerCase()) {
		return outlineText;
	}

	const lines = outlineText.split("\n");
	let currentKeyplan: string | null = null;
	let replaced = false;

	const next = lines.map((raw) => {
		if (replaced) {
			return raw;
		}
		const leading = raw.match(/^(\s*)/)?.[1].length ?? 0;
		const name = raw.trim();
		if (!name) {
			return raw;
		}
		const level = leading / 2;
		if (!Number.isInteger(level)) {
			return raw;
		}
		if (level === 1) {
			currentKeyplan = name;
			if (rename.kind === "keyplan" && name.toLowerCase() === oldName.toLowerCase()) {
				replaced = true;
				return `${" ".repeat(leading)}${newName}`;
			}
			return raw;
		}
		if (rename.kind === "action" && level >= 2 && name.toLowerCase() === oldName.toLowerCase()) {
			if (
				rename.keyplanName &&
				currentKeyplan?.toLowerCase() !== rename.keyplanName.toLowerCase()
			) {
				return raw;
			}
			replaced = true;
			return `${" ".repeat(leading)}${newName}`;
		}
		return raw;
	});

	return next.join("\n");
}

export function outlineRenameFromPaths(
	oldPath: string,
	file: TAbstractFile,
): OutlineRename | null {
	const oldParts = oldPath.split("/").filter(Boolean);
	if (file instanceof TFile && file.extension === "md") {
		const oldFile = oldParts[oldParts.length - 1] ?? "";
		const oldName = oldFile.replace(/\.md$/i, "");
		const newName = file.basename;
		if (!oldName || oldName.toLowerCase() === newName.toLowerCase()) {
			return null;
		}
		const keyplanName = oldParts.length >= 2 ? oldParts[oldParts.length - 2] : undefined;
		return { kind: "action", oldName, newName, keyplanName };
	}
	if (file instanceof TFolder) {
		const oldName = oldParts[oldParts.length - 1] ?? "";
		const newName = file.name;
		if (!oldName || oldName.toLowerCase() === newName.toLowerCase()) {
			return null;
		}
		return { kind: "keyplan", oldName, newName };
	}
	return null;
}

export async function scanGoalFolderFromFile(
	app: App,
	masterPath: string,
	settings: GoalFolderSettings,
): Promise<GoalFolderScan | null> {
	const file = app.vault.getAbstractFileByPath(masterPath);
	let outline = "";
	if (file instanceof TFile) {
		outline = extractGoalsFenceBody(await app.vault.cachedRead(file));
	}
	const scan = scanGoalFolder(app, masterPath, settings, outline);
	if (scan) {
		await enrichTaskProgress(app, scan);
	}
	return scan;
}

async function enrichTaskProgress(app: App, scan: GoalFolderScan): Promise<void> {
	for (const keyplan of scan.keyplans) {
		for (const action of keyplan.actions) {
			if (!action.path) {
				continue;
			}
			const file = app.vault.getAbstractFileByPath(action.path);
			if (!(file instanceof TFile)) {
				continue;
			}
			action.progress = progressFromContent(await app.vault.cachedRead(file));
		}
	}
}

function progressFromContent(content: string): TaskProgress | undefined {
	const tasks = parseActionTasks(content).filter((task) => task.text.trim() !== "");
	if (tasks.length === 0) {
		return undefined;
	}
	return {
		done: tasks.filter((task) => task.checked).length,
		total: tasks.length,
	};
}

export function scanGoalFolder(
	app: App,
	masterPath: string,
	settings: GoalFolderSettings,
	outlineText = "",
): GoalFolderScan | null {
	if (!isMasterNote(masterPath, settings.masterNoteFilename, app.vault.configDir)) {
		return null;
	}

	const folderPath = goalFolderPathFromMaster(masterPath);
	const folder =
		folderPath === ""
			? app.vault.getRoot()
			: app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		return null;
	}

	const fallbackTitle = folderPath === "" ? "Goal" : folder.name;
	const masterFile = app.vault.getAbstractFileByPath(masterPath);
	let goalTitle = fallbackTitle;
	if (masterFile instanceof TFile) {
		const heading = app.metadataCache
			.getFileCache(masterFile)
			?.headings?.find((item) => item.level === 1)?.heading;
		goalTitle = heading?.trim() || fallbackTitle;
	}

	const ignoredPlan = IGNORED_ACTION_FILENAME.toLowerCase();
	const collected: KeyPlanSlot[] = sortByName(
		folder.children.filter((child): child is TFolder => child instanceof TFolder),
	).map((sub, index) => {
		const actionFiles = sortByName(
			sub.children.filter(
				(child): child is TFile =>
					child instanceof TFile &&
					child.extension === "md" &&
					child.name.toLowerCase() !== ignoredPlan,
			),
		);
		const actions = emptyActions();
		actionFiles.slice(0, SLOT_COUNT).forEach((file, actionIndex) => {
			actions[actionIndex] = {
				name: file.basename,
				path: file.path,
				progress: taskProgress(app, file),
			};
		});
		return {
			index,
			name: sub.name,
			folderPath: sub.path,
			planPath: null,
			actions,
		};
	});

	const keyplans = applyOutlineOrder(collected, parseOutlineOrder(outlineText));

	return {
		folderPath,
		masterPath,
		goalTitle,
		keyplans,
	};
}

function taskProgress(app: App, file: TFile): TaskProgress | undefined {
	const tasks = app.metadataCache
		.getFileCache(file)
		?.listItems?.filter((item) => item.task !== undefined && taskHasLabel(item));
	if (!tasks || tasks.length === 0) {
		return undefined;
	}
	const done = tasks.filter((item) => (item.task ?? " ").trim() !== "").length;
	return { done, total: tasks.length };
}

function taskHasLabel(item: { position: { start: { col: number }; end: { col: number } } }): boolean {
	return item.position.end.col - item.position.start.col > 6;
}

function applyOutlineOrder(
	collected: KeyPlanSlot[],
	outline: { keyplans: string[]; actions: Map<string, string[]> },
): KeyPlanSlot[] {
	const byName = new Map(collected.map((item) => [item.name!.toLowerCase(), item]));
	const ordered: KeyPlanSlot[] = [];
	const used = new Set<string>();
	for (const name of outline.keyplans) {
		const hit = byName.get(name.toLowerCase());
		if (!hit || used.has(hit.folderPath ?? "")) {
			continue;
		}
		used.add(hit.folderPath ?? "");
		ordered.push(orderActions(hit, outline.actions.get(name) ?? outline.actions.get(hit.name ?? "") ?? []));
	}
	for (const item of collected) {
		if (used.has(item.folderPath ?? "")) {
			continue;
		}
		used.add(item.folderPath ?? "");
		ordered.push(orderActions(item, outline.actions.get(item.name ?? "") ?? []));
	}
	const slots = emptyKeyplans();
	ordered.slice(0, SLOT_COUNT).forEach((item, index) => {
		slots[index] = { ...item, index };
	});
	return slots;
}

function orderActions(keyplan: KeyPlanSlot, names: string[]): KeyPlanSlot {
	const filled = keyplan.actions.filter((action): action is ActionSlot & { name: string; path: string } =>
		!!action.name && !!action.path,
	);
	const byName = new Map(filled.map((action) => [action.name.toLowerCase(), action]));
	const ordered: Array<ActionSlot | null> = [];
	const used = new Set<string>();
	for (const name of names) {
		const hit = byName.get(name.toLowerCase());
		if (!hit || used.has(hit.path)) {
			ordered.push(null);
			continue;
		}
		used.add(hit.path);
		ordered.push(hit);
	}

	const leftovers = filled.filter((action) => !used.has(action.path));
	const missing = ordered
		.map((action, index) => (action ? -1 : index))
		.filter((index) => index >= 0);

	// Single unmatched outline name + single unmatched file => treat as rename into that slot.
	if (missing.length === 1 && leftovers.length === 1) {
		ordered[missing[0]] = leftovers[0];
		leftovers.shift();
	}

	const compact: ActionSlot[] = [];
	for (const action of ordered) {
		if (action) {
			compact.push(action);
		}
	}
	for (const action of leftovers) {
		compact.push(action);
	}

	const actions = emptyActions();
	compact.slice(0, SLOT_COUNT).forEach((action, index) => {
		actions[index] = action;
	});
	return { ...keyplan, actions };
}

function uniquePath(app: App, parentPath: string, basename: string, asFolder: boolean): string {
	const fileName = asFolder ? basename : `${basename}.md`;
	const make = (n: string) =>
		normalizePath(parentPath === "" ? n : `${parentPath}/${n}`);

	let name = fileName;
	let path = make(name);
	let n = 2;
	while (app.vault.getAbstractFileByPath(path)) {
		name = asFolder ? `${basename} ${n}` : `${basename} ${n}.md`;
		path = make(name);
		n += 1;
	}
	return path;
}

export async function ensureFolder(app: App, path: string): Promise<TFolder> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing instanceof TFolder) {
		return existing;
	}
	if (existing) {
		throw new Error(`A file already exists at ${normalized}`);
	}
	const slash = normalized.lastIndexOf("/");
	if (slash > 0) {
		await ensureFolder(app, normalized.slice(0, slash));
	}
	await app.vault.createFolder(normalized);
	const created = app.vault.getAbstractFileByPath(normalized);
	if (!(created instanceof TFolder)) {
		throw new Error(`Could not create folder ${normalized}`);
	}
	return created;
}

export async function createKeyPlan(
	app: App,
	goalFolderPath: string,
	name: string,
): Promise<{ folderPath: string; name: string }> {
	const basename = sanitizeFilename(name);
	const folderPath = uniquePath(app, goalFolderPath, basename, true);
	await ensureFolder(app, folderPath);
	const folderName = folderPath.split("/").pop() ?? basename;
	return { folderPath, name: folderName };
}

export async function createActionNote(
	app: App,
	keyplanFolderPath: string,
	name: string,
): Promise<string> {
	const basename = sanitizeFilename(name);
	const path = uniquePath(app, keyplanFolderPath, basename, false);
	await app.vault.create(path, "- [ ] \n");
	return path;
}

const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\](\s?)(.*)$/;

interface TaskLineMatch {
	prefix: string;
	mark: string;
	text: string;
}

function matchTaskLine(line: string): TaskLineMatch | null {
	const match = TASK_LINE_RE.exec(line);
	if (!match) {
		return null;
	}
	const prefix = match[1];
	const mark = match[2];
	if (typeof prefix !== "string" || typeof mark !== "string") {
		return null;
	}
	const text = typeof match[4] === "string" ? match[4] : "";
	return { prefix, mark, text };
}

export interface ActionTaskLine {
	index: number;
	checked: boolean;
	text: string;
}

export function parseActionTasks(content: string): ActionTaskLine[] {
	const tasks: ActionTaskLine[] = [];
	const lines = content.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined) {
			continue;
		}
		const match = matchTaskLine(line);
		if (!match) {
			continue;
		}
		tasks.push({
			index,
			checked: match.mark.toLowerCase() === "x",
			text: match.text,
		});
	}
	return tasks;
}

export function toggleActionTaskLine(content: string, lineIndex: number): string {
	return updateActionTaskLine(content, lineIndex, { checked: "toggle" });
}

export function updateActionTaskLine(
	content: string,
	lineIndex: number,
	patch: { checked?: boolean | "toggle"; text?: string },
): string {
	const lines = content.split("\n");
	const line = lines[lineIndex];
	if (line === undefined) {
		return content;
	}
	const match = matchTaskLine(line);
	if (!match) {
		return content;
	}
	let checked = match.mark.toLowerCase() === "x";
	if (patch.checked === "toggle") {
		checked = !checked;
	} else if (typeof patch.checked === "boolean") {
		checked = patch.checked;
	}
	const text =
		patch.text === undefined ? match.text : patch.text.replace(/\s+/g, " ").trim();
	lines[lineIndex] = `${match.prefix}[${checked ? "x" : " "}] ${text}`.trimEnd();
	return lines.join("\n");
}

export function removeActionTaskLine(content: string, lineIndex: number): string {
	const lines = content.split("\n");
	if (lineIndex < 0 || lineIndex >= lines.length) {
		return content;
	}
	lines.splice(lineIndex, 1);
	return lines.join("\n");
}

export function appendActionTask(content: string, text = "", checked = false): string {
	const line = `- [${checked ? "x" : " "}] ${text.replace(/\s+/g, " ").trim()}`.trimEnd();
	const lines = content.split("\n");
	let lastTaskIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (TASK_LINE_RE.test(lines[i])) {
			lastTaskIdx = i;
		}
	}
	if (lastTaskIdx === -1) {
		const trimmed = content.trim();
		if (!trimmed) {
			return `${line}\n`;
		}
		return `${line}\n\n${trimmed}\n`;
	}
	lines.splice(lastTaskIdx + 1, 0, line);
	return lines.join("\n");
}

export function parseActionNotes(content: string): string {
	const lines = content.split("\n");
	let lastTaskIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (TASK_LINE_RE.test(lines[i])) {
			lastTaskIdx = i;
		}
	}
	if (lastTaskIdx === -1) {
		return content.trim();
	}
	return lines.slice(lastTaskIdx + 1).join("\n").trim();
}

export function updateActionNotes(content: string, notes: string): string {
	const lines = content.split("\n");
	let lastTaskIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (TASK_LINE_RE.test(lines[i])) {
			lastTaskIdx = i;
		}
	}
	const cleanNotes = notes.trim();
	if (lastTaskIdx === -1) {
		return cleanNotes ? `${cleanNotes}\n` : "";
	}
	const taskBlock = lines.slice(0, lastTaskIdx + 1).join("\n");
	if (!cleanNotes) {
		return `${taskBlock}\n`;
	}
	return `${taskBlock}\n\n${cleanNotes}\n`;
}

export async function deleteActionNote(app: App, path: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		await app.fileManager.trashFile(file);
	}
}

export async function deleteKeyPlanFolder(app: App, folderPath: string): Promise<void> {
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (folder instanceof TFolder) {
		await app.fileManager.trashFile(folder);
	}
}

export async function renameKeyPlanFolder(
	app: App,
	folderPath: string,
	newName: string,
): Promise<string> {
	const folder = app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		throw new Error("Could not find that Key Plan folder.");
	}
	const basename = sanitizeFilename(newName);
	if (!basename) {
		throw new Error("Enter a Key Plan name.");
	}
	if (folder.name === basename) {
		return folder.path;
	}
	const parent = folder.parent?.path ?? "";
	const dest = uniquePath(app, parent, basename, true);
	await app.fileManager.renameFile(folder, dest);
	return dest;
}

export async function renameActionNote(
	app: App,
	filePath: string,
	newName: string,
): Promise<string> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		throw new Error("Could not find that action note.");
	}
	const basename = sanitizeFilename(newName);
	if (!basename) {
		throw new Error("Enter an action name.");
	}
	if (file.basename === basename) {
		return file.path;
	}
	const parent = file.parent?.path ?? "";
	const dest = uniquePath(app, parent, basename, false);
	await app.fileManager.renameFile(file, dest);
	return dest;
}

export async function createGoalFolder(
	app: App,
	name: string,
	parentPath: string,
	settings: GoalFolderSettings,
): Promise<string> {
	const basename = sanitizeFilename(name);
	const parent = parentPath.trim() ? normalizePath(parentPath.trim()) : "";
	if (parent) {
		await ensureFolder(app, parent);
	}
	const folderPath = uniquePath(app, parent, basename, true);
	await ensureFolder(app, folderPath);
	const masterPath = normalizePath(`${folderPath}/${masterFilename(settings)}`);
	if (!app.vault.getAbstractFileByPath(masterPath)) {
		await app.vault.create(
			masterPath,
			`# ${basename}\n\nDescribe this goal.\n\n\`\`\`goals\n${basename}\n\`\`\`\n`,
		);
	}
	return masterPath;
}

export function outlineFromScan(scan: GoalFolderScan): string {
	const lines = [scan.goalTitle];
	for (const keyplan of scan.keyplans) {
		if (!keyplan.name || !keyplan.folderPath) {
			continue;
		}
		lines.push(`  ${keyplan.name}`);
		for (const action of keyplan.actions) {
			if (!action.name) {
				continue;
			}
			lines.push(`    ${action.name}`);
		}
	}
	return lines.join("\n");
}

const GOALS_FENCE_RE = /```(?:goals|harada)[^\n]*\n([\s\S]*?)```/;

export function upsertGoalsFence(content: string, outline: string): string {
	const body = `${outline}\n`;
	if (GOALS_FENCE_RE.test(content)) {
		return content.replace(GOALS_FENCE_RE, `\`\`\`goals\n${body}\`\`\``);
	}
	const trimmed = content.replace(/\s*$/, "");
	return `${trimmed}\n\n\`\`\`goals\n${body}\`\`\`\n`;
}

export async function syncGoalsOutline(
	app: App,
	masterPath: string,
	settings: GoalFolderSettings,
	rename?: OutlineRename,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(masterPath);
	if (!(file instanceof TFile)) {
		return;
	}
	let content = await app.vault.read(file);
	let outline = extractGoalsFenceBody(content);
	if (rename) {
		const patched = applyOutlineRename(outline, rename);
		if (patched !== outline) {
			outline = patched;
			content = upsertGoalsFence(content, patched);
		}
	}
	const scan = scanGoalFolder(app, masterPath, settings, outline);
	if (!scan) {
		return;
	}
	await enrichTaskProgress(app, scan);
	const next = upsertGoalsFence(content, outlineFromScan(scan));
	if (next !== content) {
		await app.vault.modify(file, next);
	}
}

export async function applyChartDrop(
	app: App,
	scan: GoalFolderScan,
	from: { kind: "keyplan" | "action"; keyplanIndex: number; actionIndex?: number },
	to: { kind: "keyplan" | "action"; keyplanIndex: number; actionIndex?: number },
	_settings: GoalFolderSettings,
): Promise<string | null> {
	if (from.kind !== to.kind) {
		return "Drop a Key Plan on a Key Plan, or an action on an action.";
	}
	if (from.kind === "keyplan") {
		const compact = scan.keyplans.filter((item) => item.folderPath);
		const fromItem = scan.keyplans[from.keyplanIndex];
		const toItem = scan.keyplans[to.keyplanIndex];
		if (!fromItem?.folderPath) {
			return "That Key Plan cannot be moved.";
		}
		const fromCompact = compact.findIndex((item) => item.folderPath === fromItem.folderPath);
		let toCompact = compact.findIndex((item) => item.folderPath === toItem?.folderPath);
		if (fromCompact < 0) {
			return "That Key Plan cannot be moved.";
		}
		if (toCompact < 0) {
			toCompact = compact.length;
		}
		const [moved] = compact.splice(fromCompact, 1);
		compact.splice(Math.min(toCompact, compact.length), 0, moved);
		scan.keyplans = padKeyplans(compact);
		await syncOutlineFromScan(app, scan);
		return null;
	}

	const fromKp = scan.keyplans[from.keyplanIndex];
	const toKp = scan.keyplans[to.keyplanIndex];
	const fromAct = fromKp?.actions[from.actionIndex ?? -1];
	if (!fromKp?.folderPath || !fromAct?.path || !fromAct.name) {
		return "That action cannot be moved.";
	}
	if (!toKp?.folderPath) {
		return "Create the destination Key Plan first.";
	}

	let destPath = fromAct.path;
	if (fromKp.folderPath !== toKp.folderPath) {
		const destActions = toKp.actions.filter((action) => action.path).length;
		if (destActions >= SLOT_COUNT) {
			return "That Key Plan already has eight actions.";
		}
		const file = app.vault.getAbstractFileByPath(fromAct.path);
		if (!(file instanceof TFile)) {
			return "Could not find that action note.";
		}
		destPath = uniquePath(app, toKp.folderPath, fromAct.name, false);
		await app.fileManager.renameFile(file, destPath);
	}

	const sourceCompact = compactActions(fromKp);
	const destCompact = fromKp.folderPath === toKp.folderPath ? sourceCompact : compactActions(toKp);
	const fromIdx = sourceCompact.findIndex((action) => action.path === fromAct.path);
	if (fromIdx < 0) {
		return "That action cannot be moved.";
	}
		const [moved] = sourceCompact.splice(fromIdx, 1);
		moved.path = destPath;
		const toAct = toKp.actions[to.actionIndex ?? -1];
		const destList = fromKp.folderPath === toKp.folderPath ? sourceCompact : destCompact;
		let toIdx = toAct?.path
			? destList.findIndex((action) => action.path === toAct.path)
			: destList.length;
		if (toIdx < 0) {
			toIdx = destList.length;
		}
		if (fromKp.folderPath === toKp.folderPath && fromIdx < toIdx) {
			toIdx -= 1;
		}
		destList.splice(Math.min(toIdx, destList.length), 0, moved);
		fromKp.actions = padActions(sourceCompact);
		if (fromKp.folderPath !== toKp.folderPath) {
			toKp.actions = padActions(destCompact);
		}
	scan.keyplans = padKeyplans(scan.keyplans.filter((item) => item.folderPath));
	await syncOutlineFromScan(app, scan);
	return null;
}

async function syncOutlineFromScan(app: App, scan: GoalFolderScan): Promise<void> {
	const file = app.vault.getAbstractFileByPath(scan.masterPath);
	if (!(file instanceof TFile)) {
		return;
	}
	const content = await app.vault.read(file);
	const next = upsertGoalsFence(content, outlineFromScan(scan));
	if (next !== content) {
		await app.vault.modify(file, next);
	}
}

function compactActions(keyplan: KeyPlanSlot): ActionSlot[] {
	return keyplan.actions.filter((action) => !!action.path);
}

function padActions(list: ActionSlot[]): ActionSlot[] {
	const actions = emptyActions();
	list.slice(0, SLOT_COUNT).forEach((action, index) => {
		actions[index] = action;
	});
	return actions;
}

function padKeyplans(list: KeyPlanSlot[]): KeyPlanSlot[] {
	const slots = emptyKeyplans();
	list.slice(0, SLOT_COUNT).forEach((item, index) => {
		slots[index] = { ...item, index };
	});
	return slots;
}

export function pathIsUnderGoalFolder(filePath: string, goalFolderPath: string): boolean {
	if (goalFolderPath === "") {
		return true;
	}
	return filePath === goalFolderPath || filePath.startsWith(`${goalFolderPath}/`);
}
