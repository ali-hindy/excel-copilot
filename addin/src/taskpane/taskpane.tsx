/*
 * Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/* global console, document, Excel, Office, React, ReactDOM */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App'; // Import the main App component

Office.onReady((info) => {
  if (info.host === Office.HostType.Excel) {
    document.getElementById("sideload-msg")!.style.display = "none";
    document.getElementById("app-body")!.style.display = "flex";
    
    // Remove initialization logic if handled within App.tsx
    const appContainer = document.getElementById('app-body')!;
    // const initialSlots = { ... };
    // const sheetConnector = new SheetConnector();
    // const chatService = new ChatService();
    // const handleSlotsReady = async (filledSlots: any) => { ... };

    // Remove local App definition
    /*
    const App: React.FC = () => (
      <div className="app">
        <SlotStatusBar slots={initialSlots} />
        <ChatView onReady={handleSlotsReady} chatService={chatService} />
      </div>
    );
    */

    // Create root and render the imported App
    const root = createRoot(appContainer);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
});
