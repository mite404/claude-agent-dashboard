#!/bin/bash

NAME=$1
DESCRIPTION=$2
PRIORITY=${3:-normal}

# POST to server
RESPONSE=$(curl -X POST http://localhost:3001/api/tasks \
  -H "Content-Type: application/json" \
  -d "{\name\":\"$NAME\", \"description\":\"$DESCRIPTION\", \"priority\":\"$PRIORITY\"}")

# Extract task ID from RESPONSE
TASK_ID=$(echo $RESPONS | grep -o '"id:"[^"]*' | cut -d'"' -f4)

# Log it
echo "[post-task] Created task: $TASK_ID" >> logs/hooks.log

# Output to stdout
echo $TASK_ID
