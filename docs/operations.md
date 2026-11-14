# Operations

Deploy, hosting and the production tasks that come up. Every command here takes
`--project groove-scribe-zdvihal`: the same Google account holds company projects. Any write to
production needs the user's approval for that step.

## CI and deploy

- `.github/workflows/ci-deploy.yml` runs on each PR and each push to `master`: "Lint and unit
  tests", "Golden master", "Security rules and library panel", then "Deploy to Firebase" on
  `master` only.
- A merge to `master` is a production release. The user merges; agents do not.
- There is no stored secret. GitHub signs in through Workload Identity Federation, and
  `scripts/setup-deploy.sh` (run once) lets only this repo's `master` deploy.
- `npm run deploy` deploys Hosting and Firestore rules by hand.
- After a merge, check the run (`gh run list --repo vasekzdvihal/groove-scribe --branch master`)
  and fetch a changed file from `https://groove-scribe-zdvihal.web.app` to see it is live.
- Two jobs run in the Playwright image. Keep its version equal to `@playwright/test` in
  `package-lock.json` (see [`testing.md`](testing.md)).

## Hosting cache

- `fonts/` holds the Lato font files, served from our own host.
- Firebase Hosting caches `soundfont/`, `font-awesome/`, `images/` and `fonts/` for 30 days
  (`firebase.json`). A changed file in these folders needs a new file name, and every reference
  must point to the new name.
- For the service worker rules and the emergency worker, see [`offline.md`](offline.md).

## Give a person access

A new person needs an `allowedUsers/{uid}` document with their Auth UID. They must sign in once
first, so that Auth has their UID.

1. Find the UID: Firebase console → Authentication, or export and delete the file after use:

   ```bash
   npx -y firebase-tools auth:export users.json --format=json --project groove-scribe-zdvihal
   ```

2. Create the document in the console (Firestore → `allowedUsers` → add a document with the UID as
   its ID; the rules check only that it exists), or with the REST API:

   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "x-goog-user-project: groove-scribe-zdvihal" \
     -H "Content-Type: application/json" -d '{"fields":{}}' \
     "https://firestore.googleapis.com/v1/projects/groove-scribe-zdvihal/databases/(default)/documents/allowedUsers/<UID>"
   ```

3. The person reloads the app. The `users/{uid}` profile is written by the app on the first
   online library open; you do not create it.
