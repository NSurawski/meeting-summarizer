import { useState, useRef } from "react";

const SYSTEM_PROMPT = `You are an expert meeting summarizer for B2B SaaS teams. Analyze the meeting transcript and return ONLY valid JSON with this exact structure:

{
  "title": "inferred meeting title or topic",
  "tldr": "2-3 sentence executive summary of the entire meeting",
  "topics": [
    { "title": "topic name", "summary": "brief description of what was discussed" }
  ],
  "decisions": [
    { "decision": "what was decided", "context": "brief context or rationale" }
  ],
  "actionItems": [
    { "task": "what needs to be done", "owner": "person responsible or 'TBD'", "due": "deadline or 'TBD'" }
  ],
  "openQuestions": [
    { "question": "unresolved question or parking lot item" }
  ]
}

Rules:
- Be concise and specific
- Infer owners from context (e.g. if someone says "I'll handle X", they own it)
- If something is unclear, mark it as TBD
- Return ONLY the JSON object, no markdown, no explanation`;

const SAMPLE_TRANSCRIPT = `Sarah: Okay let's get started. Today we need to finalize the Q3 roadmap and talk through the dashboard redesign feedback.

Marcus: I reviewed the user research from last week. The main complaint is that the filters are too buried. Three separate customers mentioned it in interviews.

Sarah: Right, that aligns with what we're seeing in the support tickets. We got 47 tickets about filters in June alone.

Marcus: So I think we need to move the filter panel to the top of the dashboard. We can prototype it this week.

Sarah: Agreed. Let's make that a priority for this sprint. Marcus can you own the prototype by Thursday?

Marcus: Yes, I can have a mockup ready by Thursday EOD.

Sarah: Great. Now for Q3 roadmap — we need to decide between the bulk export feature and the API rate limiting work. Engineering says we can only do one this quarter.

Jordan: From a customer success perspective, bulk export is coming up constantly. At least 8 enterprise accounts have requested it.

Sarah: That's significant. What's the revenue impact Jordan?

Jordan: Rough estimate, we risk losing 2 of those accounts at renewal if we don't ship it. That's about 180k ARR.

Sarah: Okay that makes the decision pretty clear. We'll prioritize bulk export for Q3. Jordan can you put together a one-pager on requirements by end of next week?

Jordan: Sure, I'll have that to you by Friday the 14th.

Sarah: Perfect. One thing still open — we haven't decided whether to build the export as CSV only or also support PDF. Engineering needs to know.

Marcus: CSV is probably 80% of the use case but some customers specifically asked for PDF.

Sarah: Let's table that for now and get more data. I'll send a quick survey to the 8 accounts. Any other items?

Jordan: Just a note that the new onboarding flow goes live Monday. We should watch drop-off metrics closely next week.

Sarah: Good call. I'll set up a dashboard to track it. Okay I think we're good — I'll send out notes after this.`;

export default function MeetingSummarizer() {
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savedMeetings, setSavedMeetings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("meetingSummaries") || "[]"); }
    catch { return []; }
  });
  const [trackerOpen, setTrackerOpen] = useState(true);
  const textareaRef = useRef(null);

  const unresolvedItems = savedMeetings.flatMap(m => [
    ...m.actionItems.filter(a => !a.resolved).map((a, i) => ({ ...a, type: "action", index: i, origIndex: m.actionItems.indexOf(a), meetingId: m.id, meetingTitle: m.title })),
    ...m.openQuestions.filter(q => !q.resolved).map((q, i) => ({ ...q, type: "question", index: i, origIndex: m.openQuestions.indexOf(q), meetingId: m.id, meetingTitle: m.title }))
  ]);

  const toggleResolved = (meetingId, type, index) => {
    const updated = savedMeetings.map(m => {
      if (m.id !== meetingId) return m;
      const key = type === "action" ? "actionItems" : "openQuestions";
      return { ...m, [key]: m[key].map((item, i) => i === index ? { ...item, resolved: !item.resolved } : item) };
    });
    setSavedMeetings(updated);
    localStorage.setItem("meetingSummaries", JSON.stringify(updated));
  };

  const clearHistory = () => {
    setSavedMeetings([]);
    localStorage.removeItem("meetingSummaries");
  };

  const loadSample = () => {
    setTranscript(SAMPLE_TRANSCRIPT);
    setSummary(null);
    setError(null);
  };

  const summarize = async () => {
    if (!transcript.trim()) return;
    if (!apiKey.trim()) {
      setError("Please enter your Anthropic API key above.");
      return;
    }
    setLoading(true);
    setError(null);
    setSummary(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: `Summarize this meeting transcript:\n\n${transcript}` }]
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content?.map(b => b.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setSummary(parsed);

      const newMeeting = {
        id: "ms_" + Date.now(),
        savedAt: new Date().toISOString(),
        title: parsed.title,
        actionItems: (parsed.actionItems || []).map(a => ({ ...a, resolved: false })),
        openQuestions: (parsed.openQuestions || []).map(q => ({ ...q, resolved: false }))
      };
      const updatedMeetings = [...savedMeetings, newMeeting];
      setSavedMeetings(updatedMeetings);
      localStorage.setItem("meetingSummaries", JSON.stringify(updatedMeetings));
    } catch (err) {
      setError(err.message || "Something went wrong generating the summary. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyAll = () => {
    if (!summary) return;
    const text = [
      `# ${summary.title}`,
      `\n## TL;DR\n${summary.tldr}`,
      summary.topics?.length ? `\n## Topics Discussed\n${summary.topics.map(t => `• ${t.title}: ${t.summary}`).join("\n")}` : "",
      summary.decisions?.length ? `\n## Decisions\n${summary.decisions.map(d => `• ${d.decision}${d.context ? ` (${d.context})` : ""}`).join("\n")}` : "",
      summary.actionItems?.length ? `\n## Action Items\n${summary.actionItems.map(a => `• ${a.task} — Owner: ${a.owner}, Due: ${a.due}`).join("\n")}` : "",
      summary.openQuestions?.length ? `\n## Open Questions\n${summary.openQuestions.map(q => `• ${q.question}`).join("\n")}` : ""
    ].filter(Boolean).join("\n");

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const reset = () => {
    setTranscript("");
    setSummary(null);
    setError(null);
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0A0E1A",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      color: "#E8EDF5"
    }}>
      {/* Subtle grid background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)",
        backgroundSize: "48px 48px"
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>

        {/* Header */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#4ADE80",
              boxShadow: "0 0 12px #4ADE80"
            }} />
            <span style={{ fontSize: 11, letterSpacing: 3, color: "#4ADE80", fontFamily: "'Courier New', monospace", textTransform: "uppercase" }}>
              AI-Powered
            </span>
          </div>
          <h1 style={{
            fontSize: 42, fontWeight: 700, margin: "0 0 8px",
            color: "#FFFFFF",
            letterSpacing: -1,
            lineHeight: 1.1
          }}>
            Meeting Summarizer
          </h1>
          <p style={{ fontSize: 16, color: "#7A8499", margin: 0, lineHeight: 1.6 }}>
            Paste any meeting transcript. Get structured decisions, action items, and next steps — instantly.
          </p>
        </div>

        {/* API Key Input */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "12px 20px",
          marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12
        }}>
          <span style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, whiteSpace: "nowrap" }}>
            API KEY
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-ant-..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none", outline: "none",
              color: "#C8D4E8",
              fontSize: 14,
              fontFamily: "'Courier New', monospace"
            }}
          />
          {apiKey && (
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#4ADE80",
              boxShadow: "0 0 8px #4ADE80"
            }} />
          )}
        </div>

        {/* Follow-up Tracker */}
        {unresolvedItems.length > 0 && (
          <div style={{
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
            borderRadius: 14,
            marginBottom: 16,
            overflow: "hidden"
          }}>
            <button
              onClick={() => setTrackerOpen(!trackerOpen)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 24px",
                background: "transparent", border: "none", cursor: "pointer", color: "#FBBF24"
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: 3, fontFamily: "'Courier New', monospace", textTransform: "uppercase" }}>
                FOLLOW-UP TRACKER ({unresolvedItems.length} open)
              </span>
              <span style={{ fontSize: 14 }}>{trackerOpen ? "▾" : "▸"}</span>
            </button>

            {trackerOpen && (
              <div style={{ padding: "0 24px 20px" }}>
                {Object.entries(
                  unresolvedItems.reduce((groups, item) => {
                    (groups[item.meetingTitle] = groups[item.meetingTitle] || []).push(item);
                    return groups;
                  }, {})
                ).map(([title, items]) => (
                  <div key={title} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace", marginBottom: 8 }}>
                      {title}
                    </div>
                    {items.map((item, i) => (
                      <div
                        key={i}
                        onClick={() => toggleResolved(item.meetingId, item.type, item.origIndex)}
                        style={{
                          display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6,
                          padding: "8px 12px", borderRadius: 8,
                          background: "rgba(255,255,255,0.03)",
                          cursor: "pointer",
                          borderLeft: `3px solid ${item.type === "action" ? "#4ADE80" : "#FBBF24"}`,
                          transition: "background 0.15s"
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
                        onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"}
                      >
                        <span style={{ color: item.type === "action" ? "#4ADE80" : "#FBBF24", fontSize: 14, marginTop: 1, flexShrink: 0 }}>
                          ○
                        </span>
                        <div>
                          <div style={{ fontSize: 14, color: "#C8D4E8", lineHeight: 1.5 }}>
                            {item.type === "action" ? item.task : item.question}
                          </div>
                          {item.type === "action" && item.owner && (
                            <span style={{ fontSize: 11, color: "#7A8499", fontFamily: "'Courier New', monospace" }}>
                              {item.owner}{item.due ? ` · ${item.due}` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!summary ? (
          /* Input Panel */
          <div>
            <div style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
              overflow: "hidden",
              marginBottom: 16
            }}>
              {/* Textarea toolbar */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)"
              }}>
                <span style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1 }}>
                  TRANSCRIPT INPUT
                </span>
                <button
                  onClick={loadSample}
                  style={{
                    background: "none", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6, padding: "4px 12px",
                    color: "#9BAACC", fontSize: 12, cursor: "pointer",
                    fontFamily: "'Courier New', monospace",
                    transition: "all 0.15s"
                  }}
                  onMouseEnter={e => { e.target.style.borderColor = "rgba(255,255,255,0.3)"; e.target.style.color = "#E8EDF5"; }}
                  onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.12)"; e.target.style.color = "#9BAACC"; }}
                >
                  Load sample →
                </button>
              </div>

              <textarea
                ref={textareaRef}
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                placeholder="Paste your meeting transcript here...

Works with:
• Zoom / Google Meet / Teams transcripts
• Manual notes or copied text
• Any format — the AI handles the rest"
                style={{
                  width: "100%", minHeight: 320,
                  background: "transparent",
                  border: "none", outline: "none",
                  padding: "20px",
                  color: "#C8D4E8",
                  fontSize: 14, lineHeight: 1.7,
                  resize: "vertical",
                  fontFamily: "'Georgia', serif",
                  boxSizing: "border-box"
                }}
              />

              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 20px",
                borderTop: "1px solid rgba(255,255,255,0.06)"
              }}>
                <span style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace" }}>
                  {transcript.trim().split(/\s+/).filter(Boolean).length} words
                </span>
                {transcript && (
                  <button
                    onClick={reset}
                    style={{
                      background: "none", border: "none",
                      color: "#7A8499", fontSize: 12, cursor: "pointer",
                      fontFamily: "'Courier New', monospace"
                    }}
                  >
                    clear
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div style={{
                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 10, padding: "12px 16px", marginBottom: 16,
                color: "#FCA5A5", fontSize: 14
              }}>
                {error}
              </div>
            )}

            <button
              onClick={summarize}
              disabled={!transcript.trim() || loading}
              style={{
                width: "100%", padding: "16px",
                background: transcript.trim() && !loading
                  ? "linear-gradient(135deg, #1E40AF, #2563EB)"
                  : "rgba(255,255,255,0.05)",
                border: "1px solid " + (transcript.trim() && !loading ? "#3B82F6" : "rgba(255,255,255,0.08)"),
                borderRadius: 12, cursor: transcript.trim() && !loading ? "pointer" : "not-allowed",
                color: transcript.trim() && !loading ? "#FFFFFF" : "#4A5568",
                fontSize: 16, fontWeight: 600,
                fontFamily: "'Georgia', serif",
                letterSpacing: 0.5,
                transition: "all 0.2s",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 10
              }}
              onMouseEnter={e => { if (transcript.trim() && !loading) e.target.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.target.style.transform = "translateY(0)"; }}
            >
              {loading ? (
                <>
                  <span style={{
                    display: "inline-block", width: 16, height: 16,
                    border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
                    borderRadius: "50%",
                    animation: "spin 0.8s linear infinite"
                  }} />
                  Analyzing transcript...
                </>
              ) : "Generate Summary →"}
            </button>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          /* Summary Output */
          <div>
            {/* Action bar */}
            <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
              <button
                onClick={reset}
                style={{
                  flex: 1, padding: "11px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10, cursor: "pointer",
                  color: "#9BAACC", fontSize: 13,
                  fontFamily: "'Courier New', monospace"
                }}
              >
                ← New transcript
              </button>
              <button
                onClick={copyAll}
                style={{
                  flex: 1, padding: "11px",
                  background: copied ? "rgba(74,222,128,0.15)" : "rgba(59,130,246,0.15)",
                  border: `1px solid ${copied ? "rgba(74,222,128,0.4)" : "rgba(59,130,246,0.4)"}`,
                  borderRadius: 10, cursor: "pointer",
                  color: copied ? "#4ADE80" : "#60A5FA", fontSize: 13,
                  fontFamily: "'Courier New', monospace",
                  transition: "all 0.2s"
                }}
              >
                {copied ? "✓ Copied!" : "Copy all →"}
              </button>
            </div>

            <div style={{ fontSize: 12, color: "#4ADE80", fontFamily: "'Courier New', monospace", marginBottom: 16 }}>
              ✓ {summary.actionItems?.length || 0} action items + {summary.openQuestions?.length || 0} open questions saved to tracker
            </div>

            {/* Title + TL;DR */}
            <div style={{
              background: "linear-gradient(135deg, rgba(37,99,235,0.15), rgba(30,64,175,0.1))",
              border: "1px solid rgba(59,130,246,0.25)",
              borderRadius: 16, padding: "28px 32px",
              marginBottom: 16
            }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#60A5FA", fontFamily: "'Courier New', monospace", marginBottom: 12, textTransform: "uppercase" }}>
                Meeting Summary
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, color: "#FFFFFF", margin: "0 0 16px", letterSpacing: -0.5 }}>
                {summary.title}
              </h2>
              <p style={{ fontSize: 15, color: "#B0C0DE", lineHeight: 1.7, margin: 0 }}>
                {summary.tldr}
              </p>
            </div>

            {/* Grid: Decisions + Action Items */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>

              {/* Decisions */}
              {summary.decisions?.length > 0 && (
                <Section
                  label="DECISIONS"
                  accent="#A78BFA"
                  bg="rgba(167,139,250,0.08)"
                  borderColor="rgba(167,139,250,0.2)"
                >
                  {summary.decisions.map((d, i) => (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 14, color: "#E2E8F0", lineHeight: 1.5, fontWeight: 600 }}>
                        {d.decision}
                      </div>
                      {d.context && (
                        <div style={{ fontSize: 13, color: "#8090B0", marginTop: 4, lineHeight: 1.5, fontStyle: "italic" }}>
                          {d.context}
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              )}

              {/* Action Items */}
              {summary.actionItems?.length > 0 && (
                <Section
                  label="ACTION ITEMS"
                  accent="#4ADE80"
                  bg="rgba(74,222,128,0.08)"
                  borderColor="rgba(74,222,128,0.2)"
                >
                  {summary.actionItems.map((a, i) => (
                    <div key={i} style={{
                      marginBottom: 12, padding: "10px 14px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8,
                      borderLeft: "3px solid #4ADE80"
                    }}>
                      <div style={{ fontSize: 14, color: "#E2E8F0", lineHeight: 1.5, marginBottom: 6 }}>
                        {a.task}
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        <Tag label={a.owner} color="#4ADE80" icon="👤" />
                        <Tag label={a.due} color="#FBBF24" icon="📅" />
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </div>

            {/* Topics */}
            {summary.topics?.length > 0 && (
              <Section
                label="TOPICS DISCUSSED"
                accent="#60A5FA"
                bg="rgba(96,165,250,0.06)"
                borderColor="rgba(96,165,250,0.15)"
                style={{ marginBottom: 16 }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {summary.topics.map((t, i) => (
                    <div key={i} style={{
                      padding: "12px 16px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)"
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#93C5FD", marginBottom: 6, fontFamily: "'Courier New', monospace" }}>
                        {t.title}
                      </div>
                      <div style={{ fontSize: 13, color: "#8090B0", lineHeight: 1.5 }}>
                        {t.summary}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Open Questions */}
            {summary.openQuestions?.length > 0 && (
              <Section
                label="OPEN QUESTIONS"
                accent="#FBBF24"
                bg="rgba(251,191,36,0.06)"
                borderColor="rgba(251,191,36,0.2)"
              >
                {summary.openQuestions.map((q, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10
                  }}>
                    <span style={{ color: "#FBBF24", marginTop: 2, flexShrink: 0 }}>?</span>
                    <span style={{ fontSize: 14, color: "#C8D4E8", lineHeight: 1.6 }}>{q.question}</span>
                  </div>
                ))}
              </Section>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 48, paddingTop: 24,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <span style={{ fontSize: 12, color: "#3A4560", fontFamily: "'Courier New', monospace" }}>
            Meeting Summarizer v1.0
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {savedMeetings.length > 0 && (
              <button
                onClick={clearHistory}
                style={{
                  background: "none", border: "none",
                  color: "#3A4560", fontSize: 12, cursor: "pointer",
                  fontFamily: "'Courier New', monospace",
                  transition: "color 0.15s"
                }}
                onMouseEnter={e => e.target.style.color = "#FCA5A5"}
                onMouseLeave={e => e.target.style.color = "#3A4560"}
              >
                Clear history
              </button>
            )}
            <span style={{ fontSize: 12, color: "#3A4560", fontFamily: "'Courier New', monospace" }}>
              Powered by Claude
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, accent, bg, borderColor, children, style }) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 14, padding: "20px 24px",
      marginBottom: 0,
      ...style
    }}>
      <div style={{
        fontSize: 11, letterSpacing: 3, color: accent,
        fontFamily: "'Courier New', monospace",
        marginBottom: 16, textTransform: "uppercase"
      }}>
        {label}
      </div>
      {children}
    </div>
  );
}

function Tag({ label, color, icon }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 6,
      background: "rgba(255,255,255,0.05)",
      border: `1px solid rgba(255,255,255,0.08)`,
      fontSize: 11, color: color,
      fontFamily: "'Courier New', monospace"
    }}>
      {icon} {label}
    </span>
  );
}
