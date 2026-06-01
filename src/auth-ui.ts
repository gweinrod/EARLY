import {
  getAuthUser,
  loginWithName,
  logout,
  restoreAuthSession,
  studentDisplayLabel,
  subscribeAuth,
} from './auth';
import { setStudentId } from './session-log';
import { setWritingStudentId } from './letter-writing-data';
import { $, hide, show } from './ui';

let loginResolver: ((user: NonNullable<ReturnType<typeof getAuthUser>>) => void) | null = null;

function syncStudentIdsFromAuth(): void {
  const user = getAuthUser();
  const id = user?.userId ?? '';
  setStudentId(id);
  setWritingStudentId(id);
}

function updateStudentLabel(): void {
  $('studentDisplayName').textContent = studentDisplayLabel(getAuthUser());
}

export function showLoginModal(): void {
  show('loginModal');
  const input = $('loginName') as HTMLInputElement;
  input.value = '';
  input.focus();
  $('loginError').textContent = '';
  $('loginError').style.display = 'none';
}

export function hideLoginModal(): void {
  hide('loginModal');
}

/** Block app start until the user has a valid session (cookie). */
export function requireAuthSession(): Promise<NonNullable<ReturnType<typeof getAuthUser>>> {
  return new Promise((resolve) => {
    loginResolver = resolve;
  });
}

export function initAuthUi(): void {
  subscribeAuth(() => {
    updateStudentLabel();
    syncStudentIdsFromAuth();
  });

  $('btnLogout').addEventListener('click', () => {
    void logout().then(() => {
      showLoginModal();
    });
  });

  $('btnLogin').addEventListener('click', () => {
    void submitLogin();
  });

  $('loginName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void submitLogin();
  });
}

async function submitLogin(): Promise<void> {
  const input = $('loginName') as HTMLInputElement;
  const name = input.value.trim();
  const errEl = $('loginError');
  if (!name) {
    errEl.textContent = 'Please enter your name.';
    errEl.style.display = 'block';
    return;
  }
  try {
    const user = await loginWithName(name);
    hideLoginModal();
    loginResolver?.(user);
    loginResolver = null;
  } catch (e) {
    errEl.textContent = e instanceof Error ? e.message : 'Login failed.';
    errEl.style.display = 'block';
  }
}

/** Call once at startup before the rest of init(). */
export async function bootstrapAuth(): Promise<void> {
  initAuthUi();
  const user = await restoreAuthSession();
  if (user) {
    hideLoginModal();
    return;
  }
  showLoginModal();
  await requireAuthSession();
}
