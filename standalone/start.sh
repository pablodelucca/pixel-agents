#!/bin/bash
cd "$(dirname "$0")"
node build.js && echo "Build OK" && node dist/server.js
