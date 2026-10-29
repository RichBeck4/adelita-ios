# Adelita for iPhone

The Adelita web app (https://adelita-coach.netlify.app) inside a native iPhone shell, plus the two things only an iPhone app can do:

- **Apple Health sync:** reads her runs, resting heart rate, HRV and sleep on the phone and hands them to the page, which saves them through the `health-sync` Netlify function (web repo `RichBeck4/adelita`).
- **Apple Watch workouts:** puts the next 14 days of sessions into the Workout app on her watch (warm-up, repeats, recoveries, cool-down, pace-range alerts). Needs iOS 17 and watchOS 10.

Everything else (plans, sign-in, COROS, Intervals.icu) is the normal website, so most changes ship by deploying the web app, with no new App Store build.

## Stack

Expo SDK 58 (React Native 0.88), `react-native-webview`, `@kingstinct/react-native-healthkit` 16 with `react-native-nitro-modules`, and a local Expo module for WorkoutKit (autolinked from `modules/`). Brand fonts (Instrument Serif, Outfit, both OFL) are embedded for the offline screen.

- **Expo project:** `@jmm-web-apps/adelita` (id `4ef1b768-3995-4af3-a0f5-d519d54675e1`)
- **Bundle ID:** `com.jmmwebapps.adelita`. This can't change once the app is on the App Store.

## How the page and the app talk

- The app sets `window.ADELITA_NATIVE = { platform: 'ios', health: true, watch, version }` before the page loads.
- Page to app: `{ id, type: 'health.read', args: { days } }` and `{ id, type: 'watch.schedule', args: { workouts: [{ id, date, workout }] } }`.
- App to page: `window.__adelitaNativeReply(id, ok, payload)`, and an `adelita:foreground` event when the app comes back to the front.
- Only Adelita's own pages can make these requests. Links to anything other than Adelita, COROS and Intervals.icu open in Safari (`src/links.ts`).

## First build (once the Apple Developer account is approved)

- [ ] `npm install`, then `npx expo install --fix` (this lines up every package with SDK 58)
- [ ] `npx eas-cli@latest login` with the Expo account
- [ ] `npm run build:dev`. EAS asks you to sign in to Apple once, creates the certificates and registers your iPhone (open the link it shows on the phone)
- [ ] Install the build on the iPhone, then run `npm start` on the laptop
- [ ] Sign in to Adelita in the app, allow Apple Health, and check that runs arrive
- [ ] Open a session, tap "Send to my watch", allow it, and check the Workout app on the watch

## Builds without a laptop

The repo is linked to the Expo project, and `.eas/workflows/` holds two workflows you can start from expo.dev → Workflows:

- **TestFlight** (`testflight.yml`): builds the App Store version and sends it to TestFlight
- **iPhone development build** (`dev-build.yml`): a build for our own registered iPhones

Both need the Apple credentials on Expo first. In App Store Connect, go to Users and Access → Integrations and create an App Store Connect API key (App Manager role). Add it in Expo under project → Credentials → iOS. After that, Expo makes the certificates itself.

## Lockfile

`package-lock.json` pins the exact version of every package, so each Expo build is the same. To create or refresh it without a laptop, go to GitHub → Actions → **Update lockfile** → Run workflow. Run it again after any change to `package.json`.

## TestFlight (Karla's mum and other testers)

- [ ] Create the app in App Store Connect with bundle ID `com.jmmwebapps.adelita`
- [ ] `npm run build:prod`, then `npm run submit`
- [ ] Add testers by email in App Store Connect → TestFlight. The first build gets a quick Apple check, usually within a day

## Before charging

Apple won't let the iPhone app send UK users to a web checkout for a digital subscription. When the paid tier launches, either sell through Apple (15% for small developers) or hide sign-up and payment inside the app.

## App Store checklist

- [ ] Privacy policy URL: https://adelita-coach.netlify.app/privacy.html
- [ ] App Privacy answers: health and fitness data, linked to the user, used for app functionality only, not for tracking
- [ ] Screenshots at 6.9" (1320 × 2868)
- [ ] A review account for Apple (a test login with a plan), mentioned in the review notes
- [ ] Explain in the review notes why it reads Health data (to set paces from real runs and recovery) and writes to the Workout app
