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

  return (
    <div style={previewStyles.paneContainer}>
      <h4 style={previewStyles.header}>Generated Plan Operations:</h4>
      <div style={previewStyles.controls}>
        <button style={isLoading ? {...previewStyles.controlButton, ...previewStyles.buttonDisabled} : previewStyles.controlButton} onClick={handleSelectAll} disabled={isLoading}>Select All</button>
        <button style={isLoading ? {...previewStyles.controlButton, ...previewStyles.buttonDisabled} : previewStyles.controlButton} onClick={handleDeselectAll} disabled={isLoading}>Deselect All</button>
      </div>
      <ul style={previewStyles.opList}>
        {ops.map((op) => (
          <li key={op.id} style={previewStyles.opItem}>
            <input 
              type="checkbox" 
              style={previewStyles.checkbox}
              checked={checkedOps[op.id] || false} 
              onChange={() => handleCheckboxChange(op.id)}
              disabled={isLoading}
            />
            <span style={previewStyles.opDetails}>
              <strong style={{fontWeight: 600}}>{op.id}:</strong> {op.type} on {op.range} 
              {op.values && <span style={previewStyles.detail}> - Values: {JSON.stringify(op.values).substring(0, 30)}...</span>}
              {op.formula && <span style={previewStyles.detail}> - Formula: {op.formula}</span>}
              {op.color && <span style={previewStyles.detail}> - Color: {op.color}</span>}
              {op.note && <span style={previewStyles.detail}> - Note: {op.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <button 
        style={isLoading || !hasSelectedOps ? {...previewStyles.applyButton, ...previewStyles.buttonDisabled} : previewStyles.applyButton} 
        onClick={handleApplyClick} 
        disabled={isLoading || !hasSelectedOps}
      >
        {isLoading ? 'Applying...' : 'Apply Approved Operations'}
      </button>
    </div>
  );
};

// Inline styles for PreviewPane
const previewStyles: { [key: string]: React.CSSProperties } = {
  paneContainer: {
    border: '1px solid #eee',
    borderRadius: '4px',
    padding: '15px',
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden' // Prevent container scroll, list scrolls
  },
  header: {
      marginTop: 0,
      marginBottom: '10px',
      fontSize: '1.1em',
      fontWeight: 600 // Slightly bolder header
  },
  controls: {
    marginBottom: '10px',
    display: 'flex',
    gap: '10px',
  },
  controlButton: {
      padding: '5px 10px',
      fontSize: '0.9em',
      backgroundColor: '#f0f0f0',
      border: '1px solid #ccc',
      borderRadius: '3px',
      cursor: 'pointer'
  },
  opList: {
    listStyle: 'none',
    padding: '0',
    margin: '0 0 15px 0',
    overflowY: 'auto',
    flexGrow: 1,
    borderTop: '1px solid #eee',
    borderBottom: '1px solid #eee'
  },
  opItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 5px',
    borderBottom: '1px solid #f5f5f5',
  },
  checkbox: {
    marginRight: '10px',
    flexShrink: 0 // Prevent checkbox from shrinking
  },
  opDetails: {
    fontSize: '0.95em',
    lineHeight: '1.3'
  },
  detail: {
      display: 'block', // Put extra details on new lines
      marginLeft: '10px',
      fontSize: '0.9em',
      color: '#555'
  },
  applyButton: {
    marginTop: 'auto', // Push to bottom if list is short
    padding: '10px 16px',
    backgroundColor: '#107c10', // Office green
    color: 'white',
    border: 'none',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '1em',
    fontWeight: 600
  },
  buttonDisabled: {
    cursor: 'not-allowed',
    opacity: 0.6,
    backgroundColor: '#ccc' // Generic disabled background
  }
}; 