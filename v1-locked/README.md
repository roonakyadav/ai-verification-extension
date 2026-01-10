# V1 ChatGPT Verification Extension - Read-Only Historical Snapshot

## What is V1?

V1 is the initial stable version of the ChatGPT AI Verification browser extension. It provides a pure DOM-based, heuristic-only verification system for ChatGPT responses.

## Key Features

- **Pure DOM-based detection**: Uses MutationObserver to detect new assistant messages
- **Streaming-aware UI**: Implements DOM stability debounce (~1000ms) to ensure verification starts only after AI response is complete
- **Heuristic-only verification**: Classifies claims using simple rules without external validation
- **Always renders overlay**: UI never hangs and always displays results, even if verification fails
- **SPA navigation support**: Handles ChatGPT's single-page application routing via MutationObserver on main content

## What V1 Deliberately Does NOT Include

❌ **No LLM calls**: No integration with language models like Ollama  
❌ **No backend**: No server-side processing or API endpoints  
❌ **No fetch**: No network requests or HTTP calls  
❌ **No proxy**: No local or remote proxy servers  
❌ **No external dependencies**: Completely self-contained in the browser  

## How V1 Detects Completion

V1 uses a DOM stability debounce mechanism:

1. MutationObserver detects new assistant messages
2. Content observation monitors text changes every 1000ms
3. When text content remains stable for 1000ms, verification begins
4. Each message gets a unique answerId for independent lifecycle management

## Why V1 is Stable

- **No network dependencies**: Cannot fail due to connectivity issues
- **Pure client-side logic**: Reliable DOM manipulation without external state
- **Idempotent processing**: Prevents duplicate overlays via WeakSet tracking
- **Fallback extraction**: Multiple strategies ensure claims are always extracted
- **Error-resistant UI**: Always renders results, never hangs on failures

## Files in This Snapshot

- `content.v1.js`: Core extension logic (immutable)
- `styles.v1.css`: Dark-theme UI styling (immutable)  
- `manifest.v1.json`: Extension manifest (immutable)

## Important Warning

**These files are a read-only historical snapshot of V1.**  
**DO NOT edit, refactor, or modify these files.**  
**DO NOT import from or reference these files.**  
**Treat this directory as immutable.**  

V1 represents the known-working baseline. Any changes should be made to the active files in the root directory, not here.