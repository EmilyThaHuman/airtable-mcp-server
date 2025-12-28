import React from 'react';
import ReactDOM from 'react-dom/client';
import DisplayRecordsForTable from './display-records-for-table';
import '../styles/index.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <DisplayRecordsForTable />
    </React.StrictMode>
  );
}

