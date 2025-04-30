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

  constructor(baseUrl: string = 'https://bbaf-171-66-12-34.ngrok-free.app') {
    this.baseUrl = baseUrl;
  }

  async sendMessage(message: string): Promise<ChatResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 seconds timeout

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

  async generatePlan(slots: any, sheetData: string[][]): Promise<any> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    try {
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
        }),
        signal: controller.signal, // Add AbortSignal
      });

      clearTimeout(timeoutId); // Clear timeout if fetch completes

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error generating plan:', error);
      throw error;
    }
  }
} 