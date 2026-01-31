// DocMe Highlighter - Background Script

const DOCME_API = "http://localhost:8000";

// Create context menu item
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "save-to-docme",
        title: "Save to DocMe Notes",
        contexts: ["selection"]
    });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "save-to-docme" && info.selectionText) {
        try {
            // First, get the latest event to attach the note to
            const eventsRes = await fetch(`${DOCME_API}/events?date=${new Date().toISOString().split('T')[0]}&limit=1`);
            const events = await eventsRes.json();

            if (events && events.length > 0) {
                const eventId = events[0].id;
                const noteText = `[Highlighted] ${info.selectionText}`;

                // Save as note
                const res = await fetch(`${DOCME_API}/events/${eventId}/note`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ note: noteText })
                });

                if (res.ok) {
                    // Send message to content script to show toast
                    chrome.tabs.sendMessage(tab.id, {
                        action: "showToast",
                        message: "Saved to DocMe!"
                    });
                }
            }
        } catch (err) {
            console.error("DocMe save failed:", err);
            chrome.tabs.sendMessage(tab.id, {
                action: "showToast",
                message: "Failed to save. Is DocMe running?",
                error: true
            });
        }
    }
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "saveHighlight") {
        saveHighlightToDocMe(request.text, request.url)
            .then(result => sendResponse(result))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // Keep channel open for async response
    }
});

async function saveHighlightToDocMe(text, url) {
    try {
        const eventsRes = await fetch(`${DOCME_API}/events?date=${new Date().toISOString().split('T')[0]}&limit=1`);
        const events = await eventsRes.json();

        if (!events || events.length === 0) {
            return { success: false, error: "No events found" };
        }

        const eventId = events[0].id;
        const noteText = `[Browser Highlight] "${text}" - ${url}`;

        const res = await fetch(`${DOCME_API}/events/${eventId}/note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ note: noteText })
        });

        return { success: res.ok };
    } catch (err) {
        return { success: false, error: err.message };
    }
}
