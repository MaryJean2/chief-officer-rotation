CHIEF OFFICER ROTATION PLANNER v5 — SHARED SYNC

WHAT CHANGED
- Firebase Authentication sign-in.
- Cloud Firestore shared planner.
- Real-time sync between Will and Paul.
- Offline Firestore cache where supported; changes sync after reconnection.
- Visible Synced / Saving / Offline / Error status.
- Existing v4 local/default plan is used to initialise the cloud planner the first time an authorised user connects.
- Backup/import, spreadsheet-plan reset and Clear All now affect the shared planner for both users.

REQUIRED FIREBASE STEP BEFORE THE APP CAN SYNC
1. Firebase Console > Firestore Database > Rules.
2. Replace the rules with the contents of FIREBASE-RULES.txt.
3. Click Publish.

GITHUB PAGES
Upload the CONTENTS of this rotation-planner folder to your GitHub repository root.
Do not upload only the ZIP.
Then Settings > Pages > Deploy from a branch > main > /(root).

FIRST USE
1. Open the GitHub Pages URL.
2. Sign in with one of the Email/Password users you created in Firebase Authentication.
3. The first authorised online login initialises Firestore from the plan already present on that browser (or the bundled original spreadsheet plan if there was no local plan).
4. Open the same URL on the other device and sign in with the other account.
5. Both devices then receive the same Firestore planner in real time.

IMPORTANT
- Do not press 'Reload spreadsheet plan' unless you intend to replace the shared live schedule for both users.
- Do not press 'Clear all data' unless you intend to clear the shared live schedule for both users.
- Export backup remains useful even with cloud sync.
