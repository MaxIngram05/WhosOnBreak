/**
 * The typed client for our API.
 *
 * Every request and response type comes from @whosonbreak/contracts, the same
 * package the server validates against, so the app and the API cannot drift
 * apart without the typechecker noticing.
 *
 * Sessions: the access token lives in memory and in SecureStore; the refresh
 * token only in SecureStore (never AsyncStorage -- these are credentials). A
 * 401 triggers one silent refresh, shared by every request that hit it at the
 * same moment, and then the original request is retried once.
 */

import * as SecureStore from 'expo-secure-store';
import type {
  AccountExport,
  BlockInput,
  BreaksResponse,
  CreateScheduleRequest,
  Friend,
  Group,
  GroupDetail,
  GroupInvite,
  GroupMember,
  OnBreakNowResponse,
  PrivateUser,
  PublicUser,
  Schedule,
  ScheduleWithBlocks,
  Session,
  UpdateScheduleRequest,
  Visibility,
  WeekView,
} from '@whosonbreak/contracts';

/**
 * Where the API is. 10.0.2.2 is how the Android emulator reaches the machine
 * running it; on a physical phone, set EXPO_PUBLIC_API_URL in apps/mobile/.env
 * to your computer's LAN address, e.g. http://192.168.1.20:8787.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8787').replace(
  /\/$/,
  '',
);

const ACCESS_KEY = 'wob.accessToken';
const REFRESH_KEY = 'wob.refreshToken';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** A message fit to show a person, chosen from the error code. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'validation_failed': {
        const first = error.fields ? Object.values(error.fields)[0]?.[0] : undefined;
        return first ?? 'Something in that was not valid.';
      }
      case 'unauthenticated':
        return 'Please sign in again.';
      case 'forbidden':
        return "You don't have permission to do that.";
      case 'not_found':
        return error.message || "That couldn't be found.";
      case 'conflict':
        return error.message;
      case 'group_full':
        return 'That group is full (30 people).';
      case 'rate_limited':
        return 'Slow down a little and try again in a moment.';
      default:
        return 'Something went wrong. Try again.';
    }
  }
  return `Can't reach the server at ${API_URL}.`;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

type SessionListener = (signedIn: boolean) => void;
const listeners = new Set<SessionListener>();

/** Told when the session ends on its own -- a refresh that failed. */
export function onSessionChange(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function loadStoredSession(): Promise<boolean> {
  accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  return refreshToken !== null;
}

export async function storeSession(session: Session): Promise<void> {
  accessToken = session.accessToken;
  refreshToken = session.refreshToken;
  await SecureStore.setItemAsync(ACCESS_KEY, session.accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, session.refreshToken);
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

/** One refresh at a time, however many requests found their token expired. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      if (!refreshToken) return false;
      const response = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) return false;
      await storeSession((await response.json()) as Session);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type Query = Record<string, string | number | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const parts = Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
}

async function send(method: string, path: string, body: unknown, authed: boolean) {
  return fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(authed && accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; authed?: boolean } = {},
): Promise<T> {
  const authed = options.authed ?? true;
  const url = withQuery(path, options.query);

  let response = await send(method, url, options.body, authed);

  if (response.status === 401 && authed) {
    if (await refreshOnce()) {
      response = await send(method, url, options.body, authed);
    } else {
      await clearSession();
      listeners.forEach((listener) => listener(false));
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = parsed?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'internal',
      error?.message ?? `HTTP ${response.status}`,
      error?.fields,
    );
  }
  return parsed as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export interface BreakOptions {
  week?: string;
  minParticipants?: number;
  minDurationMinutes?: number;
}

export const api = {
  auth: {
    dev: (name: string, timeZone: string) =>
      request<Session>('POST', '/v1/auth/dev', { body: { name, timeZone }, authed: false }),
    google: (idToken: string, timeZone: string) =>
      request<Session>('POST', '/v1/auth/google', { body: { idToken, timeZone }, authed: false }),
    logout: () => request<void>('POST', '/v1/auth/logout', { body: {} }),
  },

  me: {
    get: () => request<PrivateUser>('GET', '/v1/me'),
    update: (changes: { displayName?: string; defaultVisibility?: Visibility }) =>
      request<PrivateUser>('PATCH', '/v1/me', { body: changes }),
    rotateFriendCode: () => request<PrivateUser>('POST', '/v1/me/friend-code/rotate'),
    export: () => request<AccountExport>('GET', '/v1/me/export'),
    delete: () => request<void>('DELETE', '/v1/me'),
  },

  schedules: {
    list: () => request<Schedule[]>('GET', '/v1/schedules'),
    create: (body: Partial<CreateScheduleRequest> & { name: string; timeZone: string }) =>
      request<ScheduleWithBlocks>('POST', '/v1/schedules', { body }),
    update: (id: string, body: Partial<UpdateScheduleRequest>) =>
      request<Schedule>('PATCH', `/v1/schedules/${id}`, { body }),
    blocks: (id: string) => request<ScheduleWithBlocks>('GET', `/v1/schedules/${id}/blocks`),
    replaceBlocks: (id: string, blocks: BlockInput[], expectedUpdatedAt?: string) =>
      request<ScheduleWithBlocks>('PUT', `/v1/schedules/${id}/blocks`, {
        body: { blocks, expectedUpdatedAt },
      }),
  },

  friends: {
    list: () => request<Friend[]>('GET', '/v1/friends'),
    requestByCode: (friendCode: string) =>
      request<Friend>('POST', '/v1/friends/requests', { body: { friendCode } }),
    requestById: (userId: string) =>
      request<Friend>('POST', '/v1/friends/requests', { body: { userId } }),
    accept: (friendshipId: string) =>
      request<Friend>('POST', `/v1/friends/requests/${friendshipId}/accept`),
    remove: (userId: string) => request<void>('DELETE', `/v1/friends/${userId}`),
    blocked: () => request<PublicUser[]>('GET', '/v1/friends/blocked'),
    block: (userId: string) => request<void>('POST', `/v1/friends/${userId}/block`),
    unblock: (userId: string) => request<void>('DELETE', `/v1/friends/${userId}/block`),
  },

  groups: {
    list: () => request<Group[]>('GET', '/v1/groups'),
    create: (name: string, subtitle?: string) =>
      request<Group>('POST', '/v1/groups', { body: { name, subtitle } }),
    join: (code: string) => request<Group>('POST', '/v1/groups/join', { body: { code } }),
    get: (id: string) => request<GroupDetail>('GET', `/v1/groups/${id}`),
    update: (id: string, body: { name?: string; subtitle?: string | null }) =>
      request<Group>('PATCH', `/v1/groups/${id}`, { body }),
    setCanInvite: (id: string, userId: string, canInvite: boolean) =>
      request<GroupMember[]>('PATCH', `/v1/groups/${id}/members/${userId}`, {
        body: { canInvite },
      }),
    removeMember: (id: string, userId: string) =>
      request<void>('DELETE', `/v1/groups/${id}/members/${userId}`),
    rotateCode: (id: string) => request<Group>('POST', `/v1/groups/${id}/code/rotate`),
    close: (id: string) => request<void>('DELETE', `/v1/groups/${id}`),
    invite: (id: string, userId: string) =>
      request<GroupInvite>('POST', `/v1/groups/${id}/invites`, { body: { userId } }),
    breaks: (id: string, options: BreakOptions = {}) =>
      request<BreaksResponse>('GET', `/v1/groups/${id}/breaks`, { query: { ...options } }),
    now: (id: string) => request<OnBreakNowResponse>('GET', `/v1/groups/${id}/now`),
  },

  invites: {
    list: () => request<GroupInvite[]>('GET', '/v1/invites'),
    accept: (id: string) => request<Group>('POST', `/v1/invites/${id}/accept`),
    decline: (id: string) => request<void>('DELETE', `/v1/invites/${id}`),
  },

  people: {
    week: (userId: string, week?: string) =>
      request<WeekView>('GET', `/v1/people/${userId}/week`, { query: { week } }),
  },
};
