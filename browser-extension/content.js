// DocMe Highlighter - Content Script

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "showToast") {
        showToast(request.message, request.error);
    }
});

// Create toast notification function
function showToast(message, isError = false) {
    // Remove existing toast if any
    const existing = document.getElementById('docme-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'docme-toast';
    toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isError ? '#ef4444' : '#a3e635'}" stroke-width="2">
        ${isError
            ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
            : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
      </svg>
      <span>${message}</span>
    </div>
  `;

    toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    color: white;
    padding: 14px 20px;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    border: 1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(163, 230, 53, 0.3)'};
    z-index: 999999;
    animation: docmeSlideIn 0.3s ease-out;
  `;

    document.body.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'docmeFadeOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Add save button when text is selected
document.addEventListener('mouseup', (e) => {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    // Remove existing button
    const existing = document.getElementById('docme-save-btn');
    if (existing) existing.remove();

    if (text.length > 5) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        const btn = document.createElement('button');
        btn.id = 'docme-save-btn';
        btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
        <polyline points="17 21 17 13 7 13 7 21"/>
        <polyline points="7 3 7 8 15 8"/>
      </svg>
      <span>Save to DocMe</span>
    `;

        btn.style.cssText = `
      position: fixed;
      left: ${rect.left + rect.width / 2 - 60}px;
      top: ${rect.top - 40 + window.scrollY}px;
      background: linear-gradient(135deg, #a3e635 0%, #22c55e 100%);
      color: #0f172a;
      border: none;
      padding: 8px 14px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 16px rgba(163, 230, 53, 0.4);
      z-index: 999998;
      animation: docmePopIn 0.2s ease-out;
    `;

        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.innerHTML = '<span>Saving...</span>';

            chrome.runtime.sendMessage({
                action: "saveHighlight",
                text: text,
                url: window.location.href
            }, (response) => {
                if (response?.success) {
                    showToast("Saved to DocMe!");
                } else {
                    showToast("Failed to save. Is DocMe running?", true);
                }
                btn.remove();
            });
        });

        document.body.appendChild(btn);

        // Auto-remove after 5 seconds
        setTimeout(() => btn.remove(), 5000);
    }
});

// Hide button when clicking elsewhere
document.addEventListener('mousedown', (e) => {
    if (e.target.id !== 'docme-save-btn') {
        const btn = document.getElementById('docme-save-btn');
        if (btn) btn.remove();
    }
});
