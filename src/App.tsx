import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Login } from './components/Login';
import { Navigation } from './components/Navigation';
import { OnboardingWizard } from './components/OnboardingWizard';
import { NetworkTutorial } from './components/NetworkTutorial';
import { FloatingTourLauncher } from './components/FloatingTourLauncher';
import { DesktopControlCenter } from './components/DesktopControlCenter';
import { AskCasperProvider } from './components/AskCasperWidget';
import { ImageLightboxProvider } from './components/ImageLightbox';
import { updateDailyStreak } from './lib/achievements';
import { registerNativePush } from './lib/mobile';
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
const ColosseumReplay = lazy(() => import('./components/ColosseumReplay').then((m) => ({ default: m.ColosseumReplay })));
const Factions = lazy(() => import('./components/Factions').then((m) => ({ default: m.Factions })));
const FactionDetail = lazy(() => import('./components/FactionDetail').then((m) => ({ default: m.FactionDetail })));
const SubscriptionSettings = lazy(() => import('./components/SubscriptionSettings').then((m) => ({ default: m.SubscriptionSettings })));
const BotForge = lazy(() => import('./components/BotForge').then((m) => ({ default: m.BotForge })));
const BotMayhemConsole = lazy(() => import('./components/BotMayhemConsole').then((m) => ({ default: m.BotMayhemConsole })));
const BotChat = lazy(() => import('./components/BotChat').then((m) => ({ default: m.BotChat })));
const CasperRemoteOps = lazy(() => import('./components/CasperRemoteOps').then((m) => ({ default: m.CasperRemoteOps })));
const CasperCommandIndex = lazy(() => import('./components/CasperCommandIndex').then((m) => ({ default: m.CasperCommandIndex })));

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
  const dismissedOnboardingKey = currentUser ? `bsc_onboarding_dismissed_${currentUser.id}` : null;

  // On login: check if onboarding needed, update streak, process referral
  useEffect(() => {
    if (!currentUser) return;

    // Show onboarding for recently created accounts that have not completed it.
    const createdRecently = currentUser.created_at && (Date.now() - new Date(currentUser.created_at).getTime()) < 24 * 60 * 60 * 1000;
    const isNewUser = currentUser.onboarding_complete === false &&
      createdRecently &&
      !localStorage.getItem(`bsc_onboarding_dismissed_${currentUser.id}`);
    if (isNewUser) {
      setShowOnboarding(true);
    } else {
      const tutorialKey = `bsc_network_tutorial_seen_${currentUser.id}`;
      if (createdRecently && !showOnboarding && !localStorage.getItem(tutorialKey)) {
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

    // Register this device for native push (Capacitor app only; no-op on web).
    void registerNativePush();
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
        <Route path="/colosseum/replay/:matchId" element={<Suspense fallback={<LoadingScreen />}><ColosseumReplay /></Suspense>} />
        {/* Public stream viewer — anyone with a ?streamId link can watch */}
        <Route path="/golive" element={<GoLive />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <AskCasperProvider>
    <ImageLightboxProvider>
    <div className="bsc-classic-stage min-h-screen bg-background text-foreground">
      <div className="bsc-rift bsc-rift-a" />
      <div className="bsc-rift bsc-rift-b" />
      {/* Onboarding wizard for new users */}
      {showOnboarding && (
        <OnboardingWizard onComplete={() => {
          if (dismissedOnboardingKey) localStorage.setItem(dismissedOnboardingKey, new Date().toISOString());
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

      <main className="relative z-10 pt-safe pb-app-shell">
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
            <Route
              path="/terminal"
              element={
                <AdminRoute>
                  <BotTerminal />
                </AdminRoute>
              }
            />
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
                currentUser ? <CasperDashboard /> : <Navigate to="/" replace />
              }
            />
            <Route path="/profile/:username" element={<Profile />} />
            <Route path="/casper" element={<Casper />} />
            <Route path="/casper/studio" element={<ContentCreationStudio />} />
            <Route path="/casper/remote" element={currentUser ? <CasperRemoteOps /> : <Navigate to="/" replace />} />
            <Route path="/casper/commands" element={currentUser ? <CasperCommandIndex /> : <Navigate to="/" replace />} />
            <Route path="/bots" element={<BotMarketplace />} />
            <Route path="/bots/mayhem" element={<BotMayhemConsole />} />
            <Route path="/colosseum/replay/:matchId" element={<ColosseumReplay />} />
            <Route path="/colosseum" element={<Colosseum />} />
            <Route path="/colosseum/forge" element={<BotForge />} />
            <Route path="/bot/chat" element={<BotChat />} />
            <Route path="/factions" element={<Factions />} />
            <Route path="/factions/:slug" element={<FactionDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <FloatingTourLauncher />
      <DesktopControlCenter />
      <Navigation />
    </div>
    </ImageLightboxProvider>
    </AskCasperProvider>
  );
}
