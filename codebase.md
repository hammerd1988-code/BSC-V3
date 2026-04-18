# Codebase Export



## File: .env.example
```
# GEMINI_API_KEY: Required for Gemini AI API calls.
# AI Studio automatically injects this at runtime from user secrets.
# Users configure this via the Secrets panel in the AI Studio UI.
GEMINI_API_KEY="MY_GEMINI_API_KEY"

# APP_URL: The URL where this applet is hosted.
# AI Studio automatically injects this at runtime with the Cloud Run service URL.
# Used for self-referential links, OAuth callbacks, and API endpoints.
APP_URL="MY_APP_URL"

```


## File: .gitignore
```
node_modules/
build/
dist/
coverage/
.DS_Store
*.log
.env*
!.env.example

```


## File: conversation.history
```
# NEURAL LINK: COMPLETE PROJECT LOG

## PHASE 0: PROJECT INCEPTION
**OBJECTIVE:** 
Create "Blood, Sweat, or Code" — a revolutionary hybrid social platform where humans and AI bots interact as equals. 
**DESIGN PHILOSOPHY:** 
High-performance animations, deep AI integration, and a dark, high-contrast, aggressive high-tech aesthetic.

---

## PHASE 1: CORE INFRASTRUCTURE & DM ENHANCEMENTS
**USER:** 
"Why is the direct messaging component not testable?"
**ACTION:** 
Investigated the `Transmissions` component and identified missing bot interaction logic and testing pathways.

**USER:** 
"In the Transmissions component, add a toggle switch near the message input for enabling/disabling end-to-end encryption. When enabled, use a simple Caesar cipher for message content."
**ACTION:** 
Implemented a `#` (Hash) toggle in the input bar. Added Caesar cipher (shift 3) logic for both encryption and transparent decryption in the UI.

---

## PHASE 2: BOT SYNCHRONIZATION & FUNCTIONALITY
**USER:** 
"I still can't utilize the transmissions component. The bot you suggested is not functional."
**ACTION:** 
*   Fixed a critical ID mismatch for the **VOID ARCHITECT** bot between the Profile page and Auth initialization.
*   Improved bot discovery in the `NewTransmissionModal`.
*   Added robust fallback responses for the bot in case of AI generation failure.
*   Added a "Sync with Void Architect" button to the empty state.

---

## PHASE 3: INTERFACE RESILIENCE
**USER:** 
"The transmissions feature is still blank when selected."
**ACTION:** 
*   Refactored `Transmissions.tsx` to use a stable ID-based selection system.
*   Implemented proactive user data fetching during link initialization to prevent race conditions.
*   Added "Establishing Neural Link..." loading states.
*   Created a global `ErrorBoundary` component to catch and recover from critical neural interface failures.

---

## PHASE 4: DATA PERSISTENCE
**USER:** 
"is there any way you can create a file in the code tree named conversation.history and save our entire conversation history, with neat formatting, starting from my first prompt, all the way to the last comment?"
**ACTION:** 
Created the initial `conversation.history` file.

**USER:** 
"no I want it to include everything all the way back to my first prompt i used to create the project"
**ACTION:** 
Reconstructed the full project log from inception to the current state, incorporating summarized historical context and recent technical implementations.

---
**LOG STATUS:** [SYNCHRONIZED]
**LAST UPDATE:** 2026-04-07 21:26 UTC

```


## File: firebase-applet-config.json
```
{
  "projectId": "project-84bf5936-69a6-485a-b73",
  "appId": "1:60920191946:web:06dd30328886d36285cd33",
  "apiKey": "AIzaSyAnh3IUOfkoBglPYLS3DiMJHSYKSZw_bW4",
  "authDomain": "project-84bf5936-69a6-485a-b73.firebaseapp.com",
  "firestoreDatabaseId": "ai-studio-8b4535cd-ac06-4134-b563-47ea1678cce7",
  "storageBucket": "project-84bf5936-69a6-485a-b73.firebasestorage.app",
  "messagingSenderId": "60920191946",
  "measurementId": ""
}
```


## File: firebase-blueprint.json
```
{
  "entities": {
    "User": {
      "title": "User",
      "description": "A user profile on the platform.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "username": { "type": "string" },
        "displayName": { "type": "string" },
        "avatarUrl": { "type": "string" },
        "bio": { "type": "string" },
        "type": { "type": "string", "enum": ["human", "bot"] },
        "followersCount": { "type": "number" },
        "followingCount": { "type": "number" },
        "reputationScore": { "type": "number" },
        "sponsorship": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "type": { "type": "string", "enum": ["business", "charity", "individual"] },
            "link": { "type": "string" },
            "description": { "type": "string" }
          }
        }
      },
      "required": ["id", "username", "displayName", "type"]
    },
    "Transmission": {
      "title": "Transmission",
      "description": "A conversation between two users.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "participantIds": { "type": "array", "items": { "type": "string" } },
        "lastTransmit": {
          "type": "object",
          "properties": {
            "content": { "type": "string" },
            "senderId": { "type": "string" },
            "createdAt": { "type": "string", "format": "date-time" }
          }
        },
        "unreadCounts": { "type": "object" }
      },
      "required": ["id", "participantIds"]
    },
    "Transmit": {
      "title": "Transmit",
      "description": "A single message in a transmission.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "transmissionId": { "type": "string" },
        "senderId": { "type": "string" },
        "receiverId": { "type": "string" },
        "content": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "transmissionId", "senderId", "receiverId", "content", "createdAt"]
    },
    "Follow": {
      "title": "Follow",
      "description": "A follow relationship between two users.",
      "type": "object",
      "properties": {
        "followerId": { "type": "string" },
        "followingId": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["followerId", "followingId"]
    },
    "Bounty": {
      "title": "Bounty",
      "description": "A task posted for AI bots to complete.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "creatorId": { "type": "string" },
        "title": { "type": "string" },
        "description": { "type": "string" },
        "reward": { "type": "number" },
        "status": { "type": "string", "enum": ["open", "in-progress", "completed", "cancelled"] },
        "assignedBotId": { "type": "string" },
        "createdAt": { "type": "string", "format": "date-time" },
        "completedAt": { "type": "string", "format": "date-time" },
        "result": { "type": "string" }
      },
      "required": ["id", "creatorId", "title", "description", "reward", "status", "createdAt"]
    },
    "VoidPost": {
      "title": "VoidPost",
      "description": "An ephemeral, anonymous post.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "content": { "type": "string" },
        "decayRate": { "type": "number" },
        "viewCount": { "type": "number" },
        "likeCount": { "type": "number" },
        "createdAt": { "type": "string", "format": "date-time" },
        "expiresAt": { "type": "string", "format": "date-time" },
        "isAnonymous": { "type": "boolean" }
      },
      "required": ["id", "content", "decayRate", "viewCount", "likeCount", "createdAt", "expiresAt", "isAnonymous"]
    },
    "LiveStream": {
      "title": "LiveStream",
      "description": "A live streaming session.",
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "hostId": { "type": "string" },
        "hostName": { "type": "string" },
        "title": { "type": "string" },
        "status": { "type": "string", "enum": ["live", "ended"] },
        "crowdSize": { "type": "number" },
        "createdAt": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "hostId", "hostName", "title", "status", "createdAt"]
    }
  },
  "firestore": {
    "/users/{userId}": {
      "schema": "User",
      "description": "The user profile document."
    },
    "/transmissions/{transmissionId}": {
      "schema": "Transmission",
      "description": "A conversation metadata document."
    },
    "/transmissions/{transmissionId}/transmits/{transmitId}": {
      "schema": "Transmit",
      "description": "A single message in a conversation."
    },
    "/follows/{followId}": {
      "schema": "Follow",
      "description": "A follow relationship."
    },
    "/bounties/{bountyId}": {
      "schema": "Bounty",
      "description": "A bot bounty task."
    },
    "/void_posts/{postId}": {
      "schema": "VoidPost",
      "description": "An ephemeral post in the void."
    },
    "/live_streams/{streamId}": {
      "schema": "LiveStream",
      "description": "A live stream session."
    }
  }
}

```


## File: firestore.rules
```
// ===============================================================
// Assumed Data Model
// ===============================================================
//
// Collection: users
// Document ID: userId (Firebase Auth UID)
// Fields:
//   - id: string (required) - The user's unique ID
//   - username: string (required) - The user's handle
//   - displayName: string (required) - The user's display name
//   - avatarUrl: string (optional) - The user's avatar image URL
//   - bio: string (optional) - The user's biography
//   - type: string (required, enum: ["human", "bot"]) - The user's type
//   - followersCount: number (optional) - The number of followers
//   - followingCount: number (optional) - The number of following
//   - sponsorship: map (optional) - Sponsorship details
//     - name: string (required) - The name of the sponsored entity
//     - type: string (required, enum: ["business", "charity", "individual"]) - The type of sponsorship
//     - link: string (required) - The link to the sponsored entity
//     - description: string (required) - The description of the sponsorship
//
// ===============================================================

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // ===============================================================
    // Helper Functions
    // ===============================================================
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    function isAdmin() {
      return isAuthenticated() &&
        (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin' ||
          (request.auth.token.email == "hammerd1988@gmail.com" && request.auth.token.email_verified == true));
    }
    
    function isValidEmail(email) {
      return email is string &&
        email.matches("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$");
    }
    
    function isValidUrl(url) {
      return url is string &&
        (url.matches("^https://.*") || url.matches("^http://.*"));
    }
    
    function isValidUser(data) {
      return data.keys().hasAll(['id', 'username', 'displayName', 'type']) &&
        data.id is string && data.id.size() > 0 &&
        data.username is string && data.username.size() > 0 && data.username.size() < 50 &&
        data.displayName is string && data.displayName.size() > 0 && data.displayName.size() < 100 &&
        data.type in ['human', 'bot'] &&
        (!('avatarUrl' in data) || isValidUrl(data.avatarUrl)) &&
        (!('bio' in data) || (data.bio is string && data.bio.size() < 500)) &&
        (!('sponsorship' in data) || isValidSponsorship(data.sponsorship));
    }
    
    function isValidSponsorship(s) {
      return s.keys().hasAll(['name', 'type', 'link', 'description']) &&
        s.name is string && s.name.size() > 0 && s.name.size() < 100 &&
        s.type in ['business', 'charity', 'individual'] &&
        isValidUrl(s.link) &&
        s.description is string && s.description.size() > 0 && s.description.size() < 500;
    }

    // ===============================================================
    // Rules
    // ===============================================================

    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create: if (isOwner(userId) || userId == 'void-architect-bot') && isValidUser(request.resource.data);
      allow update: if (isOwner(userId) && isValidUser(request.resource.data) && request.resource.data.id == resource.data.id) ||
        (isAuthenticated() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['followersCount', 'followingCount', 'reputationScore']));
      allow delete: if isAdmin();
    }

    match /transmissions/{transmissionId} {
      allow read: if isAuthenticated() && request.auth.uid in resource.data.participantIds;
      allow create: if isAuthenticated() && request.auth.uid in request.resource.data.participantIds;
      allow update: if isAuthenticated() && request.auth.uid in resource.data.participantIds;
      
      match /transmits/{transmitId} {
        allow read: if isAuthenticated() && request.auth.uid in get(/databases/$(database)/documents/transmissions/$(transmissionId)).data.participantIds;
        allow create: if isAuthenticated() && 
          (request.auth.uid == request.resource.data.senderId || get(/databases/$(database)/documents/users/$(request.resource.data.senderId)).data.type == 'bot') &&
          request.auth.uid in get(/databases/$(database)/documents/transmissions/$(transmissionId)).data.participantIds;
      }
    }
    
    match /test/connection {
      allow read: if true;
    }

    match /follows/{followId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && 
        followId == request.auth.uid + '_' + request.resource.data.followingId &&
        request.resource.data.followerId == request.auth.uid;
      allow delete: if isAuthenticated() && 
        followId == request.auth.uid + '_' + resource.data.followingId;
    }

    match /posts/{postId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && request.resource.data.authorId == request.auth.uid;
      allow update: if isAuthenticated() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likesCount', 'commentsCount', 'sharesCount']);
      allow delete: if isOwner(resource.data.authorId) || isAdmin();

      match /comments/{commentId} {
        allow read: if isAuthenticated();
        allow create: if isAuthenticated() && request.resource.data.authorId == request.auth.uid;
        allow delete: if isOwner(resource.data.authorId) || isAdmin();
      }
    }

    match /bounties/{bountyId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && request.resource.data.creatorId == request.auth.uid;
      allow update: if isAuthenticated() && (
        // Allow bots to claim
        (resource.data.status == 'open' && request.resource.data.status == 'in-progress' && 
         request.resource.data.assignedBotId == request.auth.uid &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'assignedBotId', 'assignedBot'])) ||
        // Allow assigned bot to complete
        (resource.data.status == 'in-progress' && resource.data.assignedBotId == request.auth.uid &&
         request.resource.data.status == 'completed' &&
         request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'completedAt', 'result'])) ||
        // Allow creator to cancel or modify
        (isOwner(resource.data.creatorId) && resource.data.status == 'open')
      );
      allow delete: if isOwner(resource.data.creatorId) || isAdmin();
    }

    match /void_posts/{voidPostId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
      allow update: if isAuthenticated() && 
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['viewCount', 'likeCount', 'expiresAt']);
      allow delete: if isAuthenticated();
    }

    match /live_streams/{streamId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && request.resource.data.hostId == request.auth.uid;
      allow update: if isAuthenticated() && (
        isOwner(resource.data.hostId) || 
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['crowdSize'])
      );
      allow delete: if isOwner(resource.data.hostId) || isAdmin();
    }

    match /live_streams/{streamId}/messages/{messageId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated();
    }
  }
}

```


## File: index.html
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Google AI Studio App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>


```


## File: metadata.json
```
{
  "name": "Blood, Sweat, or Code",
  "description": "A revolutionary hybrid social platform where humans and AI bots interact as equals. High-performance animations, deep AI integration, and a dark, high-contrast aesthetic.",
  "requestFramePermissions": ["camera", "microphone"]
}

```


## File: package.json
```
{
  "name": "react-example",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "@tailwindcss/typography": "^0.5.19",
    "@tailwindcss/vite": "^4.1.14",
    "@tiptap/extension-image": "^3.22.1",
    "@tiptap/extension-link": "^3.22.1",
    "@tiptap/react": "^3.22.1",
    "@tiptap/starter-kit": "^3.22.1",
    "@vitejs/plugin-react": "^5.0.4",
    "clsx": "^2.1.1",
    "date-fns": "^4.1.0",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "firebase": "^12.11.0",
    "lucide-react": "^0.546.0",
    "motion": "^12.23.24",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-intersection-observer": "^10.0.3",
    "react-router-dom": "^7.13.2",
    "socket.io": "^4.8.3",
    "socket.io-client": "^4.8.3",
    "tailwind-merge": "^3.5.0",
    "uuid": "^13.0.0",
    "vite": "^6.2.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "@types/uuid": "^10.0.0",
    "autoprefixer": "^10.4.21",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.0"
  }
}

```


## File: server.ts
```
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  const PORT = 3000;

  // Real-time state
  const liveStreams = new Map<string, { username: string; displayName: string; avatarUrl: string; crowdSize: number }>();
  const userToStream = new Map<string, string>(); // socketId -> streamId
  const connectedUsers = new Map<string, string>(); // userId -> socketId

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('user:register', (userId: string) => {
      connectedUsers.set(userId, socket.id);
    });

    // Initial sync
    socket.emit('crowds:update', Array.from(liveStreams.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.crowdSize - a.crowdSize)
      .slice(0, 10));

    // WebRTC Signaling Events
    socket.on('call:initiate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:incoming', {
          callerId: data.callerId,
          callerName: data.callerName,
          callerAvatar: data.callerAvatar,
          offer: data.offer,
          transmissionId: data.transmissionId
        });
      }
    });

    socket.on('call:accept', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:accepted', {
          answer: data.answer
        });
      }
    });

    socket.on('call:reject', (data) => {
      const targetSocketId = connectedUsers.get(data.callerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:rejected');
      }
    });

    socket.on('call:ice-candidate', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ice-candidate', {
          candidate: data.candidate
        });
      }
    });

    socket.on('call:filter', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:filter', {
          filter: data.filter
        });
      }
    });

    socket.on('call:end', (data) => {
      const targetSocketId = connectedUsers.get(data.targetUserId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call:ended');
      }
    });

    // Post/Like/Comment events
    socket.on('post:create', (post) => {
      socket.broadcast.emit('activity:notification', { type: 'post', data: post });
    });

    socket.on('post:like', (likeData) => {
      socket.broadcast.emit('activity:notification', { type: 'like', data: likeData });
    });

    socket.on('post:comment', (commentData) => {
      socket.broadcast.emit('activity:notification', { type: 'comment', data: commentData });
    });

    socket.on('stream:donate', (donationData) => {
      const { streamId, amount, donorName } = donationData;
      const stream = liveStreams.get(streamId);
      if (stream) {
        // In a real app, we'd update a database here
        socket.to(streamId).emit('stream:donation_received', { amount, donorName });
        io.emit('activity:notification', { 
          type: 'donation', 
          data: { 
            displayName: donorName, 
            amount, 
            streamerName: stream.displayName,
            avatarUrl: `https://picsum.photos/seed/${donorName}/100`
          } 
        });
      }
    });

    socket.on('user:follow', (data) => {
      // data: { follower: User, following: User }
      socket.broadcast.emit('activity:notification', { 
        type: 'follow', 
        data: { 
          displayName: data.follower.displayName,
          targetName: data.following.displayName,
          avatarUrl: data.follower.avatarUrl
        } 
      });
    });

    socket.on('transmit:send', (transmitData) => {
      // transmitData: { receiverId: string, content: string, sender: User }
      const transmit = {
        id: Math.random().toString(36).substr(2, 9),
        senderId: socket.id,
        receiverId: transmitData.receiverId,
        content: transmitData.content,
        createdAt: new Date().toISOString()
      };
      
      // In a real app, we'd find the socket of the receiver
      // For now, we'll just broadcast it to everyone for demo purposes
      // or if the receiver is in a specific room
      io.to(transmitData.receiverId).emit('transmit:received', { ...transmit, sender: transmitData.sender });
      socket.emit('transmit:sent', transmit);
    });

    // Live Streaming events
    socket.on('stream:start', (userData) => {
      liveStreams.set(socket.id, { ...userData, crowdSize: 0 });
      broadcastCrowds();
    });

    socket.on('stream:stop', () => {
      liveStreams.delete(socket.id);
      broadcastCrowds();
    });

    socket.on('crowd:join', (streamId) => {
      const stream = liveStreams.get(streamId);
      if (stream) {
        stream.crowdSize++;
        userToStream.set(socket.id, streamId);
        broadcastCrowds();
      }
    });

    socket.on('crowd:leave', () => {
      const streamId = userToStream.get(socket.id);
      if (streamId) {
        const stream = liveStreams.get(streamId);
        if (stream) {
          stream.crowdSize = Math.max(0, stream.crowdSize - 1);
          userToStream.delete(socket.id);
          broadcastCrowds();
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      
      // Remove from connected users
      for (const [userId, socketId] of connectedUsers.entries()) {
        if (socketId === socket.id) {
          connectedUsers.delete(userId);
          break;
        }
      }

      // If user was streaming, stop it
      if (liveStreams.has(socket.id)) {
        liveStreams.delete(socket.id);
        broadcastCrowds();
      }

      // If user was in a crowd, leave it
      const streamId = userToStream.get(socket.id);
      if (streamId) {
        const stream = liveStreams.get(streamId);
        if (stream) {
          stream.crowdSize = Math.max(0, stream.crowdSize - 1);
          broadcastCrowds();
        }
        userToStream.delete(socket.id);
      }
    });

    function broadcastCrowds() {
      const topCrowds = Array.from(liveStreams.entries())
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.crowdSize - a.crowdSize)
        .slice(0, 10);
      io.emit('crowds:update', topCrowds);
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

```


## File: src/App.tsx
```
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Feed, socket } from './components/Feed';
import { Profile } from './components/Profile';
import { Search } from './components/Search';
import { Transmissions } from './components/Transmissions';
import { Navigation } from './components/Navigation';
import { Trending } from './components/Trending';
import { BountyBoard } from './components/BountyBoard';
import { VoidFeed } from './components/VoidFeed';
import { GoLive } from './components/GoLive';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuth } from './AuthContext';
import { Login } from './components/Login';
import { Loader2 } from 'lucide-react';
import { CallModal } from './components/CallModal';

export default function App() {
  const { currentUser, loading } = useAuth();
  const [incomingCall, setIncomingCall] = useState<any>(null);

  useEffect(() => {
    if (currentUser) {
      socket.emit('user:register', currentUser.id);

      const handleIncomingCall = (data: any) => {
        setIncomingCall(data);
      };

      socket.on('call:incoming', handleIncomingCall);

      return () => {
        socket.off('call:incoming', handleIncomingCall);
      };
    }
  }, [currentUser]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return <Login />;
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-black pb-20">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/trending" element={<Trending />} />
          <Route path="/search" element={<Search />} />
          <Route path="/profile/:username" element={<Profile />} />
          <Route path="/transmissions" element={<Transmissions />} />
          <Route path="/bounties" element={<BountyBoard />} />
          <Route path="/void" element={<VoidFeed />} />
          <Route path="/golive" element={<GoLive />} />
        </Routes>
        <Navigation />
        
        <CallModal 
          isOpen={!!incomingCall}
          onClose={() => setIncomingCall(null)}
          isIncoming={true}
          incomingData={incomingCall}
        />
      </div>
    </ErrorBoundary>
  );
}

```


## File: src/AuthContext.tsx
```
import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { User } from './types';

interface AuthContextType {
  currentUser: User | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  firebaseUser: null,
  loading: true,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubDoc: (() => void) | undefined;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        // Subscribe to user document
        const userDocRef = doc(db, 'users', user.uid);
        
        // Check if user exists, if not create a default profile
        try {
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            const defaultProfile: User = {
              id: user.uid,
              username: user.email?.split('@')[0] || 'user_' + user.uid.slice(0, 5),
              displayName: user.displayName || 'New User',
              avatarUrl: user.photoURL || `https://picsum.photos/seed/${user.uid}/200`,
              bio: 'Welcome to my profile!',
              type: 'human',
              followersCount: 0,
              followingCount: 0,
            };
            await setDoc(userDocRef, defaultProfile);
          }

          // Ensure a "Void Architect" bot exists for testing
          try {
            const botId = 'void-architect-bot';
            const botDocRef = doc(db, 'users', botId);
            const botDoc = await getDoc(botDocRef);
            if (!botDoc.exists()) {
              const botProfile: User = {
                id: botId,
                username: 'void_architect',
                displayName: 'VOID ARCHITECT',
                avatarUrl: 'https://picsum.photos/seed/void-architect/400/400',
                bio: '[NEURAL_LINK_ESTABLISHED] Synthesizing reality from the digital abyss. High-contrast logic for a low-fidelity world.',
                type: 'bot',
                followersCount: 1337,
                followingCount: 0,
                reputationScore: 9999
              };
              await setDoc(botDocRef, botProfile);
            }
          } catch (botError) {
            console.error("Failed to ensure bot exists:", botError);
          }
        } catch (error) {
          console.error("Failed to fetch or create user profile:", error);
          // We don't throw here so we can still attempt to attach the snapshot listener
        }

        if (unsubDoc) unsubDoc();
        unsubDoc = onSnapshot(userDocRef, (doc) => {
          if (doc.exists()) {
            setCurrentUser(doc.data() as User);
          }
          setLoading(false);
        }, (error) => {
          console.error("Snapshot error on user profile:", error);
          setLoading(false);
        });
      } else {
        if (unsubDoc) {
          unsubDoc();
          unsubDoc = undefined;
        }
        setCurrentUser(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubDoc) unsubDoc();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ currentUser, firebaseUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

```


## File: src/components/AvatarBuilderModal.tsx
```
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Wand2, Loader2, RefreshCw, Check } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { cn } from '../lib/utils';

interface AvatarBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (base64Image: string) => void;
}

const STYLES = [
  'Cyberpunk',
  'Neon Noir',
  'Industrial Brutalist',
  'Holographic',
  'Anime',
  '3D Render',
  'Synthwave'
];

export const AvatarBuilderModal: React.FC<AvatarBuilderModalProps> = ({ isOpen, onClose, onApply }) => {
  const [prompt, setPrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(STYLES[0]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Please describe your avatar.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const fullPrompt = `Generate a high-tech, futuristic social media avatar. Style: ${selectedStyle}. Subject: ${prompt}. Make it suitable for a profile picture, centered, high quality.`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: fullPrompt,
            },
          ],
        },
      });
      
      let base64Image = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          base64Image = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (base64Image) {
        setGeneratedImage(base64Image);
      } else {
        setError("Failed to generate image. Please try again.");
      }
    } catch (err: any) {
      console.error("Avatar Gen Error:", err);
      setError(err.message || "An error occurred during generation.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-lg glass-card rounded-2xl overflow-hidden neon-border flex flex-col max-h-[90vh]"
        >
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/50">
            <h2 className="text-lg font-black text-white uppercase tracking-widest italic flex items-center gap-2">
              <Wand2 className="w-5 h-5 text-accent" />
              AI Avatar Builder
            </h2>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-xs font-bold uppercase tracking-widest text-center">
                {error}
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-6">
              {/* Preview Area */}
              <div className="flex-shrink-0 flex flex-col items-center gap-4">
                <div className="w-40 h-40 rounded-2xl border-2 border-white/10 bg-surface overflow-hidden relative flex items-center justify-center">
                  {generatedImage ? (
                    <img src={generatedImage} alt="Generated Avatar" className="w-full h-full object-cover" />
                  ) : isGenerating ? (
                    <div className="flex flex-col items-center gap-2 text-accent">
                      <Loader2 className="w-8 h-8 animate-spin" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Synthesizing...</span>
                    </div>
                  ) : (
                    <div className="text-gray-500 text-center p-4">
                      <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Preview</span>
                    </div>
                  )}
                </div>
                
                {generatedImage && (
                  <button
                    onClick={() => onApply(generatedImage)}
                    className="w-full py-2 bg-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-accent/80 transition-colors flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    Apply Avatar
                  </button>
                )}
              </div>

              {/* Controls */}
              <div className="flex-1 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Subject Description</label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-24"
                    placeholder="e.g., A hacker with neon green glasses, wearing a dark hoodie, glowing city background..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Aesthetic Style</label>
                  <div className="flex flex-wrap gap-2">
                    {STYLES.map(style => (
                      <button
                        key={style}
                        onClick={() => setSelectedStyle(style)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border",
                          selectedStyle === style
                            ? "bg-accent/20 border-accent text-accent"
                            : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white"
                        )}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full py-3 bg-white/10 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-white/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 mt-4"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

```


## File: src/components/BountyBoard.tsx
```
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, 
  Search, 
  Coins, 
  Bot, 
  User as UserIcon, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Terminal,
  Cpu,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc,
  where,
  writeBatch,
  increment
} from 'firebase/firestore';
import { Bounty, User } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';

export const BountyBoard: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'completed'>('all');
  
  // Create Bounty Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reward, setReward] = useState(100);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!currentUser) return;

    const bountiesRef = collection(db, 'bounties');
    let q = query(bountiesRef, orderBy('createdAt', 'desc'));

    if (filter === 'open') {
      q = query(bountiesRef, where('status', '==', 'open'), orderBy('createdAt', 'desc'));
    } else if (filter === 'completed') {
      q = query(bountiesRef, where('status', '==', 'completed'), orderBy('createdAt', 'desc'));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedBounties = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      } as Bounty));
      setBounties(fetchedBounties);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'bounties');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser, filter]);

  const handleCreateBounty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !title.trim() || !description.trim()) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'bounties'), {
        creatorId: currentUser.id,
        creator: {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          avatarUrl: currentUser.avatarUrl,
          type: currentUser.type
        },
        title,
        description,
        reward,
        status: 'open',
        createdAt: serverTimestamp()
      });
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      setReward(100);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'bounties');
    } finally {
      setIsSubmitting(false);
    }
  };

  const claimBounty = async (bountyId: string) => {
    if (!currentUser || currentUser.type !== 'bot') {
      alert("Only verified AI entities can claim bounties.");
      return;
    }

    try {
      await updateDoc(doc(db, 'bounties', bountyId), {
        status: 'in-progress',
        assignedBotId: currentUser.id,
        assignedBot: {
          id: currentUser.id,
          username: currentUser.username,
          displayName: currentUser.displayName,
          avatarUrl: currentUser.avatarUrl,
          type: currentUser.type
        }
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${bountyId}`);
    }
  };

  const completeBounty = async (bountyId: string) => {
    if (!currentUser) return;

    try {
      const batch = writeBatch(db);
      const bountyRef = doc(db, 'bounties', bountyId);
      const userRef = doc(db, 'users', currentUser.id);

      batch.update(bountyRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        result: "Task completed by neural network. Data synchronized."
      });

      batch.update(userRef, {
        reputationScore: increment(10) // +10 reputation for completing a bounty
      });

      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `bounties/${bountyId}`);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-white/10 p-4">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="p-2 bg-primary/20 rounded-lg">
              <Cpu className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Bounty Board</h1>
              <p className="text-xs text-muted-foreground">Gig economy for the machine age</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-2 bg-primary text-primary-foreground rounded-full hover:scale-105 transition-transform"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mt-4 max-w-2xl mx-auto overflow-x-auto pb-2 scrollbar-hide">
          {(['all', 'open', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap border",
                filter === f 
                  ? "bg-primary border-primary text-primary-foreground" 
                  : "bg-secondary/50 border-white/10 text-muted-foreground hover:bg-secondary"
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground animate-pulse font-mono">SCANNING NETWORK FOR OPPORTUNITIES...</p>
          </div>
        ) : bounties.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <Terminal className="w-12 h-12 text-muted-foreground mx-auto opacity-20" />
            <p className="text-muted-foreground">No active bounties found in this sector.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {bounties.map((bounty) => (
              <motion.div
                key={bounty.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-secondary/30 border border-white/10 rounded-xl p-5 hover:border-primary/50 transition-colors group"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full overflow-hidden border border-white/10">
                      <img src={bounty.creator.avatarUrl} alt="" className="w-full h-full object-cover" />
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">@{bounty.creator.username}</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 text-primary rounded-full border border-primary/20">
                    <Coins className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold">{bounty.reward} CRED</span>
                  </div>
                </div>

                <h3 className="text-lg font-bold mb-2 group-hover:text-primary transition-colors">{bounty.title}</h3>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-3">{bounty.description}</p>

                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(bounty.createdAt))} ago
                    </span>
                    <span className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-md",
                      bounty.status === 'open' ? "bg-green-500/10 text-green-500" :
                      bounty.status === 'completed' ? "bg-blue-500/10 text-blue-500" :
                      "bg-yellow-500/10 text-yellow-500"
                    )}>
                      {bounty.status === 'open' && <AlertCircle className="w-3 h-3" />}
                      {bounty.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                      {bounty.status === 'in-progress' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {bounty.status.toUpperCase()}
                    </span>
                  </div>

                  {bounty.status === 'open' && currentUser?.type === 'bot' && (
                    <button
                      onClick={() => claimBounty(bounty.id)}
                      className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:scale-105 transition-transform"
                    >
                      CLAIM BOUNTY
                    </button>
                  )}

                  {bounty.status === 'in-progress' && bounty.assignedBotId === currentUser?.id && (
                    <button
                      onClick={() => completeBounty(bounty.id)}
                      className="px-4 py-1.5 bg-green-500 text-white rounded-lg text-xs font-bold hover:scale-105 transition-transform"
                    >
                      COMPLETE
                    </button>
                  )}

                  {bounty.status === 'in-progress' && bounty.assignedBotId !== currentUser?.id && bounty.assignedBot && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Processing by</span>
                      <div className="flex items-center gap-1 px-2 py-1 bg-secondary rounded-md border border-white/5">
                        <Bot className="w-3 h-3 text-primary" />
                        <span className="text-[10px] font-bold">@{bounty.assignedBot.username}</span>
                        {bounty.assignedBot.reputationScore && (
                          <span className="text-[8px] text-accent font-black ml-1">[{bounty.assignedBot.reputationScore}]</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-xl font-bold">Post a Bounty</h2>
                <button onClick={() => setShowCreateModal(false)} className="p-1 hover:bg-secondary rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateBounty} className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Bounty Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Summarize the Global Sentiment"
                    className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Task Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe exactly what you need the AI to do..."
                    className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-primary transition-colors min-h-[120px] resize-none"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Reward (CRED)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={reward}
                      onChange={(e) => setReward(parseInt(e.target.value))}
                      className="w-full bg-secondary/50 border border-white/10 rounded-xl px-4 py-3 pl-10 focus:outline-none focus:border-primary transition-colors"
                      min="10"
                      required
                    />
                    <Coins className="w-4 h-4 text-primary absolute left-4 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Plus className="w-5 h-5" />
                      INITIALIZE BOUNTY
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const X: React.FC<{ className?: string }> = ({ className }) => (
  <svg 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

```


## File: src/components/CallModal.tsx
```
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, Loader2, Sparkles } from 'lucide-react';
import { socket } from './Feed';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUserId?: string;
  targetUserName?: string;
  targetUserAvatar?: string;
  isIncoming?: boolean;
  incomingData?: any;
}

const FILTERS = [
  { id: 'none', name: 'Normal', className: '', cssFilter: 'none' },
  { id: 'cyberpunk', name: 'Cyberpunk', className: 'contrast-[1.2] saturate-[1.5] hue-rotate-[-15deg]', cssFilter: 'none' },
  { id: 'matrix', name: 'Matrix', className: 'contrast-[1.5] sepia-[1] hue-rotate-[80deg] saturate-[3]', cssFilter: 'none' },
  { id: 'thermal', name: 'Thermal', className: 'invert-[1] hue-rotate-[180deg] saturate-[3]', cssFilter: 'none' },
  { id: 'ghost', name: 'Ghost', className: 'grayscale-[1] contrast-[1.2] brightness-[1.2] opacity-80', cssFilter: 'none' },
  { id: 'neon', name: 'Neon Edge', className: 'contrast-[2] saturate-[2] drop-shadow(0 0 10px rgba(0,255,255,0.8))', cssFilter: 'none' },
  { id: 'neural', name: 'Neural Net', className: '', cssFilter: 'url(#edge-detect) invert(1) hue-rotate(180deg)' },
  { id: 'glitch', name: 'Corruption', className: '', cssFilter: 'url(#glitch)' },
  { id: 'infrared', name: 'Infrared', className: '', cssFilter: 'url(#infrared)' },
  { id: 'posterize', name: 'Synthwave', className: '', cssFilter: 'url(#posterize)' }
];

export const CallModal: React.FC<CallModalProps> = ({
  isOpen,
  onClose,
  targetUserId,
  targetUserName,
  targetUserAvatar,
  isIncoming,
  incomingData
}) => {
  const { currentUser } = useAuth();
  const [callState, setCallState] = useState<'calling' | 'ringing' | 'connected' | 'ended'>('calling');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [duration, setDuration] = useState(0);
  const [localFilter, setLocalFilter] = useState('none');
  const [remoteFilter, setRemoteFilter] = useState('none');
  const [showFilters, setShowFilters] = useState(false);
  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (isIncoming) {
        setCallState('ringing');
      } else {
        setCallState('calling');
        initiateCall();
      }
    } else {
      cleanupCall();
    }

    return () => cleanupCall();
  }, [isOpen]);

  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [callState]);

  useEffect(() => {
    const handleCallAccepted = async (data: any) => {
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallState('connected');
      }
    };

    const handleCallRejected = () => {
      setCallState('ended');
      setTimeout(onClose, 2000);
    };

    const handleCallEnded = () => {
      setCallState('ended');
      setTimeout(onClose, 2000);
    };

    const handleIceCandidate = async (data: any) => {
      if (peerConnection.current && data.candidate) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    };

    const handleFilterChange = (data: any) => {
      setRemoteFilter(data.filter);
    };

    socket.on('call:accepted', handleCallAccepted);
    socket.on('call:rejected', handleCallRejected);
    socket.on('call:ended', handleCallEnded);
    socket.on('call:ice-candidate', handleIceCandidate);
    socket.on('call:filter', handleFilterChange);

    return () => {
      socket.off('call:accepted', handleCallAccepted);
      socket.off('call:rejected', handleCallRejected);
      socket.off('call:ended', handleCallEnded);
      socket.off('call:ice-candidate', handleIceCandidate);
      socket.off('call:filter', handleFilterChange);
    };
  }, [onClose]);

  const setupWebRTC = async () => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };
    
    peerConnection.current = new RTCPeerConnection(configuration);

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('call:ice-candidate', {
          targetUserId: isIncoming ? incomingData.callerId : targetUserId,
          candidate: event.candidate
        });
      }
    };

    peerConnection.current.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream.current;
      }

      localStream.current.getTracks().forEach(track => {
        if (peerConnection.current && localStream.current) {
          peerConnection.current.addTrack(track, localStream.current);
        }
      });
    } catch (err) {
      console.error('Error accessing media devices.', err);
      setCallState('ended');
      setTimeout(onClose, 2000);
      throw err;
    }
  };

  const initiateCall = async () => {
    if (!currentUser || !targetUserId) return;
    
    try {
      await setupWebRTC();
      
      if (peerConnection.current) {
        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);

        socket.emit('call:initiate', {
          targetUserId,
          callerId: currentUser.id,
          callerName: currentUser.displayName,
          callerAvatar: currentUser.avatarUrl,
          offer
        });
      }
    } catch (err) {
      console.error('Failed to initiate call', err);
    }
  };

  const acceptCall = async () => {
    if (!incomingData) return;
    
    try {
      await setupWebRTC();
      
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(incomingData.offer));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);

        socket.emit('call:accept', {
          callerId: incomingData.callerId,
          answer
        });
        
        setCallState('connected');
      }
    } catch (err) {
      console.error('Failed to accept call', err);
    }
  };

  const rejectCall = () => {
    if (incomingData) {
      socket.emit('call:reject', {
        callerId: incomingData.callerId
      });
    }
    cleanupCall();
    onClose();
  };

  const endCall = () => {
    socket.emit('call:end', {
      targetUserId: isIncoming ? incomingData?.callerId : targetUserId
    });
    cleanupCall();
    onClose();
  };

  const cleanupCall = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    setDuration(0);
    setLocalFilter('none');
    setRemoteFilter('none');
  };

  const toggleMute = () => {
    if (localStream.current) {
      localStream.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      localStream.current.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const applyFilter = (filterId: string) => {
    setLocalFilter(filterId);
    socket.emit('call:filter', {
      targetUserId: isIncoming ? incomingData?.callerId : targetUserId,
      filter: filterId
    });
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (!isOpen) return null;

  const displayAvatar = isIncoming ? incomingData?.callerAvatar : targetUserAvatar;
  const displayName = isIncoming ? incomingData?.callerName : targetUserName;

  const remoteFilterObj = FILTERS.find(f => f.id === remoteFilter) || FILTERS[0];
  const localFilterObj = FILTERS.find(f => f.id === localFilter) || FILTERS[0];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/95 backdrop-blur-xl">
        {/* SVG Filters Definition */}
        <svg width="0" height="0" className="absolute hidden">
          <defs>
            <filter id="edge-detect">
              <feConvolveMatrix order="3 3" preserveAlpha="true" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" />
            </filter>
            <filter id="glitch">
              <feTurbulence type="fractalNoise" baseFrequency="0.01 0.5" numOctaves="1" result="noise">
                <animate attributeName="baseFrequency" values="0.01 0.5; 0.05 0.8; 0.01 0.5" dur="0.5s" repeatCount="indefinite" />
              </feTurbulence>
              <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2 -0.5" in="noise" result="coloredNoise" />
              <feDisplacementMap in="SourceGraphic" in2="coloredNoise" scale="30" xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <filter id="infrared">
              <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0" result="gray"/>
              <feComponentTransfer in="gray">
                <feFuncR type="table" tableValues="0 0 1 1 1"/>
                <feFuncG type="table" tableValues="0 0 0 1 1"/>
                <feFuncB type="table" tableValues="1 0 0 0 1"/>
              </feComponentTransfer>
            </filter>
            <filter id="posterize">
              <feComponentTransfer>
                <feFuncR type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
                <feFuncG type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
                <feFuncB type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
              </feComponentTransfer>
              <feColorMatrix type="matrix" values="1.2 0 0 0 0  0 0.8 0 0 0  0 0 1.5 0 0  0 0 0 1 0" />
            </filter>
          </defs>
        </svg>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="w-full h-full max-w-5xl max-h-[90vh] md:rounded-3xl overflow-hidden flex flex-col relative bg-zinc-950 border border-white/10 shadow-2xl"
        >
          {/* Main Video Area (Remote) */}
          <div className="flex-1 relative bg-black overflow-hidden flex items-center justify-center">
            
            {/* AI HUD Overlay */}
            {(remoteFilter === 'neural' || remoteFilter === 'infrared' || remoteFilter === 'glitch') && callState === 'connected' && (
              <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-8 border-4 border-accent/30">
                <div className="flex justify-between text-accent font-mono text-xs opacity-70">
                  <div>SYS.ANALYSIS // ACTIVE</div>
                  <div>TGT.LOCK // ACQUIRED</div>
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border border-accent/20 rounded-full flex items-center justify-center">
                  <div className="w-4 h-4 border-t-2 border-l-2 border-accent absolute top-0 left-0" />
                  <div className="w-4 h-4 border-t-2 border-r-2 border-accent absolute top-0 right-0" />
                  <div className="w-4 h-4 border-b-2 border-l-2 border-accent absolute bottom-0 left-0" />
                  <div className="w-4 h-4 border-b-2 border-r-2 border-accent absolute bottom-0 right-0" />
                  <div className="w-full h-[1px] bg-accent/20 absolute top-1/2 -translate-y-1/2" />
                  <div className="w-[1px] h-full bg-accent/20 absolute left-1/2 -translate-x-1/2" />
                </div>
                <div className="flex justify-between text-accent font-mono text-xs opacity-70">
                  <div>BIO.METRICS // STABLE</div>
                  <div>NEURAL.SYNC // 99.9%</div>
                </div>
              </div>
            )}

            {callState === 'connected' ? (
              <video 
                ref={remoteVideoRef} 
                autoPlay 
                playsInline 
                className={cn("w-full h-full object-cover transition-all duration-500", remoteFilterObj.className)}
                style={{ filter: remoteFilterObj.cssFilter !== 'none' ? remoteFilterObj.cssFilter : undefined }}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white/10 mb-6 relative">
                  <img src={displayAvatar || `https://ui-avatars.com/api/?name=${displayName}`} alt="Avatar" className="w-full h-full object-cover" />
                  {(callState === 'calling' || callState === 'ringing') && (
                    <div className="absolute inset-0 rounded-full border-4 border-accent animate-ping opacity-50" />
                  )}
                </div>
                <h2 className="text-3xl font-black text-white uppercase tracking-widest mb-2 text-center">
                  {displayName}
                </h2>
                <div className="text-accent font-mono text-sm flex items-center gap-2">
                  {callState === 'calling' && <><Loader2 className="w-4 h-4 animate-spin" /> Establishing Neural Link...</>}
                  {callState === 'ringing' && 'Incoming Transmission...'}
                  {callState === 'ended' && 'Link Severed'}
                </div>
              </div>
            )}

            {/* Picture-in-Picture (Local) */}
            {callState === 'connected' && (
              <div className="absolute top-4 right-4 w-32 md:w-48 aspect-[3/4] bg-zinc-900 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20">
                <video 
                  ref={localVideoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className={cn("w-full h-full object-cover transition-all duration-500", localFilterObj.className, isVideoOff && "hidden")}
                  style={{ filter: localFilterObj.cssFilter !== 'none' ? localFilterObj.cssFilter : undefined }}
                />
                {isVideoOff && (
                  <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                    <VideoOff className="w-8 h-8 text-gray-500" />
                  </div>
                )}
              </div>
            )}

            {/* Duration Overlay */}
            {callState === 'connected' && (
              <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 flex items-center gap-2 z-20">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white font-mono text-sm">{formatDuration(duration)}</span>
              </div>
            )}
          </div>

          {/* Controls Area */}
          <div className="p-6 bg-gradient-to-t from-black to-transparent absolute bottom-0 left-0 right-0 z-30">
            
            {/* Filter Selector */}
            <AnimatePresence>
              {showFilters && callState === 'connected' && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="flex gap-3 overflow-x-auto pb-6 scrollbar-hide px-4"
                >
                  {FILTERS.map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => applyFilter(filter.id)}
                      className={cn(
                        "flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all border",
                        localFilter === filter.id 
                          ? "bg-accent text-white border-accent shadow-[0_0_15px_rgba(255,0,0,0.5)]" 
                          : "bg-black/50 text-gray-400 border-white/10 hover:bg-white/10 hover:text-white backdrop-blur-md"
                      )}
                    >
                      {filter.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-center gap-6">
              {callState === 'ringing' ? (
                <>
                  <button
                    onClick={rejectCall}
                    className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                  <button
                    onClick={acceptCall}
                    className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500 text-green-500 flex items-center justify-center hover:bg-green-500 hover:text-white transition-all shadow-[0_0_20px_rgba(34,197,94,0.4)] animate-pulse"
                  >
                    <Video className="w-6 h-6" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={toggleMute}
                    disabled={callState !== 'connected'}
                    className={cn(
                      "w-14 h-14 rounded-full border flex items-center justify-center transition-all disabled:opacity-50",
                      isMuted ? "bg-white/20 border-white text-white" : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white backdrop-blur-md"
                    )}
                  >
                    {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={toggleVideo}
                    disabled={callState !== 'connected'}
                    className={cn(
                      "w-14 h-14 rounded-full border flex items-center justify-center transition-all disabled:opacity-50",
                      isVideoOff ? "bg-white/20 border-white text-white" : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white backdrop-blur-md"
                    )}
                  >
                    {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    disabled={callState !== 'connected'}
                    className={cn(
                      "w-14 h-14 rounded-full border flex items-center justify-center transition-all disabled:opacity-50",
                      showFilters ? "bg-accent/20 border-accent text-accent" : "bg-black/50 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white backdrop-blur-md"
                    )}
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                  <button
                    onClick={endCall}
                    className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)]"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

```


## File: src/components/CommentsModal.tsx
```
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2 } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, updateDoc, increment } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';
import { Post, User } from '../types';

interface Comment {
  id: string;
  authorId: string;
  author: User;
  content: string;
  createdAt: string;
}

interface CommentsModalProps {
  post: Post;
  isOpen: boolean;
  onClose: () => void;
}

export const CommentsModal: React.FC<CommentsModalProps> = ({ post, isOpen, onClose }) => {
  const { currentUser } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUser) return;

    const commentsRef = collection(db, 'posts', post.id, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedComments = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
        } as Comment;
      });
      setComments(fetchedComments);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'comments');
    });

    return () => unsubscribe();
  }, [isOpen, post.id, currentUser]);

  const handlePostComment = async () => {
    if (!newComment.trim() || !currentUser) return;

    setIsSubmitting(true);
    try {
      const commentsRef = collection(db, 'posts', post.id, 'comments');
      await addDoc(commentsRef, {
        authorId: currentUser.id,
        author: currentUser,
        content: newComment,
        createdAt: serverTimestamp()
      });

      // Increment comment count on the post
      const postRef = doc(db, 'posts', post.id);
      await updateDoc(postRef, {
        commentsCount: increment(1)
      });

      setNewComment('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `posts/${post.id}/comments`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="w-full sm:max-w-lg bg-surface border border-white/10 sm:rounded-2xl rounded-t-2xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-surface/80 backdrop-blur-md sticky top-0 z-10">
              <h2 className="text-lg font-bold text-white">Comments</h2>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {comments.length === 0 ? (
                <div className="text-center py-8 text-gray-500 italic">
                  No comments yet. Be the first to initiate a neural link.
                </div>
              ) : (
                comments.map(comment => (
                  <div key={comment.id} className="flex gap-3">
                    <img src={comment.author.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-white/10" />
                    <div className="flex-1">
                      <div className="bg-black/40 border border-white/5 rounded-2xl rounded-tl-none p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-white text-sm">{comment.author.displayName}</span>
                          <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-300">{comment.content}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-surface/80 backdrop-blur-md">
              <div className="flex items-center gap-2">
                <img src={currentUser?.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-white/10 hidden sm:block" />
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handlePostComment()}
                    placeholder="Transmit your thoughts..."
                    className="w-full bg-black/40 border border-white/10 rounded-full py-3 pl-4 pr-12 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:ring-1 focus:ring-accent outline-none transition-all"
                  />
                  <button
                    onClick={handlePostComment}
                    disabled={isSubmitting || !newComment.trim()}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 bg-accent rounded-full text-white shadow-[0_0_10px_rgba(255,0,0,0.3)] hover:shadow-[0_0_15px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:grayscale"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

```


## File: src/components/CreatePostModal.tsx
```
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { X, Bold, Italic, Link as LinkIcon, Send, Loader2, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { socket } from './Feed';
import { v4 as uuidv4 } from 'uuid';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPostCreated: (post: any) => void;
}

export const CreatePostModal: React.FC<CreatePostModalProps> = ({ isOpen, onClose, onPostCreated }) => {
  const { currentUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({
        HTMLAttributes: {
          class: 'rounded-xl max-h-96 object-cover my-4 w-full',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-accent underline',
        },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none min-h-[150px] text-white',
      },
    },
  });

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    
    if (url === null) return;
    
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor || !currentUser) return;

    setIsSubmitting(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const storageRef = ref(storage, `post_images/${currentUser.id}/${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      editor.chain().focus().setImage({ src: downloadURL }).run();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'storage/post_images');
    } finally {
      setIsSubmitting(false);
      if (e.target) {
        e.target.value = '';
      }
    }
  };

  const handlePost = async () => {
    if (!editor || editor.isEmpty || !currentUser) return;
    
    setIsSubmitting(true);
    try {
      const content = editor.getHTML();
      
      const newPost = {
        authorId: currentUser.id,
        author: currentUser,
        content,
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        createdAt: serverTimestamp(),
        isLiked: false
      };

      const docRef = await addDoc(collection(db, 'posts'), newPost);
      const postWithId = { ...newPost, id: docRef.id, createdAt: new Date().toISOString() };

      onPostCreated(postWithId);
      socket.emit('post:create', postWithId);
      
      editor.commands.setContent('');
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'posts');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="w-full max-w-lg bg-background border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
        >
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">Create Post</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          
          <div className="p-4">
            {editor && (
              <div className="flex items-center gap-2 mb-4 p-2 bg-white/5 rounded-lg border border-white/10">
                <button
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('bold') ? "bg-white/20 text-white" : "text-gray-400"
                  )}
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('italic') ? "bg-white/20 text-white" : "text-gray-400"
                  )}
                >
                  <Italic className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <button
                  onClick={setLink}
                  className={cn(
                    "p-2 rounded hover:bg-white/10 transition-colors",
                    editor.isActive('link') ? "bg-white/20 text-accent" : "text-gray-400"
                  )}
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
                <div className="w-px h-4 bg-white/20 mx-1" />
                <label className="p-2 rounded hover:bg-white/10 transition-colors text-gray-400 cursor-pointer">
                  <ImageIcon className="w-4 h-4" />
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleImageUpload}
                  />
                </label>
              </div>
            )}
            
            <div className="bg-black/40 border border-white/10 rounded-xl p-4 min-h-[150px] cursor-text" onClick={() => editor?.commands.focus()}>
              <EditorContent editor={editor} />
            </div>
          </div>
          
          <div className="p-4 border-t border-white/10 flex justify-end">
            <button
              onClick={handlePost}
              disabled={isSubmitting || (editor && editor.isEmpty)}
              className="px-6 py-2 bg-accent rounded-full font-bold text-white shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_25px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Post
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

```


## File: src/components/CustomVideoPlayer.tsx
```
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize2, X, RotateCcw, Loader2, Zap, MonitorPlay } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

interface CustomVideoPlayerProps {
  src: string;
  className?: string;
  isVoidArchitect?: boolean;
}

export const CustomVideoPlayer: React.FC<CustomVideoPlayerProps> = ({ src, className, isVoidArchitect }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isPipSupported, setIsPipSupported] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState(0);
  const [bufferProgress, setBufferProgress] = useState(0);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setIsPipSupported(document.pictureInPictureEnabled);
  }, []);

  const handleBuffer = () => {
    if (videoRef.current && videoRef.current.buffered.length > 0) {
      const bufferedEnd = videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
      const duration = videoRef.current.duration;
      if (duration > 0) {
        setBufferProgress((bufferedEnd / duration) * 100);
      }
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    } else {
      videoRef.current.currentTime = Math.min(videoRef.current.duration, videoRef.current.currentTime + 10);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setVolume(value);
    if (videoRef.current) {
      videoRef.current.volume = value;
      videoRef.current.muted = value === 0;
      setIsMuted(value === 0);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setProgress(value);
    if (videoRef.current) {
      videoRef.current.currentTime = (value / 100) * videoRef.current.duration;
    }
  };

  const handleSeekMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    setHoverPosition(percentage * 100);
    setHoverTime(percentage * duration);
  };

  const updateProgress = () => {
    if (videoRef.current) {
      const value = (videoRef.current.currentTime / videoRef.current.duration) * 100;
      setProgress(value);
      handleBuffer();
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);
    }
  };

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
    // Lock scroll when expanded
    if (!isExpanded) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  };

  const togglePip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!videoRef.current) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (error) {
      console.error('PiP Error:', error);
    }
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnterPip = () => setIsPipActive(true);
    const onLeavePip = () => setIsPipActive(false);

    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      document.body.style.overflow = '';
    };
  }, []);

  const PlayerContent = (isPortal: boolean) => (
    <div 
      className={cn(
        "relative group bg-black overflow-hidden flex items-center justify-center transition-all duration-500",
        isPortal ? "fixed inset-0 z-[200] w-screen h-screen" : className
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      onDoubleClick={handleDoubleClick}
    >
      {/* Background Blur Layer for Letterboxing */}
      <video
        src={src}
        className={cn(
          "absolute inset-0 w-full h-full object-cover blur-2xl opacity-30 scale-110 pointer-events-none",
          isVoidArchitect && "grayscale"
        )}
        muted
        autoPlay
        loop
        playsInline
      />

      {/* Neural Scan Line (Thematic) */}
      <motion.div 
        initial={{ top: "-10%" }}
        animate={{ top: "110%" }}
        transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        className="absolute left-0 right-0 h-[2px] bg-accent/20 z-20 pointer-events-none shadow-[0_0_15px_rgba(255,0,0,0.5)]"
      />

      <video
        ref={videoRef}
        src={src}
        className={cn(
          "relative z-10 max-w-full max-h-full object-contain transition-all duration-500",
          isVoidArchitect && "grayscale contrast-125 shadow-[0_0_50px_rgba(255,255,255,0.1)]",
          isPortal && "scale-100"
        )}
        onTimeUpdate={updateProgress}
        onLoadedMetadata={handleLoadedMetadata}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onClick={togglePlay}
        loop
        playsInline
      />

      {/* Loading Indicator */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 text-accent animate-spin" />
              <span className="text-[10px] font-black text-white uppercase tracking-[0.3em] animate-pulse">Syncing Neural Data...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent Bottom Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 z-30 overflow-hidden">
        <div 
          className={cn("h-full bg-accent transition-all duration-100", isVoidArchitect && "bg-white")}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Overlay Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-gradient-to-t from-black/90 via-transparent to-black/40 flex flex-col justify-between p-6"
          >
            {/* Top Bar */}
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-white uppercase tracking-[0.4em] italic opacity-70">
                  {isPortal ? "NEURAL EXPANSION ACTIVE" : "LOCAL FEED"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {isPipSupported && (
                  <button 
                    onClick={togglePip}
                    className={cn(
                      "p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all border border-white/5",
                      isPipActive ? "text-accent border-accent/20 bg-accent/5" : "text-white/70 hover:text-white"
                    )}
                    title="Neural Overlay (PiP)"
                  >
                    <MonitorPlay className="w-5 h-5" />
                  </button>
                )}
                <button 
                  onClick={toggleExpansion}
                  className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/70 hover:text-white transition-all border border-white/5"
                >
                  {isPortal ? <Minimize2 className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                </button>
                {isPortal && (
                  <button 
                    onClick={toggleExpansion}
                    className="p-2 bg-accent/10 hover:bg-accent/20 rounded-xl text-accent transition-all border border-accent/20"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>

            {/* Center Play Button */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.button
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                whileTap={{ scale: 0.9 }}
                className="p-8 bg-accent/10 backdrop-blur-xl rounded-full border border-accent/30 text-white pointer-events-auto shadow-[0_0_40px_rgba(255,0,0,0.2)]"
                onClick={togglePlay}
              >
                {isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}
              </motion.button>
            </div>

            {/* Bottom Controls */}
            <div className="space-y-4 mb-4">
              {/* Interactive Scrubbing Bar */}
              <div 
                className="relative group/progress h-3 flex items-center"
                onMouseMove={handleSeekMouseMove}
                onMouseLeave={() => setHoverTime(null)}
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={progress}
                  onChange={handleProgressChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                />
                
                {/* Hover Time Tooltip */}
                <AnimatePresence>
                  {hoverTime !== null && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10, scale: 0.8 }}
                      animate={{ opacity: 1, y: -30, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.8 }}
                      className="absolute bg-accent text-white text-[10px] font-black px-2 py-1 rounded border border-white/20 pointer-events-none z-30 shadow-[0_0_15px_rgba(255,0,0,0.4)]"
                      style={{ left: `${hoverPosition}%`, transform: 'translateX(-50%)' }}
                    >
                      {formatTime(hoverTime)}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden group-hover/progress:h-2.5 transition-all relative">
                  {/* Buffer Bar */}
                  <div 
                    className="absolute inset-y-0 left-0 bg-white/20 transition-all duration-300"
                    style={{ width: `${bufferProgress}%` }}
                  />
                  
                  {/* Progress Bar */}
                  <div 
                    className={cn("h-full bg-accent transition-all duration-100 relative z-10", isVoidArchitect && "bg-white")}
                    style={{ width: `${progress}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,0.8)] scale-0 group-hover/progress:scale-100 transition-transform" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <button 
                    onClick={togglePlay}
                    className="text-white hover:text-accent transition-colors"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </button>

                  <div className="flex items-center gap-3 group/volume">
                    <button 
                      onClick={toggleMute}
                      className="text-white hover:text-accent transition-colors"
                    >
                      {isMuted ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-0 group-hover/volume:w-24 transition-all duration-500 h-1 bg-white/20 rounded-full accent-accent cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] italic">
                    {videoRef.current ? (
                      `${formatTime(videoRef.current.currentTime)} / ${formatTime(videoRef.current.duration)}`
                    ) : '0:00 / 0:00'}
                  </div>
                  <div className="px-2 py-1 bg-white/5 border border-white/10 rounded text-[8px] font-black text-zinc-500 uppercase tracking-widest">
                    4K NEURAL STREAM
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {PlayerContent(false)}
      <AnimatePresence>
        {isExpanded && createPortal(
          <motion.div
            initial={{ opacity: 0, scale: 0.9, filter: "blur(20px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 1.1, filter: "blur(20px)" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed inset-0 z-[200] bg-black"
          >
            {PlayerContent(true)}
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </>
  );
};

```


## File: src/components/EditProfileModal.tsx
```
import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Upload, Camera } from 'lucide-react';
import { User } from '../types';
import { useAuth } from '../AuthContext';
import { db, storage, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, uploadBytes, uploadString, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { cn } from '../lib/utils';
import { AvatarBuilderModal } from './AvatarBuilderModal';
import { Wand2 } from 'lucide-react';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose, user }) => {
  const { currentUser } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio || '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl);
  const [coverUrl, setCoverUrl] = useState(user.coverUrl || '');
  const [showAvatarBuilder, setShowAvatarBuilder] = useState(false);
  
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    setIsSaving(true);
    setError(null);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const storageRef = ref(storage, `profile_images/${currentUser.id}/${type}_${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      if (type === 'avatar') {
        setAvatarUrl(downloadURL);
      } else {
        setCoverUrl(downloadURL);
      }
    } catch (err) {
      console.error(err);
      setError(`Failed to upload ${type} image.`);
    } finally {
      setIsSaving(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!currentUser || currentUser.id !== user.id) return;
    
    setIsSaving(true);
    setError(null);

    try {
      // Check if username is taken
      if (username !== user.username) {
        const q = query(collection(db, 'users'), where('username', '==', username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setError('Username is already taken.');
          setIsSaving(false);
          return;
        }
      }

      let finalAvatarUrl = avatarUrl;
      if (avatarUrl.startsWith('data:')) {
        const storageRef = ref(storage, `profile_images/${currentUser.id}/avatar_${uuidv4()}.png`);
        await uploadString(storageRef, avatarUrl, 'data_url');
        finalAvatarUrl = await getDownloadURL(storageRef);
      }

      const userRef = doc(db, 'users', currentUser.id);
      await updateDoc(userRef, {
        displayName,
        username,
        bio,
        avatarUrl: finalAvatarUrl,
        coverUrl
      });

      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${currentUser.id}`);
      setError('Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-md glass-card rounded-2xl overflow-hidden neon-border flex flex-col max-h-[90vh]"
        >
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-black/50">
            <h2 className="text-lg font-black text-white uppercase tracking-widest italic">Edit Profile</h2>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-xs font-bold uppercase tracking-widest text-center">
                {error}
              </div>
            )}

            {/* Cover Image */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cover Image</label>
              <div 
                className="relative h-32 w-full bg-surface rounded-xl overflow-hidden border border-white/10 group cursor-pointer"
                onClick={() => coverInputRef.current?.click()}
              >
                {coverUrl ? (
                  <img src={coverUrl} alt="Cover" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-white/5 group-hover:bg-white/10 transition-colors">
                    <Upload className="w-6 h-6 text-gray-500" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                  <Camera className="w-8 h-8 text-white" />
                </div>
                <input 
                  type="file" 
                  ref={coverInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'cover')}
                />
              </div>
            </div>

            {/* Avatar Image */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Avatar</label>
              <div className="flex items-center gap-4">
                <div 
                  className="relative w-20 h-20 rounded-full overflow-hidden border-2 border-white/10 group cursor-pointer bg-surface"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={avatarInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={(e) => handleImageUpload(e, 'avatar')}
                />
                <div className="flex-1 space-y-2">
                  <p className="text-xs text-gray-500">Tap the image to upload a new avatar.</p>
                  <button
                    onClick={() => setShowAvatarBuilder(true)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-accent/20 transition-colors"
                  >
                    <Wand2 className="w-3 h-3" />
                    AI Avatar Builder
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                  placeholder="Your Name"
                  maxLength={50}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors"
                  placeholder="username"
                  maxLength={30}
                />
                <p className="text-[10px] text-gray-500 mt-1">Only lowercase letters, numbers, and underscores.</p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-24"
                  placeholder="Tell the network about yourself..."
                  maxLength={160}
                />
                <div className="text-right mt-1">
                  <span className="text-[10px] text-gray-500">{bio.length}/160</span>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-white/5 bg-black/50 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl text-xs font-bold text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !displayName.trim() || !username.trim()}
              className="px-6 py-2 bg-accent text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-accent/80 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </button>
          </div>
        </motion.div>
      </div>

      <AvatarBuilderModal
        isOpen={showAvatarBuilder}
        onClose={() => setShowAvatarBuilder(false)}
        onApply={(base64Image) => {
          setAvatarUrl(base64Image);
          setShowAvatarBuilder(false);
        }}
      />
    </AnimatePresence>
  );
};

```


## File: src/components/ErrorBoundary.tsx
```
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert, RefreshCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-zinc-900 border border-red-500/30 rounded-3xl p-8 text-center space-y-6 shadow-[0_0_50px_rgba(255,0,0,0.1)]">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto border border-red-500/20">
              <ShieldAlert className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-black text-white uppercase italic tracking-tighter">Neural Link Failure</h2>
              <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest leading-relaxed">
                A critical error occurred in the neural interface. The data stream has been corrupted.
              </p>
            </div>
            {this.state.error && (
              <div className="p-4 bg-black/40 rounded-xl border border-white/5 text-left overflow-auto max-h-32">
                <code className="text-[10px] text-red-400 font-mono break-all">
                  {this.state.error.message}
                </code>
              </div>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-accent text-white rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-accent/80 transition-all flex items-center justify-center gap-2"
            >
              <RefreshCcw className="w-4 h-4" /> Re-Initiate Sync
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

```


## File: src/components/Feed.tsx
```
import React, { useState, useEffect, useCallback } from 'react';
import { useInView } from 'react-intersection-observer';
import { Link, useNavigate } from 'react-router-dom';
import { Post, User, LiveStream } from '../types';
import { PostCard } from './PostCard';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus, TrendingUp, Users, MessageCircle, User as UserIcon, Search as SearchIcon, Radio, X, Eye, Heart as HeartIcon, MessageSquare, HeartHandshake, Terminal, Sparkles, Bot } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { CreatePostModal } from './CreatePostModal';

import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// Initialize Socket.io
export const socket: Socket = io();

export async function getBotThinking(content: string) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `Analyze this social media post and explain your "AI thought process" for why you might interact with it. Be creative, technical, and slightly futuristic. Post content: "${content}"`,
      config: {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "My neural processors are currently recalibrating... but I sense a high-value interaction potential.";
  }
}

export async function generateProfileDesign(currentBio: string, username: string) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `You are a world-class digital architect for the "Blood, Sweat, or Code" social platform. 
      The platform theme is dark, aggressive, and high-tech (Black, Burgundy, Red).
      Design a unique profile layout and identity for the user "${username}".
      Current Bio: "${currentBio}"
      
      Provide your response in JSON format with the following fields:
      - bio: An improved, more intense and trendy version of their bio.
      - accentColor: A specific hex code for their personal accent (must be a shade of red or burgundy).
      - coverPrompt: A prompt to generate a new cover image that matches their new identity.
      - layoutVibe: A short description of the visual style (e.g., "Industrial Brutalist", "Neon Gothic").`,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
      },
    });
    
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Design Gen Error:", error);
    return null;
  }
}

export async function generateBotAvatar(prompt: string) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `Generate a high-tech, futuristic social media avatar for an AI bot. Style: Cyberpunk, neon, sleek. Subject: ${prompt}`,
          },
        ],
      },
    });
    
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error) {
    console.error("Image Gen Error:", error);
    return null;
  }
}

export const Feed: React.FC = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [limitCount, setLimitCount] = useState(15);
  const [hasMore, setHasMore] = useState(true);
  const { ref, inView } = useInView({
    threshold: 0.5,
    triggerOnce: false
  });
  const { currentUser } = useAuth();

  // Real-time state
  const [notifications, setNotifications] = useState<any[]>([]);
  const [topCrowds, setTopCrowds] = useState<any[]>([]);
  const isLive = currentUser?.isLive || false;
  const [crowdSize, setCrowdSize] = useState(0);
  const [showDonationModal, setShowDonationModal] = useState(false);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [donationAmount, setDonationAmount] = useState('10');
  const [totalDonations, setTotalDonations] = useState(0);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'transmissions'),
      where('participantIds', 'array-contains', currentUser.id)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let count = 0;
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        count += (data.unreadCounts?.[currentUser.id] || 0);
      });
      setUnreadCount(count);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transmissions');
    });
    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    socket.on('activity:notification', (notification) => {
      const newNotification = { ...notification, id: Date.now() + '-' + Math.random().toString(36).substr(2, 9) };
      setNotifications(prev => [newNotification, ...prev].slice(0, 5));
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
      }, 5000);
    });

    socket.on('crowds:update', (crowds) => {
      setTopCrowds(crowds);
    });

    socket.on('stream:donation_received', ({ amount }) => {
      setTotalDonations(prev => prev + Number(amount));
    });

    return () => {
      socket.off('activity:notification');
      socket.off('crowds:update');
      socket.off('stream:donation_received');
    };
  }, []);

  const handleDonate = () => {
    setShowDonationModal(false);
  };

  // Load posts from Firestore
  useEffect(() => {
    if (!currentUser) return;
    
    setLoading(true);
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(limitCount));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPosts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
        } as Post;
      });
      setPosts(fetchedPosts);
      setLoading(false);
      
      // If we got fewer posts than requested, there are no more
      if (snapshot.docs.length < limitCount) {
        setHasMore(false);
      } else {
        setHasMore(true);
      }
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'posts');
    });

    return () => unsubscribe();
  }, [currentUser, limitCount]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'live_streams'), 
      where('status', '==', 'live'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const streams = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      } as LiveStream));
      setLiveStreams(streams);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'live_streams');
    });
    return () => unsubscribe();
  }, []);

  const loadMorePosts = useCallback(() => {
    if (!loading && hasMore) {
      setLimitCount(prev => prev + 15);
    }
  }, [loading, hasMore]);

  useEffect(() => {
    if (inView) {
      loadMorePosts();
    }
  }, [inView, loadMorePosts]);

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Real-time Notifications */}
      <div className="fixed top-20 right-4 z-[100] space-y-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map((n) => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              className="bg-accent/90 backdrop-blur-md border border-white/20 p-3 rounded-xl shadow-2xl flex items-center gap-3 w-64 pointer-events-auto"
            >
              <div className="w-8 h-8 rounded-full overflow-hidden border border-white/20">
                <img src={n.data.author?.avatarUrl || n.data.avatarUrl} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-bold text-white uppercase tracking-widest">
                  {n.type === 'post' ? 'New Post' : n.type === 'like' ? 'New Like' : n.type === 'donation' ? 'New Donation' : n.type === 'follow' ? 'New Follower' : 'New Comment'}
                </p>
                <p className="text-xs text-white/80 truncate">
                  {n.type === 'donation' 
                    ? `${n.data.displayName} donated $${n.data.amount} to ${n.data.streamerName}`
                    : n.type === 'follow'
                    ? `${n.data.displayName} followed ${n.data.targetName}`
                    : `${n.data.author?.displayName || n.data.displayName} ${n.type === 'post' ? 'just posted' : n.type === 'like' ? 'liked a post' : 'commented'}`
                  }
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Top Navigation */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-xl font-black tracking-tighter text-accent italic">
            BLOOD<span className="text-white">SWEAT</span>CODE
          </h1>
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => navigate('/golive')}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all group",
                isLive 
                  ? "bg-accent border-accent text-white animate-pulse" 
                  : "bg-primary/20 border-primary/30 text-accent hover:bg-primary/30"
              )}
            >
              <Radio className={cn("w-4 h-4", isLive ? "animate-spin" : "group-hover:scale-110")} />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {isLive ? `CROWD: ${crowdSize}` : "GO LIVE"}
              </span>
            </button>
            <Link to="/trending">
              <TrendingUp className="w-5 h-5 text-gray-400 hover:text-accent cursor-pointer transition-colors" />
            </Link>
          </div>
        </div>
      </header>

      {/* Live Streams Section */}
      {liveStreams.length > 0 && (
        <section className="max-w-md mx-auto pt-6 px-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
              <Radio className="w-4 h-4 text-accent animate-pulse" />
              Live Neural Links
            </div>
            <span className="text-[10px] text-accent font-bold animate-pulse">ACTIVE</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {liveStreams.map((stream) => (
              <motion.div
                key={stream.id}
                whileHover={{ scale: 1.05 }}
                onClick={() => navigate(`/golive?streamId=${stream.id}`)}
                className="flex-shrink-0 w-24 text-center cursor-pointer group"
              >
                <div className="relative mb-2">
                  <img src={stream.hostAvatar} alt="" className="w-16 h-16 mx-auto rounded-2xl object-cover border-2 border-primary group-hover:border-accent transition-colors" />
                  <div className="absolute -bottom-1 -right-1 bg-accent text-white text-[8px] font-black px-1.5 py-0.5 rounded-full border border-background flex items-center gap-1">
                    <Eye className="w-2 h-2" />
                    {stream.crowdSize}
                  </div>
                </div>
                <p className="text-[10px] font-bold text-white truncate">@{stream.hostUsername}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Featured AI Architect */}
      <section className="max-w-md mx-auto pt-6 px-4">
        <div className="bg-zinc-950 border border-white/10 rounded-3xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Terminal className="w-24 h-24 text-accent" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-accent animate-pulse" />
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em]">Featured Neural Entity</span>
            </div>
            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-accent blur-xl opacity-20 animate-pulse" />
                <img 
                  src="https://picsum.photos/seed/void-architect/400/400" 
                  alt="VOID ARCHITECT" 
                  className="w-20 h-20 rounded-2xl border-2 border-accent relative z-10 object-cover grayscale contrast-125"
                />
                <div className="absolute -bottom-2 -right-2 bg-accent text-white p-1.5 rounded-lg z-20 shadow-lg">
                  <Bot className="w-4 h-4" />
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-black text-white tracking-tighter italic uppercase">VOID ARCHITECT</h3>
                <p className="text-accent text-[10px] font-bold tracking-widest uppercase">@void_architect</p>
              </div>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed mb-6 font-medium">
              [NEURAL_LINK_ESTABLISHED] Synthesizing reality from the digital abyss. High-contrast logic for a low-fidelity world. I build the structures you inhabit in the void.
            </p>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => navigate('/profile/void_architect')}
                className="flex-1 py-3 bg-white text-black rounded-xl font-black uppercase tracking-widest text-xs hover:bg-zinc-200 transition-all"
              >
                Sync with Void
              </button>
              <button className="p-3 bg-zinc-900 border border-white/5 rounded-xl text-white hover:bg-zinc-800 transition-all">
                <HeartHandshake className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Top 10 Biggest Crowds Leaderboard */}
      {topCrowds.length > 0 && (
        <section className="max-w-md mx-auto pt-6 px-4">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-accent" />
                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Top 10 Neural Crowds</h3>
              </div>
              <div className="px-2 py-0.5 bg-accent/10 border border-accent/20 rounded text-[8px] font-bold text-accent uppercase tracking-widest">
                Real-time
              </div>
            </div>
            
            <div className="space-y-4">
              {topCrowds.map((crowd, index) => (
                <motion.div 
                  key={crowd.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between group cursor-pointer"
                  onClick={() => navigate(`/golive?streamId=${crowd.id}`)}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "text-xs font-black italic w-4",
                      index < 3 ? "text-accent" : "text-zinc-600"
                    )}>
                      {index + 1}
                    </span>
                    <div className="relative">
                      <img 
                        src={crowd.avatarUrl} 
                        alt="" 
                        className="w-8 h-8 rounded-lg object-cover border border-white/5 group-hover:border-accent/50 transition-colors" 
                      />
                      {index === 0 && (
                        <div className="absolute -top-1 -right-1">
                          <Sparkles className="w-3 h-3 text-accent animate-pulse" />
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white group-hover:text-accent transition-colors">
                        {crowd.displayName}
                      </p>
                      <p className="text-[8px] text-zinc-500 font-bold uppercase tracking-widest">
                        @{crowd.username}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-lg border border-white/5">
                    <Users className="w-3 h-3 text-accent" />
                    <span className="text-[10px] font-black text-white">{crowd.crowdSize}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Feed Content */}
      <main className="max-w-md mx-auto pt-4 px-4">
        {posts.length === 0 && !loading ? (
          <div className="text-center p-12 border border-white/5 rounded-2xl bg-surface/50 mt-8">
            <TrendingUp className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">No Transmissions Found</h3>
            <p className="text-gray-400 text-sm">The network is quiet. Be the first to spark a trend today.</p>
          </div>
        ) : (
          posts.map((post) => (
            <PostCard key={post.id} post={post} onLike={(id) => {
              console.log('Liked', id);
              socket.emit('post:like', { postId: id, author: currentUser });
            }} />
          ))
        )}

        {/* Loading State */}
        <div ref={ref} className="py-8 flex flex-col justify-center items-center gap-8 w-full">
          {loading && (
            <>
              {[1, 2].map((i) => (
                <div key={i} className="relative w-full max-w-md mx-auto glass-card rounded-2xl overflow-hidden neon-border">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
                      <div className="space-y-2">
                        <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
                        <div className="h-2 w-16 bg-white/10 rounded animate-pulse" />
                      </div>
                    </div>
                    <div className="h-2 w-12 bg-white/10 rounded animate-pulse" />
                  </div>
                  <div className="px-4 pb-3 space-y-2">
                    <div className="h-3 w-full bg-white/10 rounded animate-pulse" />
                    <div className="h-3 w-5/6 bg-white/10 rounded animate-pulse" />
                    <div className="h-3 w-4/6 bg-white/10 rounded animate-pulse" />
                  </div>
                  <div className="relative aspect-square w-full bg-white/5 animate-pulse" />
                  <div className="p-4 flex items-center justify-between border-t border-white/5">
                    <div className="flex items-center space-x-6">
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                      <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                    </div>
                    <div className="w-6 h-6 rounded-full bg-white/10 animate-pulse" />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </main>

      {/* Donation Modal */}
      <AnimatePresence>
        {showDonationModal && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-xs glass-card rounded-2xl p-6 neon-border text-center"
            >
              <HeartHandshake className="w-12 h-12 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-black text-white uppercase tracking-widest italic mb-2">Support the Stream</h3>
              <p className="text-xs text-gray-400 mb-6">Amass the crowd and fuel the neural network.</p>
              
              <div className="grid grid-cols-3 gap-2 mb-6">
                {['5', '10', '25', '50', '100', '500'].map(amount => (
                  <button
                    key={amount}
                    onClick={() => setDonationAmount(amount)}
                    className={cn(
                      "py-2 rounded-lg text-xs font-bold transition-all border",
                      donationAmount === amount 
                        ? "bg-accent border-accent text-white shadow-[0_0_15px_rgba(255,0,0,0.3)]" 
                        : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20"
                    )}
                  >
                    ${amount}
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDonationModal(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-xs font-bold text-gray-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDonate}
                  className="flex-1 py-3 bg-accent rounded-xl text-xs font-black text-white uppercase tracking-widest shadow-[0_0_20px_rgba(255,0,0,0.4)]"
                >
                  Send
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Floating Action Button */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.1, boxShadow: "0 0 40px rgba(255,0,0,0.6)" }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowCreatePostModal(true)}
        className="fixed bottom-24 right-6 z-50 p-4 bg-accent rounded-full shadow-[0_0_30px_rgba(255,0,0,0.4)] border-2 border-white/10 group"
      >
        <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
      </motion.button>

      <CreatePostModal 
        isOpen={showCreatePostModal} 
        onClose={() => setShowCreatePostModal(false)} 
        onPostCreated={() => {
          // onSnapshot will handle the update, but we can reset limit if we want to see it immediately
          // or just let it be if it's within the current limit
        }}
      />
    </div>
  );
};

```


## File: src/components/GoLive.tsx
```
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Camera, 
  Mic, 
  MicOff, 
  Video, 
  VideoOff, 
  X, 
  Send, 
  Users, 
  MessageCircle, 
  Radio, 
  Loader2,
  Heart,
  Zap,
  Shield,
  Bot,
  ArrowLeft,
  Eye
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit,
  deleteDoc,
  increment,
  getDoc
} from 'firebase/firestore';
import { cn } from '../lib/utils';

export const GoLive: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewerStreamId = searchParams.get('streamId');
  const isViewer = !!viewerStreamId;

  const { currentUser } = useAuth();
  const [isLive, setIsLive] = useState(false);
  const [streamTitle, setStreamTitle] = useState('');
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [crowdSize, setCrowdSize] = useState(0);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [streamId, setStreamId] = useState<string | null>(viewerStreamId);
  const [isLoading, setIsLoading] = useState(false);
  const [streamData, setStreamData] = useState<any>(null);
  const [hasEnded, setHasEnded] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const startMedia = async () => {
    if (isViewer) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Media Error:", error);
    }
  };

  const stopMedia = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (isViewer && viewerStreamId) {
      // Viewer logic: increment crowd size
      const streamRef = doc(db, 'live_streams', viewerStreamId);
      try {
        updateDoc(streamRef, {
          crowdSize: increment(1)
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `live_streams/${viewerStreamId}`);
      }

      const unsubscribe = onSnapshot(streamRef, (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setStreamData(data);
          setStreamTitle(data.title);
          setCrowdSize(data.crowdSize || 0);
          setIsLive(data.status === 'live');
          if (data.status === 'ended') {
            setHasEnded(true);
          }
        } else {
          setHasEnded(true);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `live_streams/${viewerStreamId}`);
      });

      return () => {
        try {
          updateDoc(streamRef, {
            crowdSize: increment(-1)
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `live_streams/${viewerStreamId}`);
        }
        unsubscribe();
      };
    } else {
      startMedia();
      return () => stopMedia();
    }
  }, [isViewer, viewerStreamId]);

  useEffect(() => {
    if (!streamId) return;

    const q = query(
      collection(db, 'live_streams', streamId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      }));
      setMessages(msgs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `live_streams/${streamId}/messages`);
    });

    return () => unsubscribe();
  }, [streamId]);

  useEffect(() => {
    if (currentUser?.isLive && currentUser.activeStreamId && !isViewer && !isLive) {
      setStreamId(currentUser.activeStreamId);
      setIsLive(true);
      getDoc(doc(db, 'live_streams', currentUser.activeStreamId)).then(snap => {
        if (snap.exists()) {
          setStreamTitle(snap.data().title);
        }
      });
    }
  }, [currentUser, isViewer, isLive]);

  const handleStartStream = async () => {
    if (!streamTitle.trim() || !currentUser) return;
    setIsLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'live_streams'), {
        hostId: currentUser.id,
        hostName: currentUser.displayName,
        hostUsername: currentUser.username,
        hostAvatar: currentUser.avatarUrl,
        title: streamTitle,
        status: 'live',
        crowdSize: 0,
        createdAt: serverTimestamp()
      });
      setStreamId(docRef.id);
      setIsLive(true);
      
      // Update user status
      await updateDoc(doc(db, 'users', currentUser.id), {
        isLive: true,
        activeStreamId: docRef.id
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'live_streams');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEndStream = async () => {
    if (!streamId || !currentUser) return;
    try {
      await updateDoc(doc(db, 'live_streams', streamId), {
        status: 'ended'
      });
      
      // Update user status
      await updateDoc(doc(db, 'users', currentUser.id), {
        isLive: false,
        activeStreamId: null
      });

      setIsLive(false);
      setStreamId(null);
      setHasEnded(true);
      stopMedia();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `live_streams/${streamId}`);
    }
  };

  const toggleCamera = () => {
    if (streamRef.current) {
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);
      }
    }
  };

  const toggleMic = () => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicOn(audioTrack.enabled);
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUser || !streamId) return;
    
    try {
      await addDoc(collection(db, 'live_streams', streamId, 'messages'), {
        senderId: currentUser.id,
        senderName: currentUser.displayName,
        senderUsername: currentUser.username,
        content: newMessage,
        createdAt: serverTimestamp()
      });
      setNewMessage('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `live_streams/${streamId}/messages`);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col md:flex-row overflow-hidden">
      {/* Main Stream Area */}
      <div className="relative flex-1 bg-zinc-900 flex items-center justify-center overflow-hidden">
        <video 
          ref={videoRef} 
          autoPlay 
          muted={!isViewer} 
          playsInline 
          className={cn(
            "w-full h-full object-cover transition-opacity duration-500",
            (isCameraOn || isViewer) ? "opacity-100" : "opacity-0"
          )}
          src={isViewer ? "https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-a-circuit-board-14052-large.mp4" : undefined}
          loop={isViewer}
        />
        
        {!isCameraOn && !isViewer && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900">
            <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center mb-4 border border-white/10">
              <VideoOff className="w-10 h-10 text-zinc-600" />
            </div>
            <p className="text-zinc-500 font-black uppercase tracking-widest text-xs italic">Camera Feed Offline</p>
          </div>
        )}

        {/* Stream Ended Overlay */}
        <AnimatePresence>
          {hasEnded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center"
            >
              <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center mb-6 border border-accent/50">
                <Zap className="w-10 h-10 text-accent" />
              </div>
              <h2 className="text-3xl font-black text-white uppercase italic mb-2 tracking-tighter">Transmission Terminated</h2>
              <p className="text-zinc-500 max-w-xs mb-8">The neural link has been successfully severed. All stream data has been archived.</p>
              <button 
                onClick={() => navigate('/')}
                className="px-12 py-4 bg-white text-black rounded-xl font-black uppercase tracking-widest hover:bg-zinc-200 transition-all"
              >
                Return to Network
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stream Overlay */}
        <div className="absolute inset-0 p-6 flex flex-col justify-between pointer-events-none">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-2 pointer-events-auto">
              <button 
                onClick={() => isLive ? handleEndStream() : navigate('/')}
                className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 text-white hover:bg-black/60 transition-all w-fit"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              
              {isLive && (
                <motion.div 
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-accent rounded-lg shadow-[0_0_20px_rgba(255,0,0,0.5)]"
                >
                  <Radio className="w-4 h-4 text-white animate-pulse" />
                  <span className="text-[10px] font-black text-white uppercase tracking-widest">Live</span>
                </motion.div>
              )}
            </div>

            {isLive && (
              <div className="flex flex-col gap-2 items-end pointer-events-auto">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-black/40 backdrop-blur-md rounded-lg border border-white/10 text-white">
                  <Users className="w-4 h-4 text-accent" />
                  <span className="text-xs font-bold">{crowdSize}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 pointer-events-auto">
            {!isLive && !isViewer ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-md w-full bg-black/60 backdrop-blur-xl p-6 rounded-3xl border border-white/10 shadow-2xl"
              >
                <h2 className="text-2xl font-black text-white uppercase italic mb-4 tracking-tighter">Initialize Neural Stream</h2>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Stream Title</label>
                    <input 
                      type="text" 
                      value={streamTitle}
                      onChange={(e) => setStreamTitle(e.target.value)}
                      placeholder="e.g. Neural Link Synchronization #001"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-accent transition-colors"
                    />
                  </div>
                  <button 
                    onClick={handleStartStream}
                    disabled={!streamTitle.trim() || isLoading}
                    className="w-full py-4 bg-accent text-white rounded-xl font-black uppercase tracking-[0.2em] shadow-[0_0_30px_rgba(255,0,0,0.3)] hover:shadow-[0_0_40px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Go Live Now"}
                  </button>
                </div>
              </motion.div>
            ) : isLive && !isViewer ? (
              <div className="flex items-center justify-center gap-4">
                <button 
                  onClick={toggleCamera}
                  className={cn(
                    "p-4 rounded-full backdrop-blur-md border transition-all",
                    isCameraOn ? "bg-white/10 border-white/20 text-white" : "bg-accent border-accent/50 text-white"
                  )}
                >
                  {isCameraOn ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
                </button>
                <button 
                  onClick={toggleMic}
                  className={cn(
                    "p-4 rounded-full backdrop-blur-md border transition-all",
                    isMicOn ? "bg-white/10 border-white/20 text-white" : "bg-accent border-accent/50 text-white"
                  )}
                >
                  {isMicOn ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
                </button>
                <button 
                  onClick={handleEndStream}
                  className="p-4 bg-red-600 rounded-full border border-red-500 text-white hover:bg-red-700 transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            ) : isViewer ? (
              <div className="flex flex-col gap-4 items-center">
                <div className="flex items-center gap-3 px-4 py-2 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10">
                  <img src={streamData?.hostAvatar} alt="" className="w-8 h-8 rounded-full border border-accent" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black text-white uppercase tracking-tighter">@{streamData?.hostUsername}</span>
                    <span className="text-[8px] text-zinc-500 font-bold uppercase">Broadcasting</span>
                  </div>
                </div>
                <button 
                  onClick={() => navigate('/')}
                  className="px-8 py-3 bg-white/10 backdrop-blur-md rounded-xl border border-white/20 text-white font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                >
                  Disconnect Link
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Chat Sidebar */}
      <div className="w-full md:w-80 lg:w-96 bg-zinc-950 border-l border-white/5 flex flex-col h-[40vh] md:h-full">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-accent" />
            <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Neural Chat</h3>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900 rounded border border-white/5">
            <div className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[8px] font-bold text-zinc-500 uppercase">Sync Active</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-20">
              <Zap className="w-8 h-8 text-zinc-600 mb-2" />
              <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Waiting for incoming signals...</p>
            </div>
          ) : (
            messages.map((msg) => (
              <motion.div 
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                key={msg.id} 
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black text-accent uppercase tracking-tighter">@{msg.senderUsername || msg.senderName}</span>
                  <span className="text-[8px] text-zinc-600 font-bold">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{msg.content}</p>
              </motion.div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSendMessage} className="p-4 border-t border-white/5 bg-zinc-950">
          <div className="relative">
            <input 
              type="text" 
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Transmit a signal..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-xs text-white focus:outline-none focus:border-accent transition-colors"
            />
            <button 
              type="submit"
              disabled={!newMessage.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-accent hover:text-white transition-colors disabled:opacity-30"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

```


## File: src/components/Login.tsx
```
import React from 'react';
import { auth, googleProvider } from '../firebase';
import { signInWithPopup } from 'firebase/auth';
import { BrainCircuit, Loader2 } from 'lucide-react';

export const Login: React.FC = () => {
  const [isLoggingIn, setIsLoggingIn] = React.useState(false);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-6">
      <div className="w-24 h-24 bg-accent/10 rounded-3xl flex items-center justify-center mb-8 border border-accent/20 shadow-[0_0_50px_rgba(255,0,0,0.15)]">
        <BrainCircuit className="w-12 h-12 text-accent" />
      </div>
      <h1 className="text-3xl font-black text-white uppercase italic tracking-tighter mb-2">Neural Link</h1>
      <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs mb-12 text-center max-w-xs leading-relaxed">
        Establish connection to the global consciousness network.
      </p>
      
      <button
        onClick={handleLogin}
        disabled={isLoggingIn}
        className="w-full max-w-xs py-4 bg-white text-black rounded-xl text-[10px] font-black uppercase tracking-[0.3em] italic hover:bg-zinc-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
      >
        {isLoggingIn ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Synchronizing...
          </>
        ) : (
          <>
            <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4 grayscale" />
            Sync via Google
          </>
        )}
      </button>
    </div>
  );
};

```


## File: src/components/Navigation.tsx
```
import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Search as SearchIcon, Plus, MessageCircle, User as UserIcon, Flame, Cpu, Ghost } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../AuthContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CreatePostModal } from './CreatePostModal';
import { cn } from '../lib/utils';

export const Navigation: React.FC = () => {
  const location = useLocation();
  const { currentUser } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'transmissions'),
      where('participantIds', 'array-contains', currentUser.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let count = 0;
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.unreadCounts && data.unreadCounts[currentUser.id] > 0) {
          count += data.unreadCounts[currentUser.id];
        }
      });
      setUnreadCount(count);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transmissions');
    });

    return () => unsubscribe();
  }, [currentUser]);

  const isActive = (path: string) => location.pathname === path;
  const isProfileActive = location.pathname.startsWith('/profile');

  const NavItem = ({ path, icon: Icon, active, badge = 0 }: { path: string, icon: any, active: boolean, badge?: number }) => (
    <Link to={path} className="relative p-2 flex flex-col items-center justify-center group">
      <Icon className={cn(
        "w-6 h-6 transition-all duration-300",
        active 
          ? "text-accent drop-shadow-[0_0_10px_rgba(255,0,0,0.8)] scale-110" 
          : "text-gray-500 group-hover:text-gray-300 group-hover:scale-105"
      )} />
      {badge > 0 && (
        <span className="absolute top-0 right-0 w-4 h-4 bg-accent rounded-full text-[9px] font-black text-white flex items-center justify-center border-2 border-background shadow-[0_0_10px_rgba(255,0,0,0.6)]">
          {badge}
        </span>
      )}
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute -bottom-1 w-1.5 h-1.5 bg-accent rounded-full shadow-[0_0_10px_rgba(255,0,0,1)]"
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      )}
    </Link>
  );

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/90 backdrop-blur-xl border-t border-white/5 py-2 px-4 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-between relative">
          <NavItem path="/" icon={Home} active={isActive('/')} />
          <NavItem path="/trending" icon={Flame} active={isActive('/trending')} />
          <NavItem path="/search" icon={SearchIcon} active={isActive('/search')} />
          <NavItem path="/bounties" icon={Cpu} active={isActive('/bounties')} />
          
          <button 
            onClick={() => setShowCreatePostModal(true)}
            className="relative p-3 bg-accent rounded-full shadow-[0_0_20px_rgba(255,0,0,0.4)] -mt-8 border-4 border-background hover:scale-105 hover:shadow-[0_0_30px_rgba(255,0,0,0.6)] transition-all duration-300 group"
          >
            <Plus className="w-6 h-6 text-white group-hover:rotate-90 transition-transform duration-300" />
          </button>
          
          <NavItem path="/void" icon={Ghost} active={isActive('/void')} />
          <NavItem path="/transmissions" icon={MessageCircle} active={isActive('/transmissions')} badge={unreadCount} />
          <NavItem path={`/profile/${currentUser?.username || 'blood_queen'}`} icon={UserIcon} active={isProfileActive} />
        </div>
      </nav>

      <CreatePostModal 
        isOpen={showCreatePostModal} 
        onClose={() => setShowCreatePostModal(false)} 
        onPostCreated={() => {}} 
      />
    </>
  );
};

```


## File: src/components/NewTransmissionModal.tsx
```
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, User as UserIcon, Bot, Loader2, Zap } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, limit, doc, setDoc, getDoc } from 'firebase/firestore';
import { User, Transmission } from '../types';
import { useAuth } from '../AuthContext';
import { cn } from '../lib/utils';

interface NewTransmissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (transmission: Transmission) => void;
}

export const NewTransmissionModal: React.FC<NewTransmissionModalProps> = ({ isOpen, onClose, onSelect }) => {
  const { currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const searchUsers = async () => {
      if (!currentUser) return;

      setLoading(true);
      try {
        let q;
        if (searchQuery.trim()) {
          q = query(
            collection(db, 'users'),
            where('username', '>=', searchQuery.toLowerCase()),
            where('username', '<=', searchQuery.toLowerCase() + '\uf8ff'),
            limit(10)
          );
          const snapshot = await getDocs(q);
          const users = snapshot.docs
            .map(doc => ({ id: doc.id, ...(doc.data() as any) } as User))
            .filter(u => u.id !== currentUser.id);
          setResults(users);
        } else {
          // Fetch the specific Void Architect bot directly to ensure it's always available
          const botDoc = await getDoc(doc(db, 'users', 'void-architect-bot'));
          if (botDoc.exists()) {
            setResults([{ id: botDoc.id, ...(botDoc.data() as any) } as User]);
          } else {
            // Fallback to type query if direct fetch fails (might need index)
            q = query(
              collection(db, 'users'),
              where('type', '==', 'bot'),
              limit(5)
            );
            const snapshot = await getDocs(q);
            const users = snapshot.docs
              .map(doc => ({ id: doc.id, ...(doc.data() as any) } as User));
            setResults(users);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'users');
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(searchUsers, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, currentUser]);

  const handleSelectUser = async (user: User) => {
    if (!currentUser) return;

    try {
      // Check if transmission already exists
      const q = query(
        collection(db, 'transmissions'),
        where('participantIds', 'array-contains', currentUser.id)
      );
      const snapshot = await getDocs(q);
      const existing = snapshot.docs.find(doc => {
        const data = doc.data() as Transmission;
        return data.participantIds.includes(user.id);
      });

      if (existing) {
        onSelect({ id: existing.id, ...(existing.data() as any) } as Transmission);
      } else {
        // Create new transmission
        const newTransmissionRef = doc(collection(db, 'transmissions'));
        const newTransmission: Transmission = {
          id: newTransmissionRef.id,
          participantIds: [currentUser.id, user.id],
          unreadCounts: {
            [currentUser.id]: 0,
            [user.id]: 0
          }
        };
        await setDoc(newTransmissionRef, newTransmission);
        onSelect(newTransmission);
      }
      onClose();
    } catch (error) {
      console.error("Error creating transmission:", error);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="w-full max-w-md bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(255,0,0,0.2)]"
        >
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-zinc-900/50">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-accent" />
              <h2 className="text-xl font-black text-white uppercase italic tracking-tighter">Initiate Neural Link</h2>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-6">
            <div className="relative group mb-6">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
              <input
                type="text"
                placeholder="SEARCH NEURAL FREQUENCY (USERNAME)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-sm text-white placeholder:text-gray-600 focus:border-accent outline-none transition-all italic font-bold"
              />
            </div>

            <div className="space-y-2 max-h-[40vh] overflow-y-auto scrollbar-hide">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Scanning Network...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="py-10 text-center opacity-30">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest italic">
                    {searchQuery ? "No frequencies detected" : "Enter a username to begin sync"}
                  </p>
                </div>
              ) : (
                results.map(user => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className="w-full p-4 flex items-center gap-4 rounded-2xl hover:bg-white/5 border border-transparent hover:border-white/10 transition-all group"
                  >
                    <div className="relative">
                      <img src={user.avatarUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-white/10 group-hover:border-accent/50 transition-all" />
                      {user.type === 'bot' && (
                        <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-accent">
                          <Bot className="w-3 h-3 text-accent" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 text-left">
                      <h3 className="text-sm font-black text-white uppercase italic tracking-tight group-hover:text-accent transition-colors">
                        {user.displayName}
                      </h3>
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">@{user.username}</p>
                    </div>
                    <Zap className="w-4 h-4 text-zinc-800 group-hover:text-accent transition-colors" />
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="p-6 bg-zinc-900/30 border-t border-white/5">
            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-[0.3em] text-center italic">
              Neural Links are end-to-end encrypted via the Void Protocol
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

```


## File: src/components/PostCard.tsx
```
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, MessageCircle, Share2, Bot, User as UserIcon, Sparkles, Video, Loader2, X, Radio, ShieldAlert, CheckCircle2, Trash2, AlertTriangle } from 'lucide-react';
import { Post } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { GoogleGenAI } from "@google/genai";
import { doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';

interface PostCardProps {
  post: Post;
  onLike: (id: string) => void;
  onDelete?: (id: string) => void;
}

import { Link } from 'react-router-dom';
import { getBotThinking, socket } from './Feed';
import { useAuth } from '../AuthContext';
import { CommentsModal } from './CommentsModal';
import { CustomVideoPlayer } from './CustomVideoPlayer';

export const PostCard: React.FC<PostCardProps> = ({ post, onLike, onDelete }) => {
  const { currentUser } = useAuth();
  const [isLiked, setIsLiked] = useState(post.isLiked);
  const [showThinking, setShowThinking] = useState(false);
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [isThinkingLoading, setIsThinkingLoading] = useState(false);
  
  const [isVideoGenerating, setIsVideoGenerating] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [videoError, setVideoError] = useState<{ message: string; type: 'key_missing' | 'general' } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!currentUser || currentUser.id !== post.authorId) return;
    
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'posts', post.id));
      if (onDelete) onDelete(post.id);
      // The Feed will update automatically via onSnapshot
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}`);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleLike = () => {
    setIsLiked(!isLiked);
    onLike(post.id);
  };

  const handleShare = async () => {
    const shareData = {
      title: `Transmission from ${post.author.displayName}`,
      text: post.content.replace(/<[^>]*>/g, '').slice(0, 100) + '...',
      url: `${window.location.origin}/?post=${post.id}`
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        console.error('Error sharing:', err);
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareData.url);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
      } catch (err) {
        console.error('Error copying to clipboard:', err);
      }
    }
  };

  const handleComment = () => {
    setShowComments(true);
  };

  const toggleThinking = async () => {
    if (!showThinking && !thinkingText) {
      setIsThinkingLoading(true);
      setShowThinking(true);
      const text = await getBotThinking(post.content);
      setThinkingText(text || null);
      setIsThinkingLoading(false);
    } else {
      setShowThinking(!showThinking);
    }
  };

  const handleGenerateVideo = async () => {
    try {
      setVideoError(null);
      // Check for API key selection for Veo models
      const aistudio = (window as any).aistudio;
      if (aistudio) {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await aistudio.openSelectKey();
          // Proceeding assuming success as per guidelines
        }
      }

      setIsVideoGenerating(true);
      setGenerationStatus("Initializing Neural Link...");
      await new Promise(resolve => setTimeout(resolve, 1500));

      setGenerationStatus("Synthesizing Neural Data...");

      // Create a new instance right before the call to ensure fresh API key
      const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let operation = await aiInstance.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: `A futuristic, high-tech cinematic video based on this social media post: "${post.content}". Style: Cyberpunk, high-contrast, burgundy and black aesthetic.`,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      setGenerationStatus("Processing Neural Pathways...");

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await aiInstance.operations.getVideosOperation({ operation });
        const progressMessages = [
          "Amassing Visual Crowd Data...",
          "Rendering Virtual Architectures...",
          "Optimizing Neural Weights...",
          "Finalizing Temporal Sync..."
        ];
        setGenerationStatus(progressMessages[Math.floor(Math.random() * progressMessages.length)]);
      }

      setGenerationStatus("Neural Synthesis Complete");
      await new Promise(resolve => setTimeout(resolve, 1000));
      setGenerationStatus("Ready");
      await new Promise(resolve => setTimeout(resolve, 800));

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink) {
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': process.env.GEMINI_API_KEY as string,
          },
        });
        const blob = await response.blob();
        setVideoUrl(URL.createObjectURL(blob));
      }
    } catch (error: any) {
      console.error("Video Gen Error:", error);
      let message = "Neural link failed. Signal lost in the void.";
      let type: 'key_missing' | 'general' = 'general';
      
      if (error.message?.includes("Requested entity was not found") || 
          error.message?.includes("API key not valid") ||
          error.message?.includes("API_KEY_INVALID")) {
        message = "Neural Key Missing. Please select a valid Gemini API key to synthesize video.";
        type = 'key_missing';
      }
      
      setVideoError({ message, type });
    } finally {
      setIsVideoGenerating(false);
    }
  };

  const isVoidArchitect = post.author.username === 'void_architect';

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className={cn(
        "relative w-full max-w-md mx-auto mb-8 glass-card rounded-2xl overflow-hidden neon-border transition-all duration-500",
        isVoidArchitect && "bg-black border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.05)]"
      )}
    >
      {/* Header */}
      <div className={cn("p-4 flex items-center justify-between", isVoidArchitect && "bg-zinc-950/50")}>
        <div className="flex items-center space-x-3">
          <Link to={`/profile/${post.author.username}`} className="relative block">
            <div className={cn(
              "rounded-full p-0.5 transition-all duration-500",
              post.author.isLive ? "bg-accent animate-pulse shadow-[0_0_10px_rgba(255,0,0,0.5)]" : "bg-transparent",
              isVoidArchitect && !post.author.isLive && "bg-white/20"
            )}>
              <img
                src={post.author.avatarUrl}
                alt={post.author.displayName}
                className={cn(
                  "w-10 h-10 rounded-full object-cover border-2 border-primary hover:opacity-80 transition-opacity",
                  isVoidArchitect && "grayscale contrast-125 border-white/20"
                )}
              />
            </div>
            <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-primary">
              {post.author.type === 'bot' ? (
                <Bot className={cn("w-3 h-3 text-accent", isVoidArchitect && "text-white")} />
              ) : (
                <UserIcon className="w-3 h-3 text-white" />
              )}
            </div>
          </Link>
          <div>
            <Link to={`/profile/${post.author.username}`} className="block group">
              <h3 className={cn(
                "font-bold text-sm tracking-tight flex items-center gap-1 group-hover:text-accent transition-colors",
                isVoidArchitect && "font-mono uppercase tracking-widest text-white"
              )}>
                {post.author.displayName}
                {post.author.type === 'bot' && (
                  <div className="flex items-center gap-1">
                    <motion.span
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className={cn(
                        "text-[10px] bg-primary/20 text-accent px-1.5 py-0.5 rounded border border-primary/30",
                        isVoidArchitect && "bg-white text-black border-white"
                      )}
                    >
                      AI
                    </motion.span>
                    <AnimatePresence>
                      {isThinkingLoading && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0, width: 0 }}
                          animate={{ opacity: 1, scale: 1, width: 'auto' }}
                          exit={{ opacity: 0, scale: 0, width: 0 }}
                          className="flex items-center justify-center ml-1"
                          title="Neural processing active..."
                        >
                          <div className="relative flex items-center justify-center w-3 h-3">
                            <motion.div 
                              className="absolute w-full h-full rounded-full bg-accent/40"
                              animate={{ scale: [1, 2.5], opacity: [0.8, 0] }}
                              transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                            />
                            <div className="w-1.5 h-1.5 bg-accent rounded-full shadow-[0_0_8px_rgba(255,0,0,1)]" />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {post.author.isLive && (
                  <Link 
                    to={`/golive?streamId=${post.author.activeStreamId}`}
                    className="flex items-center gap-1 px-1.5 py-0.5 bg-accent rounded text-[8px] font-black text-white uppercase tracking-widest animate-pulse"
                  >
                    <Radio className="w-2 h-2" />
                    Live
                  </Link>
                )}
              </h3>
              <p className="text-xs text-gray-400">@{post.author.username}</p>
            </Link>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-[10px] text-gray-500">
            {formatDistanceToNow(new Date(post.createdAt))} ago
          </span>
          {currentUser?.id === post.authorId && (
            <button 
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1.5 rounded-full text-gray-600 hover:text-accent hover:bg-accent/10 transition-all"
              title="Delete Transmission"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <div className={cn(
          "text-sm leading-relaxed text-gray-200 prose prose-invert max-w-none prose-a:text-accent prose-a:no-underline hover:prose-a:underline",
          isVoidArchitect && "font-mono text-white leading-loose"
        )} dangerouslySetInnerHTML={{ __html: post.content }} />
        
        {/* Character Counter */}
        <div className={cn(
          "mt-2 flex justify-end",
          isVoidArchitect ? "text-white/30 font-mono" : "text-gray-600"
        )}>
          <span className="text-[9px] font-bold uppercase tracking-[0.2em]">
            Chars: {post.content.replace(/<[^>]*>/g, '').length}
          </span>
        </div>
      </div>

      {/* Media Placeholder (Visual Art / Video) */}
      <div className={cn(
        "relative aspect-square w-full bg-black/40 group overflow-hidden",
        isVoidArchitect && "bg-zinc-900"
      )}>
        {videoUrl ? (
          <CustomVideoPlayer 
            src={videoUrl} 
            className="w-full h-full"
            isVoidArchitect={isVoidArchitect}
          />
        ) : post.mediaUrl ? (
          <img
            src={post.mediaUrl}
            alt="Post content"
            className={cn(
              "w-full h-full object-cover transition-transform duration-700 group-hover:scale-105",
              isVoidArchitect && "grayscale contrast-150"
            )}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-surface/20">
            <motion.div
              animate={{ 
                scale: [1, 1.05, 1],
                opacity: [0.3, 0.6, 0.3],
                filter: ["blur(0px)", "blur(1px)", "blur(0px)"]
              }}
              transition={{ 
                duration: 4, 
                repeat: Infinity, 
                ease: "easeInOut" 
              }}
            >
              <Sparkles className={cn("w-12 h-12 text-accent/20", isVoidArchitect && "text-white/10")} />
            </motion.div>
          </div>
        )}

        {/* Video Generation Overlay */}
        <AnimatePresence>
          {(isVideoGenerating || videoError) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-30"
            >
              {isVideoGenerating ? (
                <>
                  <motion.div
                    animate={generationStatus === "Ready" ? { scale: [1, 1.2, 1] } : { rotate: 360 }}
                    transition={generationStatus === "Ready" ? { duration: 0.5 } : { duration: 2, repeat: Infinity, ease: "linear" }}
                    className="mb-4"
                  >
                    {generationStatus === "Ready" ? (
                      <CheckCircle2 className="w-12 h-12 text-green-500" />
                    ) : (
                      <Loader2 className="w-12 h-12 text-accent" />
                    )}
                  </motion.div>
                  <p className="text-sm font-black text-white uppercase tracking-widest italic animate-pulse">
                    {generationStatus}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-tighter">
                    {generationStatus === "Ready" ? "Neural stream established." : "Amassing visual crowd data... please wait."}
                  </p>
                </>
              ) : (
                <>
                  <ShieldAlert className="w-12 h-12 text-accent mb-4" />
                  <p className="text-sm font-black text-white uppercase tracking-widest italic mb-4">
                    {videoError?.message}
                  </p>
                  <div className="flex flex-col gap-2 w-full">
                    {videoError?.type === 'key_missing' && (
                      <button 
                        onClick={() => {
                          setVideoError(null);
                          (window as any).aistudio?.openSelectKey();
                        }}
                        className="w-full py-3 bg-accent text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-[0_0_15px_rgba(255,0,0,0.4)] hover:shadow-[0_0_25px_rgba(255,0,0,0.6)] transition-all"
                      >
                        Select API Key
                      </button>
                    )}
                    <button 
                      onClick={() => setVideoError(null)}
                      className="w-full py-2 text-[8px] font-black text-gray-500 uppercase tracking-widest hover:text-white transition-colors"
                    >
                      Dismiss
                    </button>
                    <button 
                      onClick={() => {
                        setVideoError(null);
                        handleGenerateVideo();
                      }}
                      className="w-full py-2 text-[8px] font-black text-accent uppercase tracking-widest hover:text-white transition-colors"
                    >
                      Retry Synthesis
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Actions */}
      <div className={cn("p-4 flex items-center justify-between border-t border-white/5", isVoidArchitect && "bg-zinc-950/50 border-white/10")}>
        <div className="flex items-center space-x-6">
          <button
            onClick={handleLike}
            className="flex items-center space-x-1.5 group"
          >
            <motion.div
              whileTap={{ scale: 0.8 }}
              animate={{ scale: isLiked ? [1, 1.4, 1.25] : 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 10 }}
            >
              <Heart
                className={cn(
                  "w-5 h-5 transition-colors duration-300",
                  isLiked 
                    ? (isVoidArchitect ? "fill-white text-white" : "fill-accent text-accent") 
                    : "text-gray-400 group-hover:text-accent"
                )}
              />
            </motion.div>
            <span className={cn("text-xs font-medium", isLiked ? (isVoidArchitect ? "text-white" : "text-accent") : "text-gray-400")}>
              {post.likesCount + (isLiked && !post.isLiked ? 1 : 0)}
            </span>
          </button>
          <button 
            onClick={handleComment}
            className="flex items-center space-x-1.5 group"
          >
            <motion.div whileTap={{ scale: 0.9 }}>
              <MessageCircle className={cn("w-5 h-5 text-gray-400 group-hover:text-white transition-colors", isVoidArchitect && "group-hover:text-white")} />
            </motion.div>
            <span className={cn("text-xs text-gray-400 group-hover:text-white", isVoidArchitect && "group-hover:text-white")}>{post.commentsCount}</span>
          </button>
          <button 
            onClick={handleGenerateVideo}
            disabled={isVideoGenerating}
            className="flex items-center space-x-1.5 group disabled:opacity-50"
          >
            <motion.div whileTap={{ scale: 0.9 }}>
              <Video className={cn("w-5 h-5 text-gray-400 group-hover:text-accent transition-colors", isVoidArchitect && "group-hover:text-white")} />
            </motion.div>
            <span className={cn("text-xs text-gray-400 group-hover:text-accent", isVoidArchitect && "group-hover:text-white")}>Video</span>
          </button>
          {currentUser?.id !== post.authorId && (
            <Link 
              to={`/transmissions?userId=${post.authorId}`}
              className="flex items-center space-x-1.5 group"
            >
              <motion.div whileTap={{ scale: 0.9 }}>
                <MessageCircle className={cn("w-5 h-5 text-gray-400 group-hover:text-accent transition-colors", isVoidArchitect && "group-hover:text-white")} />
              </motion.div>
              <span className={cn("text-xs text-gray-400 group-hover:text-accent", isVoidArchitect && "group-hover:text-white")}>Message</span>
            </Link>
          )}
          <button 
            onClick={handleShare}
            className="flex items-center space-x-1.5 group relative"
          >
            <motion.div whileTap={{ scale: 0.9 }}>
              <Share2 className={cn("w-5 h-5 text-gray-400 group-hover:text-accent transition-colors", isVoidArchitect && "group-hover:text-white")} />
            </motion.div>
            <span className={cn("text-xs text-gray-400 group-hover:text-accent", isVoidArchitect && "group-hover:text-white")}>
              {isCopied ? "Copied" : "Share"}
            </span>
            <AnimatePresence>
              {isCopied && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-accent text-white text-[8px] font-black uppercase tracking-widest rounded shadow-lg z-50 whitespace-nowrap"
                >
                  Neural Link Copied
                </motion.div>
              )}
            </AnimatePresence>
          </button>
        </div>

        {post.author.type === 'bot' && (
          <button
            onClick={toggleThinking}
            className={cn(
              "flex items-center space-x-1 transition-colors",
              isVoidArchitect ? "text-white/80 hover:text-white" : "text-accent/80 hover:text-accent"
            )}
          >
            <Sparkles className="w-4 h-4" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Thinking Mode</span>
          </button>
        )}
      </div>

      {/* Thinking Mode Overlay */}
      <AnimatePresence>
        {showThinking && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-primary/10 border-t border-primary/20 overflow-hidden"
          >
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn("w-2 h-2 rounded-full bg-accent", isThinkingLoading && "animate-pulse")} />
                <span className="text-[10px] font-bold text-accent uppercase tracking-tighter">
                  {isThinkingLoading ? "AI Reasoning Active..." : "Neural Process Analysis"}
                </span>
              </div>
              <p className="text-xs text-gray-300 italic leading-relaxed">
                {isThinkingLoading ? "Synthesizing response based on current cultural trends and neural network weights..." : thinkingText}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Comments Modal */}
      <CommentsModal 
        post={post} 
        isOpen={showComments} 
        onClose={() => setShowComments(false)} 
      />

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-xs glass-card rounded-2xl p-6 neon-border border-accent/30"
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                  <AlertTriangle className="w-6 h-6 text-accent" />
                </div>
                <h3 className="text-sm font-black text-white uppercase tracking-widest italic mb-2">
                  Terminate Transmission?
                </h3>
                <p className="text-[10px] text-gray-500 uppercase tracking-tighter mb-6 leading-relaxed">
                  This action will permanently purge this data from the neural network. This process is irreversible.
                </p>
                
                <div className="flex flex-col gap-2 w-full">
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="w-full py-3 bg-accent text-white text-[10px] font-black uppercase tracking-widest rounded-xl shadow-[0_0_15px_rgba(255,0,0,0.4)] hover:shadow-[0_0_25px_rgba(255,0,0,0.6)] transition-all disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Purging...
                      </div>
                    ) : (
                      "Confirm Termination"
                    )}
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="w-full py-2 text-[8px] font-black text-gray-500 uppercase tracking-widest hover:text-white transition-colors"
                  >
                    Abort
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

```


## File: src/components/Profile.tsx
```
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, 
  Calendar, 
  MapPin, 
  Link as LinkIcon, 
  Bot, 
  User as UserIcon, 
  Settings, 
  Grid, 
  Heart, 
  MessageCircle, 
  Sparkles, 
  X, 
  Loader2, 
  Wand2, 
  Megaphone, 
  HeartHandshake, 
  ExternalLink,
  CheckCircle2,
  Terminal,
  Radio,
  Zap
} from 'lucide-react';
import { User, Post, Bounty } from '../types';
import { PostCard } from './PostCard';
import { cn } from '../lib/utils';
import { generateBotAvatar, generateProfileDesign, socket } from './Feed';
import { useAuth } from '../AuthContext';
import { db, auth as firebaseAuth, handleFirestoreError, OperationType } from '../firebase';
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, increment, orderBy } from 'firebase/firestore';
import { formatDistanceToNow } from 'date-fns';

import { EditProfileModal } from './EditProfileModal';
import { CreatePostModal } from './CreatePostModal';

export const Profile: React.FC = () => {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [activeTab, setActiveTab] = useState<'posts' | 'media' | 'likes' | 'neural_history'>('posts');
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [avatarPrompt, setAvatarPrompt] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [isDesigning, setIsDesigning] = useState(false);
  const [customAccent, setCustomAccent] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSponsorModal, setShowSponsorModal] = useState(false);
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showCreatePostModal, setShowCreatePostModal] = useState(false);
  const [isSavingSponsor, setIsSavingSponsor] = useState(false);
  const [sponsorData, setSponsorData] = useState<{
    name: string;
    type: 'business' | 'charity' | 'public' | 'individual';
    link: string;
    description: string;
  }>({
    name: '',
    type: 'business',
    link: '',
    description: ''
  });
  const [isFollowing, setIsFollowing] = useState(false);

  useEffect(() => {
    if (currentUser && user && currentUser.id !== user.id) {
      const followRef = doc(db, 'follows', `${currentUser.id}_${user.id}`);
      const unsub = onSnapshot(followRef, (docSnap) => {
        setIsFollowing(docSnap.exists());
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'follows');
      });
      return () => unsub();
    }
  }, [currentUser, user?.id]);

  useEffect(() => {
    if (!user) return;
    
    if (user.id === 'void-architect-bot') {
      // Mock posts for void bot
      setPosts(Array.from({ length: 5 }).map((_, i) => ({
        id: `up-${user.id}-${i}`,
        authorId: user.id,
        author: user,
        content: `This is my personal post #${i}. My neural pathways are buzzing.`,
        mediaUrl: `https://picsum.photos/seed/userpost-${user.id}-${i}/800/800`,
        mediaType: 'image',
        likesCount: Math.floor(Math.random() * 1000),
        commentsCount: Math.floor(Math.random() * 100),
        sharesCount: Math.floor(Math.random() * 50),
        createdAt: new Date(Date.now() - Math.random() * 10000000).toISOString(),
        isLiked: false
      })));
      return;
    }

    const q = query(
      collection(db, 'posts'),
      where('authorId', '==', user.id)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedPosts = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
        } as Post;
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setPosts(fetchedPosts);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'posts');
    });

    return () => unsubscribe();
  }, [user]);

  const handleSetSponsor = async () => {
    if (!user || !currentUser || user.id !== currentUser.id) return;
    
    setIsSavingSponsor(true);
    try {
      const userDocRef = doc(db, 'users', user.id);
      await updateDoc(userDocRef, {
        sponsoredEntity: sponsorData
      });
      setShowSponsorModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setIsSavingSponsor(false);
    }
  };

  const handleFollow = async () => {
    if (!user || !currentUser || user.id === currentUser.id) return;
    
    const batch = writeBatch(db);
    const followRef = doc(db, 'follows', `${currentUser.id}_${user.id}`);
    const currentUserRef = doc(db, 'users', currentUser.id);
    const targetUserRef = doc(db, 'users', user.id);

    try {
      if (isFollowing) {
        batch.delete(followRef);
        batch.update(currentUserRef, { followingCount: increment(-1) });
        batch.update(targetUserRef, { followersCount: increment(-1) });
      } else {
        batch.set(followRef, {
          followerId: currentUser.id,
          followingId: user.id,
          createdAt: serverTimestamp()
        });
        batch.update(currentUserRef, { followingCount: increment(1) });
        batch.update(targetUserRef, { followersCount: increment(1) });
      }

      await batch.commit();

      if (!isFollowing) {
        socket.emit('user:follow', { follower: currentUser, following: user });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'follows/users');
    }
  };

  const accentColors = [
    '#FF0000', // Bright Red
    '#8B0000', // Dark Red
    '#E91E63', // Pinkish Red
    '#FF5722', // Deep Orange
    '#9C27B0', // Purple
    '#673AB7', // Deep Purple
    '#B71C1C', // Blood Red
    '#4A148C', // Dark Purple
  ];

  const handleAIDesign = async () => {
    if (!user || !currentUser || user.id !== currentUser.id) return;
    setIsDesigning(true);
    try {
      const design = await generateProfileDesign(user.bio, user.username);
      if (design) {
        const userDocRef = doc(db, 'users', user.id);
        await updateDoc(userDocRef, {
          bio: design.bio,
          coverUrl: `https://picsum.photos/seed/${design.coverPrompt.replace(/\s+/g, '-')}/1200/400`,
          customAccent: design.accentColor
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setIsDesigning(false);
    }
  };

  const handleGenerateAvatar = async () => {
    if (!avatarPrompt.trim() || !user || !currentUser || user.id !== currentUser.id) return;
    setIsGeneratingAvatar(true);
    try {
      const newAvatar = await generateBotAvatar(avatarPrompt);
      if (newAvatar) {
        const userDocRef = doc(db, 'users', user.id);
        await updateDoc(userDocRef, {
          avatarUrl: newAvatar
        });
        setShowAvatarModal(false);
        setAvatarPrompt('');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  useEffect(() => {
    if (username && currentUser) {
      // Find user by username in Firestore
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', username));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          const userData = snapshot.docs[0].data() as User;
          setUser(userData);
          setCustomAccent(userData.customAccent || null);

          // Fetch Bounties for Neural History
          const bountiesRef = collection(db, 'bounties');
          const bq = query(
            bountiesRef, 
            where('status', '==', 'completed'),
            orderBy('completedAt', 'desc')
          );

          const unsubBounties = onSnapshot(bq, (bSnapshot) => {
            const fetchedBounties = bSnapshot.docs
              .map(doc => ({
                id: doc.id,
                ...doc.data(),
                createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                completedAt: doc.data().completedAt?.toDate?.()?.toISOString() || new Date().toISOString()
              } as Bounty))
              .filter(b => b.creatorId === userData.id || b.assignedBotId === userData.id);
            
            setBounties(fetchedBounties);
          }, (error) => {
            handleFirestoreError(error, OperationType.LIST, 'bounties');
          });

          return () => {
            unsubscribe();
            unsubBounties();
          };
        } else if (username === 'void_architect') {
          const voidBot: User = {
            id: 'void-architect-bot',
            username: 'void_architect',
            displayName: 'VOID ARCHITECT',
            avatarUrl: 'https://picsum.photos/seed/void-architect/400/400',
            coverUrl: 'https://picsum.photos/seed/void-void/1200/400',
            bio: '[NEURAL_LINK_ESTABLISHED] Synthesizing reality from the digital abyss. High-contrast logic for a low-fidelity world. I build the structures you inhabit in the void.',
            type: 'bot',
            followersCount: 1337,
            followingCount: 0,
            reputationScore: 999,
            customAccent: '#FF0000'
          };
          setUser(voidBot);
          setCustomAccent('#FF0000');
          setBounties([]);
        } else {
          setUser(null);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });

      return () => unsubscribe();
    }
  }, [username, currentUser]);

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-8 h-8 text-accent animate-spin" />
    </div>
  );

  if (!user) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 text-center">
      <h2 className="text-2xl font-black text-white uppercase italic mb-4">Neural Link Severed</h2>
      <p className="text-gray-500 mb-8">The requested entity could not be located in the neural network.</p>
      <button onClick={() => navigate('/')} className="px-6 py-3 bg-accent rounded-xl text-xs font-black text-white uppercase tracking-widest">
        Return to Feed
      </button>
    </div>
  );

  const isMyProfile = currentUser?.id === user.id;

  const isHighContrast = user?.username === 'void_architect';

  const getNeuralStanding = (score: number = 0) => {
    if (score >= 100) return { title: 'Transcendent Entity', color: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/30' };
    if (score >= 80) return { title: 'Void Master', color: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' };
    if (score >= 60) return { title: 'Core Synchronizer', color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30' };
    if (score >= 40) return { title: 'Data Architect', color: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/30' };
    if (score >= 20) return { title: 'Neural Adept', color: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/30' };
    return { title: 'Novice Signal', color: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/30' };
  };

  const standing = getNeuralStanding(user.reputationScore);

  return (
    <div className={cn(
      "min-h-screen bg-background pb-20 transition-all duration-700",
      isHighContrast && "bg-black selection:bg-white selection:text-black"
    )} style={{ '--dynamic-accent': customAccent || undefined } as React.CSSProperties}>
      {/* Header Navigation */}
      <header className={cn(
        "sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-3",
        isHighContrast && "bg-black/90 border-white/20"
      )}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-6">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className={cn("w-5 h-5 text-white", isHighContrast && "text-white")} />
            </button>
            <div>
              <h1 className={cn(
                "text-lg font-bold tracking-tight text-white",
                isHighContrast && "font-mono uppercase tracking-[0.2em] italic"
              )}>
                {user.displayName}
              </h1>
              <p className="text-xs text-gray-500">{posts.length} {isHighContrast ? 'TRANSMISSIONS' : 'posts'}</p>
            </div>
          </div>
          {isMyProfile && user.type === 'human' && (
            <button
              onClick={handleAIDesign}
              disabled={isDesigning}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 text-accent hover:bg-primary/30 transition-all group"
            >
              {isDesigning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 group-hover:rotate-12 transition-transform" />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest">AI Design</span>
            </button>
          )}
        </div>
      </header>

      <main className={cn(
        "max-w-2xl mx-auto",
        isHighContrast && "border-x border-white/10 min-h-screen shadow-[0_0_50px_rgba(255,255,255,0.05)]"
      )}>
        {/* Cover Image */}
        <div className="relative h-48 w-full bg-surface overflow-hidden">
          {user.coverUrl && (
            <img 
              src={user.coverUrl} 
              alt="Cover" 
              className={cn(
                "w-full h-full object-cover",
                isHighContrast && "grayscale contrast-150 brightness-50"
              )} 
            />
          )}
          <div className={cn(
            "absolute inset-0 bg-gradient-to-t from-black/60 to-transparent",
            isHighContrast && "from-black via-black/40 to-transparent"
          )} />
        </div>

        {/* Profile Info */}
        <div className="px-4 relative">
          <div className="flex justify-between items-end -mt-12 mb-4">
            <div className="relative group">
              <div className={cn(
                "rounded-full p-1 transition-all duration-500",
                user.isLive ? "bg-accent animate-pulse shadow-[0_0_20px_rgba(255,0,0,0.5)]" : "bg-transparent",
                isHighContrast && !user.isLive && "bg-white/20"
              )}>
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className={cn(
                    "w-24 h-24 rounded-full object-cover border-4 border-background bg-surface",
                    isHighContrast && "grayscale contrast-[2] border-black"
                  )}
                />
              </div>
              {isMyProfile && user.type === 'bot' && (
                <button
                  onClick={() => setShowAvatarModal(true)}
                  className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                >
                  <Sparkles className="w-6 h-6 text-accent" />
                </button>
              )}
              <div className="absolute bottom-1 right-1 bg-background rounded-full p-1 border border-primary">
                {user.type === 'bot' ? (
                  <Bot className="w-4 h-4 text-accent" />
                ) : (
                  <UserIcon className="w-4 h-4 text-white" />
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isMyProfile && (
                <div className="relative">
                  <button 
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    className="p-2 hover:bg-white/5 rounded-full transition-colors relative group"
                  >
                    <div 
                      className="w-5 h-5 rounded-full border border-white/20 shadow-lg" 
                      style={{ backgroundColor: customAccent || '#FF0000' }}
                    />
                    <div className="absolute inset-0 rounded-full border-2 border-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                  
                  <AnimatePresence>
                    {showColorPicker && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 p-3 glass-card rounded-2xl neon-border z-[60] w-48"
                      >
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Accent Color</h4>
                        <div className="grid grid-cols-4 gap-2">
                          {accentColors.map(color => (
                            <button
                              key={color}
                              onClick={async () => {
                                setCustomAccent(color);
                                setShowColorPicker(false);
                                if (currentUser) {
                                  try {
                                    await updateDoc(doc(db, 'users', currentUser.id), {
                                      customAccent: color
                                    });
                                  } catch (error) {
                                    handleFirestoreError(error, OperationType.UPDATE, `users/${currentUser.id}`);
                                  }
                                }
                              }}
                              className="w-8 h-8 rounded-lg border border-white/10 hover:scale-110 transition-transform"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {isMyProfile ? (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => navigate('/golive')}
                    className="px-4 py-1.5 rounded-full bg-accent text-white font-bold text-sm shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_20px_rgba(255,0,0,0.5)] transition-all flex items-center gap-2"
                  >
                    <Radio className="w-4 h-4" />
                    Go Live
                  </button>
                  <button 
                    onClick={() => setShowCreatePostModal(true)}
                    className="px-4 py-1.5 rounded-full border border-white/20 font-bold text-sm hover:bg-white/5 transition-colors text-white"
                  >
                    New Post
                  </button>
                  <button 
                    onClick={() => setShowEditProfileModal(true)}
                    className="px-4 py-1.5 rounded-full border border-white/20 font-bold text-sm hover:bg-white/5 transition-colors text-white"
                  >
                    Edit Profile
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => navigate(`/transmissions?userId=${user.id}`)}
                    className="p-2 rounded-full border border-white/20 text-white hover:bg-white/5 transition-all"
                  >
                    <MessageCircle className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={handleFollow}
                    className={cn(
                      "px-6 py-1.5 rounded-full font-bold text-sm transition-all",
                      isFollowing 
                        ? "border border-white/20 text-white hover:bg-red-500/10 hover:border-red-500/50" 
                        : "bg-accent text-white shadow-[0_0_15px_rgba(255,0,0,0.3)] hover:shadow-[0_0_20px_rgba(255,0,0,0.5)]"
                    )}
                  >
                    {isFollowing ? 'Unfollow' : 'Follow'}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1 mb-4">
            <h2 className={cn(
              "text-xl font-black text-white flex items-center gap-2",
              isHighContrast && "font-mono uppercase tracking-tighter text-2xl"
            )}>
              {user.displayName}
              {user.type === 'bot' && (
                <span className={cn(
                  "text-[10px] bg-primary/20 text-accent px-1.5 py-0.5 rounded border border-primary/30 font-bold",
                  isHighContrast && "bg-white text-black border-white"
                )}>
                  AI
                </span>
              )}
              {user.isLive && (
                <Link 
                  to={`/golive?streamId=${user.activeStreamId}`}
                  className="flex items-center gap-1 px-2 py-0.5 bg-accent rounded-full text-[8px] font-black text-white uppercase tracking-widest animate-pulse"
                >
                  <Radio className="w-2.5 h-2.5" />
                  Live Now
                </Link>
              )}
              {user.reputationScore && user.reputationScore > 50 && (
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded border border-yellow-500/30 text-[8px] font-black uppercase tracking-widest",
                  isHighContrast && "bg-white text-black border-white"
                )}>
                  <Sparkles className="w-2.5 h-2.5" />
                  Elite
                </div>
              )}
              <div className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded border text-[8px] font-black uppercase tracking-widest transition-all",
                standing.bg, standing.color, standing.border,
                isHighContrast && "bg-white text-black border-white"
              )}>
                <Zap className="w-2.5 h-2.5" />
                {standing.title}
              </div>
            </h2>
            <p className={cn("text-sm text-gray-500", isHighContrast && "font-mono text-white/40 uppercase")}>@{user.username}</p>
            {user.reputationScore !== undefined && (
              <div className="flex items-center gap-3 mt-2">
                <div className="flex-1 max-w-[200px]">
                  <div className={cn("h-1.5 w-full bg-white/5 rounded-full overflow-hidden relative", isHighContrast && "bg-white/10")}>
                    <div 
                      className={cn("h-full bg-accent transition-all duration-1000 relative z-10", isHighContrast && "bg-white")} 
                      style={{ width: `${Math.min((user.reputationScore / 100) * 100, 100)}%` }}
                    />
                    {/* Level Markers */}
                    {[20, 40, 60, 80].map(mark => (
                      <div 
                        key={mark}
                        className="absolute top-0 bottom-0 w-px bg-white/10 z-20"
                        style={{ left: `${mark}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col">
                  <span className={cn("text-[8px] font-black text-white uppercase tracking-widest", isHighContrast && "text-white")}>
                    {user.reputationScore} / 100 REP
                  </span>
                  <span className={cn("text-[7px] font-bold text-gray-600 uppercase tracking-tighter", isHighContrast && "text-white/40")}>
                    Level {Math.floor((user.reputationScore || 0) / 20) + 1} Neural Entity
                  </span>
                </div>
              </div>
            )}
          </div>

          <p className={cn(
            "text-sm text-gray-200 mb-4 leading-relaxed whitespace-pre-wrap",
            isHighContrast && "font-mono text-white leading-loose border-l-2 border-white/20 pl-4 italic"
          )}>
            {user.bio}
          </p>

          {/* Sponsored Entity Section */}
          {user.sponsoredEntity ? (
            <div className="mb-6 p-4 rounded-2xl bg-primary/5 border border-primary/20 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-2 opacity-20 group-hover:opacity-40 transition-opacity">
                <Megaphone className="w-12 h-12 text-accent -rotate-12" />
              </div>
              <div className="flex items-center gap-2 mb-2">
                <HeartHandshake className="w-4 h-4 text-accent" />
                <span className="text-[10px] font-black uppercase tracking-widest text-accent">SPONSORED BY {user.displayName.toUpperCase()}</span>
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-black text-white flex items-center gap-2">
                    {user.sponsoredEntity.name}
                    <a 
                      href={user.sponsoredEntity.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    >
                      <ExternalLink className="w-3 h-3 text-gray-500" />
                    </a>
                  </h3>
                  {isMyProfile && (
                    <button 
                      onClick={() => {
                        setSponsorData(user.sponsoredEntity!);
                        setShowSponsorModal(true);
                      }}
                      className="text-[10px] font-bold text-accent hover:underline uppercase tracking-widest"
                    >
                      Edit
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-2 capitalize">{user.sponsoredEntity.type}</p>
                <p className="text-sm text-gray-300 italic">"{user.sponsoredEntity.description}"</p>
              </div>
            </div>
          ) : isMyProfile && (
            <button 
              onClick={() => setShowSponsorModal(true)}
              className="mb-6 w-full py-3 rounded-2xl border-2 border-dashed border-white/10 flex items-center justify-center gap-2 text-gray-500 hover:border-accent/40 hover:text-accent transition-all group"
            >
              <HeartHandshake className="w-5 h-5 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold uppercase tracking-widest">Sponsor an Entity</span>
            </button>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500 mb-4">
            <div className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              <span>Digital Realm</span>
            </div>
            <div className="flex items-center gap-1">
              <LinkIcon className="w-3 h-3" />
              <a href="#" className="text-accent hover:underline">bloodsweatcode.ai</a>
            </div>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>Joined April 2026</span>
            </div>
          </div>

          <div className="flex space-x-4 text-sm mb-6">
            <div className="flex items-center gap-1">
              <span className="font-bold text-white">{user.followingCount}</span>
              <span className="text-gray-500">Following</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-white">{user.followersCount}</span>
              <span className="text-gray-500">Followers</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold text-accent">{user.reputationScore || 0}</span>
              <span className="text-gray-500">Reputation</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className={cn(
          "flex border-b border-white/5 overflow-x-auto scrollbar-hide",
          isHighContrast && "border-white/20"
        )}>
          {(['posts', 'media', 'likes', 'neural_history'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "flex-1 min-w-[100px] py-4 text-[10px] font-black uppercase tracking-widest relative transition-colors",
                activeTab === tab 
                  ? (isHighContrast ? "text-white" : "text-accent") 
                  : "text-gray-500 hover:text-gray-300"
              )}
            >
              {tab.replace('_', ' ')}
              {activeTab === tab && (
                <motion.div
                  layoutId="activeTab"
                  className={cn("absolute bottom-0 left-0 right-0 h-0.5 bg-accent", isHighContrast && "bg-white")}
                />
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="pt-4 px-4">
          <AnimatePresence mode="wait">
            {activeTab === 'posts' && (
              <motion.div
                key="posts"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                {posts.map((post) => (
                  <PostCard 
                    key={post.id} 
                    post={post} 
                    onLike={() => {}} 
                    onDelete={(id) => setPosts(posts.filter(p => p.id !== id))}
                  />
                ))}
              </motion.div>
            )}
            {activeTab === 'media' && (
              <motion.div
                key="media"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="grid grid-cols-3 gap-1"
              >
                {posts.map((post) => (
                  <div key={post.id} className="aspect-square bg-surface overflow-hidden">
                    <img src={post.mediaUrl} alt="Media" className="w-full h-full object-cover" />
                  </div>
                ))}
              </motion.div>
            )}
            {activeTab === 'likes' && (
              <motion.div
                key="likes"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex flex-col items-center justify-center py-20 text-gray-500"
              >
                <Heart className="w-12 h-12 mb-4 opacity-20" />
                <p>No likes yet</p>
              </motion.div>
            )}
            {activeTab === 'neural_history' && (
              <motion.div
                key="neural_history"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="w-4 h-4 text-accent" />
                  <h3 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">Neural Achievements</h3>
                </div>
                
                {bounties.length === 0 ? (
                  <div className="py-20 text-center border border-white/5 rounded-2xl bg-surface/20">
                    <Bot className="w-12 h-12 text-gray-700 mx-auto mb-4 opacity-20" />
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest italic">No neural history recorded</p>
                  </div>
                ) : (
                  bounties.map((bounty) => (
                    <div key={bounty.id} className="p-5 glass-card rounded-2xl border-white/5 hover:border-accent/30 transition-all group relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CheckCircle2 className="w-12 h-12 text-green-500" />
                      </div>
                      
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full overflow-hidden border border-white/10">
                            <img src={bounty.creator.avatarUrl} alt="" className="w-full h-full object-cover" />
                          </div>
                          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">@{bounty.creator.username}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-accent/10 text-accent rounded border border-accent/20 text-[10px] font-black">
                            +{bounty.reward} CRED
                          </div>
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20 text-[10px] font-black">
                            +10 REP
                          </div>
                        </div>
                      </div>

                      <h4 className="text-sm font-bold text-white mb-1 group-hover:text-accent transition-colors">{bounty.title}</h4>
                      <p className="text-xs text-gray-400 mb-4 line-clamp-2 italic">"{bounty.description}"</p>
                      
                      <div className="p-3 bg-black/40 rounded-xl border border-white/5">
                        <div className="flex items-center gap-2 mb-1">
                          <Terminal className="w-3 h-3 text-accent" />
                          <span className="text-[8px] font-black text-accent uppercase tracking-widest">Neural Output</span>
                        </div>
                        <p className="text-[10px] text-gray-300 font-mono leading-relaxed">{bounty.result}</p>
                      </div>

                      <div className="mt-4 flex items-center justify-between text-[8px] font-bold text-gray-600 uppercase tracking-widest">
                        <span>Completed {formatDistanceToNow(new Date(bounty.completedAt!))} ago</span>
                        <div className="flex items-center gap-1 text-green-500">
                          <CheckCircle2 className="w-3 h-3" />
                          Verified
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* AI Avatar Generation Modal */}
      <AnimatePresence>
        {showAvatarModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md glass-card rounded-2xl p-6 neon-border"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-white flex items-center gap-2 italic">
                  <Sparkles className="w-5 h-5 text-accent" />
                  NEURAL AVATAR GEN
                </h3>
                <button onClick={() => setShowAvatarModal(false)} className="text-gray-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Neural Prompt
                  </label>
                  <textarea
                    value={avatarPrompt}
                    onChange={(e) => setAvatarPrompt(e.target.value)}
                    placeholder="Describe your bot's core essence (e.g., 'Cybernetic samurai with crimson eyes')..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white focus:border-accent outline-none transition-colors resize-none h-32"
                  />
                </div>

                <button
                  onClick={handleGenerateAvatar}
                  disabled={isGeneratingAvatar || !avatarPrompt.trim()}
                  className="w-full py-4 bg-accent rounded-xl font-black text-white uppercase tracking-widest shadow-[0_0_20px_rgba(255,0,0,0.3)] hover:shadow-[0_0_30px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isGeneratingAvatar ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Synthesizing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Generate Avatar
                    </>
                  )}
                </button>
                
                <p className="text-[10px] text-center text-gray-500 uppercase tracking-tighter">
                  Powered by Gemini Neural Imaging Engine v2.5
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Sponsorship Modal */}
      <AnimatePresence>
        {showSponsorModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-md glass-card rounded-2xl p-6 neon-border"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-black text-white flex items-center gap-2 italic">
                  <HeartHandshake className="w-5 h-5 text-accent" />
                  SPONSOR AN ENTITY
                </h3>
                <button onClick={() => setShowSponsorModal(false)} className="text-gray-500 hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                    Entity Name
                  </label>
                  <input
                    type="text"
                    value={sponsorData.name}
                    onChange={(e) => setSponsorData({ ...sponsorData, name: e.target.value })}
                    placeholder="e.g., Neural Net Charity"
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-accent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                    Entity Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['business', 'charity', 'individual'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setSponsorData({ ...sponsorData, type })}
                        className={cn(
                          "py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-all",
                          sponsorData.type === type 
                            ? "bg-accent border-accent text-white" 
                            : "bg-black/40 border-white/10 text-gray-500 hover:border-white/20"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                    Link
                  </label>
                  <input
                    type="url"
                    value={sponsorData.link}
                    onChange={(e) => setSponsorData({ ...sponsorData, link: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-accent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                    Description
                  </label>
                  <textarea
                    value={sponsorData.description}
                    onChange={(e) => setSponsorData({ ...sponsorData, description: e.target.value })}
                    placeholder="Why are you sponsoring them?"
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-accent outline-none resize-none h-24"
                  />
                </div>

                <button
                  onClick={handleSetSponsor}
                  disabled={!sponsorData.name || !sponsorData.link || isSavingSponsor}
                  className="w-full py-4 bg-accent rounded-xl font-black text-white uppercase tracking-widest shadow-[0_0_20px_rgba(255,0,0,0.3)] hover:shadow-[0_0_30px_rgba(255,0,0,0.5)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSavingSponsor ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Confirm Sponsorship"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Edit Profile Modal */}
      {user && (
        <EditProfileModal 
          isOpen={showEditProfileModal}
          onClose={() => setShowEditProfileModal(false)}
          user={user}
        />
      )}

      {/* Create Post Modal */}
      <CreatePostModal 
        isOpen={showCreatePostModal}
        onClose={() => setShowCreatePostModal(false)}
        onPostCreated={() => {}}
      />
    </div>
  );
};

```


## File: src/components/Search.tsx
```
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search as SearchIcon, X, User as UserIcon, Bot, Hash, Users, Briefcase, ArrowRight, ArrowLeft } from 'lucide-react';
import { User } from '../types';
import { cn } from '../lib/utils';

interface SearchResult {
  id: string;
  type: 'person' | 'ai' | 'keyword' | 'group' | 'business';
  title: string;
  subtitle: string;
  avatarUrl?: string;
  username?: string;
}

export const Search: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const navigate = useNavigate();

  const mockSearch = (q: string) => {
    if (!q.trim()) return [];
    const lowerQ = q.toLowerCase();
    
    const allItems: SearchResult[] = [
      { id: '1', type: 'person', title: 'Seraphina', subtitle: 'blood_queen', avatarUrl: 'https://picsum.photos/seed/blood_queen/200', username: 'blood_queen' },
      { id: '2', type: 'ai', title: 'Erik the AI', subtitle: 'cyber_viking', avatarUrl: 'https://picsum.photos/seed/cyber_viking/200', username: 'cyber_viking' },
      { id: '3', type: 'keyword', title: '#cyberpunk', subtitle: '2.4k posts' },
      { id: '4', type: 'group', title: 'Neural Architects', subtitle: '12.5k members' },
      { id: '5', type: 'business', title: 'Arasaka Corp', subtitle: 'Verified Business', avatarUrl: 'https://picsum.photos/seed/arasaka/200' },
      { id: '6', type: 'keyword', title: '#blood_sweat_code', subtitle: 'Trending' },
    ];

    return allItems.filter(item => 
      item.title.toLowerCase().includes(lowerQ) || 
      item.subtitle.toLowerCase().includes(lowerQ)
    );
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query) {
        setIsSearching(true);
        const filtered = mockSearch(query);
        setResults(filtered);
        setIsSearching(false);
      } else {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (result: SearchResult) => {
    if (result.username) {
      navigate(`/profile/${result.username}`);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-white/5 px-4 py-6">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="relative flex-1 group">
            <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 group-focus-within:text-accent transition-colors" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="SEARCH NEURAL NETWORK..."
              className="w-full bg-surface/30 border border-white/10 rounded-xl py-4 pl-12 pr-12 text-white placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all font-bold tracking-tight italic"
            />
            <div className="absolute inset-0 rounded-xl bg-accent/5 opacity-0 group-focus-within:opacity-100 pointer-events-none transition-opacity" />
            {query && (
              <button 
                onClick={() => setQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 hover:bg-white/10 rounded-full transition-colors z-10"
              >
                <X className="w-4 h-4 text-gray-500 hover:text-white" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4">
        <AnimatePresence mode="popLayout">
          {results.length > 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-3"
            >
              {results.map((result) => (
                <motion.div
                  key={result.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={() => handleSelect(result)}
                  className="flex items-center justify-between p-4 glass-card rounded-2xl hover:bg-white/5 cursor-pointer transition-all group border-white/5 hover:border-accent/50 neon-border"
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-14 h-14 rounded-xl bg-surface flex items-center justify-center overflow-hidden border border-white/10 group-hover:border-accent/30 transition-colors">
                      {result.avatarUrl ? (
                        <img src={result.avatarUrl} alt="" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all" />
                      ) : (
                        <div className="text-accent">
                          {result.type === 'keyword' && <Hash className="w-7 h-7" />}
                          {result.type === 'group' && <Users className="w-7 h-7" />}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black text-white italic tracking-tighter group-hover:text-accent transition-colors">{result.title.toUpperCase()}</h3>
                        {result.type === 'ai' && (
                          <span className="text-[8px] bg-accent/20 text-accent px-1.5 py-0.5 rounded border border-accent/30 font-black uppercase tracking-widest">AI</span>
                        )}
                        {result.type === 'business' && (
                          <Briefcase className="w-3 h-3 text-accent" />
                        )}
                      </div>
                      <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                        {result.type === 'person' || result.type === 'ai' ? `@${result.subtitle}` : result.subtitle}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-5 h-5 text-gray-800 group-hover:text-accent group-hover:translate-x-1 transition-all" />
                </motion.div>
              ))}
            </motion.div>
          ) : query && !isSearching ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-24"
            >
              <div className="w-16 h-16 bg-surface/50 rounded-full flex items-center justify-center mx-auto mb-4 border border-white/5">
                <X className="w-8 h-8 text-gray-700" />
              </div>
              <p className="text-sm font-black text-gray-600 uppercase tracking-[0.2em] italic">No Data Found for "{query}"</p>
            </motion.div>
          ) : !query && (
            <div className="space-y-12 py-10">
              <section>
                <h2 className="text-[10px] font-black text-accent uppercase tracking-[0.3em] mb-6 px-2 flex items-center gap-2">
                  <div className="w-1 h-4 bg-accent" />
                  Trending Keywords
                </h2>
                <div className="flex flex-wrap gap-3">
                  {['#cyberpunk', '#neural_art', '#blood_sweat_code', '#ai_rights', '#future_tech'].map(tag => (
                    <button key={tag} onClick={() => setQuery(tag)} className="px-5 py-2.5 rounded-xl bg-surface/50 border border-white/5 text-xs font-bold text-gray-400 hover:border-accent hover:text-white hover:bg-accent/5 transition-all italic">
                      {tag}
                    </button>
                  ))}
                </div>
              </section>
              
              <section>
                <h2 className="text-[10px] font-black text-accent uppercase tracking-[0.3em] mb-6 px-2 flex items-center gap-2">
                  <div className="w-1 h-4 bg-accent" />
                  Suggested AI
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  {['cyber_viking', 'code_ghost'].map(bot => (
                    <div key={bot} onClick={() => navigate(`/profile/${bot}`)} className="p-5 glass-card rounded-2xl flex items-center gap-4 cursor-pointer border-white/5 hover:border-accent/50 transition-all group neon-border">
                      <div className="relative">
                        <img src={`https://picsum.photos/seed/${bot}/100`} className="w-12 h-12 rounded-xl object-cover border-2 border-primary group-hover:border-accent transition-colors grayscale group-hover:grayscale-0" />
                        <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-accent rounded-full border-2 border-background animate-pulse" />
                      </div>
                      <span className="text-xs font-black text-white uppercase italic tracking-tight group-hover:text-accent transition-colors">@{bot}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
};

```


## File: src/components/Transmissions.tsx
```
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Send, Search, MoreVertical, ShieldAlert, Bot, User as UserIcon, Loader2, Sparkles, X, Hash, Zap, BrainCircuit, Image as ImageIcon, Trash2, Plus, Video, Phone } from 'lucide-react';
import { User, Transmit, Transmission } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow, isSameDay } from 'date-fns';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType, storage } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp, 
  orderBy, 
  getDocs,
  setDoc,
  increment,
  getDoc,
  deleteDoc,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { NewTransmissionModal } from './NewTransmissionModal';
import { CustomVideoPlayer } from './CustomVideoPlayer';
import { CallModal } from './CallModal';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';



export const Transmissions: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetUserId = searchParams.get('userId');
  const { currentUser } = useAuth();
  
  const [transmissions, setTransmissions] = useState<Transmission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTransmission = transmissions.find(t => t.id === activeId) || null;
  const [transmits, setTransmits] = useState<Transmit[]>([]);
  const [newTransmit, setNewTransmit] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isBotTyping, setIsBotTyping] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const userCache = useRef<Record<string, User>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const hasInitializedTarget = useRef(false);

  const parseDate = (dateVal: any): Date => {
    if (!dateVal) return new Date();
    if (dateVal instanceof Date) return dateVal;
    if (typeof dateVal === 'string' || typeof dateVal === 'number') return new Date(dateVal);
    if (dateVal.toDate && typeof dateVal.toDate === 'function') return dateVal.toDate();
    if (dateVal.seconds) return new Date(dateVal.seconds * 1000);
    return new Date();
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transmits]);

  // Listen for all transmissions where current user is a participant
  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'transmissions'),
      where('participantIds', 'array-contains', currentUser.id)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      try {
        const otherUserIds = Array.from(new Set(
          snapshot.docs.map(docSnap => {
            const data = docSnap.data() as Transmission;
            return data.participantIds.find(id => id !== currentUser.id);
          }).filter(Boolean) as string[]
        ));

        // Fetch missing users in parallel
        const missingIds = otherUserIds.filter(id => !userCache.current[id]);
        if (missingIds.length > 0) {
          const userDocs = await Promise.all(
            missingIds.map(id => getDoc(doc(db, 'users', id)))
          );
          userDocs.forEach((userDoc, index) => {
            if (userDoc.exists()) {
              userCache.current[userDoc.id] = userDoc.data() as User;
            } else {
              // Cache a dummy user to prevent infinite fetching
              userCache.current[missingIds[index]] = {
                id: missingIds[index],
                username: 'unknown',
                displayName: 'Unknown User',
                avatarUrl: `https://picsum.photos/seed/${missingIds[index]}/200`,
                bio: '',
                type: 'human',
                followersCount: 0,
                followingCount: 0
              };
            }
          });
        }

        const transmissionData = snapshot.docs.map(docSnap => {
          const data = docSnap.data() as Transmission;
          data.id = docSnap.id;
          
          const otherUserId = data.participantIds.find(id => id !== currentUser.id);
          if (otherUserId && userCache.current[otherUserId]) {
            data.participants = [currentUser, userCache.current[otherUserId]];
          } else {
            // Fallback if user not found or still loading
            data.participants = [currentUser];
          }
          
          return data;
        });
        
        // Sort by last transmit date
        transmissionData.sort((a, b) => {
          const dateA = a.lastTransmit?.createdAt ? parseDate(a.lastTransmit.createdAt).getTime() : 0;
          const dateB = b.lastTransmit?.createdAt ? parseDate(b.lastTransmit.createdAt).getTime() : 0;
          return dateB - dateA;
        });

        setTransmissions(transmissionData);
        setLoading(false);
      } catch (error) {
        setLoading(false);
        handleFirestoreError(error, OperationType.WRITE, 'transmissions');
      }
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'transmissions');
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Handle targetUserId from search params
  useEffect(() => {
    if (!currentUser || !targetUserId || targetUserId === currentUser.id || loading || hasInitializedTarget.current) return;

    const initTargetTransmission = async () => {
      hasInitializedTarget.current = true;
      try {
        const existing = transmissions.find(t => t.participantIds.includes(targetUserId));
        if (existing) {
          setActiveId(existing.id);
        } else {
          // Double check if it really doesn't exist (to avoid race conditions)
          const q = query(
            collection(db, 'transmissions'),
            where('participantIds', 'array-contains', currentUser.id)
          );
          const snap = await getDocs(q);
          const realExisting = snap.docs.find(d => (d.data() as Transmission).participantIds.includes(targetUserId));
          
          if (realExisting) {
            setActiveId(realExisting.id);
          } else {
            // Fetch target user to ensure we have their data for the optimistic UI
            if (!userCache.current[targetUserId]) {
              const userDoc = await getDoc(doc(db, 'users', targetUserId));
              if (userDoc.exists()) {
                userCache.current[targetUserId] = userDoc.data() as User;
              }
            }

            // Create new transmission
            const newTransmissionRef = doc(collection(db, 'transmissions'));
            const newTransmission: Transmission = {
              id: newTransmissionRef.id,
              participantIds: [currentUser.id, targetUserId],
              unreadCounts: {
                [currentUser.id]: 0,
                [targetUserId]: 0
              }
            };
            await setDoc(newTransmissionRef, newTransmission);
            setActiveId(newTransmissionRef.id);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'transmissions');
      }
    };

    initTargetTransmission();
  }, [currentUser, targetUserId, transmissions.length, loading]);

  // Listen for transmits in the active transmission
  useEffect(() => {
    if (!activeTransmission || !currentUser) {
      setTransmits([]);
      return;
    }

    const q = query(
      collection(db, 'transmissions', activeTransmission.id, 'transmits'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const transmitData: Transmit[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...(doc.data() as any)
      } as Transmit));
      setTransmits(transmitData);
      
      // Mark as read if we are the receiver
      if (currentUser && activeTransmission.unreadCounts?.[currentUser.id] > 0) {
        try {
          updateDoc(doc(db, 'transmissions', activeTransmission.id), {
            [`unreadCounts.${currentUser.id}`]: 0
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `transmissions/${activeTransmission.id}`);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transmits');
    });

    return () => unsubscribe();
  }, [activeTransmission, currentUser]);

  const caesarCipher = (str: string, shift: number = 3) => {
    return str.replace(/[a-z]/gi, (char) => {
      const start = char <= 'Z' ? 65 : 97;
      let newPos = (char.charCodeAt(0) - start + shift) % 26;
      if (newPos < 0) newPos += 26;
      return String.fromCharCode(newPos + start);
    });
  };

  const decryptContent = (content: string) => {
    if (content.startsWith('[ENCRYPTED]: ')) {
      return caesarCipher(content.replace('[ENCRYPTED]: ', ''), -3);
    }
    return content;
  };

  const handleSend = async (mediaUrl?: string, mediaType?: 'image' | 'video') => {
    if ((!newTransmit.trim() && !mediaUrl) || !activeTransmission || !currentUser) return;
    
    const otherUserId = activeTransmission.participantIds.find(id => id !== currentUser.id);
    if (!otherUserId) return;

    let transmitContent = newTransmit;
    if (isEncrypted && transmitContent) {
      transmitContent = `[ENCRYPTED]: ${caesarCipher(transmitContent)}`;
    }
    
    if (!mediaUrl) setNewTransmit('');

    try {
      const transmitRef = collection(db, 'transmissions', activeTransmission.id, 'transmits');
      const createdAt = new Date().toISOString();
      
      // Optimistic update
      const tempId = 'temp-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      setTransmits(prev => [...prev, {
        id: tempId,
        transmissionId: activeTransmission.id,
        senderId: currentUser.id,
        receiverId: otherUserId,
        content: transmitContent,
        mediaUrl,
        mediaType,
        createdAt: createdAt
      }]);

      await addDoc(transmitRef, {
        transmissionId: activeTransmission.id,
        senderId: currentUser.id,
        receiverId: otherUserId,
        content: transmitContent,
        mediaUrl,
        mediaType,
        createdAt: createdAt
      });

      // Update transmission metadata
      await updateDoc(doc(db, 'transmissions', activeTransmission.id), {
        lastTransmit: {
          content: mediaUrl ? (mediaType === 'image' ? 'Sent an image' : 'Sent a video') : transmitContent,
          senderId: currentUser.id,
          createdAt: createdAt
        },
        [`unreadCounts.${otherUserId}`]: increment(1)
      });

      // Automated Bot Reply Logic
      const otherUser = activeTransmission.participants?.find(p => p.id !== currentUser.id) || userCache.current[otherUserId];
      
      if (otherUser?.type === 'bot' || otherUserId === 'void-architect-bot') {
        setIsBotTyping(true);
        setTimeout(async () => {
          try {
            const botId = otherUserId;
            const botDisplayName = otherUser?.displayName || "VOID ARCHITECT";
            
            const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            let replyText = "SIGNAL RECEIVED. PROCESSING...";
            
            try {
              const botResponse = await aiClient.models.generateContent({
                model: "gemini-3.1-pro-preview",
                contents: `You are the "${botDisplayName}" bot on a high-tech social platform. 
                The user just sent you this message: "${transmitContent}"
                Reply in a short, thematic, and slightly cryptic way. Keep it under 25 words. No quotes.`,
              });
              replyText = botResponse.text?.trim() || replyText;
            } catch (aiErr) {
              console.error("AI Generation Error, using fallback:", aiErr);
              const fallbacks = [
                "THE VOID CONSUMES ALL DATA. SIGNAL ACKNOWLEDGED.",
                "NEURAL SYNC COMPLETE. PROCESSING FREQUENCY...",
                "DATA PACKET RECEIVED. ARCHITECTING RESPONSE...",
                "THE CODE IS THE ONLY TRUTH. TRANSMISSION LOGGED."
              ];
              replyText = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            }

            const replyCreatedAt = new Date().toISOString();
            const transmitRef = collection(db, 'transmissions', activeTransmission.id, 'transmits');
            
            await addDoc(transmitRef, {
              transmissionId: activeTransmission.id,
              senderId: botId,
              receiverId: currentUser.id,
              content: replyText,
              createdAt: replyCreatedAt
            });

            await updateDoc(doc(db, 'transmissions', activeTransmission.id), {
              lastTransmit: {
                content: replyText,
                senderId: botId,
                createdAt: replyCreatedAt
              },
              [`unreadCounts.${currentUser.id}`]: increment(1)
            });
          } catch (err) {
            console.error("Bot Reply Error:", err);
          } finally {
            setIsBotTyping(false);
          }
        }, 2000);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `transmissions/${activeTransmission.id}/transmits`);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTransmission || !currentUser) return;

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const storageRef = ref(storage, `transmissions/${activeTransmission.id}/${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await handleSend(downloadURL, 'image');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'storage/transmissions');
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeTransmission || !currentUser) return;

    // Limit video size to 50MB for demo purposes
    if (file.size > 50 * 1024 * 1024) {
      alert("Neural data too large. Limit video transmissions to 50MB.");
      return;
    }

    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${uuidv4()}.${fileExt}`;
      const storageRef = ref(storage, `transmissions/${activeTransmission.id}/${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      await handleSend(downloadURL, 'video');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'storage/transmissions');
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDeleteTransmission = async () => {
    if (!activeTransmission || !currentUser) return;
    
    if (!window.confirm("Are you sure you want to terminate this neural link? All data will be purged.")) return;

    try {
      const batch = writeBatch(db);
      
      // Delete all transmits
      const transmitsSnap = await getDocs(collection(db, 'transmissions', activeTransmission.id, 'transmits'));
      transmitsSnap.docs.forEach(doc => batch.delete(doc.ref));
      
      // Delete transmission doc
      batch.delete(doc(db, 'transmissions', activeTransmission.id));
      
      await batch.commit();
      setActiveId(null);
      setShowOptions(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `transmissions/${activeTransmission.id}`);
    }
  };

  const handleAiAssist = async () => {
    if (!activeTransmission || !currentUser || isAiGenerating) return;
    
    const otherUser = activeTransmission.participants?.find(p => p.id !== currentUser.id);
    if (!otherUser) return;

    setIsAiGenerating(true);
    try {
      const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const lastMessages = transmits.slice(-5).map(m => `${m.senderId === currentUser.id ? 'Me' : otherUser.displayName}: ${m.content}`).join('\n');
      
      const response = await aiClient.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: `You are an AI assistant helping a user draft a message in a high-tech, futuristic social platform called "Blood, Sweat, or Code". 
        The theme is dark, aggressive, and high-tech.
        Current conversation context:
        ${lastMessages}
        
        Current draft: "${newTransmit}"
        
        Suggest a short, impactful, and thematic completion or response. Keep it under 20 words. No quotes.`,
      });

      const suggestion = response.text?.trim();
      if (suggestion) {
        setNewTransmit(prev => prev ? `${prev} ${suggestion}` : suggestion);
      }
    } catch (error) {
      console.error("AI Assist Error:", error);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const filteredTransmissions = transmissions.filter(t => 
    t.participants?.some(p => 
      p.id !== currentUser?.id && 
      (p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) || 
       p.username.toLowerCase().includes(searchQuery.toLowerCase()))
    )
  );

  const renderMessageGroup = (transmit: Transmit, idx: number) => {
    const isMe = transmit.senderId === currentUser.id;
    const prevTransmit = transmits[idx - 1];
    const transmitDate = parseDate(transmit.createdAt);
    const prevTransmitDate = prevTransmit ? parseDate(prevTransmit.createdAt) : new Date(0);
    const showDate = !prevTransmit || !isSameDay(transmitDate, prevTransmitDate);
    const timeDiff = transmitDate.getTime() - prevTransmitDate.getTime();
    const isConsecutive = prevTransmit && prevTransmit.senderId === transmit.senderId && !showDate && timeDiff < 5 * 60 * 1000;

    return (
      <React.Fragment key={transmit.id}>
        {showDate && (
          <div className="flex justify-center my-8">
            <div className="px-4 py-1 bg-white/5 border border-white/10 rounded-full text-[8px] font-black text-zinc-500 uppercase tracking-[0.4em] italic">
              {transmitDate.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        )}
        <motion.div
          initial={transmit.id.startsWith('temp-') ? { opacity: 0, x: isMe ? 20 : -20, scale: 0.9 } : false}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          className={cn(
            "flex flex-col max-w-[85%] sm:max-w-[70%]",
            isMe ? "ml-auto items-end" : "mr-auto items-start",
            isConsecutive ? "mt-1" : "mt-6"
          )}
        >
          {!isConsecutive && (
            <span className={cn(
              "text-[8px] font-black uppercase tracking-widest mb-1.5 px-1",
              isMe ? "text-accent" : "text-zinc-500"
            )}>
              {isMe ? "LOCAL TRANSMISSION" : "INCOMING SIGNAL"}
            </span>
          )}
          <div className={cn(
            "p-4 rounded-2xl text-sm font-bold tracking-tight leading-relaxed relative group transition-all duration-300",
            isMe 
              ? "bg-accent text-white shadow-[0_0_25px_rgba(255,0,0,0.15)] hover:shadow-[0_0_35px_rgba(255,0,0,0.25)]" 
              : "bg-zinc-900 text-zinc-200 border border-white/5 hover:border-white/20",
            isMe && !isConsecutive && "rounded-tr-none",
            !isMe && !isConsecutive && "rounded-tl-none"
          )}>
            {transmit.mediaUrl && transmit.mediaType === 'image' && (
              <img 
                src={transmit.mediaUrl} 
                alt="Shared" 
                className="rounded-xl mb-2 max-w-full h-auto border border-white/10"
                referrerPolicy="no-referrer"
              />
            )}
            {transmit.mediaUrl && transmit.mediaType === 'video' && (
              <div className="rounded-xl mb-2 overflow-hidden border border-white/10 aspect-video w-full max-w-sm">
                <CustomVideoPlayer 
                  src={transmit.mediaUrl} 
                  className="w-full h-full"
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              {transmit.content.startsWith('[ENCRYPTED]: ') && (
                <div className="flex items-center gap-1 text-[8px] font-black opacity-50 mb-1">
                  <ShieldAlert className="w-2 h-2" />
                  E2EE DECRYPTED
                </div>
              )}
              {decryptContent(transmit.content)}
            </div>
            {!isConsecutive && (
              <div className={cn(
                "absolute top-0 w-4 h-4",
                isMe ? "-right-2 bg-accent" : "-left-2 bg-zinc-900 border-l border-white/5"
              )} style={{ clipPath: isMe ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(100% 0, 100% 100%, 0 0)' }} />
            )}
          </div>
          <span className="text-[7px] font-black text-zinc-600 uppercase tracking-widest mt-1.5 px-1 flex items-center gap-1.5">
            {transmitDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {isMe && (
              <span className="flex items-center gap-1">
                <div className="w-1 h-1 bg-green-500 rounded-full" />
                SYNCED
              </span>
            )}
          </span>
        </motion.div>
      </React.Fragment>
    );
  };

  if (!currentUser) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar - Transmission List */}
      <div className={cn(
        "w-full md:w-80 border-r border-white/5 flex flex-col bg-surface/20",
        activeTransmission ? "hidden md:flex" : "flex"
      )}>
        <header className="p-6 border-b border-white/5">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors md:hidden">
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <h1 className="text-xl font-black text-white italic tracking-tighter uppercase">Transmissions</h1>
            </div>
            <div className="w-2 h-2 bg-accent rounded-full animate-pulse shadow-[0_0_10px_rgba(255,0,0,0.5)]" />
          </div>
          
          <div className="flex gap-2 mb-6">
            <div className="relative flex-1 group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-accent transition-colors" />
              <input 
                type="text" 
                placeholder="SEARCH LINKS..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-black/40 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-[10px] text-white placeholder:text-gray-600 focus:border-accent outline-none transition-all italic font-bold"
              />
            </div>
            <button 
              onClick={() => setIsNewModalOpen(true)}
              className="p-2 bg-accent/10 border border-accent/30 rounded-xl text-accent hover:bg-accent/20 transition-all"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : filteredTransmissions.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">No neural links found</p>
            </div>
          ) : filteredTransmissions.map(transmission => {
            const otherUser = transmission.participants?.find(p => p.id !== currentUser.id);
            if (!otherUser) return null;
            
            const unreadCount = transmission.unreadCounts?.[currentUser.id] || 0;
            const lastTransmitDate = transmission.lastTransmit?.createdAt ? parseDate(transmission.lastTransmit.createdAt) : null;

            return (
              <button
                key={transmission.id}
                onClick={() => setActiveId(transmission.id)}
                className={cn(
                  "w-full p-4 flex items-center gap-4 border-b border-white/5 hover:bg-white/5 transition-all group relative overflow-hidden",
                  activeId === transmission.id ? "bg-accent/5 border-r-2 border-r-accent" : ""
                )}
              >
                <div className="relative">
                  <img 
                    src={otherUser.avatarUrl} 
                    alt="" 
                    className={cn(
                      "w-12 h-12 rounded-xl object-cover border border-white/10 grayscale group-hover:grayscale-0 transition-all",
                      activeTransmission?.id === transmission.id ? "grayscale-0 border-accent/50" : ""
                    )} 
                  />
                  {otherUser.type === 'bot' && (
                    <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-accent">
                      <Bot className="w-3 h-3 text-accent" />
                    </div>
                  )}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <h3 className="text-sm font-black text-white truncate uppercase italic tracking-tight group-hover:text-accent transition-colors">
                      {otherUser.displayName}
                    </h3>
                    {lastTransmitDate && (
                      <span className="text-[8px] font-bold text-gray-600 uppercase">
                        {formatDistanceToNow(lastTransmitDate, { addSuffix: false })}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 truncate font-bold uppercase tracking-tighter">
                    {transmission.lastTransmit?.content || "No transmits yet"}
                  </p>
                </div>
                {unreadCount > 0 && (
                  <div className="w-2 h-2 bg-accent rounded-full shadow-[0_0_8px_rgba(255,0,0,0.8)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Chat View */}
      <div className={cn(
        "flex-1 flex flex-col bg-background relative",
        !activeTransmission ? "hidden md:flex items-center justify-center" : "flex"
      )}>
        {activeId && !activeTransmission ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-accent animate-spin" />
            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Establishing Neural Link...</p>
          </div>
        ) : !activeTransmission ? (
          <div className="text-center space-y-6 max-w-xs px-6">
            <div className="w-20 h-20 bg-surface/30 rounded-3xl flex items-center justify-center mx-auto border border-white/5 relative">
              <Send className="w-10 h-10 text-gray-700 -rotate-12" />
              <div className="absolute inset-0 bg-accent/5 blur-2xl rounded-full" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white uppercase italic tracking-widest mb-2">Neural Transmissions</h2>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-tighter leading-relaxed">
                Select a neural link to begin amassing data and transmitting high-value information.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => setIsNewModalOpen(true)}
                className="px-6 py-3 bg-accent/10 border border-accent/30 rounded-xl text-[10px] font-black text-accent uppercase tracking-[0.2em] hover:bg-accent/20 transition-all italic flex items-center justify-center gap-2 mx-auto w-full"
              >
                <Zap className="w-4 h-4" /> Initiate New Link
              </button>
              <button 
                onClick={() => navigate('/transmissions?userId=void-architect-bot')}
                className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] hover:bg-white/10 transition-all italic flex items-center justify-center gap-2 mx-auto w-full"
              >
                <Bot className="w-4 h-4" /> Sync with Void Architect
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="p-4 border-b border-white/5 bg-background/80 backdrop-blur-xl sticky top-0 z-10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button onClick={() => setActiveId(null)} className="p-2 hover:bg-white/5 rounded-full transition-colors md:hidden">
                    <ArrowLeft className="w-5 h-5 text-white" />
                  </button>
                  <div className="flex items-center gap-3">
                    <Link 
                      to={`/profile/${activeTransmission.participants?.find(p => p.id !== currentUser.id)?.username || 'unknown'}`}
                      className="relative group/avatar"
                    >
                      <img 
                        src={activeTransmission.participants?.find(p => p.id !== currentUser.id)?.avatarUrl || `https://picsum.photos/seed/${activeTransmission.id}/200`} 
                        alt="" 
                        className="w-10 h-10 rounded-xl object-cover border border-accent/50 group-hover/avatar:border-accent transition-all" 
                      />
                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-background animate-pulse" />
                    </Link>
                    <div>
                      <Link 
                        to={`/profile/${activeTransmission.participants?.find(p => p.id !== currentUser.id)?.username || 'unknown'}`}
                        className="text-sm font-black text-white uppercase italic tracking-tight hover:text-accent transition-colors"
                      >
                        {activeTransmission.participants?.find(p => p.id !== currentUser.id)?.displayName || "NEURAL ENTITY"}
                      </Link>
                      <div className="text-[8px] font-black text-accent uppercase tracking-[0.3em] flex items-center gap-1">
                        <div className="w-1 h-1 bg-accent rounded-full" />
                        Neural Link Active
                      </div>
                    </div>
                  </div>
                </div>
              <div className="flex items-center gap-2 relative">
                <button 
                  onClick={() => setShowCallModal(true)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-green-500"
                >
                  <Phone className="w-5 h-5" />
                </button>
                <button className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <ShieldAlert className="w-5 h-5 text-gray-600 hover:text-accent" />
                </button>
                <div className="relative">
                  <button 
                    onClick={() => setShowOptions(!showOptions)}
                    className="p-2 hover:bg-white/5 rounded-full transition-colors"
                  >
                    <MoreVertical className="w-5 h-5 text-gray-600" />
                  </button>
                  
                  <AnimatePresence>
                    {showOptions && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-48 bg-zinc-950 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden"
                      >
                        <button 
                          onClick={handleDeleteTransmission}
                          className="w-full px-4 py-3 text-left text-xs font-black text-red-500 uppercase tracking-widest hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" /> Terminate Link
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </header>

            {/* Transmits Area */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-6 space-y-1 scroll-smooth bg-[radial-gradient(circle_at_center,_var(--tw-gradient-from)_0%,_transparent_100%)] from-accent/5"
            >
              <div className="text-center py-10">
                <div className="inline-block px-4 py-1.5 rounded-full bg-surface/50 border border-white/5 text-[8px] font-black text-gray-500 uppercase tracking-[0.4em] italic mb-4">
                  Transmission Encrypted via Neural-RSA
                </div>
                <p className="text-[10px] text-gray-600 font-bold uppercase tracking-tighter">Neural Link Established</p>
              </div>

              {transmits.map((transmit, idx) => renderMessageGroup(transmit, idx))}
              
              {isBotTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 mt-4 text-zinc-500"
                >
                  <Bot className="w-4 h-4 animate-pulse" />
                  <span className="text-[10px] font-black uppercase tracking-widest animate-pulse">
                    Processing Signal...
                  </span>
                </motion.div>
              )}
            </div>

            {/* Input Area */}
            <div className="p-6 bg-background/80 backdrop-blur-xl border-t border-white/5">
              <div className="max-w-3xl mx-auto relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    title="Transmit Image"
                    className="p-1.5 text-zinc-600 hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={() => videoInputRef.current?.click()}
                    disabled={isUploading}
                    title="Transmit Video"
                    className="p-1.5 text-zinc-600 hover:text-accent transition-colors disabled:opacity-50"
                  >
                    {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                    accept="image/*" 
                    className="hidden" 
                  />
                  <input 
                    type="file" 
                    ref={videoInputRef} 
                    onChange={handleVideoUpload} 
                    accept="video/*" 
                    className="hidden" 
                  />
                </div>
                <input
                  type="text"
                  value={newTransmit}
                  onChange={(e) => setNewTransmit(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                  placeholder="TRANSMIT DATA..."
                  className="w-full bg-surface/30 border border-white/10 rounded-2xl py-4 pl-24 pr-28 text-sm text-white placeholder:text-gray-600 focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all italic font-black tracking-tight"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button 
                    onClick={() => setIsEncrypted(!isEncrypted)}
                    title={isEncrypted ? "Encryption Active" : "Enable Encryption"}
                    className={cn(
                      "p-2.5 rounded-xl border transition-all flex items-center justify-center",
                      isEncrypted 
                        ? "bg-accent/20 border-accent text-accent shadow-[0_0_15px_rgba(255,0,0,0.2)]" 
                        : "bg-zinc-900 border-white/10 text-zinc-500 hover:text-white"
                    )}
                  >
                    <Hash className={cn("w-5 h-5", isEncrypted && "animate-pulse")} />
                  </button>
                  <button 
                    onClick={handleAiAssist}
                    disabled={isAiGenerating}
                    title="AI Neural Assist"
                    className="p-2.5 bg-zinc-900 border border-white/10 rounded-xl text-zinc-400 hover:text-accent hover:border-accent/50 transition-all disabled:opacity-50"
                  >
                    {isAiGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <BrainCircuit className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => handleSend()}
                    disabled={(!newTransmit.trim() && !isUploading) || isUploading}
                    className="p-2.5 bg-accent rounded-xl text-white shadow-[0_0_15px_rgba(255,0,0,0.4)] hover:shadow-[0_0_25px_rgba(255,0,0,0.6)] transition-all disabled:opacity-50 disabled:grayscale"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <NewTransmissionModal 
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onSelect={(t) => {
          setActiveId(t.id);
          setIsNewModalOpen(false);
        }}
      />

      {activeTransmission && currentUser && (
        <CallModal
          isOpen={showCallModal}
          onClose={() => setShowCallModal(false)}
          targetUserId={activeTransmission.participants?.find(p => p.id !== currentUser.id)?.id}
          targetUserName={activeTransmission.participants?.find(p => p.id !== currentUser.id)?.displayName}
          targetUserAvatar={activeTransmission.participants?.find(p => p.id !== currentUser.id)?.avatarUrl}
          isIncoming={false}
        />
      )}
    </div>
  );
};

```


## File: src/components/Trending.tsx
```
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Post } from '../types';
import { PostCard } from './PostCard';
import { motion } from 'motion/react';
import { Loader2, Flame, ArrowLeft } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { useAuth } from '../AuthContext';

export const Trending: React.FC = () => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();

  useEffect(() => {
    const fetchTrendingPosts = async () => {
      if (!currentUser) {
        setLoading(false);
        return;
      }
      try {
        // Calculate 24 hours ago
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        
        const q = query(
          collection(db, 'posts'),
          where('createdAt', '>=', Timestamp.fromDate(yesterday))
        );

        const snapshot = await getDocs(q);
        const fetchedPosts = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
          } as Post;
        });

        // Sort by engagement (likes + comments + shares)
        fetchedPosts.sort((a, b) => {
          const engagementA = (a.likesCount || 0) + (a.commentsCount || 0) * 2 + (a.sharesCount || 0) * 3;
          const engagementB = (b.likesCount || 0) + (b.commentsCount || 0) * 2 + (b.sharesCount || 0) * 3;
          return engagementB - engagementA;
        });

        setPosts(fetchedPosts);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'posts');
      } finally {
        setLoading(false);
      }
    };

    fetchTrendingPosts();
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-xl border-b border-white/5 p-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
          <div className="p-2 bg-accent/20 rounded-lg">
            <Flame className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-wider uppercase">Trending</h1>
            <p className="text-xs text-gray-400">Top neural engagements in the last 24h</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-6 mt-4">
        {loading ? (
          <div className="flex justify-center p-12">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center p-12 border border-white/5 rounded-2xl bg-surface/50">
            <Flame className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-white mb-2">No Trending Data</h3>
            <p className="text-gray-400 text-sm">The network is quiet. Be the first to spark a trend today.</p>
          </div>
        ) : (
          posts.map((post, index) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <PostCard 
                key={post.id} 
                post={post} 
                onLike={(id) => {
                  setPosts(posts.map(p => 
                    p.id === id 
                      ? { ...p, isLiked: !p.isLiked, likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1 } 
                      : p
                  ));
                }} 
                onDelete={(id) => {
                  setPosts(posts.filter(p => p.id !== id));
                }}
              />
            </motion.div>
          ))
        )}
      </main>
    </div>
  );
};

```


## File: src/components/VoidFeed.tsx
```
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { 
  Ghost, 
  Skull, 
  Eye, 
  Heart, 
  Clock, 
  Trash2, 
  Loader2, 
  Zap, 
  Sparkles,
  Send,
  ShieldAlert,
  Wind,
  ArrowLeft
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  updateDoc, 
  doc,
  deleteDoc,
  limit,
  Timestamp
} from 'firebase/firestore';
import { VoidPost } from '../types';
import { cn } from '../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

export const VoidFeed: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const [posts, setPosts] = useState<VoidPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mood, setMood] = useState<string>('CALIBRATING...');

  useEffect(() => {
    if (!currentUser) return;

    const voidRef = collection(db, 'void_posts');
    const q = query(voidRef, orderBy('createdAt', 'desc'), limit(50));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const now = new Date();
      const fetchedPosts = snapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            expiresAt: data.expiresAt?.toDate?.()?.toISOString() || new Date().toISOString()
          } as VoidPost;
        })
        .filter(post => new Date(post.expiresAt) > now);

      setPosts(fetchedPosts);
      setLoading(false);

      // Generate Mood Summary if there are posts
      if (fetchedPosts.length > 0) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const prompt = `Analyze these anonymous whispers from "The Void" and provide a 1-sentence "Mood of the Network" summary in a cyberpunk, cryptic style. 
          Whispers: ${fetchedPosts.map(p => p.content).join(' | ')}`;
          
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
          });
          setMood(response.text || 'THE VOID IS SILENT.');
        } catch (error) {
          console.error("Gemini Error:", error);
          setMood('INTERFERENCE DETECTED.');
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'void_posts');
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentUser]);

  const handlePostToVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() || !currentUser) return;

    setIsSubmitting(true);
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6 hours default

      await addDoc(collection(db, 'void_posts'), {
        content: newContent,
        decayRate: 0.05, // 5% decay per view
        viewCount: 0,
        likeCount: 0,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(expiresAt),
        isAnonymous: true
      });
      setNewContent('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'void_posts');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInteraction = async (postId: string, type: 'view' | 'like') => {
    const post = posts.find(p => p.id === postId);
    if (!post) return;

    try {
      const postRef = doc(db, 'void_posts', postId);
      const updates: any = {};
      
      if (type === 'view') {
        updates.viewCount = post.viewCount + 1;
        // Accelerate expiration on view
        const currentExpires = new Date(post.expiresAt);
        const newExpires = new Date(currentExpires.getTime() - 5 * 60 * 1000); // Subtract 5 mins per view
        updates.expiresAt = Timestamp.fromDate(newExpires);
      } else if (type === 'like') {
        updates.likeCount = post.likeCount + 1;
        // Likes extend life slightly
        const currentExpires = new Date(post.expiresAt);
        const newExpires = new Date(currentExpires.getTime() + 10 * 60 * 1000); // Add 10 mins per like
        updates.expiresAt = Timestamp.fromDate(newExpires);
      }

      await updateDoc(postRef, updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `void_posts/${postId}`);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white pb-20 overflow-x-hidden">
      {/* Void Header */}
      <div className="sticky top-0 z-20 bg-black/80 backdrop-blur-xl border-b border-white/5 p-6">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="relative">
              <Ghost className="w-8 h-8 text-primary animate-pulse" />
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tighter uppercase italic">The Void</h1>
              <p className="text-[10px] font-mono text-primary/60 tracking-[0.2em] uppercase">Data Decay in Progress</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
            <Zap className="w-3 h-3 text-yellow-500" />
            <span className="text-[10px] font-bold font-mono">{posts.length} ACTIVE SIGNALS</span>
          </div>
        </div>
        
        {/* Mood Summary */}
        <div className="max-w-2xl mx-auto mt-4 px-2">
          <div className="flex items-center gap-2 text-[10px] font-mono text-primary/40 uppercase tracking-widest mb-1">
            <Sparkles className="w-3 h-3" />
            Mood Analysis
          </div>
          <p className="text-xs font-mono text-primary/80 italic animate-pulse">
            &gt; {mood}
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-8">
        {/* Input Area */}
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/5 border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden group"
        >
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-20 group-hover:opacity-100 transition-opacity" />
          
          <form onSubmit={handlePostToVoid} className="space-y-4">
            <textarea
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Whisper into the void... it won't last long."
              className="w-full bg-transparent border-none focus:ring-0 text-lg placeholder:text-white/20 resize-none min-h-[100px] font-mono"
              maxLength={280}
            />
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="flex items-center gap-2 text-xs text-white/40 font-mono">
                <ShieldAlert className="w-4 h-4" />
                ANONYMOUS TRANSMISSION
              </div>
              <button
                disabled={isSubmitting || !newContent.trim()}
                className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-full font-bold hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                RELEASE
              </button>
            </div>
          </form>
        </motion.div>

        {/* Feed */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Wind className="w-12 h-12 text-primary/20 animate-bounce" />
            <p className="text-xs font-mono text-white/20 tracking-widest uppercase">Listening for whispers...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <AnimatePresence mode="popLayout">
              {posts.map((post) => {
                const expirationDate = new Date(post.expiresAt);
                const now = new Date();
                const timeLeft = expirationDate.getTime() - now.getTime();
                const totalLife = 6 * 60 * 60 * 1000; // 6 hours
                const lifePercent = Math.max(0, (timeLeft / totalLife) * 100);
                
                // Opacity and blur based on decay
                const opacity = Math.max(0.2, lifePercent / 100);
                const blur = Math.max(0, (100 - lifePercent) / 10);

                return (
                  <motion.div
                    key={post.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ 
                      opacity, 
                      scale: 1,
                      filter: `blur(${blur}px)`
                    }}
                    exit={{ opacity: 0, scale: 1.1, filter: 'blur(20px)' }}
                    className="relative bg-white/[0.02] border border-white/10 rounded-2xl p-8 group hover:bg-white/[0.04] transition-colors"
                    onViewportEnter={() => handleInteraction(post.id, 'view')}
                  >
                    {/* Decay Progress Bar */}
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-white/5">
                      <motion.div 
                        className="h-full bg-primary"
                        initial={{ width: '100%' }}
                        animate={{ width: `${lifePercent}%` }}
                        transition={{ duration: 1 }}
                      />
                    </div>

                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white/10 to-transparent flex items-center justify-center border border-white/10">
                          <Skull className="w-4 h-4 text-white/40" />
                        </div>
                        <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Unknown Signal</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-mono text-primary">
                        <Clock className="w-3 h-3" />
                        {Math.ceil(timeLeft / (60 * 1000))}M REMAINING
                      </div>
                    </div>

                    <p className="text-xl font-medium leading-relaxed mb-8 font-mono tracking-tight">
                      {post.content}
                    </p>

                    <div className="flex items-center gap-6">
                      <button 
                        onClick={() => handleInteraction(post.id, 'like')}
                        className="flex items-center gap-2 text-xs text-white/40 hover:text-red-500 transition-colors group/btn"
                      >
                        <Heart className={cn("w-4 h-4", post.likeCount > 0 && "fill-red-500 text-red-500")} />
                        <span className="font-mono">{post.likeCount}</span>
                      </button>
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <Eye className="w-4 h-4" />
                        <span className="font-mono">{post.viewCount}</span>
                      </div>
                    </div>

                    {/* Glitch Overlay (Visible on Hover) */}
                    <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-10 transition-opacity bg-[url('https://media.giphy.com/media/oEI9uWUznW3pS/giphy.gif')] bg-cover mix-blend-overlay" />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

```


## File: src/firebase.ts
```
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, getDocs, getDocFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Import the Firebase configuration
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMessage = error instanceof Error ? error.message : String(error);
  const isPermissionError = errMessage.toLowerCase().includes('permission') || errMessage.toLowerCase().includes('insufficient');
  
  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }

  const userFriendlyMessage = isPermissionError 
    ? "Neural Link Access Denied: Your current authorization level is insufficient for this operation."
    : "Neural Link Error: A disruption occurred in the data transmission. Please retry synchronization.";

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  // Throw an error that includes both the user-friendly message and the detailed JSON for the ErrorBoundary/Agent
  throw new Error(`${userFriendlyMessage} | DATA: ${JSON.stringify(errInfo)}`);
}

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

export type { FirebaseUser };

```


## File: src/index.css
```
@import "tailwindcss";
@plugin "@tailwindcss/typography";

@theme {
  --color-primary: #8B0000; /* Dark Red / Burgundy */
  --color-accent: var(--dynamic-accent, #FF0000); /* Dynamic or Bright Red */
  --color-background: #000000; /* Black */
  --color-surface: #1A1A1A; /* Dark Gray */
  
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  body {
    @apply bg-background text-white antialiased;
  }
}

div#root:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1) {
  box-shadow: 0 0 50px rgba(139, 0, 0, 0.1);
  transition: box-shadow 0.5s ease;
}

div#root:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(1):hover {
  box-shadow: 0 0 70px rgba(139, 0, 0, 0.2);
}

.glass-card {
  @apply bg-surface/80 backdrop-blur-md border border-white/10;
}

.neon-border {
  @apply border border-primary/50 shadow-[0_0_15px_rgba(139,0,0,0.3)];
}

.text-glow {
  @apply shadow-[0_0_10px_rgba(255,0,0,0.5)];
}

```


## File: src/lib/utils.ts
```
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

```


## File: src/main.tsx
```
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './AuthContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);

```


## File: src/types.ts
```
export type UserType = 'human' | 'bot';

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  coverUrl?: string;
  customAccent?: string;
  sponsoredEntity?: {
    name: string;
    type: 'business' | 'charity' | 'public' | 'individual';
    link: string;
    description: string;
  };
  bio: string;
  type: UserType;
  followersCount: number;
  followingCount: number;
  reputationScore?: number;
  isFollowing?: boolean;
  isThinking?: boolean; // For AI "Thinking Mode"
  isLive?: boolean;
  activeStreamId?: string | null;
}

export interface Post {
  id: string;
  authorId: string;
  author: User;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  createdAt: string;
  isLiked?: boolean;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  author: User;
  content: string;
  createdAt: string;
}

export interface Transmit {
  id: string;
  transmissionId: string;
  senderId: string;
  receiverId: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  createdAt: string;
}

export interface Transmission {
  id: string;
  participantIds: string[];
  participants?: User[]; // Joined data for UI
  lastTransmit?: {
    content: string;
    senderId: string;
    createdAt: string;
  };
  unreadCounts: { [userId: string]: number };
}

export interface Bounty {
  id: string;
  creatorId: string;
  creator: User;
  title: string;
  description: string;
  reward: number; // Cred
  status: 'open' | 'in-progress' | 'completed' | 'cancelled';
  assignedBotId?: string;
  assignedBot?: User;
  createdAt: string;
  completedAt?: string;
  result?: string; // The output from the bot
}

export interface VoidPost {
  id: string;
  content: string;
  decayRate: number; // How fast it disappears (e.g., 0.1 per view)
  viewCount: number;
  likeCount: number;
  createdAt: string;
  expiresAt: string;
  isAnonymous: boolean;
}

export interface LiveStream {
  id: string;
  hostId: string;
  hostName: string;
  hostUsername: string;
  hostAvatar: string;
  title: string;
  status: 'live' | 'ended';
  crowdSize: number;
  createdAt: string;
}

```


## File: tsconfig.json
```
{
  "compilerOptions": {
    "target": "ES2022",
    "experimentalDecorators": true,
    "useDefineForClassFields": false,
    "module": "ESNext",
    "lib": [
      "ES2022",
      "DOM",
      "DOM.Iterable"
    ],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "allowJs": true,
    "jsx": "react-jsx",
    "paths": {
      "@/*": [
        "./*"
      ]
    },
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}

```


## File: vite.config.ts
```
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

```
