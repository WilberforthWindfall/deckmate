// @ts-ignore
import React from 'react';
import { useState} from 'react';

//import { database } from './firebaseConfig';
import { firestore } from './firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface LoginProps {
  onLogin: (name: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!name || !password) {
      setError('Name und Passwort erforderlich');
      return;
    }

    const userRef = doc(firestore, 'players', name);
    const docSnap = await getDoc(userRef);

    if (docSnap.exists()) {
      const userData = docSnap.data();
      if (userData.password === password) {
        console.log(`✅ Login erfolgreich als ${name}`);
        onLogin(name);
      } else {
        setError('❌ Falsches Passwort');
      }
    } else {
      // Spieler neu anlegen
      await setDoc(userRef, { name, password });
      console.log(`🆕 Neuer Spieler erstellt: ${name}`);
      onLogin(name);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>🔐 Anmeldung</h2>
      <input
        type="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ marginBottom: 10, padding: 5 }}
      />
      <br />
      <input
        type="password"
        placeholder="Passwort"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ marginBottom: 10, padding: 5 }}
      />
      <br />
      <button onClick={handleLogin} style={{ padding: '8px 16px' }}>
        Einloggen / Registrieren
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
