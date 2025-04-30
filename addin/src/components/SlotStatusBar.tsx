import React from 'react';

interface SlotStatusBarProps {
  slots: {
    roundType?: string;
    amount?: number;
    preMoney?: number;
    poolPct?: number;
  };
}

export const SlotStatusBar: React.FC<SlotStatusBarProps> = ({ slots }) => {
  const slotsList = [
    { key: 'roundType', label: 'Round Type' },
    { key: 'amount', label: 'Amount' },
    { key: 'preMoney', label: 'Pre-Money' },
    { key: 'poolPct', label: 'Pool %' }
  ];

  return (
    <div className="slot-status-bar">
      {slotsList.map(({ key, label }) => (
        <div key={key} className="slot">
          <div className={`slot-indicator ${slots[key as keyof typeof slots] ? 'filled' : 'empty'}`}>
            {slots[key as keyof typeof slots] ? '●' : '○'}
          </div>
          <div className="slot-label">{label}</div>
        </div>
      ))}

      <style jsx>{`
        .slot-status-bar {
          display: flex;
          gap: 16px;
          padding: 8px;
          background-color: #f5f5f5;
          border-radius: 4px;
          margin-bottom: 16px;
        }
        .slot {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .slot-indicator {
          font-size: 16px;
        }
        .slot-indicator.filled {
          color: #4caf50;
        }
        .slot-indicator.empty {
          color: #9e9e9e;
        }
        .slot-label {
          font-size: 14px;
          color: #333;
        }
      `}</style>
    </div>
  );
}; 