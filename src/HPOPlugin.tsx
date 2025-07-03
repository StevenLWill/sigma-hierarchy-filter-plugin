import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const searchTimeoutRef = useRef<number | undefined>(undefined);

  // Sigma integration
  const { setVariables } = useWorkbookVariables(iframeRef as React.RefObject<HTMLIFrameElement>);

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

  // Handle node selection with logging
  const handleNodeSelect = (node: HPONode, checked: boolean) => {
    const t0 = performance.now();
    const descendants = getDescendants(node.id);
    console.log(`Toggling ${descendants.length} descendants for node ${node.id}`);
    const newSelected = new Set(selectedNodes);

    if (checked) {
      descendants.forEach(id => newSelected.add(id));
      newSelected.add(node.id);
    } else {
      descendants.forEach(id => newSelected.delete(id));
      newSelected.delete(node.id);
    }

    setSelectedNodes(newSelected);

    // Update Sigma filter
    if (iframeLoaded) {
      const selectedTerms = Array.from(newSelected)
        .map(id => {
          const node = nodes.find(n => n.id === id);
          return node ? `${node.id} - ${node.name}` : null;
        })
        .filter((term): term is string => term !== null);

      const valueToSet = selectedTerms.length > 0 ? selectedTerms.join(',') : '';
      setVariables({ 'hpo-phenotype-filter': valueToSet });
    }
    const t1 = performance.now();
    console.log(`handleNodeSelect for ${node.id} took ${(t1 - t0).toFixed(2)} ms`);
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
    <div style={{ 
      padding: '20px', 
      backgroundColor: '#f8f9fa',
      border: '1px solid #ddd',
      borderRadius: '8px',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Header */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '15px'
      }}>
        <h3 style={{ margin: 0, color: '#1976d2', fontSize: '16px' }}>
          🧬 HPO Phenotype Ontology
        </h3>
        <div style={{ fontSize: '12px', color: '#666' }}>
          {selectedNodes.size} selected
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '15px', position: 'relative' }}>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search phenotype terms..."
          style={{
            width: '100%',
            padding: '8px 12px',
            paddingLeft: '32px',
            fontSize: '14px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            outline: 'none',
            boxSizing: 'border-box',
            backgroundColor: 'white'
          }}
        />
        <span style={{
          position: 'absolute',
          left: '10px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#666',
          fontSize: '14px',
          pointerEvents: 'none'
        }}>
          🔍
        </span>
      </div>

      {/* Tree */}
      <div style={{ 
        height: '400px',
        border: '1px solid #ddd', 
        borderRadius: '4px',
        backgroundColor: 'white',
        overflow: 'auto'
      }}>
        {visibleNodes.map(node => (
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
        
        {visibleNodes.length === 0 && (
          <div style={{ 
            padding: '20px', 
            textAlign: 'center', 
            color: '#666',
            fontSize: '14px'
          }}>
            {searchTerm ? 'No matching phenotype terms found' : 'No phenotype terms available'}
          </div>
        )}
      </div>
    </div>
  );
};

export default HPOPlugin; 