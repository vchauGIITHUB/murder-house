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

const ROOM_CONNECTIONS = {
  'WHISPERING HALL': [
    'THE FLICKERING LAMP STUDY',
    'THE SILENT BEDROOM',
    'PARLOR OF ECHOES',
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
    'WHISPERING HALL',
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
    players: [],   // { id, name, pin, role, alive, room, clues: [] }
    moves: [],     // { round, pin, from, to }
    votes: [],     // { round, voterPin, targetPin }
    kills: [],     // { round, room, victimPin, resolved }
    revealDots: false,
    clues: null    // { sentence, fragments, perRoom: { room: [clue1, clue2] } }
  };
}

let gameState = createFreshGame();

/* ------------------ HELPERS ------------------ */

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

// Split sentence into evenly sized fragments, all unique (no repeats)
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

  // Chunk into fragmentCount pieces with sizes as even as possible
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

// Called when GM generates clues from the secret sentence
function assignCluesForSentence(sentenceRaw) {
  const sentence = String(sentenceRaw || '').trim().replace(/\s+/g, ' ');
  if (!sentence) {
    throw new Error('Secret sentence cannot be empty.');
  }

  let fragments = generateClueFragments(sentence);
  if (!fragments.length) {
    throw new Error('Could not break sentence into fragments.');
  }

  // Randomize fragment order before assigning to rooms
  fragments = shuffleArray(fragments.slice());

  const perRoom = {};
  const totalSlots = ROOMS.length * 2; // 2 per room
  let idx = 0;

  ROOMS.forEach(room => {
    const roomFragments = [];
    for (let i = 0; i < 2; i++) {
      if (idx < fragments.length) {
        roomFragments.push(fragments[idx]);
        idx++;
      } else {
        // No more fragments – slot stays empty
        roomFragments.push(null);
      }
    }
    perRoom[room] = roomFragments;
  });

  gameState.clues = {
    sentence,
    fragments,
    perRoom
  };

  // Reset collected clues for all players
  gameState.players.forEach(p => {
    p.clues = [];
  });

  return gameState.clues;
}

function ensurePlayerClueArray(player) {
  if (!Array.isArray(player.clues)) {
    player.clues = [];
  }
}

/**
 * Decide if a victim can retrieve a clue in this room.
 *
 * Normal rule: 1 clue per room per victim.
 * Adjustment: when there are fewer living victims than total clues already retrieved,
 * allow extra clues, but only to victims with the fewest clues overall.
 */
function canRetrieveClue(player, room) {
  if (!gameState.clues || !gameState.clues.perRoom) return false;
  const roomClues = (gameState.clues.perRoom[room] || []).filter(Boolean);
  if (!roomClues.length) return false;

  ensurePlayerClueArray(player);

  const livingVictims = gameState.players.filter(
    p => p.alive && p.role === 'Victim'
  );
  if (!livingVictims.length) return false;

  const totalCluesClaimed = livingVictims.reduce(
    (sum, p) => sum + (Array.isArray(p.clues) ? p.clues.length : 0),
    0
  );

  const playerCluesInRoom = player.clues.filter(c => c.room === room).length;

  // Base rule: max 1 clue per room per victim
  if (playerCluesInRoom === 0) return true;

  // Adjustment rule: if the group is shrinking relative to clues claimed,
  // let lowest-clue victims grab extra to keep it solvable.
  if (livingVictims.length < totalCluesClaimed) {
    const counts = livingVictims.map(
      p => (Array.isArray(p.clues) ? p.clues.length : 0)
    );
    const minClues = Math.min(...counts);
    const playerTotal = player.clues.length;
    return playerTotal === minClues;
  }

  return false;
}

// Auto-give a clue when a living Victim enters a room
function maybeGiveClueOnMove(player, room) {
  if (!player.alive) return null;
  if (player.role !== 'Victim') return null;
  if (!gameState.clues || !gameState.clues.perRoom) return null;

  const roomClues = (gameState.clues.perRoom[room] || []).filter(Boolean);
  if (!roomClues.length) return null;

  if (!canRetrieveClue(player, room)) return null;

  ensurePlayerClueArray(player);

  const alreadyTexts = new Set(
    player.clues.filter(c => c.room === room).map(c => c.text)
  );
  const unseen = roomClues.filter(text => !alreadyTexts.has(text));
  const chosen = unseen.length ? unseen[0] : roomClues[0];

  player.clues.push({ room, text: chosen });

  return chosen;
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

  if (role) {
    if (!['Unknown', 'Victim', 'Killer'].includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role.' });
    }
    player.role = role;
  }

  if (alive !== undefined) {
    player.alive = !!alive;
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

// Next round
app.post('/api/gm/nextRound', (req, res) => {
  gameState.round += 1;
  res.json({ ok: true, round: gameState.round });
});

// New game
app.post('/api/gm/newGame', (req, res) => {
  gameState = createFreshGame();
  res.json({ ok: true, round: gameState.round });
});

// Toggle whether players see global dots
app.post('/api/gm/toggleRevealDots', (req, res) => {
  gameState.revealDots = !gameState.revealDots;
  res.json({ ok: true, revealDots: gameState.revealDots });
});

// GM generates clue fragments from secret sentence
app.post('/api/gm/generateClues', (req, res) => {
  try {
    const { sentence } = req.body || {};
    const clues = assignCluesForSentence(sentence);
    res.json({
      ok: true,
      sentence: clues.sentence,
      fragments: clues.fragments,
      perRoom: clues.perRoom
    });
  } catch (err) {
    res
      .status(400)
      .json({ ok: false, error: err.message || 'Error generating clues.' });
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

  // Resolve pending kills only AFTER all living players have voted
  if (notVoted.length === 0) {
    gameState.kills
      .filter(k => k.round === gameState.round && !k.resolved)
      .forEach(k => {
        const victim = findPlayerByPin(k.victimPin);
        if (victim && victim.alive) {
          victim.alive = false;
        }
        k.resolved = true;
      });
  }

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

  // Kill attempts for this round (private to GM)
  const killAttempts = gameState.kills
    .filter(k => k.round === gameState.round)
    .map(k => {
      const victim = findPlayerByPin(k.victimPin);
      return {
        victimPin: k.victimPin,
        victimName: victim ? victim.name : `PIN ${k.victimPin}`,
        room: k.room,
        resolved: !!k.resolved
      };
    });

  res.json({
    ok: true,
    round: gameState.round,
    rooms: ROOMS.map(room => ({
      room,
      players: perRoom[room] || [],
      clues:
        (gameState.clues &&
          gameState.clues.perRoom &&
          (gameState.clues.perRoom[room] || []).filter(Boolean)) || []
    })),
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

// Register
app.post('/api/register', (req, res) => {
  const { name } = req.body || {};
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return res.status(400).json({ ok: false, error: 'Name is required.' });
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
    clues: []
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

  let roomDots = null;
  if (gameState.revealDots) {
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

    roomDots = Object.keys(rooms).map(room => ({
      room,
      total: rooms[room]
    }));
  }

  const room = player.room || START_ROOM;
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
    const roomClues = (gameState.clues.perRoom[room] || []).filter(Boolean);

    if (player.role === 'Killer') {
      // Killer sees both clues in this room
      roomCluesForViewer = roomClues.slice();
    } else {
      // Victims only see clues they have retrieved in this room
      roomCluesForViewer = (player.clues || [])
        .filter(c => c.room === room)
        .map(c => c.text);
    }
  }

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
    revealDots: gameState.revealDots,
    roomDots,
    roomClues: roomCluesForViewer
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

  // Auto clue retrieval for Victims entering new room
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

// Kill (hidden, pending until votes finished)
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

  // Do NOT mark victim dead yet – just record a hidden kill attempt.
  gameState.kills.push({
    round: gameState.round,
    room: killer.room,
    victimPin: victim.pin,
    resolved: false
  });

  res.json({
    ok: true,
    message:
      'Your kill attempt has been recorded. Only the GM knows who you tried to cut down.',
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
