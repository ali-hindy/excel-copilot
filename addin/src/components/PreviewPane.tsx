import React, { useState, useEffect } from 'react';
import { ActionOp } from '../SheetConnector'; // Import ActionOp type

interface PreviewPaneProps {
  ops: ActionOp[];
  onApply: (approvedOps: ActionOp[]) => void;
  isLoading: boolean;
}

export const PreviewPane: React.FC<PreviewPaneProps> = ({ ops, onApply, isLoading }) => {
  // State to track checked status of each operation by its ID
  const [checkedOps, setCheckedOps] = useState<{ [key: string]: boolean }>({});

  // Initialize checked state when ops list changes (e.g., new plan generated)
  useEffect(() => {
    const initialCheckedState: { [key: string]: boolean } = {};
    ops.forEach(op => {
      initialCheckedState[op.id] = true; // Default all to checked
    });
    setCheckedOps(initialCheckedState);
  }, [ops]);

  const handleCheckboxChange = (opId: string) => {
    setCheckedOps(prev => ({
      ...prev,
      [opId]: !prev[opId]
    }));
  };

  const handleSelectAll = () => {
    const allChecked: { [key: string]: boolean } = {};
    ops.forEach(op => {
      allChecked[op.id] = true;
    });
    setCheckedOps(allChecked);
  };

  const handleDeselectAll = () => {
    const noneChecked: { [key: string]: boolean } = {};
    ops.forEach(op => {
      noneChecked[op.id] = false;
    });
    setCheckedOps(noneChecked);
  };

  const handleApplyClick = () => {
    const approvedOps = ops.filter(op => checkedOps[op.id]);
    onApply(approvedOps);
  };

  const hasSelectedOps = ops.some(op => checkedOps[op.id]);

  // Base classes for apply button
  const applyButtonBase = "mt-auto py-2 px-4 bg-black text-white border border-gray-600 rounded-lg cursor-pointer hover:bg-gray-800 w-full font-semibold text-base";
  const applyButtonDisabled = "opacity-50 cursor-not-allowed bg-gray-700 hover:bg-gray-700";

  // Revert to side-by-side control button styles
  const controlButtonBase = "bg-black text-white border border-gray-600 rounded-lg cursor-pointer hover:bg-gray-800 px-4 py-2 font-semibold text-sm"; // Removed width, flex, justify-center; added padding
  const controlButtonDisabled = "opacity-50 cursor-not-allowed bg-gray-700 hover:bg-gray-700";

  return (
    // Apply glassmorphism container styles + flex layout
    <div className="p-3 border border-black/50 rounded-lg bg-white/20 backdrop-blur-md shadow-xl flex flex-col flex-grow overflow-hidden">
      <h4 className="text-lg font-semibold mb-3 text-black">Generated Plan Operations:</h4>
      {/* Revert controls container to horizontal layout, centered */}
      <div className="mb-3 flex justify-center gap-2">
        <button
          className={`${controlButtonBase} ${isLoading ? controlButtonDisabled : ''}`}
          onClick={handleSelectAll}
          disabled={isLoading}
        >
          Select All
        </button>
        <button
          className={`${controlButtonBase} ${isLoading ? controlButtonDisabled : ''}`}
          onClick={handleDeselectAll}
          disabled={isLoading}
        >
          Deselect All
        </button>
      </div>
      {/* Scrollable list with borders */}
      <ul className="list-none p-0 m-0 mb-4 overflow-y-auto flex-grow border-t border-b border-black/20 divide-y divide-black/10">
        {ops.map((op) => (
          // List item styling
          <li key={op.id} className="flex items-center py-2 px-1">
            <input
              type="checkbox"
              // Update checkbox styling for black appearance
              className="mr-3 flex-shrink-0 h-4 w-4 rounded border-black/50 text-black focus:ring-black disabled:opacity-50 accent-black"
              checked={checkedOps[op.id] || false}
              onChange={() => handleCheckboxChange(op.id)}
              disabled={isLoading}
            />
            {/* Operation details styling */}
            <span className="text-sm leading-snug text-black">
              <strong className="font-semibold">{op.id}:</strong> {op.type} on {op.range}
              {/* Detail styling */}
              {op.values && <span className="block ml-3 text-xs text-gray-700"> - Values: {JSON.stringify(op.values).substring(0, 30)}...</span>}
              {op.formula && <span className="block ml-3 text-xs text-gray-700"> - Formula: {op.formula}</span>}
              {op.color && <span className="block ml-3 text-xs text-gray-700"> - Color: {op.color}</span>}
              {op.note && <span className="block ml-3 text-xs text-gray-700"> - Note: {op.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <button
        // Apply button styling with disabled state
        className={`${applyButtonBase} ${(isLoading || !hasSelectedOps) ? applyButtonDisabled : ''}`}
        onClick={handleApplyClick}
        disabled={isLoading || !hasSelectedOps}
      >
        {isLoading ? 'Applying...' : 'Apply Approved Operations'}
      </button>
    </div>
  );
};