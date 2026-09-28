const $ = (id) => document.getElementById(id);
const labels = {
  "unique-deployment": "各観測で候補が一つ",
  "equivalent-content": "候補の内容は同じ",
  "ambiguous-content": "内容が異なる候補",
  "modified-deployment": "Gitと不一致の候補",
  unobserved: "未観測",
};
const names = {
  "native-current": "macOS · CLI 0.157.1",
  "native-previous": "macOS · CLI 0.156.0",
  "docker-current": "Linux / Docker · CLI 0.157.1",
  "delivery-fixture": "配送テスト用データ",
};
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function badge(state) {
  return node(
    "span",
    labels[state] ?? "不明",
    `badge ${["ambiguous-content", "modified-deployment"].includes(state) ? "warn" : state === "unobserved" ? "neutral" : ""}`,
  );
}
function time(utc) {
  return utc ? utc.replace("T", " ").replace(/\.\d{3}Z$/, "") : "—";
}
let request = 0;
async function refresh() {
  const current = ++request;
  const params = new URLSearchParams({ evidence: $("evidence").value });
  for (const key of ["start", "end"])
    if ($(key).value) params.set(key, `${$(key).value}Z`);
  try {
    const response = await fetch(`/api?${params}`);
    if (!response.ok) throw new Error("invalid");
    const data = await response.json();
    if (current !== request) return;
    $("error").hidden = true;
    const observedRows = data.rows.filter((row) => row.samples > 0);
    const known =
      observedRows.length > 0 &&
      observedRows.every((row) => row.total !== null);
    $("total").textContent = known
      ? String(observedRows.reduce((sum, row) => sum + row.total, 0))
      : "不明";
    $("observed").textContent =
      `${data.rows.filter((row) => row.samples > 0).length} / ${data.rows.length}`;
    $("sample-count").textContent =
      `${data.timeline.length}件の受信記録 · 保存済みデータ`;
    $("basis").textContent =
      data.evidence === "real-cli"
        ? "保存済みの実測データです。時刻はUTCの受信時刻で、Skillが読まれた瞬間ではありません。"
        : "合成した観測レコードによる配送テストです。実際のSkill利用の集計には含めません。";
    $("skills").replaceChildren(
      ...data.rows.map((row) => {
        const tr = node("tr"),
          identity = node("td"),
          count = node(
            "td",
            row.total === null ? "不明" : String(row.total),
            "count",
          ),
          state = node("td"),
          last = node("td", time(row.lastIncreaseAt));
        identity.append(node("strong", row.skill), node("small", row.assetId));
        state.append(
          badge(row.resolution),
          node(
            "small",
            row.sourceCommits.length
              ? `${row.sourceCommits.length}個の同期commit候補`
              : "対応する受信記録なし",
          ),
        );
        if (row.countState === "ambiguous-overlap")
          count.append(node("small", "重なる計測区間あり"));
        if (row.gaps) count.append(node("small", "計測区間に空きあり"));
        tr.append(identity, count, state, last);
        return tr;
      }),
    );
    $("empty").hidden = data.timeline.length !== 0;
    $("timeline").replaceChildren(
      ...data.timeline.map((row) => {
        const event = node("div", undefined, "event"),
          stamp = node("time", time(row.observedAt)),
          main = node("div"),
          end = node("div", undefined, "end");
        stamp.dateTime = row.observedAt;
        main.append(
          node("div", row.skill, "title"),
          node(
            "div",
            `${names[row.producer] ?? row.producer} · ${row.candidates.map((c) => `${c.commit.slice(0, 8)}${c.matchesGit ? "" : "（変更あり）"}`).join(" / ")}`,
            "detail",
          ),
        );
        end.append(node("div", `+${row.value}`, "delta"), badge(row.state));
        event.append(stamp, main, end);
        return event;
      }),
    );
    $("delivery-panel").hidden = data.evidence !== "synthetic-delivery";
    const phases = {
      "http-503-queued": "受信側が503を返す：送信待ち",
      "stored-acknowledgement-lost": "保存後に応答が失われる：再送待ち",
      "tcp-down-retained": "受信側との接続停止：キューを維持",
      "backend-restarted-deduplicated": "受信側を再初期化：重複を除外",
      "auth-blocked": "認証失敗：自動再送を停止",
      "auth-recovered": "認証を修正：配送が回復",
    };
    $("checkpoints").replaceChildren(
      ...data.checkpoints.map((row) => {
        const event = node("div", undefined, "event"),
          main = node("div");
        main.append(
          node("div", phases[row.phase], "title"),
          node(
            "div",
            `送信待ち ${row.queued} · 保存済み ${row.backendRecords} · 重複除外 ${row.duplicates}`,
            "detail",
          ),
        );
        event.append(node("time", time(row.observedAt)), main);
        return event;
      }),
    );
    $("environments").textContent =
      `検証環境：${data.environments.map((env) => `${env.operatingSystem}/${env.architecture} ${env.version}`).join(" · ")}`;
  } catch {
    if (current !== request) return;
    $("error").textContent =
      "表示条件を確認してください。開始は終了より前に指定してください。サーバーに接続できない場合は再起動してください。";
    $("error").hidden = false;
  }
}
for (const id of ["evidence", "start", "end"])
  $(id).addEventListener("change", refresh);
$("reset").addEventListener("click", () => {
  $("start").value = "";
  $("end").value = "";
  void refresh();
});
void refresh();
