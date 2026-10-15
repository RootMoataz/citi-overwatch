# Decisions

Why ACME Scout is built the way it is. Each entry says what was decided, why, and what it costs.

## Design decisions

| Decision | Why | Trade-off |
|---|---|---|
| Milestones stand in for the email's "deliverables" | The instructor's own term; one entity avoids duplicate data | None noted |
| `DELETE` archives instead of deleting | Meets the email's CRUD requirement and the instructor's "never delete, archive instead" rule | Archived rows stay in the database and must be filtered everywhere |
| One `v1` Lambda with a module per feature | Shared auth, database and validation code without copy-paste; one deploy | One function handles all traffic |
| Pure-Python dependencies only (`pg8000`, `PyJWT`, standard-library PBKDF2) | Packages on Windows without Docker or the Linux VDI | No `psycopg`, `bcrypt` or `pydantic` |
| Vitest and Playwright instead of Jest and Cypress | Vitest works with Vite out of the box; Playwright tests real mobile screens and runs in parallel; the guide says "tools *like*" | Names differ from the guide's examples |
| Passwords: 6+ characters with a digit and a special character; temporary passwords expire after 72 hours; forced change at first login | The owner's rule, hardened against guessing | Users must change their password once |
| Hourly rate = salary ÷ 2,080, copied onto each time entry when it's approved | A documented assumption (52 weeks × 40 hours); salary changes don't rewrite past costs | Ignores benefits and overhead |
| JWT signing secret stored in the `app_secrets` table | Avoids changing the Lambda's environment in Terraform | Read once per cold start |
| Every time entry needs manager approval; 40 hours is a warning with one alert per person-week | The owner's rule: managers control what reaches the budget | Managers have an approval queue to work through |

## Implementation decisions

| Decision | Why | Trade-off |
|---|---|---|
| Records you can't see return `404`, not `403` | Doesn't reveal that a project or person exists | Debugging "why can't I see it" needs the audit log or an admin |
| Planned hours are a **hard** 40 h/week cap; logged hours over 40 are only a **warning** | Planning is a promise the manager controls; real overtime happens and should be visible, not hidden | Two different rules around the same number, so the UI labels them carefully ("planned" vs "logged") |
| The over-40 flag is frozen on each entry when it's saved | Later edits don't rewrite history, and nothing has to be recalculated | Lowering Monday's hours afterwards doesn't clear Friday's flag |
| One alert per person-week, guaranteed by a unique constraint as well as the code | Two saves that race can't produce two alerts | None noted |
| Race-prone steps are single atomic `UPDATE … RETURNING` statements: the lockout counter, reset-code attempts, the refresh-token claim | Two concurrent requests can't both pass a check | Slightly denser SQL |
| Unknown usernames are checked against a dummy password hash | Sign-in takes the same time whether or not the account exists | One wasted hash per bad username |
| The refresh cookie is `HttpOnly`, `SameSite=Strict` and scoped to `Path=/api/v1/auth`; the access token lives in memory | Scripts can't read the cookie, it isn't sent to other endpoints, and cross-site requests can't use it | A page reload makes one refresh call to restore the session |
| When email can't be sent, the admin sees the temporary password **once** | Lets onboarding work despite the VPC having no route to SES | The admin has to pass it on securely |
| Removing someone from a project also removes their milestone assignments there | "Assigned" always implies "on the project"; their logged hours stay on record | The manager has to reassign if they add the person back |
| The local dev server handles one request at a time | Mirrors a single Lambda container and avoids sharing one database connection between threads | Slower than a real server; fine for one developer |
| The e2e suite always starts the API on a fresh `overwatch_e2e` database | Every run sees the same demo data | Each run pays for about 5 s of migrating and seeding |
| Managers see an entry's **cost**, never the person's hourly rate; admins and the person themselves see the rate | A rate × 2,080 is the salary, and only admins may see other people's salaries | Spec §3.7 shows hours and cost, so the rate can still be worked out from cost ÷ hours. Hiding it removes the direct leak, not the arithmetic |
| Approve and reject carry the hours the manager saw, and the `UPDATE` only matches a still-pending entry with those hours (`409 STALE_ENTRY` otherwise) | A manager never approves hours they haven't seen, and two decisions can't both win | The manager reloads and decides again |
| Re-saving a rejected cell unchanged resubmits it (the timesheet's **Resubmit** button) | A wrongly rejected entry can go back for approval without inventing a change | None noted |
| `manager.demo` and `employee.demo` never lock and can't change their password; every other seeded account gets a random password on the live site (`rotate_demo` op) | Their password is published for graders. Lockout or a password change would let one visitor break the demo for everyone, and the other demo accounts shared the same known password | Anyone can sign in as those two demo accounts, as intended. Real accounts keep the normal lockout |
| Status changes go through a dedicated `POST /milestones/{id}/status` | One place enforces who may make which transition | One more endpoint than a generic `PUT` |

## Email on the live site: a browser relay (2026-10-14)

- **Problem:** the Lambda runs in the VPC's "public" subnets, but AWS never gives a Lambda's network interface a public IP. It has **no internet route at all**, so SES and every third-party email API time out from the server.
- **Interim fix, no infrastructure change:** when the server reports `email_sent: false` for a new account or an admin password reset, the admin's browser sends the email through one fixed **EmailJS** template ([`frontend/src/lib/emailRelay.js`](../../frontend/src/lib/emailRelay.js)). If that also fails, or isn't configured, the show-once dialog appears as before.
- **Not relayed:** forgotten-password codes. The code would pass through the requester's own browser, which defeats it, so that flow still says "ask an admin".
- **Trade-off:** the EmailJS public key ships in the browser. EmailJS's free plan doesn't allow restricting it to this site's domain (that's a paid feature), so anyone who reads it could trigger this one fixed template to an address of their choosing. Two limits apply: the free plan's 200 emails a month, and server-side use is turned off. That's acceptable for the workshop demo; for production, upgrade to restrict the domain or use the SES endpoint below.
- **Proper fix (needs the instructors):** an SES SMTP VPC interface endpoint (`com.amazonaws.us-east-2.email-smtp`), with the backend sending through the standard library's `smtplib`. That also restores forgotten-password emails.

## Findings from the final deploy (2026-10-13)

### Deep links returned 403

- **What happened:** after the frontend went live, opening `/login` or refreshing any page returned S3's XML `AccessDenied`.
- **Cause:** the bucket is private, behind CloudFront Origin Access Control, so S3 answers a missing key with `403`. The distribution only maps `404` to `index.html`.
- **What we did:** added a CloudFront Function (`spa_routes`) on the default S3 behaviour. It rewrites any path without a file extension to `/index.html`. The owner chose this over mapping `403` (which would also have rewritten real API `403`s into HTML) and over hash URLs.
- **Related:** CloudFront's `404 → index.html` mapping also applies to API 404s. The API client therefore treats a non-JSON response as `404 NOT_FOUND`, and a top-level error boundary catches any screen that still crashes.

## Findings from the first cloud deploy (2026-10-13)

### SES email isn't reachable from the Lambda

- **What happened:** creating a user on the live site tried to send the welcome email through AWS SES. The connection timed out (`Connect timeout on endpoint URL: "https://email.us-east-2.amazonaws.com/"`), and the default AWS retries made the request take **95 seconds**.
- **Cause:** the workshop's Lambda runs inside a VPC with no route to the internet or to SES. This is a network limit of the provided infrastructure, not a permissions problem.
- **What we did:**
  - The email client now uses a 3-second connect timeout, a 5-second read timeout and no retries.
  - After one failure, SES is skipped for 10 minutes, so later requests fall back instantly.
  - When an email can't be sent, the admin sees the temporary password once, with a copy button, to pass on directly.
- **What's still limited:** on the live site, forgotten-password codes can't be emailed. Users have to ask an admin to reset their password. Local development writes every email to `backend/v1/.outbox/`.
- **Real fix:** give the VPC a route to SES (an SES VPC interface endpoint, or a NAT gateway). This needs the instructors' approval, because it changes the shared infrastructure.

### Login was slow on a 128 MB Lambda

- **What happened:** each password hash (PBKDF2-SHA256, 600,000 iterations) took about **4.4 seconds**, so login took about 4.6 seconds.
- **Cause:** AWS gives a Lambda CPU in proportion to its memory. At 128 MB it gets a small fraction of one CPU.
- **What we did:** raised `memory_size` from 128 to 1024 MB in `infra/lambda.tf`. Login now takes **about 0.75 seconds warm** (about 1.6 seconds on a cold start), with the full 600,000 iterations kept. The owner chose this over weakening the hash.
- **Cost:** higher price per millisecond, but each request finishes faster. Negligible at workshop scale.
- **Cold start:** about 0.45 seconds to initialize the Lambda.

### Demo admin logins

The live site has no guessable admin login. The admin demo accounts are `admin.demo2`, `admin.demo3` and `admin.demo4`, created with the `create_admins` operation: an IAM-only Lambda invoke (like `migrate` and `seed`) that the public Function URL can't reach. Each gets a random strong password, returned only to the operator and held privately by the owner. `manager.demo` and `employee.demo` keep `Demo123!` for graders.
