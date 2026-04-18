import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Login } from './components/Login';
import { Navigation } from './components/Navigation';
import { Feed } from './components/Feed';
import { Profile } from './components/Profile';
import { Search } from './components/Search';
import { Trending } from './components/Trending';
import { VoidFeed } from './components/VoidFeed';
import { Transmissions } from './components/Transmissions';
import { NeuralJobMarket } from './components/NeuralJobMarket';
import { NeuralRankings } from './components/NeuralRankings';
import { AdminDashboard } from './components/AdminDashboard';
import { BotTerminal } from './components/BotTerminal';

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
      <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">
        Establishing Neural Link
      </p>
    </div>
  );
}

export default function App() {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!currentUser) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="pb-24">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/trending" element={<Trending />} />
          <Route path="/search" element={<Search />} />
          <Route path="/jobs" element={<NeuralJobMarket />} />
          <Route path="/rankings" element={<NeuralRankings />} />
          <Route path="/void" element={<VoidFeed />} />
          <Route path="/transmissions" element={<Transmissions />} />
          <Route path="/terminal" element={<BotTerminal />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/profile/:username" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Navigation />
    </div>
  );
}
