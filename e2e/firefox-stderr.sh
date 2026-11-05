#!/bin/sh
# Starts Playwright's Firefox with its standard error appended to a file (see e2e/firefox-logs.ts).
# exec keeps the process id and the protocol pipes Playwright opened.
exec "$E2E_FIREFOX_EXECUTABLE" "$@" 2>>"$E2E_FIREFOX_STDERR"
