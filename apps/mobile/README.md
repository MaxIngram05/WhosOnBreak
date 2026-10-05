# WhosOnBreak — Android app

Expo (SDK 57) app for the WhosOnBreak API. Sign-in is development-only for
now: type a name, and the same name always opens the same account.

## Run it

1. Start the API with demo data, from `apps/api`:

   ```
   DATABASE_URL=pglite SEED=1 JWT_SECRET=<32+ random chars> npm run dev
   ```

   With no `GOOGLE_CLIENT_IDS` set it runs in development mode, which is what
   enables the dev sign-in. It listens on port 8787 on every interface, so
   phones on the same Wi-Fi can reach it.

2. Point the app at it: copy `.env.example` to `.env.local` and set
   `EXPO_PUBLIC_API_URL` to your computer's LAN address. Skip this on the
   Android emulator.

3. From `apps/mobile`: `npx expo start`, then scan the QR code with Expo Go.

Sign in as "Ada" on one phone and "Ben" on another, put them in one group, and
the Today tab shows who is on break.

## Windows note

Run npm and Expo from the correctly-cased path (`C:\Users\axein\WhosOnBreak\WhosOnBreak`).
npm's workspace links take the casing of the directory you ran it from, and
Metro treats differently-cased paths as different folders, which shows up as
"Unable to resolve module @whosonbreak/contracts".

## Checks

```
npm run typecheck
npx expo lint
npx expo-doctor
```
