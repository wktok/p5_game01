import express from "express";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import crypto from "crypto";

dotenv.config(); // .envを取り込む

// ES Modulesでは __dirname がない　→　次の2行で代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // JSONボディの受け取りを有効化

// ユーザー登録
// POST /api/register {display_name}
app.post("/api/register", (req, res) => {
    const { display_name } = req.body || {};
    if (typeof display_name !== "string" || display_name.trim() ==="") {
        return res.status(400).json({ error: "display_name required" });
    }
    const player_id = crypto.randomUUID();
    const created_at = Date.now();
    
    db.prepare(
        "INSERT INTO players (id, display_name, created_at) VALUES (?, ?, ?)"
    ).run(player_id, display_name.trim(), created_at);

    res.status(201).json({ player_id, display_name });
});

// 登録名変更（任意）
// PATCH /api/players/:id { display_name }
app.patch("/api/players/:id", (req, res) => {
    const { id } = req.params;
    const { display_name } = req.body || {};
    if (typeof display_name !== "string" || display_name.trim() ==="") {
        return res.status(400).json({ error: "display_name required" });
    }
    const r = db.prepare("UPDATE players SET display_name=? WHERE id=?")
                .run(display_name.trim(), id);
    if (r.changes === 0) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
});

// スコアの登録
// POST /api/scores { player_id, score }
app.post("/api/scores", (req, res) => {
    const { player_id, score } = req.body || {};
    if (typeof player_id !== "string" || typeof score !== "number") {
        return res.status(400).json({ error: "invalid payload" });
    }
    // 存在チェック（該当するplayer_idの確認）
    const p = db.prepare("SELECT 1 FROM players WHERE id=?").get(player_id); 
    if (!p) return res.status(400).json({ error: "unknown player_id" });
    // スコア書き込み (小数点切り捨て)
    db.prepare(
        "INSERT INTO scores (player_id, score, created_at) VALUES (?, ?, ?)"
    ).run(player_id, Math.floor(score), Date.now());

    res.status(201).json({ ok: true });
});

// ランキング取得
// GET /api/scores/top?limit=10
app.get("/api/scores/top", (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "10", 10), 50);
    const rows = db.prepare(
        `Select s.score, s.created_at, p.display_name
        FROM scores s
        JOIN players p ON p.id = s.player_id
        ORDER BY s.score DESC, s.created_at ASC
        LIMIT ?`
    ).all(limit);
    res.json(rows);
});

// ヘルスチェック（APIが生きているか　+　DBがひらけるか）
app.get("/api/health", (req, res) => {
    try {
        // 簡単なクエリでDB疎通を確認
        const row = db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' LIMIT 1"
        ).get();
        res.json({ ok: true, db: row ? "ready" : "empty" });
    } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
    }
});

// p5クライアントを”同じサーバー”から配信
// CORSや複数ポートの問題を回避
// http://localhost:3000/ にアクセスすると client/ の内容が返る
const CLIENT_DIR = path.resolve(__dirname, "../client");
app.use(express.static(CLIENT_DIR));
app.get("/", (req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));

// 起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Client: http://localhost:${PORT}/`);
    console.log(`Health: http://localhost:${PORT}/api/health`);
});

