import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Release-safe by default. Do not add `server.url` / `server.cleartext` here: the app always
 * loads the bundled web build (apps/web/dist-mobile). For live reload use
 * `npx cap run android --live-reload --host <lan-ip>` locally and never commit the result.
 */
const config: CapacitorConfig = {
  // Placeholder reverse-domain id; change it freely until the first store upload. After that it
  // is permanent (a new id means a new store listing).
  appId: 'ar.org.nortevilladiego.territorios',
  appName: 'Territorios',
  webDir: '../web/dist-mobile',
  // No bridge logging (plugin call payloads can carry the session). Use 'debug' locally only.
  loggingBehavior: 'none',
  android: {
    allowMixedContent: false,
    // Release builds must not be inspectable from chrome://inspect. Flip locally to debug only.
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'automatic',
    webContentsDebuggingEnabled: false,
  },
  server: {
    // No external navigation inside the WebView: every allowNavigation host gets bridge access.
    allowNavigation: [],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: true,
    },
  },
};

export default config;
