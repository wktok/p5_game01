import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config(); // .envを取り込む

//　ES Modulesでは __dirname がない　→　次の2行で代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // JSONボディの受け取りを有効化


// 簡易DB（JSONファイル）　※のちにSQLiteに移行
const DB_PATH = path.resolve(__dirname, "db.json");
if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ scores: [] }, null, 2));
}

// API ENDPOINT
app.get("/api/health", (_, res) => res.json({ ok: true }));

// health check(動作確認・監視) 
app.get("/api/scores", (_, res) => {
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    const top = [...data.scores].sort((a,b) => b.score - a.score).slice(0, 10);
    res.json(top);
});

// get ranking
// 入力の型確認　→　保存　→　201（作成）で応答
// ポイント　最低限のバリデーションを入れて不正入力を防止
app.post("/api/scores", (req, res) => {
    const { name, score } = req.body || {};
    if (typeof name !== "string" || typeof score !== "number") {
        return res.status(400).json({ error: "invalid payload"});
    }
    const data = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    data.scores.push({ name, score, at: Date.now() });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    res.status(201).json({ ok: true });
});

// p5クライアントを”同じサーバー”から配信
// CORSや複数ポートの問題を回避
// http://localhost:3000/ にアクセスすると client/ の内容が返る
const CLIENT_DIR = path.resolve(__dirname, "../client");
app.use(express.static(CLIENT_DIR));

// 起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Client: http://localhost:${PORT}/`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
});

// 既存の __dirname, CLIENT_DIR 定義の近くに追加
console.log("[DEBUG] __dirname:", __dirname);
console.log("[DEBUG] CLIENT_DIR:", CLIENT_DIR);
