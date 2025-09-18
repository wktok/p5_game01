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
    if (newName.lenght > 20) {
      status.textContent = "Name too long. Maximum lenght is 20 characters.";
      return;
    }

    // サーバー更新　→　localStorage反映
    try {
      await updateDisplayName(player.id, newName);
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
  const initialName = savedName || "player";
  const data = await registerPlayer(initialName);
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
    const when = new Date(row.create_at).toLocaleTimeString();
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

// --------- p5.js ----------
let p5canvas;
window.setup = async function () {
  p5canvas = createCanvas(640, 360); 
  p5canvas.parent("canvas-wrap"); // キャンバスを DOM の #canvas-wrap 配下に付ける
  
  textFont("monospace");
  await ensurePlayer();
  wireUI();
  await refreshTop();
};

window.draw = function () {
  background(32);

  // 自分のスコア
  fill(255);
  textSize(20);
  text(`score: ${score}`, 18, 36);

  // 右下に自分の名前を表示
  push();
  textAlign(RIGHT, BOTTOM);
  fill(200, 200, 200, 180);
  textSize(12);
  text(`${player.name}`, width - 8, height - 8);
  pop();
};

// キー操作（Spaceで+1、Sで保存）
window.keyPressed = async function () {
  if (key === " ") score++;

  if (key.toUpperCase() === "S") {
    try{
      await postScore(player.id, score);
      await refreshTop();
    } catch (e) {
      console.error(e);
    }
  }
};
