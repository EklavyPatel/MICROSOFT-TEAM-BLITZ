import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'cinematics.json');
const sessions = new Map();
const titleTriviaSessions = new Map();
const port = Number(process.env.PORT) || 3000;
const freshData = () => ({ users: [], watchlists: {}, rooms: [], messages: {}, checkIns: {}, roomMembers: {}, roomScores: {}, roomProgress: {}, roomSubmissions: {}, threads: [
  { id: 'welcome', community: 'General', user: 'CineMaTicS', text: 'Welcome to the community. What have you been watching lately?', createdAt: new Date().toISOString(), replies: [] },
  { id: 'recommend', community: 'Recommendations', user: 'CineMaTicS', text: 'Share a hidden gem you wish more people knew about.', createdAt: new Date().toISOString(), replies: [] }
] });
let data = freshData();
await mkdir(dataDir, { recursive: true });
try { data = { ...freshData(), ...JSON.parse(await readFile(dataFile, 'utf8')) }; } catch { await save(); }
for (const room of data.rooms) {
  room.ownerId ||= data.users.find(user => user.name === room.owner)?.id || '';
  data.roomMembers[room.id] ||= {};
  data.roomScores[room.id] ||= {};
  data.roomProgress[room.id] ||= {};
  data.roomSubmissions[room.id] ||= {};
  if (room.ownerId) data.roomMembers[room.id][room.ownerId] ||= { joinedAt: room.createdAt };
}
async function save() { await writeFile(dataFile, JSON.stringify(data, null, 2)); }
function send(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let raw = ''; for await (const part of req) { raw += part; if (raw.length > 1_000_000) throw new Error('Request is too large'); }
  return raw ? JSON.parse(raw) : {};
}
function currentUser(req) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('cinematics_session='))?.split('=')[1];
  const id = token && sessions.get(token);
  return data.users.find(user => user.id === id) || null;
}
function publicUser(user) { return user && ({ id: user.id, name: user.name, email: user.email, bio: user.bio || '', tokens: Number(user.tokens) || 0 }); }
function shuffle(items) { return [...items].sort(() => Math.random() - .5); }
function makeTitleQuestions(title, watchlist) {
  const distractorTitles = [...new Set([...watchlist.map(item => item.name), 'Arrival', 'The Grand Picture', 'Deep Field', 'Blue Hour'].filter(name => name && name !== title.name))];
  const make = (prompt, answer, distractors) => { const choices = shuffle([...new Set([answer, ...distractors.filter(value => value !== answer)])].slice(0, 4)); return { question: prompt, choices, answerIndex: choices.indexOf(answer) }; };
  const questions = [];
  if (title.summary) questions.push(make(`Which title matches this story? “${title.summary.slice(0, 240)}”`, title.name, distractorTitles));
  if (title.year) questions.push(make(`What year is ${title.name} listed as starting or being released?`, String(title.year), shuffle([String(Number(title.year) - 2), String(Number(title.year) - 1), String(Number(title.year) + 1), String(Number(title.year) + 2)])));
  if (title.genres?.length) { const answer = title.genres[0]; const genreOptions = ['Drama', 'Comedy', 'Mystery', 'Romance', 'Action', 'Science-Fiction', 'Adventure', 'Thriller', 'Documentary', 'Animation']; questions.push(make(`Which genre is listed for ${title.name}?`, answer, shuffle(genreOptions.filter(item => item !== answer)))); }
  if (!questions.length) questions.push(make(`Which title did you save for this trivia round?`, title.name, distractorTitles));
  return questions;
}
const roomTriviaBank = [
  ['Which city is the main setting of Friends?', 'New York City', 'Chicago', 'Seattle', 'Boston'],
  ['What is the paper company in The Office (US)?', 'Dunder Mifflin', 'Pied Piper', 'Waystar Royco', 'Initech'],
  ['Who created The Simpsons?', 'Matt Groening', 'Seth MacFarlane', 'Mike Judge', 'Trey Parker'],
  ['Which fictional continent is home to the Seven Kingdoms in Game of Thrones?', 'Westeros', 'Middle-earth', 'Narnia', 'Pandora'],
  ['What is the parallel dimension in Stranger Things called?', 'The Upside Down', 'The Twilight Zone', 'The Bad Place', 'The Matrix'],
  ['Walter White teaches which subject in Breaking Bad?', 'Chemistry', 'History', 'Physics', 'Mathematics'],
  ['What is the Doctor’s time machine in Doctor Who called?', 'TARDIS', 'Enterprise', 'Serenity', 'Millennium Falcon'],
  ['Which series features Jean-Luc Picard?', 'Star Trek: The Next Generation', 'Doctor Who', 'Firefly', 'The Expanse'],
  ['What kind of animal is Bluey?', 'Dog', 'Cat', 'Rabbit', 'Koala'],
  ['Which television award is represented by a winged woman holding an atom?', 'Emmy', 'Oscar', 'Grammy', 'Tony'],
  ['Sherlock Holmes lives on which London street?', 'Baker Street', 'Fleet Street', 'Downing Street', 'Oxford Street'],
  ['What is the coffee shop in Friends called?', 'Central Perk', 'Monk’s Café', 'Luke’s Diner', 'Café Nervosa'],
  ['Which country produced the original Squid Game?', 'South Korea', 'Japan', 'Thailand', 'China'],
  ['Which series features the Roy family?', 'Succession', 'Modern Family', 'The Crown', 'Downton Abbey'],
  ['What is the first episode of a proposed TV series often called?', 'Pilot', 'Finale', 'Sequel', 'Crossover'],
  ['Which fictional town is the main setting of Stranger Things?', 'Hawkins', 'Springfield', 'Riverdale', 'Twin Peaks'],
  ['Which show features Ted, Robin, Marshall, Lily, and Barney?', 'How I Met Your Mother', 'Friends', 'New Girl', 'Community'],
  ['Which series is set mainly in the fictional town of Winden?', 'Dark', 'Lost', 'Westworld', 'Severance'],
  ['Which series follows the employees of Lumon Industries?', 'Severance', 'The Office', 'Silicon Valley', 'Superstore'],
  ['Which family lives at 742 Evergreen Terrace?', 'The Simpsons', 'The Griffins', 'The Belchers', 'The Flintstones'],
  ['Which fantasy series features Aang?', 'Avatar: The Last Airbender', 'Adventure Time', 'Gravity Falls', 'Steven Universe'],
  ['Which series follows the Roy family and their media company?', 'Succession', 'The Crown', 'Billions', 'Mad Men'],
  ['What is the name of the school in Wednesday?', 'Nevermore Academy', 'Hogwarts', 'Rydell High', 'Hill Valley High'],
  ['Which sitcom is set in Pawnee, Indiana?', 'Parks and Recreation', '30 Rock', 'Community', 'Superstore']
];
async function makeRoomTrivia(movieTitle) {
  const title = String(movieTitle || 'the selected movie').trim(); let info = {};
  try {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${title} film`)}&gsrlimit=10&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`, { headers: { 'user-agent': 'CineMaTicS/1.0 (movie trivia)' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Movie details unavailable');
    const result = await response.json(), pages = Object.values(result.query?.pages || {}).sort((a,b)=>(a.index||999)-(b.index||999)), key = title.toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/^(the|a|an) /,'').trim(), normalize = value => value.toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/^(the|a|an) /,'').trim();
    const page = pages.find(item => normalize(item.title) === key && /\bfilm\b/i.test(item.extract||'')) || pages.find(item => normalize(item.title).includes(key) && /\bfilm\b/i.test(item.extract||'')) || pages.find(item => /\bfilm\b/i.test(item.extract||''));
    const summary = String(page?.extract || '').replace(/\[\d+\]/g,'').trim(), head = summary.slice(0,420);
    const director = head.match(/directed by ([^.;,]+)/i)?.[1]?.trim(), year = head.match(/\b(?:19|20)\d{2}\b/)?.[0];
    const genres = ['Science Fiction','Superhero','Action','Adventure','Fantasy','Comedy','Drama','Thriller','Animation','Documentary','Crime','Romance','Horror'].filter(genre=>new RegExp(genre==='Science Fiction'?'science fiction':genre,'i').test(head));
    info = { summary, director, year, genres };
  } catch {}
  const choicesFor = (answer, wrong) => shuffle([...new Set([answer,...wrong.filter(value=>value&&value!==answer)])].slice(0,4));
  const questions = [], titleOptions = ['Arrival','Dune','Black Panther','Spider-Man','The Dark Knight','Guardians of the Galaxy'].filter(value=>value.toLowerCase()!==title.toLowerCase());
  if (info.summary) questions.push({ text:`Which movie matches this story? “${info.summary.slice(0,210)}”`, answer:title, choices:choicesFor(title,titleOptions) });
  if (info.year) { const year=Number(info.year); questions.push({ text:`In what year was ${title} released?`, answer:String(info.year), choices:choicesFor(String(info.year),[String(year-2),String(year-1),String(year+1),String(year+2)]) }); }
  if (info.director) questions.push({ text:`Who directed ${title}?`, answer:info.director, choices:choicesFor(info.director,['James Cameron','Joss Whedon','Christopher Nolan','Steven Spielberg','Ryan Coogler','The Russo Brothers']) });
  if (info.genres.length) { const genre=info.genres[0]; questions.push({ text:`Which genre best matches ${title}?`, answer:genre, choices:choicesFor(genre,['Action','Adventure','Science Fiction','Superhero','Fantasy','Drama','Comedy','Thriller'].filter(value=>value.toLowerCase()!==genre.toLowerCase())) }); }
  if (!questions.length) questions.push({ text:`Which movie was selected for this room’s screening?`, answer:title, choices:choicesFor(title,titleOptions) });
  return { id: randomBytes(8).toString('hex'), title: `${title} Movie Trivia`, questions: questions.map(question=>({ ...question, id:randomBytes(8).toString('hex') })), createdAt: new Date().toISOString() };
}
function requireUser(req, res) { const user = currentUser(req); if (!user) send(res, 401, { error: 'Please sign in to do that.' }); return user; }
async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/me') return send(res, 200, { user: publicUser(currentUser(req)) });
  if (req.method === 'POST' && ['/api/signup', '/api/signin'].includes(p)) {
    const input = await body(req), email = String(input.email || '').trim().toLowerCase(), password = String(input.password || '');
    if (!email.includes('@') || password.length < 8) return send(res, 400, { error: 'Enter a valid email and a password with at least 8 characters.' });
    let user = data.users.find(entry => entry.email === email);
    if (p.endsWith('signup')) {
      if (user) return send(res, 409, { error: 'An account with that email already exists.' });
      const salt = randomBytes(16).toString('hex'), hash = (await scrypt(password, salt, 64)).toString('hex');
      user = { id: randomBytes(12).toString('hex'), name: String(input.name || email.split('@')[0]).trim().slice(0, 40), email, salt, hash, bio: '', tokens: 0 };
      data.users.push(user); data.watchlists[user.id] = []; await save();
    } else {
      if (!user || !timingSafeEqual(Buffer.from(user.hash, 'hex'), Buffer.from((await scrypt(password, user.salt, 64)).toString('hex'), 'hex'))) return send(res, 401, { error: 'Email or password is incorrect.' });
    }
    const token = randomBytes(32).toString('hex'); sessions.set(token, user.id);
    return send(res, 200, { user: publicUser(user) }, { 'set-cookie': `cinematics_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
  }
  if (req.method === 'POST' && p === '/api/signout') {
    const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('cinematics_session='))?.split('=')[1];
    if (token) sessions.delete(token);
    return send(res, 200, { ok: true }, { 'set-cookie': 'cinematics_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (req.method === 'PATCH' && p === '/api/profile') {
    const user = requireUser(req, res); if (!user) return;
    const input = await body(req); user.name = String(input.name || '').trim().slice(0, 40) || user.name; user.bio = String(input.bio || '').trim().slice(0, 180); await save(); return send(res, 200, { user: publicUser(user) });
  }
  if (req.method === 'GET' && p === '/api/watchlist') {
    const user = requireUser(req, res); if (!user) return; return send(res, 200, { titles: data.watchlists[user.id] || [] });
  }
  if (req.method === 'POST' && p === '/api/watchlist') {
    const user = requireUser(req, res); if (!user) return; const title = await body(req);
    const list = data.watchlists[user.id] ||= [];
    if (!list.some(item => String(item.id) === String(title.id))) list.unshift({ id: title.id, name: title.name, image: title.image || '', year: title.year || '', summary: title.summary || '', genres: Array.isArray(title.genres) ? title.genres.slice(0, 5) : [], director: title.director || '', progress: 0 });
    await save(); return send(res, 200, { titles: list });
  }
  const progressMatch = p.match(/^\/api\/watchlist\/([^/]+)\/progress$/);
  if (req.method === 'PATCH' && progressMatch) {
    const user = requireUser(req, res); if (!user) return;
    const percent = Number((await body(req)).percent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return send(res, 400, { error: 'Progress must be a whole number from 0 to 100.' });
    const title = (data.watchlists[user.id] || []).find(item => String(item.id) === decodeURIComponent(progressMatch[1]));
    if (!title) return send(res, 404, { error: 'That saved title was not found.' });
    title.progress = percent; title.progressUpdatedAt = new Date().toISOString(); await save();
    return send(res, 200, { title });
  }
  if (req.method === 'GET' && p.startsWith('/api/titles/') && p.endsWith('/crowd')) {
    const id = decodeURIComponent(p.slice('/api/titles/'.length, -'/crowd'.length)); const now = Date.now(); const active = data.checkIns[id] || {};
    for (const [userId, checkIn] of Object.entries(active)) { const watchingAt=Date.parse(checkIn.watchingAt), pickedAt=Date.parse(checkIn.pickedAt); if ((!Number.isFinite(watchingAt) || now-watchingAt>90*60*1000) && (!Number.isFinite(pickedAt) || now-pickedAt>60*60*1000)) delete active[userId]; }
    data.checkIns[id] = active;
    const user = currentUser(req);
    return send(res, 200, { watching: user ? Boolean(active[user.id] && now - Date.parse(active[user.id].watchingAt) <= 90 * 60 * 1000) : false, watchingNow: Object.values(active).filter(checkIn => now - Date.parse(checkIn.watchingAt) <= 90 * 60 * 1000).length, pickedRecently: Object.values(active).filter(checkIn => now - Date.parse(checkIn.pickedAt) <= 60 * 60 * 1000).length, recentWindowMinutes: 60 });
  }
  const checkInMatch = p.match(/^\/api\/titles\/([^/]+)\/check-in$/);
  if (req.method === 'POST' && checkInMatch) {
    const user = requireUser(req, res); if (!user) return; const id = decodeURIComponent(checkInMatch[1]), input = await body(req), active = data.checkIns[id] ||= {};
    const nowIso = new Date().toISOString(), prior = active[user.id];
    if (input.watching === false) { if (prior) prior.watchingAt = ''; }
    else active[user.id] = { watchingAt: nowIso, pickedAt: prior?.pickedAt && Date.now() - Date.parse(prior.pickedAt) < 60 * 60 * 1000 ? prior.pickedAt : nowIso };
    await save(); return send(res, 200, { watching: Boolean(active[user.id]), watchingNow: Object.keys(active).length });
  }
  if (req.method === 'DELETE' && p.startsWith('/api/watchlist/')) {
    const user = requireUser(req, res); if (!user) return; data.watchlists[user.id] = (data.watchlists[user.id] || []).filter(item => String(item.id) !== decodeURIComponent(p.split('/').pop())); await save(); return send(res, 200, { titles: data.watchlists[user.id] });
  }
  if (req.method === 'GET' && p === '/api/tv') {
    const q = url.searchParams.get('q')?.trim(); if (!q) return send(res, 200, { shows: [] });
    try { const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(9000) }); if (!response.ok) throw new Error('TV search is temporarily unavailable.'); const result = await response.json(); return send(res, 200, { shows: result.map(({ show }) => ({ id: show.id, name: show.name, image: show.image?.medium || '', year: show.premiered?.slice(0, 4) || '', genres: show.genres || [], summary: (show.summary || '').replace(/<[^>]*>/g, ''), rating: show.rating?.average || null, url: show.url })) }); }
    catch (error) { return send(res, 502, { error: 'TV search could not connect right now. Please try again.' }); }
  }
  if (req.method === 'GET' && p === '/api/movies') {
    const q = url.searchParams.get('q')?.trim(); if (!q) return send(res, 200, { movies: [] });
    try { const response = await fetch(`https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${q} film`)}&gsrlimit=20&prop=pageimages%7Cextracts%7Cinfo&inprop=url&piprop=thumbnail&pithumbsize=500&exintro=1&explaintext=1&format=json&origin=*`, { headers: { 'user-agent': 'CineMaTicS/1.0 (entertainment discovery demo)' }, signal: AbortSignal.timeout(9000) }); if (!response.ok) throw new Error(); const result = await response.json(); const pages = Object.values(result.query?.pages || {}).sort((a,b)=>(a.index||999)-(b.index||999)); const movies = pages.filter(page => { const first=(page.extract||'').split(/[.!?](?:\s|$)/,1)[0]; return /\bfilm\b/i.test(first) && !/\b(soundtrack|album|comic|franchise|disambiguation|character|actor|actress|series|game|religious|movement|novel|list)\b/i.test(first); }).map(page => { const summary=(page.extract||'').replace(/\[\d+\]/g,'').trim(), head=summary.slice(0,320), genres=['Science-Fiction','Animation','Documentary','Thriller','Romance','Comedy','Horror','Drama','Action','Adventure','Fantasy','Crime'].filter(genre=>new RegExp(genre==='Science-Fiction'?'science fiction':genre,'i').test(head)); const director=head.match(/directed by ([^.;,]+)/i)?.[1]||''; return { id:`wiki-${page.pageid}`, name:page.title, image:page.thumbnail?.source||'', year:head.match(/\b(?:19|20)\d{2}\b/)?.[0]||'', genres:genres.slice(0,3), director, summary, url:page.fullurl||`https://en.wikipedia.org/?curid=${page.pageid}`, source:'wikipedia' }; }); return send(res, 200, { movies }); }
    catch { return send(res, 502, { error: 'Movie search could not connect right now. Please try again.' }); }
  }
  if (req.method === 'GET' && p === '/api/music') {
    const term = url.searchParams.get('q')?.trim() || 'film soundtrack';
    try { const response = await fetch(`https://itunes.apple.com/search?entity=song&limit=12&term=${encodeURIComponent(term)}`, { signal: AbortSignal.timeout(9000) }); if (!response.ok) throw new Error(); const result = await response.json(); return send(res, 200, { tracks: result.results.map(track => ({ id: track.trackId, title: track.trackName, artist: track.artistName, album: track.collectionName, artwork: track.artworkUrl100, preview: track.previewUrl, link: track.trackViewUrl })) }); }
    catch { return send(res, 502, { error: 'Music search is temporarily unavailable. Please try again.' }); }
  }
  if (req.method === 'GET' && p === '/api/trivia') {
    try { const response = await fetch('https://opentdb.com/api.php?amount=10&type=multiple&encode=url3986', { signal: AbortSignal.timeout(9000) }); const result = await response.json(); if (result.response_code !== 0) throw new Error(); return send(res, 200, { questions: result.results.map(q => ({ category: decodeURIComponent(q.category), question: decodeURIComponent(q.question), answer: decodeURIComponent(q.correct_answer), choices: [q.correct_answer, ...q.incorrect_answers].map(decodeURIComponent).sort(() => Math.random() - .5) })) }); }
    catch { return send(res, 502, { error: 'Trivia questions are unavailable right now. Try again in a moment.' }); }
  }
  if (req.method === 'POST' && p === '/api/trivia/title') {
    const user = requireUser(req, res); if (!user) return; const input = await body(req), watchlist = data.watchlists[user.id] || [], title = watchlist.find(item => String(item.id) === String(input.id));
    if (!title) return send(res, 404, { error: 'Save this title first to start its trivia round.' });
    if (Number(title.progress) < 100) return send(res, 409, { error: 'Finish watching this title to unlock its trivia round.' });
    const questions = makeTitleQuestions(title, watchlist), sessionId = randomBytes(16).toString('hex'); titleTriviaSessions.set(sessionId, { userId: user.id, answers: questions.map(question => question.answerIndex), createdAt: Date.now() });
    return send(res, 200, { sessionId, title: title.name, questions: questions.map(({ question, choices }) => ({ question, choices })) });
  }
  const titleTriviaMatch = p.match(/^\/api\/trivia\/title\/([^/]+)\/submit$/);
  if (req.method === 'POST' && titleTriviaMatch) {
    const user = requireUser(req, res); if (!user) return; const sessionId = decodeURIComponent(titleTriviaMatch[1]), quiz = titleTriviaSessions.get(sessionId);
    if (!quiz || quiz.userId !== user.id || Date.now() - quiz.createdAt > 30 * 60 * 1000) return send(res, 404, { error: 'This trivia round expired. Start a new round.' });
    const answers = (await body(req)).answers; if (!Array.isArray(answers) || answers.length !== quiz.answers.length) return send(res, 400, { error: 'Please answer every trivia question.' });
    const score = answers.reduce((total, answer, index) => total + (Number(answer) === quiz.answers[index] ? 1 : 0), 0), reward = score * 5; user.tokens = (Number(user.tokens) || 0) + reward; titleTriviaSessions.delete(sessionId); await save();
    return send(res, 200, { score, total: quiz.answers.length, reward, tokens: user.tokens });
  }
  if (req.method === 'GET' && p === '/api/rooms') return send(res, 200, { rooms: data.rooms.map(room => ({ id: room.id, name: room.name, title: room.title, startsAt: room.startsAt, owner: room.owner, createdAt: room.createdAt, memberCount: Object.keys(data.roomMembers[room.id] || {}).length, screening: Boolean(room.screen && !room.screen.finished), watchingNow: room.screen?.playing ? Object.keys(data.roomProgress[room.id] || {}).length : 0 })) });
  if (req.method === 'POST' && p === '/api/rooms') {
    const user = requireUser(req, res); if (!user) return; const input = await body(req), name = String(input.name || '').trim();
    if (!name) return send(res, 400, { error: 'Add a name for your watch party.' });
    const startsAt = input.startsAt && Number.isFinite(Date.parse(input.startsAt)) ? new Date(input.startsAt).toISOString() : '';
    const room = { id: randomBytes(8).toString('hex'), name: name.slice(0, 70), title: String(input.title || '').slice(0, 100), startsAt, owner: user.name, ownerId: user.id, createdAt: new Date().toISOString() }; data.rooms.unshift(room); data.messages[room.id] = []; data.roomMembers[room.id] = { [user.id]: { joinedAt: room.createdAt } }; data.roomScores[room.id] = {}; data.roomProgress[room.id] = {}; data.roomSubmissions[room.id] = {}; await save(); return send(res, 201, { room: { ...room, ownerId: undefined } });
  }
  const cinemaMatch = p.match(/^\/api\/rooms\/([^/]+)\/cinema(?:\/(screen|control|heartbeat|trivia\/start|trivia\/submit))?$/);
  if (cinemaMatch) {
    const roomId = decodeURIComponent(cinemaMatch[1]), action = cinemaMatch[2] || '', room = data.rooms.find(item => item.id === roomId);
    if (!room) return send(res, 404, { error: 'That cinema room was not found.' });
    const user = requireUser(req, res); if (!user) return;
    const members = data.roomMembers[roomId] ||= {};
    const host = room.ownerId === user.id;
    if (req.method === 'POST' && action === '') {
      members[user.id] ||= { joinedAt: new Date().toISOString() }; await save();
      return send(res, 200, { joined: true, host });
    }
    if (!members[user.id]) return send(res, 403, { error: 'Join this room before opening its community cinema.' });
    if (req.method === 'GET' && !action) {
      const now = Date.now(), screen = room.screen ? { ...room.screen } : null;
      if (screen) { screen.position = Math.min(screen.duration, screen.position + (screen.playing ? Math.max(0, now - screen.updatedAt) / 1000 : 0)); screen.playing = Boolean(screen.playing && screen.position < screen.duration && !screen.finished); screen.serverTime = new Date(now).toISOString(); }
      const progress = data.roomProgress[roomId] ||= {}, scores = data.roomScores[roomId] ||= {};
      const leaderboard = Object.keys(members).map(userId => ({ userId, name: data.users.find(item => item.id === userId)?.name || 'Member', points: Number(scores[userId]) || 0, watchedSeconds: Math.floor(progress[userId]?.seconds || 0) })).sort((a,b)=>b.points-a.points || a.name.localeCompare(b.name));
      const submission = data.roomSubmissions[roomId]?.[user.id];
      const quiz = room.quiz ? { id: room.quiz.id, title: room.quiz.title, startedAt: room.quiz.startedAt, submitted: Boolean(submission), result: submission ? { correct: submission.correct, total: room.quiz.questions.length, points: submission.points } : null, questions: room.quiz.questions.map(({ id, text, choices }) => ({ id, text, choices })) } : null;
      return send(res, 200, { room: { id: room.id, name: room.name, title: room.title, startsAt: room.startsAt, owner: room.owner }, me: { id: user.id, name: user.name, host }, members: Object.keys(members).map(userId => ({ id: userId, name: data.users.find(item => item.id === userId)?.name || 'Member', host: userId === room.ownerId })), screen, progress: { seconds: Math.floor(progress[user.id]?.seconds || 0), awarded: Boolean(progress[user.id]?.awarded) }, messages: data.messages[roomId] || [], leaderboard, quiz });
    }
    if ((action === 'screen' || action === 'control' || action === 'trivia/start') && !host) return send(res, 403, { error: 'Only the room host can control the screening or start trivia.' });
    if (req.method === 'PUT' && action === 'screen') {
      const input = await body(req), title = String(input.title || '').trim().slice(0, 100), mediaUrl = String(input.url || '').trim();
      const duration = Number(input.duration);
      let validUrl = mediaUrl === '/assets/sintel-trailer.mp4';
      try { validUrl ||= new URL(mediaUrl).protocol === 'https:'; } catch {}
      if (!title || !validUrl || !Number.isFinite(duration) || duration < 10 || duration > 4 * 60 * 60) return send(res, 400, { error: 'Add a title, a valid HTTPS video URL, and a video duration between 10 seconds and 4 hours.' });
      room.title = title; room.quiz = null; data.roomProgress[roomId] ||= {}; for (const progress of Object.values(data.roomProgress[roomId])) { if (!progress.awarded) progress.seconds = 0; progress.lastAt = Date.now(); } data.roomSubmissions[roomId] = {};
      room.screen = { id: randomBytes(8).toString('hex'), title, url: mediaUrl, duration, position: 0, playing: false, updatedAt: Date.now(), finished: false };
      await save(); return send(res, 200, { screen: room.screen });
    }
    if (req.method === 'PATCH' && action === 'screen') {
      const duration = Number((await body(req)).duration);
      if (!room.screen || !Number.isFinite(duration) || duration < 10 || duration > 4 * 60 * 60) return send(res, 400, { error: 'A valid screening duration is required.' });
      room.screen.duration = duration; room.screen.position = Math.min(room.screen.position, duration); await save(); return send(res, 200, { screen: room.screen });
    }
    if (req.method === 'POST' && action === 'control') {
      const input = await body(req), screen = room.screen; if (!screen) return send(res, 404, { error: 'Load a video before starting the screening.' });
      if (!['play','pause','seek','finish'].includes(input.action)) return send(res, 400, { error: 'Choose a valid screening control.' });
      const now = Date.now(); screen.position = Math.min(screen.duration, screen.position + (screen.playing ? Math.max(0, now - screen.updatedAt) / 1000 : 0));
      if (input.action === 'play' && !screen.finished) screen.playing = true;
      if (input.action === 'pause') screen.playing = false;
      if (input.action === 'seek') screen.position = Math.max(0, Math.min(screen.duration, Number(input.position) || 0));
      if (input.action === 'finish') { screen.playing = false; screen.finished = true; screen.position = screen.duration; }
      screen.updatedAt = now; await save(); return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'heartbeat') {
      const input = await body(req), screen = room.screen; if (!screen || input.screenId !== screen.id) return send(res, 409, { error: 'The screening changed. Refresh the room.' });
      const now = Date.now(), progress = data.roomProgress[roomId] ||= {}, item = progress[user.id] ||= { seconds: 0, lastAt: now, awarded: false };
      if (input.watching === true && screen.playing && !screen.finished) item.seconds += Math.min(15, Math.max(0, now - item.lastAt) / 1000);
      item.lastAt = now;
      if (!item.awarded && item.seconds >= screen.duration * .8) { item.awarded = true; data.roomScores[roomId][user.id] = (Number(data.roomScores[roomId][user.id]) || 0) + 10; }
      await save(); return send(res, 200, { seconds: Math.floor(item.seconds), awarded: item.awarded });
    }
    if (req.method === 'POST' && action === 'trivia/start') {
      if (!room.screen?.finished || !data.roomProgress[roomId]?.[user.id]?.awarded) return send(res, 409, { error: 'Watch at least 80% of the screening, then finish it to unlock trivia.' });
      if (!room.quiz || room.quiz.title !== `${room.title || 'the selected movie'} Movie Trivia`) { const fresh = await makeRoomTrivia(room.title); room.quiz = { id: fresh.id, title: fresh.title, startedAt: new Date().toISOString(), questions: fresh.questions.map(({ answer, ...question }) => question), answers: fresh.questions.map(question => question.answer) }; }
      await save(); return send(res, 200, { quiz: { id: room.quiz.id, title: room.quiz.title, questions: room.quiz.questions.map(({ id, text, choices }) => ({ id, text, choices })) } });
    }
    if (req.method === 'POST' && action === 'trivia/submit') {
      const input = await body(req), quiz = room.quiz; if (!quiz || input.quizId !== quiz.id || !Array.isArray(input.answers) || input.answers.length !== quiz.answers.length) return send(res, 400, { error: 'That trivia round is unavailable. Ask the host to reopen it.' });
      const submissions = data.roomSubmissions[roomId] ||= {}; if (submissions[user.id]) return send(res, 409, { error: 'You already played this room’s trivia.' });
      const correct = input.answers.reduce((total, answer, index) => total + (String(answer) === quiz.answers[index] ? 1 : 0), 0), points = correct * 5;
      submissions[user.id] = { correct, points, createdAt: new Date().toISOString() }; data.roomScores[roomId][user.id] = (Number(data.roomScores[roomId][user.id]) || 0) + points;
      await save(); return send(res, 200, { correct, total: quiz.answers.length, points, totalPoints: data.roomScores[roomId][user.id] });
    }
    return send(res, 404, { error: 'Cinema action not found.' });
  }
  const roomMatch = p.match(/^\/api\/rooms\/([^/]+)\/messages$/);
  if (roomMatch && req.method === 'GET') { const user = requireUser(req, res); if (!user) return; const room = data.rooms.find(r => r.id === roomMatch[1]); if (!room) return send(res, 404, { error: 'That party room was not found.' }); if (!data.roomMembers[room.id]?.[user.id]) return send(res, 403, { error: 'Join this cinema room before opening its chat.' }); return send(res, 200, { messages: data.messages[room.id] || [] }); }
  if (roomMatch && req.method === 'POST') { const user = requireUser(req, res); if (!user) return; const message = String((await body(req)).text || '').trim(); if (!message) return send(res, 400, { error: 'Write a message first.' }); if (message.length > 500) return send(res, 400, { error: 'Messages can be up to 500 characters.' }); const room=data.rooms.find(r => r.id === roomMatch[1]); if (!room) return send(res, 404, { error: 'That party room was not found.' }); if (!data.roomMembers[room.id]?.[user.id]) return send(res, 403, { error: 'Join this cinema room before chatting.' }); const item = { id: randomBytes(8).toString('hex'), user: user.name, text: message, createdAt: new Date().toISOString() }; (data.messages[room.id] ||= []).push(item); await save(); return send(res, 201, { message: item }); }
  if (req.method === 'GET' && p === '/api/threads') return send(res, 200, { threads: data.threads });
  if (req.method === 'POST' && p === '/api/threads') { const user = requireUser(req, res); if (!user) return; const input = await body(req), text = String(input.text || '').trim(); if (!text) return send(res, 400, { error: 'Write a discussion post first.' }); if (text.length > 1000) return send(res, 400, { error: 'Posts can be up to 1,000 characters.' }); const thread = { id: randomBytes(8).toString('hex'), community: String(input.community || 'General').slice(0, 40), user: user.name, text, createdAt: new Date().toISOString(), replies: [] }; data.threads.unshift(thread); await save(); return send(res, 201, { thread }); }
  const replyMatch = p.match(/^\/api\/threads\/([^/]+)\/replies$/);
  if (replyMatch && req.method === 'POST') { const user = requireUser(req, res); if (!user) return; const thread = data.threads.find(t => t.id === replyMatch[1]); if (!thread) return send(res, 404, { error: 'Discussion not found.' }); const text = String((await body(req)).text || '').trim(); if (!text) return send(res, 400, { error: 'Write a reply first.' }); thread.replies.push({ id: randomBytes(8).toString('hex'), user: user.name, text: text.slice(0, 500), createdAt: new Date().toISOString() }); await save(); return send(res, 201, { thread }); }
  return send(res, 404, { error: 'API route not found.' });
}
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(publicDir, `.${relative}`);
    if (!file.startsWith(publicDir + path.sep)) return send(res, 403, { error: 'Forbidden' });
    const content = await readFile(file), ext = path.extname(file), type = mime[ext] || 'application/octet-stream';
    if ((ext === '.mp4' || ext === '.webm') && req.headers.range) {
      const match = String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
      if (!match) { res.writeHead(416, { 'content-range': `bytes */${content.length}` }); return res.end(); }
      const start = match[1] ? Number(match[1]) : Math.max(0, content.length - Number(match[2] || 0));
      const end = match[2] && match[1] ? Math.min(Number(match[2]), content.length - 1) : content.length - 1;
      if (!Number.isSafeInteger(start) || start > end || start >= content.length) { res.writeHead(416, { 'content-range': `bytes */${content.length}` }); return res.end(); }
      const chunk = content.subarray(start, end + 1); res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${content.length}`, 'content-length': chunk.length }); return res.end(chunk);
    }
    res.writeHead(200, { 'content-type': type, ...((ext === '.mp4' || ext === '.webm') ? { 'accept-ranges': 'bytes' } : {}) }); res.end(content);
  } catch (error) { console.error(error); if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please try again.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`CineMaTicS is ready at http://localhost:${port}`));
