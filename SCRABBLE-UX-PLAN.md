# Scrabble UX Improvements - Progress

## Phase 1: Mode Selection & Lobby UX ✅ COMPLETED
- [x] Added clearer visual distinction between CPU and Online modes in the menu
- [x] Improved room code input with real-time validation feedback
- [x] Added connection status indicator for online rooms
- [x] Enhanced lobby player list with avatars/connection dots

## Phase 2: Gameplay Feedback 🔄 IN PROGRESS
- [x] Added clearer turn indicator (whose turn it is) - "Your Turn" / "Opponent's Turn" with ⚡ / ⏳ icons
- [ ] Add animation when tiles are placed on the board
- [ ] Add sound effects feedback (already partially implemented)
- [ ] Add invalid move feedback with specific reasons

## Phase 3: Tile Rack & Controls
- [ ] Improve selected tile visual feedback (glow animation)
- [ ] Add tile shake animation when rack is shuffled
- [ ] Add drag-and-drop feel to tile placement
- [ ] Add "swap tiles" confirmation dialog

## Phase 4: Scoring & Game End
- [ ] Add real-time score updates as words are placed
- [ ] Add bingo bonus animation
- [ ] Add game summary at end with word breakdown
- [ ] Add option to play again or exit

## Phase 5: Help & Accessibility
- [ ] Add tooltips for board multipliers (TWS, DWS, TLS, DLS)
- [ ] Add first-word center star highlighting
- [ ] Add keyboard shortcuts documentation
- [ ] Improve color contrast for accessibility

### Completed Improvements:
**Menu Screen:**
- CPU mode card with description and average game time (3-5 min)
- Online mode card with room code display and player limits (max 4)
- Join online room section with real-time code validation (rose for invalid, emerald for valid 6-digit codes)
- Card-based layout with better visual hierarchy

**Game Screen:**
- Turn indicator showing "Your Turn" / "Opponent's Turn" with ⚡ / ⏳ icons
- Turn status messages: "Place your tiles on the board" / "Waiting for opponent..."
- Balanced syntax (598 parens, 327 braces)

### Next Priority:
- Tile rack glow animation for playable tiles
- Board cell highlight on hover
- Sound effects for tile placement
