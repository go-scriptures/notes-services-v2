# Operational front door for the notes service. Run `make help` to list the targets.

.DEFAULT_GOAL := help
NODE_MIN := 20
BASE_URL ?= http://localhost:3000
SEED_PASSWORD ?= notes-demo-password
EMAIL ?= sdarnold@seahawks.com
PASSWORD ?= $(SEED_PASSWORD)

.PHONY: help check install up down logs seed db-reset psql test test-integration demo health login auth-test note-create note-get notes note-edit note-attributes note-lock note-unlock note-delete activity-note activity-mine

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

test: ## Run the unit tests (no database needed)
	npm test

test-integration: ## Run every test, including integration tests against a separate notes_test database (after make up)
	@docker compose exec -T db psql -U notes -d notes -tAc "SELECT 1 FROM pg_database WHERE datname = 'notes_test'" | grep -q 1 \
		|| docker compose exec -T db createdb -U notes notes_test
	TEST_DATABASE_URL=postgres://notes:notes@localhost:5433/notes_test npm test

demo: ## Walk through the rules as the demo users, showing each step's status (after make up and make seed)
	BASE_URL=$(BASE_URL) SEED_PASSWORD='$(SEED_PASSWORD)' ./scripts/demo.sh

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

# ---------------------------------------------------------------------------
# Working with notes: run `make login` first; these use the saved token.
# ---------------------------------------------------------------------------

note-create: ## Create a note (TITLE required; VIEW and EDIT author or team, default author)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(TITLE)" || (echo "TITLE is required, for example: make note-create TITLE='Game plan'" && exit 1)
	curl --silent --show-error --fail-with-body -X POST $(BASE_URL)/notes \
		-H "Authorization: Bearer $$(cat .token)" -H 'Content-Type: application/json' \
		-d '{"title":"$(TITLE)","viewAccess":"$(or $(VIEW),author)","editAccess":"$(or $(EDIT),author)"}' && echo

note-get: ## Show one note (ID required)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" || (echo "ID is required, for example: make note-get ID=<note id>" && exit 1)
	curl --silent --show-error --fail-with-body $(BASE_URL)/notes/$(ID) -H "Authorization: Bearer $$(cat .token)" && echo

notes: ## List the notes I can see (optional AUTHOR=<user id>, PAGE=, SIZE=)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	curl --silent --show-error --fail-with-body --get $(BASE_URL)/notes -H "Authorization: Bearer $$(cat .token)" \
		$(if $(AUTHOR),--data-urlencode author=$(AUTHOR)) \
		$(if $(PAGE),--data-urlencode pageNumber=$(PAGE)) $(if $(SIZE),--data-urlencode pageSize=$(SIZE)) && echo

note-edit: ## Edit a note's text (ID and VERSION required; TITLE and/or BODY)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" -a -n "$(VERSION)" || (echo "ID and VERSION are required, for example: make note-edit ID=<note id> VERSION=1 BODY='new text'" && exit 1)
	@NOTE_TITLE="$(TITLE)" NOTE_BODY="$(BODY)" NOTE_VERSION="$(VERSION)" node -e "const b = { version: Number(process.env.NOTE_VERSION) }; \
		if (process.env.NOTE_TITLE) b.title = process.env.NOTE_TITLE; \
		if (process.env.NOTE_BODY) b.body = process.env.NOTE_BODY; \
		process.stdout.write(JSON.stringify(b))" \
		| curl --silent --show-error --fail-with-body -X PATCH $(BASE_URL)/notes/$(ID) \
			-H "Authorization: Bearer $$(cat .token)" -H 'Content-Type: application/json' --data-binary @- && echo

note-attributes: ## Change who can see and edit a note (ID required; VIEW and/or EDIT: author or team)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" || (echo "ID is required, for example: make note-attributes ID=<note id> VIEW=team" && exit 1)
	@NOTE_VIEW="$(VIEW)" NOTE_EDIT="$(EDIT)" node -e "const b = {}; \
		if (process.env.NOTE_VIEW) b.viewAccess = process.env.NOTE_VIEW; \
		if (process.env.NOTE_EDIT) b.editAccess = process.env.NOTE_EDIT; \
		process.stdout.write(JSON.stringify(b))" \
		| curl --silent --show-error --fail-with-body -X PATCH $(BASE_URL)/notes/$(ID)/attributes \
			-H "Authorization: Bearer $$(cat .token)" -H 'Content-Type: application/json' --data-binary @- && echo

note-lock: ## Lock a note's text (ID required)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" || (echo "ID is required, for example: make note-lock ID=<note id>" && exit 1)
	curl --silent --show-error --fail-with-body -X PUT $(BASE_URL)/notes/$(ID)/lock -H "Authorization: Bearer $$(cat .token)" && echo

note-unlock: ## Unlock a note's text (ID required)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" || (echo "ID is required, for example: make note-unlock ID=<note id>" && exit 1)
	curl --silent --show-error --fail-with-body -X PUT $(BASE_URL)/notes/$(ID)/unlock -H "Authorization: Bearer $$(cat .token)" && echo

note-delete: ## Delete a note permanently (ID required)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" || (echo "ID is required, for example: make note-delete ID=<note id>" && exit 1)
	curl --silent --show-error --fail-with-body -X DELETE $(BASE_URL)/notes/$(ID) -H "Authorization: Bearer $$(cat .token)" \
		&& echo "Deleted note $(ID)"

# ---------------------------------------------------------------------------
# Activity log: run `make login` first; these use the saved token.
# ---------------------------------------------------------------------------

activity-note: ## Show a note's activity (ID required; optional PAGE=, SIZE=)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@test -n "$(ID)" || (echo "ID is required, for example: make activity-note ID=<note id>" && exit 1)
	curl --silent --show-error --fail-with-body --get $(BASE_URL)/activity/notes/$(ID) -H "Authorization: Bearer $$(cat .token)" \
		$(if $(PAGE),--data-urlencode pageNumber=$(PAGE)) $(if $(SIZE),--data-urlencode pageSize=$(SIZE)) && echo

activity-mine: ## Show my own activity across all notes (optional PAGE=, SIZE=)
	@test -s .token || (echo "No token: run make login first" && exit 1)
	@USER_ID=$$(curl --silent --fail $(BASE_URL)/auth/test -H "Authorization: Bearer $$(cat .token)" \
		| node -e "let s = ''; process.stdin.on('data', d => s += d).on('end', () => process.stdout.write(JSON.parse(s).id))") \
		&& curl --silent --show-error --fail-with-body --get $(BASE_URL)/activity/users/$$USER_ID -H "Authorization: Bearer $$(cat .token)" \
		$(if $(PAGE),--data-urlencode pageNumber=$(PAGE)) $(if $(SIZE),--data-urlencode pageSize=$(SIZE)) && echo
