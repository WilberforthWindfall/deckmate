// @ts-ignore
import React from 'react';
import { useState, useEffect } from 'react';

import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { firestore } from './firebaseConfig';

interface LobbyProps {
  playerName: string;
  onJoinGame: (gameId: string) => void;
}

export default function Lobby({ playerName, onJoinGame }: LobbyProps) {
  const [games, setGames] = useState<any[]>([]);
  const [newGameName, setNewGameName] = useState('');

  useEffect(() => {
    const gamesRef = collection(firestore, 'games');
    const unsubscribe = onSnapshot(gamesRef, (snapshot) => {
      const gamesList = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setGames(gamesList);
    });
    return () => unsubscribe();
  }, []);

  const handleCreateGame = async () => {
    if (!newGameName.trim()) return;
    if (games.length >= 10) {
      alert(
        'Maximale Anzahl von 10 Spielen erreicht. Bitte zuerst ein Spiel löschen.'
      );
      return;
    }
    const docRef = await addDoc(collection(firestore, 'games'), {
      name: newGameName,
      createdAt: new Date(),
    });
    onJoinGame(docRef.id);
  };

  const handleDeleteGame = async (gameId: string) => {
    if (confirm('Dieses Spiel wirklich löschen?')) {
      await deleteDoc(doc(firestore, 'games', gameId));
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>🧭 Lobby</h2>

      <div style={{ marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Spielname"
          value={newGameName}
          onChange={(e) => setNewGameName(e.target.value)}
          style={{ marginRight: 10, padding: 5 }}
        />
        <button onClick={handleCreateGame}>➕ Spiel erstellen</button>
      </div>

      <h3>🎮 Aktive Spiele:</h3>
      <ul>
        {games.map((game) => (
          <li key={game.id} style={{ marginBottom: 8 }}>
            {game.name}{' '}
            <button onClick={() => onJoinGame(game.id)}>Beitreten</button>{' '}
            <button
              onClick={() => handleDeleteGame(game.id)}
              style={{ marginLeft: 8, color: 'red' }}
            >
              ❌ Löschen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
