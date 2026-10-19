// ===== plain-english.js =====
// What to say to each character when they wake, in plain English, plus what
// kind of answer they get. Characters that aren't listed here (homebrew,
// Experimental, etc.) still work: the card shows their official ability text
// and offers every type of answer.
//
// An entry is either one prompt (used every night) or { first: {...}, other: {...} }.
//
// Prompt fields
//   say          Big text you show or read to the player.
//   st           Small note for you only.
//   choose       How many players they point at.          chooseMax: "up to N" instead.
//   self         true = they may choose themselves (default: not offered as a warning only).
//   dead         true = they may choose dead players.
//   token        Reminder put on the chosen player(s), e.g. "Poisoned".
//   clears       "dusk" or "dawn" = that reminder comes off by itself then.
//   kills        true = after they choose, you confirm who dies.
//   show         Answer you give back: "number" | "yesno" | "character" | "characters" | "evilteam" | "grimoire"
//   showCount    For "characters": how many to show (default 3).
//   point        How many players YOU point at when giving info.
//   zero         true = offers "none in play" (Librarian).
//   guess        true = they name a character.
//   once         true = once per game; offers "mark ability used".
//   when         Only wakes if: "diedTonight" | "executedToday" | "demonDied" | "outsiderDiedToday"
//                | "noDeathToday" | "diedRecently" | "sevenPlus"
//   hint         Helper that works out the by-the-book answer (see engine.js HINTS).
//   storyteller  true = nobody wakes; this is a job for you.

export const SPECIAL_STEPS = {
  dusk: {
    name: "Dusk",
    say: "Everyone, close your eyes.",
    st: "Night begins. Reminders that last 'until dusk' have been taken off.",
    storyteller: true,
  },
  minioninfo: {
    name: "Minion info",
    say: "You are the Minions. This player is your Demon. These are your fellow Minions.",
    st: "Wake all Minions together. Point to the Demon, then to each other.",
    show: "evilteam",
    when: "sevenPlus",
  },
  demoninfo: {
    name: "Demon info",
    say: "You are the Demon. These players are your Minions. These 3 characters are not in play.",
    st: "Wake the Demon. Point to the Minions, then show the 3 bluffs.",
    show: "evilteam",
    bluffs: true,
    when: "sevenPlus",
  },
  dawn: {
    name: "Dawn",
    say: "Everyone, open your eyes.",
    st: "Press 'Start the day' when you're ready to announce who died.",
    storyteller: true,
  },
};

export const PROMPTS = {
  // ---------------------------------------------------------------- Trouble Brewing
  poisoner: { say: "Choose a player to poison.", choose: 1, self: true, token: "Poisoned", clears: "dusk",
    st: "They stay poisoned tonight and all of tomorrow." },
  washerwoman: { say: "One of these two players is this Townsfolk.", show: "character", point: 2, hint: "inPlay:townsfolk" },
  librarian: { say: "One of these two players is this Outsider.", show: "character", point: 2, zero: true, hint: "inPlay:outsider",
    st: "If no Outsiders are in play, show the zero option instead." },
  investigator: { say: "One of these two players is this Minion.", show: "character", point: 2, hint: "inPlay:minion" },
  chef: { say: "This is how many pairs of evil players are sitting next to each other.", show: "number", hint: "chef" },
  empath: { say: "This is how many of your two living neighbours are evil.", show: "number", hint: "empath" },
  fortuneteller: { say: "Point at two players. I'll nod if one of them is the Demon.", choose: 2, self: true, show: "yesno", hint: "fortuneteller",
    st: "Remember the Red Herring: one good player who reads as the Demon to them." },
  butler: { say: "Choose your Master. Tomorrow, you can only vote if your Master votes too.", choose: 1, token: "Master", clears: "dusk" },
  spy: { say: "Here is the Grimoire. Look for as long as you need.", show: "grimoire" },
  monk: { say: "Choose a player (not yourself) to protect from the Demon tonight.", choose: 1, token: "Safe", clears: "dawn" },
  scarletwoman: { say: "The Demon has died. You are now the Demon.", show: "character", when: "demonDied",
    st: "Only if the Demon died today with 5 or more players alive. Change their character on the player sheet." },
  imp: { say: "Choose a player to kill.", choose: 1, self: true, kills: true,
    st: "If the Imp chooses themselves, they die and a living Minion becomes the Imp. Change that Minion's character, then wake them." },
  ravenkeeper: { say: "You died tonight. Point at a player to learn their character.", choose: 1, self: true, dead: true,
    show: "character", when: "diedTonight", hint: "targetCharacter" },
  undertaker: { say: "This is the character that was executed today.", show: "character", when: "executedToday", hint: "executed" },
  thief: { say: "Choose a player (not yourself). Their vote counts against the total tomorrow.", choose: 1, token: "Negative Vote", clears: "dusk" },
  bureaucrat: { say: "Choose a player (not yourself). Their vote counts as 3 votes tomorrow.", choose: 1, token: "3 Votes", clears: "dusk" },

  // ---------------------------------------------------------------- Bad Moon Rising
  grandmother: {
    first: { say: "This good player is your grandchild, and this is their character. If the Demon kills them, you die too.",
      show: "character", point: 1, hint: "inPlay:good" },
    other: { storyteller: true, say: "If the Demon killed the grandchild tonight, the Grandmother dies too.",
      st: "Use 'Someone died' if that happened." },
  },
  sailor: { say: "Choose a living player. Either you or they are drunk until dusk.", choose: 1,
    st: "You decide which of the two is drunk. The Sailor can't die." },
  chambermaid: { say: "Choose two living players (not yourself). This is how many of them woke tonight because of their own ability.",
    choose: 2, show: "number" },
  exorcist: { say: "Choose a player (different to last night). If they are the Demon, they learn who you are and don't wake tonight.",
    choose: 1, token: "Chosen", clears: "dusk" },
  innkeeper: { say: "Choose two players. They can't die tonight, but one of them is drunk until dusk.", choose: 2, self: true,
    token: "Safe", clears: "dawn", st: "Mark one of them Drunk on their player sheet." },
  gambler: { say: "Choose a player and guess their character. If you're wrong, you die.", choose: 1, guess: true, hint: "gamble" },
  gossip: { storyteller: true, say: "If the Gossip's public statement today was true, a player dies now.",
    st: "Use 'Someone died' if it was true." },
  courtier: { say: "Once per game, you may choose a character. If they're in play, they are drunk for 3 nights and 3 days.",
    guess: true, once: true },
  professor: { say: "Once per game, you may choose a dead player. If they are a Townsfolk, they come back to life.",
    choose: 1, dead: true, once: true },
  tinker: { storyteller: true, say: "The Tinker might die tonight. It's your choice.", st: "Use 'Someone died' if you kill them." },
  moonchild: { storyteller: true, say: "If the Moonchild chose a good player today, that player dies now.",
    st: "Use 'Someone died' if needed." },
  godfather: {
    first: { say: "These are the Outsiders in play.", show: "characters", showCount: 3, hint: "inPlay:outsider" },
    other: { say: "An Outsider died today. Choose a player: they die.", choose: 1, kills: true, when: "outsiderDiedToday" },
  },
  devilsadvocate: { say: "Choose a living player (different to last night). If they are executed tomorrow, they don't die.",
    choose: 1, self: true, token: "Survives Execution", clears: "dusk" },
  assassin: { say: "Once per game, you may choose a player. They die, even if something would normally stop it.",
    choose: 1, self: true, kills: true, once: true },
  mastermind: { storyteller: true, say: "If the Demon died by execution, play continues for one more day.",
    st: "Nobody wakes for this." },
  zombuul: { say: "Nobody died today. Choose a player to kill.", choose: 1, kills: true, when: "noDeathToday",
    st: "The first time the Zombuul dies, they stay alive but look dead." },
  pukka: {
    first: { say: "Choose a player to poison.", choose: 1, self: true, token: "Poisoned" },
    other: { say: "Choose a player to poison. The player you poisoned before now dies.", choose: 1, self: true, token: "Poisoned",
      hint: "lastChoice", st: "The previously poisoned player dies now and is healthy again. Remove their Poisoned reminder." },
  },
  shabaloth: { say: "Choose two players to kill.", choose: 2, self: true, kills: true,
    st: "A dead player they chose last night might come back to life (your choice)." },
  po: { say: "You may choose a player to kill. If you choose no one, you choose three players next time.",
    chooseMax: 3, self: true, kills: true },
  lunatic: {
    first: { say: "You are the Demon. These players are your Minions. These 3 characters are not in play.", show: "evilteam", bluffs: true,
      st: "Point to any players as 'Minions'. Then wake the real Demon and tell them who the Lunatic is." },
    other: { say: "Choose a player to kill.", choose: 1, self: true,
      st: "This kill isn't real. Tell the real Demon who the Lunatic chose." },
  },
  apprentice: { say: "You are the Apprentice. You have this character's ability.", show: "character" },

  // ---------------------------------------------------------------- Sects & Violets
  clockmaker: { say: "This is how many steps it is from the Demon to their nearest Minion.", show: "number", hint: "clockmaker" },
  dreamer: { say: "Choose a player (not yourself). One of these two characters is theirs.", choose: 1, show: "characters", showCount: 2,
    hint: "targetCharacter" },
  snakecharmer: { say: "Choose a living player. If they are the Demon, you swap characters and teams.", choose: 1, hint: "isDemon",
    st: "If they chose the Demon: swap their characters and alignments, then the new Demon is poisoned." },
  mathematician: { say: "This is how many players' abilities didn't work properly since dawn because of another character.",
    show: "number" },
  flowergirl: { say: "I'll nod if the Demon voted today.", show: "yesno" },
  towncrier: { say: "I'll nod if a Minion nominated today.", show: "yesno" },
  oracle: { say: "This is how many dead players are evil.", show: "number", hint: "oracle" },
  seamstress: { say: "Once per game, you may choose two players (not yourself). I'll nod if they're on the same team.",
    choose: 2, show: "yesno", once: true, hint: "sameTeam" },
  philosopher: { say: "Once per game, you may choose a good character. You gain that ability.", guess: true, once: true,
    st: "If that character is in play, that player is drunk." },
  juggler: { say: "This is how many of your guesses today were correct.", show: "number" },
  sage: { say: "The Demon killed you. One of these two players is the Demon.", point: 2, when: "diedTonight", hint: "demonPlayer" },
  sweetheart: { storyteller: true, say: "The Sweetheart died. One player is now drunk for the rest of the game.", when: "diedRecently",
    st: "Pick a player and add a Drunk reminder on their player sheet." },
  barber: { say: "The Barber died. Demon: you may choose two players (not another Demon) to swap characters.",
    choose: 2, when: "diedRecently", st: "Wake the Demon for this. Wake each swapped player and show them their new character." },
  eviltwin: { say: "This player is your twin, and this is their character.", show: "character", point: 1,
    st: "Wake both twins. Let them see each other. Show each the other's character." },
  witch: { say: "Choose a player to curse. If they nominate tomorrow, they die.", choose: 1, self: true, token: "Cursed", clears: "dusk" },
  cerenovus: { say: "Choose a player and a good character. Tomorrow they must act 'mad' that they are this character, or they might be executed.",
    choose: 1, self: true, guess: true, token: "Mad", clears: "dusk",
    st: "Then wake the target and show them the Cerenovus and the chosen character." },
  pithag: { say: "Choose a player and a character. If that character isn't in play, the player becomes it.",
    choose: 1, self: true, guess: true, st: "If a new Demon is made, deaths tonight are your choice." },
  fanggu: { say: "Choose a player to kill.", choose: 1, self: true, kills: true,
    st: "The first time they kill an Outsider, that Outsider becomes an evil Fang Gu and the old Fang Gu dies instead." },
  vigormortis: { say: "Choose a player to kill.", choose: 1, self: true, kills: true,
    st: "A Minion killed this way keeps their ability and poisons one Townsfolk neighbour." },
  nodashii: { say: "Choose a player to kill.", choose: 1, self: true, kills: true,
    st: "The No Dashii's two nearest Townsfolk neighbours are poisoned." },
  vortox: { say: "Choose a player to kill.", choose: 1, self: true, kills: true,
    st: "All Townsfolk info is false. If nobody is executed in a day, evil wins." },
  barista: { storyteller: true, say: "Choose a player: they're sober and get true info until dusk, or their ability works twice.",
    st: "Wake them, show the Barista token and a finger signal (1 or 2)." },
  harlot: { say: "Choose a living player. If they agree, you learn their character, but you might both die.", choose: 1,
    show: "character", hint: "targetCharacter" },
  bonecollector: { say: "Once per game, you may choose a dead player. They get their ability back until dusk.",
    choose: 1, dead: true, once: true },
};

/** The prompt for a character on a given night type ("first" | "other"). */
export function promptFor(id, nightType) {
  const p = PROMPTS[id];
  if (!p) return null;
  if (p.first || p.other) return p[nightType] || p.other || p.first;
  return p;
}
