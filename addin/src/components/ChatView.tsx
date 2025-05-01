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

  // useEffect(() => {
  //   setMessages([
  //     {
  //       role: "assistant",
  //       message: 'Hello! How can I help you model your cap table today? (e.g., \"Model Series A\")',
  //     },
  //   ]);
  // }, []);

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
    <div className="flex flex-col flex-grow overflow-hidden font-sans text-base text-[#0D0D0D] h-full">
      <div className="flex flex-col flex-grow overflow-y-auto p-2.5 mb-2.5">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`my-2 py-2.5 px-4 rounded-[15px] max-w-[85%] leading-normal break-words ${
              msg.role === "user" ? "bg-gray-100 ml-auto rounded-[20px]" : "mr-auto"
            }`}
          >
            {msg.message}
          </div>
        ))}
        {messages.length === 0 && (
          <div className="text-center font-bold text-2xl text-gray-700 my-auto flex-grow flex items-center justify-center">
            How can I help?!
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex w-full cursor-text flex-col items-center justify-center border rounded-[18px] overflow-clip shadow-lg">
        <div className="relative flex w-full flex-auto flex-col">
          <input
            className="flex-grow py-3 pr-[45px] pl-[15px] border-none focus:outline-none"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder={isSending ? "Waiting for response..." : "Give a finstruction!"}
            disabled={isSending}
          />
          <button
            className={`absolute right-2.5 top-1/2 transform -translate-y-1/2 p-0 w-8 h-8 bg-black text-white border-none rounded-full cursor-pointer text-xl flex items-center justify-center transition-colors duration-200 ease-in-out ${
              !input.trim() || isSending ? "bg-gray-300 cursor-not-allowed text-gray-500" : "hover:bg-gray-700"
            }`}
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
