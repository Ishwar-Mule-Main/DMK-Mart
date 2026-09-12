# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x (main branch) | ✅ |
| older | ❌ — please update |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report privately:

1. Email: `security@yourdomain.example` *(replace with your real contact before publishing this repo)*
2. Include: description, affected endpoint/file, reproduction steps, and impact assessment.
3. You will receive an acknowledgement within 72 hours and a fix timeline within 7 days.

## Security model of this application

This ERP is designed for **self-hosted, trusted-network deployment**. Understand its model before exposing it publicly:

- **Authentication** — the owner identity is a single fixed username (`Kunal`); the **password identifies the company account**. Passwords are verified against hashed values stored per firm. There is no per-employee account system; the team portal (`/team`) has its own gated workflow.
- **Authorization** — there is currently **no role-based access control** on the owner API. Anyone who can reach the app and knows a company password has full access to that company's data.
- **Data at rest** — the entire database lives in **Neon PostgreSQL** (hosted, encrypted at rest, TLS required in transit). Protect the connection string: whoever holds `DATABASE_URL` holds the books. Rotate the password from Neon Console → Roles & Passwords if it ever leaks.

## Deployment hardening checklist

1. **Change the default demo password** (`Kunal / 1234`) immediately — Company Settings in the app.
2. Serve **only over HTTPS** (Certbot or Caddy auto-TLS); never expose port 3000 directly — firewall it (`sudo ufw deny 3000/tcp`) and proxy through Nginx/Caddy.
3. Keep `.env` and `.z-ai-config` **out of version control** (already gitignored — keep it that way).
4. Apply OS patches; run the app as a non-root user (the systemd unit uses a dedicated user).
5. Neon keeps automatic history — know how to use Console → Restore (point-in-time recovery) **before** you need it.
6. If you need multi-employee access control, put it in front of the app (reverse-proxy basic auth, VPN, or SSO) — do not share the owner password.

## Known limitations (by design, not vulnerabilities)

- No rate limiting on login attempts — mitigate at the reverse proxy (e.g. `limit_req` in Nginx).
- No audit log of login events — consider adding fail2ban on proxy logs.
- The AI copilot sends a firm-data snapshot to the configured LLM provider — do not configure a `.z-ai-config` pointing at a provider you do not trust for sensitive data.
