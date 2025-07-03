import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVariable } from '@sigmacomputing/plugin';
import { useWorkbookVariables } from '@sigmacomputing/react-embed-sdk';
import Papa from 'papaparse';

// HPO Node interface
interface HPONode {
  id: string;
  name: string;
  parent_id: string | null;
  level: number;
  has_children: boolean;
}

// Helper to strip leading/trailing quotes
const stripQuotes = (str: string | undefined | null): string => {
  if (!str) return '';
  return str.replace(/^"+|"+$/g, '').trim();
};

// Main HPO Plugin Component
const HPOPlugin: React.FC = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [nodes, setNodes] = useState<HPONode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const searchTimeoutRef = useRef<number | undefined>(undefined);

  // Add debug state
  const [showDebug, setShowDebug] = useState(true);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Add debug logging function
  const addDebugLog = useCallback((message: string) => {
    setDebugLogs(prev => [...prev.slice(-9), message]); // Keep last 10 logs
  }, []);

  // Add variable existence check
  const [variableExists, setVariableExists] = useState(false);
  
  // Add local development state
  const [localSelectedNodes, setLocalSelectedNodes] = useState<Set<string>>(new Set());
  const isLocalDev = process.env.NODE_ENV === 'development';

  // Get access to Sigma workbook variables
  const { getVariables, setVariables } = useWorkbookVariables(iframeRef as React.RefObject<HTMLIFrameElement>);

  // Two-way sync with Sigma control
  const [filterValue, setFilterValue] = useVariable('hpo-phenotype-filter') as [unknown, (value: string[]) => void];

  // Add iframe ready state
  const [isIframeReady, setIsIframeReady] = useState(false);

  // Set iframe loaded when component mounts
  useEffect(() => {
    addDebugLog('Initializing iframe...');
    // Create a hidden iframe for Sigma communication
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    // Set the src to the current origin to enable cross-frame communication
    iframe.src = window.location.origin;
    
    // Add load event listener
    iframe.onload = () => {
      addDebugLog('Iframe loaded successfully');
      setIsIframeReady(true);
    };

    iframe.onerror = (error) => {
      addDebugLog('Error loading iframe: ' + error);
    };

    document.body.appendChild(iframe);
    iframeRef.current = iframe;

    // Cleanup
    return () => {
      addDebugLog('Cleaning up iframe');
      document.body.removeChild(iframe);
    };
  }, [addDebugLog]);

  // Check variable existence on mount
  useEffect(() => {
    const checkVariable = async () => {
      if (!isIframeReady) {
        addDebugLog('Waiting for iframe to be ready...');
        return;
      }

      if (!iframeRef.current) {
        addDebugLog('ERROR: iframe reference is null');
        return;
      }

      try {
        addDebugLog('Checking for variables...');
        // Try to get all variables
        const variables = await getVariables();
        
        // Log all available variables
        addDebugLog('=== Available Sigma Variables ===');
        if (!variables) {
          addDebugLog('No variables object returned');
          return;
        }

        if (typeof variables === 'object') {
          const variableNames = Object.keys(variables);
          if (variableNames.length === 0) {
            addDebugLog('No variables found in workbook');
          } else {
            addDebugLog('Found variables:');
            variableNames.forEach(name => {
              addDebugLog(`- ${name}`);
            });
          }
        } else {
          addDebugLog(`Variables is not an object, got: ${typeof variables}`);
        }
        
        // Check if our variable exists
        if (variables && typeof variables === 'object' && 'hpo-phenotype-filter' in variables) {
          setVariableExists(true);
          addDebugLog('✓ hpo-phenotype-filter exists in workbook');
        } else {
          setVariableExists(false);
          addDebugLog('✗ hpo-phenotype-filter not found in workbook');
        }
      } catch (error) {
        addDebugLog('Error checking variables: ' + error);
        setVariableExists(false);
      }
    };

    if (!isLocalDev) {
      checkVariable();
    }
  }, [isLocalDev, isIframeReady, getVariables, addDebugLog]);

  // Enhanced debug logging
  useEffect(() => {
    const debugInfo = [
      '=== Variable Debug Info ===',
      `Environment: ${isLocalDev ? 'Development' : 'Production'}`,
      `Iframe Ready: ${isIframeReady}`,
      `Variable name: hpo-phenotype-filter`,
      `Variable exists in workbook: ${variableExists}`,
      `filterValue type: ${typeof filterValue}`,
      `filterValue value: ${JSON.stringify(filterValue)}`,
      `Is array? ${Array.isArray(filterValue)}`,
      `Is null? ${filterValue === null}`,
      `Is undefined? ${filterValue === undefined}`,
      '========================'
    ].join('\n');
    
    addDebugLog(debugInfo);
  }, [filterValue, variableExists, isLocalDev, isIframeReady, addDebugLog]);

  // Parse filterValue into a Set for selection logic
  const selectedNodes = useMemo(() => {
    if (!filterValue) return new Set<string>();
    if (Array.isArray(filterValue)) return new Set(filterValue as string[]);
    if (typeof filterValue === 'string') {
      return new Set(
        (filterValue as string)
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      );
    }
    return new Set<string>();
  }, [filterValue]);

  const loadChunkedData = async () => {
    try {
      console.log('Starting to load chunks...');
      const chunks = [];
      const chunkSuffixes = ['aa', 'ab', 'ac', 'ad', 'ae'];

      for (const suffix of chunkSuffixes) {
        try {
          console.log(`Fetching chunk ${suffix}...`);
          const response = await fetch(`/data/hpo_chunk_${suffix}`);
          if (!response.ok) {
            console.error(`Failed to load chunk ${suffix}`);
            continue;
          }
          const text = await response.text();
          console.log(`Loaded chunk ${suffix}, size: ${text.length} bytes`);
          chunks.push(text);
        } catch (error) {
          console.error(`Error loading chunk ${suffix}:`, error);
          continue;
        }
      }

      if (chunks.length === 0) {
        throw new Error('No data chunks found');
      }

      console.log(`Combining ${chunks.length} chunks...`);
      // Combine chunks, keeping header only from first chunk
      const [firstChunk, ...restChunks] = chunks;
      const combinedData = [
        firstChunk,
        ...restChunks.map(chunk => chunk.split('\n').slice(1).join('\n'))
      ].join('\n');
      console.log('Combined data size:', combinedData.length, 'bytes');

      console.log('Parsing CSV data...');
      // Parse the combined CSV data
      const results = Papa.parse(combinedData, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header: string): string => header.trim(),
      });

      if (results.errors.length > 0) {
        console.error('CSV parsing errors:', results.errors);
      }

      console.log(`Parsed ${results.data.length} rows`);
      return results.data;
    } catch (error) {
      console.error('Error loading chunked data:', error);
      throw error;
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        console.log('Starting data fetch...');
        const data = await loadChunkedData();
        
        console.log('Processing nodes...');
        // Process the data into nodes
        const processedNodes = data
          .filter((row: any) => row.TERM_ID && row.TERM_FULL_NAME && !row.TERM_ID.startsWith(']'))
          .map((row: any): HPONode => ({
            id: stripQuotes(row.TERM_ID),
            name: stripQuotes(row.TERM_FULL_NAME),
            parent_id: row.PARENT_ID ? stripQuotes(row.PARENT_ID) : null,
            level: parseInt(row.LEVEL, 10),
            has_children: false
          }));

        console.log(`Created ${processedNodes.length} nodes`);

        // Calculate has_children
        console.log('Calculating parent-child relationships...');
        const nodesMap = new Map<string, HPONode>();
        processedNodes.forEach(node => {
          nodesMap.set(node.id, node);
        });

        processedNodes.forEach(node => {
          if (node.parent_id && nodesMap.has(node.parent_id)) {
            const parent = nodesMap.get(node.parent_id)!;
            parent.has_children = true;
          }
        });

        console.log('Setting nodes in state...');
        setNodes(processedNodes);
        console.log('Data loading complete!');
        setLoading(false);
      } catch (error) {
        console.error('Error fetching data:', error);
        setError(error instanceof Error ? error.message : 'Failed to load HPO data');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Set iframe loaded when component mounts
  useEffect(() => {
    setIframeLoaded(true);
  }, []);

  // Create parent-child relationships
  const nodesByParent = useMemo(() => {
    const map = new Map<string | null, HPONode[]>();
    nodes.forEach(node => {
      const parentNodes = map.get(node.parent_id) || [];
      parentNodes.push(node);
      map.set(node.parent_id, parentNodes);
    });
    return map;
  }, [nodes]);

  // Debounce search term updates
  useEffect(() => {
    if (searchTimeoutRef.current) {
      window.clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        window.clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTerm]);

  // Create a map for quick node lookup by ID
  const nodesById = useMemo(() => {
    const map = new Map<string, HPONode>();
    nodes.forEach(node => map.set(node.id, node));
    return map;
  }, [nodes]);

  // Get visible nodes based on expanded state and search
  const visibleNodes = useMemo(() => {
    const result: HPONode[] = [];
    const visited = new Set<string>();
    
    if (debouncedSearchTerm) {
      // Search mode - show matching nodes and their ancestors
      const matchingNodes = new Set<string>();
      const ancestorNodes = new Set<string>();
      const searchLower = debouncedSearchTerm.toLowerCase();
      
      // Find matching nodes and their ancestors
      nodes.forEach(node => {
        if (node.name.toLowerCase().includes(searchLower) ||
            node.id.toLowerCase().includes(searchLower)) {
          matchingNodes.add(node.id);
          
          // Add ancestors
          let current = node;
          while (current.parent_id) {
            ancestorNodes.add(current.parent_id);
            const parent = nodesById.get(current.parent_id);
            if (!parent) break;
            current = parent;
          }
        }
      });
      
      // Add nodes in proper order
      const addNodeAndChildren = (node: HPONode) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        
        if (matchingNodes.has(node.id) || ancestorNodes.has(node.id)) {
          result.push(node);
          
          const children = nodesByParent.get(node.id) || [];
          children.forEach(child => {
            if (matchingNodes.has(child.id) || ancestorNodes.has(child.id)) {
              addNodeAndChildren(child);
            }
          });
        }
      };
      
      const rootNodes = nodesByParent.get(null) || [];
      rootNodes.forEach(node => addNodeAndChildren(node));
      
    } else {
      // Normal mode - show root nodes and expanded children
      const addNode = (node: HPONode) => {
        if (visited.has(node.id)) return;
        visited.add(node.id);
        
        result.push(node);
        
        if (expandedNodes.has(node.id)) {
          const children = nodesByParent.get(node.id) || [];
          children.forEach(child => addNode(child));
        }
      };
      
      const rootNodes = nodesByParent.get(null) || [];
      rootNodes.forEach(node => addNode(node));
    }
    
    return result;
  }, [nodes, expandedNodes, nodesByParent, debouncedSearchTerm, nodesById]);

  // Toggle node expansion
  const toggleExpansion = (nodeId: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Optimized getDescendants with Set and logging
  const getDescendants = (nodeId: string): string[] => {
    const descendants: string[] = [];
    const stack = [nodeId];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      if (currentId !== nodeId) descendants.push(currentId);
      const children = nodesByParent.get(currentId) || [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          stack.push(child.id);
        }
      }
    }
    return descendants;
  };

  // Handle node selection with error handling
  const handleNodeSelect = async (node: HPONode, checked: boolean) => {
    const descendants = getDescendants(node.id);
    const newSelection = new Set(selectedNodes);
    
    if (checked) {
      newSelection.add(node.id);
      descendants.forEach(id => newSelection.add(id));
    } else {
      newSelection.delete(node.id);
      descendants.forEach(id => newSelection.delete(id));
    }

    // Handle local development
    if (isLocalDev) {
      setLocalSelectedNodes(newSelection);
      addDebugLog(`Local dev: Updated selection with ${newSelection.size} items`);
      return;
    }
    
    // Handle Sigma integration
    if (!variableExists) {
      addDebugLog('ERROR: Cannot update selection - variable does not exist in Sigma workbook');
      return;
    }
    
    try {
      const newValue = Array.from(newSelection);
      // Try both methods to update the variable
      setFilterValue(newValue);
      await setVariables({ 'hpo-phenotype-filter': newValue.join(',') });
      addDebugLog(`Successfully updated selection with ${newSelection.size} items`);
    } catch (error) {
      addDebugLog(`ERROR: Failed to update selection - ${error}`);
    }
  };

  // Check if node is selected
  const isNodeSelected = (nodeId: string): boolean => {
    return selectedNodes.has(nodeId);
  };

  // Check if node is partially selected
  const isNodePartiallySelected = (nodeId: string): boolean => {
    const descendants = getDescendants(nodeId);
    const selectedDescendants = descendants.filter(id => selectedNodes.has(id));
    return selectedDescendants.length > 0 && selectedDescendants.length < descendants.length;
  };

  // Auto-expand nodes when searching
  useEffect(() => {
    if (debouncedSearchTerm) {
      const matches = new Set<string>();
      const searchLower = debouncedSearchTerm.toLowerCase();
      nodes.forEach(node => {
        if (node.name.toLowerCase().includes(searchLower) ||
            node.id.toLowerCase().includes(searchLower)) {
          // Add all ancestors
          let current = node;
          while (current.parent_id) {
            matches.add(current.parent_id);
            const parent = nodesById.get(current.parent_id);
            if (!parent) break;
            current = parent;
          }
          matches.add(node.id);
        }
      });
      setExpandedNodes(matches);
    } else {
      setExpandedNodes(new Set());
    }
  }, [debouncedSearchTerm, nodes, nodesById]);

  // Highlight matching text in search results
  const highlightText = (text: string, highlight: string) => {
    if (!highlight) return text;
    
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return parts.map((part, i) => 
      part.toLowerCase() === highlight.toLowerCase() ? (
        <span key={i} style={{ backgroundColor: '#fff3b0', padding: '0 2px', borderRadius: '2px' }}>
          {part}
        </span>
      ) : part
    );
  };

  // Loading state
  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '16px', marginBottom: '10px' }}>Loading HPO data...</div>
        <div style={{ fontSize: '12px', color: '#666' }}>
          Processing {nodes.length > 0 ? `${nodes.length.toLocaleString()} phenotype terms` : 'large dataset'}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div style={{ color: '#d32f2f', marginBottom: '10px' }}>Error: {error}</div>
        <button 
          onClick={() => {
            const fetchData = async () => {
              try {
                setLoading(true);
                const data = await loadChunkedData();
                
                // Process the data into nodes
                const processedNodes = data
                  .filter((row: any) => row.TERM_ID && row.TERM_FULL_NAME && !row.TERM_ID.startsWith(']'))
                  .map((row: any): HPONode => ({
                    id: stripQuotes(row.TERM_ID),
                    name: stripQuotes(row.TERM_FULL_NAME),
                    parent_id: row.PARENT_ID ? stripQuotes(row.PARENT_ID) : null,
                    level: parseInt(row.LEVEL, 10),
                    has_children: false
                  }));

                // Calculate has_children
                const nodesMap = new Map<string, HPONode>();
                processedNodes.forEach(node => {
                  nodesMap.set(node.id, node);
                });

                processedNodes.forEach(node => {
                  if (node.parent_id && nodesMap.has(node.parent_id)) {
                    const parent = nodesMap.get(node.parent_id)!;
                    parent.has_children = true;
                  }
                });

                setNodes(processedNodes);
                setLoading(false);
              } catch (error) {
                console.error('Error fetching data:', error);
                setError(error instanceof Error ? error.message : 'Failed to load HPO data');
                setLoading(false);
              }
            };

            fetchData();
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#2196f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Variable Warning */}
      {!variableExists && (
        <div style={{
          backgroundColor: '#fff3cd',
          color: '#856404',
          padding: '12px',
          margin: '10px',
          borderRadius: '4px',
          fontSize: '14px',
          border: '1px solid #ffeeba'
        }}>
          Please create a List control named "hpo-phenotype-filter" in your Sigma workbook to enable selection syncing.
        </div>
      )}

      {/* Debug Panel */}
      {showDebug && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '300px',
          maxHeight: '200px',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '10px',
          fontSize: '12px',
          fontFamily: 'monospace',
          overflowY: 'auto',
          zIndex: 1000,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
            <span>Debug Panel</span>
            <button 
              onClick={() => setShowDebug(false)}
              style={{
                background: 'none',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {debugLogs.join('\n\n')}
          </pre>
        </div>
      )}

      {/* Toggle Debug Button */}
      {!showDebug && (
        <button
          onClick={() => setShowDebug(true)}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            padding: '5px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            zIndex: 1000,
          }}
        >
          Show Debug
        </button>
      )}

      {/* Existing UI components */}
      <div style={{ padding: '10px' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search phenotype terms..."
          style={{
            width: '100%',
            padding: '8px',
            marginBottom: '10px',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
      </div>

      {/* Rest of your existing UI */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px' }}>
        {loading ? (
          <div>Loading...</div>
        ) : error ? (
          <div style={{ color: 'red' }}>{error}</div>
        ) : (
          <div>
            {visibleNodes.map((node) => (
              <div
                key={node.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: `${node.level * 20}px`,
                  paddingRight: '8px',
                  paddingTop: '4px',
                  paddingBottom: '4px',
                  backgroundColor: isNodeSelected(node.id)
                    ? '#e3f2fd'
                    : isNodePartiallySelected(node.id)
                      ? '#f0f7ff'
                      : 'transparent',
                  borderRadius: '2px',
                  fontSize: '13px',
                  lineHeight: '1.3'
                }}
              >
                {/* Expand/Collapse Button */}
                <button
                  onClick={() => toggleExpansion(node.id)}
                  disabled={!node.has_children}
                  style={{
                    width: '16px',
                    height: '16px',
                    border: 'none',
                    background: 'transparent',
                    cursor: node.has_children ? 'pointer' : 'default',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: '4px',
                    color: node.has_children ? '#666' : 'transparent'
                  }}
                >
                  {node.has_children ? (expandedNodes.has(node.id) ? '▼' : '▶') : ''}
                </button>
                
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isNodeSelected(node.id)}
                  ref={input => {
                    if (input) input.indeterminate = isNodePartiallySelected(node.id);
                  }}
                  onChange={(e) => handleNodeSelect(node, e.target.checked)}
                  style={{
                    marginRight: '8px',
                    cursor: 'pointer',
                    accentColor: isNodeSelected(node.id) ? '#2196f3' : undefined
                  }}
                />
                
                {/* Node Label */}
                <span style={{
                  fontFamily: 'monospace',
                  color: '#333',
                  cursor: node.has_children ? 'pointer' : 'default',
                  flex: 1,
                  userSelect: 'none',
                  display: 'flex',
                  alignItems: 'center'
                }}
                onClick={() => node.has_children && toggleExpansion(node.id)}
                >
                  <span style={{ opacity: 0.7 }}>{node.id}</span>
                  <span style={{ margin: '0 4px' }}>-</span>
                  <span>{highlightText(node.name, debouncedSearchTerm)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HPOPlugin; 