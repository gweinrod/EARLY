import { GROUPS } from '../data';

/** Common English words used to reject generated nonsense strings. */
const COMMON_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'of', 'is', 'it', 'he', 'she',
  'cat', 'dog', 'bat', 'rat', 'hat', 'mat', 'sat', 'pat', 'fat', 'bet', 'let', 'met', 'net',
  'pet', 'set', 'wet', 'yet', 'get', 'bit', 'fit', 'hit', 'kit', 'lit', 'pit', 'sit', 'wit',
  'bot', 'cot', 'dot', 'got', 'hot', 'jot', 'lot', 'not', 'pot', 'rot', 'tot', 'cut', 'gut',
  'hut', 'nut', 'put', 'rut', 'but', 'cup', 'pup', 'sup', 'up', 'bad', 'dad', 'had', 'lad',
  'mad', 'pad', 'sad', 'tad', 'bed', 'fed', 'led', 'red', 'wed', 'bid', 'did', 'hid', 'kid',
  'lid', 'mid', 'rid', 'big', 'dig', 'fig', 'gig', 'jig', 'pig', 'rig', 'wig', 'bag', 'gag',
  'hag', 'jag', 'lag', 'nag', 'rag', 'sag', 'tag', 'wag', 'zag', 'man', 'can', 'fan', 'pan',
  'ran', 'tan', 'van', 'ban', 'cap', 'gap', 'lap', 'map', 'nap', 'rap', 'tap', 'yap', 'zap',
  'arm', 'art', 'ask', 'ate', 'awe', 'axe', 'aye', 'bad', 'bag', 'ban', 'bar', 'bat', 'bay',
  'bed', 'bee', 'beg', 'bet', 'bid', 'big', 'bin', 'bit', 'bob', 'bog', 'bop', 'bow', 'box',
  'boy', 'bud', 'bug', 'bum', 'bun', 'bus', 'but', 'buy', 'bye', 'cab', 'cad', 'cam', 'can',
  'cap', 'car', 'cat', 'cob', 'cod', 'cog', 'cop', 'cot', 'cow', 'coy', 'cry', 'cub', 'cud',
  'cue', 'cup', 'cur', 'cut', 'dab', 'dad', 'dam', 'day', 'den', 'dew', 'did', 'die', 'dig',
  'dim', 'din', 'dip', 'dog', 'don', 'dot', 'dry', 'dub', 'dud', 'due', 'dug', 'dun', 'duo',
  'dye', 'ear', 'eat', 'ebb', 'eel', 'egg', 'ego', 'elf', 'elk', 'elm', 'emu', 'end', 'era',
  'eve', 'ewe', 'eye', 'fad', 'fan', 'far', 'fat', 'fax', 'fed', 'fee', 'fen', 'few', 'fib',
  'fig', 'fin', 'fir', 'fit', 'fix', 'flu', 'fly', 'fob', 'foe', 'fog', 'fop', 'for', 'fox',
  'foy', 'fro', 'fry', 'fub', 'fud', 'fug', 'fun', 'fur', 'gab', 'gad', 'gag', 'gal', 'gap',
  'gas', 'gay', 'gel', 'gem', 'get', 'gig', 'gin', 'git', 'gnu', 'gob', 'god', 'got', 'gum',
  'gun', 'gut', 'guy', 'gym', 'had', 'hag', 'ham', 'has', 'hat', 'haw', 'hay', 'hem', 'hen',
  'her', 'hew', 'hex', 'hey', 'hid', 'him', 'hip', 'his', 'hit', 'hob', 'hod', 'hoe', 'hog',
  'hop', 'hot', 'how', 'hub', 'hue', 'hug', 'hum', 'hut', 'ice', 'icy', 'ilk', 'ill', 'imp',
  'ink', 'inn', 'ion', 'ire', 'irk', 'ivy', 'jab', 'jag', 'jam', 'jar', 'jaw', 'jay', 'jet',
  'jig', 'job', 'jog', 'jot', 'joy', 'jug', 'jut', 'keg', 'ken', 'key', 'kid', 'kin', 'kit',
  'lab', 'lad', 'lag', 'lam', 'lap', 'law', 'lax', 'lay', 'lea', 'led', 'leg', 'let', 'lid',
  'lie', 'lip', 'lit', 'lob', 'log', 'lop', 'lot', 'low', 'lug', 'lum', 'lung', 'lure', 'lurk',
  'lush', 'lust', 'lye', 'mac', 'mad', 'man', 'map', 'mar', 'mat', 'maw', 'max', 'may', 'men',
  'met', 'mew', 'mid', 'mix', 'mob', 'mod', 'mop', 'mot', 'mow', 'mud', 'mug', 'mum', 'nab',
  'nag', 'nap', 'nay', 'net', 'new', 'nib', 'nil', 'nip', 'nit', 'nix', 'nob', 'nod', 'nor',
  'not', 'now', 'nub', 'nun', 'nut', 'oaf', 'oak', 'oar', 'oat', 'odd', 'ode', 'off', 'oft',
  'oil', 'old', 'one', 'opt', 'orb', 'ore', 'our', 'out', 'ova', 'owe', 'owl', 'own', 'pad',
  'pal', 'pam', 'pan', 'pap', 'par', 'pat', 'paw', 'pax', 'pay', 'pea', 'peg', 'pen', 'pep',
  'per', 'pet', 'pew', 'pie', 'pig', 'pin', 'pip', 'pit', 'ply', 'pod', 'poi', 'pol', 'pop',
  'pot', 'pow', 'pox', 'pro', 'pry', 'pub', 'pug', 'pun', 'pup', 'pus', 'put', 'rad', 'rag',
  'ram', 'ran', 'rap', 'rat', 'raw', 'ray', 'red', 'ref', 'rep', 'rev', 'rib', 'rid', 'rig',
  'rim', 'rip', 'rob', 'rod', 'roe', 'rot', 'row', 'rub', 'rug', 'rum', 'run', 'rut', 'rye',
  'sac', 'sad', 'sag', 'sap', 'sat', 'saw', 'sax', 'say', 'sea', 'see', 'set', 'sew', 'sex',
  'she', 'shy', 'sin', 'sip', 'sir', 'sis', 'sit', 'six', 'ski', 'sky', 'sly', 'sob', 'sod',
  'son', 'sop', 'sot', 'sow', 'soy', 'spa', 'spy', 'sty', 'sub', 'sue', 'sum', 'sun', 'sup',
  'tab', 'tad', 'tag', 'tan', 'tap', 'tar', 'tat', 'tax', 'tea', 'ted', 'tee', 'ten', 'the',
  'thy', 'tic', 'tie', 'tin', 'tip', 'tit', 'toe', 'tog', 'tom', 'ton', 'too', 'top', 'tot',
  'tow', 'toy', 'try', 'tub', 'tug', 'tun', 'tux', 'two', 'ugh', 'ump', 'urn', 'use', 'van',
  'vat', 'vet', 'vex', 'via', 'vie', 'vim', 'vow', 'wad', 'wag', 'wan', 'war', 'was', 'wax',
  'way', 'web', 'wed', 'wee', 'wet', 'who', 'why', 'wig', 'win', 'wit', 'woe', 'wok', 'won',
  'woo', 'wop', 'wot', 'wow', 'wry', 'yak', 'yam', 'yap', 'yaw', 'yay', 'yea', 'yen', 'yes',
  'yet', 'yew', 'yin', 'yip', 'yon', 'you', 'yow', 'yuk', 'yum', 'zap', 'zed', 'zen', 'zig',
  'zip', 'zit', 'zoo',
]);

function collectCurriculumWords(): void {
  for (const g of Object.values(GROUPS)) {
    for (const w of g.words) COMMON_WORDS.add(w.toLowerCase());
  }
}

collectCurriculumWords();

export function isRealWord(word: string): boolean {
  return COMMON_WORDS.has(word.toLowerCase());
}
