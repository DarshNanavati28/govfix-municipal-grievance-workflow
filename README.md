# GovFix

GovFix is a configurable workflow engine for **municipal grievance resolution**. It gives residents a request portal and municipal teams a role-aware queue, enforced case transitions, deadline monitoring, escalation, assignment, and a tamper-resistant activity ledger.

## Run locally

Requirements: Node.js 20.9 or newer.

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app creates its local database as `govfix.db` and seeds sample cases on first launch.

Demo password: `GovfixDemo2026!`

| Role | Email |
| --- | --- |
| Resident | `citizen@govfix.demo` |
| Field officer | `officer@govfix.demo` |
| Ward supervisor | `supervisor@govfix.demo` |

The demo personas are shared accounts for this prototype. Do not use them for real resident information.

## Municipal workflow

`Received → Triaged → In progress → Awaiting resident → In progress → Resolved → Closed`

Each edge is checked in the server API. An officer or supervisor can advance an officer step; residents can respond when a case is waiting for them and can confirm or reopen a resolution. A resident can only change their own request. Supervisors can assign work to an officer. Invalid transitions, role violations, and rejected assignments are refused with a reason and written to the activity ledger.

The resident intake suggestion is a transparent keyword recommendation. The resident confirms the category and priority. It does not alter status, assignment, or the deadline.

### Response targets

| Priority | Target |
| --- | --- |
| Critical | 24 hours |
| High | 3 days |
| Standard | 5 days |
| Low | 7 days |

A deadline is set once when the resident submits the request. When an open request misses its target, GovFix preserves its workflow state, routes it to the Ward Supervisor, and records the escalation. Reopened requests receive a fresh target based on their original priority. The case queue also checks for overdue work when it loads; Vercel Cron provides a scheduled daily check after deployment (UTC); the request queue also checks for overdue cases when it loads.

## Data and deployment

Local development uses a SQLite-compatible libSQL file. Vercel functions are stateless, so production requires a persistent Turso database. Create a database in Turso, then configure these Vercel environment variables for Production and Preview:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `GOVFIX_SESSION_SECRET` — use a unique random value
- `GOVFIX_DEMO_PASSWORD` — use a unique demo value
- `CRON_SECRET` — use a unique random value

Then link this project to Vercel and deploy. The hourly scheduled handler is `/api/cron/escalate`. A missing or invalid database secret prevents the scheduled endpoint from running.

This is a challenge prototype. Before a real municipal launch, replace the shared demo personas with the institution’s identity provider and connect the app to its approved data-retention, privacy, accessibility, and security controls.

