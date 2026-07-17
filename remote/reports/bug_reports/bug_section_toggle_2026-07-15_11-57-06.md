# Bug: section_toggle

- Time: 2026-07-15T03:57:06.640Z
- Error: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.td-section-toggle').first()
    - locator resolved to <button type="button" aria-expanded="true" class="td-section-toggle td-only-expanded" title="Ciutkan Drive folders — lebih luas untuk chat">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - element is outside of the viewport
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - element is outside of the viewport
    - retrying click action
      - waiting 100ms
    58 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - element is outside of the viewport
     - retrying click action
       - waiting 500ms

- Stack: ```
locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for locator('.td-section-toggle').first()
    - locator resolved to <button type="button" aria-expanded="true" class="td-section-toggle td-only-expanded" title="Ciutkan Drive folders — lebih luas untuk chat">…</button>
  - attempting click action
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - element is outside of the viewport
    - retrying click action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is visible, enabled and stable
      - scrolling into view if needed
      - done scrolling
      - element is outside of the viewport
    - retrying click action
      - waiting 100ms
    58 × waiting for element to be visible, enabled and stable
       - element is visible, enabled and stable
       - scrolling into view if needed
       - done scrolling
       - element is outside of the viewport
     - retrying click action
       - waiting 500ms

    at runCase (F:\AutoGram\remote-automation-suite\test_modules\test_runner.mjs:122:28)
    at async main (F:\AutoGram\remote-automation-suite\test_modules\test_runner.mjs:482:9)
```
