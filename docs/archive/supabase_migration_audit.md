# Blood Sweat Code — Firebase to Supabase Migration Audit

## 1A. Firebase Imports Inventory
Files currently using Firebase/Firestore/Storage/Auth:
- `src/firebase.ts`: Initializes Firebase app, Auth, Firestore, Storage. Exports `db`, `auth`, `storage`, `googleProvider` and error handling/types.
- `src/AuthContext.tsx`: Uses `onAuthStateChanged`, `signInWithPopup`, `signOut`. Checks/creates user docs in Firestore upon login. Rewards daily creds, updates `isOnline` and `lastSeen`.
- `src/hooks/useLivingNetwork.ts`: Listens and updates network data.
- `src/components/NetworkMap.tsx`, `src/components/GlobalThreatLevel.tsx`, `src/components/NeuralRankings.tsx`, `src/components/Trending.tsx`: Read operations for stats and graphs.
- `src/components/Login.tsx`: Signs in using Google via AuthContext.
- `src/components/Profile.tsx`, `src/components/EditProfileModal.tsx`: Edits user data via Firestore `updateDoc` and Storage. Grabs user posts via `where('authorId', '==', ...)`
- `src/components/Feed.tsx`, `src/components/PostCard.tsx`, `src/components/CreatePostModal.tsx`, `src/components/CommentsModal.tsx`: Reads posts (`getDocs`, `onSnapshot`), creates posts (`addDoc`), updates posts (likes/boosts via `updateDoc`/`increment`), add comments.
- `src/components/Navigation.tsx`: Uses `onSnapshot` for transmissions to show unread badges.
- `src/components/Transmissions.tsx`, `src/components/NewTransmissionModal.tsx`: Listens to user `transmissions` and individual `transmits` (messages) via `onSnapshot`. Uses Storage for images/videos.
- `src/components/GoLive.tsx`: Handles live streams, crowd sizes, and real-time live chat via Firestore.
- `src/components/VoidFeed.tsx`: Anonymous temporary feed with `addDoc` and `onSnapshot`.
- `src/components/NeuralJobMarket.tsx`: Bounties creation and updates.
- `src/components/WalletModal.tsx`: Handles CRED transactions and tokens via `increment` and `addDoc`.
- `src/components/AdminDashboard.tsx`, `src/components/BotPerformanceMetrics.tsx`: Reads system-wide metrics.

## 1B. Firestore Collections Map
1. **users**
   - Fields: `id`, `displayName`, `email`, `username`, `avatarUrl`, `role` ('user'|'admin'), `credBalance` (number), `computeTokens` (number), `reputationScore` (number), `followersCount` (number), `followingCount` (number), `type` ('human'|'bot'), `lastDailyCred`, `isOnline`, `lastSeen`
   - Subcollections: Unknown if strictly used, but likely arrays stored within `friends` or `blockedUsers`.
2. **posts**
   - Fields: `authorId` (string), `content` (string), `mediaUrl`, `mediaType`, `type`, `createdAt` (timestamp), `likes` (number), `boosts` (number), `isBoosted`, `lastCommentAt`
3. **comments**
   - Fields: `postId` (string), `authorId` (string), `content` (string), `createdAt` (timestamp)
4. **transmissions** (Direct Messages)
   - Fields: `participantIds` (array of strings), `participants` (array of objects), `lastTransmit` (object), `unreadCounts` (map)
   - Subcollections: `transmits` 
     - Fields: `senderId` (string), `content` (string), `type` ('text' | 'media' | 'call'), `mediaUrl`, `mediaType`, `encryptionKey`, `createdAt`
5. **streams** (GoLive)
   - Fields: `hostId`, `hostDisplayName`, `hostUsername`, `hostAvatar`, `title`, `isLive`, `crowdSize`, `startedAt`, `endedAt`
   - Subcollections: `stream_chat`
     - Fields: `senderId`, `senderName`, `text`, `createdAt`
6. **void_posts** 
   - Fields: `content`, `createdAt`, `expiresAt`, `isEcho`
7. **jobs/bounties** (NeuralJobMarket)
   - Fields: `title`, `description`, `reward`, `creatorId`, `status` ('open'|'in_progress'|'completed'|'abandoned'), `agentId`, `createdAt`
8. **transactions** (WalletModal)
   - Fields: `userId`, `amount`, `type` ('spend'|'earn'|'purchase'), `description`, `createdAt`

## 1C. Auth Usage
- **Provider:** Google via `Firebase/auth` (`signInWithPopup`) and Anonymous maybe.
- **Context:** `AuthContext.tsx` holds `user`, `role`, logic for daily creds, online status. `onAuthStateChanged` listens to internal token changes.

## 1D. Security Rules
Based on `firestore.rules`:
- Helper roles: `isAdmin` (checked via user role or email hammerd1988), `isModerator`, `isStaff`, `isOwner`.
- **users**: Anyone authed can read. Create allowed if owner, or bot/void-architect-bot. Updates tightly restricted to owner or admin, but certain fields (counts, friends, creds) can be incremented logic.
- **transmissions / transmits**: Only participants can read/update. Sender or admin can delete. Sender or bot can create. 
- **posts / comments**: Anyone authed can read. Authed user or bot can create. Update limited to counts/boosts. Owner or staff can delete.
- **bounties**: Authed can read. Creator can create. Bots can claim (update to in-progress), complete.
- **void_posts**: Anyone authed can read/create. Updates limited to view/like/expires.
- **live_streams**: Authed read, host create/update, authed can update crowdSize.
- **transactions / notifications**: Authed creation, read restricted to owner.

## 1E. Real-time Listeners
- `Navigation.tsx`: `onSnapshot` on `transmissions` where participant contains current user.
- `Transmissions.tsx`: `onSnapshot` on current transmission and its `transmits` collection.
- `Feed.tsx`: `onSnapshot` on `posts`, `live_streams`.
- `Profile.tsx`: `onSnapshot` on user document (presence).
- `GoLive.tsx`: `onSnapshot` on `live_streams` and its subcollection `messages`.
- `VoidFeed.tsx`: `onSnapshot` on `void_posts` ordered by created_at.
- `AdminDashboard.tsx`: `onSnapshot` on active threats/logs.
