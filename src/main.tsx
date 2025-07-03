import { client } from '@sigmacomputing/plugin';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HPOPlugin } from './HPOPlugin';

// Configure the plugin with a variable for the filter
client.config.configureEditorPanel([
  {
    name: 'hpo-phenotype-filter',
    type: 'variable'
  }
]);

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded');
  
  // Find or create root element
  let rootElement = document.getElementById('root');
  if (!rootElement) {
    console.log('Creating root element');
    rootElement = document.createElement('div');
    rootElement.id = 'root';
    rootElement.style.position = 'fixed';
    rootElement.style.top = '0';
    rootElement.style.left = '0';
    rootElement.style.right = '0';
    rootElement.style.bottom = '0';
    rootElement.style.background = '#ffffff';
    document.body.appendChild(rootElement);
  }

  // Add base styles to body and html
  document.body.style.margin = '0';
  document.body.style.padding = '0';
  document.documentElement.style.height = '100%';
  document.body.style.height = '100%';

  // Render the plugin
  console.log('Rendering HPOPlugin');
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <div style={{ 
        width: '100%', 
        height: '100%',
        position: 'absolute',
        top: 0,
        left: 0,
        overflow: 'hidden'
      }}>
        <HPOPlugin />
      </div>
    </React.StrictMode>
  );
});

export default HPOPlugin;
