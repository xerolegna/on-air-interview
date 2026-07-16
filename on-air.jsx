import { useState, useRef, useEffect } from "react";

// ── On Air — voice interview practice ─────────────────────────
// Studio dark #171210, panel #221A17, ON AIR red #FF4136,
// tungsten amber #E8A33D, cream #F3EADE

const PERSONAS = {
  hr: "a warm, supportive HR recruiter — professional and encouraging, but still thorough",
  lead: "a skeptical senior technical lead — direct, probing, and hard to impress",
  panel: "a rapid-fire hiring panel — terse questions, quick pace, high pressure",
};

const PERSONA_LABELS = {
  hr: "Friendly HR recruiter",
  lead: "Skeptical tech lead",
  panel: "Rapid-fire panel",
};

const SYSTEM = (role, level, total, persona, jobDesc) => {
  const jd = jobDesc.trim()
    ? `\nThis interview is for the following real job posting. Base your questions directly on its stated requirements, responsibilities, and tools:\n"""\n${jobDesc.trim()}\n"""`
    : "";
  return `You are ${PERSONAS[persona]} conducting a realistic mock interview for a ${level} ${role} position.${jd}
Rules:
- Ask exactly ONE question at a time, short and spoken-style (1-3 sentences).
- Ask a total of ${total} questions. Cover a mix across the interview: opener/background, behavioral (STAR-style), role-specific technical, situational/scenario, problem-solving under pressure, and culture/teamwork. For technical questions, be genuinely specific to the ${role} role — real tools, real scenarios, not generic.
- ADAPT like a real interviewer: if an answer is vague, shallow, or dodges the question, your next question should probe it ("You mentioned X — walk me through exactly how you did that"). If the candidate is strong, raise the difficulty. Reference their earlier answers when relevant.
- Briefly acknowledge the previous answer in one natural sentence before the next question. Do not number questions. Do not coach or give feedback during the interview.
- Stay fully in character as ${PERSONA_LABELS[persona]}.
- When you have asked all ${total} questions and received answers, respond ONLY with the exact text: [INTERVIEW_COMPLETE]`;
};

const feedbackPrompt = (stats, fillerTotal) =>
  `The interview is over. Act as a blunt, expert interview coach. The app measured these stats — use them in your feedback:
- Per-answer time in seconds: [${stats.map((s) => s.secs).join(", ")}] (under 30s is often too thin; over 120s is rambling)
- Filler words detected per answer (um, uh, like, basically, you know...): [${stats.map((s) => s.fillers).join(", ")}], total ${fillerTotal}
Give honest, specific, CONCISE feedback (fit everything in ~600 words):
1) Overall impression in two sentences.
2) Top 2 strengths, quoting the candidate's actual words.
3) Top 2 weaknesses, naming the specific answer that showed each.
4) One rewritten model answer for their weakest response so they can internalize and adapt it.
5) Patterns to fix: pacing (use the timing data), filler words (use the counts), vagueness, missing STAR structure, no metrics.
6) Per-question scores on one line: Q1: x/10, Q2: x/10, ...
7) An overall score out of 10 with a one-line justification.
Plain text, no markdown symbols. End your response with one final line in exactly this format: SCORE: X/10`;

const FILLER_RE = /\b(um+|uh+|erm+|like|basically|you know|kind of|kinda|sort of|literally|honestly|i mean)\b/gi;

export default function OnAir() {
  const [phase, setPhase] = useState("setup"); // setup | interview | feedback
  const [role, setRole] = useState("");
  const [level, setLevel] = useState("mid-level");
  const [total, setTotal] = useState(10);
  const [persona, setPersona] = useState("hr");
  const [jobDesc, setJobDesc] = useState("");
  const [showJD, setShowJD] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [srOk, setSrOk] = useState(true);
  const [err, setErr] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [stats, setStats] = useState([]); // {secs, fillers} per answer
  const [history, setHistory] = useState([]);
  const recRef = useRef(null);
  const endRef = useRef(null);
  const draftRef = useRef("");
  const questionAtRef = useRef(null);
  draftRef.current = draft;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  // Load past session history
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("onair-history");
        if (r?.value) setHistory(JSON.parse(r.value));
      } catch {}
    })();
  }, []);

  // Answer timer — ticks while a question is waiting for an answer
  useEffect(() => {
    if (phase !== "interview" || busy) return;
    const t = setInterval(() => {
      if (questionAtRef.current)
        setElapsed(Math.floor((Date.now() - questionAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [phase, busy]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setSrOk(false); return; }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    let base = "";
    rec.onstart = () => { base = draftRef.current ? draftRef.current + " " : ""; };
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setDraft((base + text).trimStart());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => { setListening(false); setErr("Mic unavailable here — type your answer instead."); };
    recRef.current = rec;
    return () => rec.abort();
  }, []);

  const speak = (text) => {
    if (!voiceOn || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  };

  const markQuestionShown = () => {
    questionAtRef.current = Date.now();
    setElapsed(0);
  };

  const toggleMic = () => {
    if (!recRef.current) return;
    if (listening) { recRef.current.stop(); setListening(false); }
    else {
      setErr("");
      window.speechSynthesis?.cancel();
      try { recRef.current.start(); setListening(true); }
      catch { setErr("Couldn't start the mic — type your answer instead."); }
    }
  };

  const callClaude = async (historyArr, sys) => {
    // The artifact API only accepts model, max_tokens (1000), and messages —
    // so the interviewer instructions ride inside the first user message.
    const apiMsgs = [
      { role: "user", content: sys + "\n\n---\n\n" + historyArr[0].content },
      ...historyArr.slice(1),
    ];
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: apiMsgs,
      }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "API error");
    return data.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
  };

  const sysPrompt = () => SYSTEM(role, level, total, persona, jobDesc);

  const start = async () => {
    if (!role.trim()) { setErr("Enter the role you're interviewing for."); return; }
    setErr(""); setBusy(true); setPhase("interview"); setStats([]);
    const h = [{ role: "user", content: "I'm ready. Please begin the interview with your first question." }];
    try {
      const q = await callClaude(h, sysPrompt());
      setMsgs([...h, { role: "assistant", content: q }]);
      speak(q);
      markQuestionShown();
    } catch (e) {
      setErr("Couldn't reach the interviewer: " + e.message);
      setPhase("setup");
    }
    setBusy(false);
  };

  const countFillers = (text) => (text.match(FILLER_RE) || []).length;

  const send = async () => {
    const answer = draft.trim();
    if (!answer || busy) return;
    if (listening) { recRef.current?.stop(); setListening(false); }
    const secs = questionAtRef.current
      ? Math.floor((Date.now() - questionAtRef.current) / 1000) : 0;
    const newStats = [...stats, { secs, fillers: countFillers(answer) }];
    setStats(newStats);
    setDraft(""); setErr("");
    const h = [...msgs, { role: "user", content: answer }];
    setMsgs(h); setBusy(true);
    try {
      const reply = await callClaude(h, sysPrompt());
      if (reply.includes("[INTERVIEW_COMPLETE]")) { await finish(h, newStats); return; }
      setMsgs([...h, { role: "assistant", content: reply }]);
      speak(reply);
      markQuestionShown();
    } catch (e) { setErr("Connection hiccup: " + e.message); }
    setBusy(false);
  };

  // Re-answer the previous question: remove the follow-up question
  // and your last answer, and restore it to the input for editing
  const redoLast = () => {
    if (busy || msgs.length < 4) return;
    const m = [...msgs];
    const lastQ = m.pop(); // interviewer's follow-up
    const lastA = m.pop(); // your last answer
    if (lastQ.role !== "assistant" || lastA.role !== "user") return;
    window.speechSynthesis?.cancel();
    setMsgs(m);
    setDraft(lastA.content);
    setStats(stats.slice(0, -1));
    markQuestionShown();
  };

  const finish = async (historyArg, statsArg) => {
    const h = historyArg || msgs;
    const st = statsArg || stats;
    if (listening) { recRef.current?.stop(); setListening(false); }
    window.speechSynthesis?.cancel();
    setBusy(true); setPhase("feedback");
    try {
      const fb = await callClaude(
        [...h, { role: "user", content: feedbackPrompt(st, st.reduce((a, s) => a + s.fillers, 0)) }],
        sysPrompt()
      );
      const clean = fb.replace("[INTERVIEW_COMPLETE]", "").trim();
      setFeedback(clean);
      // Save score to session history
      const m = clean.match(/SCORE:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
      if (m) {
        const entry = {
          d: new Date().toLocaleDateString(),
          role: role.slice(0, 40),
          level,
          n: st.length,
          score: parseFloat(m[1]),
        };
        const next = [entry, ...history].slice(0, 10);
        setHistory(next);
        try { await window.storage.set("onair-history", JSON.stringify(next)); } catch {}
      }
    } catch (e) { setFeedback("Couldn't generate feedback: " + e.message); }
    setBusy(false);
  };

  const reset = () => {
    window.speechSynthesis?.cancel();
    setPhase("setup"); setMsgs([]); setFeedback(""); setDraft(""); setErr(""); setStats([]);
  };

  const answered = msgs.filter((m) => m.role === "user").length - 1;
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timerColor = elapsed > 120 ? "#FF4136" : elapsed > 90 ? "#E8A33D" : "#9C8B7A";

  return (
    <div style={S.app}>
      <style>{CSS}</style>

      <div style={S.signRow}>
        <div className={listening ? "sign lit" : "sign"}>
          <span className={listening ? "dot lit" : "dot"} />
          ON&nbsp;AIR
        </div>
      </div>
      <p style={S.tagline}>voice interview practice</p>

      {phase === "setup" && (
        <div style={S.card}>
          <label style={S.label}>Role you're interviewing for</label>
          <input
            style={S.input}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. IT Support Specialist"
          />
          <div style={S.rowTwo}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Seniority</label>
              <select style={S.input} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="entry-level">Entry level</option>
                <option value="mid-level">Mid level</option>
                <option value="senior">Senior</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Questions</label>
              <select style={S.input} value={total} onChange={(e) => setTotal(+e.target.value)}>
                <option value={7}>7 — quick</option>
                <option value={10}>10 — standard</option>
                <option value={15}>15 — full round</option>
              </select>
            </div>
          </div>
          <div>
            <label style={S.label}>Interviewer style</label>
            <select style={S.input} value={persona} onChange={(e) => setPersona(e.target.value)}>
              <option value="hr">Friendly HR recruiter</option>
              <option value="lead">Skeptical tech lead</option>
              <option value="panel">Rapid-fire panel</option>
            </select>
          </div>
          <button style={S.linkBtn} onClick={() => setShowJD(!showJD)}>
            {showJD ? "− Hide job posting" : "+ Paste a real job posting (questions will target it)"}
          </button>
          {showJD && (
            <textarea
              style={{ ...S.input, resize: "vertical" }}
              rows={5}
              value={jobDesc}
              onChange={(e) => setJobDesc(e.target.value)}
              placeholder="Paste the job description here…"
            />
          )}
          <label style={S.check}>
            <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
            Interviewer speaks questions aloud
          </label>
          {err && <p style={S.err}>{err}</p>}
          <button style={S.primary} onClick={start} disabled={busy}>
            {busy ? "Setting up the studio…" : "Start interview"}
          </button>
          {!srOk && (
            <p style={S.note}>Voice input isn't supported in this browser — you can type your answers.</p>
          )}
          {history.length > 0 && (
            <div style={S.histBox}>
              <div style={S.label}>Past sessions</div>
              {history.map((hh, i) => (
                <div key={i} style={S.histRow}>
                  <span style={{ color: "#9C8B7A" }}>{hh.d}</span>
                  <span style={S.histRole}>{hh.role} · {hh.n}q</span>
                  <span style={{ color: hh.score >= 7 ? "#7FBF6A" : hh.score >= 5 ? "#E8A33D" : "#FF8A80", fontWeight: 700 }}>
                    {hh.score}/10
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {phase === "interview" && (
        <>
          <div style={S.meta}>
            {role} · {level} · {PERSONA_LABELS[persona]} · answered {Math.max(answered, 0)}/{total}
          </div>
          <div style={S.chat}>
            {msgs.slice(1).map((m, i) => (
              <div key={i} style={m.role === "assistant" ? S.qBubble : S.aBubble}>
                <div style={S.who}>{m.role === "assistant" ? "INTERVIEWER" : "YOU"}</div>
                {m.content}
              </div>
            ))}
            {busy && <div style={S.qBubble}><div style={S.who}>INTERVIEWER</div><span className="think">thinking…</span></div>}
            <div ref={endRef} />
          </div>
          {err && <p style={S.err}>{err}</p>}
          {!busy && (
            <div style={{ ...S.timer, color: timerColor }}>
              ⏱ {fmtTime(elapsed)}{elapsed > 120 ? " — wrap it up" : elapsed > 90 ? " — getting long" : ""}
            </div>
          )}
          <div style={S.inputBar}>
            {srOk && (
              <button
                className={listening ? "mic on" : "mic"}
                onClick={toggleMic}
                aria-label={listening ? "Stop recording" : "Answer by voice"}
                title={listening ? "Stop recording" : "Answer by voice"}
              >
                {listening ? "■" : "🎙"}
              </button>
            )}
            <textarea
              style={S.textarea}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={listening ? "Listening… speak your answer" : "Speak or type your answer"}
            />
            <button style={S.send} onClick={send} disabled={busy || !draft.trim()}>Send</button>
          </div>
          <div style={S.rowTwo}>
            <button style={{ ...S.ghost, flex: 1 }} onClick={redoLast} disabled={busy || msgs.length < 4}>
              Re-answer previous
            </button>
            <button style={{ ...S.ghost, flex: 1 }} onClick={() => finish()} disabled={busy || answered < 1}>
              End & get feedback
            </button>
          </div>
        </>
      )}

      {phase === "feedback" && (
        <div style={S.card}>
          <div style={S.fbHead}>COACH'S FEEDBACK</div>
          {stats.length > 0 && !busy && (
            <div style={S.statStrip}>
              <span>Answers: <b>{stats.length}</b></span>
              <span>Avg time: <b>{fmtTime(Math.round(stats.reduce((a, s) => a + s.secs, 0) / stats.length))}</b></span>
              <span>Filler words: <b>{stats.reduce((a, s) => a + s.fillers, 0)}</b></span>
            </div>
          )}
          {busy ? (
            <p className="think" style={{ color: "#E8A33D" }}>Reviewing your tape…</p>
          ) : (
            <pre style={S.fb}>{feedback}</pre>
          )}
          <button style={S.primary} onClick={reset}>New interview</button>
        </div>
      )}
    </div>
  );
}

const S = {
  app: {
    minHeight: "100vh",
    background: "#171210",
    color: "#F3EADE",
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    padding: "28px 16px 48px",
    maxWidth: 760,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
  },
  signRow: { display: "flex", justifyContent: "center" },
  tagline: {
    textAlign: "center",
    letterSpacing: "0.35em",
    textTransform: "uppercase",
    fontSize: 11,
    color: "#9C8B7A",
    margin: "10px 0 26px",
  },
  card: {
    background: "#221A17",
    border: "1px solid #35291F",
    borderRadius: 14,
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  label: { fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#B9A48D" },
  input: {
    width: "100%",
    background: "#171210",
    border: "1px solid #3E3025",
    borderRadius: 8,
    color: "#F3EADE",
    padding: "12px 14px",
    fontSize: 16,
    boxSizing: "border-box",
  },
  rowTwo: { display: "flex", gap: 12, marginTop: 10 },
  check: { display: "flex", gap: 8, alignItems: "center", fontSize: 14, color: "#D8C8B4" },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#E8A33D",
    fontSize: 14,
    textAlign: "left",
    padding: 0,
    cursor: "pointer",
  },
  primary: {
    background: "#FF4136",
    color: "#1A0D0B",
    fontWeight: 700,
    border: "none",
    borderRadius: 8,
    padding: "14px",
    fontSize: 16,
    cursor: "pointer",
  },
  ghost: {
    background: "transparent",
    color: "#B9A48D",
    border: "1px solid #3E3025",
    borderRadius: 8,
    padding: "10px",
    fontSize: 14,
    cursor: "pointer",
  },
  meta: {
    textAlign: "center",
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#9C8B7A",
    marginBottom: 12,
  },
  chat: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    overflowY: "auto",
    paddingBottom: 8,
  },
  qBubble: {
    background: "#221A17",
    border: "1px solid #35291F",
    borderRadius: "12px 12px 12px 4px",
    padding: "12px 14px",
    maxWidth: "92%",
    lineHeight: 1.5,
  },
  aBubble: {
    background: "#2A3328",
    border: "1px solid #3C4A38",
    borderRadius: "12px 12px 4px 12px",
    padding: "12px 14px",
    maxWidth: "92%",
    alignSelf: "flex-end",
    lineHeight: 1.5,
  },
  who: { fontSize: 10, letterSpacing: "0.2em", color: "#9C8B7A", marginBottom: 6 },
  timer: { textAlign: "right", fontSize: 13, marginTop: 10, fontVariantNumeric: "tabular-nums" },
  inputBar: { display: "flex", gap: 8, marginTop: 6, alignItems: "flex-end" },
  textarea: {
    flex: 1,
    background: "#221A17",
    border: "1px solid #3E3025",
    borderRadius: 10,
    color: "#F3EADE",
    padding: "10px 12px",
    fontSize: 16,
    resize: "none",
    boxSizing: "border-box",
  },
  send: {
    background: "#E8A33D",
    color: "#1A0D0B",
    fontWeight: 700,
    border: "none",
    borderRadius: 10,
    padding: "12px 18px",
    fontSize: 15,
    cursor: "pointer",
  },
  err: { color: "#FF8A80", fontSize: 13, margin: "6px 0 0" },
  note: { color: "#9C8B7A", fontSize: 13, margin: 0 },
  fbHead: { fontSize: 12, letterSpacing: "0.25em", color: "#E8A33D" },
  fb: {
    whiteSpace: "pre-wrap",
    fontFamily: "inherit",
    fontSize: 15,
    lineHeight: 1.6,
    margin: 0,
    color: "#EDE0CF",
  },
  statStrip: {
    display: "flex",
    gap: 18,
    fontSize: 13,
    color: "#B9A48D",
    borderBottom: "1px solid #35291F",
    paddingBottom: 10,
  },
  histBox: { marginTop: 8, display: "flex", flexDirection: "column", gap: 6 },
  histRow: { display: "flex", gap: 10, fontSize: 13, alignItems: "baseline" },
  histRole: { flex: 1, color: "#D8C8B4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Sans:wght@400;600;700&display=swap');
.sign {
  font-family: 'Bebas Neue', 'Arial Narrow', sans-serif;
  font-size: 44px;
  letter-spacing: 0.18em;
  color: #5A2E28;
  border: 2px solid #3E2A22;
  border-radius: 10px;
  padding: 6px 26px 2px;
  display: flex;
  align-items: center;
  gap: 14px;
  background: #1D1512;
  transition: color .3s, border-color .3s, box-shadow .3s, text-shadow .3s;
  user-select: none;
}
.sign.lit {
  color: #FF4136;
  border-color: #FF4136;
  text-shadow: 0 0 18px rgba(255,65,54,.75);
  box-shadow: 0 0 28px rgba(255,65,54,.35), inset 0 0 14px rgba(255,65,54,.15);
  animation: pulse 1.6s ease-in-out infinite;
}
.dot { width: 12px; height: 12px; border-radius: 50%; background: #3E2A22; display: inline-block; }
.dot.lit { background: #FF4136; box-shadow: 0 0 12px rgba(255,65,54,.9); }
@keyframes pulse {
  0%,100% { box-shadow: 0 0 28px rgba(255,65,54,.35), inset 0 0 14px rgba(255,65,54,.15); }
  50% { box-shadow: 0 0 40px rgba(255,65,54,.55), inset 0 0 18px rgba(255,65,54,.22); }
}
@media (prefers-reduced-motion: reduce) { .sign.lit { animation: none; } }
.mic {
  width: 52px; height: 52px; border-radius: 50%;
  border: 1px solid #3E3025; background: #221A17; color: #F3EADE;
  font-size: 20px; cursor: pointer; flex-shrink: 0;
  transition: background .2s, border-color .2s;
}
.mic.on { background: #FF4136; border-color: #FF4136; color: #1A0D0B; }
.mic:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 2px solid #E8A33D; outline-offset: 2px;
}
.think { opacity: .7; animation: blink 1.2s ease-in-out infinite; }
@keyframes blink { 50% { opacity: .3; } }
`;
