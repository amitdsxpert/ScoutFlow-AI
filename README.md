# ScoutFlow AI

ScoutFlow AI is an internal AI recruiting agent workspace. Each agent owns one stage of the hiring pipeline: JD intelligence, source discovery, resume parsing, candidate matching, recommendation, outreach generation, phone engagement, interest detection, ranking, and export. The orchestrator coordinates these agents, logs each decision, and produces a recruiter-ready shortlist. The workspace runs locally with deterministic fallback logic and can optionally use OpenRouter, Gemini, Groq, or Hugging Face for LLM-powered reasoning.

Real outreach delivery is supported via Resend (email) and Twilio (SMS/WhatsApp), with webhook handlers for delivery status and reply tracking.

## Features

- **Talent Intelligence Command Center** - Role-specific recruiting workflows with visible agent status board
- **Candidate Intelligence Table** - Multi-keyword search, filters, bulk selection, and candidate drawer
- **Outreach Studio** - Campaign builder across Email, WhatsApp, LinkedIn, SMS, and Phone channels
- **Real Message Delivery** - Send emails via Resend, SMS/WhatsApp via Twilio (optional)
- **Webhook Handling** - Track delivery status, opens, bounces, and reply intent
- **Phone Interest Check** - Script generation and simulated transcript for call automation
- **Automatic Shortlist** - Recommended, Manual, Contacted, and Interested tabs with scoring presets
- **CSV/JSON Export** - Recruiter-ready handoff packages
- **Database Connector** - Pull candidates from PostgreSQL or MySQL
- **Metabase Connector** - Execute saved questions from a Metabase analytics instance
- **PDF/DOCX Resume Parsing** - Upload resumes with AI field extraction
- **Role-based Authentication** - Session management with optional user auth
- **LLM Provider Chain** - OpenRouter → Gemini → Groq → Hugging Face → Local Fallback

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000

```bash
npm run lint
npm run build
```

## Demo Flow

1. Open the Talent Intelligence Command Center
2. Select a role, source, candidate limit, and channels
3. Click **Run ScoutFlow Agents**
4. Watch the Agent Status Board and Agent Activity Timeline update
5. Open Candidates and search with keywords like `python fastapi remote`
6. Select candidates in bulk
7. Open Outreach, choose audience and channels, generate campaign
8. Simulate replies or configure real Resend/Twilio credentials
9. Review Interest Scores, delivery status, and next actions
10. Export CSV or workspace JSON

## Environment Configuration

Copy `.env.example` to `.env.local`:

```bash
# LLM Provider (optional - app works without it using local fallback)
LLM_PROVIDER=none
OPENROUTER_API_KEY=
OPENROUTER_MODEL=google/gemma-3-27b-it:free
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

# Real Outreach Delivery (optional)
PUBLIC_BASE_URL=https://your-ngrok-url.ngrok.io
RESEND_API_KEY=
RESEND_FROM=ScoutFlow <onboarding@resend.dev>
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_SMS_FROM=+1234567890
TWILIO_WHATSAPP_FROM=whatsapp:+1234567890

# Database Connector (optional)
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=candidates_db
DB_USER=your_user
DB_PASSWORD=your_password

# Metabase Connector (optional)
METABASE_URL=https://your-metabase.com
METABASE_API_KEY=your_api_key

# Local Auth (optional)
AUTH_USERS=[{"email":"admin@scoutflow.ai","password":"secret","name":"Admin","role":"admin"}]
```

## Architecture

```
app/
├── page.tsx                     # Main app entry
├── layout.tsx                  # Root layout
└── api/
    ├── agents/
    │   ├── run/route.ts        # Run full agent pipeline
    │   ├── jd/route.ts         # JD intelligence
    │   └── outreach/route.ts  # Generate outreach messages
    ├── auth/login/route.ts     # Session auth
    ├── connector/
    │   ├── database/route.ts   # DB connector
    │   ├── metabase/route.ts   # Metabase connector
    │   └── resume/route.ts     # Resume parser
    ├── llm/route.ts            # LLM generation
    └── outreach/
        ├── send/route.ts       # Send real messages
        ├── messages/route.ts   # List/update messages
        ├── log-reply/route.ts  # Log reply intent
        └── webhook/
            ├── resend/route.ts          # Resend events
            ├── twilio-status/route.ts   # Twilio delivery
            └── twilio-inbound/route.ts  # Twilio replies

components/
├── AppShell.tsx               # Main layout with nav
├── Dashboard.tsx               # Agent command center
├── AgentWorkflowPanel.tsx     # Agent status board
├── CandidateDiscovery.tsx     # Candidate table/cards
├── OutreachStudio.tsx         # Campaign builder
├── Shortlist.tsx              # Ranked shortlist
├── RoleBuilder.tsx           # JD management
├── SourceHub.tsx             # Data source connectors
├── ExportPanel.tsx           # CSV/JSON export
├── PhoneSimulator.tsx        # Phone outreach
└── ui.tsx                    # Shared components

lib/
├── agents/                   # Agent modules
│   ├── orchestrator.ts       # Pipeline coordinator
│   ├── jdAgent.ts           # JD parsing
│   ├── sourceAgent.ts       # Candidate sourcing
│   ├── resumeAgent.ts       # Resume parsing
│   ├── matchingAgent.ts      # Role-candidate matching
│   ├── recommendationAgent.ts # Candidate recommendations
│   ├── outreachAgent.ts      # Message generation
│   ├── phoneAgent.ts        # Phone scripts
│   ├── interestAgent.ts      # Interest detection
│   ├── rankingAgent.ts      # Shortlist ranking
│   ├── exportAgent.ts       # Export generation
│   ├── llmClient.ts         # LLM provider chain
│   └── types.ts             # Agent types
├── messaging/
│   ├── providers.ts         # Resend + Twilio senders
│   └── store.ts            # Message persistence
├── database.ts              # Database connector
├── metabase.ts             # Metabase connector
├── resumeParser.ts         # PDF/DOCX parser
├── auth.ts                 # Auth manager
├── scoring.ts              # Match scoring
├── ranking.ts              # Shortlist ranking
├── simulation.ts           # Reply simulation
├── outreach.ts            # Message templates
├── export.ts               # CSV/JSON export
├── roles.ts                # Role pipeline management
├── demoData.ts            # Sample candidates
├── identity.ts            # Candidate ID generation
└── types.ts               # Shared types

data/
├── sample-candidates.json   # Demo candidates
└── outreach-messages.json # Sent messages store
```

## Scoring Logic

Match Score combines required skills, experience, preferred skills, domain relevance, location fit, and risk adjustment.

```
Final Score = Match Score * 0.65 + Interest Score * 0.35
```

Presets: Balanced, Skills-first, Interest-first, Location-first, Availability-first

## Provider Chain

When an LLM provider is configured via `LLM_PROVIDER`, ScoutFlow attempts them in order:

```
openrouter → gemini → groq → huggingface → local_fallback
```

If a provider is missing, rate-limited, or fails, ScoutFlow automatically falls back to the next provider. The Settings panel allows testing and switching providers.

## Real Outreach Flow

1. Configure Resend/Twilio in `.env.local`
2. Run agents or generate campaign in Outreach Studio
3. Click "Send Real Messages" to dispatch via providers
4. Webhooks update delivery status in real-time
5. Replies are parsed and interest signals updated

For Twilio webhooks to work locally, use ngrok:
```bash
ngrok http 3000
# Set PUBLIC_BASE_URL=https://xxx.ngrok.io in .env.local
```

## Security

- Never commit `.env.local`
- API keys stay on the server (never in browser storage)
- Settings panel stores only provider/model selection
- The app remains fully functional with `LLM_PROVIDER=none`