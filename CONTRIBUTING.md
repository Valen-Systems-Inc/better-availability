# Contributing

Better Availability is intentionally small and local-first. Contributions should
keep the core behavior easy to inspect and easy to run without a hosted service.

## Development

```sh
npm test
```

## Project Boundaries

Good changes usually improve one of these areas:

- profile JSON portability
- time zone correctness
- effective availability calculation
- overlap query ergonomics
- terminal interface usability
- documentation for local-first team workflows

Avoid adding hosted backend assumptions, account requirements, calendar
integration requirements, or cloud synchronization requirements to the core
tool.

## Time Zone Rules

Profiles should use real IANA time zone identifiers such as
`America/Los_Angeles`, `Europe/London`, or `Asia/Kolkata`. Do not rely on vague
abbreviations such as `PST`, `EST`, or `CST`.
