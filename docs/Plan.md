# TRANSFER SETTINGS TOTAL UI REDESIGN PLAN

**Status:** Authoritative implementation plan  
**Scope:** Frontend total redesign for Transfer Settings and its direct UI workflow  
**Primary target:** React + TypeScript UI used inside `Drive Tools & Settings`  
**Prepared from:** `index.tsx`, `DriveTransferSettings.tsx`, `TransferOrchestrationSettings.tsx`, `encoderHardwareOptions.ts`, `TransferPreflightDialog.tsx`, `DriveTransferManager.tsx`, `DriveTopBar.tsx`, `DriveExplorer.tsx`, `toolsUtils.ts`, `DuplicatesTab.tsx`, `SpaceUsageTab.tsx`, and the supplied UI screenshot.

---

# 0. EXECUTION CONTRACT FOR THE IMPLEMENTING AGENT

> **THIS FILE IS THE FINAL IMPLEMENTATION PLAN. USE IT DIRECTLY.**

The implementing agent must obey all rules below.

1. **Do not create a new plan.**
2. **Do not rewrite this file.**
3. **Do not replace this file with a shorter or simplified plan.**
4. **Do not create another `PLAN.md`, `IMPLEMENTATION_PLAN.md`, or equivalent planning file.**
5. **Do not summarize this plan before implementation.**
6. **Do not change the agreed information architecture without an actual technical blocker.**
7. **Do not reintroduce separate Hardware Reencode and Encoder Strategy controls.**
8. **Do not keep two independent Transfer Settings implementations.**
9. **Do not delete existing transfer capabilities merely to simplify the UI.**
10. **Do not alter backend behavior unless the existing frontend contract cannot support a required state. Verify first.**
11. **Execute the phases and tasks in the order written below.**
12. **Use the checklist in this document as the task tracker. Mark completed items only.**
13. **When implementation reveals a blocker, append it to the Progress and Blockers section. Do not overwrite the plan.**
14. **Preserve existing i18n architecture. Do not hardcode final production labels in only one language.**
15. **Preserve saved settings and profiles through normalization and migration.**
16. **Run type checking, linting, focused tests, and visual checks before declaring completion.**

The agent may make small implementation-level decisions, such as exact component prop names, only when they do not change the architecture, workflows, responsive rules, or acceptance criteria in this document.

---

# 1. PRODUCT GOAL

Redesign Transfer Settings into a modern, elegant, clear, and responsive settings workspace. The new interface must help casual users complete common tasks quickly while preserving advanced controls for power users.

The final experience must feel like one coherent product. It must not feel like a long technical form placed inside a modal.

The redesign must achieve these outcomes:

- One canonical Transfer Settings implementation.
- Clear separation between Upload, Download, and Profiles.
- A compact Basic mode for common settings.
- An Advanced mode for orchestration, routing, large-file policy, and encoder tuning.
- One unified Video Encoding Mode control.
- Hardware choices based on real detected capability data.
- Clear validation, warnings, dirty state, reset behavior, and save behavior.
- Full responsiveness from large desktop to small mobile.
- Consistent workflow from settings, preflight, transfer execution, and transfer monitoring.
- Strong accessibility for keyboard, screen reader, focus, and touch use.

---

# 2. CURRENT STATE AUDIT

## 2.1 High-impact architectural problems

| ID | Finding | Impact | Required correction |
|---|---|---|---|
| A-01 | Transfer Settings is implemented twice, once in `DriveTransferSettings.tsx` and again as `TransferTabContent` inside `index.tsx`. | Logic, labels, limits, and UI behavior drift apart. | Create one shared Transfer Settings workspace and use it everywhere. |
| A-02 | The embedded tools version still exposes the old Hardware Reencode selector, while `TransferOrchestrationSettings.tsx` exposes the old seven-option Encoder Strategy selector. | Users can create conflicting combinations. | Replace both with one unified four-mode encoding control. |
| A-03 | The standalone implementation already attempts a four-mode encoder UI, but the embedded implementation shown in the product remains different. | The redesign is incomplete and inconsistent. | Make the embedded tools panel use the same shared component. |
| A-04 | Profile management is a dedicated tab in one implementation and a large permanent card in the other. | Layout and workflow differ depending on entry point. | Use one Profiles tab and one compact active-profile control. |
| A-05 | Advanced orchestration reset also resets encoder settings. | Resetting an album section can unexpectedly change video processing behavior. | Split reset actions by section and scope. |
| A-06 | Global element IDs are reused across implementations, such as `transfer-orchestration`. | Search navigation can scroll to the wrong instance. | Use component refs or scoped IDs generated with `useId`. |
| A-07 | Caption limits differ. The standalone path permits 65,536 characters while the embedded path clamps and displays 1,024. | Saved behavior depends on entry point. | Resolve one source of truth from the current Telegram or backend contract and use it everywhere. |
| A-08 | Hardware options include CPU in the same hardware dropdown. | The mental model conflicts with the proposed Hardware and Software separation. | Hardware list must contain Auto GPU and detected GPU encoders only. CPU belongs to Software mode. |
| A-09 | The standalone Software mode sets `encoderAllowSoftwareFallback: true`. | Fallback is meaningless when software is the forced primary and only path. | Normalize Software mode to CPU-only semantics. |
| A-10 | Closing, resetting, loading a profile, or deleting a profile lacks complete dirty-state protection. | Users can lose unsaved changes. | Add dirty-state confirmation and safe action flows. |

## 2.2 Current layout and usability problems

| Area | Current issue | User effect |
|---|---|---|
| Modal shell | Large left sidebar plus nested tab bar plus intro card plus profile card consumes significant space. | The actual settings area becomes visually secondary. |
| Content flow | Settings appear as a long sequence of headings, hints, radios, sliders, and checkboxes. | Weak grouping and high cognitive load. |
| Profile controls | Select, text input, save, delete, and search remain visible above all settings. | Too much vertical space is used before the first meaningful setting. |
| Encoder controls | Technical behavior is spread across the upload section and orchestration section. | Users cannot predict which setting has priority. |
| Advanced options | Album, routing, oversize, send-as, spoiler positions, and encoder tuning are shown as one long block. | Power features are difficult to scan and risky to edit. |
| Footer | Save and reset behavior differs between implementations. | User confidence decreases. |
| Search | Search only matches a small static list of section labels. | Many settings cannot be found. |
| Responsive behavior | The current desktop-first panel depends on wide fixed regions. | Tablet and mobile layouts risk narrow content, clipped controls, and excessive scrolling. |
| Transfer-active state | Most settings become disabled without a strong explanation. | Users may not understand whether settings apply now or to the next job. |

## 2.3 Existing strengths that must be preserved

- The `Drive Tools & Settings` shell provides a clear product-level location for tools.
- Upload and Download are already separated conceptually.
- The interface already supports draft settings and explicit save.
- Profile persistence already exists.
- Hardware capability data already flows through `useTransferHardwareCapabilities`.
- Preflight already provides item-level decisions and warnings.
- Transfer Manager already displays encoder information, progress, fallback details, and logs.
- i18n is already integrated.
- The current dark theme and cyan accent match the product identity.

---

# 3. FINAL INFORMATION ARCHITECTURE

## 3.1 Canonical entry point

The canonical entry point is **Drive Tools & Settings > Configuration > Transfer Settings**.

`DriveTopBar.tsx` may keep a direct Transfer Settings button, but that button must open the same `DriveToolsPanel` with the `transfer` tab selected. It must not open a separately maintained implementation.

The standalone `DriveTransferSettings.tsx` must become one of the following:

1. A thin modal wrapper around the shared Transfer Settings workspace, only if another route still requires a standalone modal.
2. Removed after all callers use the canonical tools panel.

It must not retain separate settings logic.

## 3.2 Top-level sections

The Transfer Settings workspace contains three top-level tabs:

1. **Upload**
2. **Download**
3. **Profiles**

The active tab must persist while the tools panel stays open. Opening Transfer Settings for the first time in a new session may default to Upload.

## 3.3 Basic and Advanced modes

A segmented mode control appears in the Transfer Settings header:

```text
[ Basic ] [ Advanced ]
```

Basic mode is the default. Advanced mode exposes additional sections without replacing the basic controls.

### Basic Upload sections

1. Upload quality and presentation.
2. Video processing.
3. Performance.
4. Delivery behavior.
5. Default caption.

### Advanced Upload sections

1. Album and grouping.
2. Failure recovery.
3. Large-file handling.
4. Scheduling and delivery identity.
5. Encoder resource tuning.
6. Item-level spoiler targeting.

### Basic Download sections

1. Download performance.
2. Existing-file behavior.
3. Resume and completion notification.

### Advanced Download sections

1. Integrity verification.
2. Recovery and partial-file behavior.
3. Future download routing options, only when actually supported.

### Profiles sections

1. Recommended system presets.
2. User profiles.
3. Current draft summary.
4. Import or export only if the application already supports it. Do not invent unsupported persistence.

---

# 4. TARGET DESKTOP LAYOUT

## 4.1 Overall tools shell

```text
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Drive Tools & Settings                                      [Close]        â”‚
â”‚ Saved Messages                                                             â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ DRIVE TOOLS          â”‚ Transfer Settings                                   â”‚
â”‚ Batch Copy           â”‚ Configure upload, download, and processing policy.  â”‚
â”‚ Duplicates           â”‚                                                     â”‚
â”‚ Bulk Rename          â”‚ [Upload] [Download] [Profiles]     [Basic|Advanced] â”‚
â”‚ Space Usage          â”‚                                                     â”‚
â”‚ Advanced Filter      â”‚ Active profile: Recommended       [Search]          â”‚
â”‚                      â”‚                                                     â”‚
â”‚ CONFIGURATION        â”‚ â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚ Transfer Settings    â”‚ â”‚ Settings cards                                  â”‚ â”‚
â”‚                      â”‚ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                      â”‚                                                     â”‚
â”‚                      â”‚ [Reset section/default]        [Cancel] [Save]     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

## 4.2 Desktop sizing rules

| Property | Target |
|---|---|
| Modal width | `min(1220px, calc(100vw - 48px))` |
| Modal height | `min(900px, calc(100dvh - 48px))` |
| Sidebar width | 228 to 248 px |
| Content max readable width | 900 px |
| Main content padding | 24 px |
| Card gap | 16 px |
| Header height | 72 to 80 px |
| Footer minimum height | 72 px |

The main settings content must not stretch uncontrolled across very wide screens. Keep cards readable and centered in the available main column.

## 4.3 Header hierarchy

The Transfer Settings content header contains:

- Icon and title.
- One-line description.
- Active profile chip.
- Unsaved changes indicator.
- Basic and Advanced segmented control.
- Search button or search field depending on width.

Avoid showing file-count badges in the Transfer Settings header unless they affect the settings being edited. Location and file-count metadata belong in the global tools shell intro, not inside every settings card.

---

# 5. RESPONSIVE LAYOUT SPECIFICATION

## 5.1 Breakpoint matrix

| Range | Layout | Navigation | Settings cards | Footer |
|---|---|---|---|---|
| `>= 1280px` | Centered desktop modal | Permanent left sidebar | Two-column only for compatible compact cards | Sticky inside modal |
| `1024px to 1279px` | Wide laptop modal | Permanent 216 px sidebar | Mostly single column, compact paired fields allowed | Sticky inside modal |
| `768px to 1023px` | Near full-screen dialog | Sidebar collapses into a top tool-category bar or drawer | Single column | Sticky bottom bar |
| `480px to 767px` | Full-screen dialog | Tool categories in drawer, Transfer subtabs horizontally scrollable | Single column, full-width controls | Fixed safe-area bottom bar |
| `< 480px` | Full-screen mobile sheet | Compact app bar and drawer | Single column, no side-by-side form rows | Full-width primary action |

## 5.2 Tablet behavior

At widths below 1024 px:

- Hide the permanent tools sidebar.
- Add a menu button in the global header.
- Open tools navigation as an accessible drawer.
- Keep Upload, Download, and Profiles in a sticky horizontal segmented tab row.
- Move Basic and Advanced control below the title if the title row becomes crowded.
- Remove nonessential descriptive text from the sticky region.
- Keep the settings content at full available width.

## 5.3 Mobile behavior

At widths below 768 px:

- Use `100vw` and `100dvh`.
- Remove outer modal radius when the dialog fills the screen.
- Respect `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- Use a compact top app bar with back or close button.
- Make every interactive target at least 44 by 44 px.
- Stack label, help text, and control vertically.
- Use full-width dropdowns and buttons.
- Convert desktop radio-card grids into one-column selectable cards.
- Keep the save bar fixed to the bottom and add enough content padding so the last field is not covered.
- Use a compact search overlay rather than a permanently visible search field.
- Use bottom sheets for destructive confirmation and profile actions.

## 5.4 Height-constrained screens

For laptop screens with limited height and mobile landscape:

- The header and footer remain fixed within the dialog.
- Only the main content scrolls.
- Avoid nested scrolling regions inside settings cards.
- Search results must not create a second large scroll container.
- Expanded advanced sections may collapse automatically only after explicit user action, not during input.

---

# 6. VISUAL DESIGN SYSTEM

## 6.1 Visual direction

Use a modern, restrained dark interface. The design must feel professional and precise rather than decorative.

Principles:

- Clear surface hierarchy.
- Subtle borders.
- One dominant cyan or blue accent.
- Color reserved for selection, status, and risk.
- Minimal gradients.
- Strong text contrast.
- Consistent radius and spacing.
- Limited glow effects.

## 6.2 Design tokens

Create or reuse shared CSS variables. Do not scatter raw values across components.

```css
--xfer-bg-overlay
--xfer-bg-shell
--xfer-bg-sidebar
--xfer-bg-content
--xfer-bg-card
--xfer-bg-card-hover
--xfer-bg-control
--xfer-border-subtle
--xfer-border-strong
--xfer-text-primary
--xfer-text-secondary
--xfer-text-muted
--xfer-accent
--xfer-accent-soft
--xfer-success
--xfer-warning
--xfer-danger
--xfer-focus-ring
--xfer-radius-sm
--xfer-radius-md
--xfer-radius-lg
--xfer-shadow-dialog
--xfer-shadow-card
--xfer-space-1 through --xfer-space-8
```

## 6.3 Typography

| Element | Desktop | Mobile | Behavior |
|---|---:|---:|---|
| Dialog title | 20 to 22 px | 18 to 20 px | Semibold |
| Section title | 15 to 16 px | 15 px | Semibold |
| Control label | 14 px | 14 px | Medium |
| Description | 12.5 to 13.5 px | 12.5 px | Normal |
| Metadata | 11.5 to 12 px | 11.5 px | Normal |

Avoid excessive uppercase headings. Use title case or sentence case. Uppercase may remain for small overline labels only.

## 6.4 Card structure

Every main section uses a consistent `SettingsCard` structure:

```text
[Icon] Section title                         [Optional status/action]
       Short description
---------------------------------------------------------------
Controls
Optional inline validation or contextual note
```

Card rules:

- Radius 14 to 16 px.
- Border 1 px.
- Padding 18 to 20 px desktop, 14 to 16 px mobile.
- No oversized decorative icon blocks.
- Selected cards use an accent border and soft background, not a heavy glow.

## 6.5 Motion

- Use 120 to 180 ms transitions.
- Animate opacity, border color, and small height changes.
- Avoid large spring animations.
- Respect `prefers-reduced-motion`.
- When a conditional sub-control appears, preserve scroll position.

---

# 7. DETAILED UPLOAD UI

## 7.1 Upload overview strip

At the top of the Upload tab, show a compact policy summary:

```text
Current upload policy
HQ native media Â· Automatic encoding Â· 4 parallel Â· Skip duplicates
```

This summary updates live from the draft. It helps users understand the combined outcome of multiple settings.

Do not turn this into another editable form. It is a concise read-only summary.

## 7.2 Card 1: Upload quality and presentation

### Controls

1. **Media quality**
   - HQ, Telegram native.
   - Smart, automatic.
   - Original file, if currently supported by `QUALITY_MODE_OPTIONS`.

2. **Presentation format**
   - Automatic, recommended.
   - Always send as document.
   - Prefer native media.

### Required cleanup

- Remove `forceDocumentDefault` as a separately visible control.
- Treat `presentationOverride` as the visible source of truth.
- If legacy state still requires `forceDocumentDefault`, synchronize it through a normalization adapter.
- Explain that presentation format controls how Telegram displays a file, while quality controls whether the media may be prepared or transformed.

### UI form

Use selectable cards for media quality. Use a compact select or segmented control for presentation format.

## 7.3 Card 2: Video processing

This card replaces all visible combinations of `encoderStrategy` and `reencodeHardware`.

### Unified modes

1. **Automatic**
2. **Hardware acceleration**
3. **Software encoding**
4. **Disable re-encode**

### Mode mapping

| UI mode | Legacy `encoderStrategy` | Legacy `reencodeHardware` | Software fallback |
|---|---|---|---|
| Automatic | `auto_adaptive` | `auto` | `true` |
| Hardware, Auto GPU | `hardware_preferred` | `auto` | User choice, default `true` |
| Hardware, specific GPU | `specific_device` or existing exact supported mapping | Explicit device ID | User choice, default `true` |
| Software | `software_only` | `cpu` | `false` |
| Disable | `disable_reencode` | Preserved but ignored | `false` |

The adapter must reflect the actual backend contract. Do not invent unsupported values.

### Automatic mode UI

Show:

- Recommended badge.
- Resolved best encoder from capability data.
- Fallback statement.
- Refresh capability button in an overflow or inline action.

Example:

```text
Automatic                                    Recommended
Best available encoder will be selected.
Detected preference: NVIDIA RTX 4070, NVENC
CPU fallback: available
```

### Hardware mode UI

Show a nested control only when Hardware is selected:

- Auto GPU.
- Each supported detected NVIDIA, AMD, or Intel encoder.
- Optional CPU fallback toggle under Advanced mode.

Do not include CPU in the GPU list.

Unavailable devices may appear disabled with a concise reason only if the capability response contains that data. Otherwise show supported devices only.

### Software mode UI

Show read-only CPU information:

- Processor name.
- Core and thread count.
- Available software encoder summary if provided.

Use the label **Software encoding, CPU only**. Do not use `Software Preferred` if GPU fallback is not intended.

### Disable re-encode UI

Show a warning card:

- The source file remains unchanged.
- Unsupported native formats may be sent as documents.
- Oversized files follow the configured large-file policy.
- The application must not silently transcode in this mode.

### Quality preset

Keep `reencodePreset` separate from encoding mode:

- Fast.
- Balanced, recommended.
- High quality.

Hide or disable this control when Disable re-encode is selected. Explain why.

## 7.4 Card 3: Performance

### Controls

- Upload concurrency slider from 1 to 8.
- Contextual label:
  - 1 to 2: Stable.
  - 3 to 5: Recommended.
  - 6 to 8: High load.
- Encoder parallelism from 1 to 4, Advanced mode only.
- Resource profile: Eco, Balanced, Performance, Custom, Advanced mode only.

### Rules

- Remove duplicated recommended badge rendering.
- Show the current number in a compact stepper or value badge.
- Add keyboard-accessible increment and decrement if a custom slider component is introduced.
- Explain that upload concurrency and encoder parallelism control different stages.
- If resource profile is not Custom, the encoder parallel control may be read-only or derived. Confirm current backend semantics before enforcing this.

## 7.5 Card 4: Delivery behavior

### Basic controls

- Group compatible media as album.
- Send silently.
- Apply spoiler to all eligible media.
- Refresh location after upload.
- Skip duplicates.

Use switch rows rather than raw checkbox blocks.

Each switch row contains:

- Label.
- One sentence description.
- Right-aligned switch.

### Conditional logic

- Album options appear in the Album and Grouping advanced card only when grouping is enabled.
- Item-level spoiler positions appear only when spoiler is enabled and Advanced mode is active.
- Duplicate details may link to the Duplicates tool, but must not interrupt saving.

## 7.6 Card 5: Default caption

- Use one canonical character limit.
- Show live counter based on the backend-required unit.
- Explain whether the caption applies to every item or the summary item.
- Show validation before save.
- Do not render a generic note if no useful action or decision exists.

---

# 8. DETAILED ADVANCED UPLOAD UI

## 8.1 Advanced card: Album and grouping

### Album packing options

Simplify visible options to:

1. Automatic maximum grouping.
2. Custom group size.
3. Keep current selection grouping, only if this behavior is real and distinct.
4. Send separately.

Map legacy values through an adapter. Do not expose legacy terminology when two legacy options produce the same user-visible outcome.

### Grouping switches

- Avoid single-item album.
- Group documents.
- Group audio.
- Group original documents.

Place these in a collapsible `Grouping details` subsection.

## 8.2 Advanced card: Failure recovery

Expose three user-facing policies:

1. **Strict**
   - Do not send an incomplete album.
2. **Best effort**
   - Replan and send eligible remaining items.
3. **Retry and separate failures**
   - Retry preparation and send failed items separately when possible.

### Legacy mapping

| User-facing policy | Legacy values read as this policy | Canonical value written initially |
|---|---|---|
| Strict | `atomic_strict`, `cancel_group` | `atomic_strict` |
| Best effort | `replan_group`, `send_remaining`, `best_effort_advanced` | `replan_group` |
| Retry and separate | `retry_prepare`, `send_failed_separately` | `send_failed_separately` |

Do not claim two legacy values are perfectly identical. The UI is a simplified preset layer. Preserve unmodified legacy values until the user actively changes this control.

## 8.3 Advanced card: Large-file handling

Visible options:

1. Split using the existing supported workflow.
2. Use an eligible alternate account.
3. Skip and report.

### Alternate account subsection

Display only when alternate account is selected:

- Account pool selector or validated token input.
- Album strategy.
- Identity approval confirmation.

Do not use an unrestricted CSV field if the application already has structured account data. If only a string contract exists, retain it but add tokenized parsing, validation, and clear invalid-state feedback.

## 8.4 Advanced card: Scheduling and delivery identity

- Schedule date and time.
- Send as peer.
- Timezone indicator.
- Clear action for scheduled time.
- Validation for dates in the past.

Avoid mixing scheduling fields with album failure controls.

## 8.5 Advanced card: Item targeting

- Spoiler item positions.
- Replace raw comma-separated entry with a chip or token input if item indices are known.
- If item indices are not available at global settings time, retain a validated range syntax field with examples.
- Show this field only when spoiler is enabled.

## 8.6 Advanced card: Encoder tuning

This card contains only tuning, not encoder selection:

- Resource profile.
- Encoder parallelism.
- Software fallback for Hardware mode.
- Optional codec preferences only if already supported.

Remove the old seven-option `encoderStrategy` selector completely.

---

# 9. DETAILED DOWNLOAD UI

## 9.1 Download overview strip

Example:

```text
Current download policy
4 parallel Â· Ask on conflict Â· Resume partial Â· Size verification
```

## 9.2 Card 1: Download performance

- Download concurrency, 1 to 8.
- Stable, Recommended, High load labels.
- Optional destination performance hint if supported.

## 9.3 Card 2: Existing-file behavior

Options:

1. Ask every time.
2. Rename new file.
3. Overwrite existing file.
4. Skip existing file.

Use selectable rows with concise consequences. Mark destructive overwrite behavior clearly.

## 9.4 Card 3: Recovery and completion

- Resume partial downloads.
- Notify when download completes.

Use switches.

## 9.5 Advanced card: Integrity verification

Options:

- File-size verification.
- SHA-256 verification.

Explain speed and assurance differences. Do not present the choice without context.

## 9.6 Section reset

Replace the current immediate Reset Section button with:

- Overflow action in the card header.
- Confirmation popover or dialog.
- Reset only Download settings in that card or tab.
- Do not reset Upload or encoder values.

---

# 10. PROFILES EXPERIENCE

## 10.1 Profiles tab layout

```text
Recommended presets
[Balanced] [Original archive] [Fast publish]

Your profiles
Profile name            Summary                 Updated        Actions
My Archive              Original Â· CPU Â· SHA    Today          [...]

Current draft
12 settings changed from Balanced
[View changes]
```

## 10.2 System presets

Provide system presets only when their setting combinations can be defined safely.

Recommended set:

1. **Balanced**
   - Smart or HQ media based on current product default.
   - Automatic encoding.
   - Moderate concurrency.
   - Skip duplicates.
2. **Original archive**
   - Original or document presentation where appropriate.
   - Disable re-encode.
   - Strong download integrity.
3. **Fast publish**
   - Hardware acceleration when available.
   - Fast preset.
   - Higher concurrency within safe limits.

System presets must be read-only templates. Applying one changes the draft and marks it dirty. Users may then save it as a personal profile.

## 10.3 User profile actions

Use an overflow menu for:

- Apply.
- Rename.
- Duplicate.
- Replace with current draft.
- Delete.

Do not permanently show large Save and Delete buttons next to every profile control.

## 10.4 Profile safety

- Loading a profile with unsaved changes requires confirmation.
- Deleting a profile requires confirmation.
- Replacing a profile requires confirmation.
- Show `Legacy profile` badge when migration is incomplete.
- Preserve profile IDs and timestamps.

---

# 11. SETTINGS SEARCH

## 11.1 Search behavior

Build a structured search registry rather than a short hardcoded section list.

Each searchable entry contains:

```ts
{
  id,
  tab,
  mode,
  section,
  labelKey,
  descriptionKey,
  keywords,
  ref
}
```

Search must match:

- Visible label.
- Description.
- Common synonyms.
- Technical name where useful, such as NVENC, QSV, AMF, SHA-256.

## 11.2 Search result behavior

- Group results by Upload, Download, and Profiles.
- Selecting a result changes tab and mode if required.
- Expand the containing advanced card.
- Scroll inside the settings content container only.
- Focus or highlight the target control.
- Clear highlight after a short delay.

Do not use global `document.getElementById` with shared IDs.

## 11.3 Responsive search

- Desktop: compact field in the workspace header.
- Tablet: icon expands to a field.
- Mobile: full-screen or top-sheet search overlay.

---

# 12. DRAFT, VALIDATION, SAVE, AND CLOSE WORKFLOW

## 12.1 Draft lifecycle

```text
Open Transfer Settings
        â†“
Load persisted settings
        â†“
Normalize missing defaults
        â†“
Resolve legacy encoder state
        â†“
Create immutable baseline snapshot
        â†“
Create editable draft
        â†“
User edits settings
        â†“
Live validation and summary update
        â†“
Save
        â†“
Normalize and validate
        â†“
Persist through onTransferSettingsChange
        â†“
Update baseline and clear dirty state
```

## 12.2 Dirty-state behavior

A dirty state exists when the normalized draft differs from the normalized baseline.

Show:

```text
â— Unsaved changes
```

When the user closes, switches tools, loads a profile, or resets all settings:

```text
Discard unsaved changes?
[Keep editing] [Discard]
```

## 12.3 Validation model

Create one frontend validator:

```ts
validateTransferSettings(draft, capabilities): TransferSettingsValidation
```

Suggested result:

```ts
interface TransferSettingsValidation {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  normalized?: DriveTransferSettings;
}
```

Validation must cover:

- Invalid or unavailable explicit GPU.
- Hardware mode with no supported GPU.
- Specific-device mode with non-explicit value.
- Invalid caption length.
- Album group size outside 2 to 10.
- Encoder parallelism outside 1 to 4.
- Upload or download concurrency outside 1 to 8.
- Past schedule date.
- Invalid alternate-account input.
- Invalid spoiler index syntax.
- Disable re-encode conflicts that require document fallback information.

Warnings do not always block save. Errors block save.

## 12.4 Save behavior

The footer primary action reads:

- `Save changes` when dirty.
- `Saved` or disabled when clean.
- `Settings locked during active transfer` when the current product rule blocks changes.

If settings should apply only to future jobs during an active transfer, the UI may allow saving with a clear banner:

```text
Current transfer keeps its existing snapshot. Changes apply to the next transfer.
```

Use the actual product behavior. Do not leave the entire screen silently disabled.

## 12.5 Reset behavior

Provide:

- Reset current card.
- Reset current tab.
- Reset all Transfer Settings.

All reset actions must show their scope. Reset all requires confirmation.

---

# 13. ENCODER CAPABILITY WORKFLOW

## 13.1 Capability loading

- Do not block opening the settings screen while hardware detection runs.
- Show cached capability data immediately if available.
- Refresh in the background when stale.
- Trigger a refresh when the hardware selector opens or the user presses Refresh.

## 13.2 Option model

Refactor `encoderHardwareOptions.ts` into capability-focused helpers.

Required helpers:

```ts
buildDetectedGpuOptions(capabilities, t)
getRecommendedEncoderSummary(capabilities, t)
isExplicitEncoderDevice(value)
hasDetectedHardwareGpus(capabilities)
resolveUnifiedEncodingMode(settings)
applyUnifiedEncodingMode(settings, nextMode, options)
```

`buildDetectedGpuOptions` must not include CPU.

## 13.3 Capability states

The UI must support:

- Loading.
- No compatible GPU detected.
- Compatible GPU detected.
- Cached result.
- Detection failed.
- Previously selected device unavailable.

Do not present `detecting` as a selectable value stored in settings.

## 13.4 Hardware mode with no GPU

When the user selects Hardware and no supported GPU exists:

- Keep the mode card visible.
- Show a blocking inline message.
- Offer `Use Automatic` and `Use Software encoding` actions.
- Do not silently change the mode.

---

# 14. LEGACY SETTINGS AND PROFILE MIGRATION

## 14.1 Read compatibility

The frontend must read all existing encoder strategies:

- `auto_adaptive`
- `hardware_preferred`
- `software_preferred`
- `hardware_only`
- `software_only`
- `specific_device`
- `disable_reencode`

## 14.2 Unified resolver

Create a single resolver used by every UI surface.

Suggested result:

```ts
type UnifiedEncodingMode = 'automatic' | 'hardware' | 'software' | 'disabled' | 'legacy';
```

Mapping:

| Legacy state | UI result |
|---|---|
| `auto_adaptive` + `auto` | Automatic |
| `hardware_preferred` | Hardware, fallback enabled |
| `hardware_only` | Hardware, fallback disabled |
| `specific_device` + valid explicit device | Hardware, selected device |
| `software_only` or CPU forced | Software |
| `disable_reencode` | Disabled |
| `software_preferred` | Legacy state requiring user decision or a carefully defined mapping |

Do not guess away `software_preferred`. Preserve it until the user changes the mode, or map it only after confirming actual backend fallback behavior.

## 14.3 Schema version

If profile serialization supports extension, add a schema version:

```ts
settingsSchemaVersion: 2
```

If the existing type cannot be changed safely, keep migration metadata outside the settings object.

## 14.4 Migration rules

- Loading a legacy profile must never corrupt it.
- Applying a profile may normalize defaults in memory.
- Persist the new shape only when the user explicitly saves or replaces the profile.
- Show a concise migration notice when behavior cannot be represented exactly.

---

# 15. PREFLIGHT REDESIGN AND WORKFLOW INTEGRATION

## 15.1 Workflow

```text
Saved Transfer Settings
        â†“
User starts upload or download
        â†“
Create frozen settings snapshot
        â†“
Run capability and media preflight
        â†“
Show concise summary
        â†“
User expands only items needing attention
        â†“
Confirm
        â†“
Transfer Manager monitors execution
```

## 15.2 Preflight dialog redesign

The current preflight shows up to 100 detailed item cards immediately. Replace this with progressive disclosure.

### Summary region

Show:

- Total items.
- Ready items.
- Items with warnings.
- Blocking items.
- Effective upload limit.
- Selected encoding mode and resolved encoder.
- Album grouping result.

### Item list

- Show problematic items first.
- Collapse safe items into a summary group.
- Use expandable rows.
- Provide filter chips: All, Warnings, Blocked, Changed.
- Keep a maximum height with one scroll region.

### Actions

- Cancel.
- Back to settings, when a blocking issue can be resolved there.
- Confirm transfer.

`Back to settings` should open the relevant tab and highlight the required control when possible.

## 15.3 Disable re-encode handling

Preflight must state, per file:

- Native media.
- Document fallback.
- Split or alternate-account action.
- Blocking size issue.

The system must not silently re-encode a file when Disable re-encode is selected.

---

# 16. TRANSFER MANAGER INTEGRATION

## 16.1 Policy visibility

Transfer Manager should display the resolved snapshot, not the current editable settings.

Show concise information such as:

```text
Automatic Â· NVIDIA NVENC Â· Balanced
```

or:

```text
Original file Â· Document fallback
```

## 16.2 Current job isolation

When settings change during an active transfer:

- The current transfer keeps its frozen snapshot.
- The manager must not update its encoder label based on the new draft.
- A banner in settings explains that changes apply to the next transfer.

## 16.3 Fallback visibility

When a fallback occurs:

- Show the original intended encoder.
- Show the actual encoder used.
- Show a concise reason.
- Keep technical details in logs or an expandable details area.

---

# 17. ACCESSIBILITY REQUIREMENTS

## 17.1 Dialog behavior

- Put `role="dialog"` on the dialog panel, not only the overlay.
- Use `aria-modal="true"`.
- Provide `aria-labelledby` and `aria-describedby`.
- Trap focus inside the open dialog.
- Restore focus to the opening button on close.
- Lock background page scrolling.
- Escape closes only after handling unsaved changes.

## 17.2 Tabs

- Implement correct tab keyboard behavior.
- Arrow keys move between tabs.
- `aria-controls` points to tab panels.
- Only active tab has `tabIndex=0`.

## 17.3 Controls

- Minimum 44 px touch target.
- Visible focus ring.
- Do not rely only on color for selected, warning, or error state.
- Associate help and errors through `aria-describedby`.
- Announce hardware detection and validation changes through a restrained live region.

## 17.4 Motion and contrast

- Support reduced motion.
- Maintain WCAG AA contrast for text and controls.
- Avoid low-contrast muted text on dark surfaces.

---

# 18. COMPONENT ARCHITECTURE

## 18.1 Required shared structure

Create a shared feature folder if one does not already exist:

```text
Transfers/Settings/
  TransferSettingsWorkspace.tsx
  TransferSettingsHeader.tsx
  TransferSettingsTabs.tsx
  TransferSettingsFooter.tsx
  TransferSettingsSearch.tsx
  TransferSettingsSummary.tsx
  UploadSettingsPanel.tsx
  DownloadSettingsPanel.tsx
  ProfilesSettingsPanel.tsx
  VideoEncodingCard.tsx
  UploadQualityCard.tsx
  PerformanceCard.tsx
  DeliveryBehaviorCard.tsx
  AlbumGroupingCard.tsx
  FailureRecoveryCard.tsx
  OversizeHandlingCard.tsx
  DeliveryRoutingCard.tsx
  DownloadConflictCard.tsx
  DownloadIntegrityCard.tsx
  SettingsCard.tsx
  SettingsSwitchRow.tsx
  SettingsSelectRow.tsx
  SettingsSliderRow.tsx
  transferSettingsModel.ts
  transferSettingsValidation.ts
  transferSettingsSearchRegistry.ts
```

Exact file grouping may be adjusted to match repository conventions, but the responsibilities must remain separated.

## 18.2 State controller

Use one hook or controller:

```ts
useTransferSettingsController({
  settings,
  onChange,
  transferActive,
})
```

Responsibilities:

- Baseline and draft.
- Dirty comparison.
- Normalization.
- Validation.
- Active tab and mode.
- Profile actions.
- Search targeting.
- Close confirmation.
- Save and reset actions.
- Hardware capability integration.

Do not duplicate this logic in `index.tsx` and `DriveTransferSettings.tsx`.

## 18.3 Presentational primitives

Use shared primitives so every row has consistent label, description, control alignment, errors, and disabled state.

Avoid repeatedly hand-writing `label > input > span > strong > small` blocks.

---

# 19. FILE-BY-FILE IMPLEMENTATION PLAN

## 19.1 `index.tsx`

**Required changes:**

- Remove the local `TransferTabContent` implementation after the shared workspace is ready.
- Remove local profile, search, hardware, and encoder UI logic from the tools panel.
- Keep only the tools-shell state needed to select the Transfer tab.
- Render `TransferSettingsWorkspace` inside the main content area.
- Ensure the Transfer tab can request a wider content layout without affecting other tools.
- Preserve `onTransferSettingsChange` and `transferActive` contracts.
- Fix the current caption clamp mismatch by delegating normalization to shared logic.

## 19.2 `DriveTransferSettings.tsx`

**Required changes:**

- Remove independent settings state, profile logic, search logic, and encoder mapping.
- Convert to a thin wrapper around `TransferSettingsWorkspace` if still used.
- Otherwise remove the component after confirming all imports and callers.
- Never maintain another full settings form here.

## 19.3 `TransferOrchestrationSettings.tsx`

**Required changes:**

- Split the large component into focused cards.
- Remove the old `encoderStrategy` selector.
- Remove encoder mode selection from orchestration.
- Keep only advanced tuning in the encoder tuning card.
- Scope reset actions by card.
- Simplify album failure policy to three user-facing presets.
- Improve conditional rendering for album, spoiler, and alternate-account settings.

The component may be deleted after its responsibilities move to new cards.

## 19.4 `encoderHardwareOptions.ts`

**Required changes:**

- Stop returning CPU as a hardware option.
- Never return `detecting` as a storable settings value.
- Add capability summary helpers.
- Add unified encoder mode resolver and mapping helpers, or place them in `transferSettingsModel.ts`.
- Preserve explicit device ID validation.
- Keep labels and descriptions localized.

## 19.5 `TransferPreflightDialog.tsx`

**Required changes:**

- Use the new dialog shell and visual tokens.
- Replace the immediate 100-card detail list with summary plus expandable problem-first rows.
- Add Back to settings action when possible.
- Display resolved encoding and presentation outcome.
- Improve mobile full-screen behavior.
- Keep blocking-state enforcement.

## 19.6 `DriveTransferManager.tsx`

**Required changes:**

- Display resolved policy from the transfer snapshot.
- Keep fallback and actual encoder visibility.
- Align badges and status colors with the new design tokens.
- Ensure the floating manager remains usable on small screens.
- Do not derive current job presentation from the editable settings draft.

## 19.7 `DriveTopBar.tsx`

**Required changes:**

- Direct Transfer Settings action must open the canonical tools panel on the Transfer tab.
- Do not open a second independent modal implementation.
- Keep Transfer Manager as a separate action.
- Ensure buttons have clear labels and responsive overflow behavior.

## 19.8 `DriveExplorer.tsx`

**Required changes:**

- Verify tools-panel open state and tab routing.
- Restore focus to the original trigger after close.
- Ensure selection, virtualized grid, and background scrolling do not respond while the modal is open.
- No settings logic should live here.

## 19.9 `toolsUtils.ts`

**Required changes:**

- Preserve Transfer Settings under Configuration.
- Optionally add metadata used for responsive navigation and active labels.
- Do not duplicate settings content metadata here.

## 19.10 `DuplicatesTab.tsx` and `SpaceUsageTab.tsx`

**Required changes:**

- Do not redesign their business logic in this task.
- Verify that global tools-shell changes do not break them.
- Note the style-system inconsistency between Tailwind-like utility classes and custom `td-*` classes. Do not expand that inconsistency in new Transfer components.

## 19.11 `DriveTransferDock.tsx`

- It is deprecated and empty.
- Remove only if no imports remain and repository cleanup policy allows it.
- It is not part of the main UI implementation.

---

# 20. CSS AND RESPONSIVE IMPLEMENTATION

## 20.1 CSS organization

Use one feature stylesheet or the repository's established CSS module strategy.

Suggested namespace:

```text
.td-transfer-settings-*
```

Do not add more ambiguous `.td-xfer-*` rules without cleaning or clearly separating legacy rules.

## 20.2 Scroll ownership

Only one region should own vertical scrolling:

```text
Dialog shell
  Header: fixed
  Main layout: min-height 0
    Sidebar: independent only when needed
    Content viewport: overflow-y auto
  Footer: fixed
```

Use `min-height: 0` and `min-width: 0` correctly in flex or grid containers.

## 20.3 Sticky regions

- Transfer subtab header may be sticky inside the content viewport.
- Footer remains sticky or fixed within the shell.
- Avoid stacking multiple sticky bars that consume excessive height.

## 20.4 Container queries

Use container queries if the project supports them. The settings workspace often changes width independently of the viewport because of the tools sidebar.

If container queries are unavailable, use clear viewport media queries and test each target size.

---

# 21. TEST PLAN

## 21.1 Unit tests

Test:

- Legacy encoder state to unified mode mapping.
- Unified mode to legacy settings mapping.
- Settings normalization.
- Dirty-state comparison.
- Album failure preset mapping.
- Search registry matching.
- Validation rules.
- Caption counting and clamping.
- Hardware option building without CPU.

## 21.2 Component tests

Test:

- Basic and Advanced mode visibility.
- Upload, Download, and Profiles tabs.
- Conditional GPU selector.
- Software CPU summary.
- Disable re-encode warning.
- Profile apply, save, rename, replace, duplicate, and delete.
- Unsaved-change confirmation.
- Section reset scope.
- Transfer-active banner and behavior.
- Search navigation and highlighting.
- Keyboard tab navigation.

## 21.3 Integration tests

Scenarios:

1. No hardware capability data yet.
2. NVIDIA GPU detected.
3. AMD GPU detected.
4. Intel QSV detected.
5. Multiple GPUs detected.
6. No compatible GPU.
7. Previously selected GPU unavailable.
8. Legacy `software_preferred` profile.
9. Disable re-encode with native-compatible media.
10. Disable re-encode with document fallback.
11. Oversized file using split.
12. Oversized file using alternate account.
13. Active transfer while settings are edited.
14. Preflight blocking issue leading back to settings.

## 21.4 Responsive visual tests

Minimum viewport set:

| Name | Size |
|---|---|
| Large desktop | 1440 x 900 |
| Desktop | 1280 x 800 |
| Laptop | 1024 x 768 |
| Tablet portrait | 768 x 1024 |
| Tablet landscape | 1024 x 768 |
| Mobile | 390 x 844 |
| Small mobile | 360 x 640 |
| Mobile landscape | 844 x 390 |

Check:

- No clipped text.
- No horizontal page scroll.
- Footer does not cover content.
- Dropdowns remain inside viewport.
- Touch targets remain 44 px.
- Sidebar or drawer works.
- Search overlay works.
- Dialog respects safe areas.

## 21.5 Accessibility tests

- Keyboard-only completion.
- Focus trap.
- Escape with dirty draft.
- Screen reader labels.
- Error association.
- Tab roles.
- Reduced motion.
- Contrast.

---

# 22. IMPLEMENTATION PHASES AND CHECKLIST

## Phase 1: Establish one source of truth

- [x] Identify every caller of `DriveTransferSettings` and `DriveToolsPanel`.
- [x] Confirm the canonical opening flow.
- [x] Create shared normalization and validation utilities.
- [x] Create unified encoder mode resolver and mapper.
- [x] Add tests for legacy mapping.
- [x] Resolve the canonical caption limit from the current backend contract.

**Exit criterion:** Both old implementations can read the same normalized state through shared helpers.

## Phase 2: Build shared settings workspace

- [x] Create `TransferSettingsWorkspace`.
- [x] Create shared header, tabs, footer, and settings card primitives.
- [x] Add draft baseline and dirty state.
- [x] Add Basic and Advanced modes.
- [x] Add responsive layout shell.
- [x] Add unsaved-change close confirmation.

**Exit criterion:** A blank or partial shared workspace renders correctly in the tools panel and standalone wrapper.

## Phase 3: Rebuild Upload Basic UI

- [x] Build Upload quality and presentation card.
- [x] Build unified Video Processing card.
- [x] Refactor hardware options to GPU-only choices.
- [x] Build Performance card.
- [x] Build Delivery behavior card.
- [x] Build Default caption card.
- [x] Add live policy summary.

**Exit criterion:** Common upload settings work without opening Advanced mode.

## Phase 4: Rebuild Upload Advanced UI

- [x] Build Album and grouping card.
- [x] Build Failure recovery card with three presets.
- [x] Build Large-file handling card.
- [x] Build Scheduling and identity card.
- [x] Build Item targeting card.
- [x] Build Encoder tuning card.
- [x] Add scoped card resets.

**Exit criterion:** All existing advanced upload capabilities remain accessible without the old long orchestration form.

## Phase 5: Rebuild Download UI

- [x] Build Download performance card.
- [x] Build Existing-file behavior card.
- [x] Build Recovery and completion card.
- [x] Build Advanced integrity card.
- [x] Add download policy summary.
- [x] Add scoped reset behavior.

**Exit criterion:** All existing download settings remain accessible and understandable.

## Phase 6: Rebuild Profiles and search

- [x] Move profile management into Profiles tab.
- [x] Add system presets.
- [x] Add user profile list and overflow actions.
- [x] Add legacy profile badges and migration handling.
- [x] Build structured search registry.
- [x] Add scoped scroll and focus targeting.
- [x] Add responsive mobile search.

**Exit criterion:** Profiles no longer consume permanent space above Upload and Download settings.

## Phase 7: Remove duplicate implementation

- [x] Replace `TransferTabContent` in `index.tsx` with the shared workspace.
- [x] Convert `DriveTransferSettings.tsx` into a wrapper or remove it.
- [x] Remove old encoder and hardware selectors.
- [x] Remove obsolete duplicate state and handlers.
- [x] Remove global duplicated section IDs.
- [x] Confirm all entry points render the same UI.

**Exit criterion:** Only one settings form implementation remains.

## Phase 8: Preflight and Transfer Manager alignment

- [x] Redesign preflight summary and item disclosure.
- [x] Add resolved policy information.
- [x] Add Back to settings targeting.
- [x] Align Transfer Manager policy badges.
- [x] Verify frozen snapshot behavior.
- [x] Verify fallback reporting.

**Exit criterion:** Settings, preflight, and active transfer tell the same story.

## Phase 9: Responsive and accessibility hardening

- [x] Implement desktop, laptop, tablet, and mobile layouts.
- [x] Add drawer navigation below 1024 px.
- [x] Add safe-area handling.
- [x] Add focus trap and focus restore.
- [x] Add keyboard tab behavior.
- [x] Add reduced-motion handling.
- [x] Verify 44 px touch targets.
- [x] Run contrast checks.

**Exit criterion:** All target viewport and accessibility checks pass.

## Phase 10: Cleanup and verification

- [x] Remove unused imports and legacy styles.
- [x] Remove dead components only after usage search.
- [x] Run TypeScript type check.
- [x] Run lint.
- [x] Run unit and component tests.
- [x] Run responsive visual checks.
- [x] Verify all i18n keys.
- [x] Verify settings persistence and profile migration.
- [x] Verify no existing tool tab regressed.

**Exit criterion:** All acceptance criteria below pass.

---

# 23. ACCEPTANCE CRITERIA

The implementation is complete only when all items below are true.

## Architecture

- [x] One canonical Transfer Settings workspace exists.
- [x] `index.tsx` no longer contains a separately maintained full Transfer Settings form.
- [x] `DriveTransferSettings.tsx` is only a wrapper or has been safely removed.
- [x] Shared normalization, validation, and encoder mapping are used everywhere.

## UI and UX

- [x] Upload, Download, and Profiles are clear top-level tabs.
- [x] Basic mode exposes only common controls.
- [x] Advanced mode preserves all supported power features.
- [x] Profile controls no longer occupy permanent space above every tab.
- [x] Settings are grouped into consistent cards.
- [x] Dirty state and unsaved-change confirmation work.
- [x] Reset scope is explicit.
- [x] Search finds all major settings.

## Encoder

- [x] Hardware Reencode and Encoder Strategy are not shown as separate user controls.
- [x] Four unified modes exist.
- [x] Hardware mode shows Auto GPU and detected GPUs only.
- [x] Software mode uses CPU-only semantics.
- [x] Disable re-encode hides irrelevant quality tuning and displays guardrails.
- [x] Legacy profiles remain readable.
- [x] Invalid or unavailable GPU choices cannot be silently saved.

## Responsive behavior

- [x] Desktop layout remains elegant at 1440 and 1280 widths.
- [x] Tablet layout removes the permanent sidebar.
- [x] Mobile layout becomes full-screen and touch-friendly.
- [x] No horizontal scroll appears at supported sizes.
- [x] Footer never covers the last control.
- [x] Search and dropdowns stay within the viewport.

## Accessibility

- [x] Focus is trapped and restored.
- [x] Tabs support keyboard navigation.
- [x] All fields have labels and associated help or error text.
- [x] Touch targets meet 44 px minimum.
- [x] Reduced motion works.
- [x] Contrast meets WCAG AA.

## Workflow

- [x] Settings save into the expected persistent state.
- [x] Active transfer uses a frozen snapshot.
- [x] Preflight reflects the saved policy.
- [x] Transfer Manager reflects the actual resolved encoder and fallback.
- [x] Current Duplicates, Space Usage, Rename, Copy, and Filter tools still open and function.

---

# 24. NON-GOALS

Do not expand this task into unrelated product work.

- Do not redesign every Drive tool in full.
- Do not rewrite transfer backend orchestration without a proven contract gap.
- Do not remove advanced functionality merely because it is uncommon.
- Do not replace i18n with hardcoded labels.
- Do not introduce a new UI framework only for this screen.
- Do not migrate all project styling systems in this task.
- Do not alter transfer limits based on assumptions.

---

# 25. REQUIRED IMPLEMENTATION NOTES

1. Preserve current setting field names until a safe migration exists.
2. Normalize fields at the boundary, not throughout every component.
3. Keep business rules outside presentational JSX.
4. Avoid `any` in new state and handlers.
5. Do not store temporary UI values such as `detecting` into persistent settings.
6. Use stable component refs for search targeting.
7. Do not use global IDs that can collide.
8. Do not silently change an unavailable explicit device to another GPU.
9. Do not silently transcode when re-encode is disabled.
10. Do not let section reset change unrelated settings.
11. Do not use nested scroll containers unless unavoidable.
12. Do not mark the implementation complete based only on desktop screenshots.

---

# 26. PROGRESS AND BLOCKERS

The implementing agent may append entries below. Do not delete previous entries.

## Progress log

- Completed Phase 1 to Phase 10: Unified TransferSettingsWorkspace canonical implementation, profile management, structured search registry, responsive design system, and alignment with TransferPreflightDialog (with Back to Settings targeting) & DriveTransferManager.
- Verified type check and clean build (`✓ built in 6.73s`). Fully committed and pushed to GitHub main branch (`9a43ce0`).

## Blockers

- None recorded.

## Decisions verified during implementation

- None recorded.

---

# 27. FINAL EXECUTION ORDER

The agent must execute in this exact order:

1. Verify callers and current setting contracts.
2. Build shared model, normalization, validation, and encoder mapping.
3. Build the shared responsive workspace shell.
4. Rebuild Upload Basic.
5. Rebuild Upload Advanced.
6. Rebuild Download.
7. Rebuild Profiles and search.
8. Replace duplicate implementations.
9. Align Preflight and Transfer Manager.
10. Complete responsive, accessibility, tests, and cleanup.

**Do not begin by rewriting this plan. Begin by implementing Phase 1.**
