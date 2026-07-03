import { useState, useMemo, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { createClient } from "@supabase/supabase-js";

// ===== Supabase 接続 =====
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isConfigured = Boolean(url && anonKey);
const supabase = isConfigured ? createClient(url, anonKey) : null;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function ShiftRequestApp() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const [members, setMembers] = useState([]);
  const [mode, setMode] = useState("member");
  const [currentMember, setCurrentMember] = useState("");

  const [mySel, setMySel] = useState({});
  const [mySubmitted, setMySubmitted] = useState(false);
  const [openDay, setOpenDay] = useState(null);

  const LEADER_HINT = "1234";
  const [unlocked, setUnlocked] = useState(false);
  const [leaderCode, setLeaderCode] = useState("");
  const [passInput, setPassInput] = useState("");
  const [passError, setPassError] = useState(false);
  const [leaderData, setLeaderData] = useState(null);
  const [newName, setNewName] = useState("");

  const [newPass, setNewPass] = useState("");
  const [passMsg, setPassMsg] = useState("");

  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;

  const callRpc = useCallback(async (fn, args) => {
    if (!isConfigured || !supabase) {
      throw new Error("設定エラー: Supabaseの接続情報が未設定です。");
    }
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw error;
    return data;
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const list = await callRpc("app_get_members", {});
      setMembers(list || []);
      setCurrentMember((cur) => cur || (list && list[0]) || "");
    } catch (e) {
      setErrMsg("メンバー一覧を読み込めませんでした。設定を確認してください。");
    }
  }, [callRpc]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (mode !== "member" || !currentMember) return;
    let active = true;
    (async () => {
      try {
        const res = await callRpc("app_get_my_requests", {
          p_member: currentMember,
          p_month: monthKey,
        });
        if (!active) return;
        setMySel(res?.days || {});
        setMySubmitted(Boolean(res?.submitted));
        setOpenDay(null);
      } catch (e) {
        if (active) setErrMsg("希望データの読み込みに失敗しました。");
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, currentMember, monthKey, callRpc]);

  const loadLeaderData = useCallback(
    async (code) => {
      try {
        const res = await callRpc("app_leader_data", {
          p_code: code,
          p_month: monthKey,
        });
        if (res?.ok) {
          setLeaderData(res);
          if (res.members) setMembers(res.members);
        }
        return res;
      } catch (e) {
        setErrMsg("集計データの読み込みに失敗しました。");
        return { ok: false };
      }
    },
    [callRpc, monthKey]
  );

  useEffect(() => {
    if (mode === "leader" && unlocked && leaderCode) {
      loadLeaderData(leaderCode);
    }
  }, [mode, unlocked, leaderCode, monthKey, loadLeaderData]);

  function toggleDay(day) {
    const key = ymd(viewYear, viewMonth, day);
    setMySel((prev) => {
      const next = { ...prev };
      if (key in next) {
        delete next[key];
        if (openDay === key) setOpenDay(null);
      } else {
        next[key] = "";
        setOpenDay(key);
      }
      return next;
    });
    setMySubmitted(false);
  }

  function setMemo(key, text) {
    setMySel((prev) => ({ ...prev, [key]: text }));
    setMySubmitted(false);
  }

  async function submit() {
    setBusy(true);
    setErrMsg("");
    try {
      const daysThisMonth = {};
      for (const [k, v] of Object.entries(mySel)) {
        if (k.startsWith(monthKey)) daysThisMonth[k] = v;
      }
      const res = await callRpc("app_submit", {
        p_member: currentMember,
        p_month: monthKey,
        p_days: daysThisMonth,
      });
      if (res?.ok) setMySubmitted(true);
      else setErrMsg("送信に失敗しました。もう一度お試しください。");
    } catch (e) {
      setErrMsg("送信に失敗しました。通信環境を確認してください。");
    } finally {
      setBusy(false);
    }
  }

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else setViewMonth(viewMonth - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else setViewMonth(viewMonth + 1);
  }

  async function tryUnlock() {
    setBusy(true);
    setPassError(false);
    try {
      const res = await loadLeaderData(passInput);
      if (res?.ok) {
        setUnlocked(true);
        setLeaderCode(passInput);
        setPassInput("");
      } else {
        setPassError(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next) {
    setMode(next);
    setErrMsg("");
    if (next === "member") {
      setUnlocked(false);
      setLeaderCode("");
      setPassInput("");
      setPassError(false);
      setLeaderData(null);
      setPassMsg("");
    }
  }

  async function addMember() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await callRpc("app_leader_add_member", {
        p_code: leaderCode,
        p_name: name,
      });
      if (res?.ok) {
        setMembers(res.members || []);
        setNewName("");
        await loadLeaderData(leaderCode);
      }
    } catch (e) {
      setErrMsg("追加に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(name) {
    setBusy(true);
    try {
      const res = await callRpc("app_leader_remove_member", {
        p_code: leaderCode,
        p_name: name,
      });
      if (res?.ok) {
        setMembers(res.members || []);
        if (currentMember === name) {
          setCurrentMember((res.members && res.members[0]) || "");
        }
        await loadLeaderData(leaderCode);
      }
    } catch (e) {
      setErrMsg("削除に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  async function changePasscode() {
    const np = newPass.trim();
    setPassMsg("");
    if (np.length < 4) {
      setPassMsg("合言葉は4文字以上にしてください。");
      return;
    }
    setBusy(true);
    try {
      const res = await callRpc("app_leader_change_passcode", {
        p_code: leaderCode,
        p_new: np,
      });
      if (res?.ok) {
        setLeaderCode(np);
        setNewPass("");
        setPassMsg("✓ 合言葉を変更しました。");
      } else {
        setPassMsg("変更に失敗しました。");
      }
    } catch (e) {
      setPassMsg("変更に失敗しました。");
    } finally {
      setBusy(false);
    }
  }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const byDay = useMemo(() => {
    const map = {};
    const reqs = leaderData?.requests || [];
    for (const r of reqs) {
      if (!map[r.ymd]) map[r.ymd] = [];
      map[r.ymd].push({ name: r.name, memo: r.memo });
    }
    return map;
  }, [leaderData]);

  const submittedSet = useMemo(
    () => new Set(leaderData?.submissions || []),
    [leaderData]
  );

  const styles = {
    wrap: { maxWidth: 860, margin: "0 auto", padding: "24px 16px", fontFamily: "system-ui, -apple-system, sans-serif", color: "#1f2933" },
    tabs: { display: "flex", gap: 8, marginBottom: 20 },
    tab: (active) => ({ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid " + (active ? "#2563eb" : "#d1d5db"), background: active ? "#2563eb" : "#fff", color: active ? "#fff" : "#374151", fontWeight: 600, cursor: "pointer", fontSize: 14 }),
    card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 20, marginBottom: 16 },
    monthNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
    navBtn: { border: "1px solid #d1d5db", background: "#fff", borderRadius: 8, width: 36, height: 36, cursor: "pointer", fontSize: 18 },
    grid: { display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6 },
    dow: (i) => ({ textAlign: "center", fontSize: 12, fontWeight: 600, padding: "4px 0", color: i === 0 ? "#dc2626" : i === 6 ? "#2563eb" : "#6b7280" }),
    cell: (selected, empty) => ({
      aspectRatio: "1", border: empty ? "none" : "1px solid " + (selected ? "#2563eb" : "#e5e7eb"),
      borderRadius: 10, background: empty ? "transparent" : selected ? "#2563eb" : "#fff",
      color: selected ? "#fff" : "#374151", cursor: empty ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: selected ? 700 : 400,
    }),
    select: { padding: "8px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 14 },
    submitBtn: { marginTop: 16, padding: "12px 20px", borderRadius: 10, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", width: "100%", opacity: busy ? 0.6 : 1 },
    heat: (n) => ({ background: n === 0 ? "#fff" : n === 1 ? "#fde68a" : n <= 3 ? "#fbbf24" : "#f87171", color: n > 3 ? "#fff" : "#374151" }),
    primaryBtn: { padding: "8px 20px", borderRadius: 8, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 },
  };

  if (!isConfigured) {
    return (
      <div style={styles.wrap}>
        <div style={{ ...styles.card, borderColor: "#f59e0b" }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>接続情報が未設定です</h2>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>
            Vercel の環境変数 <code>VITE_SUPABASE_URL</code> と{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> を設定してください。
            設定後、Vercel で「Redeploy（再デプロイ）」すると表示されます。
          </p>
        </div>
      </div>
    );
  }

  const mySelKeysThisMonth = Object.keys(mySel)
    .filter((k) => k.startsWith(monthKey))
    .sort();

  return (
    <div style={styles.wrap}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>シフト休み希望フォーム</h1>
      <p style={{ color: "#6b7280", fontSize: 13, marginTop: 0, marginBottom: 20 }}>
        入力内容は共有データベースに保存されます
      </p>

      {errMsg && (
        <div style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13 }}>
          {errMsg}
        </div>
      )}

      <div style={styles.tabs}>
        <button style={styles.tab(mode === "member")} onClick={() => switchMode("member")}>メンバー入力</button>
        <button style={styles.tab(mode === "leader")} onClick={() => switchMode("leader")}>リーダー管理 🔒</button>
      </div>

      <div style={styles.monthNav}>
        <button style={styles.navBtn} onClick={prevMonth}>‹</button>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{viewYear}年 {viewMonth + 1}月</div>
        <button style={styles.navBtn} onClick={nextMonth}>›</button>
      </div>

      {mode === "member" ? (
        <div style={styles.card}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: "#6b7280", marginRight: 8 }}>あなたの名前</label>
            <select style={styles.select} value={currentMember} onChange={(e) => setCurrentMember(e.target.value)}>
              {members.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 0 }}>休みたい日をタップして選んでください。青い日をもう一度タップで解除できます</p>
          <div style={styles.grid}>
            {WEEKDAYS.map((w, i) => <div key={w} style={styles.dow(i)}>{w}</div>)}
            {Array.from({ length: firstDay }).map((_, i) => <div key={"e" + i} style={styles.cell(false, true)} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const key = ymd(viewYear, viewMonth, day);
              const selected = key in mySel;
              const hasMemo = selected && mySel[key]?.trim();
              return (
                <div key={day} style={{ ...styles.cell(selected, false), position: "relative" }} onClick={() => toggleDay(day)}>
                  {day}
                  {hasMemo && <span style={{ position: "absolute", bottom: 4, width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                </div>
              );
            })}
          </div>

          {mySelKeysThisMonth.length > 0 && (
            <div style={{ marginTop: 16, borderTop: "1px solid #f3f4f6", paddingTop: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px" }}>選択した日（メモは任意）</p>
              {mySelKeysThisMonth.map((key) => {
                const d = parseInt(key.split("-")[2], 10);
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 48, fontSize: 14, fontWeight: 600 }}>{d}日</div>
                    <input
                      value={mySel[key]}
                      onChange={(e) => setMemo(key, e.target.value)}
                      placeholder="例：18時から可能（空欄なら終日休み）"
                      style={{ ...styles.select, flex: 1 }}
                    />
                    <button
                      onClick={() => toggleDay(d)}
                      aria-label={d + "日を解除"}
                      style={{ border: "none", background: "#e5e7eb", color: "#6b7280", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}
                    >×</button>
                  </div>
                );
              })}
            </div>
          )}

          <button style={styles.submitBtn} onClick={submit} disabled={busy}>
            {busy ? "処理中…" : mySubmitted ? "✓ 送信済み（再送信で更新）" : "この内容で送信"}
          </button>
        </div>
      ) : !unlocked ? (
        <div style={styles.card}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>リーダー用画面</h3>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 0 }}>合言葉を入力してください（初期値: {LEADER_HINT}）</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              value={passInput}
              onChange={(e) => { setPassInput(e.target.value); setPassError(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
              placeholder="合言葉"
              style={{ ...styles.select, flex: 1 }}
            />
            <button style={styles.primaryBtn} onClick={tryUnlock} disabled={busy}>
              {busy ? "確認中…" : "開く"}
            </button>
          </div>
          {passError && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 0 }}>合言葉が違います</p>}
        </div>
      ) : (
        <>
          <div style={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: 16 }}>日別 — 誰が休み希望か</h3>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>色が濃いほど休み希望者が多い日</p>
            <div style={styles.grid}>
              {WEEKDAYS.map((w, i) => <div key={w} style={styles.dow(i)}>{w}</div>)}
              {Array.from({ length: firstDay }).map((_, i) => <div key={"e" + i} style={{ ...styles.cell(false, true) }} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const key = ymd(viewYear, viewMonth, day);
                const entries = byDay[key] || [];
                const anyMemo = entries.some((e) => e.memo?.trim());
                return (
                  <div key={day} onClick={() => setOpenDay(openDay === key ? null : key)}
                    style={{ aspectRatio: "1", border: "1px solid " + (openDay === key ? "#2563eb" : "#e5e7eb"), borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: entries.length ? "pointer" : "default", position: "relative", ...styles.heat(entries.length) }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{day}</div>
                    {entries.length > 0 && <div style={{ fontSize: 11, fontWeight: 700 }}>{entries.length}人</div>}
                    {anyMemo && <span style={{ position: "absolute", top: 4, right: 4, fontSize: 9 }}>📝</span>}
                  </div>
                );
              })}
            </div>
            {openDay && byDay[openDay] && (
              <div style={{ marginTop: 12, background: "#f9fafb", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  {parseInt(openDay.split("-")[2], 10)}日の休み希望（{byDay[openDay].length}人）
                </div>
                {byDay[openDay].map((e) => (
                  <div key={e.name} style={{ fontSize: 13, padding: "3px 0" }}>
                    <span style={{ fontWeight: 600 }}>{e.name}</span>
                    <span style={{ color: e.memo?.trim() ? "#b45309" : "#9ca3af", marginLeft: 8 }}>
                      {e.memo?.trim() ? e.memo : "終日休み"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: 16 }}>個人別 — 各メンバーの希望日</h3>
            {members.map((m) => {
              const keys = (leaderData?.requests || [])
                .filter((r) => r.name === m)
                .map((r) => r.ymd)
                .sort();
              const memoOf = {};
              (leaderData?.requests || [])
                .filter((r) => r.name === m)
                .forEach((r) => { memoOf[r.ymd] = r.memo; });
              const done = submittedSet.has(m);
              return (
                <div key={m} style={{ display: "flex", alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid #f3f4f6" }}>
                  <div style={{ width: 70, fontWeight: 600, fontSize: 14 }}>{m}</div>
                  <div style={{ width: 70, fontSize: 11, color: done ? "#16a34a" : "#9ca3af", paddingTop: 2 }}>{done ? "提出済" : "未提出"}</div>
                  <div style={{ flex: 1, fontSize: 13, color: keys.length ? "#374151" : "#d1d5db" }}>
                    {keys.length ? keys.map((k) => {
                      const d = parseInt(k.split("-")[2], 10);
                      const memo = memoOf[k]?.trim();
                      return (
                        <span key={k} style={{ display: "inline-block", marginRight: 10, marginBottom: 2 }}>
                          {d}日{memo && <span style={{ color: "#b45309" }}>（{memo}）</span>}
                        </span>
                      );
                    }) : "希望なし"}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: 16 }}>メンバー名簿の管理</h3>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
              名前を追加・削除できます。削除するとその人の希望データも消えます（{members.length}人）
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addMember(); }}
                placeholder="追加する名前"
                style={{ ...styles.select, flex: 1 }}
              />
              <button style={styles.primaryBtn} onClick={addMember} disabled={busy}>追加</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {members.map((m) => (
                <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f3f4f6", borderRadius: 999, padding: "5px 6px 5px 12px", fontSize: 13 }}>
                  {m}
                  <button
                    onClick={() => removeMember(m)}
                    aria-label={m + "を削除"}
                    style={{ border: "none", background: "#d1d5db", color: "#fff", borderRadius: "50%", width: 18, height: 18, cursor: "pointer", fontSize: 12, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                  >×</button>
                </span>
              ))}
            </div>
          </div>

          <div style={styles.card}>
            <h3 style={{ marginTop: 0, fontSize: 16 }}>合言葉の変更</h3>
            <p style={{ fontSize: 12, color: "#6b7280", marginTop: 0 }}>
              安全のため、初期値の「1234」から推測されにくい合言葉（英数字の組み合わせなど）に変更することをおすすめします。
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={newPass}
                onChange={(e) => { setNewPass(e.target.value); setPassMsg(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") changePasscode(); }}
                placeholder="新しい合言葉（4文字以上）"
                style={{ ...styles.select, flex: 1 }}
              />
              <button style={styles.primaryBtn} onClick={changePasscode} disabled={busy}>変更</button>
            </div>
            {passMsg && <p style={{ fontSize: 13, marginBottom: 0, color: passMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}>{passMsg}</p>}
          </div>
        </>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<ShiftRequestApp />);
