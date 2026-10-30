# FORGE — Netlify-ready application foundation

This repository turns the supplied standalone FORGE HTML into a structured web application with a real Supabase-backed account/data layer and Netlify Functions for private AI requests.

## Important status

This is an implemented first release foundation, **not a claim that every item in the full FORGE mega-prompt is complete**. The project includes a working public landing page, Supabase email/password auth wiring, the 37-question onboarding flow, exercise catalogue, custom exercises, workout builder, saved workouts, workout session logging, rest timer, session history, basic programme records, optional meal journal, data export and a server-side multi-provider AI endpoint.

A public launch is blocked until you create/configure your own Supabase project and Netlify site and add the environment variables. I cannot create accounts or deploy to your Netlify account from this workspace without access and your explicit authorisation.

## Included

- `public/index.html`, `public/styles.css`, `public/app.js` — responsive desktop-first FORGE interface.
- `supabase/migrations/001_forge_core.sql` — database schema, RLS policies, profile trigger and starter exercise catalogue.
- `netlify/functions/config.mjs` — exposes only the public Supabase URL and anon key to the browser.
- `netlify/functions/ai-coaching.mjs` — verifies the signed-in Supabase user and calls the configured AI provider server-side.
- `netlify.toml` — Netlify build, function and security-header configuration.
- `.env.example` — environment variable names, no secrets.
- `reference/forge_original.html` — original supplied HTML preserved for reference.

## 1. Create Supabase project

1. Create a project at https://supabase.com.
2. Open **SQL Editor**.
3. Run the complete contents of `supabase/migrations/001_forge_core.sql`.
4. In **Project Settings → API**, copy the Project URL and public anon key.
5. In **Authentication → URL Configuration**, set the Site URL to your eventual Netlify domain and add that domain to the allowed redirect URLs. During local development, add `http://localhost:8888/**`.
6. Configure email verification and password recovery email templates before public launch.

The database migration enables Row Level Security. Do not disable RLS to make the app work. Trainer roles must be granted by an administrator in Supabase; users cannot promote themselves.

## 2. Run locally

Install Node.js (current LTS), then from this folder run:

```bash
npm install
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_ANON_KEY in .env
npm run build
npm run dev
```

The local command uses Netlify Dev so that `/.netlify/functions/*` routes work. If `netlify` asks you to authenticate, you can still run the static site with a local server, but authentication and AI functions require the Netlify Functions runtime.

## 3. Configure Netlify

1. Push this folder to a Git repository.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Select the repository.
4. Set the publish directory to `public`. The functions directory is already configured as `netlify/functions` in `netlify.toml`. Only the `public` directory is published; migrations, source reference files and configuration examples stay out of the public web root.
5. Add these environment variables in **Site configuration → Environment variables**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Deploy and add the final Netlify domain to Supabase Auth's allowed redirect URLs.

## 4. Optional AI provider

Add at least one provider key in Netlify environment variables:

- OpenAI: `AI_PROVIDER=openai`, `OPENAI_API_KEY`, optional `OPENAI_MODEL`.
- Anthropic: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`.
- Gemini: `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, optional `GEMINI_MODEL`.

Never put provider keys in `app.js`, `index.html`, or any browser-visible environment variable. The AI function verifies the caller's Supabase access token before sending a request.

## 5. Current feature boundaries

Implemented in this delivery:

- Public landing page and responsive navigation.
- Real Supabase signup/login/logout/password-reset integration.
- Profile initialisation through a database trigger.
- 37-question multi-select/single-select questionnaire with explanation fields, autosave and review.
- Skip questionnaire route.
- Searchable starter exercise catalogue and filters.
- User-created custom exercises.
- Workout builder with per-exercise set/reps/rest settings, save, edit, delete and start.
- Active workout set logging, RPE field, rest timer and session save.
- Workout history and basic progress summaries from real saved sessions.
- Basic programme records, AI draft review/approval and saved-workout assignment.
- Optional meal journal.
- JSON account-data export.
- Authenticated AI coach and AI workout-plan endpoint (requires provider credentials).
- Initial database RLS and role-protection trigger.

Still required before claiming the entire FORGE specification is complete:

- Complete multi-week programme calendar, progression blocks, deload scheduling and robust programme editor.
- Advanced configurable exercise metrics, supersets/drop sets/AMRAP tracking and reliable interrupted-session recovery.
- Full adaptive AI using server-queried history, approval diff UI, and provider usage/rate-limit controls.
- Full nutrition questionnaire, food database, macro/meal planning and genuine image recognition.
- Full trainer invitation/acceptance workflow, client profile permissions, notes and programme assignment UI.
- Workout/programme public or private sharing links.
- Account deletion workflow and formal data export/delete verification.
- Privacy policy, terms, support and production monitoring.
- Automated end-to-end tests and independent security review.

Do not advertise those unfinished items as available. The starter exercise catalogue is a substantial initial set, not literally every exercise or workout ever created.

## 6. Before inviting public users

- Complete the remaining items above or explicitly remove them from the launch scope.
- Configure and test email verification, password reset and production redirects.
- Test with at least two independent accounts to verify RLS isolation.
- Test AI provider errors, rate limits and invalid structured responses.
- Add privacy and terms pages and obtain appropriate legal review for the intended UK audience.
- Configure backups, monitoring, abuse prevention and support contact details.
- Test desktop, tablet and mobile browsers.

## Original source

The supplied source is preserved in `reference/forge_original.html`. It was used as a product reference; its demonstration-only sample telemetry, sample meal recognition, hard-coded user identity and mock authentication were not retained as real functionality.


## 6. Installable web app (PWA)

The project includes a web app manifest, install icons, an app-shell service worker and an offline fallback. Static files can be cached for shell loading; authenticated data, Supabase requests and Netlify Functions are deliberately not cached. Account and AI features still require an internet connection.

## 7. Android and iOS app foundation (Capacitor)

The repository includes `capacitor.config.json`, Capacitor dependencies and a local bundled Supabase client (the browser no longer needs to download Supabase from a third-party module CDN). Run `npm run build` before syncing the native projects. The current application is a static HTML/CSS/JavaScript app, so its `public` directory is the Capacitor web asset directory. It does not need a Next.js rebuild.

1. Install Node.js LTS and Android Studio on Windows.
2. Run `npm install` in this project folder.
3. Set `apiBaseUrl` and `authRedirectUrl` in `public/forge-config.js` to the exact live Netlify origin, for example `https://YOUR-SITE.netlify.app` (replace the example with your real site URL).
4. Run `npx cap add android` and `npx cap add ios` once. The iOS project can be generated on Windows, but compiling/signing it requires macOS/Xcode or a hosted macOS runner.
5. Run `npx capacitor-assets generate` to create platform icon/splash resources, then `npm run cap:sync` after web changes. Use `npm run cap:android` to open Android Studio on Windows. Use `npm run cap:ios` on a Mac/hosted macOS runner.

The current mobile auth redirect is configured to use the public Netlify website origin so verification links do not point at `localhost` or the Capacitor local origin. This provides a web-based verification fallback; native deep-link return into the app is a separate enhancement and must be configured/tested before store release. Add the Netlify origin to Supabase Authentication → URL Configuration → Redirect URLs and set it as the Supabase Site URL.

**Windows limitation:** Windows can develop and build Android. iOS compilation, simulator testing, signing and App Store packaging require access to macOS/Xcode (locally or through a hosted Mac service). App-store developer account eligibility and agreements must be handled by an eligible account holder.

A GitHub Actions workflow at `.github/workflows/mobile-builds.yml` is included. After pushing to the `main` branch, it attempts an Android debug APK build and an unsigned iOS Simulator build on hosted runners. These are development/test artifacts, not signed store-release packages. Store releases still need app signing credentials, real-device testing, privacy/legal preparation and eligible developer accounts.
