# Adelita iPhone app

This is the iPhone shell for the Adelita web app. The web app lives in a separate repo, `RichBeck4/adelita`, and the two must not get mixed up.

## Files

- `App.tsx` is the WebView shell. It holds the page bridge (`health.read`, `watch.schedule`), the foreground event, link routing and the offline screen.
- `src/health.ts` reads Apple Health and returns the shape `netlify/functions/health-sync.mjs` expects.
- `src/links.ts` decides which addresses stay in the app.
- `modules/adelita-watch` is a Swift (WorkoutKit) module that schedules sessions in the Apple Watch Workout app. `index.ts` is its JS wrapper.
- `assets/` holds the icon, the splash mark and the fonts.

## Rules

- **Brand:** follow the Adelita brand pack. Use only palette colours, and only the Instrument Serif and Outfit fonts. The app icon is aubergine `#140E14` with a rojo grana glow and the on-dark mark.
- **Bridge contract:** if a message type or payload changes here, change the web page's bridge in `public/index.html` to match, and keep old app versions working.
- **No secrets:** don't commit any. EAS holds the Apple credentials.
