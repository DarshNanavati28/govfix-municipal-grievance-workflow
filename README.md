# GovFix

GovFix is a configurable workflow engine for **municipal grievance resolution**. It gives residents a request portal and municipal teams a role-aware queue, enforced case transitions, deadline monitoring, escalation, assignment, and a tamper-resistant activity ledger.

## Live demo

**[Open GovFix](https://govfix-municipal-grievance-workflow.onrender.com/)**

The demo is hosted on Render's free web-service plan, so it may take a minute to wake after being idle. Case and audit data are stored in Turso and persist while the web service sleeps.

Demo password: `GovfixDemo2026!`

| Role | Email |
| --- | --- |
| Resident | `citizen@govfix.demo` |
| Field officer | `officer@govfix.demo` |
| Ward supervisor | `supervisor@govfix.demo` |

These are shared prototype accounts. Do not enter real resident information.

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

A deadline is set once when the resident submits the request. When an open request misses its target, GovFix preserves its workflow state, routes it to the Ward Supervisor, and records the escalation. Reopened requests receive a fresh target based on their original priority. The case queue also checks for overdue work when it loads. A protected endpoint at `/api/cron/escalate` is available for a scheduler; Vercel deployments can use the daily schedule in `vercel.json` (UTC).

## Data and deployment

Local development uses a SQLite-compatible libSQL file. The live demo uses a persistent Turso database. This repository includes a Render Blueprint in `render.yaml`; to create another deployment:

1. Create a Turso database and an auth token.
2. In Render, choose **New → Blueprint** and connect this repository: `https://github.com/DarshNanavati28/govfix-municipal-grievance-workflow`.
3. Provide `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and a private `GOVFIX_DEMO_PASSWORD` when prompted. The Blueprint generates `GOVFIX_SESSION_SECRET` and `CRON_SECRET`.
4. Create the Blueprint. Render builds the app and provides its public URL. On the free plan, the web service may sleep when idle; Turso keeps case and audit data persistent.

The queue checks for overdue requests when it loads. For unattended scheduled checks, configure a scheduler to call `/api/cron/escalate` with `Authorization: Bearer <CRON_SECRET>`. A missing or invalid database secret prevents the endpoint from running.

This is a challenge prototype. Before a real municipal launch, replace the shared demo personas with the institution’s identity provider and connect the app to its approved data-retention, privacy, accessibility, and security controls.

