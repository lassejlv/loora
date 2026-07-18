# Authentication Dialog Design

## Goal

Replace the standalone authentication card with a modal dialog that opens whenever no Better Auth session exists. The dialog provides separate Login and Sign up tabs while preserving the current email/password authentication behavior.

## Behavior

- The signed-out route renders the existing canvas-colored background with the authentication dialog open.
- The dialog cannot be dismissed with a close button, Escape, or the backdrop. It remains open until authentication succeeds.
- The default tab is Login.
- Switching tabs clears any previous authentication error.
- Login asks for email and password.
- Sign up asks for name, email, and password.
- Both tabs use the existing Better Auth client methods and show pending and error states inline.
- The editor is not mounted until a valid session exists, so signed-out users do not initialize local documents or model integrations.

## Components

`src/components/auth-screen.tsx` remains the authentication boundary and is converted to use the existing `Dialog` and `Tabs` primitives. The component keeps one shared form and derives its fields, labels, and submit behavior from the active tab.

`src/routes/index.tsx` keeps its existing session gate. No authentication state or form logic moves into the editor route.

## Error Handling

Better Auth errors remain visible inside the active tab. Submission is disabled while a request is pending. Changing tabs clears stale errors but retains ordinary field values so accidental tab changes do not discard input.

## Validation

- Run `bunx tsc --noEmit`.
- Run `bun run build`.
- Confirm the dialog has no close affordance and uses Login and Sign up tabs.
- Confirm the existing authenticated editor path remains unchanged.
