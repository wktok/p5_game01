// client/api.js
const BASE = ""; // 同一オリジンなので空でOK。将来CDN配信などに備えて変数化。

export async function registerPlayer(display_name) {
    const res = await fetch(`${BASE}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name }),
    });
    if (!res.ok) throw new Error("Failed to register");
    return await res.json(); // { player_id, display_name }
}

export async function updateDisplayName(player_id, display_name) {
    const res = await fetch(`${BASE}/api/players/${player_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name }),
    });
    if (!res.ok) throw new Error("Failed to update name");
    return await res.json(); // { ok: true }
}

export async function postScore(player_id, score) {
    const res = await fetch(`${BASE}/api/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id, score }),
    });
    if (!res.ok) throw new Error("Failed to post score");
    return await res.json();
}

export async function fetchTopScores(limit = 10) {
    const res = await fetch(`${BASE}/api/scores/top?limit=${limit}`);
    if (!res.ok) throw new Error("Failed to fetch top scores");
    return await res.json(); // [{score, created_at, display_name}, ...]
}