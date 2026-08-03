"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  Activity, Artifact, Conversation, Message, Opportunity, OpportunityDocument,
} from "../db/repository";

type Workspace = {
  user: { displayName: string; userId: string; mode: string };
  opportunities: Opportunity[];
  activities: Activity[];
  documents: OpportunityDocument[];
  conversations: Conversation[];
  messages: Message[];
  artifacts: Artifact[];
};
type View = "overview" | "activities" | "documents" | "copilot";
type ChatKind = "general" | "meeting" | "email" | "risk" | "offer";

const currency = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function OpportunityWorkspace() {
  const [data, setData] = useState<Workspace | null>(null);
  const [activeId, setActiveId] = useState("");
  const [view, setView] = useState<View>("overview");
  const [conversationId, setConversationId] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 ? "Bitte melden Sie sich zuerst an." : "Der Arbeitsbereich konnte nicht geladen werden.");
    const next = await response.json() as Workspace;
    setData(next);
    setActiveId(current => current && next.opportunities.some(item => item.id === current) ? current : next.opportunities[0]?.id ?? "");
  }, []);

  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then(response => {
        if (!response.ok) throw new Error(response.status === 401 ? "Bitte melden Sie sich zuerst an." : "Der Arbeitsbereich konnte nicht geladen werden.");
        return response.json() as Promise<Workspace>;
      })
      .then(next => {
        setData(next);
        setActiveId(next.opportunities[0]?.id ?? "");
      })
      .catch(caught => setError(messageOf(caught)));
  }, []);

  const opportunity = data?.opportunities.find(item => item.id === activeId) ?? null;
  const activities = data?.activities.filter(item => item.opportunityId === activeId) ?? [];
  const documents = data?.documents.filter(item => item.opportunityId === activeId) ?? [];
  const conversations = data?.conversations.filter(item => item.opportunityId === activeId) ?? [];
  const artifacts = data?.artifacts.filter(item => item.opportunityId === activeId) ?? [];
  const currentConversationId = conversations.some(item => item.id === conversationId)
    ? conversationId
    : conversations[0]?.id ?? "";
  const conversation = conversations.find(item => item.id === currentConversationId) ?? null;
  const messages = data?.messages.filter(item => item.conversationId === conversation?.id) ?? [];

  async function action(body: Record<string, string>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, opportunityId: activeId }) });
      if (!response.ok) throw new Error("Die Änderung konnte nicht gespeichert werden.");
      await load();
    } catch (caught) { setError(messageOf(caught)); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    setBusy(true); setError("");
    const form = new FormData(); form.set("opportunityId", activeId); form.set("file", file);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error("Nur TXT, Markdown oder PDF bis 5 MB können hochgeladen werden.");
      await load(); setView("documents");
    } catch (caught) { setError(messageOf(caught)); } finally { setBusy(false); }
  }

  if (!data || !opportunity) return <Loading error={error} />;
  const openTodos = activities.filter(item => item.type === "todo" && item.status !== "done").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Zur Übersicht">
          <span className="brand-mark">A</span><span><strong>AIDA</strong><small>Opportunity Copilot</small></span>
        </button>
        <button className="context-switch" onClick={() => setSelectorOpen(true)} aria-haspopup="dialog">
          <span><small>Aktive Verkaufschance</small><strong>{opportunity.code} · {opportunity.name}</strong></span><span aria-hidden="true">⌄</span>
        </button>
        <div className="user"><span>{initials(data.user.displayName)}</span><div><strong>{data.user.displayName}</strong><small>{data.user.mode === "local" ? "Lokale Workshop-Vorschau" : "Sicher angemeldet"}</small></div></div>
      </header>

      <aside className="sidebar" aria-label="Hauptnavigation">
        <div className="opportunity-card">
          <span className={`accent ${opportunity.accent}`} />
          <small>{opportunity.code}</small><strong>{opportunity.customer}</strong><p>{opportunity.name}</p>
          <div className="probability"><span style={{ width: `${opportunity.probability}%` }} /><i>{opportunity.probability}%</i></div>
        </div>
        <nav>
          <Nav active={view === "overview"} icon="⌂" label="Übersicht" onClick={() => setView("overview")} />
          <Nav active={view === "activities"} icon="✓" label="Aktivitäten" badge={openTodos || undefined} onClick={() => setView("activities")} />
          <Nav active={view === "documents"} icon="▤" label="Dokumente" badge={documents.length || undefined} onClick={() => setView("documents")} />
          <Nav active={view === "copilot"} icon="✦" label="KI-Arbeitsbereich" badge={conversations.length || undefined} onClick={() => setView("copilot")} />
        </nav>
        <div className="isolation"><span>◈</span><div><strong>Kontext geschützt</strong><small>AIDA sieht nur diese Verkaufschance.</small></div></div>
      </aside>

      <section className="content">
        {error && <div className="alert" role="alert">{error}<button onClick={() => setError("")} aria-label="Meldung schließen">×</button></div>}
        {view === "overview" && <Overview opportunity={opportunity} activities={activities} documents={documents} artifacts={artifacts} onView={setView} onArtifact={setArtifact} />}
        {view === "activities" && <Activities items={activities} busy={busy} onToggle={id => action({ action: "toggle-todo", activityId: id })} onAdd={() => setNoteOpen(true)} />}
        {view === "documents" && <Documents items={documents} busy={busy} onUpload={() => fileRef.current?.click()} />}
        {view === "copilot" && <Copilot opportunity={opportunity} conversations={conversations} conversation={conversation} messages={messages} artifacts={artifacts} busy={busy} onSelect={setConversationId} onNew={() => action({ action: "new-chat", title: `Neue Unterhaltung ${conversations.length + 1}` })} onRefresh={load} onBusy={setBusy} onError={setError} onArtifact={setArtifact} />}
      </section>

      <input ref={fileRef} hidden type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      {selectorOpen && <OpportunityDialog items={data.opportunities} activeId={activeId} onClose={() => setSelectorOpen(false)} onSelect={id => { setActiveId(id); setSelectorOpen(false); setView("overview"); }} />}
      {noteOpen && <NoteDialog busy={busy} onClose={() => setNoteOpen(false)} onSave={async body => { await action({ action: "add-note", body }); setNoteOpen(false); }} />}
      {artifact && <ArtifactDialog item={artifact} onClose={() => setArtifact(null)} />}
    </main>
  );
}

function Nav({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span aria-hidden="true">{icon}</span>{label}{badge !== undefined && <i>{badge}</i>}</button>;
}

function Overview({ opportunity, activities, documents, artifacts, onView, onArtifact }: { opportunity: Opportunity; activities: Activity[]; documents: OpportunityDocument[]; artifacts: Artifact[]; onView: (view: View) => void; onArtifact: (item: Artifact) => void }) {
  const next = activities.find(item => item.status !== "done" && item.type !== "note");
  return <>
    <div className="page-heading"><div><small>Verkaufschance</small><h1>{opportunity.name}</h1><p>{opportunity.summary}</p></div><button className="primary" onClick={() => onView("copilot")}>✦ Mit AIDA arbeiten</button></div>
    <div className="metric-grid">
      <Metric label="Volumen" value={currency.format(opportunity.value)} detail={`Abschluss bis ${date.format(new Date(opportunity.closeDate))}`} />
      <Metric label="Phase" value={opportunity.stage} detail={`${opportunity.probability}% Wahrscheinlichkeit`} />
      <Metric label="Nächster Schritt" value={next?.title ?? "Kein offener Schritt"} detail={next ? dateTime.format(new Date(next.dueAt)) : "Jetzt planen"} />
      <Metric label="KI-Artefakte" value={String(artifacts.length)} detail="aus dieser Verkaufschance" />
    </div>
    <div className="two-columns">
      <section className="panel"><PanelTitle title="Nächste Aktivitäten" action="Alle anzeigen" onAction={() => onView("activities")} />{activities.slice(0, 4).map(item => <ActivityRow key={item.id} item={item} />)}</section>
      <section className="panel"><PanelTitle title="Letzte Ergebnisse" action="KI öffnen" onAction={() => onView("copilot")} />{artifacts.length ? artifacts.slice(0, 4).map(item => <button className="artifact-row" key={item.id} onClick={() => onArtifact(item)}><span>{artifactIcon(item.kind)}</span><div><strong>{item.title}</strong><small>{dateTime.format(new Date(item.createdAt))}</small></div><i>›</i></button>) : <Empty text="Noch keine KI-Artefakte. Erstellen Sie zuerst ein Briefing oder einen Entwurf." />}</section>
    </div>
    <section className="panel context-panel"><PanelTitle title="Kontext dieser Verkaufschance" action="Dokumente" onAction={() => onView("documents")} /><div className="context-facts"><p><small>Kunde</small><strong>{opportunity.customer}</strong></p><p><small>Dokumente</small><strong>{documents.length}</strong></p><p><small>Kontextkennung</small><strong>{opportunity.marker}</strong></p></div><div className="safe-note">◈ Antworten, Chats und Artefakte bleiben an <strong>{opportunity.code}</strong> gebunden.</div></section>
  </>;
}

function Activities({ items, busy, onToggle, onAdd }: { items: Activity[]; busy: boolean; onToggle: (id: string) => void; onAdd: () => void }) {
  return <><div className="page-heading"><div><small>Arbeitsorganisation</small><h1>Aktivitäten</h1><p>Termine, Aufgaben und Notizen im Kontext der aktiven Verkaufschance.</p></div><button className="primary" onClick={onAdd}>＋ Notiz erfassen</button></div><section className="panel list-panel">{items.map(item => <div className={`activity-full ${item.status === "done" ? "done" : ""}`} key={item.id}>{item.type === "todo" ? <button disabled={busy} onClick={() => onToggle(item.id)} aria-label={item.status === "done" ? "Aufgabe wieder öffnen" : "Aufgabe erledigen"}>{item.status === "done" ? "✓" : "○"}</button> : <span className="activity-symbol" aria-hidden="true">{item.type === "appointment" ? "◷" : "✎"}</span>}<div><small>{activityType(item.type)} · {dateTime.format(new Date(item.dueAt))}</small><strong>{item.title}</strong><p>{item.body}</p></div><span>{item.status === "done" ? "Erledigt" : item.type === "todo" ? "Offen" : "Erfasst"}</span></div>)}</section></>;
}

function Documents({ items, busy, onUpload }: { items: OpportunityDocument[]; busy: boolean; onUpload: () => void }) {
  return <><div className="page-heading"><div><small>Wissensgrundlage</small><h1>Dokumente</h1><p>Nur Dateien dieser Verkaufschance werden dem Copilot als Kontext angeboten.</p></div><button className="primary" disabled={busy} onClick={onUpload}>⇧ Dokument hochladen</button></div><div className="upload-hint">TXT, Markdown oder PDF · maximal 5 MB · vor dem Upload auf Freigabe und sensible Daten prüfen</div><section className="document-grid">{items.map(item => <a className="document-card" key={item.id} href={`/api/documents/${item.id}`}><span>{item.mediaType === "application/pdf" ? "PDF" : "TXT"}</span><div><strong>{item.name}</strong><small>{formatBytes(item.size)} · {date.format(new Date(item.createdAt))}</small></div><i>↓</i></a>)}</section></>;
}

function Copilot({ opportunity, conversations, conversation, messages, artifacts, busy, onSelect, onNew, onRefresh, onBusy, onError, onArtifact }: { opportunity: Opportunity; conversations: Conversation[]; conversation: Conversation | null; messages: Message[]; artifacts: Artifact[]; busy: boolean; onSelect: (id: string) => void; onNew: () => void; onRefresh: () => Promise<void>; onBusy: (value: boolean) => void; onError: (value: string) => void; onArtifact: (item: Artifact) => void }) {
  const [prompt, setPrompt] = useState(""); const [kind, setKind] = useState<ChatKind>("general");
  const prompts: { kind: ChatKind; label: string; text: string }[] = [
    { kind: "meeting", label: "Meeting-Briefing", text: "Bereite mich auf den nächsten Kundentermin vor. Fasse Ziele, offene Fragen, mögliche Einwände und den empfohlenen nächsten Schritt zusammen." },
    { kind: "email", label: "E-Mail entwerfen", text: "Entwirf eine freundliche Follow-up-E-Mail zum aktuellen Stand mit einem konkreten nächsten Schritt." },
    { kind: "risk", label: "Risiken analysieren", text: "Analysiere die wichtigsten Vertriebs- und Umsetzungsrisiken. Trenne Fakten, Annahmen und offene Fragen." },
    { kind: "offer", label: "Angebotsbaustein", text: "Erstelle einen Angebotsbaustein mit Kundennutzen, Leistungsumfang, Annahmen und Abgrenzungen." },
  ];
  async function send(event: FormEvent) {
    event.preventDefault(); if (!conversation || !prompt.trim()) return;
    onBusy(true); onError("");
    try { const response = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ opportunityId: opportunity.id, conversationId: conversation.id, prompt, kind }) }); const body = await response.json() as { message?: string }; if (!response.ok) throw new Error(body.message ?? "AIDA konnte die Aufgabe nicht ausführen."); setPrompt(""); setKind("general"); await onRefresh(); } catch (caught) { onError(messageOf(caught)); } finally { onBusy(false); }
  }
  return <><div className="page-heading compact"><div><small>Isolierter KI-Arbeitsbereich</small><h1>Copilot für {opportunity.code}</h1><p>Jede Unterhaltung verwendet ausschließlich den Kontext von {opportunity.customer}.</p></div><button className="secondary" disabled={busy} onClick={onNew}>＋ Neue Unterhaltung</button></div>
    <div className="copilot-layout"><aside className="chat-list"><strong>Unterhaltungen</strong>{conversations.map(item => <button className={conversation?.id === item.id ? "active" : ""} key={item.id} onClick={() => onSelect(item.id)}><span>◌</span><div><strong>{item.title}</strong><small>{dateTime.format(new Date(item.updatedAt))}</small></div></button>)}</aside>
      <section className="chat-panel"><div className="chat-header"><span className={`accent ${opportunity.accent}`} /><div><strong>{conversation?.title ?? "Unterhaltung"}</strong><small>Kontextgrenze: {opportunity.code} · {opportunity.marker}</small></div><span className="protected">◈ geschützt</span></div>
        <div className="quick-prompts">{prompts.map(item => <button key={item.kind} onClick={() => { setKind(item.kind); setPrompt(item.text); }}>{item.label}</button>)}</div>
        <div className="messages" aria-live="polite">{messages.length ? messages.map(item => <article className={item.role} key={item.id}><span>{item.role === "assistant" ? "A" : "Sie"}</span><div><small>{item.role === "assistant" ? "AIDA" : "Ihre Aufgabe"}</small><p>{item.content}</p></div></article>) : <Empty text="Beginnen Sie mit einer Frage oder wählen Sie eine vorbereitete Aufgabe." />}</div>
        <form className="composer" onSubmit={send}><textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} placeholder="Was soll AIDA für diese Verkaufschance erledigen?" aria-label="Aufgabe an AIDA" /><div><small>{kind === "general" ? "Freie Antwort" : artifactLabel(kind)} · lokale Verarbeitung bevorzugt</small><button className="primary" disabled={busy || !prompt.trim()}>{busy ? "AIDA arbeitet …" : "Senden →"}</button></div></form>
      </section>
      <aside className="artifact-list"><strong>Artefakte</strong><small>Nur {opportunity.code}</small>{artifacts.length ? artifacts.map(item => <button key={item.id} onClick={() => onArtifact(item)}><span>{artifactIcon(item.kind)}</span><div><strong>{item.title}</strong><small>{dateTime.format(new Date(item.createdAt))}</small></div></button>) : <Empty text="Noch keine Ergebnisse gespeichert." />}</aside>
    </div></>;
}

function OpportunityDialog({ items, activeId, onSelect, onClose }: { items: Opportunity[]; activeId: string; onSelect: (id: string) => void; onClose: () => void }) {
  return <Dialog title="Verkaufschance öffnen" onClose={onClose}><p className="dialog-lead">Die gesamte Seite wechselt in den gewählten, isolierten Kontext.</p>{items.map(item => <button className={`opportunity-option ${item.id === activeId ? "selected" : ""}`} key={item.id} onClick={() => onSelect(item.id)}><span className={`accent ${item.accent}`} /><div><small>{item.code}</small><strong>{item.customer}</strong><p>{item.name}</p></div><i>{item.id === activeId ? "Aktiv" : "Öffnen"}</i></button>)}</Dialog>;
}

function NoteDialog({ busy, onSave, onClose }: { busy: boolean; onSave: (body: string) => Promise<void>; onClose: () => void }) {
  const [body, setBody] = useState(""); return <Dialog title="Notiz erfassen" onClose={onClose}><form onSubmit={event => { event.preventDefault(); void onSave(body); }}><label className="field"><span>Notiz</span><textarea autoFocus minLength={2} maxLength={2000} required value={body} onChange={event => setBody(event.target.value)} placeholder="Beobachtung, Entscheidung oder nächste Idee …" /></label><div className="dialog-actions"><button type="button" className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy}>Speichern</button></div></form></Dialog>;
}

function ArtifactDialog({ item, onClose }: { item: Artifact; onClose: () => void }) {
  return <Dialog title={item.title} onClose={onClose}><div className="artifact-content">{item.content}</div><div className="dialog-actions"><button className="secondary" onClick={() => navigator.clipboard.writeText(item.content)}>In Zwischenablage kopieren</button><button className="primary" onClick={onClose}>Schließen</button></div></Dialog>;
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="Dialog schließen">×</button></header>{children}</section></div>; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <section className="metric"><small>{label}</small><strong>{value}</strong><span>{detail}</span></section>; }
function PanelTitle({ title, action, onAction }: { title: string; action: string; onAction: () => void }) { return <header className="panel-title"><h2>{title}</h2><button onClick={onAction}>{action} →</button></header>; }
function ActivityRow({ item }: { item: Activity }) { return <div className="activity-row"><span>{item.type === "appointment" ? "◷" : item.type === "todo" ? "○" : "✎"}</span><div><strong>{item.title}</strong><small>{activityType(item.type)} · {dateTime.format(new Date(item.dueAt))}</small></div></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function Loading({ error }: { error: string }) { return <main className="loading"><div className="brand-mark">A</div><h1>AIDA Opportunity Copilot</h1><p>{error || "Der geschützte Arbeitsbereich wird vorbereitet …"}</p></main>; }
function activityType(type: Activity["type"]) { return ({ appointment: "Termin", todo: "Aufgabe", note: "Notiz" })[type]; }
function artifactLabel(kind: ChatKind) { return ({ general: "Freie Antwort", meeting: "Meeting-Briefing", email: "E-Mail-Entwurf", risk: "Risikoanalyse", offer: "Angebotsbaustein" })[kind]; }
function artifactIcon(kind: string) { return ({ meeting: "◷", email: "✉", risk: "△", offer: "▤" } as Record<string, string>)[kind] ?? "✦"; }
function formatBytes(value: number) { return value < 1024 ? `${value} B` : `${Math.round(value / 1024)} KB`; }
function initials(value: string) { return value.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "A"; }
function messageOf(value: unknown) { return value instanceof Error ? value.message : "Ein unerwarteter Fehler ist aufgetreten."; }
