# Kora UX Fixes Implementation Plan

## Priority 1: Error Handling & User Feedback

### Issue: Raw error messages shown to users
- **Problem**: 25+ places show `err.message` directly, users see "Unexpected token <" in Discover
- **Solution**: Friendly messages with Retry buttons, log details server-side

### Files to modify (error-related):
1. `DiscoverView.tsx` - Lines 806, 948, 1003, 1882, 2194, 2421, 2682, 2920, 2984
2. `BookReaderEPUB.tsx` - Line 2413
3. `BookReaderPDF.tsx` - Line 136
4. `DeviceDownloadPicker.tsx` - Line 84
5. `HardcoverCommunity.tsx` - Lines 110, 139
6. `P2pTransferPanel.tsx` - Lines 103, 117, 130
7. `ProximitySyncModal.tsx` - Lines 93, 116
8. `SettingsView.tsx` - Lines 534, 754
9. `App.tsx` - Lines 1832, 2278, 2335, 2886, 2912

### Implementation pattern:
```
❌ Currently: toast.error(err.message || "Some error")
✅ New: Show toast with friendly message + Retry button
       Log full error to console with context
```

## Priority 2: Touch Targets (Minimum 44px hit areas)

### Issue: Small chips/buttons (28px/34px) below minimum 44px
- **Problem**: About 230 h-6/h-8-style small sizes across components
- **Solution**: Keep visual size but pad hit area to min 44px

### Implementation:
- Add `className` padding: `rounded-lg p-2` or `p-3` around small elements
- Or use `group-hover` to expand hit area
- Or wrap small elements in `div.p-2`

## Priority 3: Form Labels

### Issue: 116 inputs without proper labels
- **Problem**: Only 5 htmlFor + 4 aria-labelledby against 87 <label> tags
- **Solution**: Each input must have a real `<label>`, not just placeholder

### Files to check:
- All forms in: CreateView.tsx, SettingsView.tsx, TtsVoiceSettings.tsx, etc.

### Implementation:
- Add `<label htmlFor="input-id">Label Text</label>` for each input
- Remove placeholder-only patterns
- Ensure aria-labelledby references actual label elements

## Priority 4: Native Dialogs

### Issue: 18 alert() and 2 prompt() calls block UI
- **Problem**: Can't be styled or translated
- **Solution**: Replace with toast/modal components

### alert() calls found:
- AudiobookPlayer.tsx:703
- CreateView.tsx:348, 445, 448, 472, 525
- DownloadBookBtn.tsx:15, 28
- FeedArticleReader.tsx:243
- LibraryManager.tsx:66, 2776
- SettingsView.tsx:646, 2686, 2762

### prompt() calls found:
- InstallView.tsx:1284 (deferredPromp.prompt())
- PwaLifecycleBanner.tsx:190 (await installEvent.prompt())

### Implementation:
- Create `showErrorToast(message, onRetry?)` function
- Create `showConfirmDialog(message)` for prompts
- Replace all alert() and prompt() calls

## Priority 5: Clickable divs → buttons

### Issue: 18 <div onClick> with no role attribute
- **Problem**: Keyboard/screen-reader users can't reach them
- **Solution**: Replace with <button> elements

### Implementation:
- Find all `<div onClick>` in components
- Replace with `<button onClick>` or `<a href>` where appropriate
- Add `role="button"` where needed for accessibility
- Preserve visual styling

## Priority 6: Navigation naming

### Issue: "Read" tab = news feed, "Library" = books
- **Problem**: Confusing naming convention
- **Solution**: Rename "Read" to "News" or "Paper"

### Current navigation (App.tsx lines 124-126):
```
{ id: "library" as const, label: "Library", Icon: Library },
{ id: "feed" as const, label: "Read", Icon: Rss },
```

### Implementation:
- Change `label: "Read"` to `label: "News"` or `label: "Paper"`
- Update all references and breadcrumbs
- Update Lounge card "The Paper" text

## Priority 7: Browser History/Back button

### Issue: No router or history handling in App.tsx
- **Problem**: Screens have no URLs, browser Back button doesn't work
- **Solution**: Implement proper routing/history

### Implementation:
- Check if using React Router or similar
- If not, consider adding hash-based routing or state management
- Ensure each screen has a unique URL fragment

## Priority 8: Loading states (skeletons vs spinners)

### Issue: 74 spinners, 23 skeleton files
- **Problem**: Prefer skeletons for Library grid and Discover cards
- **Solution**: Use skeleton loading patterns for content grids

### Implementation:
- Replace spinners with skeleton grids where appropriate
- Use `h-64` or appropriate height skeleton cards
- Maintain visual consistency during loading

## Priority 9: Dhivehi/RTL support

### Issue: Partial Thaana support, test with RTL text
- **Problem**: Serve Maldivian users, need proper RTL support
- **Solution**: Test reader and library with right-to-left text

### Implementation:
- Test EPUB/PDF reading with Thaana text
- Ensure CSS accommodates RTL (`direction: rtl`)
- Verify text selection and highlighting works
- Check dictionary/search with Arabic/Thaana characters

---
*Starting implementation with Priority 1 (Error Handling) through Priority 4 (Native Dialogs)*