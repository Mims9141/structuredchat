# Middle Debate – Product Spec

**An AI-moderated debate platform designed to keep discussions fair and factual.**

## Vision

The AI acts as a **neutral middleman**:

- **Enforce speaking turns** by muting interruptions so each side gets their allotted time.
- **Live fact-checking** on claims so viewers see corrections and sources in real time.
- **Transparent debate rules** shown to viewers so format, time limits, and moderation are clear.

## Goal

Reduce shouting matches and misinformation by turning debates into **structured, verifiable exchanges** where truth can surface more clearly.

## Core Features (Target)

| Feature | Description |
|--------|--------------|
| **Turn enforcement** | AI/system mutes non-speaking debater; no crosstalk during timed segments. |
| **Live fact-checking** | Claims are checked against sources; results shown to viewers (and optionally to debaters). |
| **Transparent rules** | Visible countdown, segment names, and moderation actions so viewers understand the format. |
| **Structured format** | Fixed segments (e.g. opening, rebuttal, Q&A) with clear handoffs. |
| **Viewer experience** | Stream-style view with chat, Q&A submission, and visible fact-check results. |

## Technical Direction

- **Moderation**: Backend or edge logic to mute/unmute by role and segment; optional AI layer for rule enforcement.
- **Fact-checking**: API integration (e.g. fact-check APIs or LLM-based verification) with results stored and broadcast via Supabase Realtime.
- **Debate state**: Rooms/segments/turns in Supabase (similar to existing chat schema); Realtime for sync to all clients.
- **Middle Debate** can be a separate app or route (e.g. `/middle-debate`) with its own Supabase tables and Realtime channels.

## Relation to OneTwoOne

OneTwoOne = 1:1 balanced conversations (text/video/audio).  
Middle Debate = 1:many structured debates with AI moderation and fact-checking. Same brand family; different product focus.
