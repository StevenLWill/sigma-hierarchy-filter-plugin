import React, { useState, useEffect, useMemo } from 'react';
import { useVariable } from '@sigmacomputing/plugin';
import Papa from 'papaparse';

// HPO Node interface
interface HPONode {
  id: string;
  label: string;
  parentId: string | null;
  level: number;
  children: HPONode[];
}

// Helper to strip leading/trailing quotes
const stripQuotes = (str: string | undefined | null): string => {
  if (!str) return '';
  return str.replace(/^"+|"+$/g, '').trim();
};

// Helper to find a node by ID in the tree
const findNodeById = (nodes: HPONode[], nodeId: string): HPONode | null => {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.children) {
      const found = findNodeById(node.children, nodeId);
      if (found) return found;
    }
  }
  return null;
};

// Helper to get all descendant node IDs
const getDescendantIds = (node: HPONode): string[] => {
  const descendantIds: string[] = [];
  const queue = [...node.children];
  
  while (queue.length > 0) {
    const currentNode = queue.shift();
    if (currentNode) {
      descendantIds.push(currentNode.id);
      queue.push(...currentNode.children);
    }
  }
  
  return descendantIds;
};

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  padding: '16px',
  boxSizing: 'border-box',
  background: '#ffffff',
  position: 'relative',
  zIndex: 1
};

const searchStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px',
  marginBottom: '16px',
  border: '1px solid #ccc',
  borderRadius: '4px',
  fontSize: '14px',
  position: 'relative',
  zIndex: 2
};

const treeContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 0',
  position: 'relative',
  zIndex: 2,
  background: '#ffffff'
};

const nodeStyle = (level: number, isSelected: boolean, hasSelectedDescendants: boolean): React.CSSProperties => ({
  marginLeft: `${level * 20}px`,
  marginBottom: '8px',
  backgroundColor: isSelected ? '#e3f2fd' : hasSelectedDescendants ? '#f5f9ff' : '#ffffff',
  padding: '4px 8px',
  borderRadius: '4px',
  position: 'relative',
  zIndex: 3
});

interface CSVRow {
  TERM_ID: string;
  TERM_FULL_NAME: string;
  PARENT_ID?: string;
  LEVEL: string;
}

export const HPOPlugin: React.FC = () => {
  console.log('Rendering HPOPlugin component');
  
  // State management
  const [nodes, setNodes] = useState<HPONode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [localSelectedNodes, setLocalSelectedNodes] = useState<Set<string>>(new Set());
  
  // Get the filter value from Sigma
  const [filterValue, setFilterValue] = useVariable('hpo-phenotype-filter');
  const isLocalDev = process.env.NODE_ENV === 'development';

  // Parse filterValue into a Set for selection logic
  const selectedNodes = useMemo(() => {
    // Use local state for development
    if (isLocalDev) return localSelectedNodes;

    if (!filterValue) return new Set<string>();
    try {
      if (Array.isArray(filterValue)) return new Set(filterValue);
      if (typeof filterValue === 'string') {
        const parsed = JSON.parse(filterValue);
        return new Set(Array.isArray(parsed) ? parsed : [parsed]);
      }
      return new Set<string>();
    } catch (err) {
      console.error('Error parsing filterValue:', err);
      return new Set<string>();
    }
  }, [filterValue, localSelectedNodes, isLocalDev]);

  const parseCSVChunk = async (csvData: string): Promise<HPONode[]> => {
    console.log('Starting CSV parse...');
    
    return new Promise((resolve) => {
      Papa.parse<CSVRow>(csvData, {
        header: true,
        skipEmptyLines: 'greedy',
        transformHeader: (header: string): string => header.trim(),
        error: (error: Error) => {
          console.error('CSV parsing error:', error);
        },
        complete: (results) => {
          const parsedNodes = results.data
            .filter((row: CSVRow) => {
              const isValid = row.TERM_ID && row.TERM_FULL_NAME;
              if (!isValid) {
                console.warn('Invalid row:', row);
              }
              return isValid;
            })
            .map((row: CSVRow): HPONode => ({
              id: stripQuotes(row.TERM_ID),
              label: stripQuotes(row.TERM_FULL_NAME),
              parentId: row.PARENT_ID ? stripQuotes(row.PARENT_ID) : null,
              level: parseInt(row.LEVEL, 10),
              children: []
            }));
          console.log(`Processed ${parsedNodes.length} valid nodes`);
          resolve(parsedNodes);
        }
      });
    });
  };

  // Load data from chunks
  useEffect(() => {
    const loadChunkedData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Load and combine chunks
        const chunks = [];
        const chunkSuffixes = ['aa', 'ab', 'ac', 'ad', 'ae'];
        
        for (const suffix of chunkSuffixes) {
          try {
            console.log(`Attempting to load chunk ${suffix}...`);
            const response = await fetch(`/data/hpo_chunk_${suffix}`);
            if (!response.ok) {
              console.error(`Failed to load chunk ${suffix}: ${response.statusText}`);
              continue;
            }
            
            const chunkData = await response.text();
            console.log(`Successfully loaded chunk ${suffix}, size: ${chunkData.length} bytes`);
            chunks.push(chunkData);
          } catch (err) {
            console.error(`Error loading chunk ${suffix}:`, err);
            continue;
          }
        }
        
        if (chunks.length === 0) {
          throw new Error('No data chunks found');
        }
        
        console.log(`Combining ${chunks.length} chunks...`);
        // Combine chunks, ensuring we handle partial lines correctly
        let combinedData = '';
        let partialLine = '';
        
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const lines = (partialLine + chunk).split('\n');
          
          // If this isn't the last chunk, the last line might be incomplete
          if (i < chunks.length - 1) {
            partialLine = lines.pop() || '';
            combinedData += lines.join('\n') + '\n';
          } else {
            // For the last chunk, include everything
            combinedData += lines.join('\n');
          }
        }

        // Log the first and last few lines to verify chunk combination
        const previewLines = combinedData.split('\n');
        console.log('First few lines:', previewLines.slice(0, 3));
        console.log('Last few lines:', previewLines.slice(-3));

        console.log('Parsing combined CSV data...');
        const parsedNodes = await parseCSVChunk(combinedData);
        
        // Build tree structure
        console.log('Building tree structure...');
        const nodesMap = new Map<string, HPONode>();
        parsedNodes.forEach(node => nodesMap.set(node.id, node));
        
        // Connect parent-child relationships
        parsedNodes.forEach(node => {
          if (node.parentId && nodesMap.has(node.parentId)) {
            const parent = nodesMap.get(node.parentId);
            if (parent) {
              parent.children.push(node);
            }
          }
        });
        
        // Get root nodes (nodes without parents or with non-existent parents)
        const rootNodes = parsedNodes.filter(node => 
          !node.parentId || !nodesMap.has(node.parentId)
        );
        
        console.log(`Found ${rootNodes.length} root nodes`);
        setNodes(rootNodes);
        
      } catch (err) {
        console.error('Error loading data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadChunkedData();
  }, []);

  // Handle node selection
  const handleNodeSelect = async (nodeId: string, selected: boolean) => {
    try {
      // Get all descendant IDs for the selected node
      const targetNode = findNodeById(nodes, nodeId);
      if (!targetNode) return;
      
      const descendants = getDescendantIds(targetNode);
      const allIds = [nodeId, ...descendants];

      // Check if we're in local development mode
      if (isLocalDev) {
        const newSelection = new Set(localSelectedNodes);
        if (selected) {
          // Add the node and all its descendants
          allIds.forEach(id => newSelection.add(id));
        } else {
          // Remove the node and all its descendants
          allIds.forEach(id => newSelection.delete(id));
        }
        setLocalSelectedNodes(newSelection);
        return;
      }

      // Update the selection
      const currentSelection = Array.from(selectedNodes);
      let newSelection;

      if (selected) {
        // Add the node and all its descendants
        newSelection = [...new Set([...currentSelection, ...allIds])];
      } else {
        // Remove the node and all its descendants
        newSelection = currentSelection.filter(id => !allIds.includes(id));
      }

      // Update the Sigma variable
      setFilterValue(newSelection);
    } catch (err) {
      console.error('Error updating selection:', err);
      setError(err instanceof Error ? err.message : 'Failed to update selection');
    }
  };

  // Render tree nodes recursively
  const renderNode = (node: HPONode) => {
    const isSelected = selectedNodes.has(node.id);
    const hasSelectedDescendants = node.children.some(child => 
      selectedNodes.has(child.id) || 
      child.children.some(grandchild => selectedNodes.has(grandchild.id))
    );
    const isExpanded = expandedNodes.has(node.id);

    return (
      <div
        key={node.id}
        style={nodeStyle(node.level, isSelected, hasSelectedDescendants)}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '20px', marginRight: '4px' }}>
            {node.children.length > 0 && (
              <button
                onClick={() => {
                  const newExpanded = new Set(expandedNodes);
                  if (isExpanded) {
                    newExpanded.delete(node.id);
                  } else {
                    newExpanded.add(node.id);
                  }
                  setExpandedNodes(newExpanded);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  fontSize: '10px',
                  color: '#666',
                  width: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            )}
          </div>
          <div style={{ position: 'relative', marginRight: '8px' }}>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => handleNodeSelect(node.id, e.target.checked)}
              style={{ 
                width: '14px',
                height: '14px',
                cursor: 'pointer',
                margin: 0
              }}
            />
            {hasSelectedDescendants && !isSelected && (
              <div style={{
                position: 'absolute',
                top: '6px',
                left: '3px',
                width: '8px',
                height: '1.5px',
                backgroundColor: '#2196f3',
                opacity: 0.6,
                pointerEvents: 'none'
              }} />
            )}
          </div>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center',
            fontSize: '13px',
            color: '#333',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
          }}>
            <span style={{ 
              color: '#666',
              marginRight: '8px',
              fontFamily: 'monospace'
            }}>
              {node.id}
            </span>
            <span>{node.label}</span>
          </div>
        </div>
        {isExpanded && node.children.length > 0 && (
          <div style={{ marginTop: '4px' }}>
            {node.children.sort((a, b) => a.label.localeCompare(b.label)).map(child => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={containerStyle}>
      <input
        type="text"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search phenotypes..."
        style={searchStyle}
      />

      <div style={treeContainerStyle}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', background: '#ffffff', position: 'relative', zIndex: 2 }}>
            <div style={{ fontSize: '16px', marginBottom: '10px' }}>Loading HPO data...</div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              Processing {nodes.length > 0 ? `${nodes.length.toLocaleString()} phenotype terms` : 'large dataset'}
            </div>
          </div>
        ) : error ? (
          <div style={{ color: 'red', padding: '20px', background: '#ffffff', position: 'relative', zIndex: 2 }}>{error}</div>
        ) : (
          <div style={{ position: 'relative', zIndex: 2 }}>
            {nodes.sort((a, b) => a.label.localeCompare(b.label)).map(node => renderNode(node))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HPOPlugin; 