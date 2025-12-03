// server.js
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------ GAME CONSTANTS ------------------ */

const ROOMS = [
  'WHISPERING HALL',
  'THE FLICKERING LAMP STUDY',
  'THE SILENT BEDROOM',
  'PARLOR OF ECHOES',
  'THE BLOOD-STAINED KITCHEN',
  'THE UNDERHOUSE',
  'FORGOTTEN CELLAR',
  'THE IRON CHAMBER'
];

// Updated connections:
// - Parlor of Echoes connects to Silent Bedroom + Blood-Stained Kitchen
// - Blood-Stained Kitchen connects to Whispering Hall + Parlor
const ROOM_CONNECTIONS = {
  'WHISPERING HALL': [
    'THE FLICKERING LAMP STUDY',
    'THE SILENT BEDROOM',
    'THE BLOOD-STAINED KITCHEN',
    'THE UNDERHOUSE'
  ],
  'THE FLICKERING LAMP STUDY': [
    'WHISPERING HALL',
    'THE SILENT BEDROOM'
  ],
  'THE SILENT BEDROOM': [
    'WHISPERING HALL',
    'THE FLICKERING LAMP STUDY',
    'PARLOR OF ECHOES'
  ],
  'PARLOR OF ECHOES': [
    'THE SILENT BEDROOM',
    'THE BLOOD-STAINED KITCHEN'
  ],
  'THE BLOOD-STAINED KITCHEN': [
    'WHISPERING HALL',
    'PARLOR OF ECHOES'
  ],
  'THE UNDERHOUSE': [
    'WHISPERING HALL',
    'FORGOTTEN CELLAR',
    'THE IRON CHAMBER'
  ],
  'FORGOTTEN CELLAR': [
    'THE UNDERHOUSE',
    'THE IRON CHAMBER'
  ],
  'THE IRON CHAMBER': [
    'THE UNDERHOUSE',
    'FORGOTTEN CELLAR'
  ]
};

const START_ROOM = 'WHISPERING HALL';
const GM_PIN = '1313';

/* ------------------ GAME STATE ------------------ */

function createFreshGame() {
  return {
    round: 1,
    players: [],   // { id, name, pin, role, alive, room, startRoom, clues: [], _hasMovedYet }
    moves: [],     // { round, pin, from, to }
    votes: [],     // { round, voterPin, targetPin }
    kills: [],     // { round, room, victimPin, resolved }

    // Room reveal (global) – active this round
    revealDots: false,
    revealDotsNextRound: false,

    // Killer’s Gaze – killer-only map vision
    killerVision: false,
    killerVisionNextRound: false,

    // Screams of the Stolen (popup only)
    screamActive: false,
    screamNextRound: false,

    // The Shove in the Dark (random scatter at round start)
    shoveNextRound: false,
    shoveTriggeredRound: null, // round when shove fired

    // Killer clue visibility (GM can toggle any time)
    killerSeesClues: true,

    // Clue system
    // clues.perRoom[room] = [ text|null, text|null ]
    clues: null, // { sentence, perRoom: { room: [text|null, text|null] } }

    // not really used anymore, but kept so removePlayer can safely filter
    claimedClues: []
  };
}

let gameState = createFreshGame();

/* ------------------ BASIC HELPERS ------------------ */

function findPlayerByPin(pin) {
  return gameState.players.find(p => String(p.pin) === String(pin));
}

function findPlayerById(id) {
  return gameState.players.find(p => p.id === id);
}

function generatePin() {
  let pin;
  do {
    pin = String(Math.floor(Math.random() * 90) + 10); // 10–99
  } while (findPlayerByPin(pin));
  return pin;
}

function getAllowedRoomsFrom(currentRoom) {
  const rooms = ROOM_CONNECTIONS[currentRoom] || [];
  return rooms.slice();
}

function getRoomDescription(room) {
  switch (room) {
    case 'FORGOTTEN CELLAR':
      return 'Moist air, dripping pipes, and footprints that don’t match anyone still alive. Something down here moves—but never waits to be seen.';
    case 'THE UNDERHOUSE':
      return 'The house breathes down here. Wooden beams groan like they\'re holding in secrets—or bodies. It feels wrong to speak… in case something hears you.';
    case 'THE IRON CHAMBER':
      return 'Cold metal. No windows. Your voice sounds swallowed. Chains hang loosely—swinging slightly—though there’s no draft. Were they just used?';
    case 'THE BLOOD-STAINED KITCHEN':
      return 'No smell of food. Just iron. The stains are old, but still wet in places—as if someone keeps adding to them.';
    case 'THE FLICKERING LAMP STUDY':
      return 'The lamp flickers, though the air is still. Papers rustle, pages turn—without wind, and without anyone touching them.';
    case 'PARLOR OF ECHOES':
      return 'You hear footsteps, but they\'re perfectly delayed, like a second version of you is walking just behind—where you never dare to look.';
    case 'WHISPERING HALL':
      return 'The whispers aren’t from ghosts—they’re gossiping about the last kill. They repeat a single name, over and over… until you realize it’s yours.';
    case 'THE SILENT BEDROOM':
      return 'The pillow still holds the shape of a head—and a dark stain where it stopped breathing. The room is silent… because what happened here was loud.';
    default:
      return 'Something about this room feels wrong, like you arrived a moment too late.';
  }
}

/* ---------- CLUE HELPERS ---------- */

// Put a dead player's clues back into the house
function returnCluesToRooms(player) {
  if (!player || !player.clues || !gameState.clues || !gameState.clues.perRoom) return;

  player.clues.forEach(c => {
    if (!c || !c.room || !c.text) return;

    const slots = gameState.clues.perRoom[c.room];
    if (!Array.isArray(slots)) return;

    // Put clue back in the first empty slot, if any
    const emptyIndex = slots.indexOf(null);
    if (emptyIndex !== -1) {
      slots[emptyIndex] = c.text;
    }
  });

  // Clear the player’s personal clue list
  player.clues = [];
}

// Split sentence into evenly sized fragments, all unique
function generateClueFragments(sentenceRaw) {
  const sentence = String(sentenceRaw || '').trim().replace(/\s+/g, ' ');
  if (!sentence) return [];

  const words = sentence.split(' ');
  const maxFragments = ROOMS.length * 2;       // 2 slots per room total
  const fragmentCount = Math.min(maxFragments, words.length);
  if (fragmentCount <= 0) return [];

  const fragments = [];
  const baseSize = Math.floor(words.length / fragmentCount);
  let remainder = words.length % fragmentCount;
  let index = 0;

  for (let i = 0; i < fragmentCount; i++) {
    let size = baseSize;
    if (remainder > 0) {
      size += 1;
      remainder -= 1;
    }
    const partWords = words.slice(index, index + size);
    index += size;
    if (partWords.length) {
      fragments.push(partWords.join(' '));
    }
  }
  return fragments;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// GM scatters clues from a secret sentence (2 per room, randomly)
function scatterCluesFromSentence(sentenceRaw) {
  const sentence = String(sentenceRaw || '').trim().replace(/\s+/g, ' ');
  if (!sentence) throw new Error('Secret sentence cannot be empty.');

  // Break sentence into fragments
  let fragments = generateClueFragments(sentence);
  fragments = shuffleArray(fragments.slice());

  const perRoom = {};
  let idx = 0;

  // Assign 2 clues per room
  ROOMS.forEach(room => {
    perRoom[room] = [];

    for (let i = 0; i < 2; i++) {
      if (idx < fragments.length) {
        perRoom[room].push(fragments[idx]);
        idx++;
      } else {
        perRoom[room].push(null); // fewer fragments than slots
      }
    }
  });

  // Reset clue inventory on all players
  gameState.players.forEach(p => (p.clues = []));

  gameState.clues = {
    sentence,
    perRoom
  };

  return gameState.clues;
}

function ensurePlayerClueArray(player) {
  if (!Array.isArray(player.clues)) {
    player.clues = [];
  }
}

// Victims receive 1 clue per player per room
function maybeGiveClueOnMove(player, newRoom) {
  if (!player.alive) return null;
  if (player.role !== 'Victim') return null;
  if (!gameState.clues || !gameState.clues.perRoom) return null;

  // Track that they have moved at least once (may be used by future effects)
  if (!player._hasMovedYet) {
    player._hasMovedYet = true;
  }

  const roomSlots = gameState.clues.perRoom[newRoom] || [];
  const roomClues = roomSlots.filter(Boolean); // non-null
  if (!roomClues.length) return null;

  // Have they already collected a clue from this room?
  const already = (player.clues || []).filter(c => c.room === newRoom);
  if (already.length >= 1) return null;

  // Choose the first available clue
  const chosen = roomClues[0];
  if (!chosen) return null;

  // Record on player
  ensurePlayerClueArray(player);
  player.clues.push({ room: newRoom, text: chosen });

  // Remove from room so other players cannot take it
  const index = roomSlots.indexOf(chosen);
  if (index !== -1) {
    roomSlots[index] = null;
  }

  return chosen;
}

/* ---------- PLAYER SCATTER HELPERS ---------- */

/**
 * Scatter players so that:
 *  - Each selected player goes to a RANDOM room
 *  - That room is NEVER the same as their previous room (if possible)
 *  - Multiple players may share the same room
 */
function scatterPlayersNoSameRoom(includeDead = false) {
  const pool = gameState.players.filter(p => (includeDead ? true : p.alive));
  if (!pool.length) return 0;

  pool.forEach(p => {
    const prevRoom = p.room || START_ROOM;
    const possibleRooms = ROOMS.filter(r => r !== prevRoom);

    // Just in case (we always have >=2 rooms, but be safe)
    const targetPool = possibleRooms.length ? possibleRooms : ROOMS;
    const nextRoom = targetPool[Math.floor(Math.random() * targetPool.length)];

    p.room = nextRoom;
    if (!p.startRoom) {
      p.startRoom = START_ROOM;
    }
  });

  return pool.length;
}

/* ------------------ GM ROUTES ------------------ */

// Unlock GM panel
app.post('/api/gm/unlock', (req, res) => {
  const { gmPin } = req.body || {};
  if (String(gmPin) === String(GM_PIN)) {
    return res.json({
      ok: true,
      round: gameState.round,
      players: gameState.players
    });
  }
  return res.status(401).json({ ok: false, error: 'Invalid GM PIN.' });
});

// Get roster
app.get('/api/gm/roster', (req, res) => {
  res.json({
    ok: true,
    round: gameState.round,
    players: gameState.players
  });
});

// Update player
app.post('/api/gm/updatePlayer', (req, res) => {
  const { id, role, alive } = req.body || {};
  const player = findPlayerById(id);
  if (!player) {
    return res.status(400).json({ ok: false, error: 'Player not found.' });
  }

  const wasAlive = player.alive;

  if (role) {
    if (!['Unknown', 'Victim', 'Killer'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role.' });
    }
    player.role = role;
  }

  if (alive !== undefined) {
    player.alive = !!alive;
  }

  // If GM just switched them from alive → dead, return their clues to rooms
  if (wasAlive && !player.alive) {
    returnCluesToRooms(player);
  }

  res.json({ ok: true, player });
});

// Remove player
app.post('/api/gm/removePlayer', (req, res) => {
  const { id, pin } = req.body || {};
  const idx = gameState.players.findIndex(
    p => p.id === id && String(p.pin) === String(pin)
  );

  if (idx === -1) {
    return res.status(400).json({ ok: false, error: 'Player not found.' });
  }

  const removed = gameState.players.splice(idx, 1)[0];

  gameState.moves = gameState.moves.filter(m => String(m.pin) !== String(removed.pin));
  gameState.votes = gameState.votes.filter(
    v =>
      String(v.voterPin) !== String(removed.pin) &&
      String(v.targetPin) !== String(removed.pin)
  );
  gameState.kills = gameState.kills.filter(
    k => String(k.victimPin) !== String(removed.pin)
  );
  gameState.claimedClues = (gameState.claimedClues || []).filter(
    c => String(c.pin) !== String(removed.pin)
  );

  res.json({ ok: true });
});

// Randomize roles
app.post('/api/gm/randomizeRoles', (req, res) => {
  const alivePlayers = gameState.players.filter(p => p.alive);
  if (alivePlayers.length === 0) {
    return res.status(400).json({ ok: false, error: 'No players to assign roles.' });
  }

  alivePlayers.forEach(p => {
    p.role = 'Victim';
  });

  const killerIndex = Math.floor(Math.random() * alivePlayers.length);
  alivePlayers[killerIndex].role = 'Killer';

  res.json({ ok: true, players: gameState.players });
});

// Next round – applies "next round" effects and optional shove.
app.post('/api/gm/nextRound', (req, res) => {
  gameState.round += 1;

  // Apply Room Reveal for this round (then reset the "armed" flag)
  gameState.revealDots = !!gameState.revealDotsNextRound;
  gameState.revealDotsNextRound = false;

  // Apply Killer's Gaze for this round
  gameState.killerVision = !!gameState.killerVisionNextRound;
  gameState.killerVisionNextRound = false;

  // Apply Screams of the Stolen for this round
  gameState.screamActive = !!gameState.screamNextRound;
  gameState.screamNextRound = false;

  // Shove in the Dark: scatter players at start of THIS new round
  if (gameState.shoveNextRound) {
    scatterPlayersNoSameRoom(false);
    gameState.shoveTriggeredRound = gameState.round;
  } else {
    gameState.shoveTriggeredRound = null;
  }
  gameState.shoveNextRound = false;

  res.json({ ok: true, round: gameState.round });
});

// New game
app.post('/api/gm/newGame', (req, res) => {
  gameState = createFreshGame();
  res.json({ ok: true, round: gameState.round });
});

// Room Reveal toggle – arm effect for NEXT round only
app.post('/api/gm/toggleRevealDots', (req, res) => {
  gameState.revealDotsNextRound = !gameState.revealDotsNextRound;
  res.json({ ok: true, revealDotsNextRound: gameState.revealDotsNextRound });
});

// Killer's Gaze – arm for next round
app.post('/api/gm/toggleKillerGaze', (req, res) => {
  gameState.killerVisionNextRound = !gameState.killerVisionNextRound;
  res.json({ ok: true, killerVisionNextRound: gameState.killerVisionNextRound });
});

// Screams of the Stolen – arm for next round
app.post('/api/gm/toggleScream', (req, res) => {
  gameState.screamNextRound = !gameState.screamNextRound;
  res.json({ ok: true, screamNextRound: gameState.screamNextRound });
});

// The Shove in the Dark – arm scatter for next round
app.post('/api/gm/toggleShove', (req, res) => {
  gameState.shoveNextRound = !gameState.shoveNextRound;
  res.json({ ok: true, shoveNextRound: gameState.shoveNextRound });
});

// 🔴 NEW: toggle whether the Killer can see room clues
app.post('/api/gm/toggleKillerClues', (req, res) => {
  gameState.killerSeesClues = !gameState.killerSeesClues;
  res.json({ ok: true, killerSeesClues: gameState.killerSeesClues });
});

// Immediate scatter button (GM convenience)
// Random, any room except the one they were just in.
app.post('/api/gm/scatterPlayers', (req, res) => {
  const { includeDead } = req.body || {};
  const count = scatterPlayersNoSameRoom(!!includeDead);
  if (!count) {
    return res.status(400).json({ ok: false, error: 'No players to scatter.' });
  }
  res.json({ ok: true, scattered: count });
});

// GM: generate + scatter clues from secret sentence
app.post('/api/gm/generateClues', (req, res) => {
  const { sentence } = req.body || {};
  try {
    const clues = scatterCluesFromSentence(sentence);
    res.json({ ok: true, clues, secretSentence: clues.sentence });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || 'Error generating clues.' });
  }
});

// GM summary
app.get('/api/gm/summary', (req, res) => {
  const perRoom = {};
  ROOMS.forEach(r => {
    perRoom[r] = [];
  });

  gameState.players.forEach(p => {
    const room = p.room || START_ROOM;
    if (!perRoom[room]) perRoom[room] = [];
    perRoom[room].push({
      id: p.id,
      name: p.name,
      pin: p.pin,
      alive: p.alive
    });
  });

  const movedPins = new Set(
    gameState.moves
      .filter(m => m.round === gameState.round)
      .map(m => String(m.pin))
  );

  const votedPins = new Set(
    gameState.votes
      .filter(v => v.round === gameState.round)
      .map(v => String(v.voterPin))
  );

  const notMoved = gameState.players.filter(
    p => p.alive && !movedPins.has(String(p.pin))
  );

  const notVoted = gameState.players.filter(
    p => p.alive && !votedPins.has(String(p.pin))
  );

  // Vote tallies for current round
  const votesThisRound = gameState.votes.filter(
    v => v.round === gameState.round
  );
  const tally = {};
  votesThisRound.forEach(v => {
    const key = String(v.targetPin);
    tally[key] = (tally[key] || 0) + 1;
  });

  const votesByTarget = Object.entries(tally).map(([pin, count]) => {
    const player = findPlayerByPin(pin);
    return {
      pin: player ? player.pin : pin,
      name: player ? player.name : `PIN ${pin}`,
      count
    };
  });

  const killAttempts = gameState.kills.filter(
    k => k.round === gameState.round
  );

  const roomsSummary = ROOMS.map(room => {
    const playersHere = perRoom[room] || [];
    const roomSlots =
      gameState.clues &&
      gameState.clues.perRoom &&
      (gameState.clues.perRoom[room] || []);

    const cluesForDisplay = (roomSlots || []).filter(Boolean);

    return {
      room,
      players: playersHere,
      clues: cluesForDisplay
    };
  });

  res.json({
    ok: true,
    round: gameState.round,
    rooms: roomsSummary,
    notMoved: notMoved.map(p => ({
      id: p.id,
      name: p.name,
      pin: p.pin,
      room: p.room
    })),
    notVoted: notVoted.map(p => ({
      id: p.id,
      name: p.name,
      pin: p.pin,
      room: p.room
    })),
    players: gameState.players,
    votesByTarget,
    killAttempts
  });
});

/* ------------------ PLAYER ROUTES ------------------ */

// Register – blocked once round 2 has started
app.post('/api/register', (req, res) => {
  const { name } = req.body || {};
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return res.status(400).json({ ok: false, error: 'Name is required.' });
  }

  // After round 1, no new registrations – only rejoin
  if (gameState.round >= 2) {
    return res.status(400).json({
      ok: false,
      error: 'Registration is closed once Round 2 begins. Use your PIN to rejoin, or wait for a new game.'
    });
  }

  const id = gameState.players.length + 1;
  const pin = generatePin();

  const player = {
    id,
    name: trimmed,
    pin,
    role: 'Unknown',
    alive: true,
    room: START_ROOM,
    startRoom: START_ROOM,
    clues: [],
    _hasMovedYet: false
  };

  gameState.players.push(player);

  return res.json({
    ok: true,
    player: {
      id: player.id,
      name: player.name,
      pin: player.pin,
      role: player.role
    }
  });
});

// Rejoin
app.post('/api/rejoin', (req, res) => {
  const { pin } = req.body || {};
  const player = findPlayerByPin(pin);
  if (!player) {
    return res.status(400).json({ ok: false, error: 'PIN not found.' });
  }

  ensurePlayerClueArray(player);
  if (!player.startRoom) {
    player.startRoom = START_ROOM;
  }
  if (typeof player._hasMovedYet !== 'boolean') {
    player._hasMovedYet = false;
  }

  res.json({
    ok: true,
    player: {
      id: player.id,
      name: player.name,
      pin: player.pin,
      role: player.role,
      alive: player.alive
    }
  });
});

// Player state
app.post('/api/state', (req, res) => {
  const { pin } = req.body || {};
  const player = findPlayerByPin(pin);
  if (!player) {
    return res.status(400).json({ ok: false, error: 'Player not found.' });
  }

  ensurePlayerClueArray(player);
  if (!player.startRoom) {
    player.startRoom = START_ROOM;
  }

  const room = player.room || START_ROOM;

  // Should this player see global dots?
  const showGlobalDotsForPlayer =
    !!gameState.revealDots ||
    (!!gameState.killerVision && player.role === 'Killer');

  let roomDots = null;
  if (showGlobalDotsForPlayer) {
    const rooms = {};
    ROOMS.forEach(r => {
      rooms[r] = 0;
    });

    gameState.players.forEach(p => {
      if (!p.room) return;
      const r = p.room;
      if (!(r in rooms)) rooms[r] = 0;
      rooms[r] += 1;
    });

    roomDots = Object.keys(rooms).map(r => ({
      room: r,
      total: rooms[r]
    }));
  }

  const allowedRooms = getAllowedRoomsFrom(room);

  const livingHere = gameState.players.filter(
    p => p.room === room && p.alive
  );
  const bodiesHere = gameState.players.filter(
    p => p.room === room && !p.alive
  );

  const alivePlayers = gameState.players.filter(p => p.alive);
  const movedPins = new Set(
    gameState.moves
      .filter(m => m.round === gameState.round)
      .map(m => String(m.pin))
  );

  const everyoneMoved =
    alivePlayers.length > 0 &&
    alivePlayers.every(p => movedPins.has(String(p.pin)));

  let canKill = false;
  let killTarget = null;

  if (player.role === 'Killer' && player.alive && everyoneMoved) {
    const others = livingHere.filter(p => p.pin !== player.pin);
    if (others.length === 1) {
      canKill = true;
      killTarget = {
        pin: others[0].pin,
        name: others[0].name
      };
    }
  }

  const roster = gameState.players.map(p => ({
    id: p.id,
    name: p.name,
    pin: p.pin,
    alive: p.alive
  }));

  // Clues visible in this room
  let roomCluesForViewer = [];
  if (gameState.clues && gameState.clues.perRoom) {
    const roomSlots = gameState.clues.perRoom[room] || [];

    if (player.role === 'Killer' && gameState.killerSeesClues) {
      // Killer sees the fragments still in this room (strings)
      roomCluesForViewer = roomSlots.filter(Boolean);
    } else if (player.role === 'Killer') {
      // Killer clue vision disabled
      roomCluesForViewer = [];
    } else {
      // Victims only see clues they personally hold from this room
      roomCluesForViewer = (player.clues || [])
        .filter(c => c.room === room)
        .map(c => c.text);
    }
  }

  const effects = {
    roomReveal: !!gameState.revealDots,
    killerGaze: !!gameState.killerVision,
    scream: !!gameState.screamActive,
    shove: !!(gameState.shoveTriggeredRound === gameState.round)
  };

  res.json({
    ok: true,
    round: gameState.round,
    player: {
      id: player.id,
      name: player.name,
      pin: player.pin,
      role: player.role,
      alive: player.alive,
      room,
      clues: player.clues || []
    },
    roomInfo: {
      room,
      description: getRoomDescription(room),
      living: livingHere.map(p => ({ name: p.name, pin: p.pin })),
      bodies: bodiesHere.map(p => ({ name: p.name, pin: p.pin }))
    },
    allowedRooms,
    roster,
    canKill,
    killTarget,
    revealDots: showGlobalDotsForPlayer,
    roomDots,
    roomClues: roomCluesForViewer,
    effects
  });
});

// Move
app.post('/api/move', (req, res) => {
  const { pin, room } = req.body || {};
  const player = findPlayerByPin(pin);
  if (!player) {
    return res.status(400).json({ ok: false, error: 'Player not found.' });
  }

  if (!player.alive) {
    return res.status(400).json({ ok: false, error: 'Dead players cannot move.' });
  }

  const dest = String(room || '').trim();
  if (!ROOMS.includes(dest)) {
    return res.status(400).json({ ok: false, error: 'Invalid room.' });
  }

  const currentRoom = player.room || START_ROOM;
  const allowedRooms = getAllowedRoomsFrom(currentRoom);
  if (!allowedRooms.includes(dest)) {
    return res
      .status(400)
      .json({ ok: false, error: 'You cannot move there from this room.' });
  }

  if (dest === currentRoom) {
    return res
      .status(400)
      .json({ ok: false, error: 'You must move to a different room.' });
  }

  const alreadyMoved = gameState.moves.some(
    m => m.round === gameState.round && String(m.pin) === String(pin)
  );
  if (alreadyMoved) {
    return res
      .status(400)
      .json({ ok: false, error: 'You already moved this round.' });
  }

  gameState.moves.push({
    round: gameState.round,
    pin: player.pin,
    from: currentRoom,
    to: dest
  });

  player.room = dest;
  if (!player.startRoom) {
    player.startRoom = START_ROOM;
  }

  // Auto clue retrieval when entering new room
  const clue = maybeGiveClueOnMove(player, dest);

  res.json({
    ok: true,
    message: `You slip into ${dest}.`,
    room: dest,
    clue: clue || null
  });
});

// Vote
app.post('/api/vote', (req, res) => {
  const { pin, targetPin } = req.body || {};
  const voter = findPlayerByPin(pin);
  if (!voter) {
    return res.status(400).json({ ok: false, error: 'Voter not found.' });
  }

  if (!voter.alive) {
    return res.status(400).json({ ok: false, error: 'Dead players cannot vote.' });
  }

  const target = findPlayerByPin(targetPin);
  if (!target) {
    return res.status(400).json({ ok: false, error: 'Target not found.' });
  }

  if (voter.pin === target.pin) {
    return res
      .status(400)
      .json({ ok: false, error: 'You cannot vote for yourself.' });
  }

  const already = gameState.votes.some(
    v => v.round === gameState.round && String(v.voterPin) === String(pin)
  );
  if (already) {
    return res
      .status(400)
      .json({ ok: false, error: 'You already voted this round.' });
  }

  gameState.votes.push({
    round: gameState.round,
    voterPin: voter.pin,
    targetPin: target.pin
  });

  res.json({
    ok: true,
    message: `You silently point a finger at ${target.name}.`
  });
});

// Kill – resolves immediately, and returns victim's clues to rooms
app.post('/api/kill', (req, res) => {
  const { pin, targetPin } = req.body || {};
  const killer = findPlayerByPin(pin);
  if (!killer) {
    return res.status(400).json({ ok: false, error: 'Killer not found.' });
  }

  if (killer.role !== 'Killer') {
    return res.status(400).json({ ok: false, error: 'You are not the Killer.' });
  }

  if (!killer.alive) {
    return res
      .status(400)
      .json({ ok: false, error: 'Dead killers cannot kill.' });
  }

  const alivePlayers = gameState.players.filter(p => p.alive);
  const movedPins = new Set(
    gameState.moves
      .filter(m => m.round === gameState.round)
      .map(m => String(m.pin))
  );

  const everyoneMoved =
    alivePlayers.length > 0 &&
    alivePlayers.every(p => movedPins.has(String(p.pin)));

  if (!everyoneMoved) {
    return res.status(400).json({
      ok: false,
      error: 'You cannot kill until every living player has moved this round.'
    });
  }

  const victim = findPlayerByPin(targetPin);
  if (!victim || !victim.alive) {
    return res.status(400).json({ ok: false, error: 'Invalid victim.' });
  }

  if (!killer.room || killer.room !== victim.room) {
    return res
      .status(400)
      .json({ ok: false, error: 'You are not alone with that victim.' });
  }

  const livingHere = gameState.players.filter(
    p => p.room === killer.room && p.alive
  );
  const others = livingHere.filter(p => p.pin !== killer.pin);

  if (others.length !== 1 || others[0].pin !== victim.pin) {
    return res.status(400).json({
      ok: false,
      error: 'Too many eyes are watching. You hesitate.'
    });
  }

  // Kill resolves immediately: victim is dead, clues go back to rooms.
  victim.alive = false;
  returnCluesToRooms(victim);

  gameState.kills.push({
    round: gameState.round,
    room: killer.room,
    victimPin: victim.pin,
    resolved: true
  });

  res.json({
    ok: true,
    message: 'Your blade finds its mark. The room grows quieter.',
    victim: { name: victim.name, pin: victim.pin },
    room: killer.room
  });
});

/* -------------- JSON 404 fallback -------------- */

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found.' });
});

/* ------------------ START SERVER ------------------ */

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
