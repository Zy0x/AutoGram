# ZIP Preview Workbench Power Redesign & Modernization Plan

## AutoGram - DriveZipBrowser Next Generation Architecture

## 1. Vision

Transform `DriveZipBrowser` from a static archive table viewer into a
next-generation ZIP Preview Workbench:

-   Instant visual browsing for large archives
-   Gallery-first experience for image/media archives
-   Desktop-grade interaction similar to modern file managers
-   Zero-conflict selection system
-   Full keyboard and mouse workflow
-   Context menu actions
-   High-performance virtualization
-   Responsive modern dark interface
-   Seamless integration with AutoGram media workflow

Target experience:

> "Open ZIP → instantly understand content → preview → select → operate
> without extraction."

------------------------------------------------------------------------

# 2. Current Problems Analysis

  -----------------------------------------------------------------------
  Area                    Current Issue           Impact
  ----------------------- ----------------------- -----------------------
  Preview                 Table-only interface    Difficult browsing
                                                  hundreds of images

  Selection               Basic checkbox state    Conflict when changing
                                                  archive/file context

  Interaction             No right-click menu     Feels unlike modern
                                                  file manager

  Sorting                 Lexicographical sorting Files appear 1,10,100,2

  Media browsing          No thumbnail workflow   Slow photo discovery

  Controls                Limited toolbar         Poor productivity

  Performance             No virtualization       Slow with thousands of
                          strategy                files
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 3. New Architecture Overview

## Component Structure

    DriveZipBrowser
    |
    ├── ZipWorkspace
    │
    ├── ZipHeaderToolbar
    │   ├── Archive identity
    │   ├── Navigation
    │   ├── View switcher
    │   ├── Save actions
    │   └── Close action
    │
    ├── ZipCommandBar
    │   ├── Breadcrumb
    │   ├── Search
    │   ├── Filters
    │   └── Sorting
    │
    ├── ZipContentEngine
    │   |
    │   ├── ZipEntryTable
    │   |
    │   └── ZipEntryGrid
    │
    ├── ZipContextMenu
    │
    ├── SelectionManager
    │
    └── FloatingActionBar

------------------------------------------------------------------------

# 4. Premium UI Layout

## Double Layer Interface

### Layer 1: Archive Identity

Contains:

-   Archive icon animation
-   ZIP filename
-   Total files
-   Total size
-   Compression status
-   Security status

Example:

    📦 TG_DonghuaNation.zip

    229 Files
    740 MB
    Unlocked
    Images Archive

------------------------------------------------------------------------

### Layer 2: Workspace Controls

Features:

-   Breadcrumb navigation
-   Search
-   Filter chips
-   Sort
-   View mode

Example:

    Home > Manga > Chapter 01

    [Search files...]

    All (229)
    Images (220)
    Videos (5)
    Documents (4)

    Sort:
    Name ↑
    Size
    Type

------------------------------------------------------------------------

# 5. Dual Preview Mode

## A. List Detail Mode

Designed for:

-   Documents
-   Large archives
-   Professional users

Columns:

  Column       Function
  ------------ --------------------------
  Select       Checkbox
  Preview      Icon/thumbnail
  Name         Filename
  Type         Extension
  Smart Size   Size + compression ratio
  Modified     Timestamp
  Action       Quick operations

Removed:

-   Separate SIZE column
-   Separate COMPRESSED column

------------------------------------------------------------------------

## B. Gallery Grid Mode

Designed for:

-   Images
-   Manga
-   Wallpapers
-   Design files

Features:

-   Dynamic thumbnail loading
-   Masonry-like responsive layout
-   Hover preview
-   Multi-select
-   Drag selection

Card:

    +----------------+
    |                |
    |   Thumbnail    |
    |                |
    +----------------+

    chapter01.png

    2.4 MB
    PNG

------------------------------------------------------------------------

# 6. Advanced Right Click Context Menu

Every ZIP media item supports:

## Context Actions

Right click:

    Preview
    Open fullscreen
    Open containing folder

    Select
    Select similar
    Select all images
    Invert selection

    Extract
    Extract selected
    Extract here
    Send to Drive
    Send to Chat

    Copy
    Copy filename
    Copy path

    Information
    Metadata
    Compression details

------------------------------------------------------------------------

# 7. Professional Selection System Redesign

## Problem

Current:

    Archive A selected files
    ↓
    Open Archive B
    ↓
    Old selection remains
    ↓
    Conflict

------------------------------------------------------------------------

## New Selection State Architecture

Create isolated selection scope:

    SelectionContext

    Archive ID
    Folder Path
    Selected Entries
    Selection Timestamp

Example:

    Archive A

    selected:
    001.png
    002.png


    Archive B

    selected:
    (empty)

------------------------------------------------------------------------

## Selection Rules

### Opening New Archive

Automatically:

    Destroy previous selection
    Create new SelectionContext
    Reset actions

------------------------------------------------------------------------

### Switching Folder

Maintain:

    Archive Session
    |
    ├── Folder A selection
    |
    └── Folder B selection

------------------------------------------------------------------------

### Switching View

Preserve:

    Grid ↔ List

    Selection remains

------------------------------------------------------------------------

# 8. Desktop File Manager Interaction

## Mouse Controls

### Click

Single click:

-   Select item

Double click:

-   Preview/open

### Ctrl + Click

Multiple selection:

    A
    +
    C
    +
    F

Result:

    3 selected

------------------------------------------------------------------------

### Shift + Click

Range selection:

    1.png

    shift click

    10.png

Result:

    1-10 selected

------------------------------------------------------------------------

### Rectangle Selection

Drag empty area:

    +----------------+
    | [] [] [] []    |
    | [] [] [] []    |
    |                |
    +----------------+

Select:

    All cards inside rectangle

------------------------------------------------------------------------

# 9. Keyboard Shortcut System

## Navigation

  Shortcut   Action
  ---------- ------------------
  Arrow      Move focus
  Enter      Open preview
  Space      Select
  Esc        Cancel/close
  Ctrl+A     Select all
  Ctrl+F     Search
  Delete     Remove selection
  Ctrl+C     Copy filename

------------------------------------------------------------------------

# 10. Floating Batch Action System

Appears:

When:

    selectedCount > 0

Example:

    -------------------------------
    12 items selected
    450 MB

    Extract
    Send
    Download
    Clear
    -------------------------------

Features:

-   Animated entrance
-   Total size calculation
-   Action grouping

------------------------------------------------------------------------

# 11. Performance Architecture

## Virtual Rendering

Required for:

-   10,000+ files
-   Large image archives

Implementation:

-   Virtual scrolling
-   Lazy thumbnail loading
-   Intersection Observer
-   Worker-based metadata parsing

------------------------------------------------------------------------

## Thumbnail Pipeline

Workflow:

    ZIP opened

    ↓

    Read metadata

    ↓

    Detect media

    ↓

    Generate thumbnail queue

    ↓

    Render visible items only

    ↓

    Background preload

------------------------------------------------------------------------

# 12. Smart Media Detection

Supported:

## Images

-   PNG
-   JPG
-   JPEG
-   WEBP
-   GIF
-   SVG

## Video

-   MP4
-   MKV
-   WEBM

## Documents

-   PDF
-   DOCX
-   TXT

## Archives

-   ZIP
-   RAR
-   7Z

------------------------------------------------------------------------

# 13. AI Assisted Archive Understanding

Future feature:

Archive Intelligence:

Automatically detects:

-   Manga archive
-   Photo album
-   Dataset
-   Software package
-   Backup archive

Example:

    Detected:

    Manga Collection

    Recommended View:
    Gallery

    Sorting:
    Natural Chapter Order

------------------------------------------------------------------------

# 14. Smart Sorting Engine

Implement:

    localeCompare(
    numeric:true,
    sensitivity:"base"
    )

Supported:

-   Natural filename
-   Size
-   Date
-   Type
-   Resolution

Example:

Before:

    1.png
    10.png
    100.png
    2.png

After:

    1.png
    2.png
    10.png
    100.png

------------------------------------------------------------------------

# 15. Component Changes

## Modify

    DriveZipBrowser/index.tsx

Add:

-   viewMode
-   selection manager
-   keyboard engine
-   archive session state

```{=html}
<!-- -->
```
    ZipHeaderToolbar.tsx

Add:

-   Close button
-   Archive statistics
-   View switch
-   Navigation

```{=html}
<!-- -->
```
    ZipEntryTable.tsx

Add:

-   Smart columns
-   Context menu
-   Hover actions

```{=html}
<!-- -->
```
    zipUtils.ts

Add:

-   Natural sorting
-   Category detection
-   Metadata parser

------------------------------------------------------------------------

## New Components

    ZipEntryGrid.tsx

    ZipContextMenu.tsx

    ZipSelectionManager.ts

    ZipThumbnailEngine.ts

    ZipKeyboardController.ts

    ZipFloatingActionBar.tsx

    ZipVirtualScroller.tsx

------------------------------------------------------------------------

# 16. User Workflow

## Opening ZIP

    User opens ZIP

    ↓

    Analyze archive

    ↓

    Detect type

    ↓

    Load metadata

    ↓

    Render interface instantly

    ↓

    Generate thumbnails progressively

------------------------------------------------------------------------

## Browsing Images

    Open ZIP

    ↓

    Gallery mode

    ↓

    Scroll thumbnails

    ↓

    Click image

    ↓

    Fullscreen preview

    ↓

    Navigate next/previous

------------------------------------------------------------------------

## Selecting Files

    Click item

    ↓

    SelectionManager updates

    ↓

    Floating action appears

    ↓

    User performs action

------------------------------------------------------------------------

# 17. Validation Checklist

## UI

-   [ ] Modern dark interface
-   [ ] Responsive desktop/mobile layout
-   [ ] Clear close button
-   [ ] No redundant columns

## Interaction

-   [ ] Right click works
-   [ ] Ctrl selection works
-   [ ] Shift range works
-   [ ] Rectangle selection works
-   [ ] Keyboard shortcuts work

## Performance

-   [ ] 1000+ images load smoothly
-   [ ] Virtual rendering enabled
-   [ ] Thumbnail queue optimized

## Selection

-   [ ] Archive switching resets correctly
-   [ ] Folder switching has predictable behavior
-   [ ] No stale selections

------------------------------------------------------------------------

# Final Product Goal

The final ZIP Preview Workbench should feel like:

-   Windows Explorer
-   macOS Finder
-   Google Drive Preview
-   Adobe Bridge
-   Modern DAM system

combined into one fast, elegant AutoGram archive workspace.
