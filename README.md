# Harada Method Goals

An [Obsidian](https://obsidian.md) plugin that turns a vault folder into a Harada Method chart: **1 main goal, 8 Key Plans, and 64 actions**.

Open the master note `goals.md` in reading view. The 9×9 chart appears under the goal description. Click a cell to open that note, or to create it.

This is a fork of [Draw Harada Method](https://github.com/yildbs/obsidian-harada-method-plugin) by yildbs. It is a new plugin (`harada-method-goals`), not a drop-in replacement for the Community Plugin named “Draw Harada Method.”

## Install

1. Copy `main.js`, `manifest.json`, and `styles.css` into:

   `your-vault/.obsidian/plugins/harada-method-goals/`

   The folder name must be `harada-method-goals` (it has to match the plugin id).

2. In Obsidian: **Settings → Community plugins**. Turn off Restricted mode if it is on.
3. Enable **Harada Method Goals**. Reload the app if it does not appear.

If you previously used Draw Harada Method, leave that plugin as-is (or disable it). This one is separate.

## Create a goal

1. Open the command palette (`Cmd+P` / `Ctrl+P`).
2. Run **Create Harada goal**.
3. Enter a **Goal name** (for example `Marathon`).
4. Click **Create**. Obsidian opens `Marathon/goals.md` (or under the **Parent folder** from settings) and a **Harada chart** pane beside it.

The new note looks like:

~~~markdown
# Marathon

Describe this goal.

```goals
Marathon
```
~~~

Switch to **reading view** (`Cmd+E` / `Ctrl+E`, or the book icon), or use the ribbon **Harada chart** button so you can edit the note and click the grid at the same time.

You can also create the folder by hand: any folder that contains a note named `goals.md` with a `goals` code block is treated as a Harada goal.

## How the chart maps to files

```
Marathon/
  goals.md                 ← master note (center cell + description + goals block)
  Strength/                ← Key Plan folder
    Gym 3x week.md         ← action note
    Mobility work.md
  Nutrition/
    Meal prep.md
```

The plugin keeps the `goals` block in sync with that folder tree (for editing in source mode). Folders stay the source of truth.

| Chart cell | Vault item |
| --- | --- |
| Center (main goal) | First `# heading` in `goals.md`. The rest of the note is the description above the chart. |
| Key Plan (green cells) | Immediate child **folder** of the goal folder. |
| Action (white cells) | A markdown note inside a Key Plan folder. Files named `_plan.md` are ignored if they already exist. |

Rules:

- At most **8 Key Plans** and **8 actions per plan**. Extra folders and notes stay in the vault but are not shown.
- Drag cells on the chart to reorder them. Order is stored in the `goals` block. If there is no outline yet, names sort alphabetically.
- Empty cells say **Add plan** for Key Plans, or `-` for actions. Click a filled Key Plan to see its actions, rename it, or delete it; drag it to reorder.

You can keep several goals in the same vault. Each folder with its own `goals.md` is a separate chart.

## Use the chart

Open `goals.md` in **reading view**, or run **Open Harada chart** (ribbon grid icon). Then:

- **Click Add plan** — prompts for a name, creates the folder, updates the `goals` block, and stays on this note.
- **Click a filled Key Plan** — opens a popup of its actions. Use the edit button to rename the plan (renames the folder). Delete the Key Plan from that popup after confirmation. Drag the cell to reorder.
- **Click a filled action** — opens a popup of that note’s tasks. The list always includes a blank item. Edit or delete a task with the row buttons (delete asks for confirmation), or click the title to open the note. Delete the note from the popup after confirmation.
- **Click an empty action (`-`)** — prompts for a name, creates the note, then opens it beside the chart. If that 3×3 has no Key Plan yet, you are asked for the Key Plan name first.
- **Drag an action** onto another action cell to reorder, including onto another Key Plan (moves the file).
- **Hover** a shrunken label to see the full name. Action cells fill from the bottom as you check off tasks in the note. When every task is done, an X is drawn across that cell.
- **Center cell** — you are already on `goals.md`; it does not navigate.

The chart refreshes when files in that goal folder are created, renamed, or deleted. Cell labels wrap on words and shrink to fit the square.

### Edit the goal and tasks

- Change the **main goal title** by editing the first `# heading` in `goals.md`.
- Write the **goal description** in the body of `goals.md`, above the chart.
- Rename a Key Plan with the edit button in its popup, or by renaming its **folder** in the file explorer.
- Rename an action by renaming the **note**.
- Track work inside action notes. New actions start as:

```markdown
- [ ]
```

## Settings

**Settings → Harada Method Goals**

- **Master note filename** — default `goals.md`. The chart is drawn when you open a note with this name.
- **Parent folder** — vault-relative path where **Create Harada goal** puts new goal folders. Leave empty for the vault root.
- **Colors** — background and text for the goal, Key Plan, and action cells.

## Optional: sketch a chart in a code block

On `goals.md`, a `goals` block renders the **folder** chart (clickable empty Key Plans and actions).

In any other note, a `goals` (or `harada`) block with **two-space** indentation sketches a chart from text. That sketch does **not** create folders.

~~~markdown
```goals
Main goal
  Key plan 1
    Action 1
    Action 2
  Key plan 2
    Action 1
```
~~~

If a cell contains an Obsidian wikilink, it becomes clickable.

## What is the Harada Method?

The Harada Method (also called a Mandara chart, Mandal-art, or Open window 64 chart) breaks one goal into eight plans and each plan into eight actions.

Shohei Ohtani’s chart is a well-known example: [Shohei Ohtani, the Harada Method, and volleyball](https://jimstoneconsulting.com/shohei-ohtani-the-harada-method-and-volleyball/).

## Troubleshooting

**Plugin failed to load**

- Confirm the folder is `your-vault/.obsidian/plugins/harada-method-goals/` (not `draw-harada-method`).
- Confirm that folder contains `main.js`, `manifest.json`, and `styles.css`.
- Enable **Harada Method Goals**, not Draw Harada Method.
- Reload: Settings → Community plugins → toggle the plugin off and on, or **Reload app without saving**.

**Chart does not appear**

- Open `goals.md` in **reading view**, not source mode.
- The note filename must match Settings → Master note filename (default `goals.md`). Name the note `goals`, not `goals.md` (that becomes `goals.md.md` on disk).
- Confirm the note contains a `goals` code block.
- Or run **Open Harada chart** from the command palette.

**Clicks do nothing / cells do not create files**

- Use reading view.
- Empty cells say **Add plan** for Key Plans, or `-` for actions.
- Prefer the **Harada chart** pane if reading view still swallows clicks.
