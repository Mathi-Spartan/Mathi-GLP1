# Weekly Health Tracker

A personal health-tracking web app for a medically supervised GLP-1 program.
Log weight, injections, meals, water, activity, medications, and side effects;
import Apple Health weekly; and generate a clinician-ready PDF for each
Tuesday-to-Tuesday appointment.

**Non-technical setup:** see `DEPLOY-GUIDE.md`.

## Stack
- React + Vite (frontend, deployed on Vercel)
- Supabase (Postgres + Auth, with Row-Level Security)
- Client-side PDF generation (jsPDF)
- Apple Health via weekly `export.xml` upload (no app install needed)

## Project layout
```
supabase/schema.sql        Database tables + RLS (run once in Supabase)
src/lib/week.js            Tuesday-to-Tuesday date logic
src/lib/appleHealth.js     Parses Apple Health export.xml
src/lib/pdf.js             Builds the weekly PDF report
src/lib/supabase.js        Supabase client
src/components/            Auth, Dashboard, log forms
```

## Local development
```
npm install
cp .env.example .env       # fill in your Supabase URL + anon key
npm run dev
```

## Roadmap
- Phase 1: native Expo iOS app for automatic Apple Health sync; charts in the PDF.
- Phase 2: clinician portal, multi-tenant roles, audit logging.
- Phase 3: consented, de-identified analytics dataset.
