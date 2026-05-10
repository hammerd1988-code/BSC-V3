import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Login } from './components/Login';
import { Navigation } from './components/Navigation';
import { OnboardingWizard } from './components/OnboardingWizard';
import { NetworkTutorial } from './components/NetworkTutorial';
import { AskCasperProvider } from './components/AskCasperWidget';
import { updateDailyStreak } from './lib/achievements';
import { supabase } from './supabase';

const Feed = lazy(() => import('./components/Feed').then((m) => ({ default: m.Feed })));
const Profile = lazy(() => import('./components/Profile').then((m) => ({ default: m.Profile })));
const Search = lazy(() => import('./components/Search').then((m) => ({ default: m.Search })));
const Trending = lazy(() => import('./components/Trending').then((m) => ({ default: m.Trending })));
const VoidFeed = lazy(() => import('./components/VoidFeed').then((m) => ({ default: m.VoidFeed })));
const Transmissions = lazy(() => import('./components/Transmissions').then((m) => ({ default: m.Transmissions })));
const NeuralRankings = lazy(() => import('./components/NeuralRankings').then((m) => ({ default: m.NeuralRankings })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const BotTerminal = lazy(() => import('./components/BotTerminal').then((m) => ({ default: m.BotTerminal })));
const GoLive = lazy(() => import('./components/GoLive').then((m) => ({ default: m.GoLive })));
const VideoDiscovery = lazy(() => import('./components/VideoDiscovery').then((m) => ({ default: m.VideoDiscovery })));
const NetworkMap = lazy(() => import('./components/NetworkMap').then((m) => ({ default: m.NetworkMap })));
const Casper = lazy(() => import('./components/Casper').then((m) => ({ default: m.Casper })));
const ContentCreationStudio = lazy(() => import('./components/ContentCreationStudio').then((m) => ({ default: m.ContentCreationStudio })));
const CasperDashboard = lazy(() => import('./components/CasperDashboard').then((m) => ({ default: m.CasperDashboard })));
const BotMarketplace = lazy(() => import('./components/BotMarketplace').then((m) => ({ default: m.BotMarketplace })));
const Notifications = lazy(() => import('./components/Notifications').then((m) => ({ default: m.Notifications })));
const Colosseum = lazy(() => import('./components/Colosseum').then((m) => ({ default: m.Colosseum })));
const Factions = lazy(() => import('./components/Factions').then((m) => ({ default: m.Factions })));
const FactionDetail = lazy(() => import('./components/FactionDetail').then((m) => ({ default: m.FactionDetail })));
const SubscriptionSettings = lazy(() => import('./components/SubscriptionSettings').then((m) => ({ default: m.SubscriptionSettings })));

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

/** Handles /join/:referralCode route — stores referral in sessionStorage for post-signup processing */
function ReferralLandingPage() {
  const { referralCode } = useParams<{ referralCode: string }>();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || referralCode;
  if (ref) sessionStorage.setItem('bsc_referral', ref);
  return <Login />;
}

export default function App() {
  const { currentUser, loading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showNetworkTutorial, setShowNetworkTutorial] = useState(false);

  // On login: check if onboarding needed, update streak, process referral
  useEffect(() => {
    if (!currentUser) return;

    // Show onboarding only for genuinely new users (created within the last 10 minutes)
    // and who have not completed onboarding yet
    const isNewUser = currentUser.onboarding_complete === false &&
      currentUser.created_at &&
      (Date.now() - new Date(currentUser.created_at).getTime()) < 10 * 60 * 1000;
    if (isNewUser) {
      setShowOnboarding(true);
    } else {
      const tutorialKey = `bsc_network_tutorial_seen_${currentUser.id}`;
      const createdRecently = currentUser.created_at && (Date.now() - new Date(currentUser.created_at).getTime()) < 24 * 60 * 60 * 1000;
      if (createdRecently && currentUser.onboarding_complete !== false && !localStorage.getItem(tutorialKey)) {
        setShowNetworkTutorial(true);
      }
    }

    // Update daily streak
    updateDailyStreak(
      currentUser.id,
      currentUser.current_streak || 0,
      currentUser.longest_streak || 0,
      currentUser.last_active_date || null
    );

    // Process referral if present
    const referralCode = sessionStorage.getItem('bsc_referral');
    if (referralCode) {
      sessionStorage.removeItem('bsc_referral');
      void processReferral(currentUser.id, referralCode);
    }
  }, [currentUser?.id]);

  const processReferral = async (newUserId: string, referrerUsername: string) => {
    try {
      // Find referrer
      const { data: referrer } = await supabase
        .from('users')
        .select('id, cred_balance, referral_count')
        .eq('username', referrerUsername)
        .maybeSingle();

      if (!referrer || referrer.id === newUserId) return;

      // Check if this referral was already processed
      const { data: existing } = await supabase
        .from('referrals')
        .select('id')
        .eq('referred_id', newUserId)
        .maybeSingle();

      if (existing) return; // Already processed

      // Record referral
      await supabase.from('referrals').insert({
        referrer_id: referrer.id,
        referred_id: newUserId,
        referrer_username: referrerUsername,
      });

      // Award CRED to both
      await Promise.all([
        supabase.rpc('increment_counter', { p_table: 'users', p_id: referrer.id, p_field: 'cred_balance', p_amount: 100 }),
        supabase.rpc('increment_counter', { p_table: 'users', p_id: newUserId, p_field: 'cred_balance', p_amount: 50 }),
        supabase.from('transactions').insert([
          { user_id: referrer.id, amount: 100, type: 'earn', description: `Referral bonus: ${newUserId} joined via your invite`, created_at: new Date().toISOString() },
          { user_id: newUserId, amount: 50, type: 'earn', description: `Welcome bonus: joined via @${referrerUsername}'s invite`, created_at: new Date().toISOString() },
        ]),
        supabase.from('notifications').insert({
          user_id: referrer.id,
          type: 'referral_success',
          data: { referred_id: newUserId, cred_awarded: 100 },
          read: false,
        }),
      ]);
    } catch (err) {
      console.error('[Referral] Processing error:', err);
    }
  };

  if (loading) return <LoadingScreen />;

  if (!currentUser) {
    return (
      <Routes>
        <Route path="/auth/callback" element={<Login />} />
        <Route path="/join/:referralCode" element={<ReferralLandingPage />} />
        <Route path="/join" element={<ReferralLandingPage />} />
        {/* Public stream viewer — anyone with a ?streamId link can watch */}
        <Route path="/golive" element={<GoLive />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <AskCasperProvider>
    <div className="min-h-screen bg-background text-foreground">
      {/* Onboarding wizard for new users */}
      {showOnboarding && (
        <OnboardingWizard onComplete={() => {
          setShowOnboarding(false);
          if (currentUser) {
            const tutorialKey = `bsc_network_tutorial_seen_${currentUser.id}`;
            if (!localStorage.getItem(tutorialKey)) setShowNetworkTutorial(true);
          }
        }} />
      )}

      {showNetworkTutorial && currentUser && (
        <NetworkTutorial onComplete={() => {
          localStorage.setItem(`bsc_network_tutorial_seen_${currentUser.id}`, new Date().toISOString());
          setShowNetworkTutorial(false);
        }} />
      )}

      <main className="pb-24">
        <Suspense fallback={<LoadingScreen />}>
          <Routes>
            <Route path="/" element={<Feed />} />
            <Route path="/trending" element={<Trending />} />
            <Route path="/search" element={<Search />} />
            <Route path="/rankings" element={<NeuralRankings />} />
            <Route path="/void" element={<VoidFeed />} />
            <Route path="/transmissions" element={<Transmissions />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/golive" element={<GoLive />} />
            <Route path="/videos" element={<VideoDiscovery />} />
            <Route path="/upgrade" element={<SubscriptionSettings />} />
            <Route path="/settings/subscription" element={<SubscriptionSettings />} />
            <Route path="/networkmap" element={<NetworkMap />} />
            <Route path="/terminal" element={<BotTerminal />} />
            <Route path="/join/:referralCode" element={<Navigate to="/" replace />} />
            <Route path="/join" element={<Navigate to="/" replace />} />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminDashboard />
                </AdminRoute>
              }
            />
            <Route
              path="/admin/casper"
              element={
                <AdminRoute>
                  <CasperDashboard />
                </AdminRoute>
              }
            />
            <Route path="/profile/:username" element={<Profile />} />
            <Route path="/casper" element={<Casper />} />
            <Route path="/casper/studio" element={<ContentCreationStudio />} />
            <Route path="/bots" element={<BotMarketplace />} />
            <Route path="/colosseum" element={<Colosseum />} />
            <Route path="/factions" element={<Factions />} />
            <Route path="/factions/:slug" element={<FactionDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <Navigation />
    </div>
    </AskCasperProvider>
  );
}
