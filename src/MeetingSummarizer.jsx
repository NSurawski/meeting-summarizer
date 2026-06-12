import { useState, useRef, useMemo, useEffect } from "react";
import { demoSummary } from "./demoSummary";

function buildSystemPrompt({ verbosity = "concise", extraSections = [], customInstructions = "" } = {}) {
  const parkingLotSchema = extraSections.includes("parkingLot")
    ? `,\n  "parkingLot": [\n    { "item": "miscellaneous item, tangent, or topic to revisit later" }\n  ]`
    : "";
  const keyQuotesSchema = extraSections.includes("keyQuotes")
    ? `,\n  "keyQuotes": [\n    { "quote": "notable quote or statement", "speaker": "person's name or 'Unknown'" }\n  ]`
    : "";
  const verbosityRule = verbosity === "detailed"
    ? "Be thorough — include context, rationale, and relevant background for each item."
    : "Be concise and specific.";
  const customRule = customInstructions.trim()
    ? `\n- ${customInstructions.trim()}`
    : "";

  return `You are an expert meeting summarizer for B2B SaaS teams. Analyze the meeting transcript and return ONLY valid JSON with this exact structure:

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
  ]${parkingLotSchema}${keyQuotesSchema}
}

Rules:
- ${verbosityRule}
- Infer owners from context (e.g. if someone says "I'll handle X", they own it)
- If something is unclear, mark it as TBD${customRule}
- Return ONLY the JSON object, no markdown, no explanation`;
}

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

function extractPartial(raw) {
  const text = raw.replace(/```json|```/g, "").trim();
  const result = {};

  const extractStr = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "s");
    const m = text.match(re);
    if (!m) return null;
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  };

  const extractArr = (key) => {
    const keyIdx = text.indexOf(`"${key}"`);
    if (keyIdx === -1) return null;
    const bracketIdx = text.indexOf("[", keyIdx);
    if (bracketIdx === -1) return null;
    let depth = 0, end = -1;
    for (let i = bracketIdx; i < text.length; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null;
    try { return JSON.parse(text.slice(bracketIdx, end + 1)); } catch { return null; }
  };

  result.title = extractStr("title");
  result.tldr = extractStr("tldr");
  result.topics = extractArr("topics");
  result.decisions = extractArr("decisions");
  result.actionItems = extractArr("actionItems");
  result.openQuestions = extractArr("openQuestions");
  result.parkingLot = extractArr("parkingLot");
  result.keyQuotes = extractArr("keyQuotes");

  return result;
}

export default function MeetingSummarizer() {
  const [transcript, setTranscript] = useState("");
  const [wordCount, setWordCount] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWordCount(transcript.trim() ? transcript.trim().split(/\s+/).length : 0), 300);
    return () => clearTimeout(t);
  }, [transcript]);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setTranscript("");
        setSummary(null);
        setError(null);
        setViewingHistory(false);
        setIsEditing(false);
        setEditableSummary(null);
        setPendingTags([]);
        setTagInput("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropicApiKey") || "");
  const [model, setModel] = useState(() => localStorage.getItem("meetingModel") || "claude-sonnet-4-6");
  const [savedMeetings, setSavedMeetings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("meetingSummaries") || "[]"); }
    catch { return []; }
  });
  const [trackerOpen, setTrackerOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [filterOwner, setFilterOwner] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editableSummary, setEditableSummary] = useState(null);
  const [pendingTags, setPendingTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [promptSettings, setPromptSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem("promptSettings") || "{}"); }
    catch { return {}; }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const verbosity = promptSettings.verbosity || "concise";
  const extraSections = promptSettings.extraSections || [];
  const customInstructions = promptSettings.customInstructions || "";
  const hasCustomSettings = verbosity !== "concise" || extraSections.length > 0 || customInstructions.trim();
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let text = e.target.result;
      if (file.name.endsWith(".vtt")) {
        text = text.split("\n")
          .filter(line => !/^WEBVTT|^\d{2}:\d{2}|^NOTE/.test(line) && line.trim() !== "")
          .join("\n").trim();
      }
      setTranscript(text);
      setSummary(null);
      setError(null);
    };
    reader.readAsText(file);
  };

  const unresolvedItems = useMemo(() => savedMeetings.flatMap(m => [
    ...m.actionItems.filter(a => !a.resolved).map((a, i) => ({ ...a, type: "action", index: i, origIndex: m.actionItems.indexOf(a), meetingId: m.id, meetingTitle: m.title })),
    ...m.openQuestions.filter(q => !q.resolved).map((q, i) => ({ ...q, type: "question", index: i, origIndex: m.openQuestions.indexOf(q), meetingId: m.id, meetingTitle: m.title }))
  ]), [savedMeetings]);

  const uniqueOwners = useMemo(() =>
    [...new Set(unresolvedItems.filter(i => i.type === "action" && i.owner && i.owner !== "TBD").map(i => i.owner))].sort()
  , [unresolvedItems]);

  const uniqueTags = useMemo(() =>
    [...new Set(savedMeetings.flatMap(m => m.tags || []))].sort()
  , [savedMeetings]);

  const filteredItems = useMemo(() => {
    let items = unresolvedItems;
    if (filterTag) {
      const taggedIds = new Set(savedMeetings.filter(m => m.tags?.includes(filterTag)).map(m => m.id));
      items = items.filter(item => taggedIds.has(item.meetingId));
    }
    if (filterOwner) {
      items = items.filter(item => item.type === "action" && item.owner?.toLowerCase() === filterOwner.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(item => {
        const text = item.type === "action" ? item.task : item.question;
        return (
          text?.toLowerCase().includes(q) ||
          item.owner?.toLowerCase().includes(q) ||
          item.meetingTitle?.toLowerCase().includes(q)
        );
      });
    }
    return items;
  }, [unresolvedItems, filterOwner, filterTag, searchQuery, savedMeetings]);

  const filteredMeetings = useMemo(() => {
    if (!searchQuery.trim()) return savedMeetings;
    const q = searchQuery.toLowerCase();
    return savedMeetings.filter(m =>
      m.title?.toLowerCase().includes(q) ||
      m.tldr?.toLowerCase().includes(q) ||
      m.decisions?.some(d => d.decision?.toLowerCase().includes(q) || d.context?.toLowerCase().includes(q)) ||
      m.actionItems?.some(a => a.task?.toLowerCase().includes(q)) ||
      m.openQuestions?.some(oq => oq.question?.toLowerCase().includes(q)) ||
      m.tags?.some(t => t.toLowerCase().includes(q))
    );
  }, [savedMeetings, searchQuery]);

  const commitTitleEdit = (meetingId) => {
    const newTitle = editingTitleValue.trim();
    if (newTitle) {
      const updated = savedMeetings.map(m => m.id === meetingId ? { ...m, title: newTitle } : m);
      setSavedMeetings(updated);
      localStorage.setItem("meetingSummaries", JSON.stringify(updated));
      if (viewingHistory && summary) setSummary(prev => ({ ...prev, title: newTitle }));
    }
    setEditingTitleId(null);
    setEditingTitleValue("");
  };

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

  const resolveAll = () => {
    const updated = savedMeetings.map(m => ({
      ...m,
      actionItems: m.actionItems.map(a => ({ ...a, resolved: true })),
      openQuestions: m.openQuestions.map(q => ({ ...q, resolved: true }))
    }));
    setSavedMeetings(updated);
    localStorage.setItem("meetingSummaries", JSON.stringify(updated));
  };

  const loadSample = () => {
    setTranscript(SAMPLE_TRANSCRIPT);
    setSummary(null);
    setError(null);
  };

  const viewDemo = () => {
    setSummary(demoSummary);
    setIsEditing(false);
    setEditableSummary(null);
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
    setStreamingText("");
    setIsEditing(false);
    setEditableSummary(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 4000,
          stream: true,
          system: [{ type: "text", text: buildSystemPrompt(promptSettings), cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: `Summarize this meeting transcript:\n\n${transcript}` }]
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        const status = response.status;
        if (status === 401) throw new Error("Invalid API key. Please check your key and try again.");
        if (status === 429) throw new Error("Rate limit exceeded. Please wait a moment and try again.");
        if (status === 529) throw new Error("Anthropic API is temporarily overloaded. Please try again in a few seconds.");
        throw new Error(errData?.error?.message || `API error: ${status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;
          try {
            const event = JSON.parse(data);
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              accumulated += event.delta.text;
              setStreamingText(accumulated);
            }
          } catch {}
        }
      }

      const clean = accumulated.replace(/```json|```/g, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        throw new Error("Failed to parse the summary. The AI returned an unexpected format. Please try again.");
      }

      if (!parsed.title || !parsed.tldr) {
        throw new Error("The summary is missing required fields. Please try again with a clearer transcript.");
      }

      setSummary(parsed);
      setEditableSummary({
        title: parsed.title,
        tldr: parsed.tldr,
        topics: parsed.topics || [],
        decisions: parsed.decisions || [],
        actionItems: parsed.actionItems || [],
        openQuestions: parsed.openQuestions || [],
        parkingLot: parsed.parkingLot || [],
        keyQuotes: parsed.keyQuotes || []
      });
      setIsEditing(true);
    } catch (err) {
      if (err.name === "TypeError" && err.message === "Failed to fetch") {
        setError("Network error — could not reach the Anthropic API. Check your internet connection.");
      } else {
        setError(err.message || "Something went wrong generating the summary. Please try again.");
      }
    } finally {
      setLoading(false);
      setStreamingText("");
    }
  };

  const saveToTracker = () => {
    const toSave = editableSummary;
    setSummary(toSave);
    const newMeeting = {
      id: "ms_" + Date.now(),
      savedAt: new Date().toISOString(),
      title: toSave.title,
      tldr: toSave.tldr,
      topics: toSave.topics || [],
      decisions: toSave.decisions || [],
      actionItems: (toSave.actionItems || []).map(a => ({ ...a, resolved: false })),
      openQuestions: (toSave.openQuestions || []).map(q => ({ ...q, resolved: false })),
      parkingLot: toSave.parkingLot || [],
      keyQuotes: toSave.keyQuotes || [],
      tags: pendingTags
    };
    const updatedMeetings = [...savedMeetings, newMeeting];
    setSavedMeetings(updatedMeetings);
    localStorage.setItem("meetingSummaries", JSON.stringify(updatedMeetings));
    setIsEditing(false);
    setPendingTags([]);
    setTagInput("");
  };

  const updatePromptSetting = (key, value) => {
    const updated = { ...promptSettings, [key]: value };
    setPromptSettings(updated);
    localStorage.setItem("promptSettings", JSON.stringify(updated));
  };

  const updateEditField = (field, value) =>
    setEditableSummary(prev => ({ ...prev, [field]: value }));

  const updateEditItem = (field, index, updates) =>
    setEditableSummary(prev => ({
      ...prev,
      [field]: prev[field].map((item, i) => i === index ? { ...item, ...updates } : item)
    }));

  const removeEditItem = (field, index) =>
    setEditableSummary(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }));

  const addEditItem = (field, newItem) =>
    setEditableSummary(prev => ({
      ...prev,
      [field]: [...(prev[field] || []), newItem]
    }));

  const downloadMd = () => {
    if (!summary) return;
    const src = isEditing ? editableSummary : summary;
    const text = [
      `# ${src.title}`,
      `\n## TL;DR\n${src.tldr}`,
      src.topics?.length ? `\n## Topics Discussed\n${src.topics.map(t => `• ${t.title}: ${t.summary}`).join("\n")}` : "",
      src.decisions?.length ? `\n## Decisions\n${src.decisions.map(d => `• ${d.decision}${d.context ? ` (${d.context})` : ""}`).join("\n")}` : "",
      src.actionItems?.length ? `\n## Action Items\n${src.actionItems.map(a => `• ${a.task} — Owner: ${a.owner}, Due: ${a.due}`).join("\n")}` : "",
      src.openQuestions?.length ? `\n## Open Questions\n${src.openQuestions.map(q => `• ${q.question}`).join("\n")}` : "",
      src.parkingLot?.length ? `\n## Parking Lot\n${src.parkingLot.map(p => `• ${p.item}`).join("\n")}` : "",
      src.keyQuotes?.length ? `\n## Key Quotes\n${src.keyQuotes.map(q => `• "${q.quote}" — ${q.speaker}`).join("\n")}` : ""
    ].filter(Boolean).join("\n");

    const slug = src.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = slug + ".md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    if (!summary) return;
    const src = isEditing ? editableSummary : summary;
    const esc = (str) => String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const topicsHtml = src.topics?.length
      ? `<h2>Topics Discussed</h2>${src.topics.map(t => `<div class="topic"><strong>${esc(t.title)}</strong><p>${esc(t.summary)}</p></div>`).join("")}`
      : "";
    const decisionsHtml = src.decisions?.length
      ? `<h2>Decisions</h2><ul>${src.decisions.map(d => `<li><strong>${esc(d.decision)}</strong>${d.context ? `<br><em>${esc(d.context)}</em>` : ""}</li>`).join("")}</ul>`
      : "";
    const actionsHtml = src.actionItems?.length
      ? `<h2>Action Items</h2><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th></tr></thead><tbody>${src.actionItems.map(a => `<tr><td>${esc(a.task)}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td></tr>`).join("")}</tbody></table>`
      : "";
    const questionsHtml = src.openQuestions?.length
      ? `<h2>Open Questions</h2><ul>${src.openQuestions.map(q => `<li>${esc(q.question)}</li>`).join("")}</ul>`
      : "";
    const parkingLotHtml = src.parkingLot?.length
      ? `<h2>Parking Lot</h2><ul>${src.parkingLot.map(p => `<li>${esc(p.item)}</li>`).join("")}</ul>`
      : "";
    const keyQuotesHtml = src.keyQuotes?.length
      ? `<h2>Key Quotes</h2>${src.keyQuotes.map(q => `<div class="quote"><em>"${esc(q.quote)}"</em><div class="speaker">— ${esc(q.speaker)}</div></div>`).join("")}`
      : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(src.title)}</title><style>
      body{font-family:Georgia,serif;max-width:760px;margin:40px auto;padding:0 24px;color:#111;line-height:1.6}
      h1{font-size:26px;margin:0 0 6px}
      .meta{font-size:12px;color:#aaa;margin-bottom:24px}
      .tldr{font-size:15px;color:#333;margin:0 0 32px;padding:14px 18px;background:#f5f7fa;border-left:4px solid #2563EB;border-radius:4px}
      h2{font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#888;margin:28px 0 10px;border-bottom:1px solid #eee;padding-bottom:6px}
      ul{padding-left:20px;margin:0}li{margin-bottom:8px;font-size:14px}
      table{width:100%;border-collapse:collapse;font-size:14px}
      th{text-align:left;padding:8px 12px;background:#f5f7fa;border-bottom:2px solid #ddd;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888}
      td{padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top}
      .topic{margin-bottom:12px}.topic strong{display:block;font-size:14px;color:#222}.topic p{margin:4px 0 0;font-size:13px;color:#555}
      .quote{margin-bottom:12px;padding:10px 14px;background:#fafafa;border-left:3px solid #ddd;font-size:14px;color:#333}
      .speaker{font-size:12px;color:#888;margin-top:4px}
      @media print{body{margin:0}}
    </style></head><body>
      <h1>${esc(src.title)}</h1>
      <div class="meta">Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
      <div class="tldr">${esc(src.tldr)}</div>
      ${topicsHtml}${decisionsHtml}${actionsHtml}${questionsHtml}${parkingLotHtml}${keyQuotesHtml}
    </body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const copyAll = () => {
    if (!summary) return;
    const src = isEditing ? editableSummary : summary;
    const text = [
      `# ${src.title}`,
      `\n## TL;DR\n${src.tldr}`,
      src.topics?.length ? `\n## Topics Discussed\n${src.topics.map(t => `• ${t.title}: ${t.summary}`).join("\n")}` : "",
      src.decisions?.length ? `\n## Decisions\n${src.decisions.map(d => `• ${d.decision}${d.context ? ` (${d.context})` : ""}`).join("\n")}` : "",
      src.actionItems?.length ? `\n## Action Items\n${src.actionItems.map(a => `• ${a.task} — Owner: ${a.owner}, Due: ${a.due}`).join("\n")}` : "",
      src.openQuestions?.length ? `\n## Open Questions\n${src.openQuestions.map(q => `• ${q.question}`).join("\n")}` : "",
      src.parkingLot?.length ? `\n## Parking Lot\n${src.parkingLot.map(p => `• ${p.item}`).join("\n")}` : "",
      src.keyQuotes?.length ? `\n## Key Quotes\n${src.keyQuotes.map(q => `• "${q.quote}" — ${q.speaker}`).join("\n")}` : ""
    ].filter(Boolean).join("\n");

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const viewSavedSummary = (meeting) => {
    setSummary({
      title: meeting.title,
      tldr: meeting.tldr || "",
      topics: meeting.topics || [],
      decisions: meeting.decisions || [],
      actionItems: (meeting.actionItems || []).map(({ task, owner, due }) => ({ task, owner, due })),
      openQuestions: (meeting.openQuestions || []).map(({ question }) => ({ question })),
      parkingLot: meeting.parkingLot || [],
      keyQuotes: meeting.keyQuotes || []
    });
    setIsEditing(false);
    setEditableSummary(null);
    setViewingHistory(true);
    setError(null);
    setStreamingText("");
  };

  const reset = () => {
    setTranscript("");
    setSummary(null);
    setError(null);
    setViewingHistory(false);
    setIsEditing(false);
    setEditableSummary(null);
    setPendingTags([]);
    setTagInput("");
  };

  const isStreaming = loading && streamingText.length > 0;
  const partial = isStreaming ? extractPartial(streamingText) : null;
  const showOutput = !!summary || isStreaming;
  const data = isEditing ? (editableSummary || {}) : (summary || partial || {});

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
        <div style={{ marginBottom: 48, textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12 }}>
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
            onChange={e => { setApiKey(e.target.value); localStorage.setItem("anthropicApiKey", e.target.value); }}
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

        {/* Model Selector */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "10px 20px",
          marginBottom: 16,
          display: "flex", alignItems: "center", gap: 12
        }}>
          <span style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, whiteSpace: "nowrap" }}>
            MODEL
          </span>
          <div style={{ display: "flex", gap: 6, flex: 1 }}>
            {[
              { id: "claude-haiku-4-5-20251001", label: "Haiku", desc: "Fast · Cheap" },
              { id: "claude-sonnet-4-6",          label: "Sonnet", desc: "Quality · Slower" }
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => { setModel(opt.id); localStorage.setItem("meetingModel", opt.id); }}
                style={{
                  flex: 1, padding: "6px 12px",
                  background: model === opt.id ? "rgba(59,130,246,0.15)" : "transparent",
                  border: `1px solid ${model === opt.id ? "rgba(59,130,246,0.45)" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 8, cursor: "pointer",
                  color: model === opt.id ? "#60A5FA" : "#7A8499",
                  fontSize: 12, fontFamily: "'Courier New', monospace",
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                }}
              >
                <span style={{ fontWeight: model === opt.id ? 600 : 400 }}>{opt.label}</span>
                <span style={{ fontSize: 10, opacity: 0.65 }}>{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt Settings */}
        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${hasCustomSettings ? "rgba(96,165,250,0.3)" : "rgba(255,255,255,0.08)"}`,
          borderRadius: 12,
          marginBottom: 16,
          overflow: "hidden",
          transition: "border-color 0.15s"
        }}>
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            style={{
              width: "100%", background: "transparent", border: "none",
              cursor: "pointer", padding: "10px 20px",
              display: "flex", alignItems: "center", justifyContent: "space-between"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: hasCustomSettings ? "#60A5FA" : "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, transition: "color 0.15s" }}>
                PROMPT SETTINGS
              </span>
              {hasCustomSettings && (
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#60A5FA", boxShadow: "0 0 6px #60A5FA", display: "inline-block" }} />
              )}
            </div>
            <span style={{ fontSize: 14, color: "#7A8499" }}>{settingsOpen ? "▾" : "▸"}</span>
          </button>

          {settingsOpen && (
            <div style={{ padding: "0 20px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Verbosity */}
              <div>
                <div style={{ fontSize: 10, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, marginBottom: 8 }}>VERBOSITY</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[
                    { id: "concise", label: "Concise", desc: "Tight summaries" },
                    { id: "detailed", label: "Detailed", desc: "More context" }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => updatePromptSetting("verbosity", opt.id)}
                      style={{
                        flex: 1, padding: "6px 12px",
                        background: verbosity === opt.id ? "rgba(59,130,246,0.15)" : "transparent",
                        border: `1px solid ${verbosity === opt.id ? "rgba(59,130,246,0.45)" : "rgba(255,255,255,0.08)"}`,
                        borderRadius: 8, cursor: "pointer",
                        color: verbosity === opt.id ? "#60A5FA" : "#7A8499",
                        fontSize: 12, fontFamily: "'Courier New', monospace",
                        transition: "all 0.15s",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8
                      }}
                    >
                      <span style={{ fontWeight: verbosity === opt.id ? 600 : 400 }}>{opt.label}</span>
                      <span style={{ fontSize: 10, opacity: 0.6 }}>{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Extra Sections */}
              <div>
                <div style={{ fontSize: 10, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, marginBottom: 8 }}>EXTRA SECTIONS</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { id: "parkingLot", label: "Parking Lot", desc: "misc & deferred items" },
                    { id: "keyQuotes", label: "Key Quotes", desc: "notable statements" }
                  ].map(sec => {
                    const active = extraSections.includes(sec.id);
                    return (
                      <button
                        key={sec.id}
                        onClick={() => {
                          const next = active
                            ? extraSections.filter(s => s !== sec.id)
                            : [...extraSections, sec.id];
                          updatePromptSetting("extraSections", next);
                        }}
                        style={{
                          padding: "5px 14px",
                          background: active ? "rgba(96,165,250,0.12)" : "transparent",
                          border: `1px solid ${active ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.1)"}`,
                          borderRadius: 20, cursor: "pointer",
                          color: active ? "#60A5FA" : "#7A8499",
                          fontSize: 11, fontFamily: "'Courier New', monospace",
                          transition: "all 0.15s",
                          display: "flex", alignItems: "center", gap: 6
                        }}
                      >
                        <span style={{ fontSize: 11, opacity: 0.8 }}>{active ? "☑" : "☐"}</span>
                        {sec.label}
                        <span style={{ fontSize: 10, opacity: 0.5 }}>— {sec.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Instructions */}
              <div>
                <div style={{ fontSize: 10, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, marginBottom: 8 }}>CUSTOM INSTRUCTIONS</div>
                <textarea
                  value={customInstructions}
                  onChange={e => updatePromptSetting("customInstructions", e.target.value)}
                  placeholder="e.g. Focus on technical decisions. Always include ticket numbers if mentioned."
                  rows={3}
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8, padding: "8px 12px",
                    color: "#C8D4E8", fontSize: 13,
                    fontFamily: "'Georgia', serif",
                    outline: "none", resize: "vertical",
                    boxSizing: "border-box",
                    lineHeight: 1.6
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Demo CTA */}
        {!showOutput && (
          <div style={{
            background: "linear-gradient(135deg, rgba(37,99,235,0.12), rgba(30,64,175,0.08))",
            border: "1px solid rgba(59,130,246,0.25)",
            borderRadius: 14,
            padding: "18px 24px",
            marginBottom: 16,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#FFFFFF", marginBottom: 4 }}>
                See it in action
              </div>
              <div style={{ fontSize: 13, color: "#7A8499", lineHeight: 1.5 }}>
                View a sample meeting summary — no API key needed.
              </div>
            </div>
            <button
              onClick={viewDemo}
              style={{
                background: "linear-gradient(135deg, #1E40AF, #2563EB)",
                border: "1px solid #3B82F6",
                borderRadius: 10, padding: "10px 20px",
                color: "#FFFFFF", fontSize: 14, fontWeight: 600,
                cursor: "pointer",
                fontFamily: "'Georgia', serif",
                whiteSpace: "nowrap",
                transition: "transform 0.15s"
              }}
              onMouseEnter={e => e.target.style.transform = "translateY(-1px)"}
              onMouseLeave={e => e.target.style.transform = "translateY(0)"}
            >
              View Demo →
            </button>
          </div>
        )}

        {/* Search Bar */}
        {savedMeetings.length > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${searchQuery ? "rgba(96,165,250,0.4)" : "rgba(255,255,255,0.08)"}`,
            borderRadius: 12, padding: "10px 16px",
            marginBottom: 12,
            transition: "border-color 0.15s"
          }}>
            <span style={{ fontSize: 12, color: searchQuery ? "#60A5FA" : "#7A8499", fontFamily: "'Courier New', monospace", flexShrink: 0, transition: "color 0.15s" }}>
              SEARCH
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Filter by keyword across all meetings…"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "#C8D4E8", fontSize: 14, fontFamily: "'Georgia', serif"
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#7A8499", fontSize: 16, lineHeight: 1, padding: "0 2px",
                  flexShrink: 0, transition: "color 0.15s"
                }}
                onMouseEnter={e => e.target.style.color = "#C8D4E8"}
                onMouseLeave={e => e.target.style.color = "#7A8499"}
                title="Clear search"
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Follow-up Tracker */}
        {savedMeetings.length === 0 ? (
          <div style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 14,
            padding: "16px 24px",
            marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10
          }}>
            <span style={{ color: "#7A8499", fontSize: 14 }}>○</span>
            <span style={{ fontSize: 13, color: "#7A8499", fontFamily: "'Courier New', monospace" }}>
              No meetings summarized yet. Your follow-up items will appear here.
            </span>
          </div>
        ) : unresolvedItems.length === 0 ? (
          <div style={{
            background: "rgba(74,222,128,0.06)",
            border: "1px solid rgba(74,222,128,0.2)",
            borderRadius: 14,
            padding: "16px 24px",
            marginBottom: 16,
            display: "flex", alignItems: "center", gap: 10
          }}>
            <span style={{ color: "#4ADE80", fontSize: 14 }}>✓</span>
            <span style={{ fontSize: 13, color: "#4ADE80", fontFamily: "'Courier New', monospace" }}>
              All items resolved — {savedMeetings.length} meeting{savedMeetings.length > 1 ? "s" : ""} tracked
            </span>
          </div>
        ) : null}
        {unresolvedItems.length > 0 && (
          <div style={{
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.2)",
            borderRadius: 14,
            marginBottom: 16,
            overflow: "hidden"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px" }}>
              <button
                onClick={() => setTrackerOpen(!trackerOpen)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "#FBBF24", padding: 0, display: "flex", alignItems: "center", gap: 8 }}
              >
                <span style={{ fontSize: 11, letterSpacing: 3, fontFamily: "'Courier New', monospace", textTransform: "uppercase" }}>
                  FOLLOW-UP TRACKER ({(filterOwner || filterTag || searchQuery.trim()) ? `${filteredItems.length} of ${unresolvedItems.length}` : unresolvedItems.length} open)
                </span>
                <span style={{ fontSize: 14 }}>{trackerOpen ? "▾" : "▸"}</span>
              </button>
              <button
                onClick={resolveAll}
                style={{
                  background: "none", border: "1px solid rgba(251,191,36,0.3)",
                  borderRadius: 6, padding: "4px 12px",
                  color: "#FBBF24", fontSize: 11, cursor: "pointer",
                  fontFamily: "'Courier New', monospace", letterSpacing: 0.5,
                  transition: "all 0.15s"
                }}
                onMouseEnter={e => { e.target.style.background = "rgba(251,191,36,0.1)"; e.target.style.borderColor = "rgba(251,191,36,0.6)"; }}
                onMouseLeave={e => { e.target.style.background = "none"; e.target.style.borderColor = "rgba(251,191,36,0.3)"; }}
              >
                Mark all resolved ✓
              </button>
            </div>

            {trackerOpen && (
              <div style={{ padding: "0 24px 20px" }}>
                {uniqueOwners.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: uniqueTags.length > 0 ? 8 : 16 }}>
                    <span style={{ fontSize: 10, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, alignSelf: "center", marginRight: 2 }}>
                      OWNER:
                    </span>
                    <button
                      onClick={() => setFilterOwner("")}
                      style={{
                        padding: "3px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                        fontFamily: "'Courier New', monospace",
                        background: !filterOwner ? "rgba(251,191,36,0.15)" : "transparent",
                        border: `1px solid ${!filterOwner ? "rgba(251,191,36,0.5)" : "rgba(255,255,255,0.12)"}`,
                        color: !filterOwner ? "#FBBF24" : "#7A8499",
                        transition: "all 0.15s"
                      }}
                    >
                      All
                    </button>
                    {uniqueOwners.map(owner => (
                      <button
                        key={owner}
                        onClick={() => setFilterOwner(filterOwner === owner ? "" : owner)}
                        style={{
                          padding: "3px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                          fontFamily: "'Courier New', monospace",
                          background: filterOwner === owner ? "rgba(74,222,128,0.15)" : "transparent",
                          border: `1px solid ${filterOwner === owner ? "rgba(74,222,128,0.5)" : "rgba(255,255,255,0.12)"}`,
                          color: filterOwner === owner ? "#4ADE80" : "#7A8499",
                          transition: "all 0.15s"
                        }}
                      >
                        {owner}
                      </button>
                    ))}
                  </div>
                )}
                {uniqueTags.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                    <span style={{ fontSize: 10, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, alignSelf: "center", marginRight: 2 }}>
                      TAG:
                    </span>
                    {uniqueTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => setFilterTag(filterTag === tag ? "" : tag)}
                        style={{
                          padding: "3px 12px", borderRadius: 20, fontSize: 11, cursor: "pointer",
                          fontFamily: "'Courier New', monospace",
                          background: filterTag === tag ? "rgba(96,165,250,0.15)" : "transparent",
                          border: `1px solid ${filterTag === tag ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.12)"}`,
                          color: filterTag === tag ? "#60A5FA" : "#7A8499",
                          transition: "all 0.15s"
                        }}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {filteredItems.length === 0 && searchQuery.trim() ? (
                  <div style={{ fontSize: 13, color: "#7A8499", fontFamily: "'Courier New', monospace", padding: "8px 0" }}>
                    No items match "{searchQuery}"
                  </div>
                ) : Object.entries(
                  filteredItems.reduce((groups, item) => {
                    (groups[item.meetingTitle] = groups[item.meetingTitle] || []).push(item);
                    return groups;
                  }, {})
                ).map(([title, items]) => (
                  <div key={title} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace", marginBottom: 8 }}>
                      {highlight(title, searchQuery)}
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
                            {highlight(item.type === "action" ? item.task : item.question, searchQuery)}
                          </div>
                          {item.type === "action" && item.owner && (
                            <span style={{ fontSize: 11, color: "#7A8499", fontFamily: "'Courier New', monospace" }}>
                              {highlight(item.owner, searchQuery)}{item.due ? ` · ${item.due}` : ""}
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

        {/* Past Summaries */}
        {savedMeetings.length > 0 && (
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 14,
            marginBottom: 16,
            overflow: "hidden"
          }}>
            <button
              onClick={() => setHistoryOpen(!historyOpen)}
              style={{
                width: "100%", background: "transparent", border: "none",
                cursor: "pointer", padding: "14px 24px",
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}
            >
              <span style={{ fontSize: 11, letterSpacing: 3, color: "#7A8499", fontFamily: "'Courier New', monospace", textTransform: "uppercase" }}>
                Past Summaries ({searchQuery.trim() ? `${filteredMeetings.length} of ${savedMeetings.length}` : savedMeetings.length})
              </span>
              <span style={{ fontSize: 14, color: "#7A8499" }}>{historyOpen ? "▾" : "▸"}</span>
            </button>

            {historyOpen && (
              <div style={{ padding: "0 24px 16px" }}>
                {filteredMeetings.length === 0 && searchQuery.trim() ? (
                  <div style={{ fontSize: 13, color: "#7A8499", fontFamily: "'Courier New', monospace", padding: "4px 0 8px" }}>
                    No meetings match "{searchQuery}"
                  </div>
                ) : null}
                {[...filteredMeetings].reverse().map((m, i, arr) => (
                  <div key={m.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "12px 0",
                    borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none"
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {editingTitleId === m.id ? (
                        <input
                          autoFocus
                          value={editingTitleValue}
                          onChange={e => setEditingTitleValue(e.target.value)}
                          onBlur={() => commitTitleEdit(m.id)}
                          onKeyDown={e => {
                            if (e.key === "Enter") { e.preventDefault(); commitTitleEdit(m.id); }
                            if (e.key === "Escape") { setEditingTitleId(null); setEditingTitleValue(""); }
                          }}
                          style={{
                            fontSize: 14, color: "#C8D4E8", lineHeight: 1.4,
                            fontFamily: "'Georgia', serif",
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: 6, outline: "none",
                            padding: "2px 8px", marginBottom: 4,
                            width: "100%", boxSizing: "border-box"
                          }}
                        />
                      ) : (
                        <div
                          onClick={() => { setEditingTitleId(m.id); setEditingTitleValue(m.title); }}
                          title="Click to rename"
                          style={{ fontSize: 14, color: "#C8D4E8", marginBottom: 4, lineHeight: 1.4, cursor: "text" }}
                        >
                          {highlight(m.title, searchQuery)}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: "#4A5568", fontFamily: "'Courier New', monospace" }}>
                        {new Date(m.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        {" · "}{m.actionItems?.length || 0} action{m.actionItems?.length !== 1 ? "s" : ""}
                        {" · "}{m.openQuestions?.length || 0} question{m.openQuestions?.length !== 1 ? "s" : ""}
                      </div>
                      {m.tags?.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                          {m.tags.map(tag => (
                            <span
                              key={tag}
                              style={{
                                padding: "1px 8px", borderRadius: 10,
                                background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
                                color: "#60A5FA", fontSize: 10, fontFamily: "'Courier New', monospace"
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => viewSavedSummary(m)}
                      style={{
                        background: "none", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 6, padding: "5px 14px", marginLeft: 16,
                        color: "#9BAACC", fontSize: 12, cursor: "pointer",
                        fontFamily: "'Courier New', monospace",
                        whiteSpace: "nowrap", flexShrink: 0,
                        transition: "all 0.15s"
                      }}
                      onMouseEnter={e => { e.target.style.borderColor = "rgba(255,255,255,0.3)"; e.target.style.color = "#E8EDF5"; }}
                      onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.12)"; e.target.style.color = "#9BAACC"; }}
                    >
                      View →
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!showOutput ? (
          /* Input Panel */
          <div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              style={{
                background: dragOver ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${dragOver ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 16,
                overflow: "hidden",
                marginBottom: 16,
                transition: "background 0.15s, border-color 0.15s"
              }}
            >
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
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
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
                    Upload file ↑
                  </button>
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.vtt"
                  style={{ display: "none" }}
                  onChange={e => { handleFile(e.target.files[0]); e.target.value = ""; }}
                />
              </div>

              <textarea
                ref={textareaRef}
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); summarize(); } }}
                placeholder="Paste your meeting transcript here, or drag and drop a .txt or .vtt file...

Works with:
• Zoom / Google Meet / Teams transcripts
• Manual notes or copied text
• Any format — the AI handles the rest

Press ⌘↵ to summarize"
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
                  {wordCount} words
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
              onMouseEnter={e => { if (transcript.trim() && !loading) e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
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

            <div style={{
              display: "flex", justifyContent: "center", gap: 20, marginTop: 10
            }}>
              {[["⌘↵", "summarize"], ["⌘N", "new transcript"]].map(([key, label]) => (
                <span key={key} style={{ fontSize: 11, color: "#3A4560", fontFamily: "'Courier New', monospace", display: "flex", alignItems: "center", gap: 5 }}>
                  <kbd style={{
                    padding: "1px 6px", borderRadius: 4,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#5A6580", fontSize: 10
                  }}>{key}</kbd>
                  {label}
                </span>
              ))}
            </div>

            <style>{`
              @keyframes spin { to { transform: rotate(360deg); } }
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.35; }
              }
              @keyframes shimmer {
                0%, 100% { background-color: rgba(255,255,255,0.04); }
                50% { background-color: rgba(255,255,255,0.09); }
              }
            `}</style>
          </div>
        ) : (
          /* Summary Output — used for both streaming (partial) and complete (summary) */
          <div>
            {/* Action bar — hidden while streaming */}
            {!isStreaming && (
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
                  {viewingHistory ? "← Back" : "← New transcript"}
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
                <button
                  onClick={downloadMd}
                  style={{
                    flex: 1, padding: "11px",
                    background: "rgba(167,139,250,0.1)",
                    border: "1px solid rgba(167,139,250,0.3)",
                    borderRadius: 10, cursor: "pointer",
                    color: "#A78BFA", fontSize: 13,
                    fontFamily: "'Courier New', monospace",
                    transition: "all 0.2s"
                  }}
                >
                  Download .md ↓
                </button>
                <button
                  onClick={downloadPdf}
                  style={{
                    flex: 1, padding: "11px",
                    background: "rgba(251,191,36,0.08)",
                    border: "1px solid rgba(251,191,36,0.3)",
                    borderRadius: 10, cursor: "pointer",
                    color: "#FBBF24", fontSize: 13,
                    fontFamily: "'Courier New', monospace",
                    transition: "all 0.2s"
                  }}
                >
                  Download PDF ↓
                </button>
              </div>
            )}

            {/* Tracker save / edit banner — only after a fresh generation */}
            {summary && !isStreaming && !viewingHistory && (
              isEditing ? (
                <div style={{
                  marginBottom: 16, padding: "12px 18px",
                  background: "rgba(251,191,36,0.07)",
                  border: "1px solid rgba(251,191,36,0.25)",
                  borderRadius: 10
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, color: "#FBBF24", fontFamily: "'Courier New', monospace" }}>
                      ✎ Review and edit before saving to tracker
                    </span>
                    <button
                      onClick={saveToTracker}
                      style={{
                        background: "linear-gradient(135deg, #166534, #16A34A)",
                        border: "1px solid #22C55E",
                        borderRadius: 8, padding: "7px 20px",
                        color: "#FFFFFF", fontSize: 13, fontWeight: 600,
                        cursor: "pointer", fontFamily: "'Georgia', serif",
                        transition: "transform 0.15s"
                      }}
                      onMouseEnter={e => e.target.style.transform = "translateY(-1px)"}
                      onMouseLeave={e => e.target.style.transform = "translateY(0)"}
                    >
                      Save to tracker →
                    </button>
                  </div>
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
                    padding: "6px 10px", borderRadius: 8,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)"
                  }}>
                    <span style={{ fontSize: 10, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1, marginRight: 2 }}>
                      TAGS:
                    </span>
                    {pendingTags.map(tag => (
                      <span
                        key={tag}
                        onClick={() => setPendingTags(t => t.filter(x => x !== tag))}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 8px", borderRadius: 12,
                          background: "rgba(96,165,250,0.15)", border: "1px solid rgba(96,165,250,0.4)",
                          color: "#60A5FA", fontSize: 11, cursor: "pointer",
                          fontFamily: "'Courier New', monospace"
                        }}
                      >
                        {tag} ×
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
                          e.preventDefault();
                          const t = tagInput.trim().replace(/,\s*$/, "");
                          if (t && !pendingTags.includes(t)) setPendingTags(prev => [...prev, t]);
                          setTagInput("");
                        }
                        if (e.key === "Backspace" && !tagInput && pendingTags.length) {
                          setPendingTags(prev => prev.slice(0, -1));
                        }
                      }}
                      placeholder={pendingTags.length === 0 ? "Add tags: 1:1, standup… (Enter to add)" : "Add more…"}
                      style={{
                        background: "transparent", border: "none", outline: "none",
                        color: "#C8D4E8", fontSize: 11, fontFamily: "'Courier New', monospace",
                        minWidth: 160, flex: 1
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#4ADE80", fontFamily: "'Courier New', monospace", marginBottom: 16 }}>
                  ✓ {summary.actionItems?.length || 0} action items + {summary.openQuestions?.length || 0} open questions saved to tracker
                </div>
              )
            )}

            {/* Generating indicator */}
            {isStreaming && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <span style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  background: "#4ADE80", boxShadow: "0 0 8px #4ADE80",
                  animation: "pulse 1.2s ease-in-out infinite"
                }} />
                <span style={{ fontSize: 12, color: "#7A8499", fontFamily: "'Courier New', monospace", letterSpacing: 1 }}>
                  GENERATING SUMMARY...
                </span>
              </div>
            )}

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
              {data.title ? (
                isEditing ? (
                  <input
                    value={editableSummary.title}
                    onChange={e => updateEditField("title", e.target.value)}
                    style={{
                      fontSize: 24, fontWeight: 700, color: "#FFFFFF",
                      letterSpacing: -0.5, fontFamily: "'Georgia', serif",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      outline: "none", width: "100%",
                      margin: "0 0 16px", padding: "6px 10px",
                      display: "block", boxSizing: "border-box"
                    }}
                  />
                ) : (
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: "#FFFFFF", margin: "0 0 16px", letterSpacing: -0.5 }}>
                    {data.title}
                  </h2>
                )
              ) : (
                <div style={{ height: 30, borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 16, animation: "shimmer 1.5s ease-in-out infinite" }} />
              )}
              {data.tldr ? (
                isEditing ? (
                  <textarea
                    value={editableSummary.tldr}
                    onChange={e => updateEditField("tldr", e.target.value)}
                    style={{
                      fontSize: 15, color: "#B0C0DE", lineHeight: 1.7,
                      fontFamily: "'Georgia', serif",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: 8,
                      outline: "none", width: "100%", resize: "vertical",
                      padding: "6px 10px", minHeight: 72,
                      display: "block", boxSizing: "border-box", margin: 0
                    }}
                  />
                ) : (
                  <p style={{ fontSize: 15, color: "#B0C0DE", lineHeight: 1.7, margin: 0 }}>
                    {data.tldr}
                  </p>
                )
              ) : (
                <div>
                  <div style={{ height: 14, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginBottom: 8, animation: "shimmer 1.5s ease-in-out infinite" }} />
                  <div style={{ height: 14, borderRadius: 4, background: "rgba(255,255,255,0.04)", marginBottom: 8, width: "88%", animation: "shimmer 1.5s ease-in-out infinite" }} />
                  <div style={{ height: 14, borderRadius: 4, background: "rgba(255,255,255,0.04)", width: "72%", animation: "shimmer 1.5s ease-in-out infinite" }} />
                </div>
              )}
            </div>

            {/* Grid: Decisions + Action Items */}
            {(data.decisions?.length > 0 || data.actionItems?.length > 0 || isEditing) && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {(data.decisions?.length > 0 || isEditing) && (
                  <Section
                    label="DECISIONS"
                    accent="#A78BFA"
                    bg="rgba(167,139,250,0.08)"
                    borderColor="rgba(167,139,250,0.2)"
                    copyText={(data.decisions?.length ? data.decisions.map(d => `• ${d.decision}${d.context ? ` (${d.context})` : ""}`).join("\n") : null)}
                  >
                    {(data.decisions || []).map((d, i) => (
                      <div key={i} style={{ marginBottom: 14, display: "flex", alignItems: "flex-start", gap: 8 }}>
                        {isEditing ? (
                          <div style={{ flex: 1 }}>
                            <input
                              value={d.decision}
                              onChange={e => updateEditItem("decisions", i, { decision: e.target.value })}
                              placeholder="Decision"
                              style={editFieldStyle("#E2E8F0", 14, 600)}
                            />
                            <input
                              value={d.context || ""}
                              onChange={e => updateEditItem("decisions", i, { context: e.target.value })}
                              placeholder="Context (optional)"
                              style={{ ...editFieldStyle("#8090B0", 13, 400), fontStyle: "italic", marginTop: 4 }}
                            />
                          </div>
                        ) : (
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, color: "#E2E8F0", lineHeight: 1.5, fontWeight: 600 }}>
                              {d.decision}
                            </div>
                            {d.context && (
                              <div style={{ fontSize: 13, color: "#8090B0", marginTop: 4, lineHeight: 1.5, fontStyle: "italic" }}>
                                {d.context}
                              </div>
                            )}
                          </div>
                        )}
                        {isEditing && (
                          <button onClick={() => removeEditItem("decisions", i)} style={deleteButtonStyle}>×</button>
                        )}
                      </div>
                    ))}
                    {isEditing && (
                      <button
                        onClick={() => addEditItem("decisions", { decision: "", context: "" })}
                        style={addButtonStyle("rgba(167,139,250,0.3)", "#A78BFA")}
                      >
                        + Add decision
                      </button>
                    )}
                  </Section>
                )}

                {(data.actionItems?.length > 0 || isEditing) && (
                  <Section
                    label="ACTION ITEMS"
                    accent="#4ADE80"
                    bg="rgba(74,222,128,0.08)"
                    borderColor="rgba(74,222,128,0.2)"
                    copyText={(data.actionItems?.length ? data.actionItems.map(a => `• ${a.task} — Owner: ${a.owner}, Due: ${a.due}`).join("\n") : null)}
                  >
                    {(data.actionItems || []).map((a, i) => (
                      <div key={i} style={{
                        marginBottom: 12, padding: "10px 14px",
                        background: "rgba(255,255,255,0.03)",
                        borderRadius: 8,
                        borderLeft: "3px solid #4ADE80"
                      }}>
                        {isEditing ? (
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <input
                                value={a.task}
                                onChange={e => updateEditItem("actionItems", i, { task: e.target.value })}
                                placeholder="Task"
                                style={{ ...editFieldStyle("#E2E8F0", 14, 400), marginBottom: 6 }}
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <input
                                  value={a.owner}
                                  onChange={e => updateEditItem("actionItems", i, { owner: e.target.value })}
                                  placeholder="Owner"
                                  style={{ ...editFieldStyle("#4ADE80", 11, 400), fontFamily: "'Courier New', monospace", flex: 1 }}
                                />
                                <input
                                  value={a.due}
                                  onChange={e => updateEditItem("actionItems", i, { due: e.target.value })}
                                  placeholder="Due"
                                  style={{ ...editFieldStyle("#FBBF24", 11, 400), fontFamily: "'Courier New', monospace", flex: 1 }}
                                />
                              </div>
                            </div>
                            <button onClick={() => removeEditItem("actionItems", i)} style={deleteButtonStyle}>×</button>
                          </div>
                        ) : (
                          <>
                            <div style={{ fontSize: 14, color: "#E2E8F0", lineHeight: 1.5, marginBottom: 6 }}>
                              {a.task}
                            </div>
                            <div style={{ display: "flex", gap: 12 }}>
                              <Tag label={a.owner} color="#4ADE80" icon="👤" />
                              <Tag label={a.due} color="#FBBF24" icon="📅" />
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {isEditing && (
                      <button
                        onClick={() => addEditItem("actionItems", { task: "", owner: "TBD", due: "TBD" })}
                        style={addButtonStyle("rgba(74,222,128,0.3)", "#4ADE80")}
                      >
                        + Add action item
                      </button>
                    )}
                  </Section>
                )}
              </div>
            )}

            {/* Topics */}
            {data.topics?.length > 0 && (
              <Section
                label="TOPICS DISCUSSED"
                accent="#60A5FA"
                bg="rgba(96,165,250,0.06)"
                borderColor="rgba(96,165,250,0.15)"
                style={{ marginBottom: 16 }}
                copyText={(data.topics?.length ? data.topics.map(t => `• ${t.title}: ${t.summary}`).join("\n") : null)}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                  {data.topics.map((t, i) => (
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
            {(data.openQuestions?.length > 0 || isEditing) && (
              <Section
                label="OPEN QUESTIONS"
                accent="#FBBF24"
                bg="rgba(251,191,36,0.06)"
                borderColor="rgba(251,191,36,0.2)"
                copyText={(data.openQuestions?.length ? data.openQuestions.map(q => `• ${q.question}`).join("\n") : null)}
              >
                {(data.openQuestions || []).map((q, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10
                  }}>
                    <span style={{ color: "#FBBF24", marginTop: isEditing ? 7 : 2, flexShrink: 0 }}>?</span>
                    {isEditing ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          value={q.question}
                          onChange={e => updateEditItem("openQuestions", i, { question: e.target.value })}
                          placeholder="Question"
                          style={{ ...editFieldStyle("#C8D4E8", 14, 400), flex: 1 }}
                        />
                        <button onClick={() => removeEditItem("openQuestions", i)} style={deleteButtonStyle}>×</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 14, color: "#C8D4E8", lineHeight: 1.6 }}>{q.question}</span>
                    )}
                  </div>
                ))}
                {isEditing && (
                  <button
                    onClick={() => addEditItem("openQuestions", { question: "" })}
                    style={addButtonStyle("rgba(251,191,36,0.3)", "#FBBF24")}
                  >
                    + Add question
                  </button>
                )}
              </Section>
            )}

            {/* Parking Lot */}
            {(data.parkingLot?.length > 0 || (isEditing && extraSections.includes("parkingLot"))) && (
              <Section
                label="PARKING LOT"
                accent="#F97316"
                bg="rgba(249,115,22,0.06)"
                borderColor="rgba(249,115,22,0.2)"
                style={{ marginTop: 16 }}
                copyText={(data.parkingLot?.length ? data.parkingLot.map(p => `• ${p.item}`).join("\n") : null)}
              >
                {(data.parkingLot || []).map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                    <span style={{ color: "#F97316", marginTop: isEditing ? 7 : 2, flexShrink: 0 }}>○</span>
                    {isEditing ? (
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                        <input
                          value={p.item}
                          onChange={e => updateEditItem("parkingLot", i, { item: e.target.value })}
                          placeholder="Item"
                          style={{ ...editFieldStyle("#C8D4E8", 14, 400), flex: 1 }}
                        />
                        <button onClick={() => removeEditItem("parkingLot", i)} style={deleteButtonStyle}>×</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 14, color: "#C8D4E8", lineHeight: 1.6 }}>{p.item}</span>
                    )}
                  </div>
                ))}
                {isEditing && (
                  <button
                    onClick={() => addEditItem("parkingLot", { item: "" })}
                    style={addButtonStyle("rgba(249,115,22,0.3)", "#F97316")}
                  >
                    + Add item
                  </button>
                )}
              </Section>
            )}

            {/* Key Quotes */}
            {data.keyQuotes?.length > 0 && (
              <Section
                label="KEY QUOTES"
                accent="#E879F9"
                bg="rgba(232,121,249,0.05)"
                borderColor="rgba(232,121,249,0.2)"
                style={{ marginTop: 16 }}
                copyText={data.keyQuotes.map(q => `"${q.quote}" — ${q.speaker}`).join("\n")}
              >
                {data.keyQuotes.map((q, i) => (
                  <div key={i} style={{ marginBottom: 14, paddingLeft: 4 }}>
                    <div style={{ fontSize: 14, color: "#C8D4E8", lineHeight: 1.6, fontStyle: "italic" }}>
                      "{q.quote}"
                    </div>
                    <div style={{ fontSize: 12, color: "#E879F9", fontFamily: "'Courier New', monospace", marginTop: 4 }}>
                      — {q.speaker}
                    </div>
                  </div>
                ))}
              </Section>
            )}

            <style>{`
              @keyframes spin { to { transform: rotate(360deg); } }
              @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.35; }
              }
              @keyframes shimmer {
                0%, 100% { background-color: rgba(255,255,255,0.04); }
                50% { background-color: rgba(255,255,255,0.09); }
              }
            `}</style>
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

function highlight(text, query) {
  if (!query?.trim() || !text) return text;
  const str = String(text);
  const q = query.toLowerCase();
  const lower = str.toLowerCase();
  const parts = [];
  let last = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > last) parts.push(str.slice(last, idx));
    parts.push(
      <mark key={idx} style={{ background: "rgba(251,191,36,0.25)", color: "#FBBF24", borderRadius: 2, padding: "0 1px" }}>
        {str.slice(idx, idx + q.length)}
      </mark>
    );
    last = idx + q.length;
    idx = lower.indexOf(q, last);
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts.length > 1 ? parts : text;
}

function editFieldStyle(color, fontSize, fontWeight) {
  return {
    fontSize,
    fontWeight,
    color,
    fontFamily: "'Georgia', serif",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    padding: "4px 8px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    lineHeight: 1.5
  };
}

const deleteButtonStyle = {
  background: "none",
  border: "none",
  color: "#4A5568",
  cursor: "pointer",
  fontSize: 18,
  padding: "0 2px",
  lineHeight: 1,
  flexShrink: 0,
  transition: "color 0.15s"
};

function addButtonStyle(borderColor, textColor) {
  return {
    background: "none",
    border: `1px dashed ${borderColor}`,
    borderRadius: 6,
    padding: "6px 12px",
    color: textColor,
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "'Courier New', monospace",
    width: "100%",
    textAlign: "left",
    marginTop: 4
  };
}

function Section({ label, accent, bg, borderColor, children, style, copyText }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!copyText) return;
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{
      background: bg,
      border: `1px solid ${borderColor}`,
      borderRadius: 14, padding: "20px 24px",
      marginBottom: 0,
      ...style
    }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 11, letterSpacing: 3, color: accent,
          fontFamily: "'Courier New', monospace",
          marginBottom: open ? 16 : 0, textTransform: "uppercase",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", userSelect: "none"
        }}
      >
        <span>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {copyText && (
            <span
              onClick={handleCopy}
              title="Copy section"
              style={{
                fontSize: 10, letterSpacing: 0.5, opacity: copied ? 1 : 0.45,
                color: copied ? accent : "inherit",
                transition: "opacity 0.15s, color 0.15s",
                fontFamily: "'Courier New', monospace",
                textTransform: "uppercase"
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={e => { if (!copied) e.currentTarget.style.opacity = "0.45"; }}
            >
              {copied ? "✓ copied" : "copy"}
            </span>
          )}
          <span style={{ fontSize: 13, opacity: 0.6, letterSpacing: 0 }}>{open ? "▾" : "▸"}</span>
        </div>
      </div>
      {open && children}
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
