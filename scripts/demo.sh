#!/usr/bin/env bash
# A scripted walk-through of the notes service's rules, against the running service and the
# seeded demo users. Run with `make demo` after `make up` and `make seed`.
#
# @author: tgibbons via Claude
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASSWORD="${SEED_PASSWORD:-notes-demo-password}"

# Prints a field of the JSON on stdin (for example: json id).
json() {
    node -e "let s = ''; process.stdin.on('data', d => s += d).on('end', () => { const v = JSON.parse(s)$1; console.log(typeof v === 'object' ? JSON.stringify(v) : v); })"
}

# Logs in and prints the access token.
login() {
    curl -s -X POST "$BASE_URL/auth/login" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\"}" | json .accessToken
}

# Sends a request: call METHOD PATH TOKEN [BODY]. Sets STATUS and BODY.
call() {
    local response
    response=$(curl -s -w '\n%{http_code}' -X "$1" "$BASE_URL$2" \
        ${3:+-H "Authorization: Bearer $3"} -H 'Content-Type: application/json' ${4:+-d "$4"})
    STATUS=$(tail -n 1 <<< "$response")
    BODY=$(sed '$d' <<< "$response")
}

# Prints one demo step: its description, the expected status and the actual status.
step() {
    local mark='ok'
    [ "$STATUS" = "$2" ] || mark="UNEXPECTED (expected $2)"
    printf '%-68s %s  %s\n' "$1" "$STATUS" "$mark"
}

SAM=$(login sdarnold@seahawks.com)
MIKE=$(login mmacdonald@seahawks.com)
DRAKE=$(login dmaye@patriots.com)

echo "Notes service demo against $BASE_URL"
echo

call POST /notes "$SAM" '{"title":"Game plan","body":"Run the ball","viewAccess":"team","editAccess":"team"}'
step "Sam creates a note his team can see and edit" 201
NOTE=$(json .id <<< "$BODY")

call PATCH "/notes/$NOTE" "$MIKE" '{"body":"Run the ball, then play action","version":1}'
step "Mike (same team) edits it at version 1" 200

call PATCH "/notes/$NOTE" "$SAM" '{"body":"Pass first","version":1}'
step "Sam edits from a stale copy (version 1): rejected, nothing lost" 409

call GET "/notes/$NOTE" "$DRAKE"
step "Drake (other team) cannot see it" 404

call DELETE "/notes/$NOTE" "$MIKE"
step "Mike cannot delete it: only the author can" 403

call PUT "/notes/$NOTE/lock" "$SAM"
step "Sam locks it" 200

call PATCH "/notes/$NOTE" "$MIKE" '{"body":"One more idea","version":2}'
step "Mike cannot edit while it is locked" 409

call PATCH "/notes/$NOTE/attributes" "$SAM" '{"editAccess":"author"}'
step "Sam narrows who can edit, while it is still locked" 200

call PUT "/notes/$NOTE/unlock" "$SAM"
step "Sam unlocks it" 200

call GET "/activity/notes/$NOTE" "$SAM"
step "Sam reads the note's activity" 200
echo "    $(json '.items.map(e => e.action).reverse().join(" -> ")' <<< "$BODY")"

call GET /notes ""
step "A request without a token is refused" 401

echo
echo "Note $NOTE is left in place; inspect it with: make login && make note-get ID=$NOTE"
