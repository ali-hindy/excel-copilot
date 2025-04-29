/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global console, document, Excel, Office */

import { readSheet } from "../SheetConnector";
// import { applyOps, ActionOp } from "../SheetConnector"; // Uncomment when needed

// Placeholder type if needed elsewhere, though run() won't use it now
// interface ActionOp { id: string; range: string; type: string; values?: any[][]; formula?: string; note?: string; }

Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    // Hide the initial message
    const sideLoadMsg = document.getElementById("sideload-msg");
    if (sideLoadMsg) sideLoadMsg.style.display = "none";

    // Show the main app body by removing the inline display:none
    const appBody = document.getElementById("app-body");
    if (appBody) appBody.style.display = ""; // Let CSS handle display (block, flex, etc.)

    const runButton = document.getElementById("run");
    if (runButton) {
        runButton.onclick = run;
    }
    // Add click listener for the Apply button
    // const applyButton = document.getElementById("apply-ops");
    // if (applyButton) { // Keep disabled
    //     applyButton.onclick = handleApplyOps;
    // }
  }
});

// Store the latest received ops from the server
let currentOps: any[] = []; // Use any type since ActionOp is not imported

// Get references to UI elements (assuming they exist in the DOM)
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const previewPane = document.getElementById("preview-pane");
const previewOpsList = document.getElementById("preview-ops-list");
const applyOpsButton = document.getElementById("apply-ops");
const errorMessageDiv = document.getElementById("error-message");

async function run() {
    // --- Restoring Fetch & Render Logic ---
    console.log("Taskpane: Run button clicked");

    // Clear previous errors and hide preview
    if (errorMessageDiv) errorMessageDiv.style.display = "none";
    if (previewPane) previewPane.style.display = "none";
    if (previewOpsList) previewOpsList.innerHTML = ''; // Clear previous ops
    if (applyOpsButton) applyOpsButton.style.display = "none"; // Keep apply hidden
    currentOps = []; // Clear previous ops

    const promptText = promptInput?.value || '';
    if (!promptText.trim()) {
        if (errorMessageDiv) {
            errorMessageDiv.innerText = "Please enter a prompt.";
            errorMessageDiv.style.display = "block";
        }
        return;
    }

    // Show loading state in preview pane
    if (previewPane) previewPane.style.display = "block";
    if (previewOpsList) previewOpsList.innerHTML = '<li class="ms-ListItem">Sending prompt to server... (using placeholder sheet data)</li>';

    try {
        // PHASE 2: Read the actual sheet data
        if (previewOpsList) previewOpsList.innerHTML = '<li class="ms-ListItem">Reading sheet data...</li>';
        let sheetData: string[][];
        try {
            sheetData = (await readSheet()).map(row => row.map(cell => String(cell)));
            console.log("Taskpane: Read sheet data (all stringified):", sheetData);
        } catch (readErr) {
            console.error("Error reading sheet:", readErr);
            if (errorMessageDiv) {
                errorMessageDiv.innerText = `Error reading sheet: ${readErr.message || readErr}`;
                errorMessageDiv.style.display = "block";
            }
            return;
        }
        const requestBody = {
            prompt: promptText,
            sheet: sheetData // Use actual sheet data
        };
        console.log(`Taskpane: Preparing to fetch from https://efa332809648.ngrok.app/plan with body:`, requestBody);

        // Phase 3/4: Call Local LLM Server
        const response = await fetch("https://efa332809648.ngrok.app/plan", {
            method: "POST",
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        console.log(`Taskpane: Fetch response received. Status: ${response.status}`);

        if (!response.ok) {
            let errorBody = "Server returned an error.";
            try {
                 console.log("Taskpane: Fetch response not OK. Trying to read error body...");
                const errorJson = await response.json();
                 console.log("Taskpane: Server error body JSON:", errorJson);
                errorBody = errorJson.detail || JSON.stringify(errorJson);
            } catch (e) {
                 console.log("Taskpane: Could not read server error body as JSON.");
                 /* Ignore */
            }
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorBody}`);
        }

        console.log("Taskpane: Fetch response OK. Reading response JSON...");
        const result = await response.json();
        console.log("Taskpane: Received plan JSON from server:", result);

        // Store and Render Ops
        currentOps = result.ops || []; // Use any[] type
        console.log("Taskpane: Stored ops. Preparing to render...");

        // Phase 5: Render Preview Pane
        if (previewOpsList) {
            previewOpsList.innerHTML = ''; // Clear loading message
            if (currentOps.length > 0) {
                currentOps.forEach((op: any) => { // Use op: any
                    const listItem = document.createElement('li');
                    listItem.className = 'ms-ListItem';
                    // TODO P6: Add checkboxes for selection (when ActionOp type is back)
                    const opDescription = op.values
                        ? `values: ${JSON.stringify(op.values).substring(0, 50)}...`
                        : `formula: ${op.formula}`;
                    listItem.innerHTML = `
                        <span class="ms-font-m"><b>(${op.id}) ${op.type?.toUpperCase()} ${op.range}</b></span><br/>
                        <span class="ms-font-s">${opDescription || ''}</span>
                        ${op.note ? `<br/><span class="ms-font-s"><i>Note: ${op.note}</i></span>` : ''}
                    `;
                    previewOpsList.appendChild(listItem);
                });
                // Keep apply button hidden as listener is disabled
                // if (applyOpsButton) applyOpsButton.style.display = "block";
            } else {
                previewOpsList.innerHTML = '<li class="ms-ListItem">No operations suggested.</li>';
            }
             console.log("Taskpane: Rendering complete.");
        }

    } catch (error) {
        console.error("--- Taskpane: Error caught in run() --- ");
        console.error("Error Name:", error.name)
        console.error("Error Message:", error.message)
        console.error("Full Error Object:", error);
        if (errorMessageDiv) {
            errorMessageDiv.innerText = `Error: ${error.message || error}`;
            errorMessageDiv.style.color = "red";
            errorMessageDiv.style.display = "block";
            errorMessageDiv.style.whiteSpace = "pre-wrap";
            errorMessageDiv.style.border = "none";
            errorMessageDiv.style.padding = "0";
            errorMessageDiv.style.marginTop = "10px";
        }
        // Hide loading/preview state on error
        if (previewOpsList) previewOpsList.innerHTML = '';
        if (previewPane) previewPane.style.display = "none";
    }
    // --- End Restored Logic ---
}

// --- handleApplyOps function commented out as it depends on import ---
/*
async function handleApplyOps() {
    // ... (implementation depends on applyOps and currentOps)
}
*/
