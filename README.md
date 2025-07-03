# 🧬 HPO Phenotype Hierarchy Plugin

A simple Sigma plugin that reads HPO (Human Phenotype Ontology) data from a CSV file and creates a searchable tree interface for selecting phenotype terms.

## Features

- **CSV Data Loading**: Reads HPO data from `bridge_hpo_parents.csv`
- **Hierarchical Tree**: Displays phenotype terms in a parent-child hierarchy
- **Search Functionality**: Search by term ID or name
- **Multi-Selection**: Select individual terms or entire branches
- **Sigma Integration**: Sends selected terms to Sigma as filter variables
- **Auto-Expansion**: Automatically expands tree when searching

## File Structure

```
sigma-hierarchy-filter-plugin/
├── src/
│   ├── HPOPlugin.tsx    # Main plugin component
│   └── main.tsx         # Entry point
├── index.html           # Plugin HTML
├── vite.config.ts       # Build configuration
└── README.md           # This file
```

## Data Format

The plugin expects a CSV file with these columns:
- `TERM_ID`: Unique identifier for the phenotype term
- `TERM_FULL_NAME`: Human-readable name of the phenotype
- `PARENT_ID`: ID of the parent term (empty for root terms)
- `LEVEL`: Hierarchical level (0 for root, 1 for children, etc.)

## Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Place your CSV file**:
   Put `bridge_hpo_parents.csv` in the `public/data/` folder

3. **Start development server**:
   ```bash
   npm run dev
   ```

4. **Open**: `http://localhost:5173`

## Building for Production

```bash
npm run build
```

This creates a `dist/` folder with the built plugin files.

## Sigma Integration

The plugin creates a Sigma control with ID `hpo-phenotype-filter` that contains the selected phenotype terms in the format:
```
HP:0000001 - Abnormality of the nervous system,HP:0000002 - Abnormality of body height
```

Use this control in your Sigma filters:
```sql
WHERE phenotype_term IN (${hpo-phenotype-filter})
```

## Configuration

To change the CSV file location, edit the `loadHPOData` function in `HPOPlugin.tsx`:
```typescript
const response = await fetch('/data/bridge_hpo_parents.csv');
```

## Usage

1. **Load the plugin** in your Sigma workbook
2. **Search** for phenotype terms using the search box
3. **Expand/collapse** branches by clicking the arrow buttons
4. **Select terms** by checking the checkboxes
5. **Use selected terms** in your Sigma filters

The plugin automatically handles:
- Hierarchical selection (selecting a parent selects all children)
- Partial selection states (some children selected)
- Search result highlighting
- Performance optimization for large datasets
