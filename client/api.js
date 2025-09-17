// 目的：
// fetch() でサーバーのAPI（/api/scores）へアクセスする薄い関数を2つ用意します
// 1. fetchScores() … ランキングをもらう（GET）
// 2. postScore(name, score) … スコアを送る（POST）

// 分ける理由：
// 通信ロジックと描画ロジックを分離すると、見通しがよくバグも減ります。
// あとで「JWTを付けたい」などの変更も、このファイルだけ直せばOK。

// サーバーURLは同じ origin(http://localhost:3000)なので、相対パスでOK
export async function fetchScores() {
    const res = await fetch(`/api/scores`); // fetch() は「URLにリクエストを送る」ブラウザ標準の関数
    if (!res.ok) throw new Error("Failed to fetch scores");
    return await res.json(); // サーバーから帰って来たJSONをJavaScriptのオブジェクトに戻す処理
}

export async function postScore(name, score) {
    const res = await fetch(`/api/scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, score }),
    });
    if (!res.ok) throw new Error("Failed to post scores");
    return await res.json();
}