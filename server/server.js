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


// ====== 同期プレイ ======
const ROOM_DEFAULT = "lobby";
const ARENA = { width: 640, height: 360 };

const SPEED = 120;                      // px/sec
const PLAYER_SIZE = 20;
const PICKUP_RADIUS = 8;                // Energy Ball radius
const MAX_PICKUPS = 20;
const PICKUP_SPAWN_INTERVAL = 500;     // spawn interval(ms)
const BULLET_BASE_SPEED = 200;
const BULLET_RADIUS_BASE = 4; 
const BULLET_RADIUS_PER_POWER = 0.2;    // radius size relates to power?
const BULLET_LIFETIME = 4000;           // ms *reflect walls in future

// socket.id -> player
// player: {id, name, x, y, room, keys, energy, color:{r, g, b}}
const players = new Map();

let pickups = [];       // {id, x, y}
let bullets = [];       // {id, x, y, vx, vy, power, color: {r,g,b, ownerId, spwanAt}}
let nextId = 1;

function rand(min, max) { return Math.random()*(max-min)+min; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function colorFromId(str){
  // 簡易ハッシュ→HSL→RGB
  let h = 0;
  for (let i=0;i<str.length;i++) h = (h*31 + str.charCodeAt(i)) >>> 0;
  const hue = h % 360;              // 0..359
  const s = 70, l = 55;
  // HSL→RGB（簡易）
  function h2rgb(p, q, t){ if(t<0) t+=1; if(t>1) t-=1;
    if(t<1/6) return p+(q-p)*6*t;
    if(t<1/2) return q;
    if(t<2/3) return p+(q-p)*(2/3 - t)*6;
    return p; }
  const hh = hue/360, ss=s/100, ll=l/100;
  const q = ll < .5 ? ll*(1+ss) : ll+ss-ll*ss;
  const p = 2*ll - q;
  const r = Math.round(h2rgb(p,q,hh+1/3)*255);
  const g = Math.round(h2rgb(p,q,hh     )*255);
  const b = Math.round(h2rgb(p,q,hh-1/3)*255);
  return { r,g,b };
}


io.on("connection", (socket) => {
    console.log("connected", socket.id);

    // 接続直後に自分のidを通知(1度だけ)
    socket.emit("you" , {sid: socket.id });

    // クライアントから自己紹介(join)
    socket.on("join", ({ player_id, display_name, room }) => {
        const r = room || ROOM_DEFAULT;
        socket.join(r);

        // 既存プレイヤーと被らないようランダムにspawn
        const x = rand(40, ARENA.width-40);
        const y = rand(40, ARENA.height-40);

        players.set(socket.id, {
            id: player_id,
            name: display_name || "player",
            x, y,
            room: r,
            keys: { w:false, a:false, s:false, d:false },
            energy: 0,
            color: colorFromId(player_id),
        });

        // 新規参加に現在状態を返すのは"state"で行う
        console.log(`join ${r}: ${display_name} (${socket.id})`);
    });

    // 入力(押下状態）を受信
    socket.on("input", (keys) => {
        const p = players.get(socket.id);
        if (p) p.keys = { ...p.keys, ...keys };
    });

    // エネルギー弾発射(方向はクライアントからサーバーに正規化ベクトルで送る）
    socket.on("fire", ({ ax, ay }) => {
        const p = players.get(socket.id);
        if (!p || p.energy <= 0) return;

        // 方向ベクトルを正規化
        const len = Math.hypot(ax, ay) || 1;
        const ux = ax/ len, uy = ay/len; 
        
        const power = p.energy;
        p.energy = 0;
        
        bullets.push({
            id: nextId++,
            x: p.x, y:p.y,
            vx: ux * BULLET_BASE_SPEED,
            vy: uy * BULLET_BASE_SPEED,
            power,
            color: p.color,
            ownerSid: socket.id,
            spawnAt: Date.now(),
        });
    });

    socket.on("disconnect", () => {
        players.delete(socket.id);
        console.log("disconnected", socket.id);
    });
});

// エネルギー玉の生成管理
setInterval(() => {
    if (pickups.length >= MAX_PICKUPS) return; // すでに生成上限
    pickups.push({ id: nextId++, x: rand(20, ARENA.width-20), y: rand(20, ARENA.height-20) });
}, PICKUP_SPAWN_INTERVAL);

// ゲームループ：60fpsで移動、拾得、弾更新、配信
let last = Date.now();
setInterval(() => {
    const now = Date.now();
    const dt = (now - last) / 1000; // seconds
    last = now;
    //　--- プレイヤー移動 ---
    const rooms = new Map(); 
    for (const [sid, p] of players) {
        // 速度計算
        const vx = (p.keys.d ? 1 : 0) - (p.keys.a ? 1 : 0);
        const vy = (p.keys.s ? 1 : 0) - (p.keys.w ? 1 : 0);
        const len = Math.hypot(vx, vy) || 1;

        p.x = clamp(p.x + (vx/len)*SPEED*dt, PLAYER_SIZE/2, ARENA.width - PLAYER_SIZE/2);
        p.y = clamp(p.y + (vy/len)*SPEED*dt, PLAYER_SIZE/2, ARENA.height - PLAYER_SIZE/2);

        if (!rooms.has(p.room)) rooms.set(p.room, []);
        rooms.get(p.room).push({ sid, name: p.name, x: p.x, y: p.y, energy: p.energy, color: p.color });
    }

    // --- 拾得判定(O(n*m)だがMVPなのでOK) ---
    const remain = [];
    for (const pu of pickups) {
        let taken = false;
        for (const [,p] of players) {
            const dx = pu.x - p.x, dy = pu.y - p.y;
            if (dx*dx + dy*dy <= (PICKUP_RADIUS + PLAYER_SIZE/2)**2) { p.energy += 1; taken = true; break;}
        }
        if (!taken) remain.push(pu);
    }
    pickups = remain;

    // --- 弾更新（直進・時間で消滅）---
    const alive = [];
    for (const b of bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const out = b.x < -20 || b.x > ARENA.width + 20 || b.y < -20 || b.y > ARENA.height + 20;
        const expired = now - b.spawnAt > BULLET_LIFETIME;
        if (!out && !expired) alive.push(b);
    }
    bullets = alive;

    // --- 状態配信（部屋ごと） 
    for (const [room, arr] of rooms) {
        io.to(room).emit("state", { 
            arena: ARENA, 
            players: arr,
            pickups,
            bullets: bullets.map(b => ({id: b.id, x: b.x, y: b.y, power: b.power, color: b.color })),
        });
    }
}, 1000/60);


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
