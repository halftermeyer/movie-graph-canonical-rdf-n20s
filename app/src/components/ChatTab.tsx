import { useCallback, useEffect, useRef, useState } from "react";
import { FilledButton, LoadingSpinner } from "@neo4j-ndl/react";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { GEMINI_MODEL, SYSTEM_PROMPT, TOOLS, executeTool } from "../lib/assistantTools";

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  error?: boolean;
}

const SUGGESTIONS = [
  "Who is within 2 of Kevin Bacon, and why?",
  "Prove that Tom Hanks is within 2 of Kevin Bacon.",
  "What is Meg Ryan's exact Bacon number, and what can RDF prove about her?",
  "Which reasoning profile fires the OWL Bacon ladder?",
  "Give me the schema.org JSON-LD for Apollo 13.",
  "Snapshot the cast of The Matrix: how many records and triples?",
];

export default function ChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<Content[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const apiKey = import.meta.env.GEMINI_API_KEY;

  const lastQuestion = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // While working, follow the tool calls; once answered, bring the question back to the top
    // so the question, the tool calls and the start of the answer read together.
    const answered = messages.length > 0 && messages[messages.length - 1].role === "assistant";
    if (answered) lastQuestion.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      setInput("");
      setMessages((m) => [...m, { role: "user", content: text }]);
      setLoading(true);
      const contents: Content[] = [...history, { role: "user", parts: [{ text }] }];
      try {
        const ai = new GoogleGenAI({ apiKey });
        const config = { systemInstruction: SYSTEM_PROMPT, tools: [{ functionDeclarations: TOOLS }] };
        // Tool-calling loop: the model asks, the typed query functions answer.
        for (let i = 0; i < 8; i++) {
          const res = await ai.models.generateContent({ model: GEMINI_MODEL, contents, config });
          const parts: Part[] = res.candidates?.[0]?.content?.parts ?? [];
          contents.push({ role: "model", parts });
          const calls = parts.filter((p) => p.functionCall);
          if (calls.length === 0) {
            const answer = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("");
            setMessages((m) => [...m, { role: "assistant", content: answer || "(no answer)" }]);
            break;
          }
          const responses: Part[] = [];
          for (const c of calls) {
            const fc = c.functionCall!;
            const args = (fc.args ?? {}) as Record<string, unknown>;
            setMessages((m) => [...m, { role: "tool", toolName: fc.name, content: preview(args) }]);
            let result: unknown;
            try {
              result = await executeTool(fc.name!, args);
            } catch (e) {
              result = { error: (e as Error).message };
            }
            responses.push({ functionResponse: { id: fc.id, name: fc.name, response: { result } } });
          }
          contents.push({ role: "user", parts: responses });
        }
        setHistory(contents);
      } catch (e) {
        setMessages((m) => [...m, { role: "assistant", content: `Error: ${(e as Error).message}`, error: true }]);
      } finally {
        setLoading(false);
      }
    },
    [apiKey, history, loading]
  );

  if (!apiKey) {
    return (
      <div className="empty-state">
        <h3>Gemini API key required</h3>
        <p>
          Set <code>GEMINI_API_KEY</code> in the <code>.env</code> at the repository root and restart <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-messages" data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <h3>Movie Graph assistant</h3>
            <p>
              I answer by calling the demo's typed functions (Cypher, export, project, infer, explain) with{" "}
              <code>{GEMINI_MODEL}</code>. Facts come from the graph and the reasoner, never from me.
            </p>
          </div>
        )}
        <div className="chat-suggestions">
          {SUGGESTIONS.map((s, i) => (
            <button key={s} className="chat-suggestion" data-testid={`chat-suggestion-${i}`} onClick={() => send(s)} disabled={loading}>
              {s}
            </button>
          ))}
        </div>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`chat-message ${msg.role}`}
            ref={msg.role === "user" && i === messages.findLastIndex((m) => m.role === "user") ? lastQuestion : undefined}
          >
            {msg.role === "tool" ? (
              <div className="chat-tool-call">
                <span className="chat-tool-icon">&#9881;</span>
                <span className="chat-tool-name">{msg.toolName}</span>
                <span className="chat-tool-args">{msg.content}</span>
              </div>
            ) : (
              <div
                className="chat-message-content"
                data-testid={msg.role === "assistant" ? (msg.error ? "chat-error" : "chat-answer") : undefined}
              >
                {msg.role === "assistant" ? <div dangerouslySetInnerHTML={{ __html: markdown(msg.content) }} /> : msg.content}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-message assistant">
            <div className="chat-message-content">
              <LoadingSpinner size="small" /> Calling the graph and the reasoner…
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="chat-input-bar">
        <input
          type="text"
          data-testid="chat-input"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Ask about Bacon distances, proofs, snapshots, schema.org…"
          disabled={loading}
        />
        <FilledButton size="medium" onClick={() => send(input)} isDisabled={loading || !input.trim()}>
          Send
        </FilledButton>
      </div>
    </div>
  );
}

function preview(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => {
      const s = JSON.stringify(v);
      return `${k}: ${s.length > 70 ? s.slice(0, 70) + "…" : s}`;
    })
    .join(", ");
}

function markdown(text: string): string {
  const tex: Record<string, string> = { rightarrow: "→", to: "→", leftarrow: "←", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", sqsubseteq: "⊑", exists: "∃" };
  const plain = text.replace(/\$\\(\w+)\$/g, (m, k) => tex[k] ?? m);
  const esc = plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc.split("\n");
  const out: string[] = [];
  let table: string[][] = [];
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...body] = table.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c.trim())));
    out.push(
      `<table class="data-table small"><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`
    );
    table = [];
  };
  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      table.push(line.trim().slice(1, -1).split("|").map((c) => c.trim()));
      continue;
    }
    flushTable();
    out.push(line);
  }
  flushTable();
  return out
    .join("\n")
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="chat-code"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/gm, "$1<em>$2</em>")
    .replace(/^#{1,4} (.*)$/gm, "<strong>$1</strong>")
        .replace(/^-{3,}$/gm, "<hr>")
    .replace(/^\s*[-*] (.*)$/gm, "• $1")
    .replace(/\n(?!<)/g, "<br>");
}
