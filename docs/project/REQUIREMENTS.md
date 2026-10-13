# Project Requirements

This file is the source of truth for scope. Part 1 is the workshop email, copied word for word. Part 2 is the minimum checklist we must deliver, built from the email and the scored rubric. Stretch items live in [STRETCH.md](./STRETCH.md).

**Deadline:** day 3 of the workshop.

**Rubric:** [docs/full-stack.md → Evaluation Expectations](../full-stack.md#evaluation-expectations)

---

## Part 1 – Workshop email (verbatim)

> **Workshop Guidance**
>
> Read the workshop guidance below and follow the instructions in the repository to get started. Ask questions if unsure or need help.
>
> **Requirements: Business Problem**
>
> Our company ACME Inc. operates multiple projects across different departments, but lacks visibility into project progress, resource allocation, and delivery timelines. Project managers struggle to track deliverables, identify bottlenecks, and communicate status to stakeholders. This fragmentation leads to missed deadlines, resource conflicts, and difficulty in forecasting project completion dates.
>
> We need answers to critical questions like:
>
> - What is the current status of each active project?
> - Which projects are at risk of missing their deadlines?
> - How are resources allocated across projects?
> - What are the key deliverables and their completion status?
> - Which team members are over-allocated across multiple projects?
> - What is the dependency chain between deliverables?
> - How much budget has been consumed versus planned for each project?
>
> **Requirements: Technical Solution**
>
> We are building a centralized project management and tracking platform that enables real-time visibility into project health, resource utilization, and delivery progress. The solution will provide a self-service capability for project managers and team leads to manage projects, track deliverables, allocate resources, and monitor budgets without requiring integration with external systems.
>
> The technical solution involves developing a stand-alone web application using modern technologies. The application will have the following features:
>
> - User authentication and authorization
> - Role-based access control
> - CRUD operations for projects, deliverables, resources, and budget tracking
> - Search and filter functionality
> - Responsive design for mobile and desktop usage
>
> **Requirements: Technology Stack**
>
> The following technologies are required to build the application:
>
> - Frontend: HTML, CSS, React.js with React Responsive and Material UI Components
> - Backend: Python
> - Database: PostgreSQL
>
> The following technologies are good to know, as they are used to manage and deploy code:
>
> - Version Control: Git, GitHub
> - Infrastructure: Terraform
> - Deployment Mode: Shell Scripts
> - Deployment Target: AWS Serverless (e.g. S3, CloudFront, Lambda, RDS)
>
> **Expectations: Value-Based Outcomes**
>
> By the end of the workshop, participants will have developed a functional web application that meets the requirements outlined above. The application will be deployed to a cloud environment and accessible via a web browser. Participants will also gain hands-on experience with modern web development technologies and best practices.

---

## Part 2 – Minimum checklist

Each item names its source: **E** = email, **R** = scored rubric, **G** = the full-stack guide's implementation checklist, **U** = the project owner.

### Business questions (E)

The app must answer every one of these questions in the UI.

- [ ] Q1. Current status of each active project
- [ ] Q2. Projects at risk of missing their deadline
- [ ] Q3. Resource allocation across projects
- [ ] Q4. Key deliverables and their completion status
- [ ] Q5. Team members over-allocated across projects
- [ ] Q6. Dependency chain between deliverables
- [ ] Q7. Budget consumed versus planned, per project

### Features (E)

- [ ] User authentication (login, hashed passwords, token with expiry) (E, G)
- [ ] Authorization and role-based access control, enforced on the backend and reflected in the UI (E, G)
- [ ] Create, read, update and delete (CRUD) for projects
- [ ] CRUD for deliverables
- [ ] CRUD for resources
- [ ] CRUD for budget tracking
- [ ] Search and filter on list views (E)
- [ ] Responsive layout for mobile and desktop (E, R)

### Technology (E)

- [ ] Frontend: React, React Responsive, Material UI
- [ ] Backend: Python (AWS Lambda)
- [ ] Database: PostgreSQL (AWS Aurora)

### Delivery (E, R)

- [ ] Deployed to AWS and reachable in a browser (E, R)
- [ ] Runs locally from documented commands (R)
- [ ] Deploy steps can be repeated and produce verifiable output (R)

### API quality (G)

- [ ] REST methods: POST, GET, PUT, DELETE
- [ ] Status codes: 201 created, 200 OK, 204 deleted, 400 validation, 401 not logged in, 403 not allowed, 404 not found, 500 server error
- [ ] One consistent JSON error format
- [ ] Backend validation: required fields, formats, references to other records exist, duplicates rejected

### UI quality (R, U)

- [ ] Clear loading, success and failure feedback on every action (R)
- [ ] Frontend form validation: required fields marked, errors shown next to the field, submit blocked until the form is valid, inputs disabled while saving (G)
- [ ] Consistent typography, spacing, colors and interaction states (R)
- [ ] Basic accessibility: labels, keyboard navigation, color contrast (R)
- [ ] Actions the user's role can't perform are hidden or disabled (G)

### Code (R)

- [ ] Organized by feature, not by giant files
- [ ] Shared code reused, not copy-pasted
- [ ] Linting and formatting applied consistently

### Testing, aimed at debugging (R, U)

- [ ] Backend unit tests for business rules (at-risk, over-allocation, dependency loops, permissions)
- [ ] Backend integration tests for the API against a real Postgres
- [ ] Frontend component tests for core screens, including error states
- [ ] At least one end-to-end test of the main user journey
- [ ] Test commands, results and known gaps written up in `TESTING.md`

### Documentation, published on GitHub (R, U)

- [ ] Root README: what the app is, architecture, setup, run, deploy, trade-offs and assumptions
- [ ] Architecture diagram showing how requests and data move through the system
- [ ] User stories for the UI, with acceptance criteria
- [ ] Logic walkthrough explaining how the key rules work
- [ ] API reference
- [ ] Decision log (why each major choice was made)
