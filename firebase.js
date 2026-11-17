// Firebase Web app configuration for the HER project. Keep the room locked to its two approved UIDs.
// Firebase Console → Project settings → General → Your apps → Web app.
export const firebaseConfig = {
  apiKey: "AIzaSyBxYKfuM0MA85iLV0o5JNIJvI6iNU7R1Ug",
  authDomain: "her-bright.firebaseapp.com",
  projectId: "her-bright",
  storageBucket: "her-bright.firebasestorage.app",
  databaseURL: "https://her-bright-default-rtdb.firebaseio.com",
  messagingSenderId: "577962151292",
  appId: "1:577962151292:web:8cc5a92ac803748cac28f9"
};

const configured = Object.values(firebaseConfig).every(Boolean);
export const firebaseReady = configured;
export const ROOM_ID = "bright-private";
export const BRIGHT_UID = "gpxMUJId0qYbqFH50qtftdKMgue2";
export const FERANMI_UID = "S1rJm1luDZVPt1ijIZoU2sisI3B2";
export function personName(uid) { return uid === BRIGHT_UID ? "Bright" : uid === FERANMI_UID ? "Feranmi" : "Your person"; }

let api = null;
export async function connectFirebase() {
  if (!configured) return null;
  const [appMod, authMod, storeMod, realtimeMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/13.4.0/firebase-database.js")
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  const db = storeMod.getFirestore(app);
  const rtdb = realtimeMod.getDatabase(app);
  api = { auth, db, rtdb, authMod, storeMod, realtimeMod };
  return api;
}
export function onAuth(callback) {
  if (!api) return () => {};
  return api.authMod.onAuthStateChanged(api.auth, callback);
}
export async function signIn(email, password) {
  if (!api) throw new Error("Firebase is not connected yet.");
  return (await api.authMod.signInWithEmailAndPassword(api.auth, email, password)).user;
}
export async function signOut() { if (api) return api.authMod.signOut(api.auth); }
export function subscribeMessages(callback, onError = () => {}) {
  if (!api) return () => {};
  const { collection, onSnapshot } = api.storeMod;
  const ref = collection(api.db, "rooms", ROOM_ID, "messages");
  // Listen to the collection directly so legacy messages without `createdAt` are not silently omitted.
  return onSnapshot(ref, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onError);
}
export async function sendCloudMessage(user, text) {
  if (!api) throw new Error("Firebase is not connected.");
  const { collection, addDoc, serverTimestamp } = api.storeMod;
  await addDoc(collection(api.db, "rooms", ROOM_ID, "messages"), { text, uid: user.uid, name: personName(user.uid), createdAt: serverTimestamp() });
}
export function subscribeReadStatus(callback, onError = () => {}) {
  if (!api) return () => {};
  const { collection, onSnapshot } = api.storeMod;
  return onSnapshot(collection(api.db, "rooms", ROOM_ID, "readStatus"), snap => {
    const statuses = {};
    snap.docs.forEach(d => { statuses[d.id] = d.data(); });
    callback(statuses);
  }, onError);
}
export async function markMessagesRead(uid) {
  if (!api) throw new Error("Firebase is not connected.");
  const { doc, setDoc, serverTimestamp } = api.storeMod;
  await setDoc(doc(api.db, "rooms", ROOM_ID, "readStatus", uid), { uid, lastReadAt: serverTimestamp() }, { merge: true });
}
export function subscribeDailyLove(callback, onError = () => {}) {
  if (!api) return () => {};
  const { collection, onSnapshot } = api.storeMod;
  return onSnapshot(collection(api.db, "rooms", ROOM_ID, "dailyLove"), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, onError);
}
export async function markDailyLoveVisit(uid) {
  if (!api) throw new Error("Firebase is not connected.");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
  const day = `${values.year}-${values.month}-${values.day}`;
  const { doc, runTransaction } = api.storeMod;
  const ref = doc(api.db, "rooms", ROOM_ID, "dailyLove", day);
  await runTransaction(api.db, async transaction => {
    const snap = await transaction.get(ref);
    const visitors = snap.exists() ? (snap.data().visitors || {}) : {};
    if (visitors[uid] === true) return;
    transaction.set(ref, { day, visitors: { ...visitors, [uid]: true } }, { merge: true });
  });
}

export function subscribeSpin(callback, onError = () => {}) {
  if (!api) return () => {};
  const { doc, onSnapshot } = api.storeMod;
  return onSnapshot(doc(api.db, "rooms", ROOM_ID, "live", "spin"), snap => callback(snap.exists() ? snap.data() : null), onError);
}
export async function publishSpin(data) {
  if (!api) return;
  const { doc, setDoc, serverTimestamp } = api.storeMod;
  await setDoc(doc(api.db, "rooms", ROOM_ID, "live", "spin"), { ...data, updatedAt: serverTimestamp() });
}

async function requireBothPlayersOnline(memberUids) {
  if (!api) throw new Error("Connect Firebase first.");
  const snap = await api.realtimeMod.get(api.realtimeMod.ref(api.rtdb, `presence/${ROOM_ID}`));
  const online = snap.val() || {};
  if (!Array.isArray(memberUids) || memberUids.length !== 2 || !memberUids.every(uid => online[uid]?.state === "online")) {
    throw new Error("Both players must be connected to the room.");
  }
}

export async function getRoomMemberUids() {
  if (!api) return [];
  const { doc, getDoc } = api.storeMod;
  const snap = await getDoc(doc(api.db, "rooms", ROOM_ID));
  if (!snap.exists()) throw new Error("Create the private room document first.");
  const members = snap.data().memberUids;
  if (!Array.isArray(members) || members.length !== 2) throw new Error("The room needs exactly two member UIDs.");
  return members;
}

// Realtime Database presence: publish online only while this browser connection is alive;
// Firebase's onDisconnect handler marks the player offline after a dropped connection.
export function startRoomPresence(uid, callback, onError = () => {}) {
  if (!api) return () => {};
  const r = api.realtimeMod;
  const root = r.ref(api.rtdb, `presence/${ROOM_ID}`);
  const playerRef = r.ref(api.rtdb, `presence/${ROOM_ID}/${uid}`);
  const connectionRef = r.ref(api.rtdb, ".info/connected");
  const stopPresence = r.onValue(root, snapshot => callback(snapshot.val() || {}), onError);
  const stopConnection = r.onValue(connectionRef, async snapshot => {
    callback(null, snapshot.val() === true);
    if (snapshot.val() !== true) return;
    try {
      await r.onDisconnect(playerRef).set({ state: "offline", changedAt: r.serverTimestamp() });
      await r.set(playerRef, { state: "online", changedAt: r.serverTimestamp() });
    } catch (error) { onError(error); }
  }, onError);
  return () => {
    stopPresence(); stopConnection();
    r.set(playerRef, { state: "offline", changedAt: r.serverTimestamp() }).catch(() => {});
  };
}

export function subscribeMatch(callback, onError = () => {}) {
  if (!api) return () => {};
  const { doc, onSnapshot } = api.storeMod;
  return onSnapshot(doc(api.db, "rooms", ROOM_ID, "live", "match"), snap => callback(snap.exists() ? snap.data() : null), onError);
}
export async function selectMatch(game, uid, memberUids) {
  if (!api) throw new Error("Connect Firebase first.");
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  await runTransaction(api.db, async tx => {
    const snap = await tx.get(matchRef);
    const old = snap.exists() ? snap.data() : {};
    tx.set(matchRef, { ...old, game, status: "waiting", selectedBy: uid, selectedAt: serverTimestamp() });
  });
}
export async function cancelMatch(uid) {
  if (!api) throw new Error("Connect Firebase first.");
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  await runTransaction(api.db, async tx => {
    const snap = await tx.get(matchRef);
    if (!snap.exists() || !["waiting", "playing"].includes(snap.data().status)) return;
    if (![snap.data().selectedBy, snap.data().acceptedBy].includes(uid)) throw new Error("Only a matched player can leave this room.");
    tx.update(matchRef, { status: "finished", finishedBy: uid, finishedAt: serverTimestamp() });
  });
}
export async function acceptMatch(uid, memberUids, promptData = null) {
  if (!api) throw new Error("Connect Firebase first.");
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  const ticRef = doc(api.db, "rooms", ROOM_ID, "live", "ticTacToe");
  const duoRef = doc(api.db, "rooms", ROOM_ID, "live", "duoGame");
  const spinRef = doc(api.db, "rooms", ROOM_ID, "live", "spin");
  return runTransaction(api.db, async tx => {
    const snap = await tx.get(matchRef);
    if (!snap.exists() || snap.data().status !== "waiting") throw new Error("That invitation is no longer waiting.");
    if (snap.data().selectedBy === uid) throw new Error("Waiting for your person to accept.");
    tx.update(matchRef, { status: "playing", acceptedBy: uid, turnUid: memberUids[0], spinPoints: 0, startedAt: serverTimestamp() });
    if (snap.data().game === "tic") tx.set(ticRef, { board: Array(9).fill(""), status: "playing", turnUid: memberUids[0], winnerUid: null, scores: { [memberUids[0]]: 0, [memberUids[1]]: 0 }, draws: 0, round: 1, updatedAt: serverTimestamp() });
    else if (snap.data().game === "spin") tx.set(spinRef, { category: "", challenge: "", spinner: null, targetUid: null, turnUid: memberUids[0], completed: true, by: null, updatedAt: serverTimestamp() });
    else {
      if (!promptData) throw new Error("A question is needed to start this mini-game.");
      tx.set(duoRef, { ...promptData, game: snap.data().game, round: 1, answers: [], scores: {}, status: "playing", turnUid: memberUids[0], updatedAt: serverTimestamp() });
    }
  });
}
export async function publishTicBoard(board, turnUid, status, winnerUid = null) {
  if (!api) throw new Error("Connect Firebase first.");
  const { doc, setDoc, serverTimestamp } = api.storeMod;
  await setDoc(doc(api.db, "rooms", ROOM_ID, "live", "ticTacToe"), { board, turnUid, status, winnerUid, updatedAt: serverTimestamp() });
}
export function subscribeTicBoard(callback, onError = () => {}) {
  if (!api) return () => {};
  const { doc, onSnapshot } = api.storeMod;
  return onSnapshot(doc(api.db, "rooms", ROOM_ID, "live", "ticTacToe"), snap => callback(snap.exists() ? snap.data() : null), onError);
}
export async function commitTicMove(uid, memberUids, index) {
  if (!api) throw new Error("Connect Firebase first.");
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const gameRef = doc(api.db, "rooms", ROOM_ID, "live", "ticTacToe");
  return runTransaction(api.db, async tx => {
    const snap = await tx.get(gameRef);
    const old = snap.exists() ? snap.data() : null;
    const players = memberUids || [];
    if (players.length !== 2 || !players.includes(uid)) throw new Error("Waiting for both players to join the room.");
    const board = old?.board || Array(9).fill("");
    const turnUid = old?.turnUid || players[0];
    const status = old?.status || "playing";
    if (status !== "playing") throw new Error("This round has ended. Start a new round.");
    if (uid !== turnUid) throw new Error("It's your partner's turn.");
    if (board[index]) throw new Error("That square is already taken.");
    board[index] = uid === players[0] ? "X" : "O";
    const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    const winnerMark = lines.map(line => line.every(i => board[i] && board[i] === board[line[0]]) ? board[line[0]] : null).find(Boolean) || null;
    const nextStatus = winnerMark ? "finished" : board.every(Boolean) ? "draw" : "playing";
    const nextTurn = players.find(p => p !== uid);
    const winnerUid = winnerMark ? (winnerMark === "X" ? players[0] : players[1]) : null;
    const scores = { ...(old?.scores || {}), [players[0]]: old?.scores?.[players[0]] || 0, [players[1]]: old?.scores?.[players[1]] || 0 };
    if (winnerUid) scores[winnerUid] += 1;
    const draws = (old?.draws || 0) + (nextStatus === "draw" ? 1 : 0);
    tx.set(gameRef, { board, turnUid: nextTurn, status: nextStatus, winnerUid, scores, draws, round: old?.round || 1, updatedAt: serverTimestamp() });
    return { board, turnUid: nextTurn, status: nextStatus, winnerUid, scores, draws };
  });
}
export async function resetTicBoard(memberUids) {
  if (!api) return;
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const gameRef = doc(api.db, "rooms", ROOM_ID, "live", "ticTacToe");
  await runTransaction(api.db, async tx => {
    const snap = await tx.get(gameRef), old = snap.exists() ? snap.data() : {};
    const scores = { ...(old.scores || {}), [memberUids[0]]: old.scores?.[memberUids[0]] || 0, [memberUids[1]]: old.scores?.[memberUids[1]] || 0 };
    tx.set(gameRef, { board: Array(9).fill(""), turnUid: memberUids[0], status: "playing", winnerUid: null, scores, draws: old.draws || 0, round: (old.round || 1) + 1, updatedAt: serverTimestamp() });
  });
}

// Each spin is a single transaction: only the player whose turn it is can publish the
// authoritative category, task and next turn for both connected clients.
export async function commitSpin(uid, memberUids, payload) {
  if (!api) throw new Error("Connect Firebase first.");
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  const spinRef = doc(api.db, "rooms", ROOM_ID, "live", "spin");
  return runTransaction(api.db, async tx => {
    const [matchSnap, spinSnap] = await Promise.all([tx.get(matchRef), tx.get(spinRef)]);
    if (!matchSnap.exists() || matchSnap.data().status !== "playing" || matchSnap.data().game !== "spin") throw new Error("Start a Spin It match in the duo room first.");
    const match = matchSnap.data();
    if (match.turnUid !== uid) throw new Error("It's your partner's turn to spin.");
    if (spinSnap.exists() && spinSnap.data().challenge === payload.challenge) throw new Error("That task just came up. Spin again for a fresh challenge.");
    const nextUid = memberUids.find(id => id !== uid);
    tx.set(spinRef, { ...payload, spinner: uid, targetUid: nextUid, turnUid: uid, completed: false, by: uid, updatedAt: serverTimestamp() });
    tx.update(matchRef, { turnUid: nextUid, updatedAt: serverTimestamp() });
  });
}
export async function finishSpinChallenge(uid, memberUids) {
  if (!api) return;
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const spinRef = doc(api.db, "rooms", ROOM_ID, "live", "spin");
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  await runTransaction(api.db, async tx => {
    const [snap, matchSnap] = await Promise.all([tx.get(spinRef), tx.get(matchRef)]);
    if (!snap.exists() || snap.data().completed) return false;
    const spin = snap.data(), match = matchSnap.exists() ? matchSnap.data() : {};
    if (match.status !== "playing" || match.game !== "spin" || match.turnUid !== uid || spin.targetUid !== uid) throw new Error("Only the player completing the challenge can confirm it.");
    tx.update(spinRef, { completed: true, completedBy: uid, turnUid: spin.spinner, completedAt: serverTimestamp() });
    tx.update(matchRef, { turnUid: spin.spinner, spinPoints: (match.spinPoints || 0) + 1, updatedAt: serverTimestamp() });
    return true;
  });
}

export function subscribeDuoGame(callback, onError = () => {}) {
  if (!api) return () => {};
  const { doc, onSnapshot } = api.storeMod;
  return onSnapshot(doc(api.db, "rooms", ROOM_ID, "live", "duoGame"), snap => callback(snap.exists() ? snap.data() : null), onError);
}
export async function submitDuoAnswer(uid, memberUids, answer) {
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  const gameRef = doc(api.db, "rooms", ROOM_ID, "live", "duoGame");
  return runTransaction(api.db, async tx => {
    const [matchSnap, gameSnap] = await Promise.all([tx.get(matchRef), tx.get(gameRef)]);
    if (!matchSnap.exists() || matchSnap.data().status !== "playing" || !gameSnap.exists()) throw new Error("This match is not active.");
    const match = matchSnap.data(), game = gameSnap.data();
    if (match.game !== game.game || game.status !== "playing") throw new Error("This round has ended.");
    if (game.turnUid !== uid) throw new Error("It's your partner's turn.");
    const answers = [...(game.answers || []), { uid, answer }];
    const nextUid = memberUids.find(id => id !== uid);
    const scores = { ...(game.scores || {}) };
    const correct = game.correctAnswer !== undefined && String(answer).trim().toLowerCase() === String(game.correctAnswer).trim().toLowerCase();
    if (correct) scores[uid] = (scores[uid] || 0) + 1;
    if (answers.length >= 2 && game.correctAnswer === undefined && String(answers[0].answer) === String(answer)) {
      for (const playerUid of memberUids) scores[playerUid] = (scores[playerUid] || 0) + 1;
    }
    tx.update(gameRef, { answers, turnUid: answers.length >= 2 ? uid : nextUid, status: answers.length >= 2 ? "roundOver" : "playing", scores, answeredAt: serverTimestamp() });
  });
}
export async function startNextDuoRound(uid, memberUids, promptData) {
  await requireBothPlayersOnline(memberUids);
  const { doc, runTransaction, serverTimestamp } = api.storeMod;
  const matchRef = doc(api.db, "rooms", ROOM_ID, "live", "match");
  const gameRef = doc(api.db, "rooms", ROOM_ID, "live", "duoGame");
  return runTransaction(api.db, async tx => {
    const [matchSnap, gameSnap] = await Promise.all([tx.get(matchRef), tx.get(gameRef)]);
    if (!matchSnap.exists() || matchSnap.data().status !== "playing" || !gameSnap.exists()) throw new Error("This match is not active.");
    const old = gameSnap.data();
    if (old.status !== "roundOver" || old.game !== matchSnap.data().game) throw new Error("Finish the current round first.");
    const first = memberUids[Number(old.round || 1) % 2];
    tx.set(gameRef, { ...promptData, game: old.game, round: (old.round || 0) + 1, answers: [], scores: old.scores || {}, status: "playing", turnUid: first, updatedAt: serverTimestamp() });
  });
}
