import React, { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { Login } from './components/Login';
import { Navigation } from './components/Navigation';
import { OnboardingWizard } from './components/OnboardingWizard';
import { SubscriptionOnboarding } from './components/SubscriptionOnboarding';
import { SubscriptionNudge } from './components/SubscriptionNudge';
import { NetworkTutorial } from './components/NetworkTutorial';
import { FloatingTourLauncher } from './components/FloatingTourLauncher';
import { DesktopControlCenter } from './components/DesktopControlCenter';
import { AskCasperProvider } from './components/AskCasperWidget';
import { ImageLightboxProvider } from './components/ImageLightbox';
import { updateDailyStreak } from './lib/achievements';
import { isRecentlyCreatedAccount, shouldShowOnboarding } from './lib/onboarding';
import { registerNativePush } from './lib/mobile';
import { supabase } from './supabase';
import { useSubscription } from './lib/subscription';

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

function SubscribePage() {
  const navigate = useNavigate();
  const { openCheckout } = useSubscription();
  return (
    <SubscriptionOnboarding
      variant="fullscreen"
      onClose={() => navigate('/')}
      onSelectPlan={async (tier, billing) => {
        if (tier === 'indie') {
          navigate('/');
          return;
        }
        await openCheckout(tier as 'operator' | 'architect', billing);
      }}
    />
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
    const createdRecently = isRecentlyCreatedAccount(currentUser.created_at);
    const isNewUser = shouldShowOnboarding({
      onboardingComplete: currentUser.onboarding_complete,
      createdAt: currentUser.created_at,
      dismissedMarker: localStorage.getItem(`bsc_onboarding_dismissed_${currentUser.id}`),
    });
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
      void processReferral(referralCode);
    }

    // Register this device for native push (Capacitor app only; no-op on web).
    void registerNativePush();
  }, [currentUser?.id]);

  // The whole award used to be five separate browser calls — look up the
  // referrer, check for an existing row, insert it, move both balances through
  // increment_counter, notify — so an interrupted run could pay out without
  // recording the referral, and the payout itself was forgeable. redeem_referral
  // claims the (unique) referrals row and moves both balances in one statement.
  const processReferral = async (referrerUsername: string) => {
    const { data, error } = await supabase.rpc('redeem_referral', {
      p_referrer_username: referrerUsername,
    });
    if (error) {
      console.error('[Referral] Processing error:', error.message);
      return;
    }
    const result = data as { ok?: boolean; reason?: string } | null;
    if (result && result.ok === false) {
      console.info('[Referral] Not applied:', result.reason);
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
        <SubscriptionNudge />
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
            <Route path="/subscribe" element={currentUser ? <SubscribePage /> : <Navigate to="/" replace />} />
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
            <Route path="/bots/mayhem" element={<AdminRoute><BotMayhemConsole /></AdminRoute>} />
            <Route path="/colosseum/replay/:matchId" element={<ColosseumReplay />} />
            <Route path="/colosseum/training" element={<Colosseum mode="training" />} />
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
