# Deployment Procedure

This document provides a comprehensive, step-by-step guide to deploying the AeroSoc Proctored Testing Platform from scratch.

## Step 1: Prerequisites
1. **GitHub Account:** Ensure your code is pushed to a GitHub repository.
2. **Google Account:** Required to create a Firebase project.
3. **Vercel Account:** Required for hosting the Next.js frontend and Edge API routes.
4. **Groq Account:** Required for the LLM-powered proctoring analysis API.

## Step 2: Firebase Setup

### 2.1 Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project**. Name it (e.g., `proctored-testing-platform`) and click **Continue**.
3. You can disable Google Analytics for this project, then click **Create Project**.

### 2.2 Register the Web App
1. On the project overview page, click the **Web (`</>`)** icon to add a web app.
2. Register the app with a nickname.
3. Copy the `firebaseConfig` object (you will need these keys for Vercel later).

### 2.3 Enable Authentication
1. Navigate to **Build > Authentication** in the left sidebar and click **Get Started**.
2. Go to the **Sign-in method** tab, click **Add new provider**, and select **Google**.
3. Enable it, provide a support email, and click **Save**.

### 2.4 Enable Realtime Database
1. Navigate to **Build > Realtime Database** and click **Create Database**.
2. Choose a location (e.g., Singapore/Asia-Southeast1) and start in **Locked Mode**.
3. Once created, go to the **Rules** tab.
4. Copy the entire contents of `database.rules.json` from this repository and paste it into the Rules editor. Click **Publish**.

### 2.5 Generate Admin SDK Service Account Key
1. Click the **Gear icon** next to Project Overview and select **Project settings**.
2. Go to the **Service accounts** tab.
3. Click **Generate new private key**.
4. This will download a JSON file containing your private key. Open it in a text editor and copy the entire JSON object on a single line. This will be your `FIREBASE_SERVICE_ACCOUNT_KEY`.

## Step 3: Groq AI Setup
1. Go to the [Groq Console](https://console.groq.com/).
2. Create an account and log in.
3. Navigate to **API Keys** and click **Create API Key**.
4. Copy this key. This will be your `GROQ_API_KEY`.

## Step 4: Vercel Deployment & Environment Variables

### 4.1 Import the Project
1. Go to [Vercel](https://vercel.com/) and click **Add New... > Project**.
2. Import the GitHub repository containing your code.
3. In the "Framework Preset" dropdown, ensure **Next.js** is selected.
4. Set the Root Directory to `proctored-testing` if your package.json is inside that folder.

### 4.2 Configure Environment Variables
Before clicking Deploy, expand the **Environment Variables** section and add the following keys. 

*From your Firebase config object in Step 2.2:*
- `NEXT_PUBLIC_FIREBASE_API_KEY`: Your Firebase API key
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`: e.g., `your-project.firebaseapp.com`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`: Your project ID
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`: e.g., `your-project.firebasestorage.app`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`: The sender ID string
- `NEXT_PUBLIC_FIREBASE_APP_ID`: The app ID string
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL`: The URL to your realtime database (e.g., `https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app/`)

*Supreme Administrators (Admin Sr. — Users who can configure tests, declare results, manage personnel, and override rules):*
- `NEXT_PUBLIC_ADMIN_1`: `imanuragkrverma@gmail.com` (or your email)
- `NEXT_PUBLIC_ADMIN_2`: `ananyakrishnan2102@gmail.com` (or your co-admin email)

*Secrets:*
- `GROQ_API_KEY`: The key generated in Step 3.
- `FIREBASE_SERVICE_ACCOUNT_KEY`: The single-line JSON string downloaded in Step 2.5.

### 4.3 Deploy
1. Click **Deploy**. Vercel will build the Next.js application. 
2. Wait for the build to finish. Once done, Vercel will provide a production domain (e.g., `https://your-repo-name.vercel.app`).

## Step 5: Post-Deployment Configuration (Crucial)

### Authorize Vercel Domain in Firebase
If you try to log in via Google Auth on your deployed Vercel site right now, it will fail because the domain is not authorized.

1. Go back to the **Firebase Console**.
2. Navigate to **Authentication > Settings > Authorized domains**.
3. Click **Add domain**.
4. Enter the Vercel domain provided in Step 4.3 (e.g., `your-repo-name.vercel.app`) without the `https://` prefix.
5. Click **Add**.

## Step 6: Verify Deployment
1. Go to your live Vercel URL.
2. Log in using one of the Admin Google accounts.
3. You should see the Admin Dashboard.
4. Create a test user, start a test, and ensure the camera/microphone permissions trigger correctly.

---
*Your deployment is now complete and secured.*
