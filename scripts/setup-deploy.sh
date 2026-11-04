#!/usr/bin/env bash
# Google Cloud setup for .github/workflows/ci-deploy.yml. Run it as a project owner.
# It is safe to run again: it skips what exists. Google can refuse a call with a temporary 429.
# It stores no secret. It lets only the master branch of this repository deploy.
set -euo pipefail

PROJECT=groove-scribe-zdvihal
PROJECT_NUMBER=392258124104
REPOSITORY_ID=1444060689 # vasekzdvihal/groove-scribe. A new repo with the same name gets a different ID.
ACCOUNT="github-deploy@$PROJECT.iam.gserviceaccount.com"

gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  --project "$PROJECT"

if ! gcloud iam service-accounts describe "$ACCOUNT" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-deploy --project "$PROJECT" \
    --display-name 'GitHub Actions deploy' \
    --description 'Deploys Hosting and Firestore rules from vasekzdvihal/groove-scribe master'
fi

# Only what `firebase deploy --only hosting,firestore` needs.
for role in firebasehosting.admin firebaserules.admin datastore.indexAdmin \
  serviceusage.serviceUsageConsumer serviceusage.serviceUsageViewer firebase.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member "serviceAccount:$ACCOUNT" --role "roles/$role" --condition None --format none
done

if ! gcloud iam workload-identity-pools describe github --project "$PROJECT" --location global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create github --project "$PROJECT" --location global \
    --display-name 'GitHub Actions'
fi

if ! gcloud iam workload-identity-pools providers describe groove-scribe --project "$PROJECT" \
  --location global --workload-identity-pool github >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc groove-scribe --project "$PROJECT" \
    --location global --workload-identity-pool github \
    --display-name 'groove-scribe master' \
    --issuer-uri 'https://token.actions.githubusercontent.com' \
    --attribute-mapping 'google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref' \
    --attribute-condition "assertion.repository_id=='$REPOSITORY_ID' && assertion.ref=='refs/heads/master'"
fi

gcloud iam service-accounts add-iam-policy-binding "$ACCOUNT" --project "$PROJECT" \
  --role roles/iam.workloadIdentityUser --format none \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPOSITORY_ID"

echo "Done. Roles on $ACCOUNT:"
gcloud projects get-iam-policy "$PROJECT" --flatten bindings \
  --filter "bindings.members:$ACCOUNT" --format 'value(bindings.role)'
