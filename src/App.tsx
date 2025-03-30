// @ts-ignore
import React from 'react';
import { useState, useEffect } from 'react';
import Deckmate from './Deckmate';
import Login from './Login';
import Lobby from './Lobby';

export default function App() {
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);

  const handleLeaveGame = () => {
    setActiveGameId(null);
  };

  if (!playerName) {
    return <Login onLogin={setPlayerName} />;
  }

  if (!activeGameId) {
    return <Lobby playerName={playerName} onJoinGame={setActiveGameId} />;
  }

  return (
    <div>
      <Deckmate playerName={playerName} gameId={activeGameId} />
      <button
        onClick={handleLeaveGame}
        style={{ marginTop: '10px', padding: '8px', fontSize: '16px' }}
      >
        🔙 Zurück zur Lobby
      </button>
    </div>
  );
}
