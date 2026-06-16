// server/engine.js — authoritative Turf Wars game engine
// Runs on the server. Clients never see deck order or other players' hands.

const DECK_TABLE = {
  // SCALING
  "Rat":[10,13,15,17,20],
  "Health Inspection":[8,9,10,10,11],
  // FIXED at 8P quantities
  "Hot Ratato 1":[6,6,6,6,6],
  "Hot Ratato 2":[5,5,5,5,5],
  "Hot Ratato 3":[3,3,3,3,3],
  "Hot Ratato CCW 1":[1,1,1,1,1],
  "Hot Ratato CCW 2":[1,1,1,1,1],
  "Block":[8,8,8,8,8],
  "Food":[12,12,12,12,12],
  "Special Delivery":[4,4,4,4,4],
  "Infestation":[4,4,4,4,4],
  "Setup":[4,4,4,4,4],
  "Fortify":[5,5,5,5,5],
  "Exterminator":[3,3,3,3,3],
  "Mark":[2,2,2,2,2],
  "Mark 2.0":[1,1,1,1,1],
  "Ambush":[2,2,2,2,2],
  "Stakeout":[4,4,4,4,4],
  "Shakedown":[4,4,4,4,4],
  "Inheritance":[2,2,2,2,2],
  "Russian Roulette":[1,1,1,1,1],
  "Chilli":[4,4,4,4,4],
  "Rattatouli":[2,2,2,2,2],
  "Rat Dividend":[2,2,2,2,2],
  "Pregnant Rat":[1,1,1,1,1],
  "Redirect CW":[1,1,1,1,1],
  "Redirect CCW":[1,1,1,1,1],
  "Zone Swap":[1,1,1,1,1],
  "Scout":[3,3,3,3,3],
  "Rat Away":[4,4,4,4,4],
  "Rat Territorial":[4,4,4,4,4],
  "Cat":[6,6,6,6,6],
  "Kleptomaniac":[4,4,4,4,4],
  "Surge":[3,3,3,3,3],
  "Trash Diver":[1,1,1,1,1],
  "WD: Frenzy":[2,2,2,2,2],
  "WD: Blackout":[1,1,1,1,1],
  "WD: Rat Run CW":[1,1,1,1,1],
  "WD: Rat Run CCW":[1,1,1,1,1],
  "WD: Audit":[1,1,1,1,1],

  "WD: Health Inspection":[4,4,4,4,4],
};

let _id = 0;
const uid = () => ++_id;
const sh = a => { for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a; };
const isWD = n => n.startsWith("WD:");

function buildDeck(np) {
  const deck = [];
  const i = np - 4;
  for(const [name, qs] of Object.entries(DECK_TABLE))
    for(let k=0;k<qs[i];k++) deck.push({id:uid(), n:name});
  return deck;
}

function newGame(np, playerNames) {
  _id = 0;
  const full = buildDeck(np);
  const dealPool = full.filter(c => c.n !== "Rat" && !isWD(c.n));
  const excluded  = full.filter(c => c.n === "Rat" || isWD(c.n));
  sh(dealPool);
  const players = playerNames.map((name, i) => ({
    i, name, hp: 3, alive: true,
    hand: [], zone: [], fortify: false,
  }));
  for(const pl of players)
    for(let k=0;k<6;k++) pl.hand.push(dealPool.pop());
  return {
    np, players,
    deck: sh(dealPool.concat(excluded)),
    discard: [], pile: 10,
    cur: 0, round: 1,
    touchedZones: [],
    mark: null, mark2: null,
    bounties: [], fusions: [], chillis: [],
    log: [], over: false, winner: null,
    // pending reaction: {atk, awaitingFrom}
    pendingReaction: null,
    // pending modal for a human player
    pendingModal: null,
  };
}

// ── projection: what a given player is allowed to see ───────
function projectFor(G, pi) {
  return {
    np: G.np,
    players: G.players.map(p => ({
      i: p.i, name: p.name, hp: p.hp, alive: p.alive,
      handCount: p.hand.length,
      // own hand in full; others hidden
      hand: p.i === pi ? p.hand : null,
      zone: p.zone,
      fortify: p.fortify,
    })),
    pile: G.pile,
    deckCount: G.deck.length,
    discardCount: G.discard.length,
    cur: G.cur, round: G.round,
    touchedZones: G.touchedZones,
    mark: G.mark, mark2: G.mark2,
    bounties: G.bounties, fusions: G.fusions, chillis: G.chillis,
    log: G.log.slice(0, 60),
    over: G.over, winner: G.winner,
    pendingReaction: G.pendingReaction,
    pendingModal: G.pendingModal,
  };
}

module.exports = { newGame, projectFor, DECK_TABLE, isWD, sh, uid };
