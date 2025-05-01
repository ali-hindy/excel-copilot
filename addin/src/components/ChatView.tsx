import React, { useState, useRef, useEffect } from "react";
import { ChatService, ChatMessage } from "../services/chatService";

interface ChatViewProps {
  chatService: ChatService;
  onReady: (slots: any) => void;
  onError: (message: string) => void;
  isLoading: boolean;
}

export const ChatView: React.FC<ChatViewProps> = ({ chatService, onReady, onError, isLoading }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        message: 'Hello! How can I help you model your cap table today? (e.g., \"Model Series A\")',
      },
    ]);
  }, []);

  useEffect(() => {
    if (messages.length > 1) {
      scrollToBottom();
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", message: userMessage }]);
    setIsSending(true);

    try {
      const response = await chatService.sendMessage(userMessage);
      setMessages((prev) => [...prev, { role: "assistant", message: response.assistantMessage }]);
      if (response.ready) {
        onReady(response.slotsFilled);
      }
    } catch (error: any) {
      console.error("Error in ChatView sending message:", error);
      onError(error.message || "Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div style={chatStyles.chatContainer}>
      <div style={chatStyles.messagesContainer}>
        {messages.map((msg, index) => (
          <div
            key={index}
            style={{
              ...chatStyles.messageBase,
              ...(msg.role === "user" ? chatStyles.messageUser : chatStyles.messageAssistant),
            }}
          >
            {msg.message}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex w-full cursor-text flex-col items-center justify-center border rounded-[18px] overflow-clip shadow-lg">
        <div className="relative flex w-full flex-auto flex-col">
          <input
            style={chatStyles.inputField}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder={isSending ? "Waiting for response..." : "How can I help you today?"}
            disabled={isSending}
          />
          <button
            style={
              !input.trim() || isSending
                ? { ...chatStyles.button, ...chatStyles.buttonDisabled }
                : chatStyles.button
            }
            onClick={handleSend}
            disabled={!input.trim() || isSending}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
};

const chatStyles: { [key: string]: React.CSSProperties } = {
  chatContainer: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    overflow: "hidden",
    fontFamily: "ui-sans-serif",
    fontSize: "16px",
    color: "#0D0D0D",
  },
  messagesContainer: {
    flexGrow: 1,
    overflowY: "auto",
    padding: "10px",
    marginBottom: "10px",
    borderRadius: "4px",
  },
  messageBase: {
    margin: "8px 0",
    padding: "10px 15px",
    borderRadius: "15px",
    maxWidth: "85%",
    lineHeight: "1.4",
    wordWrap: "break-word",
  },
  messageUser: {
    backgroundColor: "#F4F4F4",
    marginLeft: "auto",
    borderRadius: "20px",
  },
  messageAssistant: {
    marginRight: "auto",
  },
  inputField: {
    flexGrow: 1,
    padding: "12px 45px 12px 15px",
  },
  button: {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(calc(-50% + 1px))",
    padding: "0",
    width: "32px",
    height: "32px",
    backgroundColor: "#000",
    color: "white",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: "1.2em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.2s ease",
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed",
    color: "#777",
  },
};
