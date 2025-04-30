import React, { useState, useRef, useEffect } from 'react';
import { ChatService, ChatMessage } from '../services/chatService';

interface ChatViewProps {
  chatService: ChatService;
  onReady: (slots: any) => void;
  onError: (message: string) => void;
  isLoading: boolean;
}

export const ChatView: React.FC<ChatViewProps> = ({ chatService, onReady, onError, isLoading }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    setMessages([{ role: 'assistant', message: 'Hello! How can I help you model your cap table today? (e.g., \"Model Series A\")' }]);
  }, []);

  useEffect(() => {
    if (messages.length > 1) {
        scrollToBottom();
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isSending) return;
    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', message: userMessage }]);
    setIsSending(true);

    try {
      const response = await chatService.sendMessage(userMessage);
      setMessages(prev => [...prev, { role: 'assistant', message: response.assistantMessage }]);
      if (response.ready) {
        onReady(response.slotsFilled);
      }
    } catch (error: any) {
      console.error('Error in ChatView sending message:', error);
      onError(error.message || 'Failed to send message.');
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
              ...(msg.role === 'user' ? chatStyles.messageUser : chatStyles.messageAssistant)
            }}
          >
            {msg.message}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      <div style={chatStyles.inputArea}>
        <input
          style={chatStyles.inputField}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder={isSending ? "Waiting for response..." : "Type your message..."}
          disabled={isSending}
        />
        <button 
          style={!input.trim() || isSending ? {...chatStyles.button, ...chatStyles.buttonDisabled} : chatStyles.button}
          onClick={handleSend} 
          disabled={!input.trim() || isSending}
        >
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
};

const chatStyles: { [key: string]: React.CSSProperties } = {
  chatContainer: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden'
  },
  messagesContainer: {
    flexGrow: 1,
    overflowY: 'auto',
    padding: '10px',
    marginBottom: '10px',
    border: '1px solid #eee',
    borderRadius: '4px'
  },
  messageBase: {
    margin: '8px 0',
    padding: '10px 15px',
    borderRadius: '15px',
    maxWidth: '85%',
    lineHeight: '1.4',
    wordWrap: 'break-word'
  },
  messageUser: {
    backgroundColor: '#e1f5fe',
    marginLeft: 'auto',
    borderBottomRightRadius: '5px'
  },
  messageAssistant: {
    backgroundColor: '#f1f1f1',
    marginRight: 'auto',
    borderBottomLeftRadius: '5px'
  },
  inputArea: {
    display: 'flex',
    gap: '8px',
    paddingTop: '10px',
    borderTop: '1px solid #eee'
  },
  inputField: {
    flexGrow: 1,
    padding: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '1em'
  },
  button: {
    padding: '8px 16px',
    backgroundColor: '#0078d4',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em'
  },
  buttonDisabled: {
    backgroundColor: '#a0c7e4',
    cursor: 'not-allowed'
  }
}; 