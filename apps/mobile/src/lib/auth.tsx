/**
 * Who is signed in, for the whole app.
 *
 * On launch: read the stored refresh token, and if there is one, ask the API
 * who we are -- which refreshes the access token on the way if it expired.
 * Anything that ends the session (a failed refresh, sign-out, deleting the
 * account) lands here, and the root layout sends the user to sign-in.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PrivateUser } from '@whosonbreak/contracts';

import {
  api,
  clearSession,
  loadStoredSession,
  onSessionChange,
  storeSession,
} from '@/lib/api';

/** The phone's own zone, sent with a first sign-in to seed the schedule. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: PrivateUser };

interface AuthContextValue {
  state: AuthState;
  signInDev(name: string): Promise<void>;
  signOut(): Promise<void>;
  /** After the server has deleted the account. */
  forget(): Promise<void>;
  setUser(user: PrivateUser): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!(await loadStoredSession())) throw new Error('No session');
        const user = await api.me.get();
        if (!cancelled) setState({ status: 'signedIn', user });
      } catch {
        if (!cancelled) setState({ status: 'signedOut', user: null });
      }
    })();

    const unsubscribe = onSessionChange((signedIn) => {
      if (!signedIn) setState({ status: 'signedOut', user: null });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    state,
    async signInDev(name) {
      const session = await api.auth.dev(name, deviceTimeZone());
      await storeSession(session);
      setState({ status: 'signedIn', user: session.user });
    },
    async signOut() {
      try {
        await api.auth.logout();
      } catch {
        // Signing out locally matters more than telling the server.
      }
      await clearSession();
      setState({ status: 'signedOut', user: null });
    },
    async forget() {
      await clearSession();
      setState({ status: 'signedOut', user: null });
    },
    setUser(user) {
      setState({ status: 'signedIn', user });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** For screens that only render when signed in. */
export function useMe(): PrivateUser {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('Not signed in');
  return state.user;
}
