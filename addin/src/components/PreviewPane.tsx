import React, { useState, useEffect } from 'react';
import { ActionOp } from '../SheetConnector'; // Import ActionOp type

interface PreviewPaneProps {
  ops: ActionOp[];
  onAccept: () => void;
  onReject: () => void;
  isLoading: boolean;
  isApplying?: boolean;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ ops, onAccept, onReject, isLoading, isApplying }) => {
  // Style for primary action buttons (Accept/Reject)
  const actionButtonBase = "flex-1 py-2 px-4 border border-gray-600 rounded-lg cursor-pointer font-semibold text-base"; // flex-1 to share space
  const acceptButtonActive = "bg-black text-white hover:bg-gray-800";
  const rejectButtonActive = "bg-gray-200 text-black hover:bg-gray-300"; // Secondary style for reject
  const actionButtonDisabled = "opacity-50 cursor-not-allowed bg-gray-700 hover:bg-gray-700 text-gray-400";

  // Determine if buttons should be disabled
  const isDisabled = isLoading || isApplying;

  return (
    <div className="p-3 border border-black/50 rounded-lg bg-white/20 backdrop-blur-md shadow-xl flex flex-col flex-grow overflow-hidden">
      {/* Optional: Dimming overlay when applying (accepting) */}
      {isApplying && (
        <div style={styles.overlay}>Accepting Preview...</div>
      )}

      <h4 className="text-lg font-semibold mb-3 text-black">Preview Plan Operations:</h4>

      <ul className="list-none p-0 m-0 mb-4 overflow-y-auto flex-grow border-t border-b border-black/20 divide-y divide-black/10">
        {ops.map((op) => (
          <li key={op.id} className="py-2 px-1">
            <span className="text-sm leading-snug text-black">
              <strong className="font-semibold">{op.id}:</strong> {op.type} on {op.range}
              {op.values && <span className="block ml-3 text-xs text-gray-700"> - Values: {JSON.stringify(op.values).substring(0, 30)}...</span>}
              {op.formula && <span className="block ml-3 text-xs text-gray-700"> - Formula: {op.formula}</span>}
              {op.color && <span className="block ml-3 text-xs text-gray-700"> - Color: {op.color}</span>}
              {op.note && <span className="block ml-3 text-xs text-gray-700"> - Note: {op.note}</span>}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex gap-3 mt-auto">
        <button
          className={`${actionButtonBase} ${rejectButtonActive} ${isDisabled ? actionButtonDisabled : ''}`}
          onClick={onReject}
          disabled={isDisabled}
        >
          Reject Preview
        </button>
        <button
          className={`${actionButtonBase} ${acceptButtonActive} ${isDisabled ? actionButtonDisabled : ''}`}
          onClick={onAccept}
          disabled={isDisabled}
        >
          {isApplying ? 'Accepting...' : 'Accept Preview'}
        </button>
      </div>
    </div>
  );
};

// --- Styles --- (Keep overlay styles)
const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.7)', // Semi-transparent white
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10, // Ensure it's on top
    fontSize: '1.1em',
    color: '#333' // Make text visible
  }
};