import React, { useState, useRef, useEffect } from "react";

export interface ChatMessage {
  role: 'user' | 'assistant';
  message: string;
}

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isThinking: boolean;
  streamingMessage: string;
  onError: (message: string) => void;
  isLoading: boolean;
}

export function ChatView({ 
  messages, 
  onSendMessage, 
  isThinking, 
  streamingMessage,
  onError,
  isLoading 
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [ellipsis, setEllipsis] = useState('.');
  const thinkingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking, streamingMessage]);

  useEffect(() => {
    if (isThinking) {
      thinkingIntervalRef.current = setInterval(() => {
        setEllipsis(prev => {
          if (prev === '...') return '.';
          if (prev === '..') return '...';
          return '..';
        });
      }, 400);
    } else {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
        thinkingIntervalRef.current = null;
      }
      setEllipsis('.');
    }

    return () => {
      if (thinkingIntervalRef.current) {
        clearInterval(thinkingIntervalRef.current);
      }
    };
  }, [isThinking]);

  const handleSend = () => {
    if (inputValue.trim() && !isLoading && !isThinking) {
      onSendMessage(inputValue);
      setInputValue('');
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(event.target.value);
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSend();
    }
  };

  return (
    <div className="flex flex-col flex-grow overflow-hidden font-sans text-base text-[#0D0D0D] h-full">
      <style>{`
        @keyframes pulseOpacity {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in-message {
            animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>

      <div className="flex flex-col flex-grow overflow-y-auto p-2.5 mb-2.5">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`my-2 py-2.5 px-4 rounded-[15px] max-w-[85%] leading-normal break-words ${ 
              msg.role === "user" ? "bg-gray-100 ml-auto rounded-[20px]" : "bg-white mr-auto"
            }`}
          >
            {msg.message}
          </div>
        ))}
        {streamingMessage && (
          <div className="my-2 py-2.5 px-4 rounded-[15px] max-w-[85%] leading-normal break-words mr-auto bg-white fade-in-message">
            {streamingMessage}
          </div>
        )}
        {isThinking && (
          <div 
            className="my-2 py-2.5 px-4 rounded-[15px] max-w-[85%] leading-normal break-words mr-auto fade-in-message" 
            style={styles.thinkingMessage}
          >
            Thinking{ellipsis}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex w-full cursor-text flex-col items-center justify-center border rounded-[18px] overflow-clip shadow-lg">
        <div className="relative flex w-full flex-auto flex-col">
          <input
            className="flex-grow py-3 pr-[45px] pl-[15px] border-none focus:outline-none"
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isLoading || isThinking}
          />
          <button
            className={`absolute right-2.5 top-1/2 transform -translate-y-1/2 p-0 w-8 h-8 bg-black text-white border-none rounded-full cursor-pointer text-xl flex items-center justify-center transition-colors duration-200 ease-in-out ${
              !inputValue.trim() || isLoading || isThinking ? "bg-gray-300 cursor-not-allowed text-gray-500" : "hover:bg-gray-700"
            }`}
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading || isThinking}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  chatViewContainer: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
  },
  messagesContainer: {
    flexGrow: 1,
    padding: '10px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#dcf8c6',
    padding: '8px 12px',
    borderRadius: '10px 10px 0 10px',
    maxWidth: '80%',
    wordWrap: 'break-word'
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    padding: '8px 12px',
    borderRadius: '10px 10px 10px 0',
    maxWidth: '80%',
    wordWrap: 'break-word',
  },
  thinkingMessage: {
    fontStyle: 'italic',
    color: '#777',
    animationName: 'pulseOpacity',
    animationDuration: '1.5s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite'
  },
  inputContainer: {
    display: 'flex',
    padding: '10px',
    borderTop: '1px solid #ccc',
    backgroundColor: '#fff'
  },
  input: {
    flexGrow: 1,
    padding: '10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    marginRight: '10px',
    fontSize: '1em'
  },
  button: {
    padding: '10px 15px',
    backgroundColor: '#0078d4',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1em'
  },
  buttonDisabled: {
    backgroundColor: '#c7e0f4',
    cursor: 'not-allowed'
  },
};
