import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
// Always-visible: login + nav must not be lazy
import { Login } from './components/Login';
import { Navigation } from './components/Navigation';

// Lazy-loaded page components — each gets its own JS chunk
const Feed = lazy(() => import('./components/Feed').then((m) => ({ default: m.Feed })));
const Profile = lazy(() => import('./components/Profile').then((m) => ({ default: m.Profile })));
const Search = lazy(() => import('./components/Search').then((m) => ({ default: m.Search })));
const Trending = lazy(() => import('./components/Trending').then((m) => ({ default: m.Trending })));
const VoidFeed = lazy(() => import('./components/VoidFeed').then((m) => ({ default: m.VoidFeed })));
const Transmissions = lazy(() => import('./components/Transmissions').then((m) => ({ default: m.Transmissions })));
const NeuralJobMarket = lazy(() => import('./components/NeuralJobMarket').then((m) => ({ default: m.NeuralJobMarket })));
const NeuralRankings = lazy(() => import('./components/NeuralRankings').then((m) => ({ default: m.NeuralRankings })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const BotTerminal = lazy(() => import('./components/BotTerminal').then((m) => ({ default: m.BotTerminal })));

/** Route-level guard: redirects non-admins before AdminDashboard even loads. */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/" replace />;
  if (currentUser.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

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
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/trending" element={<Trending />} />
            <Route path="/search" element={<Search />} />
            <Route path="/jobs" element={<NeuralJobMarket />} />
            <Route path="/rankings" element={<NeuralRankings />} />
            <Route path="/void" element={<VoidFeed />} />
            <Route path="/transmissions" element={<Transmissions />} />
            <Route path="/terminal" element={<BotTerminal />} />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
            <Route path="/profile/:username" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Navigation />
    </div>
  );
}
