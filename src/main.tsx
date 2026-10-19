import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.tsx';
import Login from './pages/Login.tsx';
import Lobby from './pages/Lobby.tsx';
import OnlineGame from './pages/OnlineGame.tsx';
import LocalGame from './pages/LocalGame.tsx';
import BattleTest from './pages/BattleTest.tsx';
import Campaign from './pages/Campaign.tsx';
import './styles.css';

function Protected({ children }: { children: JSX.Element }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="page"><p className="rule">Lade …</p></div>;
  return user ? children : <Login />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Protected><Lobby /></Protected>} />
          <Route path="/spiel/:id" element={<Protected><OnlineGame /></Protected>} />
          <Route path="/lokal" element={<LocalGame />} />
          <Route path="/schlacht" element={<BattleTest />} />
          <Route path="/kampagne" element={<Campaign />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
