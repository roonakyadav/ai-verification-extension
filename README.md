# ChatGPT AI Verification Extension

A Chrome extension that adds verification panels to ChatGPT responses to help users evaluate the reliability of AI-generated content.

## Features

- Automatically detects ChatGPT answers on the page
- Injects a dark-themed verification panel below each answer
- Shows verification status with loading indicator
- Displays mock verification results after processing
- Clean, unobtrusive UI that matches ChatGPT's dark theme

## How It Works

1. **Detection**: Uses a MutationObserver to monitor the DOM for new ChatGPT answers as they're loaded
2. **Unique Identification**: Generates a unique ID for each answer to ensure each gets its own verification panel
3. **Injection**: Inserts a verification container directly below each detected answer
4. **Verification Process**: 
   - Initially shows "⏳ Verifying AI output..." status
   - After 1200ms, displays mock verification results:
     - ⚠ 1 potential issue detected
     - ✔ 3 verified statements
     - "View details" button (currently non-functional)
5. **Prevention of Duplicates**: Tracks processed answers to prevent multiple verification panels per answer

## Technical Details

- **Manifest Version**: 3 (Chrome's latest extension format)
- **Architecture**: Content script only (no background script in V0)
- **Styling**: Dark theme designed to match ChatGPT's UI
- **DOM Monitoring**: Uses MutationObserver for efficient detection of new content
- **JavaScript**: Vanilla JS without external dependencies

## Files

- `manifest.json`: Extension configuration and permissions
- `content.js`: Core logic for detecting answers and injecting verification panels
- `styles.css`: Styling for the verification panel UI
- `README.md`: Documentation

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. Visit chat.openai.com to see the verification panels in action

## Limitations (V0)

- Mock verification only (no actual AI verification logic)
- May need selector adjustments if ChatGPT updates their DOM structure
- No persistent storage of verification results
- "View details" button is non-functional in this version

## Future Enhancements

- Real AI verification logic
- Detailed verification reports
- User settings and preferences
- Verification history and statistics