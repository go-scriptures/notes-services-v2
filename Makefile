# Operational front door for the notes service. Run `make help` to list the targets.

.DEFAULT_GOAL := help
NODE_MIN := 20
BASE_URL ?= http://localhost:3000
SEED_PASSWORD ?= notes-demo-password
EMAIL ?= sdarnold@seahawks.com
PASSWORD ?= $(SEED_PASSWORD)

.PHONY: help check install up down logs seed db-reset psql test health login auth-test

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-12s %s\n", $$1, $$2}'

check: ## Confirm Node and Docker are installed and running
	@node -e "const m = Number(process.versions.node.split('.')[0]); if (m < $(NODE_MIN)) { console.error('Node $(NODE_MIN) or later is required; you are running ' + process.versions.node + '.'); process.exit(1); }" \
		|| (echo "Node is required: https://nodejs.org" && exit 1)
	@docker info > /dev/null 2>&1 \
		|| (echo "Docker is required but not running. Install or start Docker Desktop: https://docs.docker.com/get-docker/" && exit 1)
	@docker compose version > /dev/null 2>&1 \
		|| (echo "Docker Compose v2 is required: https://docs.docker.com/compose/install/" && exit 1)
	@echo "Prerequisites OK"

install: ## Install Node dependencies
	npm install

up: check ## Build and start the database and the service, and wait until both are healthy
	docker compose up --build --detach --wait
	@echo "Notes service is up on $(BASE_URL)"

down: ## Stop the database and the service (data is kept)
	docker compose down

logs: ## Follow the service's logs
	docker compose logs --follow api

seed: ## Load the demo teams and users (safe to repeat)
	docker compose exec -e SEED_PASSWORD='$(SEED_PASSWORD)' api node scripts/seed.js

db-reset: check ## Delete all data, then start again with a fresh, migrated and seeded database
	docker compose down --volumes
	docker compose up --build --detach --wait
	$(MAKE) seed

psql: ## Open a SQL prompt on the database
	docker compose exec db psql -U notes -d notes

test: ## Run the tests
	npm test

# ---------------------------------------------------------------------------
# Validating a new install: run these in order after `make up`.
# ---------------------------------------------------------------------------

health: ## 1. Check the service and its database answer
	curl --silent --show-error --fail-with-body $(BASE_URL)/health && echo

login: ## 2. Log in (EMAIL, PASSWORD; default Sam Darnold) and save the token to .token
	@curl --silent --show-error --fail-with-body -X POST $(BASE_URL)/auth/login \
		-H 'Content-Type: application/json' \
		-d '{"email":"$(EMAIL)","password":"$(PASSWORD)"}' \
		| node -e "let s = ''; process.stdin.on('data', d => s += d).on('end', () => { \
			const body = JSON.parse(s || '{}'); \
			if (!body.accessToken) { console.error('Login failed: ' + (body.error ?? 'no response')); process.exit(1); } \
			require('node:fs').writeFileSync('.token', body.accessToken); \
			console.log('Logged in as $(EMAIL); token saved to .token'); })"

auth-test: ## 3. Confirm the saved token is accepted, and show the authenticated user
	@test -s .token || (echo "No token: run make login first" && exit 1)
	curl --silent --show-error --fail-with-body $(BASE_URL)/auth/test -H "Authorization: Bearer $$(cat .token)" && echo
