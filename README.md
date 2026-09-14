# Harada Method Goals

An [Obsidian](https://obsidian.md) plugin that visualizes your goals using the Harada Method (also known as a Mandal-art or 64-chart matrix): **1 main goal, 8 Key Plans, and 64 Action items**.

Your vault folders and notes are the source of truth. The 9×9 matrix generates directly from your files with interactive task checklists, progress tracking, and drag-and-drop reordering.

---

## Quick Start

### 1. Create a New Goal Chart
1. Press `Cmd+P` (macOS) or `Ctrl+P` (Windows/Linux) to open the Command Palette.
2. Type and select **Harada Method Goals: Create Harada goal**.
3. Enter your goal name (for example, `Marathon`) and press `Enter` (or click **Create**).
4. Obsidian creates the goal folder, master `goals.md` note, and opens the **Harada chart** view beside it.

### 2. View and Open the Chart
You can display the 9×9 interactive chart in two ways:
- **Dedicated View Pane**: Press `Cmd+P` / `Ctrl+P`, select **Harada Method Goals: Open Harada chart**, or click the grid icon on the left ribbon.
- **In the Note**: Open your `goals.md` note and switch to **Reading view** (`Cmd+E` / `Ctrl+E`).

---

## How It Maps to Your Vault

The 9×9 chart corresponds directly to your vault's folders and markdown files:

```text
Goal Folder (e.g. Marathon)/
  goals.md                 ← Master note (Center goal + description + goals block)
  Strength/                ← Key Plan folder (surrounding 3×3 center)
    Gym 3x week.md         ← Action note
    Mobility.md
  Nutrition/               ← Key Plan folder
    Meal prep.md
```

| Chart Cell | Vault Item | Interaction |
| --- | --- | --- |
| **Center Goal** (Yellow) | First `# heading` in `goals.md` | Main goal title. Note body serves as description. |
| **Key Plans** (Green) | Immediate child folders | Click to view actions or rename/delete the plan. Drag to reorder. |
| **Actions** (White) | Markdown notes inside Key Plan folders | Click to open popup (tasks, notes, rename). Click title to open note. Drag to reorder or move between plans. |

---

## Features

- **Add Plans & Actions Directly**: Click any empty cell (`Add plan` or `-`) to create a folder or action note without leaving the chart.
- **Task & Notes Popup**: Click any filled action cell to manage `- [ ]` checklist items, edit notes, or rename the action.
- **Visual Progress & Completion**: Action cells fill upward as tasks are completed. When all tasks in a note are done, an **X** is drawn across the cell.
- **Drag-and-Drop Reordering**: Drag Key Plans or actions to rearrange them. Dragging an action to another Key Plan moves the note to that folder.
- **Live Outline Sync**: Custom chart order is maintained in the `goals` code block within `goals.md`.

---

## Settings

Go to **Settings → Harada Method Goals** to configure:
- **Master note filename**: Default is `goals.md`.
- **Parent folder**: Vault-relative folder where new goals are created (leave empty for vault root).
- **Colors**: Customize background and text colors for Goal, Key Plan, and Action cells.

---

## Installation

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `harada-method-goals` in your vault plugins directory:
   `<vault>/.obsidian/plugins/harada-method-goals/`
3. Copy `main.js`, `manifest.json`, and `styles.css` into that directory.
4. In Obsidian, go to **Settings → Community plugins**, turn off Restricted mode if enabled, and toggle on **Harada Method Goals**.

---

## License

MIT License. Forked and expanded from [Draw Harada Method](https://github.com/yildbs/obsidian-harada-method-plugin) by yildbs.
