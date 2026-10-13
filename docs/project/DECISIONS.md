# Decisions

Why Citi Overwatch is built the way it is. Each entry says what was decided, why, and what it costs.

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

### Demo admin password

The live database is seeded with demo accounts. The `admin.demo` password was immediately changed to a strong private one held by the owner, so the public site doesn't have a guessable admin login. `manager.demo` and `employee.demo` keep `Demo123!` for graders.
