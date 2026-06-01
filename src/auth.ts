/**
 * Auth state — JWT lives in an httpOnly cookie (set by the server).
 * No localStorage / sessionStorage for credentials.
 */

export interface AuthUser {
  userId: string;
  firstName: string;
  displayName: string;
}

/** In-memory display cache only; session authority is the httpOnly cookie. */
let currentUser: AuthUser | null = null;
const listeners = new Set<(user: AuthUser | null) => void>();

function emit(): void {
  for (const fn of listeners) fn(currentUser);
}

export function getAuthUser(): AuthUser | null {
  return currentUser;
}

export function subscribeAuth(fn: (user: AuthUser | null) => void): () => void {
  listeners.add(fn);
  fn(currentUser);
  return () => listeners.delete(fn);
}

export function studentDisplayLabel(user: AuthUser | null): string {
  const name = user?.firstName?.trim();
  return name ? `Student — ${name}` : 'Student — Anonymous';
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/** Restore session from httpOnly cookie via GET /api/auth/me. */
export async function restoreAuthSession(): Promise<AuthUser | null> {
  try {
    const res = await authFetch('/api/auth/me');
    if (!res.ok) {
      currentUser = null;
      emit();
      return null;
    }
    const data = (await res.json()) as AuthUser;
    currentUser = {
      userId: data.userId,
      firstName: data.firstName,
      displayName: data.displayName ?? data.firstName,
    };
    emit();
    return currentUser;
  } catch {
    currentUser = null;
    emit();
    return null;
  }
}

export async function loginWithName(firstName: string): Promise<AuthUser> {
  const res = await authFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ firstName: firstName.trim() }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error === 'name_required' ? 'Please enter your name.' : 'Login failed.');
  }
  const data = (await res.json()) as AuthUser;
  currentUser = {
    userId: data.userId,
    firstName: data.firstName,
    displayName: data.displayName ?? data.firstName,
  };
  emit();
  return currentUser;
}

export async function logout(): Promise<void> {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    /* offline — still clear client state */
  }
  currentUser = null;
  emit();
}
