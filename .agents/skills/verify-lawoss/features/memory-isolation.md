# Matter memory and client isolation

Matter memory survives a new conversation and restart while client context remains separate.

## Sub-features

- `memory`: save a unique synthetic fact, read its stored record, then use it in a new conversation.
- `client-isolation`: distinct client roots, documents, linked folders and memory remain separated.

## How to get to it (user POV)

Open a matter's memory and conversation views. Switch between three synthetic clients through the normal sidebar and practice overview.

## Driving it with native alpha runner

Preconditions: three selected synthetic clients with distinct marker facts and an explicit test provider when inference is exercised.

- Save a unique fact in client A's matter memory, inspect its actual file bytes and open a new conversation. Verify that fact is available there.
- Switch to B and C. Verify titles, source roots, memory and linked-folder permissions refer only to the active client.
- Request a read from another client's root and verify the configured boundary refuses it. Capture the attempted action and result without weakening permissions.
- Let the runner restart, then recheck the same stored facts and active client.

## Gotchas

Expected dataset answers prove no runtime behavior. A direct write to a memory file is useful side-effect inspection but does not replace testing the user's save action.
