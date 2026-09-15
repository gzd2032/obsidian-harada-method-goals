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

export interface OutlineKeyplanSlot {
	/** Null means an intentional empty Key Plan slot (`-` in the outline). */
	name: string | null;
	actions: Array<string | null>;
}

export function parseOutlineOrder(text: string): OutlineKeyplanSlot[] {
	const keyplans: OutlineKeyplanSlot[] = [];
	let current: OutlineKeyplanSlot | null = null;
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
			current = {
				name: name === EMPTY_LABEL ? null : name,
				actions: [],
			};
			keyplans.push(current);
		} else if (level >= 2 && current) {
			current.actions.push(name === EMPTY_LABEL ? null : name);
		}
	}
	return keyplans;
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

type OrderedKeyplan =
	| { kind: "empty" }
	| { kind: "miss"; actions: Array<string | null> }
	| { kind: "hit"; keyplan: KeyPlanSlot };

function applyOutlineOrder(collected: KeyPlanSlot[], outline: OutlineKeyplanSlot[]): KeyPlanSlot[] {
	const byName = new Map(
		collected
			.filter((item): item is KeyPlanSlot & { name: string; folderPath: string } => !!item.name && !!item.folderPath)
			.map((item) => [item.name.toLowerCase(), item]),
	);
	const ordered: OrderedKeyplan[] = [];
	const used = new Set<string>();

	for (const slot of outline) {
		if (!slot.name) {
			ordered.push({ kind: "empty" });
			continue;
		}
		const hit = byName.get(slot.name.toLowerCase());
		if (!hit || used.has(hit.folderPath)) {
			ordered.push({ kind: "miss", actions: slot.actions });
			continue;
		}
		used.add(hit.folderPath);
		ordered.push({ kind: "hit", keyplan: orderActions(hit, slot.actions) });
	}

	const leftovers = collected.filter(
		(item): item is KeyPlanSlot & { folderPath: string } => !!item.folderPath && !used.has(item.folderPath),
	);
	const missIndexes = ordered
		.map((slot, index) => (slot.kind === "miss" ? index : -1))
		.filter((index) => index >= 0);

	// Single unmatched outline name + single unmatched folder => rename into that slot.
	if (missIndexes.length === 1 && leftovers.length === 1) {
		const missAt = missIndexes[0];
		const miss = ordered[missAt];
		if (miss?.kind === "miss") {
			ordered[missAt] = { kind: "hit", keyplan: orderActions(leftovers[0], miss.actions) };
			used.add(leftovers[0].folderPath);
			leftovers.shift();
		}
	}

	for (let i = 0; i < ordered.length; i++) {
		if (ordered[i]?.kind === "miss") {
			ordered[i] = { kind: "empty" };
		}
	}

	for (const leftover of leftovers) {
		const emptyAt = ordered.findIndex((slot) => slot.kind === "empty");
		if (emptyAt >= 0) {
			ordered[emptyAt] = { kind: "hit", keyplan: orderActions(leftover, []) };
		} else {
			ordered.push({ kind: "hit", keyplan: orderActions(leftover, []) });
		}
	}

	const slots = emptyKeyplans();
	ordered.slice(0, SLOT_COUNT).forEach((slot, index) => {
		if (slot.kind === "hit") {
			slots[index] = { ...slot.keyplan, index };
		}
	});
	return slots;
}

type OrderedAction =
	| { kind: "empty" }
	| { kind: "miss" }
	| { kind: "hit"; action: ActionSlot & { name: string; path: string } };

function orderActions(keyplan: KeyPlanSlot, names: Array<string | null>): KeyPlanSlot {
	const filled = keyplan.actions.filter((action): action is ActionSlot & { name: string; path: string } =>
		!!action.name && !!action.path,
	);
	const byName = new Map(filled.map((action) => [action.name.toLowerCase(), action]));
	const ordered: OrderedAction[] = [];
	const used = new Set<string>();

	for (const name of names) {
		if (name === null) {
			ordered.push({ kind: "empty" });
			continue;
		}
		const hit = byName.get(name.toLowerCase());
		if (!hit || used.has(hit.path)) {
			ordered.push({ kind: "miss" });
			continue;
		}
		used.add(hit.path);
		ordered.push({ kind: "hit", action: hit });
	}

	const leftovers = filled.filter((action) => !used.has(action.path));
	const missIndexes = ordered
		.map((slot, index) => (slot.kind === "miss" ? index : -1))
		.filter((index) => index >= 0);

	if (missIndexes.length === 1 && leftovers.length === 1) {
		ordered[missIndexes[0]] = { kind: "hit", action: leftovers[0] };
		leftovers.shift();
	} else {
		for (const index of missIndexes) {
			ordered[index] = { kind: "empty" };
		}
	}

	const actions = emptyActions();
	for (let i = 0; i < ordered.length && i < SLOT_COUNT; i++) {
		const slot = ordered[i];
		if (slot?.kind === "hit") {
			actions[i] = slot.action;
		}
	}
	for (const leftover of leftovers) {
		const emptyAt = actions.findIndex((action) => !action.path);
		if (emptyAt === -1) {
			break;
		}
		actions[emptyAt] = leftover;
	}
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
	const prefixRaw = match[1];
	const markRaw = match[2];
	if (typeof prefixRaw !== "string" || typeof markRaw !== "string") {
		return null;
	}
	const prefix: string = prefixRaw;
	const mark: string = markRaw;
	const textRaw = match[4];
	const text: string = typeof textRaw === "string" ? textRaw : "";
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
	const text: string =
		patch.text === undefined ? match.text : patch.text.replace(/\s+/g, " ").trim();
	const mark = checked ? "x" : " ";
	const nextLine: string = `${match.prefix}[${mark}] ${text}`.replace(/\s+$/, "");
	lines[lineIndex] = nextLine;
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

function lastTaskLineIndex(lines: string[]): number {
	let lastTaskIdx = -1;
	for (let i = 0; i < lines.length; i++) {
		const candidate = lines[i];
		if (candidate !== undefined && TASK_LINE_RE.test(candidate)) {
			lastTaskIdx = i;
		}
	}
	return lastTaskIdx;
}

export function appendActionTask(content: string, text = "", checked = false): string {
	const label: string = text.replace(/\s+/g, " ").trim();
	const mark = checked ? "x" : " ";
	const line: string = `- [${mark}] ${label}`.replace(/\s+$/, "");
	const lines = content.split("\n");
	const lastTaskIdx = lastTaskLineIndex(lines);
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
	const lastTaskIdx = lastTaskLineIndex(lines);
	if (lastTaskIdx === -1) {
		return content.trim();
	}
	return lines.slice(lastTaskIdx + 1).join("\n").trim();
}

export function updateActionNotes(content: string, notes: string): string {
	const lines = content.split("\n");
	const lastTaskIdx = lastTaskLineIndex(lines);
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
	let lastKeyplan = -1;
	for (let i = 0; i < scan.keyplans.length; i++) {
		if (scan.keyplans[i]?.folderPath) {
			lastKeyplan = i;
		}
	}
	for (let i = 0; i <= lastKeyplan; i++) {
		const keyplan = scan.keyplans[i];
		if (!keyplan?.name || !keyplan.folderPath) {
			lines.push(`  ${EMPTY_LABEL}`);
			continue;
		}
		lines.push(`  ${keyplan.name}`);
		let lastAction = -1;
		for (let j = 0; j < keyplan.actions.length; j++) {
			if (keyplan.actions[j]?.name && keyplan.actions[j]?.path) {
				lastAction = j;
			}
		}
		for (let j = 0; j <= lastAction; j++) {
			const action = keyplan.actions[j];
			lines.push(
				`    ${action?.name && action.path ? action.name : EMPTY_LABEL}`,
			);
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
		if (from.keyplanIndex === to.keyplanIndex) {
			return null;
		}
		const fromItem = scan.keyplans[from.keyplanIndex];
		if (!fromItem?.folderPath) {
			return "That Key Plan cannot be moved.";
		}
		const empty = emptyKeyplans()[to.keyplanIndex] ?? emptyKeyplans()[0];
		const toItem = scan.keyplans[to.keyplanIndex] ?? empty;
		scan.keyplans[from.keyplanIndex] = {
			...toItem,
			index: from.keyplanIndex,
		};
		scan.keyplans[to.keyplanIndex] = {
			...fromItem,
			index: to.keyplanIndex,
		};
		await syncOutlineFromScan(app, scan);
		return null;
	}

	if (
		from.actionIndex === undefined ||
		to.actionIndex === undefined ||
		from.actionIndex < 0 ||
		to.actionIndex < 0 ||
		from.actionIndex >= SLOT_COUNT ||
		to.actionIndex >= SLOT_COUNT
	) {
		return "That action cannot be moved.";
	}
	if (from.keyplanIndex === to.keyplanIndex && from.actionIndex === to.actionIndex) {
		return null;
	}

	const fromKp = scan.keyplans[from.keyplanIndex];
	const toKp = scan.keyplans[to.keyplanIndex];
	const fromAct = fromKp?.actions[from.actionIndex];
	if (!fromKp?.folderPath || !fromAct?.path || !fromAct.name) {
		return "That action cannot be moved.";
	}
	if (!toKp?.folderPath) {
		return "Create the destination Key Plan first.";
	}

	const filledFrom: ActionSlot & { name: string; path: string } = {
		name: fromAct.name,
		path: fromAct.path,
		progress: fromAct.progress,
	};
	const toAct = toKp.actions[to.actionIndex] ?? { name: null, path: null };
	const error = await swapActionFiles(
		app,
		fromKp,
		from.actionIndex,
		filledFrom,
		toKp,
		to.actionIndex,
		toAct,
	);
	if (error) {
		return error;
	}
	await syncOutlineFromScan(app, scan);
	return null;
}

async function swapActionFiles(
	app: App,
	fromKp: KeyPlanSlot,
	fromIdx: number,
	fromAct: ActionSlot & { name: string; path: string },
	toKp: KeyPlanSlot,
	toIdx: number,
	toAct: ActionSlot,
): Promise<string | null> {
	if (fromKp.folderPath === toKp.folderPath) {
		fromKp.actions[fromIdx] = {
			name: toAct.name,
			path: toAct.path,
			progress: toAct.progress,
		};
		toKp.actions[toIdx] = {
			name: fromAct.name,
			path: fromAct.path,
			progress: fromAct.progress,
		};
		return null;
	}

	const fromFile = app.vault.getAbstractFileByPath(fromAct.path);
	if (!(fromFile instanceof TFile)) {
		return "Could not find that action note.";
	}

	if (toAct.path && toAct.name) {
		const toFile = app.vault.getAbstractFileByPath(toAct.path);
		if (!(toFile instanceof TFile)) {
			return "Could not find the destination action note.";
		}
		const tempPath = uniquePath(app, fromKp.folderPath ?? "", `${fromAct.name} swap-tmp`, false);
		await app.fileManager.renameFile(fromFile, tempPath);
		const toNewPath = uniquePath(app, fromKp.folderPath ?? "", toAct.name, false);
		await app.fileManager.renameFile(toFile, toNewPath);
		const tempFile = app.vault.getAbstractFileByPath(tempPath);
		if (!(tempFile instanceof TFile)) {
			return "Could not finish swapping those actions.";
		}
		const fromNewPath = uniquePath(app, toKp.folderPath ?? "", fromAct.name, false);
		await app.fileManager.renameFile(tempFile, fromNewPath);
		fromKp.actions[fromIdx] = {
			name: toAct.name,
			path: toNewPath,
			progress: toAct.progress,
		};
		toKp.actions[toIdx] = {
			name: fromAct.name,
			path: fromNewPath,
			progress: fromAct.progress,
		};
		return null;
	}

	const fromNewPath = uniquePath(app, toKp.folderPath ?? "", fromAct.name, false);
	await app.fileManager.renameFile(fromFile, fromNewPath);
	fromKp.actions[fromIdx] = { name: null, path: null };
	toKp.actions[toIdx] = {
		name: fromAct.name,
		path: fromNewPath,
		progress: fromAct.progress,
	};
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

export function pathIsUnderGoalFolder(filePath: string, goalFolderPath: string): boolean {
	if (goalFolderPath === "") {
		return true;
	}
	return filePath === goalFolderPath || filePath.startsWith(`${goalFolderPath}/`);
}
