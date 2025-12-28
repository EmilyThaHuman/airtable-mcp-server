import React from 'react';
import ReactDOM from 'react-dom/client';
import ListRecords from './list-records';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ListRecords />
    </React.StrictMode>
  );
}

