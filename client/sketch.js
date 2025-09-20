import { 
  registerPlayer,
  updateDisplayName,
  postScore,
  fetchTopScores,
 } from "./api.js";

let player = { id: null, name: "player" };
let score = 0;        // 自分のスコア
let top10 = [];       // ランキング

const $ = (sel) => document.querySelector(sel);

let socket;
let keys = { w:false, a:false, s:false, d:false };
let arena = { width: 640, height: 360 };
let snapshots = [] // [{sid, name, x, y}, ...]　※自分含む

// --------- UI配線 & DOMレンダリング ----------
function wireUI() {
  const nameInput = $("#displayNameInput");
  const whoami = $("#whoami");
  const status = $("#status");
  const form = $("#nameForm");
  const logoutBtn = $("#logoutBtn");

  // 初期表示
  nameInput.value = player.name;
  whoami.textContent = `You are: ${player.name} (${player.id.slice(0, 5)}…)`;

  form.addEventListener("submit", async(e) => {
    e.preventDefault();
    const newName = nameInput.value.trim();
    if (!newName) { status.textContent = "Name cannot be empty."; return;}
    if (newName.length > 20) {
      status.textContent = "Name too long. Maximum lenght is 20 characters.";
      return;
    }

    // サーバー更新　→　localStorage反映
    try {
      await updateDisplayName(player.id, newName);
      player.name = newName;
      localStorage.setItem("display_name", player.name);
      whoami.textContent = `You are: ${player.name} (${player.id.slice(0, 5)}…)`;
      status.textContent = "Saved";
      setTimeout(() => (status.textContent = ""), 1200);
    } catch (err) {
      status.textContent = "Failed to save name";
      console.log(err);
    }
  });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("player_id");
    localStorage.removeItem("display_name");
    status.textContent = "Cleared local account. Reloading...";
    setTimeout(() => location.reload(), 300);
  });
}

// --------- プレイヤー存在確認 ----------
async function ensurePlayer(){
  // localStorage からロード
  const savedId = localStorage.getItem("player_id");
  const savedName = localStorage.getItem("display_name");
  // 登録済み
  if (savedId && savedName) {
    player.id = savedId;
    player.name = savedName;
    return;
  }
  // 未登録　→　初期名で登録（UIから変更可能）
  const data = await registerPlayer("player");
  player.id = data.player_id;
  player.name = data.display_name;
  localStorage.setItem("player_id", player.id);
  localStorage.setItem("display_name", player.name);
}

// --------- ランキング取得・表示 ----------
function renderTopList() {
  const ul = $("#topList");
  ul.innerHTML = "";
  top10.forEach((row, i) => {
    const li = document.createElement("li");
    const when = new Date(row.created_at).toLocaleTimeString();
    li.textContent = `${i + 1}.${row.display_name} - ${row.score} (${when})`;
    ul.appendChild(li);
  });
}

async function refreshTop() {
  try {
    top10 = await fetchTopScores(10);
    renderTopList();
  } catch (e) {
    console.log(e);
  }
}

// --------- リアルタイム部分 ----------
function connectRealtime() {
  socket = io("/", { transports: ["websocket"] }); // 同一オリジン
  socket.on("connect", () => {
    const room = (location.hash && location.hash.slice(1)) || "lobby";
    socket.emit("join", { player_id: player.id, display_name: player.name, room });
  });

  socket.on("state", (payload) => {
    arena = payload.arena;
    snapshots = payload.players; // [{sid,name,x,y}]
  });

  // 入力の送信を　20Hz にスロットル
  // setInterval(() => {
  //   if (socket && socket.connected) socket.emit("input", keys);
  // }, 50);
  let lastKeys = {...keys};
  setInterval(() => {
    const changed = ["w","a","s","d"].some(k => keys[k] !== lastKeys[k]);
    if (changed && socket?.connected) socket.emit("input", keys);
    lastKeys = {...keys};
  }, 50);
}

// --------- p5.js ----------
let p5canvas;
window.setup = async function () {
  p5canvas = createCanvas(640, 360); 
  p5canvas.parent("canvas-wrap"); // キャンバスを DOM の #canvas-wrap 配下に付ける
  
  textFont("monospace");
  await ensurePlayer();
  wireUI();
  await refreshTop();
  connectRealtime();

  // グローバルでキーを拾う（入力欄フォーカス時は無視）
  window.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;
    applyKeyFromEvent(e, true);
  }, { capture: true });

  window.addEventListener("keyup", (e) => {
    if (isTypingTarget(e.target)) return;
    applyKeyFromEvent(e, false);
  }, { capture: true });

  // キャンバスをクリックしたらフォーカスを奪って入力に干渉しにくくする
  document.getElementById("canvas-wrap")?.addEventListener("mousedown", () => {
    document.activeElement instanceof HTMLElement && document.activeElement.blur();
  });
};

window.draw = function () {
  background(32);

  // プレイヤー描画
  // 自分も含め、snapshots の全員を描画（socket.id 区別はサーバー側 sid で）
  for (const p of snapshots) {
    const isMe = false; // sid と socket.id を比較したい場合は別途送る
    push();
    rectMode(CENTER);
    stroke(255);
    fill( isMe ? 200 : 120, 200, 255, 180 );
    rect(p.x, p.y, 20, 20, 3);
    noStroke();
    fill(240);
    textSize(12);
    textAlign(CENTER, TOP);
    text(p.name, p.x, p.y + 14);
    pop();
  }

  // 自分のスコア
  fill(255);
  textSize(16);
  text(`score: ${score}`, 12, 24);

  // DEBUG
  push();
  textSize(12); fill(180);
  text(`keys: ${JSON.stringify(keys)} `, 12, height - 28);
  const me = snapshots.find(p => p.sid === (socket?.id));
  if (me) text(`me: x=${me.x.toFixed(1)}, y=${me.y.toFixed(1)}`, 12, height - 12);
  pop();
};


// 入力欄にフォーカスがあるときはゲーム入力を無視
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

// e.key を wasd に正規化して keys を更新
function applyKeyFromEvent(e, down) {
  let k = e.key;
  if (typeof k != "string") return;

  // 矢印キー -> WASD にマッピング
  const map = { ArrowUp: "w", ArrowLeft: "a", ArrowDown: "s", ArrowRight: "d" };
  k = (map[k] || k).toLowerCase();

  if (["w", "a", "s", "d"].includes(k)) {
    keys[k] = down;
    e.preventDefault(); // スクロール等を禁止
  }

  // SPACE でスコア+1
  if (down && e.code === "Space") {
    score++;
    e.preventDefault();
  }
  if (down && (k === "s") && !["input", "textarea"].includes(e.target.tagName?.toLowerCase())) {
    postScore(player.id, score).then(refreshTop).catch(()=>{});
    e.preventDefault();
  }
}

// もう使わない（重複発火防止のため）
window.keyPressed = undefined;
window.keyReleased = undefined;
