# Browser Verification

## Using Playwright MCP Tools

```javascript
// Navigate to target page
await browser_navigate({ url: "https://your-app.com/page" });

// Wait for loading
await browser_wait_for({ time: 2 });

// Get page snapshot (more informative than screenshot)
await browser_snapshot({});

// Verify data is correctly loaded
await browser_evaluate({
  function: `() => {
    const elements = document.querySelectorAll('.chapter-title');
    return Array.from(elements).map(el => el.textContent);
  }`,
});

// Click button
await browser_click({
  element: "Target button description",
  ref: "e123", // From snapshot
});

// Wait for response
await browser_wait_for({ time: 1 });

// Verify result
await browser_snapshot({});
```

## Verification Checklist

### Before Commit

- [ ] Local type check passes (`npm run type-check`)
- [ ] Related tests pass (`npm run test:quick`)
- [ ] Code format correct (`npm run lint`)

### After Deployment

- [ ] Page loads without errors
- [ ] Data displays correctly
- [ ] Interactions work properly
- [ ] Mobile responsive works
- [ ] Dark mode works (if applicable)

### User Path Walkthrough

```markdown
1. Where does user enter? (URL/entry point)
2. What does user see? (initial state)
3. What action does user take? (click/scroll/input)
4. How does system respond? (loading state/data change)
5. What does user finally see? (result state)
```

## Common Verification Scenarios

### Form Submission

```javascript
// Fill form
await browser_evaluate({
  function: `() => {
    document.querySelector('input[name="title"]').value = "Test Title";
    document.querySelector('textarea[name="content"]').value = "Test content";
  }`,
});

// Submit
await browser_click({ element: "Submit button", ref: "submit-btn" });

// Wait for API response
await browser_wait_for({ time: 2 });

// Verify success
await browser_snapshot({});
```

### Navigation Flow

```javascript
// Click navigation link
await browser_click({ element: "Settings link", ref: "nav-settings" });

// Wait for page transition
await browser_wait_for({ time: 1 });

// Verify correct page loaded
await browser_evaluate({
  function: `() => {
    return {
      url: window.location.pathname,
      title: document.title,
    };
  }`,
});
```

### Modal Interaction

```javascript
// Open modal
await browser_click({ element: "Open modal button", ref: "open-modal" });

// Wait for animation
await browser_wait_for({ time: 0.5 });

// Verify modal is visible
await browser_evaluate({
  function: `() => {
    const modal = document.querySelector('[role="dialog"]');
    return modal !== null;
  }`,
});

// Close modal
await browser_click({ element: "Close button", ref: "close-modal" });
```

## Responsibilities

1. Build responsive, accessible React components
2. Implement proper state management with Zustand
3. Use TanStack Query for server state
4. Follow Next.js 14 App Router patterns
5. Write TypeScript with strict types
6. Ensure dark mode compatibility
7. Debug UI issues from screenshots accurately
8. Verify fixes with browser verification
9. Check all locations rendering same data
