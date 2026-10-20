# Glossary

## Track
A single music item on Spotify, identified by its Spotify track ID.

## Liked Songs
Spotify collection of liked tracks for the signed-in user. The v1 save destination.

## Eligible listen
A listen that sounded at least 90 percent of the track duration with at least 60 seconds sounded, counted once per track ID. Pauses are excluded and seeks do not inflate credit.

## Already-saved
A track that is already in Liked Songs when eligibility is reached. The extension skips the write and logs it.

## Activity log
Local record of auto-saves, skips, undos, and failures kept by the extension.
