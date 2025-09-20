import express from "express";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import crypto from "crypto";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

// Express準備
dotenv.config(); // .envを取り込む
// ES Modulesでは __dirname がない　→　次の2行で代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json()); // JSONボディの受け取りを有効化


// p5クライアントを”同じサーバー”から配信
// CORSや複数ポートの問題を回避
// http://localhost:3000/ にアクセスすると client/ の内容が返る
const CLIENT_DIR = path.resolve(__dirname, "../client");
app.use(express.static(CLIENT_DIR));
app.get("/", (req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));

// HTTPサーバーをラップ
const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: "*"} });


// ====== リアルタイム用（超最小サンプル） ======
const ROOM_DEFAULT = "lobby";
const ARENA = { width: 640, height: 360 };
const SPEED = 120; // px/sec
const players = new Map(); // socket.id -> {id, name, x, y, room, keys:{w,a,s,d}}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v)); 
}

io.on("connection", (socket) => {
    console.log("connected", socket.id);

    // クライアントから自己紹介(join)
    socket.on("join", ({ player_id, display_name, room }) => {
        const r = room || ROOM_DEFAULT;
        socket.join(r);

        // 既存プレイヤーと被らないようランダムにspawn
        const x = 40 + Math.random() * (ARENA.width - 80);
        const y = 40 + Math.random() * (ARENA.height - 80);

        players.set(socket.id, {
            id: player_id,
            name: display_name || "player",
            x, y,
            room: r,
            keys: { w:false, a:false, s:false, d:false },
        });

        // 新規参加に現在状態を返すのは"state"で行う
        console.log(`join ${r}: ${display_name} (${socket.id})`);
    });

    // 入力(押下状態）を受信
    socket.on("input", (keys) => {
        const p = players.get(socket.id);
        if (p) p.keys = { ...p.keys, ...keys };
    });

    socket.on("disconnect", () => {
        players.delete(socket.id);
        console.log("disconnected", socket.id);
    });
});

// サーバー権威ループ：30fpsで位置更新して部屋ごとに配信
let last = Date.now();
setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000; // seconds
    last = now;

    const rooms = new Map(); // room -> array of snapshot
    for (const [sid, p] of players) {
        // 速度計算
        const vx = (p.keys.d ? 1 : 0) - (p.keys.a ? 1 : 0);
        const vy = (p.keys.s ? 1 : 0) - (p.keys.w ? 1 : 0);
        const len = Math.hypot(vx, vy) || 1;
        const nx = (vx/len) * SPEED;
        const ny = (vy/len) * SPEED;
        
        p.x = clamp(p.x + nx*dt, 10, ARENA.width - 10);
        p.y = clamp(p.y + ny*dt, 10, ARENA.height - 10);

        if (!rooms.has(p.room)) rooms.set(p.room, []);
        rooms.get(p.room).push({ sid, name: p.name, x: p.x, y: p.y });
    }

    for (const [room, arr] of rooms) {
        io.to(room).emit("state", { arena: ARENA, players: arr });
    }
}, 1000/30);


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


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
});
