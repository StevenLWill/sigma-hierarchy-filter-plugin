import React from 'react';
import { createRoot } from 'react-dom/client';
import HPOPlugin from './HPOPlugin';

// Initialize the plugin
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('hpo-plugin');
  if (container) {
    const root = createRoot(container);
    root.render(<HPOPlugin />);
  }
});

export default HPOPlugin;
