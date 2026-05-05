<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This project is now split into a backend and frontend:

- [backend/server.js](backend/server.js)
- [frontend/index.html](frontend/index.html)
- [frontend/src](frontend/src)

View your app in AI Studio: https://ai.studio/apps/5fb5d309-a84e-462c-9f81-b414844bcf45

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the required environment variables in [.env](.env):
   `JWT_SECRET`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_FIRESTORE_DATABASE_ID`, and optionally `GEMINI_API_KEY`
3. Run the app:
   `npm run dev`

## Build And Preview

1. Build the frontend:
   `npm run build`
2. Preview the built frontend:
   `npm run preview`
