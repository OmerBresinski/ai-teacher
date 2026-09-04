#!/usr/bin/env bash
# Provision the Teaching Journey Railway project (TEACH-24, ADR 0010). Idempotent: re-run safely.
#
#   ./infra/railway/provision.sh                 # create/link project, services, vars, domain
#   ./infra/railway/provision.sh --deploy        # ...and `railway up` api + worker from this checkout
#
# Requires: railway CLI >= 5.49 logged in (`railway whoami`), bun, jq, python3, openssl, and a Railway
# workspace WITH AN ACTIVE PLAN (project creation is rejected server-side otherwise:
# "Your trial has expired. Please select a plan to continue using Railway.").
#
# Everything here is CLI or GraphQL (backboard). The two things that still need the dashboard are
# listed at the end of the run and in infra/README.md ("Dashboard-only steps").
set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-teaching-journey}"
WORKSPACE="${RAILWAY_WORKSPACE:-}"                   # id or exact name; prompts if unset+interactive
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
REGION="${RAILWAY_REGION:-europe-west4-drams3a}"     # EU-West (Amsterdam), ADR 0010 / 0016
PG_IMAGE="${RAILWAY_PG_IMAGE:-pgvector/pgvector:pg16}" # same image as docker-compose.yml
GITHUB_REPO="${RAILWAY_GITHUB_REPO:-OmerBresinski/ai-teacher}"
GITHUB_BRANCH="${RAILWAY_GITHUB_BRANCH:-master}"
WEB_ORIGIN_PLACEHOLDER="${WEB_ORIGIN_PLACEHOLDER:-}"  # optional override of the contract's WEB_ORIGIN

export RAILWAY_CALLER="${RAILWAY_CALLER:-skill:use-railway@1.3.7}"
export RAILWAY_AGENT_SESSION="${RAILWAY_AGENT_SESSION:-teach-24-provision-$$}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

log() { printf '\n==> %s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need railway; need jq; need python3; need openssl

# --- GraphQL helper (token from the CLI's own config; nothing is stored here) ------------------
gql() {
  local token
  token=$(python3 -c "import json,os; u=json.load(open(os.path.expanduser('~/.railway/config.json')))['user']; print(u.get('token') or u.get('accessToken'))")
  local payload
  if [[ -n "${2:-}" ]]; then payload=$(jq -n --arg q "$1" --argjson v "$2" '{query:$q,variables:$v}');
  else payload=$(jq -n --arg q "$1" '{query:$q}'); fi
  printf '%s' "$payload" | curl -sS https://backboard.railway.com/graphql/v2 \
    -H "Content-Type: application/json" \
    --config <(printf 'header = "Authorization: Bearer %s"\n' "$token") -d @-
}

# --- 1. Project (create + link, or link existing) ----------------------------------------------
log "project: $PROJECT_NAME"
if ! railway status --json >/dev/null 2>&1; then
  existing=$(railway list --json 2>/dev/null | jq -r --arg n "$PROJECT_NAME" '.[] | select(.name==$n) | .id' | head -1)
  if [[ -n "$existing" ]]; then
    railway link --project "$existing" --environment "$ENVIRONMENT"
  else
    if [[ -n "$WORKSPACE" ]]; then railway init --name "$PROJECT_NAME" --workspace "$WORKSPACE" --json
    else railway init --name "$PROJECT_NAME" --json; fi
  fi
fi
STATUS=$(railway status --json)
PROJECT_ID=$(jq -r '.id' <<<"$STATUS")
ENV_ID=$(jq -r --arg e "$ENVIRONMENT" '.environments.edges[].node | select(.name==$e) | .id' <<<"$STATUS")
echo "project=$PROJECT_ID environment=$ENVIRONMENT ($ENV_ID)"

service_id() { railway service list --json | jq -r --arg n "$1" '.[] | select(.name==$n) | .id' | head -1; }
ensure_service() { # name, extra railway add args...
  local name="$1"; shift
  local id; id=$(service_id "$name")
  if [[ -z "$id" ]]; then
    log "service: creating $name"
    railway add --service "$name" "$@" --json >/dev/null
    id=$(service_id "$name")
  fi
  echo "$id"
}

# --- 2. Postgres 16 + pgvector (plain image + volume; Railway's managed Postgres lacks pgvector) --
PG_PASSWORD_NEW=$(openssl rand -hex 24)
PG_ID=$(ensure_service postgres --image "$PG_IMAGE" \
  --variables "POSTGRES_USER=postgres" --variables "POSTGRES_DB=teaching_journey" \
  --variables "POSTGRES_PASSWORD=$PG_PASSWORD_NEW" --variables "PGDATA=/var/lib/postgresql/data/pgdata")
echo "postgres=$PG_ID"
if ! railway volume list --json 2>/dev/null | jq -e '.volumes[] | select(.serviceName=="postgres")' >/dev/null; then
  log "volume for postgres"
  # `volume add` (CLI 5.49) has no --service flag: it targets the linked service.
  railway service link postgres >/dev/null
  railway volume add --mount-path /var/lib/postgresql/data --json >/dev/null
fi
# Region + no start-command override; NEVER give postgres a public domain / TCP proxy by default.
gql 'mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$i)}' \
  "$(jq -n --arg s "$PG_ID" --arg e "$ENV_ID" --arg r "$REGION" '{s:$s,e:$e,i:{region:$r,restartPolicyType:"ALWAYS"}}')" >/dev/null

# --- 3. api + worker services (Dockerfile at repo root, per-service config-as-code) ---------------
API_ID=$(ensure_service api);       echo "api=$API_ID"
WORKER_ID=$(ensure_service worker); echo "worker=$WORKER_ID"

# Railway deprecated railway.json/toml config-as-code (2026) in favour of .railway/railway.ts, and
# "DOCKERFILE" left the Builder enum (a Dockerfile is auto-detected via dockerfilePath). Until we
# migrate to IaC, apply the settings from infra/railway/<svc>.json directly to the service instance
# so those files remain the reviewable source of truth.
apply_service_settings() { # serviceId path
  local input
  input=$(jq -c --arg r "$REGION" '
    {dockerfilePath: .build.dockerfilePath, watchPatterns: .build.watchPatterns, region: $r}
    + (.deploy | del(.region))' "$2")
  gql 'mutation($s:String!,$e:String!,$i:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$i)}' \
    "$(jq -n --arg s "$1" --arg e "$ENV_ID" --argjson i "$input" '{s:$s,e:$e,i:$i}')" \
    | jq -e '.data.serviceInstanceUpdate==true' >/dev/null || { echo "serviceInstanceUpdate failed for $1 ($2)" >&2; exit 1; }
}
log "service settings from infra/railway/*.json + region"
apply_service_settings "$API_ID" "infra/railway/api.json"
apply_service_settings "$WORKER_ID" "infra/railway/worker.json"

# --- 4. Variables (from infra/env.contract.ts via scripts/railway-vars.ts; TEACH-26) ------------
# `railway-vars.ts` prints the non-secret `NAME=value` pairs (plain config + `${{...}}` references)
# for a service; secrets are `# secret:` comments and are set below through --stdin. WEB_ORIGIN
# can still be overridden for a first deploy with WEB_ORIGIN_PLACEHOLDER.
need bun
seed_variables() { # service
  local svc="$1" line; local -a pairs=()
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$svc" == api && "$line" == WEB_ORIGIN=* && -n "${WEB_ORIGIN_PLACEHOLDER:-}" ]]; then
      line="WEB_ORIGIN=$WEB_ORIGIN_PLACEHOLDER"
    fi
    pairs+=("$line")
  done < <(bun scripts/railway-vars.ts "$svc")
  log "variables: $svc (${#pairs[@]} from the contract)"
  railway variable set --service "$svc" --skip-deploys "${pairs[@]}"
}
seed_variables api
if ! railway variable list --service api --json | jq -e 'has("BETTER_AUTH_SECRET")' >/dev/null; then
  openssl rand -base64 32 | tr -d '\n' | railway variable set BETTER_AUTH_SECRET --stdin --service api --skip-deploys
fi
seed_variables worker
echo "manual/secret names still to set (docs/env.md, 'Where each value is set'):"
bun scripts/railway-vars.ts api | grep -E '^# (secret|manual):' | grep -v BETTER_AUTH_SECRET || true

# --- 5. Public domain for api only ---------------------------------------------------------------
if ! railway domain list --service api --json | jq -e '.domains | length > 0' >/dev/null 2>&1; then
  log "domain: api"
  railway domain --service api --port 3001 --json
fi
API_DOMAIN=$(railway domain list --service api --json | jq -r '.domains[0].domain // .domains[0].name // empty')
echo "api domain: https://${API_DOMAIN:-<pending>}"

# --- 6. GitHub source (needs the Railway GitHub App installed on the repo -- dashboard, once) -----
log "source: $GITHUB_REPO@$GITHUB_BRANCH"
for svc in api worker; do
  railway service source connect --repo "$GITHUB_REPO" --branch "$GITHUB_BRANCH" --service "$svc" --json \
    || echo "!! could not connect GitHub source for $svc -- install the Railway GitHub App on $GITHUB_REPO (dashboard) and re-run"
done

# --- 7. PR environments (project setting; GraphQL -- not exposed by the CLI) ---------------------
log "PR environments: enable"
gql 'mutation($id:String!,$i:ProjectUpdateInput!){projectUpdate(id:$id,input:$i){id prDeploys}}' \
  "$(jq -n --arg id "$PROJECT_ID" '{id:$id,i:{prDeploys:true}}')" | jq -c '.data // .errors'

# --- 8. Optional first deploy from this checkout ------------------------------------------------
if [[ "${1:-}" == "--deploy" ]]; then
  log "deploy (railway up)"
  railway up --service api --ci -m "TEACH-24 provision"
  railway up --service worker --ci -m "TEACH-24 provision"
fi

cat <<EOF

Done. Verify:
  railway status --json
  railway deployment list --service api --json | jq '.[0].status'
  curl -s https://${API_DOMAIN:-<api-domain>}/health        # {"ok":true,"db":"up"}
  railway connect postgres  ->  select extname from pg_extension;   # vector

Dashboard-only (see infra/README.md):
  - Install the Railway GitHub App on $GITHUB_REPO if step 6 printed "!!".
  - Confirm Settings -> Environments -> "Enable PR environments" is on (set here via projectUpdate).
EOF
