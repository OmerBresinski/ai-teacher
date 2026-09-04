#!/usr/bin/env bash
# Provision the Teaching Journey Railway project (TEACH-24 / TEACH-38, ADR 0010). Idempotent: re-run
# safely.
#
#   ./infra/railway/provision.sh                 # create/link project, services, IaC settings, vars, domain
#   ./infra/railway/provision.sh --deploy        # ...and `railway up` api + worker from this checkout
#
# Requires: railway CLI >= 5.49 logged in (`railway whoami`), bun, node >= 22.6 (the CLI evaluates
# .railway/railway.ts with node), jq, python3, openssl, `bun install` done (the `railway` npm package
# provides `railway/iac`), and a Railway workspace WITH AN ACTIVE PLAN (project creation is rejected
# server-side otherwise: "Your trial has expired. Please select a plan to continue using Railway.").
#
# Service settings (builder, watch patterns, commands, health check, region, ...) and the postgres
# image + volume are declared in .railway/railway.ts and pushed with `railway config apply` (step 3).
# Everything else is CLI, plus one GraphQL mutation (`projectUpdate { prDeploys }`, step 6). The
# things that still need the dashboard are listed at the end of the run and in infra/README.md
# ("Dashboard-only steps").
set -euo pipefail

PROJECT_NAME="${RAILWAY_PROJECT_NAME:-teaching-journey}"
WORKSPACE="${RAILWAY_WORKSPACE:-}"                   # id or exact name; prompts if unset+interactive
ENVIRONMENT="${RAILWAY_ENVIRONMENT:-production}"
# Region (europe-west4-drams3a, EU-West / ADR 0010 / 0016) lives in .railway/railway.ts.
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
need railway; need jq; need python3; need openssl; need node
node -e 'const [M,m]=process.versions.node.split(".").map(Number); process.exit(M>22||(M===22&&m>=6)?0:1)' \
  || { echo "node >= 22.6 required to evaluate .railway/railway.ts (have $(node -v))" >&2; exit 1; }
[[ -d node_modules/railway ]] || { echo "missing: node_modules/railway -- run 'bun install' (railway/iac for .railway/railway.ts)" >&2; exit 1; }

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
# Region, restart policy ALWAYS and the volume mount are declared in .railway/railway.ts (step 3).
# NEVER give postgres a public domain / TCP proxy.

# --- 3. api + worker services + settings + GitHub source from .railway/railway.ts (IaC, TEACH-38) --
API_ID=$(ensure_service api);       echo "api=$API_ID"
WORKER_ID=$(ensure_service worker); echo "worker=$WORKER_ID"

# `railway config apply` diffs .railway/railway.ts against the linked environment and pushes only the
# changes (no-op when already in sync). Variables are listed there as `preserve()` (names from
# infra/env.contract.ts), so this never writes values; it WOULD delete a variable that is on Railway
# but not in the contract -- such destructive changes are refused non-interactively (no
# --confirm-destructive here on purpose): fix the contract or the variable, then re-run.
# The file also declares `source: github(...)` for api and worker, so the Railway GitHub App must be
# installed on the repo (dashboard, once) BEFORE this step; otherwise apply fails here.
log "service settings + GitHub source: railway config apply (.railway/railway.ts)"
railway config apply --yes \
  || { echo "!! railway config apply failed. If the error mentions the GitHub source: install the Railway GitHub App on $GITHUB_REPO (dashboard) and re-run." >&2; exit 1; }
railway config plan --detailed-exit-code >/dev/null || { echo "!! .railway/railway.ts still differs from Railway -- run 'railway config plan'" >&2; exit 1; }

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

# --- 6. PR environments (project setting; GraphQL -- not exposed by the CLI nor by IaC) -----------
log "PR environments: enable"
gql 'mutation($id:String!,$i:ProjectUpdateInput!){projectUpdate(id:$id,input:$i){id prDeploys}}' \
  "$(jq -n --arg id "$PROJECT_ID" '{id:$id,i:{prDeploys:true}}')" | jq -c '.data // .errors'

# --- 7. Optional first deploy from this checkout ------------------------------------------------
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

Drift check any time: railway config plan   (.railway/railway.ts vs production)

Dashboard-only (see infra/README.md):
  - Install the Railway GitHub App on $GITHUB_REPO before step 3 (railway config apply declares the GitHub source).
  - Confirm Settings -> Environments -> "Enable PR environments" is on (set here via projectUpdate).
EOF
