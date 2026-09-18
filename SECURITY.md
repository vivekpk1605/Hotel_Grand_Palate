# Secure Deployment

1. Run `backend/schema.sql` with a dedicated MySQL application account. Do not run the server as `root`; grant only the required database privileges and keep MySQL bound to a private network address with no public inbound access.
2. Copy `backend/.env.example` to a secret-managed environment. Generate a unique random `SESSION_SECRET` of at least 32 characters. Never put `.env` files, SMTP credentials, database credentials, or AI keys in frontend files or source control.
3. Run behind a reverse proxy or managed load balancer that terminates TLS and redirects HTTP to HTTPS. Set `NODE_ENV=production`, `TRUST_PROXY=true` only when the proxy overwrites the client IP, and configure SMTP so email verification and password reset are delivered.
4. Restrict `PUBLIC_APP_URL` to the real HTTPS frontend origin. Configure firewall rules so only the application process can reach MySQL. Rotate database, SMTP, AI, and session secrets if exposure is suspected.

The API stores only password hashes and SHA-256 hashes of session and one-time tokens. Sessions expire after eight hours; verification tokens expire after 24 hours; password reset tokens expire after 30 minutes and invalidate existing sessions. Authentication and API activity are emitted as structured logs for centralized alerting.