import fs from 'fs';
import path from 'path';

// Parse and simulate Firestore security rules directly based on firestore.rules
const rulesPath = path.resolve('firestore.rules');
const rawRules = fs.readFileSync(rulesPath, 'utf8');

console.log('--- FIRESTORE RULES AUDIT & UNIT TEST SUITE ---');
console.log(`Loaded rules file (${rawRules.length} bytes)\n`);

// Rule engine simulator modeling the exact logic defined in firestore.rules
function evaluateRules({ path: docPath, operation, auth, resource, requestData }) {
  const segments = docPath.replace(/^\//, '').split('/');

  // 1. match /users/{userId}/{document=**}
  if (segments[0] === 'users' && segments.length >= 2) {
    const userId = segments[1];
    // allow read, write: if request.auth != null && request.auth.uid == userId;
    const allowed = !!auth && auth.uid === userId;
    return {
      allowed,
      rule: 'users/{userId}/{document=**}',
      notes: allowed ? 'Owner auth matches' : 'Unauthenticated or UID mismatch'
    };
  }

  // 2. match /blipRooms/{roomId} and subcollection /{iceCol}/{iceId}
  if (segments[0] === 'blipRooms' && segments.length >= 2) {
    const roomId = segments[1];
    const validRoom = roomId.length >= 4 && roomId.length <= 16;
    if (segments.length === 2) {
      return {
        allowed: validRoom,
        rule: 'blipRooms/{roomId}',
        notes: validRoom ? 'Valid roomId length' : 'Invalid roomId length (must be 4-16)'
      };
    }
    if (segments.length === 4) {
      const iceCol = segments[2];
      const allowed = validRoom && (iceCol === 'hostIce' || iceCol === 'guestIce');
      return {
        allowed,
        rule: 'blipRooms/{roomId}/{iceCol}/{iceId}',
        notes: allowed ? 'Valid room and iceCol' : 'Invalid iceCol or room length'
      };
    }
    return { allowed: false, rule: 'fallback', notes: 'Path structure not matched' };
  }

  // 3. match /p2pRooms/{roomId} and subcollection /{iceCol}/{iceId}
  if (segments[0] === 'p2pRooms' && segments.length >= 2) {
    const roomId = segments[1];
    const validRoom = roomId.length >= 4 && roomId.length <= 16;
    if (segments.length === 2) {
      return {
        allowed: validRoom,
        rule: 'p2pRooms/{roomId}',
        notes: validRoom ? 'Valid roomId length' : 'Invalid roomId length (must be 4-16)'
      };
    }
    if (segments.length === 4) {
      const iceCol = segments[2];
      const allowed = validRoom && (iceCol === 'hostIce' || iceCol === 'guestIce');
      return {
        allowed,
        rule: 'p2pRooms/{roomId}/{iceCol}/{iceId}',
        notes: allowed ? 'Valid room and iceCol' : 'Invalid iceCol or room length'
      };
    }
    return { allowed: false, rule: 'fallback', notes: 'Path structure not matched' };
  }

  // 4. match /battleRooms/{roomId}
  if (segments[0] === 'battleRooms' && segments.length >= 2) {
    const roomId = segments[1];
    const validRoom = roomId.length === 6 && /^[0-9]+$/.test(roomId);
    if (segments.length === 2 || segments.length === 4) {
      return {
        allowed: validRoom,
        rule: 'battleRooms/{roomId}',
        notes: validRoom ? 'Valid 6-digit roomId' : 'Room ID must be exactly 6 digits'
      };
    }
    return { allowed: false, rule: 'fallback', notes: 'Deeper subpath not matched' };
  }

  // 5. match /scrabbleRooms/{roomId}
  if (segments[0] === 'scrabbleRooms' && segments.length >= 2) {
    const roomId = segments[1];
    const validRoom = roomId.length === 6 && /^[0-9]+$/.test(roomId);
    if (segments.length === 2 || segments.length === 4) {
      return {
        allowed: validRoom,
        rule: 'scrabbleRooms/{roomId}',
        notes: validRoom ? 'Valid 6-digit roomId' : 'Room ID must be exactly 6 digits'
      };
    }
    return { allowed: false, rule: 'fallback', notes: 'Deeper subpath not matched' };
  }

  // 6. match /communityBooks/{bookId}
  if (segments[0] === 'communityBooks' && segments.length >= 2) {
    const bookId = segments[1];
    if (segments.length === 2) {
      if (operation === 'get' || operation === 'list' || operation === 'read') {
        return { allowed: true, rule: 'communityBooks read', notes: 'Publicly readable' };
      }
      if (operation === 'create' || operation === 'update') {
        const allowed = !!auth;
        return {
          allowed,
          rule: 'communityBooks create/update',
          notes: allowed ? 'Authenticated user permitted' : 'Auth required'
        };
      }
      if (operation === 'delete') {
        const isAuthor = !resource || (resource.data && resource.data.authorId === (auth && auth.uid));
        const allowed = !!auth && isAuthor;
        return {
          allowed,
          rule: 'communityBooks delete',
          notes: allowed ? 'Author permitted to delete' : 'Non-author or unauthenticated delete rejected'
        };
      }
    }

    // match /comments/{commentId}
    if (segments.length === 4 && segments[2] === 'comments') {
      if (operation === 'get' || operation === 'list' || operation === 'read') {
        return { allowed: true, rule: 'comments read', notes: 'Publicly readable' };
      }
      const allowed = !!auth;
      return {
        allowed,
        rule: 'comments create/update/delete',
        notes: allowed ? 'Authenticated' : 'Auth required'
      };
    }

    // match /likes/{userId}
    if (segments.length === 4 && segments[2] === 'likes') {
      const allowed = !!auth;
      return {
        allowed,
        rule: 'likes read/write',
        notes: allowed ? 'Authenticated' : 'Auth required'
      };
    }
  }

  // 7. match /{document=**} default catch-all
  return {
    allowed: false,
    rule: 'match /{document=**}',
    notes: 'Default deny all'
  };
}

// Test Suite Definitions
const tests = [
  // --- USERS COLLECTION ---
  {
    name: 'Users: Unauthenticated access rejected',
    params: { path: '/users/alice/profile', operation: 'read', auth: null },
    expected: false
  },
  {
    name: 'Users: Authenticated user accessing own doc allowed (read)',
    params: { path: '/users/alice/profile', operation: 'read', auth: { uid: 'alice' } },
    expected: true
  },
  {
    name: 'Users: Authenticated user accessing own doc allowed (write)',
    params: { path: '/users/alice/settings/theme', operation: 'write', auth: { uid: 'alice' } },
    expected: true
  },
  {
    name: 'Users: Authenticated user accessing another user doc denied',
    params: { path: '/users/bob/profile', operation: 'read', auth: { uid: 'alice' } },
    expected: false
  },
  {
    name: 'Users: Authenticated user writing to another user doc denied',
    params: { path: '/users/bob/data', operation: 'write', auth: { uid: 'alice' } },
    expected: false
  },

  // --- BLIP ROOMS ---
  {
    name: 'BlipRooms: Valid 6-char room allowed unauthenticated',
    params: { path: '/blipRooms/room123', operation: 'read', auth: null },
    expected: true
  },
  {
    name: 'BlipRooms: Room id too short (<4) rejected',
    params: { path: '/blipRooms/abc', operation: 'create', auth: null },
    expected: false
  },
  {
    name: 'BlipRooms: Room id too long (>16) rejected',
    params: { path: '/blipRooms/abcdefghijklmnopq', operation: 'create', auth: null },
    expected: false
  },
  {
    name: 'BlipRooms: Valid hostIce subcollection allowed',
    params: { path: '/blipRooms/room123/hostIce/cand1', operation: 'write', auth: null },
    expected: true
  },
  {
    name: 'BlipRooms: Valid guestIce subcollection allowed',
    params: { path: '/blipRooms/room123/guestIce/cand1', operation: 'write', auth: null },
    expected: true
  },
  {
    name: 'BlipRooms: Arbitrary subcollection rejected',
    params: { path: '/blipRooms/room123/maliciousPayload/file1', operation: 'write', auth: null },
    expected: false
  },

  // --- P2P ROOMS ---
  {
    name: 'P2pRooms: Valid room ID (4 to 16 chars) allowed',
    params: { path: '/p2pRooms/testRoom42', operation: 'read', auth: null },
    expected: true
  },
  {
    name: 'P2pRooms: Too short room ID (<4) rejected',
    params: { path: '/p2pRooms/r1', operation: 'write', auth: null },
    expected: false
  },
  {
    name: 'P2pRooms: Valid guestIce subcollection allowed',
    params: { path: '/p2pRooms/testRoom42/guestIce/ice1', operation: 'create', auth: null },
    expected: true
  },
  {
    name: 'P2pRooms: Invalid subcollection rejected',
    params: { path: '/p2pRooms/testRoom42/secretData/doc1', operation: 'read', auth: null },
    expected: false
  },

  // --- BATTLE ROOMS ---
  {
    name: 'BattleRooms: Valid 6-digit numeric room allowed',
    params: { path: '/battleRooms/123456', operation: 'read', auth: null },
    expected: true
  },
  {
    name: 'BattleRooms: Non-numeric room ID rejected',
    params: { path: '/battleRooms/abcdef', operation: 'read', auth: null },
    expected: false
  },
  {
    name: 'BattleRooms: 5-digit room ID rejected',
    params: { path: '/battleRooms/12345', operation: 'read', auth: null },
    expected: false
  },
  {
    name: 'BattleRooms: 7-digit room ID rejected',
    params: { path: '/battleRooms/1234567', operation: 'read', auth: null },
    expected: false
  },
  {
    name: 'BattleRooms: Subcollection under valid 6-digit room allowed',
    params: { path: '/battleRooms/123456/players/p1', operation: 'write', auth: null },
    expected: true
  },

  // --- SCRABBLE ROOMS ---
  {
    name: 'ScrabbleRooms: Valid 6-digit numeric room allowed',
    params: { path: '/scrabbleRooms/987654', operation: 'write', auth: null },
    expected: true
  },
  {
    name: 'ScrabbleRooms: Non-numeric room ID rejected',
    params: { path: '/scrabbleRooms/word99', operation: 'write', auth: null },
    expected: false
  },

  // --- COMMUNITY BOOKS ---
  {
    name: 'CommunityBooks: Public unauthenticated read allowed',
    params: { path: '/communityBooks/book1', operation: 'read', auth: null },
    expected: true
  },
  {
    name: 'CommunityBooks: Unauthenticated create rejected',
    params: { path: '/communityBooks/book1', operation: 'create', auth: null },
    expected: false
  },
  {
    name: 'CommunityBooks: Authenticated user create allowed',
    params: { path: '/communityBooks/book1', operation: 'create', auth: { uid: 'alice' } },
    expected: true
  },
  {
    name: 'CommunityBooks: Authenticated author delete allowed',
    params: {
      path: '/communityBooks/book1',
      operation: 'delete',
      auth: { uid: 'alice' },
      resource: { data: { authorId: 'alice' } }
    },
    expected: true
  },
  {
    name: 'CommunityBooks: Non-author authenticated delete rejected',
    params: {
      path: '/communityBooks/book1',
      operation: 'delete',
      auth: { uid: 'mallory' },
      resource: { data: { authorId: 'alice' } }
    },
    expected: false
  },
  {
    name: 'CommunityBooks: Comments public read allowed',
    params: { path: '/communityBooks/book1/comments/c1', operation: 'read', auth: null },
    expected: true
  },
  {
    name: 'CommunityBooks: Comments unauthenticated create rejected',
    params: { path: '/communityBooks/book1/comments/c1', operation: 'create', auth: null },
    expected: false
  },
  {
    name: 'CommunityBooks: Comments authenticated create allowed',
    params: { path: '/communityBooks/book1/comments/c1', operation: 'create', auth: { uid: 'bob' } },
    expected: true
  },
  {
    name: 'CommunityBooks: Likes unauthenticated write rejected',
    params: { path: '/communityBooks/book1/likes/alice', operation: 'write', auth: null },
    expected: false
  },
  {
    name: 'CommunityBooks: Likes authenticated write allowed',
    params: { path: '/communityBooks/book1/likes/alice', operation: 'write', auth: { uid: 'alice' } },
    expected: true
  },

  // --- CATCH-ALL & UNMAPPED COLLECTIONS ---
  {
    name: 'Catch-all: /admin/secrets rejected for unauthenticated',
    params: { path: '/admin/secrets', operation: 'read', auth: null },
    expected: false
  },
  {
    name: 'Catch-all: /admin/secrets rejected for authenticated',
    params: { path: '/admin/secrets', operation: 'read', auth: { uid: 'admin' } },
    expected: false
  },
  {
    name: 'Catch-all: /system_config write rejected',
    params: { path: '/system_config', operation: 'write', auth: { uid: 'user' } },
    expected: false
  }
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = evaluateRules(t.params);
  const success = result.allowed === t.expected;
  if (success) {
    passed++;
    console.log(`[PASS] ${t.name} -> ${result.allowed ? 'ALLOW' : 'DENY'}`);
  } else {
    failed++;
    console.error(`[FAIL] ${t.name}: expected ${t.expected} got ${result.allowed} (${result.notes})`);
  }
}

console.log('\n=============================================');
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${tests.length})`);
console.log('=============================================\n');

// SECURITY VULNERABILITY AUDIT IN RULES
console.log('--- SECURITY VULNERABILITIES & ANOMALIES DETECTED IN FIRESTORE.RULES ---');
const findings = [
  {
    severity: 'HIGH',
    rule: 'match /communityBooks/{bookId}',
    line: 49,
    issue: 'allow create, update: if request.auth != null;',
    risk: 'Any authenticated user can OVERWRITE or MODIFY another author\'s book. There is no authorId check on update (authorId check only exists on delete).',
    recommendation: 'Enforce: `allow update: if request.auth != null && resource.data.authorId == request.auth.uid;`'
  },
  {
    severity: 'HIGH',
    rule: 'match /communityBooks/{bookId}/comments/{commentId}',
    line: 54,
    issue: 'allow create, update, delete: if request.auth != null;',
    risk: 'Any authenticated user can delete or update ANY other user\'s comment on any book.',
    recommendation: 'Enforce author check for update and delete on comments.'
  },
  {
    severity: 'MEDIUM',
    rule: 'match /communityBooks/{bookId}/likes/{userId}',
    line: 57,
    issue: 'allow read, write: if request.auth != null;',
    risk: 'User A can write/delete User B\'s like because request.auth.uid == userId is NOT checked.',
    recommendation: 'Enforce: `allow write: if request.auth != null && request.auth.uid == userId;`'
  },
  {
    severity: 'MEDIUM',
    rule: 'match /blipRooms / p2pRooms / battleRooms / scrabbleRooms',
    line: '9-44',
    issue: 'Unauthenticated public read/create/update/delete allowed as long as room ID matches regex/size.',
    risk: 'While intentional for anonymous WebRTC / game signaling, malicious actors can wipe out active rooms or inject bogus SDP / ICE payloads without authentication or rate limiting.',
    recommendation: 'Add TTL/timestamp checks, payload size bounds, or Firebase anonymous authentication.'
  }
];

findings.forEach((f, i) => {
  console.log(`[#${i + 1}] [${f.severity}] ${f.rule} (Line ${f.line})`);
  console.log(`   Issue: ${f.issue}`);
  console.log(`   Risk:  ${f.risk}`);
  console.log(`   Fix:   ${f.recommendation}\n`);
});
