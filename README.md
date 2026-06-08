# Better Availability

Better Availability is a local-first, open-source team availability mapper for
distributed teams working across multiple time zones.

It answers one practical question:

```text
When are people actually available?
```

It is not a calendar replacement, meeting scheduler, invitation system, SaaS
backend, or account-based sync product. Each person owns a portable JSON
availability profile. Teammates exchange those profiles however they already
communicate, then import them into a local team availability directory.

## Core Idea

Each installation maintains a local directory of imported teammate profiles.

People can:

- create availability
- update availability
- block availability
- add availability
- export availability
- import teammate availability
- query overlap windows

The system works without servers, accounts, cloud synchronization, calendar
integrations, or centralized infrastructure.

## Availability Model

Availability is composed as:

```text
Base Availability
+ Added Availability
- Blocked Availability
= Effective Availability
```

A person can define any number of availability windows for a day. The model
does not assume one continuous work schedule.

Example:

```text
Monday
09:00 - 11:00
13:00 - 16:00
19:00 - 21:00
```

Temporary changes live alongside base availability:

```text
Base Availability
Mon-Fri
11:00 - 15:00
15:00 - 21:00

Overrides
2026-06-10
13:00 - 15:00 blocked

2026-06-12
18:00 - 20:00 available
```

All overlap calculations use effective availability.

## Time Zones

Profiles use real IANA time zone identifiers such as:

```text
America/Los_Angeles
America/New_York
Europe/London
Asia/Kolkata
```

The project intentionally avoids vague abbreviations such as `PST`, `EST`, and
`CST`. Offset calculations are made for the actual date being evaluated, so
daylight saving changes are handled by the runtime's time zone database.

## Install Locally

```sh
npm install -g better-availability
```

During local development:

```sh
git clone git@github.com:Valen-Systems-Inc/better-availability.git
cd better-availability
npm link
better-availability help
```

## Quick Start

Create a local profile:

```sh
better-availability init --name "William" --timezone America/Los_Angeles
```

Add base availability:

```sh
better-availability add-base --day monday --start 09:00 --end 11:00
better-availability add-base --day monday --start 13:00 --end 16:00
```

Export your profile:

```sh
better-availability export ./william.availability.json
```

Import a teammate profile:

```sh
better-availability import ./kelton.availability.json
```

Find overlap windows:

```sh
better-availability overlap --date 2026-06-09 --people william,kelton --duration 30
```

Open the terminal user interface:

```sh
better-availability
```

The TUI supports arrow keys, `j`/`k`, Enter, Escape, and `q`. From the TUI you
can view teammates, create your profile, import teammate JSON, export your JSON,
add or block availability, and query overlap windows.

## Local Directory

By default, Better Availability stores local data in:

```text
~/.better-availability/
```

You can override this with:

```sh
BETTER_AVAILABILITY_HOME=/path/to/team-dir better-availability teammates
```

The local directory contains:

```text
profiles/
  me.json
  teammates/
    kelton.json
    frontend-dev.json
```

## JSON Profile Format

```json
{
  "schemaVersion": 1,
  "id": "william",
  "name": "William",
  "role": "Founder",
  "tags": ["leadership", "product"],
  "timeZone": "America/Los_Angeles",
  "baseAvailability": [
    { "day": "monday", "start": "09:00", "end": "11:00" },
    { "day": "monday", "start": "13:00", "end": "16:00" }
  ],
  "addedAvailability": [
    { "date": "2026-06-12", "start": "18:00", "end": "20:00" }
  ],
  "blockedAvailability": [
    { "date": "2026-06-10", "start": "13:00", "end": "15:00" }
  ]
}
```

## Development

```sh
npm test
```

The first version keeps the core model dependency-free. That makes the overlap
math easy to inspect, test, and later wrap with a richer terminal interface.
