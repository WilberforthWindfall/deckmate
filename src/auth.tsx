import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword,
  signOut, updateProfile, type User,
} from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.ts';

interface AuthValue {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setReady(true); }), []);

  const value: AuthValue = {
    user, ready,
    login: async (email, password) => { await signInWithEmailAndPassword(auth, email, password); },
    register: async (email, password, name) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, 'users', cred.user.uid), { name, createdAt: serverTimestamp(), wins: 0, losses: 0 });
      setUser({ ...cred.user, displayName: name } as User);
    },
    resetPassword: async (email) => { await sendPasswordResetEmail(auth, email); },
    logout: () => signOut(auth),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth außerhalb des AuthProvider');
  return v;
}

export function authMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'Diese E-Mail-Adresse ist ungültig.',
    'auth/invalid-credential': 'E-Mail oder Passwort stimmen nicht.',
    'auth/wrong-password': 'E-Mail oder Passwort stimmen nicht.',
    'auth/user-not-found': 'E-Mail oder Passwort stimmen nicht.',
    'auth/email-already-in-use': 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.',
    'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
    'auth/too-many-requests': 'Zu viele Versuche. Warte kurz und versuche es erneut.',
    'auth/operation-not-allowed': 'Die Anmeldung per E-Mail ist in Firebase noch nicht aktiviert.',
    'auth/network-request-failed': 'Keine Verbindung. Prüfe dein Internet.',
  };
  return map[code] ?? 'Das hat nicht geklappt. Versuche es erneut.';
}
