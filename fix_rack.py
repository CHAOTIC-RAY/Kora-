with open('src/components/OnlineScrabbleGame.tsx', 'r') as f:
    content = f.read()

# Update rack tiles to have proper touch targets
old_rack = """{me?.tiles?.map((letter, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectRackTile(idx)}
                        className={`p-2 rounded-xl bg-kindle-card border border-kindle-border hover:bg-kindle-accent/30 text-kindle-accent text-xs font-bold uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-kindle-accent focus:ring-offset-2 cursor-pointer ${selectedRackIdx === idx ? 'ring-4 ring-kindle-accent' : ''}`}
                        title={`Tile ${idx + 1}`}
                      >
                        {letter}
                      </button>
                    ))}"""

new_rack = """{me?.tiles?.map((letter, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectRackTile(idx)}
                        className={`p-2 rounded-xl bg-kindle-card border border-kindle-border hover:bg-kindle-accent/30 text-kindle-accent text-xs font-bold uppercase tracking-wider transition focus:outline-none focus:ring-2 focus:ring-kindle-accent focus:ring-offset-2 cursor-pointer ${selectedRackIdx === idx ? 'ring-4 ring-kindle-accent' : ''}`}
                        title={`Tile ${idx + 1}`}
                        style={{ minWidth: '44px', minHeight: '44px' }}
                      >
                        {letter}
                      </button>
                    ))}"""

if old_rack in content:
    content = content.replace(old_rack, new_rack)
    with open('src/components/OnlineScrabbleGame.tsx', 'w') as f:
        f.write(content)
    print("Rack tiles updated for mobile touch targets")
else:
    print("Rack section not found")
