/* =========================================================================
   1) FIREBASE CONFIG — REQUIRED
   -------------------------------------------------------------------------
   Go to https://console.firebase.google.com → create a free project →
   Build → Realtime Database → Create Database (start in test mode) →
   Project settings (gear icon) → General → scroll to "Your apps" →
   add a Web app → copy the config object it gives you and paste it below,
   replacing the placeholder values.
   ========================================================================= */
const firebaseConfig = {
  apiKey: "AIzaSyBfmGbNPGjHXlu3DGaohd9fyfo9gGnxIcs",
  authDomain: "batlar-001.firebaseapp.com",
  databaseURL: "https://batlar-001-default-rtdb.firebaseio.com",
  projectId: "batlar-001",
  appId: "1:724724373404:web:e150c03717e4b36cb35a59"
};

/* =========================================================================
   2) ADMIN PIN — change this before sharing the room with anyone
   -------------------------------------------------------------------------
   This gates the safety panel (room codes, headcounts, timestamps only —
   never message content). It's a simple client-side lock, not real auth:
   anyone who reads this file's source can find it. For real protection,
   pair this with Firebase Security Rules that restrict who can read/write
   the `roomsIndex` path using Firebase Authentication.
   ========================================================================= */
const ADMIN_PIN = "001100"; // Change this. For production, replace client-side PIN auth with Firebase Authentication + Security Rules.

/* ========================================================================= */

const isConfigured = !Object.values(firebaseConfig).some(v => String(v).includes("PASTE YOUR"));

if (!isConfigured) {
  document.getElementById('setup-warning').style.display = 'block';
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('create-room-btn').disabled = true;
    document.getElementById('show-join-btn').disabled = true;
  });
}

let db;
let roomsIndexRef; // active-room metadata only
let archivedRoomsRef;
if (isConfigured) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
  roomsIndexRef = db.ref('roomsIndex');
  archivedRoomsRef = db.ref('archivedRooms');
}

let ROOM_ID = "";
let roomRef, usersRef, messagesRef, presenceRef, typingRef, myTypingRef;
let myName = "";
let myJoinTime = 0;
let myPresenceKey = null;

const startScreen = document.getElementById('start-screen');
const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const createRoomBtn = document.getElementById('create-room-btn');
const showJoinBtn = document.getElementById('show-join-btn');
const joinCodeBox = document.getElementById('join-code-box');
const codeInput = document.getElementById('code-input');
const codeError = document.getElementById('code-error');
const codeContinueBtn = document.getElementById('code-continue-btn');
const roomCodeDisplay = document.getElementById('room-code-display');
const rcdCodeValue = document.getElementById('rcd-code-value');
const backToStart = document.getElementById('back-to-start');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const onlineStrip = document.getElementById('online-strip');
const messagesEl = document.getElementById('messages');
const sendForm = document.getElementById('send-form');
const msgInput = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const roomSub = document.getElementById('room-sub');
const roomCodeHeader = document.getElementById('room-code-header');

function generateRoomCode(){
  return String(Math.floor(10000 + Math.random() * 90000)); // random 5-digit number, 10000–99999
}

// Checks Firebase to see if a room code actually exists and is currently active
// (has an owner who created it and has not been closed / emptied out yet).
function checkRoomActive(roomId){
  if (!isConfigured) return Promise.resolve(false);
  return db.ref('rooms/' + roomId + '/meta/active').once('value')
    .then(snap => snap.val() === true)
    .catch(() => false);
}

function goToJoinScreen(roomId, { generated } = {}){
  ROOM_ID = roomId;
  if (isConfigured){
    roomRef = db.ref('rooms/' + ROOM_ID);
    usersRef = roomRef.child('users');
    messagesRef = roomRef.child('messages');
    typingRef = roomRef.child('typing');
  }
  startScreen.style.display = 'none';
  joinScreen.style.display = 'block';
  if (generated){
    roomCodeDisplay.style.display = 'block';
    rcdCodeValue.textContent = roomId;
  } else {
    roomCodeDisplay.style.display = 'none';
  }
  nameInput.focus();
}

createRoomBtn.addEventListener('click', () => {
  if (!isConfigured) return;
  const code = generateRoomCode();
  // Mark the room active immediately so it becomes a real, joinable room —
  // random codes typed by someone else won't match anything until this happens.
  const createdAt = firebase.database.ServerValue.TIMESTAMP;
  db.ref('rooms/' + code + '/meta').set({ active: true, createdAt });
  // Denormalized metadata-only record for the admin safety panel.
  // Deliberately separate from `rooms/{code}` so the admin view never has to
  // touch (or download) the room's actual messages.
  roomsIndexRef.child(code).set({ active: true, createdAt, userCount: 0, lastActivity: createdAt });
  goToJoinScreen(code, { generated: true });
});

showJoinBtn.addEventListener('click', () => {
  joinCodeBox.style.display = 'block';
  codeInput.focus();
});

codeContinueBtn.addEventListener('click', () => {
  const code = codeInput.value.trim();
  if (!/^\d{5}$/.test(code)){
    codeError.textContent = 'Enter the 5-digit code exactly as shared with you.';
    return;
  }
  codeError.textContent = '';
  codeContinueBtn.disabled = true;
  codeContinueBtn.textContent = 'Checking…';
  checkRoomActive(code).then(active => {
    codeContinueBtn.disabled = false;
    codeContinueBtn.textContent = 'Continue';
    if (!active){
      codeError.textContent = 'This room doesn\'t exist or is no longer active. Ask for a fresh code.';
      return;
    }
    goToJoinScreen(code, { generated: false });
  });
});
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') codeContinueBtn.click(); });

backToStart.addEventListener('click', () => {
  joinScreen.style.display = 'none';
  startScreen.style.display = 'block';
  joinCodeBox.style.display = 'none';
  codeInput.value = '';
  nameInput.value = '';
  joinError.textContent = '';
});

// If the page was opened via a QR code / shared link like ?room=12345, skip straight to name entry —
// but only if that room is actually still active.
(function checkRoomInUrl(){
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam && /^\d{5}$/.test(roomParam)){
    checkRoomActive(roomParam).then(active => {
      if (active){
        goToJoinScreen(roomParam, { generated: false });
      } else {
        codeError.textContent = 'That room link is no longer active — it may have closed after everyone left.';
      }
    });
  }
})();

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function fmtTime(ts){
  const d = new Date(ts);
  return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function addSystemLine(text){
  const line = document.createElement('div');
  line.className = 'system-line';
  line.textContent = text;
  messagesEl.appendChild(line);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addJoinMarker(){
  const marker = document.createElement('div');
  marker.id = 'join-marker';
  marker.textContent = '— you joined here · earlier messages are hidden —';
  messagesEl.appendChild(marker);
}

/* ---------------- Reply state ---------------- */
let replyTarget = null; // { name, text, key }
const replyPreviewBar = document.getElementById('reply-preview-bar');
const rpbName = document.getElementById('rpb-name');
const rpbText = document.getElementById('rpb-text');
const rpbCancel = document.getElementById('rpb-cancel');

function setReplyTarget(target){
  replyTarget = target;
  if (target){
    rpbName.textContent = 'Replying to ' + target.name;
    rpbText.textContent = target.text;
    replyPreviewBar.classList.add('open');
    msgInput.focus();
  } else {
    replyPreviewBar.classList.remove('open');
  }
}
rpbCancel.addEventListener('click', () => setReplyTarget(null));

function renderMessage(msg, key){
  const entry = document.createElement('div');
  entry.className = 'entry' + (msg.name === myName ? ' me' : '');
  if (key) entry.dataset.messageKey = key;
  entry.dataset.name = msg.name;
  entry.dataset.text = msg.text;

  const replyBlock = msg.replyTo
    ? `<div class="reply-quote"><span class="rq-name">${escapeHtml(msg.replyTo.name)}</span><span class="rq-text">${escapeHtml(msg.replyTo.text)}</span></div>`
    : '';

  entry.innerHTML = `
    <div class="swipe-reply-icon">↩</div>
    <div class="rail"></div>
    <div class="bubble-wrap">
      <div class="meta">
        <span class="name">${escapeHtml(msg.name)}</span>
        <span class="time">${fmtTime(msg.timestamp)}</span>
      </div>
      <div class="body">
        ${replyBlock}
        <div class="text">${escapeHtml(msg.text)}</div>
      </div>
    </div>`;
  messagesEl.appendChild(entry);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  attachSwipeToReply(entry);
}

/* ---------------- Swipe-to-reply gesture ---------------- */
const SWIPE_THRESHOLD = 56;   // px drag needed to arm a reply
const SWIPE_MAX = 84;         // px visual cap on how far the bubble drags

function attachSwipeToReply(entry){
  let startX = 0, startY = 0, dx = 0, dragging = false, lockedAxis = null, armed = false;

  function onStart(clientX, clientY){
    startX = clientX; startY = clientY; dx = 0; dragging = true; lockedAxis = null; armed = false;
    entry.classList.add('swiping');
  }
  function onMove(clientX, clientY){
    if (!dragging) return false;
    const rawDx = clientX - startX;
    const rawDy = clientY - startY;
    if (lockedAxis === null){
      if (Math.abs(rawDx) < 6 && Math.abs(rawDy) < 6) return true;
      lockedAxis = Math.abs(rawDx) > Math.abs(rawDy) ? 'x' : 'y';
    }
    if (lockedAxis === 'y') return true; // let vertical scroll happen normally
    // Only allow swiping right-to-left is irrelevant; support swiping either
    // direction in from the edge toward center — but keep it simple: any
    // horizontal drag reveals reply, direction doesn't matter for intent.
    dx = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, rawDx));
    const visualDx = entry.classList.contains('me') ? Math.min(0, dx) : Math.max(0, dx);
    entry.style.transform = `translateX(${visualDx}px)`;
    armed = Math.abs(visualDx) > SWIPE_THRESHOLD;
    entry.classList.toggle('swipe-armed', armed);
    return false; // horizontal gesture in progress, prevent page scroll
  }
  function onEnd(){
    if (!dragging) return;
    dragging = false;
    entry.classList.remove('swiping');
    entry.style.transform = '';
    entry.classList.remove('swipe-armed');
    if (armed){
      setReplyTarget({ name: entry.dataset.name, text: entry.dataset.text, key: entry.dataset.messageKey || '' });
      if (navigator.vibrate) navigator.vibrate(12);
    }
    lockedAxis = null;
  }

  entry.addEventListener('touchstart', e => {
    const t = e.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: true });
  entry.addEventListener('touchmove', e => {
    const t = e.touches[0];
    const allowScroll = onMove(t.clientX, t.clientY);
    if (!allowScroll && e.cancelable) e.preventDefault();
  }, { passive: false });
  entry.addEventListener('touchend', onEnd);
  entry.addEventListener('touchcancel', onEnd);

  // Mouse support so the gesture is also testable on desktop
  entry.addEventListener('mousedown', e => {
    onStart(e.clientX, e.clientY);
    const moveHandler = ev => onMove(ev.clientX, ev.clientY);
    const upHandler = () => {
      onEnd();
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };
    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  });
}

let onlineCount = 0; // how many people this client currently sees in the room
let roomClosedHandled = false;
let mentionMembers = [];
let mentionStart = -1;
let mentionQuery = '';
let mentionSelectedIndex = 0;

function renderOnlineUsers(usersObj){
  const users = Object.values(usersObj || {}).filter(u => u && u.name);
  mentionMembers = users.map(u => String(u.name)).filter((name, i, arr) => arr.indexOf(name) === i);
  const names = mentionMembers;
  onlineCount = names.length;

  onlineStrip.innerHTML = '';
  names.forEach(n => {
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = `<span class="dot" style="animation:none;"></span> ${escapeHtml(n)}`;
    onlineStrip.appendChild(b);
  });

  // If the users list is empty, everyone has left this room — close it for good
  // so the code can no longer be used to join. Whichever client is still around
  // to see this (e.g. the second-to-last person leaving) performs the cleanup.
  if (names.length === 0 && roomRef && myPresenceKey){
    // Keep the room data so Admin can export the complete chat after everyone leaves.
    roomRef.child('meta').update({active:false, closedAt:Date.now()});
    if (roomsIndexRef) roomsIndexRef.child(ROOM_ID).update({active:false, closedAt:Date.now()});
  }
}

function joinRoom(){
  const name = nameInput.value.trim();
  if (!name){
    joinError.textContent = 'Please enter a name.';
    return;
  }
  if (!isConfigured){
    joinError.textContent = 'Firebase is not configured yet — see the setup notice above.';
    return;
  }

  joinBtn.disabled = true;
  joinError.textContent = '';

  // Final, authoritative check right before entry — the room must still be active.
  checkRoomActive(ROOM_ID).then(active => {
    if (!active){
      joinBtn.disabled = false;
      joinError.textContent = 'This room doesn\'t exist or has closed (everyone left). Go back and use a fresh code.';
      return;
    }
    enterRoom(name);
  });
}

function enterRoom(name){
  myName = name;
  myJoinTime = Date.now();

  // Register presence
  presenceRef = usersRef.push();
  myPresenceKey = presenceRef.key;
  presenceRef.set({ name: myName, joinedAt: myJoinTime });
  // Auto-remove this user the moment their connection drops (tab closed, browser closed, network lost)
  presenceRef.onDisconnect().remove();

  // Metadata-only headcount for the admin safety panel — no message content ever touches this.
  if (roomsIndexRef){
    const idxRef = roomsIndexRef.child(ROOM_ID);
    idxRef.update({
      userCount: firebase.database.ServerValue.increment(1),
      lastActivity: firebase.database.ServerValue.TIMESTAMP
    });
    idxRef.child('userCount').onDisconnect().set(firebase.database.ServerValue.increment(-1));
  }

  // Also remove on manual navigation away, as a backup. If this client is the
  // last one left in the room, close the whole room instead of just leaving.
  window.addEventListener('pagehide', () => {
    if (roomsIndexRef) roomsIndexRef.child(ROOM_ID).child('userCount').onDisconnect().cancel();
    if (onlineCount <= 1 && roomRef){
      // Preserve complete chat history for Admin export.
      roomRef.child('meta').update({active:false, closedAt:Date.now()});
      if (roomsIndexRef) roomsIndexRef.child(ROOM_ID).update({active:false, closedAt:Date.now()});
    } else {
      presenceRef.remove();
      if (roomsIndexRef){
        roomsIndexRef.child(ROOM_ID).update({
          userCount: firebase.database.ServerValue.increment(-1),
          lastActivity: firebase.database.ServerValue.TIMESTAMP
        });
      }
    }
  });

  // Watch online users list
  usersRef.on('value', snap => renderOnlineUsers(snap.val()));

  // Watch whether the room itself is still active — if another tab/device closes it
  // (last person left there), reflect that here too.
  roomRef.child('meta/active').on('value', snap => {
    if (snap.val() !== true && !roomClosedHandled){
      roomClosedHandled = true;
      addSystemLine('This room has closed — everyone has left.');
      msgInput.disabled = true;
      sendBtn.disabled = true;
      roomSub.textContent = 'room closed';
    }
  });

  // Typing presence — my own typing flag, auto-removed on disconnect
  myTypingRef = typingRef.child(myPresenceKey);
  myTypingRef.set(null); // start as not-typing
  myTypingRef.onDisconnect().remove();

  // Watch everyone else's typing state
  typingRef.on('value', snap => renderTypingIndicator(snap.val()));

  // Show chat screen
  joinScreen.style.display = 'none';
  document.getElementById('setup-warning').style.display = 'none';
  chatScreen.style.display = 'flex';
  roomSub.textContent = 'joined as ' + myName;
  roomCodeHeader.textContent = ROOM_ID;

  addJoinMarker();
  addSystemLine('You joined the room. Watching for new messages only.');

  // Only listen to messages with timestamp >= the moment I joined — no history
  messagesRef.orderByChild('timestamp').startAt(myJoinTime).on('child_added', snap => {
    renderMessage(snap.val(), snap.key);
  });

  msgInput.focus();
}

/* ---------------- @ Mention suggestions ---------------- */
const mentionBox = document.getElementById('mention-suggestions');

function getMentionContext(){
  const value = msgInput.value;
  const cursor = msgInput.selectionStart || 0;
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(^|\s)@([\w.-]*)$/);
  if(!match) return null;
  return { start: cursor - match[2].length - 1, query: match[2], cursor };
}

function closeMentionSuggestions(){
  mentionBox.classList.remove('open');
  mentionBox.innerHTML = '';
  mentionStart = -1;
  mentionQuery = '';
  mentionSelectedIndex = 0;
}

function initials(name){
  return name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase() || '?';
}

function showMentionSuggestions(){
  const ctx = getMentionContext();
  if(!ctx){ closeMentionSuggestions(); return; }
  mentionStart = ctx.start;
  mentionQuery = ctx.query;
  const q = ctx.query.toLowerCase();
  const matches = mentionMembers.filter(name => name.toLowerCase().includes(q)).slice(0,12);
  mentionSelectedIndex = 0;
  mentionBox.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'mention-header';
  header.textContent = q ? 'Members matching @' + ctx.query : 'Members';
  mentionBox.appendChild(header);
  if(!matches.length){
    const empty = document.createElement('div');
    empty.className = 'mention-empty';
    empty.textContent = 'No matching members';
    mentionBox.appendChild(empty);
    mentionBox.classList.add('open');
    return;
  }
  matches.forEach((name,index)=>{
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mention-item' + (index === 0 ? ' active' : '');
    item.setAttribute('role','option');
    item.dataset.name = name;
    const avatar = document.createElement('span');
    avatar.className = 'mention-avatar';
    avatar.textContent = initials(name);
    const info = document.createElement('span');
    const nameEl = document.createElement('span');
    nameEl.className = 'mention-name';
    nameEl.textContent = name;
    const status = document.createElement('span');
    status.className = 'mention-status';
    status.textContent = 'Online';
    info.append(nameEl,status);
    item.append(avatar,info);
    item.addEventListener('mousedown', e => { e.preventDefault(); selectMention(name); });
    mentionBox.appendChild(item);
  });
  mentionBox.classList.add('open');
}

function refreshMentionActive(){
  mentionBox.querySelectorAll('.mention-item').forEach((el,i)=>el.classList.toggle('active',i===mentionSelectedIndex));
  const active = mentionBox.querySelectorAll('.mention-item')[mentionSelectedIndex];
  if(active) active.scrollIntoView({block:'nearest'});
}

function selectMention(name){
  if(mentionStart < 0) return;
  const cursor = msgInput.selectionStart || 0;
  const value = msgInput.value;
  const replacement = '@' + name + ' ';
  msgInput.value = value.slice(0, mentionStart) + replacement + value.slice(cursor);
  const newPos = mentionStart + replacement.length;
  msgInput.focus();
  msgInput.setSelectionRange(newPos,newPos);
  closeMentionSuggestions();
  autoGrowMessageBox();
}

function autoGrowMessageBox(){
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight,120) + 'px';
}

msgInput.addEventListener('input', () => {
  autoGrowMessageBox();
  showMentionSuggestions();
});

msgInput.addEventListener('keydown', e => {
  if(!mentionBox.classList.contains('open')){
    if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); sendForm.requestSubmit(); }
    return;
  }
  const items = mentionBox.querySelectorAll('.mention-item');
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    if(items.length){ mentionSelectedIndex = (mentionSelectedIndex + 1) % items.length; refreshMentionActive(); }
  }else if(e.key === 'ArrowUp'){
    e.preventDefault();
    if(items.length){ mentionSelectedIndex = (mentionSelectedIndex - 1 + items.length) % items.length; refreshMentionActive(); }
  }else if(e.key === 'Enter' && !e.shiftKey){
    if(items.length){
      e.preventDefault();
      selectMention(items[mentionSelectedIndex].dataset.name);
    }else{
      closeMentionSuggestions();
      e.preventDefault();
      sendForm.requestSubmit();
    }
  }else if(e.key === 'Escape'){
    e.preventDefault(); closeMentionSuggestions();
  }
});

msgInput.addEventListener('blur', () => setTimeout(closeMentionSuggestions, 120));

function sendMessage(e){
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;
  const payload = {
    name: myName,
    text: text,
    timestamp: Date.now()
  };
  if (replyTarget){
    payload.replyTo = { name: replyTarget.name, text: replyTarget.text };
  }
  messagesRef.push(payload);
  msgInput.value = '';
  autoGrowMessageBox();
  closeMentionSuggestions();
  setReplyTarget(null);
  if (myTypingRef) myTypingRef.set(null);
  clearTimeout(typingStopTimer);
}

/* ---------------- Typing indicator ---------------- */
const typingIndicatorEl = document.getElementById('typing-indicator');
let typingStopTimer = null;

function renderTypingIndicator(typingObj){
  const names = Object.values(typingObj || {})
    .map(t => t && t.name)
    .filter(n => n && n !== myName);

  if (names.length === 0){
    typingIndicatorEl.classList.add('hidden');
    typingIndicatorEl.innerHTML = '';
    return;
  }

  let label;
  if (names.length === 1) label = `${escapeHtml(names[0])} is typing`;
  else if (names.length === 2) label = `${escapeHtml(names[0])} and ${escapeHtml(names[1])} are typing`;
  else label = `${names.length} people are typing`;

  typingIndicatorEl.classList.remove('hidden');
  typingIndicatorEl.innerHTML = `${label} <span class="typing-dots"><span></span><span></span><span></span></span>`;
}

msgInput.addEventListener('input', () => {
  if (!myTypingRef) return;
  if (msgInput.value.trim().length > 0){
    myTypingRef.set({ name: myName, at: Date.now() });
  } else {
    myTypingRef.set(null);
  }
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => {
    if (myTypingRef) myTypingRef.set(null);
  }, 3000); // stop showing "typing" after 3s of inactivity
});

joinBtn.addEventListener('click', joinRoom);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });
sendForm.addEventListener('submit', sendMessage);

/* ---------------- Emoji picker ---------------- */
const emojiBtn = document.getElementById('emoji-btn');
const emojiPanel = document.getElementById('emoji-panel');

const EMOJI_LIST = [
  "😀","😂","🤣","😊","😍","😘","😉","😎","🤔","😅",
  "😢","😭","😡","😱","🥳","😴","🙄","😇","🤗","🤩",
  "👍","👎","👏","🙏","💪","🤝","👋","✌️","🤞","👌",
  "❤️","💔","🔥","✨","🎉","💯","⭐","🌟","💥","👀",
  "🙈","🤦","🤷","💀","👻","🎶","☕","🍕","🎂","🥂"
];

EMOJI_LIST.forEach(emo => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'emoji-item';
  b.textContent = emo;
  b.addEventListener('click', () => {
    msgInput.value += emo;
    msgInput.focus();
    autoGrowMessageBox();
  });
  emojiPanel.appendChild(b);
});

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('open');
});

document.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target !== emojiBtn){
    emojiPanel.classList.remove('open');
  }
});

/* ---------------- QR code ---------------- */
const qrBtn = document.getElementById('qr-btn');
const qrOverlay = document.getElementById('qr-overlay');
const qrClose = document.getElementById('qr-close');
const qrBox = document.getElementById('qr-code-box');
let qrGenerated = false;

const qrRoomCodeLabel = document.getElementById('qr-room-code');

qrBtn.addEventListener('click', () => {
  qrOverlay.style.display = 'flex';
  qrRoomCodeLabel.textContent = ROOM_ID;
  const shareUrl = window.location.origin + window.location.pathname + '?room=' + ROOM_ID;
  if (!qrGenerated){
    new QRCode(qrBox, {
      text: shareUrl,
      width: 200,
      height: 200,
      colorDark: "#0F1B1E",
      colorLight: "#ffffff"
    });
    qrGenerated = true;
  }
});
qrClose.addEventListener('click', () => { qrOverlay.style.display = 'none'; });
qrOverlay.addEventListener('click', (e) => { if (e.target === qrOverlay) qrOverlay.style.display = 'none'; });

/* ---------------- BATLAR Security Console ---------------- */
const adminLink = document.getElementById('admin-link');
const adminOverlay = document.getElementById('admin-overlay');
const adminPinBox = document.getElementById('admin-pin-box');
const adminPanelBox = document.getElementById('admin-panel-box');
const adminPinInput = document.getElementById('admin-pin-input');
const adminPinError = document.getElementById('admin-pin-error');
const adminPinContinue = document.getElementById('admin-pin-continue');
const adminCloseIcon = document.getElementById('admin-close-pin');
const adminClose = document.getElementById('admin-close');
const adminRoomsList = document.getElementById('admin-rooms-list');
const adminEmptyNote = document.getElementById('admin-empty-note');
const adminRoomCount = document.getElementById('admin-room-count');
const adminUserCount = document.getElementById('admin-user-count');
const adminArchiveCount = document.getElementById('admin-archive-count');
const monitorRoomCode = document.getElementById('monitor-room-code');
const monitorMeta = document.getElementById('monitor-meta');
const monitorUsers = document.getElementById('monitor-users');
const monitorUserCount = document.getElementById('monitor-user-count');
const monitorMessages = document.getElementById('monitor-messages');
const monitorRefresh = document.getElementById('monitor-refresh');
const monitorCloseRoom = document.getElementById('monitor-close-room');
const monitorExportPdf = document.getElementById('monitor-export-pdf');
let adminUnlocked = false;
let adminRoomsCache = {};
let adminArchivedCache = {};
let adminSelectedRoom = '';
let adminMessagesRef = null;
let adminUsersRef = null;
let adminMessagesHandler = null;
let adminUsersHandler = null;

function openAdminOverlay(){
  adminOverlay.style.display='flex';
  if(adminUnlocked) showAdminPanel();
  else { adminPinBox.style.display='block'; adminPanelBox.style.display='none'; adminPinInput.value=''; adminPinError.textContent=''; setTimeout(()=>adminPinInput.focus(),50); }
}
function stopAdminMonitor(){
  if(adminMessagesRef && adminMessagesHandler) adminMessagesRef.off('child_added',adminMessagesHandler);
  if(adminUsersRef && adminUsersHandler) adminUsersRef.off('value',adminUsersHandler);
  adminMessagesRef=null; adminUsersRef=null; adminMessagesHandler=null; adminUsersHandler=null;
}
function closeAdminOverlay(){
  stopAdminMonitor();
  if(roomsIndexRef) roomsIndexRef.off('value',renderAdminRooms);
  if(archivedRoomsRef) archivedRoomsRef.off('value',renderAdminRooms);
  adminOverlay.style.display='none';
  adminSelectedRoom='';
  adminPinError.textContent='';
}
adminLink.addEventListener('click',openAdminOverlay);
adminCloseIcon.addEventListener('click',closeAdminOverlay);
adminClose.addEventListener('click',closeAdminOverlay);
adminOverlay.addEventListener('click',e=>{if(e.target===adminOverlay)closeAdminOverlay()});
document.addEventListener('keydown',e=>{if(e.key==='Escape' && adminOverlay.style.display==='flex')closeAdminOverlay();});
adminPinContinue.addEventListener('click',()=>{
  if(adminPinInput.value.trim()===ADMIN_PIN){ adminUnlocked=true; adminPinError.textContent=''; showAdminPanel(); }
  else adminPinError.textContent='Incorrect administrator PIN.';
});
adminPinInput.addEventListener('keydown',e=>{if(e.key==='Enter')adminPinContinue.click()});
monitorRefresh.addEventListener('click',()=>{ if(adminSelectedRoom){ const archived=!!adminArchivedCache[adminSelectedRoom]; selectAdminRoom(adminSelectedRoom,archived); } else showAdminPanel(); });
monitorExportPdf.addEventListener('click',exportSelectedRoomPDF);
monitorCloseRoom.addEventListener('click',()=>closeMonitoredRoom());

function showAdminPanel(){
  adminPinBox.style.display='none'; adminPanelBox.style.display='flex';
  if(!isConfigured || !roomsIndexRef){adminRoomsList.innerHTML='';adminEmptyNote.style.display='block';adminEmptyNote.textContent='Firebase is not configured.';return;}
  roomsIndexRef.off('value',renderAdminRooms);
  archivedRoomsRef.off('value',renderAdminRooms);
  roomsIndexRef.on('value',renderAdminRooms);
  archivedRoomsRef.on('value',renderAdminRooms);
}
function fmtAdminTime(ts){if(!ts)return '—';return new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});}
function renderAdminRooms(snap){
  // This handler is attached to both active and archived refs.
  const path = snap.ref ? snap.ref.key : '';
  if(path === 'archivedRooms') adminArchivedCache = snap.val() || {};
  else adminRoomsCache = snap.val() || {};

  const activeRooms = Object.entries(adminRoomsCache)
    .filter(([,v])=>v&&v.active)
    .sort((a,b)=>(b[1].lastActivity||0)-(a[1].lastActivity||0));

  const closedRooms = Object.entries(adminRoomsCache)
    .filter(([,v])=>v && v.active === false)
    .sort((a,b)=>(b[1].closedAt||b[1].lastActivity||0)-(a[1].closedAt||a[1].lastActivity||0));

  const archivedRooms = Object.entries(adminArchivedCache)
    .filter(([,v])=>v)
    .sort((a,b)=>(b[1].closedAt||b[1].lastActivity||0)-(a[1].closedAt||a[1].lastActivity||0));

  adminRoomCount.textContent = activeRooms.length;
  adminArchiveCount.textContent = closedRooms.length + archivedRooms.length;
  adminUserCount.textContent = activeRooms.reduce((sum,[,v])=>sum+Math.max(0,Number(v.userCount)||0),0);
  adminRoomsList.innerHTML='';

  if(!activeRooms.length && !closedRooms.length && !archivedRooms.length){
    adminEmptyNote.style.display='block';
    adminEmptyNote.textContent='No active or archived rooms right now.';
    clearAdminMonitor();
    return;
  }

  adminEmptyNote.style.display='none';

  activeRooms.forEach(([code,meta])=>{
    const count=Math.max(0,Number(meta.userCount)||0);
    const card=document.createElement('div');
    card.className='admin-room-card'+(code===adminSelectedRoom?' selected':'');
    card.dataset.code=code;
    card.dataset.archived='false';
    card.innerHTML=`<div class="arc-left"><div class="arc-code">ROOM ${escapeHtml(code)}</div><div class="arc-meta">${count} ${count===1?'user':'users'} · Created ${fmtAdminTime(meta.createdAt)}<br>Last activity ${fmtAdminTime(meta.lastActivity)}</div></div><div class="arc-actions"><span class="arc-live">● LIVE</span><button class="arc-close-btn" type="button">Close</button></div>`;
    card.addEventListener('click',e=>{if(e.target.closest('.arc-close-btn'))return;selectAdminRoom(code,false)});
    card.querySelector('.arc-close-btn').addEventListener('click',e=>{e.stopPropagation();closeRoomByCode(code)});
    adminRoomsList.appendChild(card);
  });

  closedRooms.forEach(([code,meta])=>{
    const card=document.createElement('div');
    card.className='admin-room-card'+(code===adminSelectedRoom?' selected':'');
    card.dataset.code=code;
    card.dataset.archived='false';
    card.dataset.closed='true';
    card.innerHTML=`<div class="arc-left"><div class="arc-code">CLOSED ${escapeHtml(code)}</div><div class="arc-meta">Chat preserved · Closed ${fmtAdminTime(meta.closedAt||meta.lastActivity)}</div></div><div class="arc-actions"><span style="font-size:8px;color:#f9ab00;font-weight:700;letter-spacing:.5px">● CLOSED</span></div>`;
    card.addEventListener('click',()=>selectAdminRoom(code,false));
    adminRoomsList.appendChild(card);
  });

  archivedRooms.forEach(([code,meta])=>{
    const card=document.createElement('div');
    card.className='admin-room-card'+(code===adminSelectedRoom?' selected':'');
    card.dataset.code=code;
    card.dataset.archived='true';
    card.innerHTML=`<div class="arc-left"><div class="arc-code">ARCHIVE ${escapeHtml(code)}</div><div class="arc-meta">${Number(meta.messageCount)||0} messages · Closed ${fmtAdminTime(meta.closedAt||meta.lastActivity)}</div></div><div class="arc-actions"><span style="font-size:8px;color:#f9ab00;font-weight:700;letter-spacing:.5px">● ARCHIVED</span></div>`;
    card.addEventListener('click',()=>selectAdminRoom(code,true));
    adminRoomsList.appendChild(card);
  });

  if(adminSelectedRoom){
    const exists = !!adminRoomsCache[adminSelectedRoom] || !!adminArchivedCache[adminSelectedRoom];
    if(!exists) clearAdminMonitor();
  }
}

function clearAdminMonitor(){stopAdminMonitor();adminSelectedRoom='';monitorRoomCode.textContent='—';monitorMeta.textContent='Select an active room from the left.';monitorUsers.innerHTML='';if(monitorUserCount) monitorUserCount.textContent='0';monitorMessages.innerHTML='<div class="monitor-empty">No room selected.<br>Choose an active room to begin monitoring.</div>';monitorCloseRoom.style.display='none';monitorExportPdf.style.display='none';}
function selectAdminRoom(code,isArchived=false){
  if(!adminUnlocked || !isConfigured || !db) return;

  stopAdminMonitor();
  adminSelectedRoom=code;

  const meta = isArchived ? adminArchivedCache[code] : adminRoomsCache[code];
  if(!meta) return;

  monitorRoomCode.textContent=code;
  monitorExportPdf.style.display='inline-block';
  monitorCloseRoom.style.display=isArchived?'none':'inline-block';

  if(isArchived){
    monitorMeta.textContent=`${Number(meta.messageCount)||0} messages · Closed ${fmtAdminTime(meta.closedAt||meta.lastActivity)} · ARCHIVED · READ-ONLY`;
    monitorUsers.innerHTML='<span class="monitor-user">Archived room</span>'; if(monitorUserCount) monitorUserCount.textContent='—';
    monitorMessages.innerHTML='';

    const archivedMessagesRef=db.ref('archivedRooms/'+code+'/messages');
    adminMessagesRef=archivedMessagesRef;
    adminMessagesHandler=snap=>appendMonitorMessage(snap.key,snap.val());
    archivedMessagesRef.orderByChild('timestamp').on('child_added',adminMessagesHandler);
  } else {
    monitorMeta.textContent=`${Math.max(0,Number(meta.userCount)||0)} online · Created ${fmtAdminTime(meta.createdAt)} · Last activity ${fmtAdminTime(meta.lastActivity)} · READ-ONLY`;
    monitorMessages.innerHTML='';

    const room=db.ref('rooms/'+code);
    adminUsersRef=room.child('users');
    adminMessagesRef=room.child('messages');
    adminUsersHandler=snap=>renderMonitorUsers(snap.val());
    adminUsersRef.on('value',adminUsersHandler);
    adminMessagesHandler=snap=>appendMonitorMessage(snap.key,snap.val());
    adminMessagesRef.orderByChild('timestamp').on('child_added',adminMessagesHandler);
  }

  adminRoomsList.querySelectorAll('.admin-room-card').forEach(c=>c.classList.toggle('selected',c.dataset.code===code));
}

function renderMonitorUsers(usersObj){
  const users=Object.values(usersObj||{}); monitorUsers.innerHTML=''; if(monitorUserCount) monitorUserCount.textContent=users.length;
  if(!users.length){monitorUsers.innerHTML='<span class="monitor-user">No users currently connected</span>';return;}
  users.forEach(u=>{const el=document.createElement('span');el.className='monitor-user';el.textContent='● '+(u.name||'Unknown');monitorUsers.appendChild(el)});
}
function appendMonitorMessage(key,msg){
  if(!msg || !adminSelectedRoom)return;
  if(monitorMessages.querySelector('[data-message-id="'+CSS.escape(key)+'"]'))return;
  const empty=monitorMessages.querySelector('.monitor-empty');if(empty)empty.remove();
  const row=document.createElement('div');row.className='monitor-message';row.dataset.messageId=key;
  const name=document.createElement('div');name.className='mm-name';name.textContent=msg.name||'Unknown';
  const text=document.createElement('div');text.className='mm-text';text.textContent=(msg.replyTo?('↩ '+msg.replyTo.name+': '+msg.replyTo.text+'\n'):'')+(msg.text||'');
  const time=document.createElement('div');time.className='mm-time';time.textContent=fmtTime(msg.timestamp);
  row.append(name,text,time);monitorMessages.appendChild(row);monitorMessages.scrollTop=monitorMessages.scrollHeight;
}
async function closeRoomByCode(code){
  if(!adminUnlocked || !db || !roomsIndexRef) return;

  if(!confirm('Close room '+code+'? The complete chat will be archived first, then participants will be disconnected.')) return;

  try{
    const roomRefToArchive=db.ref('rooms/'+code);
    const snapshot=await roomRefToArchive.once('value');
    const roomData=snapshot.val();

    if(!roomData){
      await roomsIndexRef.child(code).remove();
      return;
    }

    const messages=roomData.messages || {};
    const messageCount=Object.keys(messages).length;
    const closedAt=Date.now();

    // Preserve the complete room before deleting the live room.
    await db.ref('archivedRooms/'+code).set({
      meta: Object.assign({}, roomData.meta || {}, {
        active:false,
        closedAt:closedAt,
        messageCount:messageCount
      }),
      messages:messages,
      closedAt:closedAt,
      messageCount:messageCount
    });

    await roomRefToArchive.remove();
    await roomsIndexRef.child(code).remove();

    if(adminSelectedRoom===code) selectAdminRoom(code,true);

  }catch(err){
    console.error(err);
    alert('Unable to archive/close room: '+err.message);
  }
}

async function exportSelectedRoomPDF(){
  if(!adminUnlocked){ alert('Administrator authentication required.'); return; }
  if(!adminSelectedRoom){ alert('Please select a chat room first.'); return; }
  if(!db){ alert('Firebase is not configured.'); return; }

  const btn=monitorExportPdf;
  try{
    btn.disabled=true;
    btn.textContent='Generating...';

    let snapshot;
    let archived=!!adminArchivedCache[adminSelectedRoom];

    if(archived){
      snapshot=await db.ref('archivedRooms/'+adminSelectedRoom+'/messages').orderByChild('timestamp').once('value');
    }else{
      snapshot=await db.ref('rooms/'+adminSelectedRoom+'/messages').orderByChild('timestamp').once('value');
    }

    const messages=[];
    snapshot.forEach(child=>{
      const msg=child.val();
      if(msg) messages.push({
        name:msg.name||'Unknown',
        text:(msg.replyTo?('[Reply to '+msg.replyTo.name+': "'+msg.replyTo.text+'"] '):'')+(msg.text||''),
        timestamp:Number(msg.timestamp)||0
      });
    });

    messages.sort((a,b)=>a.timestamp-b.timestamp);

    if(!messages.length){ alert('No messages found in this chat room.'); return; }
    if(!window.jspdf || !window.jspdf.jsPDF){ alert('PDF library is not loaded. Check your internet connection.'); return; }

    const {jsPDF}=window.jspdf;
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const pageWidth=pdf.internal.pageSize.getWidth();
    const pageHeight=pdf.internal.pageSize.getHeight();
    const ml=15, mr=15, mt=20, mb=18;
    const usableWidth=pageWidth-ml-mr;
    let y=mt;

    pdf.setFont('helvetica','bold');
    pdf.setFontSize(18);
    pdf.setTextColor(25,40,60);
    pdf.text('BATLAR PRIVATE CHAT',ml,y);
    y+=8;

    pdf.setFont('helvetica','normal');
    pdf.setFontSize(10);
    pdf.setTextColor(70,80,90);
    pdf.text('Chat Code: '+adminSelectedRoom,ml,y); y+=5;
    pdf.text('Status: '+(archived?'ARCHIVED':'ACTIVE'),ml,y); y+=5;
    pdf.text('Exported: '+formatPdfDateTime(new Date()),ml,y); y+=5;
    pdf.text('Total Messages: '+messages.length,ml,y); y+=7;

    pdf.setDrawColor(170,180,190);
    pdf.line(ml,y,pageWidth-mr,y);
    y+=8;

    messages.forEach(msg=>{
      const sender=msg.name||'Unknown';
      const time=msg.timestamp?formatPdfDateTime(new Date(msg.timestamp)):'Unknown time';
      const lines=pdf.splitTextToSize(msg.text||'',usableWidth);
      const lineHeight=4.5;
      const required=(lines.length*lineHeight)+13;

      if(y+required>pageHeight-mb){
        pdf.addPage();
        y=mt;
        pdf.setFont('helvetica','bold');
        pdf.setFontSize(11);
        pdf.setTextColor(25,40,60);
        pdf.text('BATLAR PRIVATE CHAT — '+adminSelectedRoom,ml,y);
        y+=9;
      }

      pdf.setFont('helvetica','bold');
      pdf.setFontSize(10);
      pdf.setTextColor(35,55,80);
      pdf.text(sender+'  •  '+time,ml,y);
      y+=5;

      pdf.setFont('helvetica','normal');
      pdf.setFontSize(10);
      pdf.setTextColor(35,35,35);
      pdf.text(lines,ml,y);
      y+=lines.length*lineHeight+4;

      pdf.setDrawColor(225,228,232);
      pdf.line(ml,y,pageWidth-mr,y);
      y+=5;
    });

    const totalPages=pdf.internal.getNumberOfPages();
    for(let page=1;page<=totalPages;page++){
      pdf.setPage(page);
      pdf.setFont('helvetica','normal');
      pdf.setFontSize(8);
      pdf.setTextColor(120,120,120);
      pdf.text('BATLAR Security Console • Confidential',ml,pageHeight-8);
      pdf.text('Page '+page+' of '+totalPages,pageWidth-mr-25,pageHeight-8);
    }

    const fileName=adminSelectedRoom+'_'+formatPdfFileDateTime(new Date())+'.pdf';
    pdf.save(fileName);
  }catch(error){
    console.error('PDF Export Error:',error);
    alert('Unable to export chat PDF.\n\n'+error.message);
  }finally{
    btn.disabled=false;
    btn.textContent='↓ Export PDF';
  }
}

function formatPdfDateTime(date){
  const day=String(date.getDate()).padStart(2,'0');
  const month=date.toLocaleString('en-US',{month:'short'});
  const year=date.getFullYear();
  const hours=String(date.getHours()).padStart(2,'0');
  const minutes=String(date.getMinutes()).padStart(2,'0');
  const seconds=String(date.getSeconds()).padStart(2,'0');
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

function formatPdfFileDateTime(date){
  const day=String(date.getDate()).padStart(2,'0');
  const month=String(date.getMonth()+1).padStart(2,'0');
  const year=date.getFullYear();
  const hours=String(date.getHours()).padStart(2,'0');
  const minutes=String(date.getMinutes()).padStart(2,'0');
  const seconds=String(date.getSeconds()).padStart(2,'0');
  return `${day}-${month}-${year}_${hours}-${minutes}-${seconds}`;
}

function closeMonitoredRoom(){if(adminSelectedRoom)closeRoomByCode(adminSelectedRoom)}
