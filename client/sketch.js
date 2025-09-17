import { fetchScores, postScore } from "./api.js";

let score = 0;        // 自分のスコア
let name = "player";  // とりあえず固定。後で入力欄にしてOK
let top10 = [];       // ランキング

// p5 が見つけられるように window にぶら下げる
window.setup = function () {
  createCanvas(480, 320); // 画面を作る
  textFont("monospace");

  // ページ読み込み時にランキングをもらう
  fetchScores()
    .then((t) => (top10 = t))
    .catch(console.error);
};

window.draw = function () {
  background(32);

  // 自分のスコア
  fill(255);
  textSize(20);
  text(`score: ${score}`, 20, 40);

  // ランキング表示
  textSize(14);
  text("Top 10:", 20, 80);
  top10.forEach((s, i) => {
    text(`${i + 1}. ${s.name} - ${s.score}`, 20, 110 + i * 18);
  });
};

// キー操作（Spaceで+1、Sで保存）
window.keyPressed = function () {
  if (key === " ") score++;

  if (key.toUpperCase() === "S") {
    postScore(name, score)
      .then(() => fetchScores().then((t) => (top10 = t))) // 保存後に最新を再取得
      .catch(console.error);
  }
};
