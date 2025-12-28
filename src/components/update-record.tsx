import React, { useState, useEffect } from 'react';
import { useWidgetProps } from '../hooks';
import '../styles/index.css';

interface UpdateRecordProps extends Record<string, unknown> {
  baseId?: string;
  tableId?: string;
  recordId?: string;
  record?: any;
}

// Color palette for choice/select fields (Airtable-style)
const CHOICE_COLORS = [
  'bg-blue-100 dark:bg-blue-900/30 text-gray-900 dark:text-gray-100',
  'bg-teal-100 dark:bg-teal-900/30 text-gray-900 dark:text-gray-100',
  'bg-cyan-100 dark:bg-cyan-900/30 text-gray-900 dark:text-gray-100',
  'bg-purple-100 dark:bg-purple-900/30 text-gray-900 dark:text-gray-100',
  'bg-pink-100 dark:bg-pink-900/30 text-gray-900 dark:text-gray-100',
  'bg-orange-100 dark:bg-orange-900/30 text-gray-900 dark:text-gray-100',
];

const UpdateRecord: React.FC<UpdateRecordProps> = () => {
  const props = useWidgetProps<UpdateRecordProps>({
    baseId: '',
    tableId: '',
    recordId: '',
    record: null,
  });

  const { baseId, tableId, recordId, record } = props;
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [localRecord, setLocalRecord] = useState(record);

  // Update local record when props change
  useEffect(() => {
    setLocalRecord(record);
  }, [record]);

  // Get color for choice field based on hash
  const getChoiceColor = (value: string): string => {
    const hash = value.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return CHOICE_COLORS[hash % CHOICE_COLORS.length];
  };

  // Handle cell click to start editing
  const handleCellClick = (fieldName: string, currentValue: any) => {
    // Don't allow editing arrays or objects
    if (Array.isArray(currentValue) || (typeof currentValue === 'object' && currentValue !== null)) {
      return;
    }
    
    setEditingCell(fieldName);
    setEditValue(currentValue != null ? String(currentValue) : '');
  };

  // Handle save (blur or enter)
  const handleSave = async (fieldName: string) => {
    if (!editingCell || !localRecord) return;

    const oldValue = localRecord.fields[fieldName];
    const newValue = editValue;

    // Only update if value changed
    if (String(oldValue) !== newValue) {
      // Update local state immediately for responsiveness
      const updatedRecord = {
        ...localRecord,
        fields: {
          ...localRecord.fields,
          [fieldName]: newValue,
        },
      };
      setLocalRecord(updatedRecord);

      // Call the update_record tool
      try {
        if (typeof window !== 'undefined' && window.openai?.callTool && baseId && tableId && recordId) {
          await window.openai.callTool('update_record', {
            baseId,
            tableId,
            recordId,
            fields: {
              [fieldName]: newValue,
            },
          });
        }
      } catch (error) {
        console.error('Failed to update record:', error);
        // Revert on error
        setLocalRecord(record);
      }
    }

    setEditingCell(null);
    setEditValue('');
  };

  // Handle key press in input
  const handleKeyDown = (e: React.KeyboardEvent, fieldName: string) => {
    if (e.key === 'Enter') {
      handleSave(fieldName);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
    }
  };

  // Render cell value with appropriate styling
  const renderCellValue = (value: any, fieldName: string) => {
    const isEditing = editingCell === fieldName;

    // If editing this cell, show input
    if (isEditing) {
      return (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => handleSave(fieldName)}
          onKeyDown={(e) => handleKeyDown(e, fieldName)}
          autoFocus
          className="w-full bg-transparent border-none outline-none focus:ring-0 text-sm text-gray-900 dark:text-gray-100 px-0"
        />
      );
    }

    // Handle arrays (choice fields, linked records) - not editable
    if (Array.isArray(value)) {
      if (value.length === 0) return <span className="text-gray-400 dark:text-gray-500">—</span>;
      
      const isChoice = typeof value[0] === 'string';
      
      return (
        <div className="flex items-center gap-1 flex-wrap">
          {value.slice(0, 3).map((item: any, idx: number) => {
            const displayValue = typeof item === 'object' ? item.name || item.id : String(item);
            return (
              <span
                key={idx}
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-normal truncate max-w-[120px] ${
                  isChoice ? getChoiceColor(displayValue) : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
                title={displayValue}
              >
                {displayValue}
              </span>
            );
          })}
          {value.length > 3 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">+{value.length - 3}</span>
          )}
        </div>
      );
    }

    // Handle objects - not editable
    if (typeof value === 'object' && value !== null) {
      return <span className="text-gray-400 dark:text-gray-500 text-xs">[Object]</span>;
    }

    // Handle empty values
    if (value === null || value === undefined || value === '') {
      return <span className="text-gray-400 dark:text-gray-500">—</span>;
    }

    // Handle regular values - editable
    const stringValue = String(value);
    return (
      <div className="truncate cursor-text" title={stringValue}>
        {stringValue.substring(0, 100)}
      </div>
    );
  };

  if (!localRecord) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8 bg-white dark:bg-gray-900">
        <div className="text-center">
          <div className="text-gray-400 dark:text-gray-500 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">No record found</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Record data is not available.
          </p>
        </div>
      </div>
    );
  }

  // Get all field names from record
  const fields = localRecord.fields || {};
  const fieldNames = Object.keys(fields);
  const displayFields = fieldNames.slice(0, 6); // Show up to 6 fields

  return (
    <div className="w-full h-full flex flex-col bg-white dark:bg-gray-900 rounded-2xl">
      <div className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-white dark:bg-gray-800 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex flex-col items-start">
            <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Updated Record
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              1 record • Click to edit
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              aria-label="Expand"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" className="text-gray-600 dark:text-gray-400">
                <path
                  fillRule="nonzero"
                  d="M10 2.5C9.86739 2.5 9.74021 2.55268 9.64645 2.64645C9.55268 2.74021 9.5 2.86739 9.5 3C9.5 3.13261 9.55268 3.25979 9.64645 3.35355C9.74021 3.44732 9.86739 3.5 10 3.5H11.793L9.14648 6.14648C9.05274 6.24025 9.00008 6.36741 9.00008 6.5C9.00008 6.63259 9.05274 6.75975 9.14648 6.85352C9.24025 6.94726 9.36741 6.99992 9.5 6.99992C9.63259 6.99992 9.75975 6.94726 9.85352 6.85352L12.5 4.20703V6C12.5 6.13261 12.5527 6.25979 12.6464 6.35355C12.7402 6.44732 12.8674 6.5 13 6.5C13.1326 6.5 13.2598 6.44732 13.3536 6.35355C13.4473 6.25979 13.5 6.13261 13.5 6V3C13.498 2.99504 13.496 2.99012 13.4939 2.98523C13.4917 2.85861 13.4415 2.73755 13.3535 2.64648C13.2598 2.55272 13.1326 2.50003 13 2.5H10Z M6.5 9C6.3674 9.00002 6.24024 9.05271 6.14648 9.14648L3.5 11.793V10C3.5 9.86739 3.44732 9.74021 3.35355 9.64645C3.25979 9.55268 3.13261 9.5 3 9.5C2.86739 9.5 2.74021 9.55268 2.64645 9.64645C2.55268 9.74021 2.5 9.86739 2.5 10V13C2.50002 13.1326 2.55271 13.2598 2.64648 13.3535C2.74024 13.4473 2.8674 13.5 3 13.5H6C6.13261 13.5 6.25979 13.4473 6.35355 13.3536C6.44732 13.2598 6.5 13.1326 6.5 13C6.5 12.8674 6.44732 12.7402 6.35355 12.6464C6.25979 12.5527 6.13261 12.5 6 12.5H4.20703L6.85352 9.85352C6.94726 9.75975 6.99992 9.63259 6.99992 9.5C6.99992 9.36741 6.94726 9.24025 6.85352 9.14648C6.75976 9.05271 6.6326 9.00002 6.5 9Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Grid Container */}
        <div className="flex-1 overflow-auto px-4 bg-white dark:bg-gray-800" style={{ maxHeight: '370px' }}>
          <div className="py-4" style={{ minWidth: 'max-content' }}>
            {/* Column Headers */}
            <div className="flex items-center mb-1" style={{ height: '26px' }}>
              {displayFields.map((fieldName, idx) => (
                <div
                  key={fieldName}
                  className="flex items-start"
                  style={{
                    minWidth: idx === 0 ? '240px' : '180px',
                    maxWidth: idx === 0 ? '240px' : '180px',
                    paddingLeft: idx === 0 ? '8px' : '12px',
                    paddingRight: '8px',
                  }}
                >
                  <span className="text-xs text-gray-600 dark:text-gray-400 font-normal truncate" title={fieldName}>
                    {fieldName}
                  </span>
                </div>
              ))}
            </div>

            {/* Header Divider */}
            <div className="border-b border-gray-200 dark:border-gray-700 mb-0" />

            {/* Data Row */}
            <div className="space-y-0">
              <div>
                <div
                  className="w-full flex items-center hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded transition-colors"
                  style={{ height: '38px' }}
                >
                  {displayFields.map((fieldName, idx) => {
                    const value = fields[fieldName];
                    const isEditing = editingCell === fieldName;
                    const canEdit = !Array.isArray(value) && !(typeof value === 'object' && value !== null);
                    
                    return (
                      <div
                        key={fieldName}
                        onClick={() => canEdit && handleCellClick(fieldName, value)}
                        className={`flex items-center text-sm text-gray-900 dark:text-gray-100 ${
                          canEdit ? 'cursor-text' : 'cursor-default'
                        } ${isEditing ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                        style={{
                          minWidth: idx === 0 ? '240px' : '180px',
                          maxWidth: idx === 0 ? '240px' : '180px',
                          paddingLeft: idx === 0 ? '8px' : '12px',
                          paddingRight: '8px',
                        }}
                      >
                        {renderCellValue(value, fieldName)}
                      </div>
                    );
                  })}
                </div>
                <div className="border-b border-gray-200 dark:border-gray-700" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 px-4 py-2 text-xs text-gray-600 dark:text-gray-400 font-medium bg-white dark:bg-gray-800">
          <span className="flex items-center justify-between w-full">
            Record updated successfully
            <button
              className="flex items-center hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
              aria-label="Refresh data"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" className="text-current">
                <path
                  d="M13.65 2.35C12.2 0.9 10.21 0 8 0 3.58 0 0 3.58 0 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L9 7h7V0l-2.35 2.35z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </span>
        </div>
      </div>
    </div>
  );
};

export default UpdateRecord;

