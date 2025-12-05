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

    // players: { id, name, pin, role, alive, room, startRoom, clues: [], _hasMovedYet }
    players: [],

    // actions
    moves: [],     // { round, pin, from, to }
    votes: [],     // { round, voterPin, targetPin }
    kills: [],     // { round, room, victimPin, resolved }

    // Room Reveal (global) – active this round
    revealDots: false,
    revealDotsNextRound: false,

    // Killer’s Gaze – killer-only map vision
    killerVision: false,
    killerVisionNextRound: false,

    // Screams of the Stolen
    screamActive: false,
    screamNextRound: false,

    // The Shove in the Dark
    shoveNextRound: false,
    shoveTriggeredRound: null, // round when shove fired

    // Killer clue visibility (GM toggle)
    killerSeesClues: true,

    // Killer’s Advantage (extra movement / kill pattern)
    killerAdvantageEnabled: true,
    killerAdvantageFrequency: 3, // every 3rd round by default

    // Clue system
    // clues.perRoom[room] = [ text|null, text|null ]
    clues: null, // { sentence, perRoom: { room: [text|null, text|null] } }
    claimedClues: [],

    // Companion lock (hidden logic)
    companionLockEnabled: true,
    companionLockDurationRounds: 1, // victims locked for 1 round
    companionLastRound: {},         // pin -> Set of victim pins they shared with last round
    clueLockUntilRound: {},         // pin -> round number up to which clues are blocked

    // Ghost events
    ghostEventInterval: 5,          // every 5 rounds by default
    // ghostVotes: { round, pin, event }
    ghostVotes: [],

    // NEW: remember the last ghost-triggered event
    lastGhostEvent: null,
    
        // NEW: remember up to which round we have already resolved ghost votes
    lastGhostResolutionRound: 0,   // 0 = none resolved yet

         // The Dead Intervene – global kill lock
    deadInterveneActive: false,       // active THIS round
    deadInterveneNextRound: false,    // armed for NEXT round

    // Sanctuary – some rooms are safe from kills this round
    sanctuaryActive: false,
    sanctuaryNextRound: false,
    sanctuaryRooms: [],               // rooms safe THIS round

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

function getAlivePlayers() {
  return gameState.players.filter(p => p.alive);
}

function haveAllLivingPlayersMovedThisRound() {
  const alive = getAlivePlayers();
  if (alive.length === 0) return false;

  const movedPins = new Set(
    gameState.moves
      .filter(m => m.round === gameState.round)
      .map(m => String(m.pin))
  );
  return alive.every(p => movedPins.has(String(p.pin)));
}

function haveAllVictimsMovedThisRound() {
  const victims = gameState.players.filter(p => p.alive && p.role === 'Victim');
  if (victims.length === 0) return false;
  const movedPins = new Set(
    gameState.moves
      .filter(m => m.round === gameState.round)
      .map(m => String(m.pin))
  );
  return victims.every(p => movedPins.has(String(p.pin)));
}

function countMovesThisRound(pin) {
  return gameState.moves.filter(
    m => m.round === gameState.round && String(m.pin) === String(pin)
  ).length;
}

function hasAnyKillThisRound() {
  return gameState.kills.some(k => k.round === gameState.round);
}

function isKillerAdvantageRound() {
  const freq = gameState.killerAdvantageFrequency || 0;
  if (!gameState.killerAdvantageEnabled || freq <= 0) return false;
  return gameState.round % freq === 0;
}
/* ---------- VOTE HELPERS ---------- */

// Auto-execute majority vote at end of round.
function executeMajorityVote() {
  const votesThisRound = gameState.votes.filter(
    v => v.round === gameState.round
  );
  if (!votesThisRound.length) return null;

  const tally = {};
  votesThisRound.forEach(v => {
    const key = String(v.targetPin);
    tally[key] = (tally[key] || 0) + 1;
  });

  let max = 0;
  Object.values(tally).forEach(count => {
    if (count > max) max = count;
  });
  if (max === 0) return null;

  const topPins = Object.entries(tally)
    .filter(([, count]) => count === max)
    .map(([pin]) => pin);

  if (topPins.length !== 1) return null; // tie → no death

  const executedPin = topPins[0];
  const executedPlayer = findPlayerByPin(executedPin);
  if (!executedPlayer || !executedPlayer.alive) return null;

  executedPlayer.alive = false;
  returnCluesToRooms(executedPlayer);

  gameState.kills.push({
    round: gameState.round,
    room: executedPlayer.room,
    victimPin: executedPlayer.pin,
    resolved: true,
    reason: 'voteExecution'
  });

  return executedPlayer;
}

/* ---------- CLUE HELPERS ---------- */

// Put a dead player's clues back into the house
function returnCluesToRooms(player) {
  if (!player || !player.clues || !gameState.clues || !gameState.clues.perRoom) return;

  player.clues.forEach(c => {
    if (!c || !c.room || !c.text) return;
    const slots = gameState.clues.perRoom[c.room];
    if (!Array.isArray(slots)) return;

    const emptyIndex = slots.indexOf(null);
    if (emptyIndex !== -1) {
      slots[emptyIndex] = c.text;
    }
  });

  player.clues = [];
}

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

  let fragments = generateClueFragments(sentence);
  fragments = shuffleArray(fragments.slice());

  const perRoom = {};
  let idx = 0;

  ROOMS.forEach(room => {
    perRoom[room] = [];
    for (let i = 0; i < 2; i++) {
      if (idx < fragments.length) {
        perRoom[room].push(fragments[idx]);
        idx++;
      } else {
        perRoom[room].push(null);
      }
    }
  });

  // reset player clues
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

/**
 * Victims receive 1 clue PER ROOM only when:
 * - They are alive and a Victim.
 * - All living players have moved this round.
 * - They are completely alone (only living soul) in that room.
 * - They are not under a clue lock.
 * - The room still has an unclaimed clue.
 */
function maybeGiveClueOnMove(player, newRoom) {
  if (!player.alive) return null;
  if (player.role !== 'Victim') return null;
  if (!gameState.clues || !gameState.clues.perRoom) return null;

  // Clue lock from companion rule
  if (
    gameState.clueLockUntilRound &&
    gameState.clueLockUntilRound[player.pin] &&
    gameState.round <= gameState.clueLockUntilRound[player.pin]
  ) {
    return null;
  }

  // Only after ALL living players have moved this round
  if (!haveAllLivingPlayersMovedThisRound()) {
    return null;
  }

  // Must be alone in this room (only living soul)
  const livingHere = gameState.players.filter(
    p => p.alive && p.room === newRoom
  );
  if (livingHere.length !== 1) {
    return null;
  }

  const roomSlots = gameState.clues.perRoom[newRoom] || [];
  const roomClues = roomSlots.filter(Boolean);
  if (!roomClues.length) return null;

  // Only 1 clue per room per victim
  const already = (player.clues || []).filter(c => c.room === newRoom);
  if (already.length >= 1) return null;

  const chosen = roomClues[0];
  if (!chosen) return null;

  ensurePlayerClueArray(player);
  player.clues.push({ room: newRoom, text: chosen });

  const index = roomSlots.indexOf(chosen);
  if (index !== -1) {
    roomSlots[index] = null;
  }

  return chosen;
}

// Distribute clues at the END of the round, based on who is alone
// in which room AFTER everyone has moved.
function distributeCluesForRound() {
  if (!gameState.clues || !gameState.clues.perRoom) return;

  // Only give clues once all living players have moved this round
  if (!haveAllLivingPlayersMovedThisRound()) return;

  ROOMS.forEach(room => {
    // All living players in this room
    const livingHere = gameState.players.filter(
      p => p.alive && (p.room || START_ROOM) === room
    );

    // Must be exactly one living player in the room
    if (livingHere.length !== 1) return;

    const player = livingHere[0];

    // Only Victims get clues
    if (player.role !== 'Victim') return;

    // Check companion lock (no clues if they stayed with same victim 2 rounds)
    if (
      gameState.clueLockUntilRound &&
      gameState.clueLockUntilRound[player.pin] &&
      gameState.round <= gameState.clueLockUntilRound[player.pin]
    ) {
      return;
    }

    // Room must still have a fragment
    const roomSlots = gameState.clues.perRoom[room] || [];
    const available = roomSlots.filter(Boolean);
    if (!available.length) return;

    // Victim only gets one clue per room
    const already = (player.clues || []).filter(c => c.room === room);
    if (already.length >= 1) return;

    const chosen = available[0];
    if (!chosen) return;

    ensurePlayerClueArray(player);
    player.clues.push({ room, text: chosen });

    const idx = roomSlots.indexOf(chosen);
    if (idx !== -1) {
      roomSlots[idx] = null;
    }
  });
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
    const targetPool = possibleRooms.length ? possibleRooms : ROOMS;
    const nextRoom = targetPool[Math.floor(Math.random() * targetPool.length)];

    p.room = nextRoom;
    if (!p.startRoom) {
      p.startRoom = START_ROOM;
    }
  });

  return pool.length;
}

/* ---------- COMPANION LOCK (HIDDEN LOGIC) ---------- */

/**
 * Called when advancing from current round N to N+1.
 * If two Victims share a room in round N AND also did in round N-1,
 * both are locked from getting clues for the next round.
 */
function handleCompanionLockOnNextRound() {
  if (!gameState.companionLockEnabled) return;

  const currentRooms = {};
  // group alive victims by room
  gameState.players.forEach(p => {
    if (!p.alive || p.role !== 'Victim') return;
    const r = p.room || START_ROOM;
    if (!currentRooms[r]) currentRooms[r] = [];
    currentRooms[r].push(p);
  });

  // pin -> Set of victim pins they shared a room with this round
  const currentMap = {};

  Object.values(currentRooms).forEach(arr => {
    if (arr.length < 2) {
      arr.forEach(p => {
        if (!currentMap[p.pin]) currentMap[p.pin] = new Set();
      });
      return;
    }
    arr.forEach(p => {
      const set = currentMap[p.pin] || new Set();
      arr.forEach(other => {
        if (other.pin !== p.pin) set.add(other.pin);
      });
      currentMap[p.pin] = set;
    });
  });

  const lastMap = gameState.companionLastRound || {};
  const lockedPins = new Set();

  Object.entries(currentMap).forEach(([pin, currSet]) => {

  // ❗ If player is *already punished this round*, DO NOT check them again.
  if (
    gameState.clueLockUntilRound &&
    gameState.clueLockUntilRound[pin] &&
    gameState.round <= gameState.clueLockUntilRound[pin]
  ) {
    return;  // Skip — prevents infinite punishment chain
  }

  const lastSet = lastMap[pin];
  if (!lastSet) return;

  currSet.forEach(otherPin => {
    if (lastSet.has(otherPin)) {
      lockedPins.add(pin);
      lockedPins.add(otherPin);
    }
  });

});


  if (!gameState.clueLockUntilRound) {
    gameState.clueLockUntilRound = {};
  }

  if (lockedPins.size > 0) {
    const duration = gameState.companionLockDurationRounds || 1;
    const lockUntilRound = gameState.round + duration;
    lockedPins.forEach(pin => {
      const prevLock = gameState.clueLockUntilRound[pin] || 0;
      const newLock = Math.max(prevLock, lockUntilRound);
      gameState.clueLockUntilRound[pin] = newLock;
    });
  }

  // store this round's roommate data as "last round" for the next call
  const nextLast = {};
  Object.entries(currentMap).forEach(([pin, set]) => {
    nextLast[pin] = new Set(set);
  });
  gameState.companionLastRound = nextLast;
}

/* ---------- GHOST EVENT HELPERS ---------- */

function getGhostEventLabel(key) {
  switch (key) {
    case 'shove':
      return 'The Shove in the Dark';
    case 'scream':
      return 'Screams';
    case 'reveal':
      return 'Room Reveal';
    case 'gaze':
      return 'Killer’s Gaze';
    case 'intervene':
      return 'The Dead Intervene';
    case 'sanctuary':
      return 'Sanctuary';
    default:
      return key || '—';
  }
}

// Majority ghost event from a range of rounds [startRound, endRound]
function getGhostMajorityBetweenRounds(startRound, endRound, { ignoreLastEvent = true } = {}) {
  const allowed = new Set(['shove', 'scream', 'reveal', 'gaze', 'intervene', 'sanctuary']);

  const votes = (gameState.ghostVotes || []).filter(
    v =>
      v.round >= startRound &&
      v.round <= endRound &&
      allowed.has(v.event)
  );

  if (!votes.length) return null;

  const tallies = {};
  votes.forEach(v => {
    if (ignoreLastEvent && v.event === gameState.lastGhostEvent) return;
    tallies[v.event] = (tallies[v.event] || 0) + 1;
  });

  const entries = Object.entries(tallies);
  if (!entries.length) return null;

  let [bestKey, bestCount] = entries[0];
  for (let i = 1; i < entries.length; i++) {
    const [k, c] = entries[i];
    if (c > bestCount) {
      bestKey = k;
      bestCount = c;
    }
  }

  return {
    event: bestKey,
    label: getGhostEventLabel(bestKey),
    count: bestCount
  };
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

// Next round – applies companion lock, next-round effects, shove, and ghost events.
app.post('/api/gm/nextRound', (req, res) => {
  const prevRound = gameState.round;
  // 0) Majority vote auto-kill
  const executed = executeMajorityVote();

  // 2) Then handle the companion "same victim 2 rounds" lock for NEXT round
  handleCompanionLockOnNextRound();

  // 3) Advance round
  gameState.round += 1;


  // Apply Room Reveal for THIS round
  gameState.revealDots = !!gameState.revealDotsNextRound;
  gameState.revealDotsNextRound = false;

  // Apply Killer's Gaze for THIS round
  gameState.killerVision = !!gameState.killerVisionNextRound;
  gameState.killerVisionNextRound = false;

  // Apply Screams for THIS round
  gameState.screamActive = !!gameState.screamNextRound;
  gameState.screamNextRound = false;

      // The Dead Intervene – apply for THIS round
  gameState.deadInterveneActive = !!gameState.deadInterveneNextRound;
  gameState.deadInterveneNextRound = false;

  // Sanctuary – pick random rooms for THIS round
  if (gameState.sanctuaryNextRound) {
    gameState.sanctuaryActive = true;

    const roomsCopy = ROOMS.slice();
    // shuffle
    for (let i = roomsCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roomsCopy[i], roomsCopy[j]] = [roomsCopy[j], roomsCopy[i]];
    }
    // default: 2 rooms
    gameState.sanctuaryRooms = roomsCopy.slice(0, Math.min(2, roomsCopy.length));
  } else {
    gameState.sanctuaryActive = false;
    gameState.sanctuaryRooms = [];
  }
  gameState.sanctuaryNextRound = false;



  // Shove in the Dark: scatter players at start of THIS new round
  if (gameState.shoveNextRound) {
    scatterPlayersNoSameRoom(false);
    gameState.shoveTriggeredRound = gameState.round;
  } else {
    gameState.shoveTriggeredRound = null;
  }
  gameState.shoveNextRound = false;

      // 🔴 Ghost event auto-trigger using ACCUMULATED votes
  const ghostInterval = gameState.ghostEventInterval || 0;
  const newRound = gameState.round;  // we already incremented above

  if (ghostInterval > 0 && newRound % ghostInterval === 0) {
    // We accumulate votes from rounds (lastGhostResolutionRound + 1) .. prevRound
    const startRound = (gameState.lastGhostResolutionRound || 0) + 1;
    const endRound = prevRound;  // the round we just finished

    if (startRound <= endRound) {
      const majority = getGhostMajorityBetweenRounds(startRound, endRound, {
        ignoreLastEvent: true
      });

      if (majority) {
        const bestKey = majority.event;

        // Apply the chosen event IMMEDIATELY for this newRound
        switch (bestKey) {
          case 'reveal':
            gameState.revealDots = true;
            break;
          case 'scream':
            gameState.screamActive = true;
            break;
          case 'gaze':
            gameState.killerVision = true;
            break;
          case 'shove':
            scatterPlayersNoSameRoom(false);
            gameState.shoveTriggeredRound = newRound;
            break;
          case 'intervene':
            gameState.deadInterveneActive = true;
            break;
          case 'sanctuary': {
            gameState.sanctuaryActive = true;
            const roomsCopy = ROOMS.slice();
            for (let i = roomsCopy.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [roomsCopy[i], roomsCopy[j]] = [roomsCopy[j], roomsCopy[i]];
            }
            gameState.sanctuaryRooms = roomsCopy.slice(0, Math.min(2, roomsCopy.length));
            break;
          }
          default:
            break;
        }

        // Remember which event fired, and up to which round votes are "used"
        gameState.lastGhostEvent = bestKey;
        gameState.lastGhostResolutionRound = endRound;

        // Optional: prune old votes so the array doesn't grow forever
        gameState.ghostVotes = (gameState.ghostVotes || []).filter(
          v => v.round > endRound
        );
      }
    }
  }

  res.json({ ok: true, round: gameState.round });
});


// New game
app.post('/api/gm/newGame', (req, res) => {
  gameState = createFreshGame();
  res.json({ ok: true, round: gameState.round });
});

// Room Reveal toggle – arm effect for NEXT round
app.post('/api/gm/toggleRevealDots', (req, res) => {
  gameState.revealDotsNextRound = !gameState.revealDotsNextRound;
  res.json({ ok: true, revealDotsNextRound: gameState.revealDotsNextRound });
});

// Killer's Gaze – arm for NEXT round
app.post('/api/gm/toggleKillerGaze', (req, res) => {
  gameState.killerVisionNextRound = !gameState.killerVisionNextRound;
  res.json({ ok: true, killerVisionNextRound: gameState.killerVisionNextRound });
});

// Screams of the Stolen – arm for NEXT round
app.post('/api/gm/toggleScream', (req, res) => {
  gameState.screamNextRound = !gameState.screamNextRound;
  res.json({ ok: true, screamNextRound: gameState.screamNextRound });
});

// The Dead Intervene – arm for NEXT round
app.post('/api/gm/toggleDeadIntervene', (req, res) => {
  gameState.deadInterveneNextRound = !gameState.deadInterveneNextRound;
  res.json({
    ok: true,
    deadInterveneNextRound: gameState.deadInterveneNextRound
  });
});

// Sanctuary – arm for NEXT round (2 random rooms safe from kills)
app.post('/api/gm/toggleSanctuary', (req, res) => {
  gameState.sanctuaryNextRound = !gameState.sanctuaryNextRound;
  res.json({
    ok: true,
    sanctuaryNextRound: gameState.sanctuaryNextRound
  });
});


// The Shove in the Dark – arm scatter for NEXT round
app.post('/api/gm/toggleShove', (req, res) => {
  gameState.shoveNextRound = !gameState.shoveNextRound;
  res.json({ ok: true, shoveNextRound: gameState.shoveNextRound });
});

// Toggle whether the Killer can see room clues
app.post('/api/gm/toggleKillerClues', (req, res) => {
  gameState.killerSeesClues = !gameState.killerSeesClues;
  res.json({ ok: true, killerSeesClues: gameState.killerSeesClues });
});

// OLD killer advantage route (kept for safety; not used by new UI)
app.post('/api/gm/updateKillerAdvantage', (req, res) => {
  const { enabled, frequency } = req.body || {};

  if (enabled !== undefined) {
    gameState.killerAdvantageEnabled = !!enabled;
  }

  if (frequency !== undefined) {
    const n = parseInt(frequency, 10);
    if (!Number.isNaN(n) && n > 0) {
      gameState.killerAdvantageFrequency = n;
    }
  }

  res.json({
    ok: true,
    killerAdvantageEnabled: gameState.killerAdvantageEnabled,
    killerAdvantageFrequency: gameState.killerAdvantageFrequency
  });
});

// Killer’s Advantage controls (toggle + interval)
// Front-end calls this as /api/gm/setKillersAdvantage
app.post('/api/gm/setKillersAdvantage', (req, res) => {
  const { interval, toggle } = req.body || {};

  let n = parseInt(interval, 10);

  // If invalid, keep whatever we already had (default is 3 on new game)
  if (Number.isNaN(n) || n <= 0) {
    n = gameState.killerAdvantageFrequency || 3;
  }

  // Persist the frequency in gameState so GM summary will see it
  gameState.killerAdvantageFrequency = n;

  // toggle = true means flip enabled/disabled
  if (toggle) {
    gameState.killerAdvantageEnabled = !gameState.killerAdvantageEnabled;
  }

  res.json({
    ok: true,
    enabled: gameState.killerAdvantageEnabled,
    interval: gameState.killerAdvantageFrequency
  });
});



// Immediate scatter button (GM convenience)
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

// GM: set ghost event interval (matches HTML)
app.post('/api/gm/setGhostEventInterval', (req, res) => {
  const { interval } = req.body || {};
  let n = parseInt(interval, 10);
  if (Number.isNaN(n) || n <= 0) {
    n = 5;
  }
  gameState.ghostEventInterval = n;
  res.json({ ok: true, interval: gameState.ghostEventInterval });
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

    const killerAdvantageRound = isKillerAdvantageRound();

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

  // 🔴 Ghost vote summary (per dead player, this round)
  const deadPlayers = gameState.players.filter(p => !p.alive);
  const ghostVotesThisRound = (gameState.ghostVotes || []).filter(
    v => v.round === gameState.round
  );

  const ghostVotesDisplay = deadPlayers.map(p => {
    const v = ghostVotesThisRound.find(
      gv => String(gv.pin) === String(p.pin)
    );
    const eventKey = v ? v.event : null;
    return {
      name: p.name,
      pin: p.pin,
      event: eventKey,
      eventLabel: eventKey ? getGhostEventLabel(eventKey) : null
    };
  });

  // Majority event (this round’s ghost votes)
  let ghostMajority = null;
  if (ghostVotesThisRound.length) {
      const allowed = new Set(['shove', 'scream', 'reveal', 'gaze', 'intervene', 'sanctuary']);
    const tallyEv = {};
    ghostVotesThisRound.forEach(v => {
      if (!allowed.has(v.event)) return;
      tallyEv[v.event] = (tallyEv[v.event] || 0) + 1;
    });
    const entriesEv = Object.entries(tallyEv);
    if (entriesEv.length) {
      let [bestKey, bestCount] = entriesEv[0];
      for (let i = 1; i < entriesEv.length; i++) {
        const [k, c] = entriesEv[i];
        if (c > bestCount) {
          bestKey = k;
          bestCount = c;
        }
      }
      ghostMajority = {
        event: bestKey,
        label: getGhostEventLabel(bestKey),
        count: bestCount
      };
    }
  }

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
    killAttempts,

    // ghost tracking for GM UI
    ghostVotes: ghostVotesDisplay,
    ghostMajority,
    ghostEventInterval: gameState.ghostEventInterval,

    // killer advantage config for GM UI
    killersAdvantage: {
      enabled: gameState.killerAdvantageEnabled,
      interval: gameState.killerAdvantageFrequency
    },
    killerAdvantageRound
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

  // Victim move tracking (for banners + kill logic)
    const aliveVictims = gameState.players.filter(
    p => p.alive && p.role === 'Victim'
  );
  const movedPins = new Set(
    gameState.moves
      .filter(m => m.round === gameState.round)
      .map(m => String(m.pin))
  );
  const allVictimsMoved =
    aliveVictims.length > 0 &&
    aliveVictims.every(p => movedPins.has(String(p.pin)));

  // NEW: look at the killer's actual moves (distinguish real vs stay)
  const killerMovesThisRoundArr = gameState.moves.filter(
    m => m.round === gameState.round && String(m.pin) === String(player.pin)
  );
  const killerAdvRound = isKillerAdvantageRound();
  const hasRealMoveThisRound = killerMovesThisRoundArr.some(m => m.from !== m.to);


  const roster = gameState.players.map(p => ({
    id: p.id,
    name: p.name,
    pin: p.pin,
    alive: p.alive
  }));

  // canKill only if:
  // - player is Killer and alive
  // - all victims have moved
  // - killer has moved at least once this round
  // - there is exactly one other living player in the room
  // - no kill has been used this round yet
    let canKill = false;
  let killTarget = null;

  if (
    player.role === 'Killer' &&
    player.alive &&
    allVictimsMoved &&
    !hasAnyKillThisRound() &&
    (killerAdvRound || hasRealMoveThisRound)
  ) {
    const others = livingHere.filter(p => p.pin !== player.pin);
    if (others.length === 1) {
      canKill = true;
      killTarget = {
        pin: others[0].pin,
        name: others[0].name
      };
    }
  }


  // Clues visible in this room
  let roomCluesForViewer = [];
  if (gameState.clues && gameState.clues.perRoom) {
    const roomSlots = gameState.clues.perRoom[room] || [];

    if (player.role === 'Killer' && gameState.killerSeesClues) {
      roomCluesForViewer = roomSlots.filter(Boolean);
    } else if (player.role === 'Killer') {
      roomCluesForViewer = [];
    } else {
      // Victims only see their OWN collected clues for this room
      roomCluesForViewer = (player.clues || [])
        .filter(c => c.room === room)
        .map(c => c.text);
    }
  }

    const effects = {
    roomReveal: !!gameState.revealDots,
    killerGaze: !!gameState.killerVision,
    scream: !!gameState.screamActive,
    shove: !!(gameState.shoveTriggeredRound === gameState.round),
    deadIntervene: !!gameState.deadInterveneActive,
    sanctuary: !!gameState.sanctuaryActive
  };


  const allPlayersMoved = haveAllLivingPlayersMovedThisRound();

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
    effects,
    killerAdvantageRound: killerAdvRound,
    allPlayersMoved,
    allVictimsMoved,
    sanctuaryRooms: gameState.sanctuaryActive ? (gameState.sanctuaryRooms || []) : [],
    lastGhostEvent: gameState.lastGhostEvent || null
  });
});



// Move
app.post('/api/move', (req, res) => {
  const { pin, room, stay } = req.body || {};
  const player = findPlayerByPin(pin);
  if (!player) {
    return res.status(400).json({ ok: false, error: 'Player not found.' });
  }

  if (!player.alive) {
    return res.status(400).json({ ok: false, error: 'Dead players cannot move.' });
  }

  const currentRoom = player.room || START_ROOM;
  const isStayAction = !!stay && player.role === 'Killer';

  let dest = String(room || '').trim();

  // 🔴 STAY LOGIC with anti-camping rule
  if (isStayAction) {
    const lastRound = gameState.round - 1;

    // Did the Killer kill in THIS room last round?
    const killedHereLastRound = gameState.kills.some(k =>
      k.round === lastRound &&
      k.room === currentRoom &&
      k.reason !== 'voteExecution' // ignore vote executions
    );

    if (killedHereLastRound) {
      return res.status(400).json({
        ok: false,
        error: 'The floor is still warm from your last kill. You must leave this room first.'
      });
    }

    // Stay action = “move” to the same room
    dest = currentRoom;
  }

  if (!isStayAction) {
    if (!ROOMS.includes(dest)) {
      return res.status(400).json({ ok: false, error: 'Invalid room.' });
    }

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
  }

  // Move limits:
  // - Everyone gets 1 move on normal rounds.
  // - Killer gets up to 2 moves on Killer Advantage rounds.
  const movesThisRound = countMovesThisRound(pin);
  let maxMoves = 1;

  if (player.role === 'Killer' && player.alive && isKillerAdvantageRound()) {
    maxMoves = 2;
  }

  if (movesThisRound >= maxMoves) {
    return res
      .status(400)
      .json({ ok: false, error: 'You have used all of your moves this round.' });
  }

  // ⭐ BEFORE this move: did all living players already move?
  const allMovedBefore = haveAllLivingPlayersMovedThisRound();

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
  if (!player._hasMovedYet) {
    player._hasMovedYet = true;
  }

  // ⭐ AFTER this move: check again
  const allMovedAfter = haveAllLivingPlayersMovedThisRound();

  // ⭐ First moment everyone has moved → distribute clues to ALL qualifying Victims
  if (!allMovedBefore && allMovedAfter) {
    distributeCluesForRound();
  }

  res.json({
    ok: true,
    message: `You slip into ${dest}.`,
    room: dest
  });
});


// Vote (living players only)
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

// Ghost vote (dead players choose an event each round)
app.post('/api/ghostVote', (req, res) => {
  const { pin, event } = req.body || {};
  const player = findPlayerByPin(pin);
  if (!player) {
    return res.status(400).json({ ok: false, error: 'Player not found.' });
  }

  if (player.alive) {
    return res.status(400).json({ ok: false, error: 'Only dead players may cast ghost votes.' });
  }

    const allowed = new Set(['shove', 'scream', 'reveal', 'gaze', 'intervene', 'sanctuary']);
  if (!allowed.has(event)) {
    return res.status(400).json({ ok: false, error: 'Invalid ghost event choice.' });
  }

  if (!Array.isArray(gameState.ghostVotes)) {
    gameState.ghostVotes = [];
  }

  // One vote per dead player per round; overwrite if they change their mind
  const existingIndex = gameState.ghostVotes.findIndex(
    v => v.round === gameState.round && String(v.pin) === String(player.pin)
  );
  if (existingIndex !== -1) {
    gameState.ghostVotes[existingIndex].event = event;
  } else {
    gameState.ghostVotes.push({
      round: gameState.round,
      pin: player.pin,
      event
    });
  }

  res.json({
    ok: true,
    message: `Your whisper clings to the walls: ${getGhostEventLabel(event)}.`
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

    // The Dead Intervene – no one can be killed this round
  if (gameState.deadInterveneActive) {
    return res.status(400).json({
      ok: false,
      error: 'Cold hands grip your wrist. The dead intervene; you cannot kill this round.'
    });
  }

  // Only one kill in a round total
  if (hasAnyKillThisRound()) {
    return res.status(400).json({
      ok: false,
      error: 'You have already taken a life this round.'
    });
  }

  // Kill can only happen after all Victims have moved
  if (!haveAllVictimsMovedThisRound()) {
    return res.status(400).json({
      ok: false,
      error: 'You cannot kill until every living victim has moved this round.'
    });
  }

    // --- NEW: check killer's moves this round (real vs stay) and advantage ---
  const killerMovesThisRound = gameState.moves.filter(
    m => m.round === gameState.round && String(m.pin) === String(killer.pin)
  );

  const advantageRound = isKillerAdvantageRound();

  // A "real" move is changing rooms (from !== to). A Stay action should NOT
  // satisfy the move requirement on normal rounds.
  const hasRealMoveThisRound = killerMovesThisRound.some(m => m.from !== m.to);

  // On normal rounds: must have at least one real move before killing.
  // On Killer Advantage rounds: kill-first is allowed (kill, move, move).
  if (!advantageRound && !hasRealMoveThisRound) {
    return res.status(400).json({
      ok: false,
      error: 'You must move to a different room at least once before you kill.'
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

    // Sanctuary – victims in sanctuary rooms cannot be killed this round
  if (
    gameState.sanctuaryActive &&
    Array.isArray(gameState.sanctuaryRooms) &&
    gameState.sanctuaryRooms.includes(killer.room)
  ) {
    return res.status(400).json({
      ok: false,
      error: 'The room refuses your violence. This is Sanctuary; you cannot kill here this round.'
    });
  }

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
