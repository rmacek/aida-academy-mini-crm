"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type {
  Activity, Artifact, AssistantDefinition, Conversation, CrmRole, CrmUser, Message, Opportunity,
  OpportunityDocument, UserSummary,
} from "../db/repository";

type Workspace = {
  tenant: string;
  user: CrmUser;
  permissions: { canWrite: boolean; canManageUsers: boolean; canManageAssistants: boolean };
  opportunities: Opportunity[];
  activities: Activity[];
  documents: OpportunityDocument[];
  conversations: Conversation[];
  messages: Message[];
  artifacts: Artifact[];
  users: UserSummary[];
  assistants: AssistantDefinition[];
  assistantDefinitions: AssistantDefinition[];
};
type View = "dashboard" | "overview" | "activities" | "documents" | "copilot" | "assistants" | "admin";

const currency = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function OpportunityWorkspace() {
  const [data, setData] = useState<Workspace | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [conversationId, setConversationId] = useState("");
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [opportunityEditor, setOpportunityEditor] = useState<Opportunity | "new" | null>(null);
  const [activityEditor, setActivityEditor] = useState<Activity | "new" | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [userEditor, setUserEditor] = useState<UserSummary | "new" | null>(null);
  const [assistantEditor, setAssistantEditor] = useState<AssistantDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.status === 401) {
      setData(null); setLoginRequired(true); return;
    }
    if (!response.ok) throw new Error("Der CRM-Arbeitsbereich konnte nicht geladen werden.");
    const next = await response.json() as Workspace;
    setData(next); setLoginRequired(false);
    setView(current => (current === "admin" && !next.permissions.canManageUsers)
      || (current === "assistants" && !next.permissions.canManageAssistants) ? "overview" : current);
    setActiveId(current => current && next.opportunities.some(item => item.id === current)
      ? current : next.opportunities[0]?.id ?? "");
  }, []);

  useEffect(() => {
    // The state update happens after the initial network request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load().catch(caught => setError(messageOf(caught)));
  }, [load]);

  const opportunity = data?.opportunities.find(item => item.id === activeId) ?? null;
  const activities = data?.activities.filter(item => item.opportunityId === activeId) ?? [];
  const documents = data?.documents.filter(item => item.opportunityId === activeId) ?? [];
  const conversations = data?.conversations.filter(item => item.opportunityId === activeId) ?? [];
  const artifacts = data?.artifacts.filter(item => item.opportunityId === activeId) ?? [];
  const currentConversationId = conversations.some(item => item.id === conversationId)
    ? conversationId : conversations[0]?.id ?? "";
  const conversation = conversations.find(item => item.id === currentConversationId) ?? null;
  const messages = data?.messages.filter(item => item.conversationId === conversation?.id) ?? [];

  async function mutate(url: string, body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as { id?: string; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Die Änderung konnte nicht gespeichert werden.");
      await load();
      return result;
    } catch (caught) { setError(messageOf(caught)); throw caught; }
    finally { setBusy(false); }
  }

  async function opportunityAction(body: Record<string, unknown>) {
    const result = await mutate("/api/actions", { ...body, opportunityId: activeId || undefined });
    if (body.action === "create-opportunity" && result.id) setActiveId(result.id);
  }

  async function upload(file: File) {
    if (!opportunity) return;
    setBusy(true); setError("");
    const form = new FormData(); form.set("opportunityId", opportunity.id); form.set("file", file);
    try {
      const response = await fetch("/api/documents", { method: "POST", body: form });
      if (!response.ok) throw new Error("Nur TXT, Markdown oder PDF bis 5 MB können hochgeladen werden.");
      await load(); setView("documents");
    } catch (caught) { setError(messageOf(caught)); } finally { setBusy(false); }
  }

  async function deleteDocument(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Das Dokument konnte nicht gelöscht werden.");
      await load();
    } catch (caught) { setError(messageOf(caught)); throw caught; }
    finally { setBusy(false); }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setData(null); setLoginRequired(true); setView("dashboard");
    setUserEditor(null); setAssistantEditor(null);
  }

  if (loginRequired) return <LoginScreen busy={busy} error={error} onBusy={setBusy} onError={setError} onSuccess={load} />;
  if (!data) return <Loading error={error} />;
  if (data.user.mustChangePassword) {
    return <PasswordChangeScreen user={data.user} busy={busy} error={error} onBusy={setBusy} onError={setError}
      onChanged={() => { setData(null); setLoginRequired(true); }} />;
  }
  if (!opportunity) {
    return <EmptyWorkspace data={data} busy={busy} error={error} onLogout={signOut}
      onCreate={() => setOpportunityEditor("new")} editor={opportunityEditor}
      onClose={() => setOpportunityEditor(null)} onSave={async values => {
        await opportunityAction({ action: "create-opportunity", ...values }); setOpportunityEditor(null);
      }} />;
  }
  const openTodos = activities.filter(item => item.type === "todo" && item.status !== "done").length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("dashboard")} aria-label="Zum Dashboard">
          <span className="brand-mark">A</span><span><strong>AIDA CRM</strong><small>{data.tenant}</small></span>
        </button>
        <button className="context-switch" onClick={() => setSelectorOpen(true)} aria-haspopup="dialog">
          <span><small>Aktive Verkaufschance</small><strong>{opportunity.code} · {opportunity.name}</strong></span><span aria-hidden="true">⌄</span>
        </button>
        <div className="user"><span>{initials(data.user.displayName)}</span><div><strong>{data.user.displayName}</strong><small>{roleLabel(data.user.role)}</small></div><button className="topbar-action" onClick={signOut}>Abmelden</button></div>
      </header>

      <aside className="sidebar" aria-label="Hauptnavigation">
        <div className="opportunity-card">
          <span className={`accent ${opportunity.accent}`} />
          <small>{opportunity.code}</small><strong>{opportunity.customer}</strong><p>{opportunity.name}</p>
          <div className="probability"><span style={{ width: `${opportunity.probability}%` }} /><i>{opportunity.probability}%</i></div>
        </div>
        <nav>
          <Nav active={view === "dashboard"} icon="▦" label="Dashboard" onClick={() => setView("dashboard")} />
          <Nav active={view === "overview"} icon="⌂" label="Übersicht" onClick={() => setView("overview")} />
          <Nav active={view === "activities"} icon="✓" label="Aktivitäten" badge={openTodos || undefined} onClick={() => setView("activities")} />
          <Nav active={view === "documents"} icon="▤" label="Dokumente" badge={documents.length || undefined} onClick={() => setView("documents")} />
          <Nav active={view === "copilot"} icon="✦" label="KI-Arbeitsbereich" badge={conversations.length || undefined} onClick={() => setView("copilot")} />
          {data.permissions.canManageAssistants && <Nav active={view === "assistants"} icon="◎" label="KI-Assistenten" onClick={() => setView("assistants")} />}
          {data.permissions.canManageUsers && <Nav active={view === "admin"} icon="⚙" label="Benutzer" onClick={() => setView("admin")} />}
        </nav>
        <div className="isolation"><span>◈</span><div><strong>Kontext geschützt</strong><small>AIDA erhält nur diese Verkaufschance.</small></div></div>
      </aside>

      <section className="content">
        {error && <div className="alert" role="alert">{error}<button onClick={() => setError("")} aria-label="Meldung schließen">×</button></div>}
        {view === "dashboard" && <Dashboard user={data.user} opportunities={data.opportunities} activities={data.activities}
          canWrite={data.permissions.canWrite} onOpen={id => { setActiveId(id); setView("overview"); }}
          onCreate={() => setOpportunityEditor("new")} />}
        {view === "overview" && <Overview opportunity={opportunity} activities={activities} documents={documents} artifacts={artifacts}
          canWrite={data.permissions.canWrite} onEdit={() => setOpportunityEditor(opportunity)} onView={setView} onArtifact={setArtifact} />}
        {view === "activities" && <Activities items={activities} busy={busy} canWrite={data.permissions.canWrite}
          onToggle={id => opportunityAction({ action: "toggle-todo", activityId: id })}
          onDelete={id => opportunityAction({ action: "delete-activity", activityId: id })}
          onAdd={() => setActivityEditor("new")} onEdit={setActivityEditor} />}
        {view === "documents" && <Documents items={documents} busy={busy} canWrite={data.permissions.canWrite}
          onUpload={() => fileRef.current?.click()} onDelete={deleteDocument} />}
        {view === "copilot" && <Copilot opportunity={opportunity} assistants={data.assistants} conversations={conversations} conversation={conversation} messages={messages}
          artifacts={artifacts} busy={busy} canWrite={data.permissions.canWrite} onSelect={setConversationId}
          onNew={() => opportunityAction({ action: "new-chat", title: `Neue Unterhaltung ${conversations.length + 1}` })}
          onRefresh={load} onBusy={setBusy} onError={setError} onArtifact={setArtifact} />}
        {view === "assistants" && data.permissions.canManageAssistants && <AssistantAdministration items={data.assistantDefinitions} onEdit={setAssistantEditor} />}
        {view === "admin" && data.permissions.canManageUsers && <UserAdministration users={data.users} currentUserId={data.user.userId} busy={busy}
          onCreate={() => setUserEditor("new")} onEdit={setUserEditor} onUpdate={body => mutate("/api/admin/users", body)} />}
      </section>

      <input ref={fileRef} hidden type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
        onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
      {selectorOpen && <OpportunitySelector items={data.opportunities} activeId={activeId} canWrite={data.permissions.canWrite}
        onClose={() => setSelectorOpen(false)} onNew={() => { setSelectorOpen(false); setOpportunityEditor("new"); }}
        onSelect={id => { setActiveId(id); setSelectorOpen(false); setView("overview"); }} />}
      {opportunityEditor && <OpportunityForm item={opportunityEditor === "new" ? null : opportunityEditor} busy={busy}
        onClose={() => setOpportunityEditor(null)} onSave={async values => {
          await opportunityAction({ action: opportunityEditor === "new" ? "create-opportunity" : "update-opportunity", ...values });
          setOpportunityEditor(null);
        }} onDelete={opportunityEditor === "new" ? undefined : async confirmation => {
          await opportunityAction({ action: "delete-opportunity", confirmation }); setOpportunityEditor(null);
        }} />}
      {activityEditor && <ActivityForm item={activityEditor === "new" ? null : activityEditor} busy={busy}
        onClose={() => setActivityEditor(null)} onSave={async values => {
          await opportunityAction({ action: activityEditor === "new" ? "create-activity" : "update-activity",
            activityId: activityEditor === "new" ? undefined : activityEditor.id, ...values });
          setActivityEditor(null);
        }} />}
      {artifact && <ArtifactDialog item={artifact} onClose={() => setArtifact(null)} />}
      {userEditor && <UserForm item={userEditor === "new" ? null : userEditor} busy={busy}
        onClose={() => setUserEditor(null)} onSave={async values => {
          if (userEditor === "new") {
            await mutate("/api/admin/users", { action: "create", ...values });
          } else {
            await mutate("/api/admin/users", { action: "update", id: userEditor.id,
              displayName: values.displayName, role: values.role, active: userEditor.active });
            if (values.password) await mutate("/api/admin/users", { action: "reset-password", id: userEditor.id, password: values.password });
          }
          setUserEditor(null);
        }} />}
      {assistantEditor && <AssistantForm item={assistantEditor} busy={busy} onClose={() => setAssistantEditor(null)} onSave={async values => {
        await mutate("/api/admin/assistants", { key: assistantEditor.key, ...values }); setAssistantEditor(null);
      }} />}
    </main>
  );
}

function LoginScreen({ busy, error, onBusy, onError, onSuccess }: { busy: boolean; error: string; onBusy: (value: boolean) => void; onError: (value: string) => void; onSuccess: () => Promise<void> }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); onBusy(true); onError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: form.get("username"), password: form.get("password") }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Anmeldung fehlgeschlagen.");
      await onSuccess();
    } catch (caught) { onError(messageOf(caught)); } finally { onBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-card"><div className="brand-mark">A</div><small>AIDA MARKETPLACE APP</small><h1>CRM anmelden</h1><p>Arbeiten Sie gemeinsam und sicher im CRM Ihres Unternehmens.</p>{error && <div className="alert" role="alert">{error}</div>}<form onSubmit={submit}><TextField name="username" label="Benutzername" autoComplete="username" required /><TextField name="password" label="Passwort" type="password" autoComplete="current-password" required /><button className="primary" disabled={busy}>{busy ? "Anmeldung wird geprüft …" : "Anmelden"}</button></form></section></main>;
}

function PasswordChangeScreen({ user, busy, error, onBusy, onError, onChanged }: { user: CrmUser; busy: boolean; error: string; onBusy: (value: boolean) => void; onError: (value: string) => void; onChanged: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); onBusy(true); onError(""); const form = new FormData(event.currentTarget);
    if (form.get("nextPassword") !== form.get("confirmPassword")) { onError("Die neuen Passwörter stimmen nicht überein."); onBusy(false); return; }
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), nextPassword: form.get("nextPassword") }) });
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Das Passwort konnte nicht geändert werden."); onChanged();
    } catch (caught) { onError(messageOf(caught)); } finally { onBusy(false); }
  }
  return <main className="auth-shell"><section className="auth-card wide"><div className="brand-mark">A</div><small>ERSTE ANMELDUNG · {user.username}</small><h1>Eigenes Passwort festlegen</h1><p>Das Initialpasswort ist nur für die erste Anmeldung bestimmt. Das neue Passwort muss mindestens 16 Zeichen lang sein.</p>{error && <div className="alert" role="alert">{error}</div>}<form onSubmit={submit}><TextField name="currentPassword" label="Aktuelles Passwort" type="password" autoComplete="current-password" required /><TextField name="nextPassword" label="Neues Passwort" type="password" autoComplete="new-password" minLength={16} required /><TextField name="confirmPassword" label="Neues Passwort wiederholen" type="password" autoComplete="new-password" minLength={16} required /><button className="primary" disabled={busy}>{busy ? "Wird gespeichert …" : "Passwort ändern und neu anmelden"}</button></form></section></main>;
}

function EmptyWorkspace({ data, busy, error, onLogout, onCreate, editor, onClose, onSave }: { data: Workspace; busy: boolean; error: string; onLogout: () => void; onCreate: () => void; editor: Opportunity | "new" | null; onClose: () => void; onSave: (values: Record<string, unknown>) => Promise<void> }) {
  return <main className="auth-shell"><section className="auth-card wide"><div className="brand-mark">A</div><small>{data.tenant}</small><h1>Noch keine Verkaufschance</h1><p>Legen Sie die erste Verkaufschance an. Danach können alle berechtigten Mitarbeiter gemeinsam daran arbeiten.</p>{error && <div className="alert">{error}</div>}<div className="dialog-actions"><button className="secondary" onClick={onLogout}>Abmelden</button>{data.permissions.canWrite && <button className="primary" onClick={onCreate}>Verkaufschance anlegen</button>}</div></section>{editor && <OpportunityForm item={null} busy={busy} onClose={onClose} onSave={onSave} />}</main>;
}

function Nav({ active, icon, label, badge, onClick }: { active: boolean; icon: string; label: string; badge?: number; onClick: () => void }) { return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onClick}><span aria-hidden="true">{icon}</span>{label}{badge !== undefined && <i>{badge}</i>}</button>; }

function Dashboard({ user, opportunities, activities, canWrite, onOpen, onCreate }: { user: CrmUser; opportunities: Opportunity[]; activities: Activity[]; canWrite: boolean; onOpen: (id: string) => void; onCreate: () => void }) {
  const [now] = useState(Date.now);
  const active = opportunities.filter(item => !["Gewonnen", "Verloren"].includes(item.stage));
  const openTodos = activities.filter(item => item.type === "todo" && item.status !== "done");
  const myTodos = openTodos.filter(item => item.assignedTo === user.userId);
  const overdue = openTodos.filter(item => new Date(item.dueAt).getTime() < now);
  const weighted = active.reduce((sum, item) => sum + item.value * item.probability / 100, 0);
  const dueSoon = openTodos.filter(item => { const due = new Date(item.dueAt).getTime(); return due >= now && due <= now + 7 * 86400000; });
  const stageOrder = ["Qualifizierung", "Lösungsdesign", "Angebot", "Verhandlung"];
  const nextActions = [...openTodos].sort((left, right) => +new Date(left.dueAt) - +new Date(right.dueAt)).slice(0, 8);
  return <><div className="page-heading"><div><small>Persönlicher Arbeitsstart</small><h1>Pipeline-Dashboard</h1><p>Überblick über laufende Verkaufschancen und die nächsten Aufgaben. KI-Unterhaltungen bleiben weiterhin strikt an eine geöffnete Verkaufschance gebunden.</p></div>{canWrite && <button className="primary" onClick={onCreate}>＋ Verkaufschance anlegen</button>}</div><div className="metric-grid dashboard-metrics"><Metric label="Laufende Verkaufschancen" value={String(active.length)} detail={`${opportunities.length - active.length} abgeschlossen`} /><Metric label="Gewichtete Pipeline" value={currency.format(weighted)} detail="Volumen × Wahrscheinlichkeit" /><Metric label="Meine offenen Aufgaben" value={String(myTodos.length)} detail={`${dueSoon.length} tenantweit in 7 Tagen fällig`} /><Metric label="Überfälliger Handlungsbedarf" value={String(overdue.length)} detail={overdue.length ? "Priorisiert bearbeiten" : "Aktuell nichts überfällig"} /></div><section className="panel pipeline-summary"><PanelTitle title="Pipeline nach Phase" action="Verkaufschancen prüfen" onAction={() => active[0] && onOpen(active[0].id)} /><div>{stageOrder.map(stage => { const items = active.filter(item => item.stage === stage); const total = items.reduce((sum, item) => sum + item.value, 0); return <article key={stage}><span>{stage}</span><strong>{items.length}</strong><small>{currency.format(total)}</small></article>; })}</div></section><div className="dashboard-columns"><section><header className="section-title"><div><small>LAUFENDE VERKAUFSCHANCEN</small><h2>Status und Handlungsbedarf</h2></div></header><div className="pipeline-grid">{active.length ? active.map(item => { const itemActivities = activities.filter(activity => activity.opportunityId === item.id); const itemOpen = itemActivities.filter(activity => activity.type === "todo" && activity.status !== "done"); const itemOverdue = itemOpen.filter(activity => +new Date(activity.dueAt) < now); const next = [...itemActivities].filter(activity => activity.status !== "done" && activity.type !== "note").sort((left, right) => +new Date(left.dueAt) - +new Date(right.dueAt))[0]; return <button className="pipeline-card" key={item.id} onClick={() => onOpen(item.id)}><header><span className={`accent ${item.accent}`} /><div><small>{item.code}</small><strong>{item.customer}</strong><p>{item.name}</p></div><i className={itemOverdue.length ? "attention" : "stable"}>{itemOverdue.length ? `${itemOverdue.length} überfällig` : "Im Plan"}</i></header><dl><div><dt>Phase</dt><dd>{item.stage}</dd></div><div><dt>Wahrscheinlichkeit</dt><dd>{item.probability}%</dd></div><div><dt>Volumen</dt><dd>{currency.format(item.value)}</dd></div><div><dt>Abschluss</dt><dd>{date.format(new Date(item.closeDate))}</dd></div></dl><footer><span><small>Nächster Schritt</small><strong>{next?.title ?? "Nächsten Schritt festlegen"}</strong></span><span><small>Offene Aufgaben</small><strong>{itemOpen.length}</strong></span></footer></button>; }) : <Empty text="Keine laufenden Verkaufschancen. Gewonnene und verlorene Vorgänge bleiben in den Daten erhalten." />}</div></section><section className="panel task-radar"><div className="section-title"><div><small>WAS IST ZU TUN?</small><h2>Nächste offene Aufgaben</h2></div><span>{openTodos.length} offen</span></div>{nextActions.length ? nextActions.map(item => { const opportunity = opportunities.find(entry => entry.id === item.opportunityId); const isOverdue = +new Date(item.dueAt) < now; return <button key={item.id} onClick={() => opportunity && onOpen(opportunity.id)}><span className={isOverdue ? "task-date overdue" : "task-date"}>{date.format(new Date(item.dueAt))}</span><div><small>{opportunity?.code ?? "Verkaufschance"}</small><strong>{item.title}</strong><p>{opportunity?.customer}</p></div><i>›</i></button>; }) : <Empty text="Keine offenen Aufgaben. Prüfen Sie dennoch, ob jede laufende Verkaufschance einen nächsten Schritt hat." />}</section></div></>;
}

function Overview({ opportunity, activities, documents, artifacts, canWrite, onEdit, onView, onArtifact }: { opportunity: Opportunity; activities: Activity[]; documents: OpportunityDocument[]; artifacts: Artifact[]; canWrite: boolean; onEdit: () => void; onView: (view: View) => void; onArtifact: (item: Artifact) => void }) {
  const next = activities.find(item => item.status !== "done" && item.type !== "note");
  return <><div className="page-heading"><div><small>Verkaufschance</small><h1>{opportunity.name}</h1><p>{opportunity.summary}</p></div><div className="heading-actions">{canWrite && <button className="secondary" onClick={onEdit}>Bearbeiten</button>}<button className="primary" onClick={() => onView("copilot")}>✦ Mit AIDA arbeiten</button></div></div><div className="metric-grid"><Metric label="Volumen" value={currency.format(opportunity.value)} detail={`Abschluss bis ${date.format(new Date(opportunity.closeDate))}`} /><Metric label="Phase" value={opportunity.stage} detail={`${opportunity.probability}% Wahrscheinlichkeit`} /><Metric label="Nächster Schritt" value={next?.title ?? "Kein offener Schritt"} detail={next ? dateTime.format(new Date(next.dueAt)) : "Jetzt planen"} /><Metric label="KI-Artefakte" value={String(artifacts.length)} detail="aus dieser Verkaufschance" /></div><section className="panel use-case-panel"><div><small>KUNDEN-USECASE</small><h2>Was soll beim Kunden funktionieren?</h2></div><p>{opportunity.useCase}</p><button onClick={() => onView("copilot")}>Machbarkeit und Umsetzung mit KI bearbeiten →</button></section><div className="two-columns"><section className="panel"><PanelTitle title="Nächste Aktivitäten" action="Alle anzeigen" onAction={() => onView("activities")} />{activities.length ? activities.slice(0, 4).map(item => <ActivityRow key={item.id} item={item} />) : <Empty text="Noch keine Aktivitäten erfasst." />}</section><section className="panel"><PanelTitle title="Letzte Ergebnisse" action="KI öffnen" onAction={() => onView("copilot")} />{artifacts.length ? artifacts.slice(0, 4).map(item => <button className="artifact-row" key={item.id} onClick={() => onArtifact(item)}><span>{artifactIcon(item.kind)}</span><div><strong>{item.title}</strong><small>{dateTime.format(new Date(item.createdAt))}</small></div><i>›</i></button>) : <Empty text="Noch keine KI-Artefakte. Erstellen Sie zuerst ein Briefing oder einen Entwurf." />}</section></div><section className="panel context-panel"><PanelTitle title="Kontext dieser Verkaufschance" action="Dokumente" onAction={() => onView("documents")} /><div className="context-facts"><p><small>Kunde</small><strong>{opportunity.customer}</strong></p><p><small>Dokumente</small><strong>{documents.length}</strong></p><p><small>Kontextkennung</small><strong>{opportunity.marker}</strong></p></div><div className="safe-note">◈ Antworten, Chats und Artefakte bleiben an <strong>{opportunity.code}</strong> gebunden.</div></section></>;
}

function Activities({ items, busy, canWrite, onToggle, onDelete, onAdd, onEdit }: { items: Activity[]; busy: boolean; canWrite: boolean; onToggle: (id: string) => void; onDelete: (id: string) => void; onAdd: () => void; onEdit: (item: Activity) => void }) { return <><div className="page-heading"><div><small>Arbeitsorganisation</small><h1>Aktivitäten</h1><p>Termine, Aufgaben und Notizen im Kontext der aktiven Verkaufschance.</p></div>{canWrite && <button className="primary" onClick={onAdd}>＋ Aktivität erfassen</button>}</div><section className="panel list-panel">{items.length ? items.map(item => <div className={`activity-full ${item.status === "done" ? "done" : ""}`} key={item.id}>{item.type === "todo" ? <button disabled={busy || !canWrite} onClick={() => onToggle(item.id)} aria-label={item.status === "done" ? "Aufgabe wieder öffnen" : "Aufgabe erledigen"}>{item.status === "done" ? "✓" : "○"}</button> : <span className="activity-symbol" aria-hidden="true">{item.type === "appointment" ? "◷" : "✎"}</span>}<div><small>{activityType(item.type)} · {dateTime.format(new Date(item.dueAt))}</small><strong>{item.title}</strong><p>{item.body}</p></div>{canWrite ? <div className="activity-actions"><button className="secondary compact-button" onClick={() => onEdit(item)}>Bearbeiten</button><button className="icon-button" onClick={() => { if (confirm(`„${item.title}“ löschen?`)) onDelete(item.id); }} aria-label="Aktivität löschen">×</button></div> : <span>{item.status === "done" ? "Erledigt" : "Offen"}</span>}</div>) : <Empty text="Noch keine Termine, Aufgaben oder Notizen erfasst." />}</section></>; }

function Documents({ items, busy, canWrite, onUpload, onDelete }: { items: OpportunityDocument[]; busy: boolean; canWrite: boolean; onUpload: () => void; onDelete: (id: string) => Promise<void> }) { return <><div className="page-heading"><div><small>Wissensgrundlage</small><h1>Dokumente</h1><p>Nur Dateien dieser Verkaufschance werden dem Copilot als Kontext angeboten.</p></div>{canWrite && <button className="primary" disabled={busy} onClick={onUpload}>⇧ Dokument hochladen</button>}</div><div className="upload-hint">TXT, Markdown oder PDF · maximal 5 MB · vor dem Upload auf Freigabe und sensible Daten prüfen</div><section className="document-grid">{items.length ? items.map(item => <div className="document-card-wrap" key={item.id}><a className="document-card" href={`/api/documents/${item.id}`}><span>{item.mediaType === "application/pdf" ? "PDF" : "TXT"}</span><div><strong>{item.name}</strong><small>{formatBytes(item.size)} · {date.format(new Date(item.createdAt))}</small></div><i>↓</i></a>{canWrite && <button className="icon-button document-delete" disabled={busy} onClick={() => { if (confirm(`„${item.name}“ dauerhaft löschen?`)) void onDelete(item.id); }} aria-label={`Dokument ${item.name} löschen`}>×</button>}</div>) : <Empty text="Noch keine Dokumente hochgeladen." />}</section></>; }

function Copilot({ opportunity, assistants, conversations, conversation, messages, artifacts, busy, canWrite, onSelect, onNew, onRefresh, onBusy, onError, onArtifact }: { opportunity: Opportunity; assistants: AssistantDefinition[]; conversations: Conversation[]; conversation: Conversation | null; messages: Message[]; artifacts: Artifact[]; busy: boolean; canWrite: boolean; onSelect: (id: string) => void; onNew: () => void; onRefresh: () => Promise<void>; onBusy: (value: boolean) => void; onError: (value: string) => void; onArtifact: (item: Artifact) => void }) {
  const defaultAssistant = assistants.find(item => item.key === "sales-copilot") ?? assistants[0];
  const [prompt, setPrompt] = useState(""); const [assistantKey, setAssistantKey] = useState(defaultAssistant?.key ?? "");
  const selectedAssistant = assistants.find(item => item.key === assistantKey) ?? defaultAssistant;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!conversation || !prompt.trim() || !selectedAssistant) return;
    onBusy(true); onError("");
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opportunityId: opportunity.id, conversationId: conversation.id,
          prompt, assistantKey: selectedAssistant.key }),
      });
      await readChatResponse(response);
      setPrompt("");
      await onRefresh();
    } catch (caught) { onError(messageOf(caught)); }
    finally { onBusy(false); }
  }
  return <><div className="page-heading compact"><div><small>Isolierter KI-Arbeitsbereich</small><h1>Copilot für {opportunity.code}</h1><p>Die Assistenten sind in dieser CRM-Installation vorkonfiguriert; AIDA erhält ausschließlich den Kontext von {opportunity.customer}.</p></div>{canWrite && <button className="secondary" disabled={busy} onClick={onNew}>＋ Neue Unterhaltung</button>}</div><div className="assistant-cards">{assistants.map(item => <button className={selectedAssistant?.key === item.key ? "selected" : ""} disabled={!canWrite} key={item.key} onClick={() => { setAssistantKey(item.key); setPrompt(item.starterPrompt); }}><strong>{item.displayName}</strong><span>{item.description}</span></button>)}</div><div className="copilot-layout"><aside className="chat-list"><strong>Unterhaltungen</strong>{conversations.map(item => <button className={conversation?.id === item.id ? "active" : ""} key={item.id} onClick={() => onSelect(item.id)}><span>◌</span><div><strong>{item.title}</strong><small>{dateTime.format(new Date(item.updatedAt))}</small></div></button>)}</aside><section className="chat-panel"><div className="chat-header"><span className={`accent ${opportunity.accent}`} /><div><strong>{selectedAssistant?.displayName ?? "CRM-Assistent"}</strong><small>Kontextgrenze: {opportunity.code} · {opportunity.marker}</small></div><span className="protected">◈ geschützt</span></div><div className="messages" aria-live="polite">{messages.length ? messages.map(item => <article className={item.role} key={item.id}><span>{item.role === "assistant" ? "A" : "Sie"}</span><div><small>{item.role === "assistant" ? "AIDA" : "Ihre Aufgabe"}</small><p>{item.content}</p></div></article>) : <Empty text="Wählen Sie einen vorkonfigurierten Assistenten oder stellen Sie eine freie Frage." />}</div><form className="composer" onSubmit={send}><textarea disabled={!canWrite} value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={4000} placeholder={canWrite ? "Was soll der gewählte Assistent für diese Verkaufschance erledigen?" : "Ihre Rolle hat Lesezugriff."} aria-label="Aufgabe an AIDA" /><div><small>{selectedAssistant?.outputLabel ?? "Freie Antwort"} · lokales Modellprofil bevorzugt</small><button className="primary" disabled={busy || !prompt.trim() || !canWrite || !selectedAssistant}>{busy ? "AIDA arbeitet …" : "Senden →"}</button></div></form></section><aside className="artifact-list"><strong>Artefakte</strong><small>Nur {opportunity.code}</small>{artifacts.length ? artifacts.map(item => <button key={item.id} onClick={() => onArtifact(item)}><span>{artifactIcon(item.kind)}</span><div><strong>{item.title}</strong><small>{dateTime.format(new Date(item.createdAt))}</small></div></button>) : <Empty text="Noch keine Ergebnisse gespeichert." />}</aside></div></>;
}

function UserAdministration({ users, currentUserId, busy, onCreate, onEdit, onUpdate }: { users: UserSummary[]; currentUserId: string; busy: boolean; onCreate: () => void; onEdit: (user: UserSummary) => void; onUpdate: (body: Record<string, unknown>) => Promise<unknown> }) { return <><div className="page-heading"><div><small>Tenantverwaltung</small><h1>CRM-Benutzer</h1><p>Diese Konten teilen sich die Verkaufschancen dieses CRM-Tenants. Rollen begrenzen Änderungen und Administration.</p></div><button className="primary" onClick={onCreate}>＋ Benutzer anlegen</button></div><section className="panel user-table"><table><thead><tr><th>Benutzer</th><th>Rolle</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.displayName}</strong><small>{user.username}</small></td><td>{roleLabel(user.role)}</td><td>{user.active ? "Aktiv" : "Deaktiviert"}</td><td><div className="table-actions"><button className="secondary compact-button" disabled={busy} onClick={() => onEdit(user)}>Bearbeiten</button><button className="secondary compact-button" disabled={busy || user.id === currentUserId} onClick={() => void onUpdate({ action: "update", id: user.id, displayName: user.displayName, role: user.role, active: !user.active })}>{user.active ? "Deaktivieren" : "Aktivieren"}</button></div></td></tr>)}</tbody></table></section></>; }

function AssistantAdministration({ items, onEdit }: { items: AssistantDefinition[]; onEdit: (item: AssistantDefinition) => void }) {
  return <><div className="page-heading"><div><small>CRM-Konfiguration</small><h1>Vorkonfigurierte KI-Assistenten</h1><p>Diese Fachrollen gehören zum CRM-Paket. AIDA führt ihre englischen ACTION-Prompts generisch aus; im AIDA-Kern ist keine CRM-Fachlogik hinterlegt.</p></div></div><div className="assistant-admin-grid">{items.map(item => <section className={`assistant-admin-card ${item.active ? "" : "inactive"}`} key={item.key}><header><div><small>{item.key}</small><h2>{item.displayName}</h2></div><span>{item.active ? "Aktiv" : "Deaktiviert"}</span></header><p>{item.description}</p><dl><div><dt>Ergebnis</dt><dd>{item.createsArtifact ? item.outputLabel || "Artefakt" : "Chat-Antwort"}</dd></div><div><dt>Modellprofil</dt><dd>{item.modelProfileName || "CRM-Standardprofil"}</dd></div><div><dt>Produktwissen</dt><dd>{item.usesProductKnowledge ? "AIDA-Wissensbasis" : "Nicht verwendet"}</dd></div></dl><button className="secondary" onClick={() => onEdit(item)}>Konfiguration bearbeiten</button></section>)}</div></>;
}

function OpportunitySelector({ items, activeId, canWrite, onSelect, onNew, onClose }: { items: Opportunity[]; activeId: string; canWrite: boolean; onSelect: (id: string) => void; onNew: () => void; onClose: () => void }) { return <Dialog title="Verkaufschance öffnen" onClose={onClose}><p className="dialog-lead">Die gesamte Seite wechselt in den gewählten, isolierten Kontext.</p>{items.map(item => <button className={`opportunity-option ${item.id === activeId ? "selected" : ""}`} key={item.id} onClick={() => onSelect(item.id)}><span className={`accent ${item.accent}`} /><div><small>{item.code}</small><strong>{item.customer}</strong><p>{item.name}</p></div><i>{item.id === activeId ? "Aktiv" : "Öffnen"}</i></button>)}{canWrite && <div className="dialog-actions"><button className="primary" onClick={onNew}>＋ Neue Verkaufschance</button></div>}</Dialog>; }

function OpportunityForm({ item, busy, onSave, onDelete, onClose }: { item: Opportunity | null; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onDelete?: (confirmation: string) => Promise<void>; onClose: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await onSave(Object.fromEntries(form.entries())); }
  return <Dialog title={item ? "Verkaufschance bearbeiten" : "Verkaufschance anlegen"} onClose={onClose}><form className="form-grid" onSubmit={submit}><TextField name="code" label="Code" defaultValue={item?.code ?? "OPP-"} required /><TextField name="customer" label="Kunde" defaultValue={item?.customer} required /><TextField name="name" label="Bezeichnung" defaultValue={item?.name} required wide /><TextField name="value" label="Volumen in EUR" type="number" min={0} defaultValue={item?.value ?? 0} required /><SelectField name="stage" label="Phase" defaultValue={item?.stage ?? "Qualifizierung"} options={["Qualifizierung", "Lösungsdesign", "Angebot", "Verhandlung", "Gewonnen", "Verloren"]} /><TextField name="probability" label="Wahrscheinlichkeit in %" type="number" min={0} max={100} defaultValue={item?.probability ?? 20} required /><TextField name="closeDate" label="Geplanter Abschluss" type="date" defaultValue={item?.closeDate?.slice(0, 10) ?? "2026-12-31"} required /><label className="field wide"><span>Zusammenfassung</span><textarea name="summary" minLength={2} maxLength={2000} required defaultValue={item?.summary} /></label><label className="field wide"><span>Kunden-UseCase</span><textarea name="useCase" minLength={10} maxLength={8000} required defaultValue={item?.useCase} placeholder="Beschreiben Sie, was beim Kunden konkret funktionieren soll, wer damit arbeitet und welches Ergebnis erwartet wird." /></label><SelectField name="accent" label="Farbakzent" defaultValue={item?.accent ?? "violet"} options={["violet", "teal", "orange", "blue"]} /><div className="dialog-actions wide">{item && onDelete && <button type="button" className="danger" disabled={busy} onClick={() => { const confirmation = prompt(`Zum endgültigen Löschen ${item.code} eingeben:`); if (confirmation === item.code) void onDelete(confirmation); }}>Verkaufschance löschen</button>}<span className="dialog-spacer" /><button type="button" className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy}>{busy ? "Speichern …" : "Speichern"}</button></div></form></Dialog>;
}

function ActivityForm({ item, busy, onSave, onClose }: { item: Activity | null; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onClose: () => void }) { async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const values = Object.fromEntries(form.entries()); values.dueAt = new Date(String(form.get("dueAt"))).toISOString(); await onSave(values); } const [tomorrow] = useState(() => localDateTime(new Date(Date.now() + 86400000).toISOString())); return <Dialog title={item ? "Aktivität bearbeiten" : "Aktivität erfassen"} onClose={onClose}><form className="form-grid" onSubmit={submit}><SelectField name="type" label="Art" defaultValue={item?.type ?? "todo"} options={["todo", "appointment", "note"]} labels={{ todo: "Aufgabe", appointment: "Termin", note: "Notiz" }} /><TextField name="dueAt" label="Termin/Fälligkeit" type="datetime-local" defaultValue={item ? localDateTime(item.dueAt) : tomorrow} required /><TextField name="title" label="Titel" defaultValue={item?.title} required wide /><label className="field wide"><span>Beschreibung</span><textarea name="body" minLength={2} maxLength={4000} defaultValue={item?.body} required /></label><div className="dialog-actions wide"><button type="button" className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy}>{item ? "Änderungen speichern" : "Speichern"}</button></div></form></Dialog>; }

function UserForm({ item, busy, onSave, onClose }: { item: UserSummary | null; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onClose: () => void }) { async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await onSave({ username: form.get("username"), displayName: form.get("displayName"), role: form.get("role"), password: form.get("newInitialPassword") || undefined }); } return <Dialog title={item ? "CRM-Benutzer bearbeiten" : "CRM-Benutzer anlegen"} onClose={onClose}><form className="form-grid" onSubmit={submit}><TextField name="username" label="Benutzername" pattern="[a-z][a-z0-9._-]{2,79}" autoComplete="off" defaultValue={item?.username} readOnly={Boolean(item)} required /><TextField name="displayName" label="Anzeigename" autoComplete="off" defaultValue={item?.displayName} required /><SelectField name="role" label="Rolle" defaultValue={item?.role ?? "sales"} options={["sales", "reader", "admin"]} labels={{ sales: "Vertrieb", reader: "Leser", admin: "Administrator" }} /><TextField name="newInitialPassword" label={item ? "Neues Initialpasswort (optional)" : "Initialpasswort"} type="password" autoComplete="new-password" minLength={16} defaultValue={item ? "" : "iqx4academy2026."} required={!item} /><p className="form-help wide">{item ? "Wird ein neues Initialpasswort gesetzt, muss es bei der nächsten Anmeldung geändert werden." : "Der Benutzer muss das Initialpasswort bei der ersten Anmeldung ändern."}</p><div className="dialog-actions wide"><button type="button" className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy}>{item ? "Änderungen speichern" : "Benutzer anlegen"}</button></div></form></Dialog>; }

function AssistantForm({ item, busy, onSave, onClose }: { item: AssistantDefinition; busy: boolean; onSave: (values: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await onSave({ displayName: form.get("displayName"), description: form.get("description"), starterPrompt: form.get("starterPrompt"), actionInstructions: form.get("actionInstructions"), outputLabel: form.get("outputLabel"), modelProfileName: form.get("modelProfileName"), createsArtifact: form.get("createsArtifact") === "on", usesProductKnowledge: form.get("usesProductKnowledge") === "on", active: form.get("active") === "on" }); }
  return <Dialog title={`KI-Assistent: ${item.displayName}`} onClose={onClose}><form className="form-grid assistant-form" onSubmit={submit}><TextField name="displayName" label="Anzeigename" defaultValue={item.displayName} required wide /><label className="field wide"><span>Beschreibung</span><textarea name="description" minLength={10} maxLength={500} required defaultValue={item.description} /></label><label className="field wide"><span>Vorgeschlagene Startaufgabe (Deutsch)</span><textarea name="starterPrompt" minLength={10} maxLength={2000} required defaultValue={item.starterPrompt} /></label><label className="field wide"><span>ACTION-Prompt (Englisch)</span><textarea className="prompt-editor" name="actionInstructions" minLength={80} maxLength={12000} required defaultValue={item.actionInstructions} /></label><TextField name="outputLabel" label="Artefaktbezeichnung" defaultValue={item.outputLabel ?? ""} /><TextField name="modelProfileName" label="AIDA-Modellprofil (optional)" defaultValue={item.modelProfileName ?? ""} /><label className="check-field"><input name="createsArtifact" type="checkbox" defaultChecked={item.createsArtifact} /><span>Antwort als Artefakt speichern</span></label><label className="check-field"><input name="usesProductKnowledge" type="checkbox" defaultChecked={item.usesProductKnowledge} /><span>Zentrale AIDA-Produktwissensbasis verwenden</span></label><label className="check-field"><input name="active" type="checkbox" defaultChecked={item.active} /><span>Assistent im KI-Arbeitsbereich aktiv</span></label><p className="form-help wide">Die Abschnitte ACTION, Act, Context, Task, Instructions, Output und Narrowing sind verpflichtend. Änderungen wirken für alle CRM-Benutzer dieser Installation und werden protokolliert.</p><div className="dialog-actions wide"><button type="button" className="secondary" onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy}>{busy ? "Speichern …" : "Konfiguration speichern"}</button></div></form></Dialog>;
}

function ArtifactDialog({ item, onClose }: { item: Artifact; onClose: () => void }) { return <Dialog title={item.title} onClose={onClose}><div className="artifact-content">{item.content}</div><div className="dialog-actions"><a className="secondary link-button" href={`/api/artifacts/${item.id}`}>Markdown herunterladen</a><button className="secondary" onClick={() => navigator.clipboard.writeText(item.content)}>Kopieren</button><button className="primary" onClick={onClose}>Schließen</button></div></Dialog>; }
function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) { return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="Dialog schließen">×</button></header>{children}</section></div>; }
function TextField(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string; wide?: boolean }) { const { label, wide, ...input } = props; return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span><input {...input} /></label>; }
function SelectField({ name, label, options, labels = {}, defaultValue }: { name: string; label: string; options: string[]; labels?: Record<string, string>; defaultValue: string }) { return <label className="field"><span>{label}</span><select name={name} defaultValue={defaultValue}>{options.map(value => <option value={value} key={value}>{labels[value] ?? value}</option>)}</select></label>; }
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <section className="metric"><small>{label}</small><strong>{value}</strong><span>{detail}</span></section>; }
function PanelTitle({ title, action, onAction }: { title: string; action: string; onAction: () => void }) { return <header className="panel-title"><h2>{title}</h2><button onClick={onAction}>{action} →</button></header>; }
function ActivityRow({ item }: { item: Activity }) { return <div className="activity-row"><span>{item.type === "appointment" ? "◷" : item.type === "todo" ? "○" : "✎"}</span><div><strong>{item.title}</strong><small>{activityType(item.type)} · {dateTime.format(new Date(item.dueAt))}</small></div></div>; }
function Empty({ text }: { text: string }) { return <div className="empty">{text}</div>; }
function Loading({ error }: { error: string }) { return <main className="loading"><div className="brand-mark">A</div><h1>AIDA CRM</h1><p>{error || "Der geschützte Arbeitsbereich wird vorbereitet …"}</p></main>; }
function activityType(type: Activity["type"]) { return ({ appointment: "Termin", todo: "Aufgabe", note: "Notiz" })[type]; }
function artifactIcon(kind: string) { return ({ "meeting-briefing": "◷", "email-drafter": "✉", "risk-analyst": "△", "offer-author": "▤", "feasibility-analyst": "◇", "implementation-handout": "☷", "aida-gap-analyst": "⚙" } as Record<string, string>)[kind] ?? "✦"; }
function roleLabel(role: CrmRole) { return ({ admin: "Administrator", sales: "Vertrieb", reader: "Leser" })[role]; }
function formatBytes(value: number) { return value < 1024 ? `${value} B` : `${Math.round(value / 1024)} KB`; }
function localDateTime(value: string) { const dateValue = new Date(value); const offset = dateValue.getTimezoneOffset() * 60_000; return new Date(dateValue.getTime() - offset).toISOString().slice(0, 16); }
function initials(value: string) { return value.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "A"; }
function messageOf(value: unknown) { return value instanceof Error ? value.message : "Ein unerwarteter Fehler ist aufgetreten."; }

async function readChatResponse(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson") || !response.body) {
    const text = await response.text();
    const body = parseJsonRecord(text);
    if (!response.ok) throw new Error(typeof body?.message === "string"
      ? body.message : "AIDA konnte die Aufgabe nicht ausführen.");
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseJsonRecord(line);
      if (event?.type === "error") {
        throw new Error(typeof event.message === "string"
          ? event.message : "AIDA konnte die Aufgabe nicht ausführen.");
      }
    }
    if (done) break;
  }
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
