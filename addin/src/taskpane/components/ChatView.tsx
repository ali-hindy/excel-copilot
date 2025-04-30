import React, { useState, useRef, useEffect } from 'react';
import { ChatService } from '../../services/chatService';

interface ChatMessage {
  role: 'user' | 'assistant';
  message: string;
}

interface ChatViewProps {
  onReady: (slots: any) => void;
  chatService: ChatService;
}

export const ChatView: React.FC<ChatViewProps> = ({ onReady, chatService }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', message: userMessage }]);

    try {
      const response = await chatService.sendMessage(userMessage);
      
      // Add assistant message to chat
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        message: response.assistantMessage 
      }]);

      // If all slots are filled, notify parent
      if (response.ready) {
        onReady(response.slotsFilled);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        message: 'Sorry, I encountered an error. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, index) => (
          <div key={index} className={`message ${msg.role}`}>
            {msg.message}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <div className="input-area">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type your message..."
          disabled={isLoading}
        />
        <button 
          onClick={handleSend} 
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}; 