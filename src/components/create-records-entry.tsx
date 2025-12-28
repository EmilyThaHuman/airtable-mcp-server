import React from 'react';
import ReactDOM from 'react-dom/client';
import CreateRecords from './create-records';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <CreateRecords />
    </React.StrictMode>
  );
}

