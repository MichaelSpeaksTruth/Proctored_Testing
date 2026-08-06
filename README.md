# AeroSoc BIT Mesra Proctored Testing Platform

**Author and Credits:** Anurag Kumar Verma

## 1. Purpose

The platform is built specifically for AeroSoc BIT Mesra's Recruitment Online Assessment. It addresses the need for a scalable, privacy-first testing environment that prevents cheating without using intrusive, instant-lockout mechanics. By employing an observe-and-log duration-based model, it ensures a seamless experience for candidates and zero media storage, while giving administrators concrete data on academic integrity.

## 2. Architecture Overview

**Core Framework:** Next.js 16 (App Router).

**Authentication and State:** Firebase Realtime Database and Admin SDK. (Note: Firestore is not used in order to avoid document write limits).

**Edge Proctoring Engine:** MediaPipe (FaceMesh for face presence, Vision Tasks for cell phone detection). All processing executes strictly on the client-side browser to guarantee zero audio or video storage.

**Data Flow:** Local stopwatch logging computes the exact duration of an infraction (e.g., out of fullscreen, phone detected) and sends a single debounced write to Firebase Realtime Database upon completion.

**AI Analytics:** Groq API ingests the duration-based logs to generate a final, human-readable proctoring summary for the administrative dashboard.

## 3. High-Concurrency Resilience and Scalability

The platform is engineered specifically to handle the Thundering Herd scenario, where 500 or more users click "Start Test" at the exact same millisecond. Traditional architectures fail under this stress due to database connection limits and strict API rate limiting. This platform guarantees stability for 500+ concurrent users processing 100+ MCQs through a four-pillar distributed architecture.

### 3.1 Overcoming Firebase Realtime Database Limitations

**The Limitation:** Firebase Realtime Database imposes strict bandwidth limits (10GB per month on the free tier) and connection limits (100 concurrent connections on Spark). If 500 users maintain a persistent WebSocket connection to sync their MCQ answers in real time, the database will throttle, disconnect users, and exhaust the quota within hours.

**The Workaround:** 
1. **Zero-Connection Exam State:** The system strictly prohibits the client application from maintaining an open WebSocket connection to Firebase during the examination.
2. **Offline-Resilient Persistence:** A custom `useTestState` hook tightly couples the React application state to the browser's `localStorage`. Every time a student selects one of the 100+ MCQs, the answer is synchronously updated on their local machine. This results in exactly zero database writes during the exam phase. If a student loses internet connection, closes the tab, or refreshes the page, their exact progress remains safe on their local SSD and instantly rehydrates upon load.

### 3.2 Overcoming Vercel and Database Read Bottlenecks

**The Limitation:** Fetching a 100+ MCQ JSON payload directly from the database for 500 simultaneous users will trigger massive read spikes, resulting in latency and potential API timeouts.

**The Workaround:**
**Edge-Cached Question Delivery:** Questions are relayed through a serverless route (`/api/get-test-questions`) rather than direct client-to-database calls. This route is configured with aggressive `Cache-Control` headers (`s-maxage=3600, stale-while-revalidate=86400`). When the first user requests the test, Vercel fetches the payload from Firebase and caches it globally across its Edge Network. The remaining 499 users receive the cached JSON instantly from the Edge node closest to them. The database experiences zero additional reads, neutralizing the traffic spike completely. To purge stale content instantly, administrators can trigger a webhook that executes Vercel's On-Demand Revalidation to clear the Edge cache.

### 3.3 Overcoming Submission Bottlenecks

**The Limitation:** When the global timer expires, 500 clients submit massive JSON payloads (100+ answers each) simultaneously. Writing to a single master document or incrementing a global counter causes severe document contention and write failures. Furthermore, clients cannot be trusted to write directly to the database without exposing security rules.

**The Workaround:**
**Secure Serverless Relay with Isolated Writes:** The final JSON payload is dispatched to a secure Vercel API route (`/api/grade-test`). Vercel automatically scales serverless functions, spinning up 500 independent execution environments instantly. Each function validates the Firebase Auth ID token server-side to prevent spoofing, and then executes a write to a mathematically isolated path (`submissions/{testId}/{uid}`) using the Firebase Admin SDK. Because the write paths are entirely isolated, there is zero database contention. 

### 3.4 Defeating the Local Clock Exploit

**The Vulnerability:** Because the test state is managed offline to save bandwidth, a disconnected user could theoretically alter their local system clock to prevent the timer from expiring, granting them infinite time to solve the 100+ MCQs.

**The Workaround:** The Serverless API enforces strict server-side timestamp validation. When the payload is received, the server compares the current time against the securely logged test activation timestamp. If the calculated duration exceeds the allowed limit plus a rigid network buffer, the submission is accepted but permanently flagged with a `DELAYED_SUBMISSION` integrity flag and automatically marked as Disqualified pending administrative review.

## 4. Security and Integrity Mechanisms

The system enforces a strict defense-in-depth security perimeter:

- **Hardware Verification Gate:** The local machine learning pipeline verifies that a face is present, the camera is uncovered, and the microphone is picking up ambient audio before granting access.
- **Client-Side DOM Restrictions:** Rigorous DOM restrictions disable text selection, drag-to-copy, and context menus. Keydown listeners block keyboard shortcuts for copying or printing, and CSS print media queries obscure all content to defeat print-to-PDF screenshot attacks. 
- **Tab Tracking:** The Page Visibility API monitors for tab switching or browser minimization, logging infractions immediately.

**The DevTools Reality Check:** While the browser lockdowns effectively deter casual violations, they rely on JavaScript and CSS, which can be bypassed via browser developer tools. The platform acknowledges this limitation; therefore, the true security perimeter is fundamentally anchored in the Edge ML proctoring pipeline and the server-side timestamp validation. The DOM locks serve merely as a friction layer, not the ultimate source of truth.

## 5. Deployment and Usage

**Deployed Application:** https://proctored-testing.vercel.app

**Candidate Workflow:** Candidates authenticate exclusively via pre-approved Google accounts. After granting hardware permissions and passing local environmental checks, the interface enforces a fullscreen constraint. Answers are cached locally in real-time to survive network drops. Upon completion or timer expiration, the answers are securely relayed to the server.

**Administrator Workflow:** Authorized administrators access a secure dashboard to monitor active test takers, review telemetry data, and analyze human-readable proctoring reports generated by the Groq AI integration. This allows for informed, evidence-based decisions regarding candidate integrity.
