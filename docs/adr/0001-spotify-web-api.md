# 0001 Use Spotify Web API for saves

Date: 2026-10-21
Status: accepted

## Context
Round 1 Q2 offered a DOM Like-click with no setup versus the Spotify Web API with app setup and token handling.

## Decision
Use the Spotify Web API as the v1 save mechanism. The extension reads library state and adds eligible tracks to Liked Songs through the API.

## Alternatives
DOM Like-click from a content script using the existing Brave login. Zero setup, but brittle against player markup changes and weak duplicate checks.

## Consequences
Requires a Spotify developer app, user OAuth consent, local token storage and refresh, and the user-library scopes. Gains reliable reads of like state and idempotent writes.
