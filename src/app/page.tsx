"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, Building2, CalendarClock,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, ClipboardList, Clock3,
  FileClock, FilePlus2, Filter, Gauge, Landmark, Lightbulb, ListFilter, LockKeyhole, LogOut,
  MapPin, MapPinned, Menu, MessageSquareText, MoreHorizontal, Plus, Search, Send, ShieldCheck,
  Sparkles, UserRound, Users, X,
} from "lucide-react";

type Role = "citizen" | "officer" | "supervisor";
type Actor = { id: string; name: string; email: string; role: Role };
type CaseRecord = {
  id: string; ref: string; title: string; description: string; category: string; priority: string; state: string;
  ward: string; location: string; citizenId: string; citizenName: string; assigneeId: string | null;
  assigneeName: string | null; dueAt: string; escalatedAt: string | null; escalationLevel: number;
  createdAt: string; updatedAt: string;
};
type AuditEvent = {
  id: string; caseId: string | null; eventType: string; actorId: string | null; actorName: string; actorRole: string;
  fromValue: string | null; toValue: string | null; accepted: boolean; occurredAt: string; note: string;
  caseRef?: string | null; title?: string | null;
};
type Officer = { id: string; name: string; email: string };
type Tab = "overview" | "requests" | "audit";
const stateLabels: Record<string, string> = {
  RECEIVED: "Received", TRIAGED: "Triaged", IN_PROGRESS: "In progress", WAITING_FOR_CITIZEN: "Awaiting resident",
  RESOLVED: "Resolved", CLOSED: "Closed",
};
const categories = ["Roads & sidewalks", "Waste & sanitation", "Water supply", "Street lighting", "Drainage & flooding", "Parks & public spaces"];
const priorities = ["Critical", "High", "Standard", "Low"];
const demoUsers: Array<{ role: Role; email: string; name: string; label: string; description: string }> = [
  { role: "citizen", email: "citizen@govfix.demo", name: "Aarav Mehta", label: "Resident", description: "Submit a service request and follow progress" },
  { role: "officer", email: "officer@govfix.demo", name: "Nisha Rao", label: "Field officer", description: "Triage, update and resolve assigned cases" },
  { role: "supervisor", email: "supervisor@govfix.demo", name: "Karan Shah", label: "Ward supervisor", description: "Assign work and review overdue requests" },
];

function roleLabel(role: Role | string) {
  return role === "citizen" ? "Resident" : role === "officer" ? "Officer" : role === "supervisor" ? "Supervisor" : "System";
}
function dateShort(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(value));
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
function relativeDue(value: string, state: string) {
  if (state === "RESOLVED" || state === "CLOSED") return "Completed";
  const ms = new Date(value).getTime() - Date.now();
  const hours = Math.ceil(Math.abs(ms) / 3600000);
  if (ms < 0) return hours < 24 ? hours + "h overdue" : Math.floor(hours / 24) + "d overdue";
  if (hours < 24) return "Due in " + hours + "h";
  return "Due " + dateShort(value);
}
function overdue(record: CaseRecord) {
  return record.state !== "RESOLVED" && record.state !== "CLOSED" && new Date(record.dueAt).getTime() < Date.now();
}
function stateClass(state: string) {
  return "status status-" + state.toLowerCase();
}
function priorityClass(priority: string) {
  return "priority priority-" + priority.toLowerCase();
}
function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}
function suggestCategory(text: string): string | null {
  const lower = text.toLowerCase();
  if (/pothole|road|sidewalk|pavement|crossing/.test(lower)) return "Roads & sidewalks";
  if (/garbage|waste|bin|rubbish|collection|dump/.test(lower)) return "Waste & sanitation";
  if (/water|leak|pressure|pipe/.test(lower)) return "Water supply";
  if (/light|lamp|dark|streetlight/.test(lower)) return "Street lighting";
  if (/drain|flood|waterlog|sewer/.test(lower)) return "Drainage & flooding";
  if (/park|playground|garden|bench/.test(lower)) return "Parks & public spaces";
  return null;
}
function nextMoves(record: CaseRecord, actor: Actor): Array<{ state: string; label: string; kind: "primary" | "secondary" }> {
  if (actor.role === "citizen" && actor.id === record.citizenId) {
    if (record.state === "WAITING_FOR_CITIZEN") return [{ state: "IN_PROGRESS", label: "I’ve shared an update", kind: "primary" }];
    if (record.state === "RESOLVED") return [
      { state: "CLOSED", label: "Confirm resolved", kind: "primary" },
      { state: "IN_PROGRESS", label: "Still needs attention", kind: "secondary" },
    ];
  }
  if (actor.role === "officer" && record.assigneeId && record.assigneeId !== actor.id) return [];
  if (actor.role === "officer" || actor.role === "supervisor") {
    if (record.state === "RECEIVED") return [{ state: "TRIAGED", label: "Complete triage", kind: "primary" }];
    if (record.state === "TRIAGED") return [{ state: "IN_PROGRESS", label: "Start work", kind: "primary" }];
    if (record.state === "IN_PROGRESS") return [
      { state: "RESOLVED", label: "Mark resolved", kind: "primary" },
      { state: "WAITING_FOR_CITIZEN", label: "Request resident update", kind: "secondary" },
    ];
  }
  return [];
}

export default function Home() {  const [actor, setActor] = useState<Actor | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [caseEvents, setCaseEvents] = useState<AuditEvent[]>([]);
  const [caseLoading, setCaseLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All requests");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const loadData = useCallback(async () => {
    const response = await fetch("/api/cases", { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not load requests.");
    }
    const data = await response.json();
    setCases(data.cases || []);
    setOfficers(data.officers || []);
    setActor(data.actor);
    const auditResponse = await fetch("/api/audit", { cache: "no-store" });
    if (auditResponse.ok) setEvents((await auditResponse.json()).events || []);
    setLoadError("");
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!active) return;
      if (data.actor) {
        setActor(data.actor);
        try { await loadData(); } catch (error) { setLoadError(error instanceof Error ? error.message : "Could not load requests."); }
      } else if (data.error) setLoadError(data.error);
    }).catch(() => { if (active) setLoadError("Could not reach the GovFix service."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function signIn(email: string, password: string) {
    setBusy(true);
    setLoadError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Sign in failed.");
      setActor(data.actor);
      await loadData();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setBusy(false);
      setLoading(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setActor(null);
    setCases([]);
    setEvents([]);
    setActiveTab("overview");
    setSelectedCase(null);
  }

  async function openCase(record: CaseRecord) {
    setSelectedCase(record);
    setCaseLoading(true);
    try {
      const response = await fetch("/api/cases/" + record.id, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not open request.");
      setSelectedCase(data.case);
      setCaseEvents(data.events || []);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not open request.");
    } finally {
      setCaseLoading(false);
    }
  }

  async function updateState(state: string) {
    if (!selectedCase) return;
    setBusy(true);
    try {
      const response = await fetch("/api/cases/" + selectedCase.id + "/transition", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toState: state }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "That workflow step was refused.");
      setToast("Request updated to " + stateLabels[state] + ".");
      await loadData();
      await openCase(data.case);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "That workflow step was refused.");
      await openCase(selectedCase);
      await loadData().catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function reassign(caseId: string, assigneeId: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/cases/" + caseId + "/assignment", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assigneeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Assignment was refused.");
      setToast("Request assignment updated.");
      await loadData();
      await openCase(data.case);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Assignment was refused.");
      await openCase(selectedCase as CaseRecord);
    } finally { setBusy(false); }
  }

  async function createRequest(fields: Record<string, string>) {
    setBusy(true);
    try {
      const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request could not be filed.");
      setShowCreate(false);      setToast("Request " + data.case.ref + " has been filed.");
      await loadData();
      await openCase(data.case);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Request could not be filed.");
    } finally { setBusy(false); }
  }

  const visibleCases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cases.filter((record) => {
      const matches = !query || [record.ref, record.title, record.category, record.location, record.ward, record.assigneeName || ""].some((value) => value.toLowerCase().includes(query));
      const stateMatch = filter === "All requests" || (filter === "Overdue" ? overdue(record) : filter === "Open" ? !["RESOLVED", "CLOSED"].includes(record.state) : filter === "Resolved" ? ["RESOLVED", "CLOSED"].includes(record.state) : record.state === filter);
      return matches && stateMatch;
    });
  }, [cases, search, filter]);

  if (loading && !actor) return <main className="loading-screen"><div className="loading-mark"><ShieldCheck size={24} /></div><p>Preparing your civic workspace…</p></main>;
  if (!actor) return <Login onLogin={signIn} error={loadError} busy={busy} />;

  const openCount = cases.filter((record) => !["RESOLVED", "CLOSED"].includes(record.state)).length;
  const lateCount = cases.filter(overdue).length;
  const escalatedCount = cases.filter((record) => Boolean(record.escalatedAt)).length;
  const resolvedCount = cases.filter((record) => ["RESOLVED", "CLOSED"].includes(record.state)).length;
  const needsAttention = cases.filter((record) => overdue(record) || Boolean(record.escalatedAt)).slice(0, 3);

  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobileNav ? "sidebar-open" : "")}>
        <div className="brand-lockup">
          <div className="brand-mark"><ShieldCheck size={22} strokeWidth={2.3} /></div>
          <div><strong>GovFix</strong><span>PUBLIC SERVICE DESK</span></div>
          <button className="icon-button nav-close" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        <div className="org-switcher">
          <div className="org-symbol"><Landmark size={18} /></div>
          <div><strong>City of Brookdale</strong><span>Municipal services</span></div>
          <ChevronDown size={15} className="org-chevron" />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={activeTab === "overview" ? "nav-item active" : "nav-item"} onClick={() => { setActiveTab("overview"); setMobileNav(false); }}>
            <Gauge size={18} /><span>Overview</span>
          </button>
          <button className={activeTab === "requests" ? "nav-item active" : "nav-item"} onClick={() => { setActiveTab("requests"); setMobileNav(false); }}>
            <ClipboardList size={18} /><span>Requests</span><span className="nav-count">{openCount}</span>
          </button>
          <button className={activeTab === "audit" ? "nav-item active" : "nav-item"} onClick={() => { setActiveTab("audit"); setMobileNav(false); }}>
            <FileClock size={18} /><span>Audit history</span>
          </button>
        </nav>
        <div className="nav-label nav-label-spaced">SERVICE AREAS</div>
        <div className="service-links">
          <div><span className="service-dot dot-blue"></span> Roads & sidewalks</div>
          <div><span className="service-dot dot-orange"></span> Waste & sanitation</div>
          <div><span className="service-dot dot-cyan"></span> Water supply</div>
          <div><span className="service-dot dot-violet"></span> Street lighting</div>
        </div>
        <div className="sidebar-spacer" />
        <div className="sidebar-help">
          <div className="help-icon"><CircleHelp size={18} /></div>
          <div><strong>Need a hand?</strong><span>View the service guide</span></div>
          <ChevronRight size={15} />
        </div>
        <div className="sidebar-user">
          <div className={"avatar avatar-" + actor.role}>{initials(actor.name)}</div>
          <div className="sidebar-user-copy"><strong>{actor.name}</strong><span>{roleLabel(actor.role)} account</span></div>
          <button className="icon-button signout-button" onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button>
        </div>
        <div className="sidebar-foot"><span className="online-dot"></span> Workflow services online</div>
      </aside>

      {mobileNav && <button className="mobile-backdrop" aria-label="Close menu" onClick={() => setMobileNav(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Brookdale</span><ChevronRight size={14} /><strong>{activeTab === "overview" ? "Overview" : activeTab === "requests" ? "Requests" : "Audit history"}</strong></div>
          <div className="topbar-right">
            <div className="system-status"><span className="online-dot"></span><span>All services operational</span></div>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="topbar-divider" />
            <button className="top-user" onClick={signOut} title="Sign out">              <div className={"avatar avatar-small avatar-" + actor.role}>{initials(actor.name)}</div><span>{actor.name.split(" ")[0]}</span><ChevronDown size={14} />
            </button>
          </div>
        </header>
        <div className="page-content">
          {activeTab === "overview" && <Overview
            actor={actor} cases={cases} events={events} openCount={openCount} lateCount={lateCount}
            escalatedCount={escalatedCount} resolvedCount={resolvedCount} needsAttention={needsAttention}
            onOpenCase={openCase} onSeeAll={() => setActiveTab("requests")} onCreate={() => setShowCreate(true)}
          />}
          {activeTab === "requests" && <Requests
            actor={actor} cases={visibleCases} allCount={cases.length} search={search} setSearch={setSearch}
            filter={filter} setFilter={setFilter} onOpenCase={openCase} onCreate={() => setShowCreate(true)}
          />}
          {activeTab === "audit" && <Audit events={events} />}
        </div>
      </main>

      {selectedCase && <CasePanel record={selectedCase} events={caseEvents} actor={actor} officers={officers}
        loading={caseLoading} busy={busy} onClose={() => setSelectedCase(null)} onTransition={updateState}
        onReassign={reassign} />}
      {showCreate && <CreateModal busy={busy} onClose={() => setShowCreate(false)} onSubmit={createRequest} />}
      {toast && <div className="toast"><CheckCircle2 size={18} /><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss"><X size={15} /></button></div>}
    </div>
  );
}

function Login({ onLogin, error, busy }: { onLogin: (email: string, password: string) => void; error: string; busy: boolean }) {
  const [email, setEmail] = useState("citizen@govfix.demo");
  const [password, setPassword] = useState("GovfixDemo2026!");
  const [selected, setSelected] = useState<Role>("citizen");
  function choose(user: typeof demoUsers[number]) {
    setSelected(user.role);
    setEmail(user.email);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onLogin(email, password);
  }
  return <div className="login-page">
    <div className="login-brand"><div className="brand-mark"><ShieldCheck size={22} /></div><div><strong>GovFix</strong><span>PUBLIC SERVICE DESK</span></div></div>
    <div className="login-layout">
      <section className="login-story">
        <div className="eyebrow"><span className="eyebrow-dot"></span> CITY OF BROOKDALE · MUNICIPAL SERVICES</div>
        <h1>Every request.<br /><em>Handled with care.</em></h1>
        <p>One clear path from first report to final resolution. See what happens next, who is responsible, and when you can expect an update.</p>
        <div className="login-proof">
          <div className="proof-icon"><ShieldCheck size={21} /></div><div><strong>Built for accountable service</strong><span>Every decision is recorded. Every deadline is visible.</span></div>
        </div>
        <div className="login-stat-row"><div><strong>6</strong><span>Clear workflow steps</span></div><i></i><div><strong>24/7</strong><span>Deadline monitoring</span></div><i></i><div><strong>100%</strong><span>Recorded decisions</span></div></div>
      </section>
      <section className="login-card">
        <div className="login-card-head"><div className="login-card-icon"><Building2 size={19} /></div><div><h2>Welcome to GovFix</h2><p>Sign in to your service workspace</p></div></div>
        <div className="demo-mode-note"><span className="demo-spark"><Sparkles size={14} /></span><div><strong>Demo environment</strong><span>Choose a role to explore the workflow.</span></div></div>
        <div className="role-select-label">CONTINUE AS</div>
        <div className="demo-roles">
          {demoUsers.map((user) => <button key={user.role} className={"demo-role " + (selected === user.role ? "demo-role-selected" : "")} onClick={() => choose(user)}>
            <div className={"demo-role-avatar avatar-" + user.role}>{initials(user.name)}</div>
            <div className="demo-role-copy"><strong>{user.label}</strong><span>{user.description}</span></div>
            <span className="radio-dot"></span>
          </button>)}
        </div>
        <form onSubmit={submit} className="login-form">
          <label htmlFor="email">Email address</label>
          <div className="login-input"><UserRound size={16} /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></div>
          <div className="login-label-row"><label htmlFor="password">Demo password</label><span>Same for each demo role</span></div>
          <div className="login-input"><LockKeyhole size={16} /><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div>
          {error && <div className="login-error"><AlertTriangle size={15} />{error}</div>}
          <button className="button button-primary login-submit" type="submit" disabled={busy}>{busy ? "Opening workspace…" : "Continue to GovFix"}<ArrowRight size={17} /></button>
        </form>
        <div className="login-secure"><ShieldCheck size={14} /> Role permissions are checked by the GovFix server</div>
      </section>
    </div>
    <div className="login-footer"><span>© 2026 City of Brookdale</span><span>Privacy · Accessibility · Service standards</span><span>Version 1.0.0</span></div>
  </div>;
}
function Overview({ actor, cases, events, openCount, lateCount, escalatedCount, resolvedCount, needsAttention, onOpenCase, onSeeAll, onCreate }: {
  actor: Actor; cases: CaseRecord[]; events: AuditEvent[]; openCount: number; lateCount: number; escalatedCount: number;
  resolvedCount: number; needsAttention: CaseRecord[]; onOpenCase: (record: CaseRecord) => void; onSeeAll: () => void; onCreate: () => void;
}) {
  const greeting = actor.role === "citizen" ? "Your neighborhood, in view." : actor.role === "officer" ? "Good morning, Nisha." : "Good morning, Karan.";
  const subtitle = actor.role === "citizen" ? "Stay up to date on every request you’ve raised." : "A clear view of requests, deadlines, and the work ahead.";
  const tableCases = [...cases].sort((a, b) => Number(overdue(b)) - Number(overdue(a))).slice(0, 5);
  const recent = events.slice(0, 5);
  const prioritiesCount = cases.filter((record) => record.priority === "Critical" && !["RESOLVED", "CLOSED"].includes(record.state)).length;
  return <div className="overview-page">
    <div className="page-heading">
      <div><div className="eyebrow heading-kicker">SATURDAY, 24 OCTOBER 2026 <span className="kicker-separator">/</span> WARD OPERATIONS</div><h1>{greeting}</h1><p>{subtitle}</p></div>
      <div className="heading-actions"><button className="button button-quiet"><CalendarClock size={16} /> This week <ChevronDown size={14} /></button>
        {actor.role === "citizen" ? <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New request</button> : <button className="button button-primary" onClick={onSeeAll}><ClipboardList size={16} /> Open queue</button>}
      </div>
    </div>
    <div className="kpi-grid">
      <Kpi label="Open requests" value={String(openCount)} note={actor.role === "citizen" ? "Across all service areas" : "Across all ward teams"} icon={<ClipboardList size={18} />} tone="navy" trend="Active work" />
      <Kpi label="Overdue" value={String(lateCount)} note={lateCount ? "Deadline has passed" : "All deadlines on track"} icon={<Clock3 size={18} />} tone={lateCount ? "red" : "green"} trend={lateCount ? "Needs attention" : "On schedule"} />
      <Kpi label="Escalated" value={String(escalatedCount)} note="Routed to supervisor review" icon={<ArrowUpRight size={19} />} tone={escalatedCount ? "amber" : "green"} trend="Automatic review" />
      <Kpi label="Resolved" value={String(resolvedCount)} note="Closed or awaiting confirmation" icon={<CheckCircle2 size={19} />} tone="blue" trend="+12% this month" />
    </div>
    <div className="content-grid main-dashboard-grid">
      <section className="surface queue-surface">
        <div className="section-header">
          <div><div className="section-title-line"><h2>{actor.role === "citizen" ? "Your recent requests" : "Priority queue"}</h2><span className="live-tag"><span></span> LIVE</span></div><p>{actor.role === "citizen" ? "The latest movement on your service requests." : "Requests closest to their service deadline."}</p></div>
          <button className="text-button" onClick={onSeeAll}>View all <ArrowRight size={15} /></button>
        </div>
        {tableCases.length ? <div className="table-scroll"><table className="cases-table">
          <thead><tr><th>REQUEST</th><th>SERVICE AREA</th><th>STATUS</th><th>DEADLINE</th><th></th></tr></thead>
          <tbody>{tableCases.map((record) => <CaseRow key={record.id} record={record} onClick={() => onOpenCase(record)} />)}</tbody>
        </table></div> : <EmptyState title="No requests yet" copy="Your service requests will appear here." />}
        <div className="queue-footer"><span><span className="table-footer-dot"></span> Updated just now</span><button onClick={onSeeAll}>Open request list <ArrowRight size={14} /></button></div>
      </section>
      <section className="surface attention-surface">
        <div className="section-header compact-header">
          <div><div className="section-title-line"><h2>Attention needed</h2><span className="attention-count">{lateCount}</span></div><p>Deadlines and escalations</p></div>
          <button className="icon-button mini-more" aria-label="More attention options"><MoreHorizontal size={18} /></button>
        </div>
        {needsAttention.length ? <div className="attention-list">{needsAttention.map((record) => <button key={record.id} className="attention-item" onClick={() => onOpenCase(record)}>
          <div className={"attention-icon " + (record.escalatedAt ? "attention-icon-amber" : "attention-icon-red")}>{record.escalatedAt ? <ArrowUpRight size={16} /> : <Clock3 size={16} />}</div>
          <div className="attention-copy"><div className="attention-title-row"><strong>{record.title}</strong>{record.escalatedAt && <span className="escalated-chip">ESCALATED</span>}</div>
            <span>{record.ref} <i>·</i> {record.ward}</span><small>{relativeDue(record.dueAt, record.state)}</small></div>
          <ChevronRight size={15} className="attention-arrow" />
        </button>)}</div> : <div className="clear-state"><div><Check size={20} /></div><strong>All clear for now</strong><span>No requests need attention.</span></div>}
        <div className="attention-footer"><ShieldCheck size={14} /> Escalations run automatically when deadlines pass.</div>
      </section>
    </div>
    <div className="content-grid lower-dashboard-grid">
      <section className="surface volume-surface">
        <div className="section-header">
          <div><h2>Request activity</h2><p>Incoming reports over the last 7 days</p></div>          <button className="button button-quiet small-select">Last 7 days <ChevronDown size={13} /></button>
        </div>
        <div className="chart-summary"><strong>{cases.length}</strong><span>requests in view</span><div className="chart-growth"><ArrowUpRight size={15} /> 8.4%</div><span className="chart-growth-caption">vs. last week</span></div>
        <div className="bar-chart">
          {[{ day: "Sun", n: 35 },{ day: "Mon", n: 67 },{ day: "Tue", n: 48 },{ day: "Wed", n: 86 },{ day: "Thu", n: 58 },{ day: "Fri", n: 72 },{ day: "Sat", n: 43 }].map((item, index) =>
            <div className="bar-column" key={item.day}><span className="bar-value">{index === 3 ? "12" : String(Math.max(3, Math.round(item.n / 15)))}</span><div className="bar-track"><i style={{ height: item.n + "%" }} className={index === 3 ? "bar-fill bar-fill-highlight" : "bar-fill"} /></div><span className={index === 3 ? "bar-day bar-day-current" : "bar-day"}>{item.day}</span></div>)}
        </div>
      </section>
      <section className="surface activity-surface">
        <div className="section-header"><div><h2>Recent activity</h2><p>Latest updates across requests</p></div><button className="text-button" onClick={onSeeAll}>All requests <ArrowRight size={14} /></button></div>
        <div className="activity-list">{recent.slice(0, 4).map((event, index) => <div className="activity-item" key={event.id}>
          <div className={"activity-symbol activity-symbol-" + (event.eventType.includes("refused") ? "red" : event.eventType === "escalated" ? "amber" : event.eventType === "transition" ? "blue" : "green")}>
            {event.eventType.includes("refused") ? <AlertTriangle size={14} /> : event.eventType === "escalated" ? <ArrowUpRight size={14} /> : event.eventType === "transition" ? <Activity size={14} /> : <Check size={14} />}
          </div><div className="activity-detail"><p><strong>{event.actorName}</strong> {event.eventType.includes("refused") ? "attempted a change" : event.eventType === "submitted" ? "filed a request" : event.eventType === "escalated" ? "escalated a request" : event.eventType === "assigned" ? "assigned a request" : "updated a request"}</p>
            <span>{event.caseRef || "GovFix"} <i>·</i> {event.note}</span></div><time>{dateShort(event.occurredAt)}</time>
          {index < Math.min(recent.length, 4) - 1 && <i className="activity-connector" />}
        </div>)}</div>
      </section>
    </div>
    <div className="workflow-note"><div className="workflow-note-icon"><Lightbulb size={17} /></div><div><strong>One clear service standard</strong><span>Critical issues: 24 hours <i>·</i> High: 3 days <i>·</i> Standard: 5 days <i>·</i> Low: 7 days. Missed deadlines are routed to the Ward Supervisor and recorded automatically.</span></div><button onClick={() => onOpenCase(cases.find((record) => overdue(record)) || cases[0])} disabled={!cases.length}>Review workflow <ArrowRight size={14} /></button></div>
  </div>;
}

function Kpi({ label, value, note, icon, tone, trend }: { label: string; value: string; note: string; icon: React.ReactNode; tone: string; trend: string }) {
  return <div className="kpi-card"><div className="kpi-top"><span>{label}</span><span className={"kpi-icon kpi-" + tone}>{icon}</span></div>
    <div className="kpi-value-row"><strong>{value}</strong><span className={"kpi-trend kpi-trend-" + tone}>{trend}</span></div>
    <p>{note}</p><div className={"kpi-accent accent-" + tone}></div>
  </div>;
}

function CaseRow({ record, onClick }: { record: CaseRecord; onClick: () => void }) {
  return <tr onClick={onClick} className="case-row">
    <td><div className="request-cell"><div className={"category-icon category-" + record.category.toLowerCase().split(" ")[0].replace(/[^a-z]/g, "")}><ClipboardCheck size={15} /></div><div><strong>{record.title}</strong><span>{record.ref} <i>·</i> {record.ward}</span></div></div></td>
    <td><span className="category-name">{record.category}</span>{record.priority === "Critical" && <span className={priorityClass(record.priority)}>Critical</span>}</td>
    <td><span className={stateClass(record.state)}><i></i>{stateLabels[record.state]}</span>{record.escalatedAt && <span className="row-escalated"><ArrowUpRight size={12} /> Escalated</span>}</td>
    <td><span className={overdue(record) ? "deadline deadline-late" : "deadline"}>{overdue(record) && <Clock3 size={13} />}{relativeDue(record.dueAt, record.state)}</span></td>
    <td><ChevronRight size={16} className="row-chevron" /></td>
  </tr>;
}

function Requests({ actor, cases, allCount, search, setSearch, filter, setFilter, onOpenCase, onCreate }: {
  actor: Actor; cases: CaseRecord[]; allCount: number; search: string; setSearch: (value: string) => void; filter: string;
  setFilter: (value: string) => void; onOpenCase: (record: CaseRecord) => void; onCreate: () => void;
}) {
  return <div className="requests-page">
    <div className="page-heading">
      <div><div className="eyebrow heading-kicker">SERVICE DELIVERY <span className="kicker-separator">/</span> {allCount} REQUESTS</div><h1>{actor.role === "citizen" ? "Your requests" : "Request queue"}</h1><p>{actor.role === "citizen" ? "Track every service request you’ve submitted." : "Review, assign, and move each request through its next valid step."}</p></div>
      <div className="heading-actions">{actor.role === "citizen" && <button className="button button-primary" onClick={onCreate}><Plus size={17} /> New request</button>}</div>
    </div>
    <div className="surface request-list-surface">      <div className="request-toolbar"><div className="request-search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search requests, location, or reference…" /><kbd>⌘ K</kbd></div>
        <div className="toolbar-actions"><div className="select-wrap"><Filter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter requests">
          <option>All requests</option><option>Open</option><option>Overdue</option><option>Resolved</option>
        </select><ChevronDown size={14} /></div><button className="button button-quiet export-button" onClick={() => window.print()}><ListFilter size={15} /> Export view</button></div>
      </div>
      <div className="request-filter-row"><span><strong>{cases.length}</strong> requests shown</span><div><span className="filter-pill"><span className="online-dot"></span> All wards</span><span className="filter-pill">Municipal services <ChevronDown size={12} /></span></div></div>
      {cases.length ? <div className="table-scroll"><table className="cases-table full-cases-table">
        <thead><tr><th>REQUEST <ChevronDown size={12} /></th><th>SERVICE AREA</th><th>PRIORITY</th><th>STATUS</th><th>ASSIGNED TO</th><th>DEADLINE</th><th></th></tr></thead>
        <tbody>{cases.map((record) => <tr key={record.id} onClick={() => onOpenCase(record)} className="case-row">
          <td><div className="request-cell"><div className="case-ref-mark">{record.ref.slice(-2)}</div><div><strong>{record.title}</strong><span>{record.ref} <i>·</i> {record.ward} <i>·</i> {record.location}</span></div></div></td>
          <td><span className="category-name">{record.category}</span></td><td><span className={priorityClass(record.priority)}>{record.priority}</span></td>
          <td><span className={stateClass(record.state)}><i></i>{stateLabels[record.state]}</span>{record.escalatedAt && <span className="row-escalated"><ArrowUpRight size={12} /> Escalated</span>}</td>
          <td>{record.assigneeName ? <span className="assignee-cell"><span className="assignee-avatar">{initials(record.assigneeName)}</span>{record.assigneeName}</span> : <span className="unassigned">Unassigned</span>}</td>
          <td><span className={overdue(record) ? "deadline deadline-late" : "deadline"}>{relativeDue(record.dueAt, record.state)}</span></td>
          <td><ChevronRight size={16} className="row-chevron" /></td>
        </tr>)}</tbody>
      </table></div> : <EmptyState title="No matching requests" copy="Try another search or clear the current filter." />}
      <div className="table-pagination"><span>Showing <strong>{cases.length ? 1 : 0}–{cases.length}</strong> of <strong>{cases.length}</strong> requests</span><div><button disabled aria-label="Previous page"><ChevronRight size={15} /></button><span>1</span><button disabled aria-label="Next page"><ChevronRight size={15} /></button></div></div>
    </div>
    <div className="queue-footnote"><ShieldCheck size={15} /> Every status change is checked against the municipal workflow and added to the audit history.</div>
  </div>;
}

function Audit({ events }: { events: AuditEvent[] }) {
  const [scope, setScope] = useState("All activity");
  const filtered = events.filter((event) => scope === "All activity" || (scope === "Refused attempts" ? !event.accepted : event.eventType === "escalated"));
  return <div className="audit-page">
    <div className="page-heading">
      <div><div className="eyebrow heading-kicker">GOVERNANCE <span className="kicker-separator">/</span> IMMUTABLE ACTIVITY RECORD</div><h1>Audit history</h1><p>A transparent record of decisions, assignments, escalations, and refused attempts.</p></div>
      <div className="heading-actions"><button className="button button-quiet" onClick={() => window.print()}><ListFilter size={15} /> Export log</button></div>
    </div>
    <div className="audit-summary-grid"><div className="surface audit-summary"><span className="audit-summary-icon audit-blue"><Activity size={18} /></span><div><strong>{events.length}</strong><span>Recorded events</span></div></div><div className="surface audit-summary"><span className="audit-summary-icon audit-green"><CheckCircle2 size={18} /></span><div><strong>{events.filter((item) => item.accepted).length}</strong><span>Accepted actions</span></div></div><div className="surface audit-summary"><span className="audit-summary-icon audit-red"><AlertTriangle size={18} /></span><div><strong>{events.filter((item) => !item.accepted).length}</strong><span>Refused attempts</span></div></div><div className="surface audit-summary"><span className="audit-summary-icon audit-amber"><ArrowUpRight size={18} /></span><div><strong>{events.filter((item) => item.eventType === "escalated").length}</strong><span>Escalations</span></div></div></div>
    <div className="surface audit-surface">
      <div className="section-header audit-header"><div><h2>Activity ledger</h2><p>Newest events first · timestamps shown in local time</p></div><div className="select-wrap"><Filter size={15} /><select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Filter audit events"><option>All activity</option><option>Refused attempts</option><option>Escalations</option></select><ChevronDown size={14} /></div></div>
      {filtered.length ? <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>RESULT</th><th>ACTOR</th><th>ACTION</th><th>REQUEST</th><th>DETAIL</th><th>WHEN</th></tr></thead><tbody>{filtered.map((event) => <tr key={event.id}>        <td><span className={event.accepted ? "audit-result accepted" : "audit-result refused"}><i></i>{event.accepted ? "Accepted" : "Refused"}</span></td>
        <td><div className="audit-actor"><span className={"audit-avatar audit-avatar-" + event.actorRole}>{initials(event.actorName)}</span><span><strong>{event.actorName}</strong><small>{roleLabel(event.actorRole)}</small></span></div></td>
        <td><strong className="event-name">{event.eventType.replaceAll("_", " ")}</strong>{event.fromValue && event.toValue && <span className="audit-transition">{stateLabels[event.fromValue] || event.fromValue} <ArrowRight size={11} /> {stateLabels[event.toValue] || event.toValue}</span>}</td>
        <td><strong className="audit-case-ref">{event.caseRef || "—"}</strong><span className="audit-case-title">{event.title || "Sign-in / access event"}</span></td>
        <td className="audit-note">{event.note}</td><td className="audit-date">{dateTime(event.occurredAt)}</td>
      </tr>)}</tbody></table></div> : <EmptyState title="No activity in this view" copy="New workflow activity will appear here." />}
      <div className="audit-table-footer"><ShieldCheck size={15} /><span>Audit events are written by the service and cannot be edited from this workspace.</span><span className="audit-sync"><span className="online-dot"></span> Up to date</span></div>
    </div>
    <div className="audit-policy"><div><LockKeyhole size={16} /></div><p><strong>Permission checks are recorded too.</strong> If an action is outside a role’s authority or skips a workflow step, GovFix refuses the action and records the reason against the request.</p></div>
  </div>;
}

function CasePanel({ record, events, actor, officers, loading, busy, onClose, onTransition, onReassign }: {
  record: CaseRecord; events: AuditEvent[]; actor: Actor; officers: Officer[]; loading: boolean; busy: boolean;
  onClose: () => void; onTransition: (state: string) => void; onReassign: (caseId: string, assigneeId: string) => void;
}) {
  const actions = nextMoves(record, actor);
  const isOwner = actor.role === "citizen" && actor.id === record.citizenId;
  const canAssign = actor.role === "supervisor";
  return <div className="panel-backdrop" onClick={onClose}>
    <aside className="case-panel" onClick={(event) => event.stopPropagation()}>
      <div className="panel-top"><div><span className="panel-eyebrow">REQUEST DETAILS</span><span className="panel-reference">{record.ref}</span></div><div className="panel-top-actions"><button className="icon-button" aria-label="More request options"><MoreHorizontal size={18} /></button><button className="icon-button" onClick={onClose} aria-label="Close details"><X size={19} /></button></div></div>
      <div className="panel-scroll">
        <div className="panel-title-block"><div className="panel-tags"><span className={priorityClass(record.priority)}>{record.priority} priority</span>{record.escalatedAt && <span className="escalated-chip"><ArrowUpRight size={12} /> ESCALATED</span>}</div>
          <h2>{record.title}</h2><span className="panel-ward"><MapPin size={14} /> {record.location} <i>·</i> {record.ward}</span></div>
        <div className="panel-status-row"><div><span className="panel-field-label">CURRENT STATUS</span><span className={stateClass(record.state)}><i></i>{stateLabels[record.state]}</span></div><div className="panel-status-right"><span className="panel-field-label">SERVICE AREA</span><span>{record.category}</span></div></div>
        <div className={"deadline-card " + (overdue(record) ? "deadline-card-late" : "")}><div className="deadline-card-icon">{overdue(record) ? <AlertTriangle size={17} /> : <CalendarClock size={17} />}</div>
          <div><strong>{overdue(record) ? relativeDue(record.dueAt, record.state) : "Response deadline"}</strong><span>{overdue(record) ? "The case is with the Ward Supervisor for review." : dateTime(record.dueAt)}</span></div>
          <span className="deadline-card-sla">{record.priority === "Critical" ? "24h SLA" : record.priority === "High" ? "3 day SLA" : record.priority === "Low" ? "7 day SLA" : "5 day SLA"}</span>
        </div>
        {record.escalatedAt && <div className="escalation-banner"><ArrowUpRight size={16} /><span><strong>Escalated to Ward Supervisor</strong><small>Automatically routed when its committed time passed · {dateTime(record.escalatedAt)}</small></span></div>}
        <div className="panel-section"><div className="panel-section-heading"><h3>Request summary</h3><span>Reported {dateTime(record.createdAt)}</span></div><p className="case-description">{record.description}</p><div className="summary-meta"><span><span className="meta-icon"><MapPinned size={14} /></span>{record.ward}</span><span><span className="meta-icon"><UserRound size={14} /></span>{isOwner ? "You" : record.citizenName}</span><span><span className="meta-icon"><Users size={14} /></span>{record.assigneeName || "Awaiting assignment"}</span></div></div>
        {canAssign && record.state !== "CLOSED" && <div className="assignment-block"><div><span className="panel-field-label">ASSIGNMENT</span><p>Choose the officer responsible for the next action.</p></div>
          <div className="assignment-select"><Users size={15} /><select value={record.assigneeId || ""} onChange={(event) => event.target.value && onReassign(record.id, event.target.value)} disabled={busy}>
            <option value="">Unassigned</option>{officers.map((officer) => <option key={officer.id} value={officer.id}>{officer.name}</option>)}
          </select><ChevronDown size={14} /></div></div>}        <div className="panel-section workflow-section"><div className="panel-section-heading"><div><h3>Next workflow step</h3><span className="workflow-guard"><ShieldCheck size={13} /> Checked by GovFix</span></div></div>
          {actions.length ? <div className="next-actions">{actions.map((action) => <button key={action.state} disabled={busy} className={action.kind === "primary" ? "button button-primary" : "button button-outline"} onClick={() => onTransition(action.state)}>{action.label}<ArrowRight size={15} /></button>)}</div>
            : <div className="next-step-locked"><LockKeyhole size={15} /><span>{record.state === "CLOSED" ? "This request is closed." : actor.role === "officer" && record.assigneeId !== actor.id ? "This request is assigned to another officer." : actor.role === "citizen" ? "No action is needed from you right now." : "This request has no further workflow step."}</span></div>}
          <p className="transition-helper">Only the next permitted step is available. GovFix records the actor, time, and result of every attempt.</p>
        </div>
        <div className="panel-section timeline-section"><div className="panel-section-heading"><div><h3>Activity timeline</h3><span>{events.length} recorded events</span></div><button className="text-button" onClick={onClose}>Full audit <ArrowRight size={13} /></button></div>
          {loading ? <div className="timeline-loading">Loading request history…</div> : <div className="timeline-list">{events.map((event, index) => <div className="timeline-item" key={event.id}>
            <div className={"timeline-dot " + (!event.accepted ? "timeline-dot-refused" : event.eventType === "escalated" ? "timeline-dot-alert" : "")}>{!event.accepted ? <AlertTriangle size={11} /> : event.eventType === "escalated" ? <ArrowUpRight size={11} /> : <Check size={11} />}</div>
            {index < events.length - 1 && <i className="timeline-line" />}
            <div className="timeline-content"><div><strong>{event.eventType.replaceAll("_", " ")}</strong><time>{dateTime(event.occurredAt)}</time></div><span>{event.actorName} <i>·</i> {roleLabel(event.actorRole)}</span><p>{event.note}</p></div>
          </div>)}</div>}
        </div>
      </div>
      <div className="panel-bottom"><div><ShieldCheck size={14} /><span>Changes are recorded securely</span></div><button className="button button-quiet" onClick={onClose}>Done</button></div>
    </aside>
  </div>;
}

function CreateModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (fields: Record<string, string>) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("Standard");
  const [ward, setWard] = useState("Ward 04");
  const [location, setLocation] = useState("");
  const [formError, setFormError] = useState("");
  const suggested = suggestCategory(title + " " + description);
  const deadline = priority === "Critical" ? "24 hours" : priority === "High" ? "3 days" : priority === "Low" ? "7 days" : "5 days";
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) { setFormError("Please choose a service area."); return; }
    setFormError("");
    onSubmit({ title, description, category, priority, ward, location });
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="create-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-header"><div><div className="modal-icon"><FilePlus2 size={20} /></div><span className="panel-eyebrow">RESIDENT SERVICE PORTAL</span><h2>Submit a request</h2><p>Tell us what needs attention. You’ll be able to track every step.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></div>
    <form onSubmit={submit} className="create-form">
      <div className="form-field"><label htmlFor="request-title">What needs attention? <span>Required</span></label><input id="request-title" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="A short summary of the issue" required /></div>
      <div className="form-field"><label htmlFor="request-description">Describe the issue <span>Required</span></label><textarea id="request-description" rows={4} maxLength={1200} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Include what happened and when you noticed it…" required></textarea><small>{description.length}/1200 characters</small></div>
      {suggested && <div className="suggestion-card"><span><Lightbulb size={15} /></span><div><strong>Intake suggestion</strong><p>This sounds like <b>{suggested}</b>. Please confirm the service area below.</p><small>Recommendation only; it does not set status, assignment, or deadline.</small></div><button type="button" onClick={() => setCategory(suggested)} disabled={category === suggested}>{category === suggested ? <Check size={15} /> : "Use"}</button></div>}
      <div className="form-row"><div className="form-field"><label htmlFor="service-area">Service area <span>Required</span></label><div className="form-select"><select id="service-area" value={category} onChange={(event) => setCategory(event.target.value)} required><option value="">Select an area</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></div>        <div className="form-field"><label htmlFor="priority">Priority</label><div className="form-select"><select id="priority" value={priority} onChange={(event) => setPriority(event.target.value)}>{priorities.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></div></div>
      <div className="form-row"><div className="form-field"><label htmlFor="ward">Ward <span>Required</span></label><div className="form-select"><select id="ward" value={ward} onChange={(event) => setWard(event.target.value)}>{Array.from({ length: 8 }, (_, index) => "Ward " + String(index + 1).padStart(2, "0")).map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></div>
        <div className="form-field"><label htmlFor="location">Street or landmark <span>Required</span></label><input id="location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. 18 4th Avenue" required /></div></div>
      <div className="sla-preview"><div><CalendarClock size={16} /><span><strong>Response target: {deadline}</strong><small>Based on the priority selected. The date is fixed when filed.</small></span></div><span className={priorityClass(priority)}>{priority}</span></div>
      {formError && <div className="form-error"><AlertTriangle size={15} />{formError}</div>}
      <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit request"}<Send size={15} /></button></div>
    </form>
    <div className="modal-foot"><LockKeyhole size={13} /> Your contact details are only visible to authorized municipal staff.</div>
  </section></div>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><div><ClipboardList size={21} /></div><strong>{title}</strong><span>{copy}</span></div>;
}
