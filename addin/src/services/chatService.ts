import { SheetConnector, RangeFormatting } from "../SheetConnector";

export interface ChatMessage {
  role: 'user' | 'assistant';
  message: string;
}

export interface ChatResponse {
  assistantMessage: string;
  slotsFilled: {
    roundType?: string;
    amount?: number;
    preMoney?: number;
    poolPct?: number;
  };
  ready?: boolean;
}

export class ChatService {
  private sessionId: string | null = null;
  private baseUrl: string;

  constructor(baseUrl: string = 'https://efa332809648.ngrok.app') {
    this.baseUrl = baseUrl;
  }

  async sendMessage(message: string): Promise<ChatResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          message,
        }),
        signal: controller.signal, // Add AbortSignal
      });

      clearTimeout(timeoutId); // Clear timeout if fetch completes

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Store sessionId if this is the first message
      if (!this.sessionId && data.sessionId) {
        this.sessionId = data.sessionId;
      }

      return data;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  async generatePlan(
      slots: any,
      sheetData: string[][],
      selectedRangeAddress: string | null,
      sheetConnector: SheetConnector
   ): Promise<{ status: string; task_id: string; rangeFormatting: RangeFormatting }> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }
    if (!selectedRangeAddress) {
      throw new Error('Cannot generate plan without a selected range address.');
    }

    try {
      // --- Get Formatting BEFORE starting backend task ---
      console.log("ChatService: Getting selected range formatting...");
      const rangeFormatting = await sheetConnector.getSelectedRangeFormatting();
      console.log("ChatService: Formatting captured:", rangeFormatting);
      // --------------------------------------------------


      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

      const response = await fetch(`${this.baseUrl}/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          slots: slots,
          sheetData: sheetData,
          selectedRangeAddress: selectedRangeAddress
        }),
        signal: controller.signal, // Add AbortSignal
      });

      clearTimeout(timeoutId); // Clear timeout if fetch completes

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const backendResponse = await response.json();

      // --- Return task ID AND formatting ---
      return {
          ...backendResponse, // Should contain { status, task_id }
          rangeFormatting: rangeFormatting
      };
      // -------------------------------------

    } catch (error) {
      console.error('Error generating plan:', error);
      throw error;
    }
  }

  // New method to poll for results
  async getPlanResult(taskId: string): Promise<any> {
    console.log(`Polling for task result: ${taskId}`);
    try {
      const response = await fetch(`${this.baseUrl}/plan/result/${taskId}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
      });

      if (!response.ok) {
        // Handle 404 specifically if needed, otherwise generic error
        if (response.status === 404) {
          console.error(`Task ID ${taskId} not found.`);
          throw new Error(`Task ID ${taskId} not found.`);
        } else {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      }
      // Log raw text before parsing
      const responseText = await response.text();
      console.log(`Raw response text for task ${taskId}:`, responseText);
      // Now parse the text
      return JSON.parse(responseText);
    } catch (error) {
      console.error(`Error polling task ${taskId}:`, error);
      throw error;
    }
  }
}