// Adelita for iPhone: the Adelita web app in a native shell, plus what only an iPhone app
// can do — read Apple Health and put planned sessions on her Apple Watch.
//
// Page ↔ app messages (see the web repo, public/index.html, "inside the Adelita iPhone app"):
//   page → app  { id, type: 'health.read',    args: { days } }
//   page → app  { id, type: 'watch.schedule', args: { workouts: [{ id, date, workout }] } }
//   app → page  window.__adelitaNativeReply(id, ok, payload)
//   app → page  'adelita:foreground' event when the app comes back to the front
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { HealthError, readHealth } from './src/health';
import { isAdelitaPage, SITE, staysInApp } from './src/links';
import { scheduleWorkouts, watchSupported, type WatchWorkout } from './modules/adelita-watch';

const VERSION = '1.0.0';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

// Set before the page's own scripts run, so the page knows it is inside the app and
// whether it can send sessions to the Workout app on Apple Watch (iOS 17+).
const BEFORE_LOAD = `window.ADELITA_NATIVE = ${JSON.stringify({ platform: 'ios', health: true, watch: watchSupported(), version: VERSION })}; true;`;

type Request = {
  id: string;
  type: string;
  args?: { days?: number; workouts?: { id: string; date: string; workout: WatchWorkout }[] };
};

const C = {
  cream: '#FBF4F6',
  deepPlum: '#2A1424',
  body: '#5A4152',
  rojo: '#C41840',
};

export default function App() {
  const web = useRef<WebView>(null);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);
  const backgrounded = useRef(false);

  const reply = useCallback((id: string, ok: boolean, payload: unknown) => {
    const js = `window.__adelitaNativeReply && window.__adelitaNativeReply(${JSON.stringify(id)}, ${ok}, ${JSON.stringify(payload ?? null)}); true;`;
    web.current?.injectJavaScript(js);
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    // Only Adelita's own pages may ask for Health data or touch the watch.
    if (!isAdelitaPage(e.nativeEvent.url)) return;
    let msg: Request;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!msg || typeof msg.id !== 'string' || typeof msg.type !== 'string') return;

    if (msg.type === 'health.read') {
      try {
        reply(msg.id, true, await readHealth(Number(msg.args?.days) || 90));
      } catch (err) {
        reply(msg.id, false, { error: err instanceof HealthError ? err.code : 'health_failed' });
      }
      return;
    }
    if (msg.type === 'watch.schedule') {
      try {
        reply(msg.id, true, await scheduleWorkouts(Array.isArray(msg.args?.workouts) ? msg.args!.workouts! : []));
      } catch (err) {
        const code = (err as { code?: string })?.code;
        reply(msg.id, false, { error: code === 'watch_unsupported' ? 'watch_unsupported' : 'watch_failed' });
      }
      return;
    }
    reply(msg.id, false, { error: 'unknown_request' });
  }, [reply]);

  // Tell the page when she comes back to the app, so it can pull in a run she's just done.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') backgrounded.current = true;
      if (s === 'active' && backgrounded.current) {
        backgrounded.current = false;
        web.current?.injectJavaScript(`window.dispatchEvent(new Event('adelita:foreground')); true;`);
      }
    });
    return () => sub.remove();
  }, []);

  const openOutside = (url: string) => { Linking.openURL(url).catch(() => undefined); };

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        {failed ? (
          <View style={styles.offline}>
            <Text style={styles.title}>Can't reach Adelita</Text>
            <Text style={styles.body}>Check you're online, then try again.</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => { setFailed(false); setKey((k) => k + 1); }}>
              <Text style={styles.buttonText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            key={key}
            ref={web}
            source={{ uri: SITE }}
            style={styles.screen}
            originWhitelist={['https://*', 'about:*']}
            injectedJavaScriptBeforeContentLoaded={BEFORE_LOAD}
            onMessage={onMessage}
            applicationNameForUserAgent={`AdelitaApp/${VERSION}`}
            sharedCookiesEnabled
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled
            allowsInlineMediaPlayback
            setSupportMultipleWindows={false}
            onShouldStartLoadWithRequest={(req) => {
              if (req.isTopFrame === false) return true;
              if (staysInApp(req.url)) return true;
              if (/^(mailto|tel|sms):/.test(req.url) || req.url.startsWith('https://') || req.url.startsWith('http://')) openOutside(req.url);
              return false;
            }}
            onOpenWindow={(e) => openOutside(e.nativeEvent.targetUrl)}
            onLoadEnd={() => { SplashScreen.hideAsync().catch(() => undefined); }}
            onError={() => { setFailed(true); SplashScreen.hideAsync().catch(() => undefined); }}
            onContentProcessDidTerminate={() => web.current?.reload()}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.cream },
  offline: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12, backgroundColor: C.cream },
  title: { fontSize: 32, color: C.deepPlum, fontFamily: 'InstrumentSerif-Regular', textAlign: 'center' },
  body: { fontSize: 16, color: C.body, fontFamily: 'Outfit-Regular', textAlign: 'center' },
  button: { marginTop: 8, minHeight: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: C.rojo, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: C.cream, fontSize: 16, fontFamily: 'Outfit-SemiBold' },
});
